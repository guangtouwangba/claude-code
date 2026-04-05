/**
 * Flutter Test Planning
 *
 * Builds a TestPlan choosing the appropriate execution lane and
 * mapping acceptance points to verification methods.
 */

import type {
  TestContext,
  TestPlan,
  TestPlanStep,
  ExecutionLane,
  AssertionMode,
  VerificationMethod,
} from '../../types'

function buildDriveSteps(ctx: TestContext): TestPlanStep[] {
  const apIds = ctx.reasoningState.requirement.acceptancePoints.map((ap) => ap.id)

  return [
    {
      id: 'drive-validate-env',
      description: 'Validate flutter drive environment (chromedriver, devices)',
      lane: 'drive',
      targetAcceptancePoints: [],
    },
    {
      id: 'drive-start-chromedriver',
      description: 'Start ChromeDriver on port 4444',
      command: 'chromedriver',
      args: ['--port=4444'],
      lane: 'drive',
      targetAcceptancePoints: [],
    },
    {
      id: 'drive-run-flutter',
      description: 'Run flutter drive integration tests',
      command: 'flutter',
      args: [
        'drive',
        '--driver=test_driver/integration_test.dart',
        '--target=integration_test/app_test.dart',
        '-d',
        'chrome',
      ],
      lane: 'drive',
      targetAcceptancePoints: apIds,
    },
  ]
}

function buildInspectSteps(ctx: TestContext, wasmMode: boolean): TestPlanStep[] {
  const apIds = ctx.reasoningState.requirement.acceptancePoints.map((ap) => ap.id)
  const runArgs = wasmMode ? ['-d', 'chrome', '--wasm'] : ['-d', 'chrome']

  return [
    {
      id: 'inspect-launch-flutter',
      description: 'Launch flutter run in Chrome',
      command: 'flutter',
      args: ['run', ...runArgs],
      lane: 'inspect',
      targetAcceptancePoints: [],
    },
    {
      id: 'inspect-attach-browser',
      description: 'Attach browser inspector and capture artifacts',
      lane: 'inspect',
      targetAcceptancePoints: apIds,
    },
    {
      id: 'inspect-capture-artifacts',
      description: 'Capture screenshots and console logs',
      lane: 'inspect',
      targetAcceptancePoints: apIds,
    },
  ]
}

function buildHybridSteps(ctx: TestContext, wasmMode: boolean): TestPlanStep[] {
  const driveSteps = buildDriveSteps(ctx)
  const inspectSteps = buildInspectSteps(ctx, wasmMode).map((s) => ({
    ...s,
    id: `hybrid-fallback-${s.id}`,
    description: `[Fallback] ${s.description}`,
  }))

  return [
    ...driveSteps,
    {
      id: 'hybrid-correlate',
      description: 'Correlate drive results with inspect observations',
      lane: 'hybrid',
      targetAcceptancePoints: ctx.reasoningState.requirement.acceptancePoints.map((ap) => ap.id),
    },
    ...inspectSteps,
  ]
}

function buildAcceptancePointMapping(
  ctx: TestContext,
  primaryLane: ExecutionLane,
): Record<string, VerificationMethod> {
  const mapping: Record<string, VerificationMethod> = {}

  for (const ap of ctx.reasoningState.requirement.acceptancePoints) {
    // Use the AP's own preferred method, but override for lane compatibility
    let method = ap.verificationMethod

    if (primaryLane === 'drive') {
      // Drive lane can't do browser_inspect — fall back to flutter_native
      if (method === 'browser_inspect') {
        method = 'flutter_native'
      }
    } else if (primaryLane === 'inspect') {
      // Inspect lane can't run flutter_native assertions — use browser_inspect
      if (method === 'flutter_native') {
        method = 'browser_inspect'
      }
    }

    mapping[ap.id] = method
  }

  return mapping
}

export async function planFlutterTest(ctx: TestContext): Promise<TestPlan> {
  const { mission, reasoningState } = ctx

  // Determine primary lane from strategy or mission defaults
  const strategyLane = reasoningState.strategy.primaryLane as ExecutionLane | ''
  const wasmMode = Boolean(
    (mission as unknown as Record<string, unknown>)['wasmMode'] ??
      (reasoningState.strategy as unknown as Record<string, unknown>)['wasmMode'],
  )

  let primaryLane: ExecutionLane
  if (strategyLane === 'drive' || strategyLane === 'inspect' || strategyLane === 'hybrid') {
    primaryLane = strategyLane
  } else if (
    mission.target.platform === 'web-chrome' ||
    mission.target.platform === 'web-server'
  ) {
    primaryLane = 'drive'
  } else {
    primaryLane = 'inspect'
  }

  // Determine fallback lane
  const fallbackStrategyLane = reasoningState.strategy.fallbackLane as ExecutionLane | null
  let fallbackLane: ExecutionLane | undefined
  if (fallbackStrategyLane === 'drive' || fallbackStrategyLane === 'inspect') {
    fallbackLane = fallbackStrategyLane
  } else if (primaryLane === 'drive') {
    fallbackLane = 'inspect'
  }

  // Determine assertion mode
  let assertionMode: AssertionMode
  const strategyAssertionMode = reasoningState.strategy.assertionMode
  if (
    strategyAssertionMode === 'native-first' ||
    strategyAssertionMode === 'browser-first' ||
    strategyAssertionMode === 'hybrid'
  ) {
    assertionMode = strategyAssertionMode
  } else {
    assertionMode = primaryLane === 'drive' ? 'native-first' : 'browser-first'
  }

  // Build steps for the chosen lane
  let steps: TestPlanStep[]
  if (primaryLane === 'drive') {
    steps = buildDriveSteps(ctx)
  } else if (primaryLane === 'inspect') {
    steps = buildInspectSteps(ctx, wasmMode)
  } else {
    steps = buildHybridSteps(ctx, wasmMode)
  }

  const acceptancePointMapping = buildAcceptancePointMapping(ctx, primaryLane)

  return {
    primaryLane,
    fallbackLane,
    steps,
    assertionMode,
    acceptancePointMapping,
  }
}
