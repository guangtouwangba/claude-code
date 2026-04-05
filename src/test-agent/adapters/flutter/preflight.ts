/**
 * Flutter Environment Preflight Checks
 *
 * Validates that all required tools and files are present before
 * attempting test execution.
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TestContext, PreflightResult, PreflightCheck } from '../../types'

function runCommand(cmd: string): { output: string; success: boolean } {
  try {
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    return { output, success: true }
  } catch (err: unknown) {
    const output =
      err instanceof Error && 'stdout' in err
        ? String((err as NodeJS.ErrnoException & { stdout?: unknown }).stdout ?? '')
        : ''
    return { output, success: false }
  }
}

function checkFlutterInstalled(): PreflightCheck {
  const { output, success } = runCommand('flutter --version')
  if (success && output.includes('Flutter')) {
    return {
      name: 'flutter_installed',
      status: 'passed',
      message: `Flutter installed: ${output.split('\n')[0].trim()}`,
      blocksExecution: false,
    }
  }
  return {
    name: 'flutter_installed',
    status: 'failed',
    message: 'Flutter is not installed or not in PATH. Install from https://flutter.dev',
    blocksExecution: true,
  }
}

function checkFlutterDoctor(): PreflightCheck {
  const { output, success } = runCommand('flutter doctor --verbose')
  if (!success && !output) {
    return {
      name: 'flutter_doctor',
      status: 'warning',
      message: 'Could not run flutter doctor',
      blocksExecution: false,
    }
  }

  const fatalIssues: string[] = []
  for (const line of output.split('\n')) {
    // [!] indicates a warning/issue, [✗] indicates a fatal error
    if (line.includes('[✗]') || line.includes('[✗]')) {
      fatalIssues.push(line.trim())
    }
  }

  if (fatalIssues.length > 0) {
    return {
      name: 'flutter_doctor',
      status: 'warning',
      message: `Flutter doctor found issues:\n${fatalIssues.slice(0, 3).join('\n')}`,
      blocksExecution: false,
    }
  }

  return {
    name: 'flutter_doctor',
    status: 'passed',
    message: 'flutter doctor reports no fatal issues',
    blocksExecution: false,
  }
}

function checkChromeDevice(): PreflightCheck {
  const { output, success } = runCommand('flutter devices')
  if (!success) {
    return {
      name: 'chrome_device',
      status: 'failed',
      message: 'Could not list flutter devices',
      blocksExecution: true,
    }
  }

  const hasChromeDevice =
    output.toLowerCase().includes('chrome') || output.toLowerCase().includes('web')

  if (hasChromeDevice) {
    return {
      name: 'chrome_device',
      status: 'passed',
      message: 'Chrome (web) device is available',
      blocksExecution: false,
    }
  }

  return {
    name: 'chrome_device',
    status: 'failed',
    message:
      'Chrome device not available. Ensure Chrome is installed and flutter has web support enabled (`flutter config --enable-web`).',
    blocksExecution: true,
  }
}

function checkChromedriver(): PreflightCheck {
  const { output, success } = runCommand('chromedriver --version')
  if (success && output.toLowerCase().includes('chromedriver')) {
    return {
      name: 'chromedriver',
      status: 'passed',
      message: `ChromeDriver installed: ${output.split('\n')[0].trim()}`,
      blocksExecution: false,
    }
  }
  return {
    name: 'chromedriver',
    status: 'failed',
    message:
      'chromedriver is not installed or not in PATH. Install via `npm install -g chromedriver` or your package manager.',
    blocksExecution: true,
  }
}

function checkIntegrationTestDir(projectDir: string): PreflightCheck {
  const integrationTestDir = join(projectDir, 'integration_test')
  if (existsSync(integrationTestDir)) {
    return {
      name: 'integration_test_dir',
      status: 'passed',
      message: 'integration_test/ directory exists',
      blocksExecution: false,
    }
  }
  return {
    name: 'integration_test_dir',
    status: 'failed',
    message:
      'integration_test/ directory not found. Create it and add integration tests before running flutter drive.',
    blocksExecution: true,
  }
}

function checkDriverFile(projectDir: string): PreflightCheck {
  const driverFile = join(projectDir, 'test_driver', 'integration_test.dart')
  if (existsSync(driverFile)) {
    return {
      name: 'driver_file',
      status: 'passed',
      message: 'test_driver/integration_test.dart exists',
      blocksExecution: false,
    }
  }
  return {
    name: 'driver_file',
    status: 'failed',
    message:
      'test_driver/integration_test.dart not found. This file is required for flutter drive.',
    blocksExecution: true,
  }
}

function checkSemanticsEnabled(projectDir: string): PreflightCheck {
  const mainDartPath = join(projectDir, 'lib', 'main.dart')
  if (!existsSync(mainDartPath)) {
    return {
      name: 'semantics_enabled',
      status: 'warning',
      message: 'lib/main.dart not found; could not verify semantics setup',
      blocksExecution: false,
    }
  }

  try {
    const content = readFileSync(mainDartPath, 'utf-8')
    if (content.includes('ensureSemantics') || content.includes('SemanticsBinding')) {
      return {
        name: 'semantics_enabled',
        status: 'passed',
        message: 'Semantics appear to be enabled in main.dart',
        blocksExecution: false,
      }
    }
    return {
      name: 'semantics_enabled',
      status: 'warning',
      message:
        'ensureSemantics() not found in main.dart. Accessibility checks may be unreliable.',
      blocksExecution: false,
    }
  } catch {
    return {
      name: 'semantics_enabled',
      status: 'warning',
      message: 'Could not read main.dart to verify semantics',
      blocksExecution: false,
    }
  }
}

export async function preflightFlutter(ctx: TestContext): Promise<PreflightResult> {
  const { projectDir, mission } = ctx
  const isDriveLane =
    mission.target.platform === 'web-chrome' || mission.target.platform === 'web-server'
  const isInspectLane = mission.mode === 'guided'
  const checks: PreflightCheck[] = []

  // 1. Flutter installed
  const flutterCheck = checkFlutterInstalled()
  checks.push(flutterCheck)

  // If flutter isn't installed, skip the rest
  if (flutterCheck.status === 'failed') {
    return {
      canProceed: false,
      checks,
      fallbackLane: undefined,
    }
  }

  // 2. Flutter doctor
  checks.push(checkFlutterDoctor())

  // 3. Chrome device available (for web targets)
  if (isDriveLane || mission.target.platform === 'web-chrome') {
    checks.push(checkChromeDevice())
  }

  // 4. Chromedriver for drive mode
  if (isDriveLane) {
    checks.push(checkChromedriver())
  }

  // 5. integration_test/ directory for drive mode
  if (isDriveLane) {
    checks.push(checkIntegrationTestDir(projectDir))
  }

  // 6. test_driver/integration_test.dart for drive mode
  if (isDriveLane) {
    checks.push(checkDriverFile(projectDir))
  }

  // 7. Semantics for inspect mode
  if (isInspectLane || mission.scope.verifyAccessibility) {
    checks.push(checkSemanticsEnabled(projectDir))
  }

  const blockingFailures = checks.filter((c) => c.status === 'failed' && c.blocksExecution)
  const canProceed = blockingFailures.length === 0

  // Suggest fallback lane if drive lane has failures
  let fallbackLane: string | undefined
  if (!canProceed && isDriveLane) {
    // If drive lane fails, suggest inspect as fallback
    const driveCriticalChecks = ['chromedriver', 'integration_test_dir', 'driver_file']
    const driveFailed = blockingFailures.some((c) => driveCriticalChecks.includes(c.name))
    if (driveFailed) {
      fallbackLane = 'inspect'
    }
  }

  return {
    canProceed,
    checks,
    fallbackLane,
  }
}
