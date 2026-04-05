/**
 * Flutter Drive Execution
 *
 * Runs flutter drive (integration tests via ChromeDriver) or flutter run
 * (inspect mode) and yields TestEvents from parsed output.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { TestContext, TestPlan, TestEvent, TestEventType } from '../../types'

type FlutterOutputParsed = {
  type: TestEventType
  testName?: string
  message: string
  status: 'passed' | 'failed' | 'skipped' | 'error'
}

function parseFlutterOutput(line: string): FlutterOutputParsed | null {
  // flutter test JSON protocol lines start with specific patterns
  // flutter drive outputs lines like:
  //   00:01 +1: test name
  //   00:02 +1 -1: test name [E]
  //   All tests passed!
  //   Some tests failed.

  if (!line.trim()) return null

  // Passed test: "00:01 +N: test name"
  const passMatch = /^\d+:\d+\s+\+\d+:\s+(.+)$/.exec(line)
  if (passMatch && !line.includes('[E]') && !line.includes('FAILED')) {
    return {
      type: 'test_passed',
      testName: passMatch[1].trim(),
      message: line.trim(),
      status: 'passed',
    }
  }

  // Failed test: "00:01 +N -M: test name [E]" or lines with FAILED
  const failMatch = /^\d+:\d+\s+\+\d+\s+-\d+:\s+(.+)$/.exec(line)
  if (failMatch || line.includes('[E]') || line.toUpperCase().includes('FAILED')) {
    const testName = failMatch ? failMatch[1].replace('[E]', '').trim() : undefined
    return {
      type: 'test_failed',
      testName,
      message: line.trim(),
      status: 'failed',
    }
  }

  // Skipped test
  if (line.includes('skip') || line.includes('SKIP')) {
    return {
      type: 'test_skipped',
      message: line.trim(),
      status: 'skipped',
    }
  }

  // Suite finished
  if (line.includes('All tests passed') || line.includes('tests passed')) {
    return {
      type: 'suite_finished',
      message: line.trim(),
      status: 'passed',
    }
  }

  if (line.includes('Some tests failed') || line.includes('tests failed')) {
    return {
      type: 'suite_finished',
      message: line.trim(),
      status: 'failed',
    }
  }

  // Generic console output
  return {
    type: 'console_output',
    message: line.trim(),
    status: 'passed',
  }
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function* runDrive(
  ctx: TestContext,
  plan: TestPlan,
): AsyncGenerator<TestEvent> {
  const { projectDir, mission } = ctx
  const framework = 'flutter'
  const target = mission.target.platform
  const phase = 'execute'

  let chromedriverProc: ChildProcess | null = null

  try {
    // Start chromedriver as background process
    chromedriverProc = spawn('chromedriver', ['--port=4444'], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })

    // Wait briefly for chromedriver to start
    await waitMs(1000)

    yield {
      type: 'suite_started',
      framework,
      target,
      phase,
      status: 'passed',
      message: 'ChromeDriver started on port 4444',
    }

    // Find the flutter drive step to get the command
    const driveStep = plan.steps.find(
      (s) => s.command === 'flutter' && s.args?.includes('drive'),
    )

    const flutterArgs = driveStep?.args ?? [
      'drive',
      '--driver=test_driver/integration_test.dart',
      '--target=integration_test/app_test.dart',
      '-d',
      'chrome',
    ]

    yield {
      type: 'test_started',
      framework,
      target,
      phase,
      status: 'passed',
      message: `Running: flutter ${flutterArgs.join(' ')}`,
    }

    const flutterProc = spawn('flutter', flutterArgs, {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let lineBuffer = ''

    const processLine = (line: string): FlutterOutputParsed | null => parseFlutterOutput(line)

    // We collect events and yield them; use a promise-based approach for the async generator
    const events: TestEvent[] = []
    let done = false
    let exitCode: number | null = null

    flutterProc.stdout?.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString()
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() ?? ''
      for (const line of lines) {
        const parsed = processLine(line)
        if (parsed) {
          events.push({
            type: parsed.type,
            framework,
            target,
            phase,
            status: parsed.status,
            testName: parsed.testName,
            message: parsed.message,
            raw: line,
          })
        }
      }
    })

    flutterProc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) {
        events.push({
          type: 'console_output',
          framework,
          target,
          phase,
          status: 'passed',
          message: `[stderr] ${text}`,
          raw: text,
        })
      }
    })

    flutterProc.on('close', (code) => {
      exitCode = code
      done = true
    })

    flutterProc.on('error', (err) => {
      events.push({
        type: 'test_error',
        framework,
        target,
        phase,
        status: 'error',
        message: `flutter drive process error: ${err.message}`,
      })
      done = true
    })

    // Poll events until process is done
    while (!done || events.length > 0) {
      if (events.length > 0) {
        yield events.shift()!
      } else {
        await waitMs(50)
      }
    }

    // Flush remaining line buffer
    if (lineBuffer.trim()) {
      const parsed = parseFlutterOutput(lineBuffer)
      if (parsed) {
        yield {
          type: parsed.type,
          framework,
          target,
          phase,
          status: parsed.status,
          testName: parsed.testName,
          message: parsed.message,
          raw: lineBuffer,
        }
      }
    }

    // Final suite_finished event
    yield {
      type: 'suite_finished',
      framework,
      target,
      phase,
      status: exitCode === 0 ? 'passed' : 'failed',
      message: exitCode === 0 ? 'Flutter drive completed successfully' : `Flutter drive exited with code ${exitCode}`,
    }
  } catch (err: unknown) {
    yield {
      type: 'test_error',
      framework,
      target,
      phase,
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
  } finally {
    // Clean up chromedriver
    if (chromedriverProc && !chromedriverProc.killed) {
      chromedriverProc.kill('SIGTERM')
    }
  }
}

export async function* runInspect(
  ctx: TestContext,
  plan: TestPlan,
): AsyncGenerator<TestEvent> {
  const { projectDir, mission } = ctx
  const framework = 'flutter'
  const target = mission.target.platform
  const phase = 'execute'

  // Determine wasm mode from plan steps
  const inspectStep = plan.steps.find((s) => s.command === 'flutter' && s.args?.includes('run'))
  const wasmMode = inspectStep?.args?.includes('--wasm') ?? false

  const runArgs = wasmMode ? ['run', '-d', 'chrome', '--wasm'] : ['run', '-d', 'chrome']

  let flutterProc: ChildProcess | null = null

  try {
    yield {
      type: 'suite_started',
      framework,
      target,
      phase,
      status: 'passed',
      message: `Launching: flutter ${runArgs.join(' ')}`,
    }

    flutterProc = spawn('flutter', runArgs, {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let appStarted = false
    let done = false
    const events: TestEvent[] = []

    flutterProc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      const lines = text.split('\n')

      for (const line of lines) {
        if (!line.trim()) continue

        // Detect app start
        if (!appStarted && (line.includes('is being served at') || line.includes('http://localhost'))) {
          appStarted = true
          const urlMatch = /(https?:\/\/[^\s]+)/.exec(line)
          events.push({
            type: 'test_started',
            framework,
            target,
            phase,
            status: 'passed',
            message: urlMatch
              ? `Flutter app running at ${urlMatch[1]}`
              : 'Flutter app started',
            raw: line,
          })
        } else {
          events.push({
            type: 'console_output',
            framework,
            target,
            phase,
            status: 'passed',
            message: line.trim(),
            raw: line,
          })
        }
      }
    })

    flutterProc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) {
        events.push({
          type: 'console_output',
          framework,
          target,
          phase,
          status: 'passed',
          message: `[stderr] ${text}`,
          raw: text,
        })
      }
    })

    flutterProc.on('close', (code) => {
      events.push({
        type: 'suite_finished',
        framework,
        target,
        phase,
        status: code === 0 ? 'passed' : 'failed',
        message: code === 0 ? 'Flutter run completed' : `Flutter run exited with code ${code}`,
      })
      done = true
    })

    flutterProc.on('error', (err) => {
      events.push({
        type: 'test_error',
        framework,
        target,
        phase,
        status: 'error',
        message: `flutter run process error: ${err.message}`,
      })
      done = true
    })

    // Poll events — for Phase 1, just relay console output
    // Full browser inspection is deferred to Phase 2
    while (!done || events.length > 0) {
      if (events.length > 0) {
        yield events.shift()!
      } else {
        await waitMs(50)
      }
    }
  } catch (err: unknown) {
    yield {
      type: 'test_error',
      framework,
      target,
      phase,
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
  } finally {
    if (flutterProc && !flutterProc.killed) {
      flutterProc.kill('SIGTERM')
    }
  }
}
