/**
 * Flutter Test Agent — CLI Entry Point
 *
 * Registers the `test-agent` subcommand and orchestrates mission execution.
 */

import type { Command } from 'commander'
import * as path from 'node:path'
import * as fs from 'node:fs'

import type {
  TestAgentCliOptions,
  ExecutionLane,
  TestAdapter,
  TestMission,
  TestSummary,
  ProjectMemory,
  AcceptancePoint,
  TestContext,
  TestEvent,
  TestPlan,
  TestArtifacts,
  InterpretedMission,
  PreflightResult,
} from './types'
import { STORAGE_PATHS, MEMORY_FILES } from './types'
import { MissionTracer } from './core/events'
import { interpretRequest } from './core/interpret'
import { MissionRunner } from './core/runner'
import { generateJsonReport } from './reporting/jsonReport'
import { generateJunitReport } from './reporting/junitReport'

// Flutter adapter imports
import { detectFlutterProject } from './adapters/flutter/detect'
import { interpretFlutterMission } from './adapters/flutter/interpret'
import { extractAcceptancePoints } from './adapters/flutter/extractAcceptancePoints'
import { preflightFlutter } from './adapters/flutter/preflight'
import { planFlutterTest } from './adapters/flutter/plan'
import { runDrive, runInspect } from './adapters/flutter/runDrive'
import { collectFlutterArtifacts } from './adapters/flutter/collectArtifacts'

/**
 * Assemble the Flutter TestAdapter from individual module functions.
 */
function createFlutterAdapter(): TestAdapter {
  return {
    name: 'flutter',

    async detect(projectDir: string): Promise<boolean> {
      const result = await detectFlutterProject(projectDir)
      return result.detected
    },

    async interpret(mission: TestMission): Promise<InterpretedMission> {
      return interpretFlutterMission(mission)
    },

    async preflight(ctx: TestContext): Promise<PreflightResult> {
      return preflightFlutter(ctx)
    },

    async extractAcceptancePoints(ctx: TestContext): Promise<AcceptancePoint[]> {
      return extractAcceptancePoints(ctx)
    },

    async plan(ctx: TestContext): Promise<TestPlan> {
      return planFlutterTest(ctx)
    },

    async *run(ctx: TestContext, plan: TestPlan): AsyncGenerator<TestEvent> {
      const lane = plan.primaryLane
      if (lane === 'drive') {
        yield* runDrive(ctx, plan)
      } else if (lane === 'inspect') {
        yield* runInspect(ctx, plan)
      } else {
        // hybrid: run drive first, then inspect on failure
        let driveFailed = false
        try {
          for await (const event of runDrive(ctx, plan)) {
            yield event
            if (event.status === 'failed' || event.status === 'error') {
              driveFailed = true
            }
          }
        } catch {
          driveFailed = true
        }
        if (driveFailed) {
          yield* runInspect(ctx, plan)
        }
      }
    },

    async collectArtifacts(ctx: TestContext): Promise<TestArtifacts> {
      return collectFlutterArtifacts(ctx)
    },

    async summarize(ctx: TestContext, events: TestEvent[]): Promise<TestSummary> {
      const passed = events.filter((e) => e.status === 'passed').length
      const failed = events.filter((e) => e.status === 'failed').length
      const skipped = events.filter((e) => e.status === 'skipped').length
      const total = passed + failed + skipped
      const duration = events.reduce((sum, e) => sum + (e.duration ?? 0), 0)
      const artifacts = await collectFlutterArtifacts(ctx)

      return {
        framework: 'flutter',
        mode: ctx.reasoningState.strategy.primaryLane as ExecutionLane,
        target: ctx.mission.target.platform,
        intent: ctx.mission.intent.kind,
        passed: failed === 0 && total > 0,
        totalTests: total,
        passedTests: passed,
        failedTests: failed,
        skippedTests: skipped,
        duration,
        artifacts,
        requirementSource: ctx.mission.requirementSource,
        acceptancePoints: ctx.reasoningState.requirement.acceptancePoints,
      }
    },
  }
}

/**
 * Load project memory from disk, or return empty memory if not found.
 */
function loadProjectMemory(baseDir: string): ProjectMemory {
  const empty: ProjectMemory = {
    facts: [],
    failurePatterns: [],
    successfulRecipes: [],
    blockedInputs: [],
    decisionRecords: [],
  }

  const memoryDir = path.join(baseDir, STORAGE_PATHS.memory)
  if (!fs.existsSync(memoryDir)) {
    return empty
  }

  const loadJsonl = (filePath: string) => {
    const fullPath = path.join(baseDir, filePath)
    if (!fs.existsSync(fullPath)) return []
    try {
      return fs
        .readFileSync(fullPath, 'utf-8')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line))
    } catch {
      return []
    }
  }

  const loadJson = (filePath: string) => {
    const fullPath = path.join(baseDir, filePath)
    if (!fs.existsSync(fullPath)) return []
    try {
      return JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
    } catch {
      return []
    }
  }

  return {
    facts: loadJson(MEMORY_FILES.projectFacts),
    failurePatterns: loadJsonl(MEMORY_FILES.failurePatterns),
    successfulRecipes: loadJsonl(MEMORY_FILES.successfulRecipes),
    blockedInputs: loadJsonl(MEMORY_FILES.blockedInputs),
    decisionRecords: loadJsonl(MEMORY_FILES.decisionRecords),
  }
}

/**
 * Run the test agent with the given options.
 */
async function runTestAgent(
  goal: string,
  opts: TestAgentCliOptions,
): Promise<void> {
  const projectDir = path.resolve(opts.project)

  // Interpret user request into a mission
  const mission = await interpretRequest(goal, projectDir)

  // Override mission fields from explicit CLI options
  if (opts.target !== 'auto') {
    mission.target.platform = opts.target as TestMission['target']['platform']
  }
  if (opts.mode !== 'hybrid') {
    mission.scope.verifyBehavior = true
  }
  if (opts.requirement) {
    mission.requirementSource = {
      type: 'markdown',
      path: path.resolve(opts.requirement),
      isAuthoritative: true,
    }
  }
  if (opts.maxAttempts) {
    // Budget override handled by runner
  }

  // Select adapter
  const adapter = createFlutterAdapter()
  const detected = await adapter.detect(projectDir)
  if (!detected && opts.framework === 'auto') {
    console.error(
      'Error: Could not detect a Flutter project in ' + projectDir,
    )
    console.error('Use --framework flutter to force Flutter mode.')
    process.exit(1)
  }

  // Set up tracer and memory
  const tracer = new MissionTracer(mission.missionId, projectDir)
  const memory = loadProjectMemory(projectDir)

  // Create and run the mission
  const runner = new MissionRunner(mission, adapter, tracer, memory, projectDir)

  if (opts.maxAttempts) {
    runner.budget.maxAttemptsPerMission = opts.maxAttempts
  }

  const summary = await runner.run()

  // Output result
  switch (opts.outputFormat) {
    case 'junit':
      console.log(generateJunitReport(summary))
      break
    case 'json':
      console.log(generateJsonReport(summary))
      break
    case 'text':
    default:
      printTextSummary(summary)
      break
  }

  // Exit with appropriate code
  process.exit(summary.passed ? 0 : 1)
}

/**
 * Print a human-readable text summary.
 */
function printTextSummary(summary: TestSummary): void {
  const statusIcon = summary.passed ? '\u2713' : '\u2717'
  const statusText = summary.passed ? 'PASSED' : 'FAILED'

  console.log('')
  console.log(`${statusIcon} ${statusText}`)
  console.log(`  Framework: ${summary.framework}`)
  console.log(`  Mode:      ${summary.mode}`)
  console.log(`  Target:    ${summary.target}`)
  console.log(`  Duration:  ${(summary.duration / 1000).toFixed(1)}s`)
  console.log(
    `  Tests:     ${summary.passedTests} passed, ${summary.failedTests} failed, ${summary.skippedTests} skipped (${summary.totalTests} total)`,
  )

  if (summary.acceptancePoints && summary.acceptancePoints.length > 0) {
    console.log('')
    console.log('Acceptance Points:')
    for (const ap of summary.acceptancePoints) {
      const icon =
        ap.verificationStatus === 'matched'
          ? '\u2713'
          : ap.verificationStatus === 'mismatched'
            ? '\u2717'
            : '\u25cb'
      console.log(`  ${icon} ${ap.id}: ${ap.description}`)
      if (ap.reason) {
        console.log(`    ${ap.reason}`)
      }
      if (ap.evidence && ap.evidence.length > 0) {
        console.log(`    Evidence: ${ap.evidence.join(', ')}`)
      }
    }
  }

  if (summary.artifacts) {
    const artifactCount =
      summary.artifacts.screenshots.length +
      summary.artifacts.consoleLogs.length +
      summary.artifacts.semanticsSnapshots.length +
      summary.artifacts.flutterTestLogs.length
    if (artifactCount > 0) {
      console.log('')
      console.log(`Artifacts: ${artifactCount} files collected`)
    }
  }

  console.log('')
}

/**
 * Register the test-agent subcommand on a Commander program.
 */
export function registerTestAgentCommand(program: Command): void {
  program
    .command('test-agent [goal]')
    .description(
      'Run the test agent to validate a Flutter project against requirements or test flows.',
    )
    .option(
      '-f, --framework <framework>',
      'Framework to test (auto-detected if not specified)',
      'auto',
    )
    .option(
      '-t, --target <target>',
      'Target platform: web-chrome, web-server, android, ios',
      'auto',
    )
    .option(
      '-m, --mode <mode>',
      'Execution mode: drive, inspect, hybrid',
      'hybrid',
    )
    .option(
      '-p, --project <dir>',
      'Project directory (defaults to cwd)',
      process.cwd(),
    )
    .option('--wasm', 'Use skwasm/wasm renderer', false)
    .option('--headless', 'Run in headless mode (web-server)', false)
    .option(
      '-r, --requirement <path>',
      'Path to requirement document for validation',
    )
    .option(
      '--max-attempts <n>',
      'Maximum execution attempts',
      (v: string) => parseInt(v, 10),
    )
    .option(
      '-o, --output-format <format>',
      'Output format: json, junit, text',
      'text',
    )
    .action(
      async (
        goal: string | undefined,
        options: Record<string, unknown>,
      ) => {
        const opts: TestAgentCliOptions = {
          framework: (options.framework as string) ?? 'auto',
          target: (options.target as string) ?? 'auto',
          mode: (options.mode as ExecutionLane) ?? 'hybrid',
          project: (options.project as string) ?? process.cwd(),
          wasm: (options.wasm as boolean) ?? false,
          headless: (options.headless as boolean) ?? false,
          requirement: options.requirement as string | undefined,
          maxAttempts: options.maxAttempts as number | undefined,
          outputFormat:
            (options.outputFormat as 'json' | 'junit' | 'text') ?? 'text',
        }

        const userGoal = goal ?? 'run tests'

        await runTestAgent(userGoal, opts)
      },
    )
}
