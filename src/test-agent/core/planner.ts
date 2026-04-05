/**
 * Flutter Test Agent — Strategy Planning with Memory Gates
 *
 * Plans test execution strategy by generating lane candidates, applying
 * memory-based gates (negative patterns block, positive recipes boost),
 * and building a concrete TestPlan from the selected strategy.
 */

import type {
  AcceptancePoint,
  AssertionMode,
  ExecutionLane,
  FailurePattern,
  SuccessfulRecipe,
  TestContext,
  TestPlan,
  TestPlanStep,
  VerificationMethod,
} from '../types'

// ---------------------------------------------------------------------------
// StrategyCandidate
// ---------------------------------------------------------------------------

export type StrategyCandidate = {
  id: string
  lane: ExecutionLane
  assertionMode: AssertionMode
  score: number
  blockedByMemory: boolean
  blockReason?: string
}

// ---------------------------------------------------------------------------
// Internal scoring weights
// ---------------------------------------------------------------------------

// Base scores per lane per platform
const LANE_BASE_SCORE: Record<ExecutionLane, number> = {
  drive: 0.7,
  inspect: 0.65,
  hybrid: 0.6,
}

function platformLaneBoost(lane: ExecutionLane, platform: string): number {
  switch (platform) {
    case 'web-chrome':
      // inspect is well-suited for web
      return lane === 'inspect' ? 0.1 : lane === 'hybrid' ? 0.05 : 0
    case 'android':
    case 'ios':
      // drive is better for native
      return lane === 'drive' ? 0.1 : 0
    case 'web-server':
      return lane === 'inspect' ? 0.08 : 0
    default:
      return 0
  }
}

function intentLaneBoost(lane: ExecutionLane, intentKind: string): number {
  switch (intentKind) {
    case 'flow_validation':
      return lane === 'drive' ? 0.1 : lane === 'hybrid' ? 0.05 : 0
    case 'requirement_validation':
      return lane === 'inspect' ? 0.08 : lane === 'hybrid' ? 0.1 : 0
    case 'post_fix_verification':
      return lane === 'drive' ? 0.12 : 0
    case 'exploratory_smoke':
      return lane === 'hybrid' ? 0.1 : 0
    default:
      return 0
  }
}

function assertionModeFor(lane: ExecutionLane, platform: string): AssertionMode {
  if (lane === 'hybrid') return 'hybrid'
  if (lane === 'inspect') return 'browser-first'
  if (platform === 'web-chrome' || platform === 'web-server') return 'browser-first'
  return 'native-first'
}

// ---------------------------------------------------------------------------
// generateStrategyCandidates
// ---------------------------------------------------------------------------

export function generateStrategyCandidates(ctx: TestContext): StrategyCandidate[] {
  const { platform } = ctx.mission.target
  const { kind: intentKind } = ctx.mission.intent
  const lanes: ExecutionLane[] = ['drive', 'inspect', 'hybrid']

  return lanes.map((lane): StrategyCandidate => {
    const base = LANE_BASE_SCORE[lane]
    const platformBoost = platformLaneBoost(lane, platform)
    const intentBoost = intentLaneBoost(lane, intentKind)
    const score = Math.min(1, base + platformBoost + intentBoost)
    const assertionMode = assertionModeFor(lane, platform)

    return {
      id: crypto.randomUUID(),
      lane,
      assertionMode,
      score,
      blockedByMemory: false,
    }
  })
}

// ---------------------------------------------------------------------------
// applyMemoryGates
// ---------------------------------------------------------------------------

function fingerprintMatchesCandidate(
  candidate: StrategyCandidate,
  framework: string,
  target: string,
  conditions: Record<string, string>,
  patternConditions: Record<string, string>,
): boolean {
  // Match framework and target at minimum
  if (
    patternConditions['framework'] !== undefined &&
    patternConditions['framework'] !== framework
  ) {
    return false
  }
  if (
    patternConditions['target'] !== undefined &&
    patternConditions['target'] !== target
  ) {
    return false
  }
  if (
    patternConditions['lane'] !== undefined &&
    patternConditions['lane'] !== candidate.lane
  ) {
    return false
  }
  // Check overlap of other conditions
  for (const [key, value] of Object.entries(patternConditions)) {
    if (key === 'framework' || key === 'target' || key === 'lane') continue
    if (conditions[key] !== undefined && conditions[key] !== value) {
      return false
    }
  }
  return true
}

export function applyMemoryGates(
  candidates: StrategyCandidate[],
  failurePatterns: FailurePattern[],
  recipes: SuccessfulRecipe[],
): StrategyCandidate[] {
  const framework = 'flutter'

  return candidates.map((candidate): StrategyCandidate => {
    // --- Negative memory (higher priority) ---
    for (const pattern of failurePatterns) {
      const matches = fingerprintMatchesCandidate(
        candidate,
        pattern.payload.framework,
        pattern.payload.target,
        {},
        pattern.payload.conditions,
      )
      if (matches) {
        return {
          ...candidate,
          blockedByMemory: true,
          blockReason: `Failure pattern '${pattern.payload.badAction}': ${pattern.payload.reason}`,
          score: 0,
        }
      }
    }

    // --- Positive memory (boost, but cannot override block) ---
    let boost = 0
    for (const recipe of recipes) {
      const laneMatches = recipe.payload.lane === candidate.lane
      const frameworkMatches = recipe.payload.framework === framework
      const assertionMatches = recipe.payload.assertionMode === candidate.assertionMode
      if (laneMatches && frameworkMatches && assertionMatches) {
        boost += 0.05 * recipe.confidence
      }
    }

    return {
      ...candidate,
      score: Math.min(1, candidate.score + boost),
    }
  })
}

// ---------------------------------------------------------------------------
// selectStrategy
// ---------------------------------------------------------------------------

export function selectStrategy(candidates: StrategyCandidate[]): {
  primary: StrategyCandidate
  fallback: StrategyCandidate | null
} {
  const available = candidates
    .filter((c) => !c.blockedByMemory)
    .sort((a, b) => b.score - a.score)

  if (available.length === 0) {
    // All blocked — pick the one with highest raw score as emergency primary
    const emergency = [...candidates].sort((a, b) => b.score - a.score)[0]
    if (emergency === undefined) {
      throw new Error('No strategy candidates available')
    }
    return { primary: { ...emergency, blockedByMemory: false }, fallback: null }
  }

  const primary = available[0]!
  const fallback = available[1] ?? null

  return { primary, fallback }
}

// ---------------------------------------------------------------------------
// buildTestPlan
// ---------------------------------------------------------------------------

function verificationMethodForLane(
  lane: ExecutionLane,
  dimension: string,
): VerificationMethod {
  switch (lane) {
    case 'drive':
      if (dimension === 'accessibility') return 'semantics'
      if (dimension === 'visual_structure') return 'screenshot'
      return 'flutter_native'
    case 'inspect':
      if (dimension === 'visual_structure' || dimension === 'copy') return 'screenshot'
      if (dimension === 'accessibility') return 'semantics'
      return 'browser_inspect'
    case 'hybrid':
      if (dimension === 'behavior' || dimension === 'state_transition') return 'flutter_native'
      if (dimension === 'visual_structure') return 'screenshot'
      if (dimension === 'accessibility') return 'semantics'
      return 'browser_inspect'
  }
}

export function buildTestPlan(
  ctx: TestContext,
  strategy: { primary: StrategyCandidate; fallback: StrategyCandidate | null },
): TestPlan {
  const { primary, fallback } = strategy
  const acceptancePoints: AcceptancePoint[] =
    ctx.reasoningState.requirement.acceptancePoints

  // Build acceptance point → verification method mapping
  const acceptancePointMapping: Record<string, VerificationMethod> = {}
  for (const ap of acceptancePoints) {
    // Pick verification method from primary dimension
    const primaryDimension = ap.dimensions[0] ?? 'behavior'
    acceptancePointMapping[ap.id] = verificationMethodForLane(primary.lane, primaryDimension)
  }

  // Build steps: one setup step + one step per acceptance point
  const steps: TestPlanStep[] = []

  // Setup step
  steps.push({
    id: crypto.randomUUID(),
    description: `Setup ${primary.lane} lane for ${ctx.mission.target.platform}`,
    lane: primary.lane,
    targetAcceptancePoints: [],
  })

  // Derive flow name from reasoning state
  const flowUnderTest = ctx.reasoningState.understanding.flowUnderTest || 'main_flow'

  // Group acceptance points into steps (one per AP for clear traceability)
  for (const ap of acceptancePoints) {
    const method = acceptancePointMapping[ap.id]!
    steps.push({
      id: crypto.randomUUID(),
      description: `Verify: ${ap.description}`,
      lane: primary.lane,
      targetAcceptancePoints: [ap.id],
      ...(method === 'flutter_native'
        ? {
            command: 'flutter',
            args: [
              'test',
              'integration_test/',
              '--target',
              ctx.mission.target.platform,
            ],
          }
        : method === 'browser_inspect'
          ? {
              command: 'flutter',
              args: ['drive', '--target', 'test_driver/app.dart'],
            }
          : {}),
    })
  }

  // Teardown step
  steps.push({
    id: crypto.randomUUID(),
    description: 'Collect artifacts and teardown',
    lane: primary.lane,
    targetAcceptancePoints: [],
  })

  return {
    primaryLane: primary.lane,
    fallbackLane: fallback?.lane,
    steps,
    assertionMode: primary.assertionMode,
    acceptancePointMapping,
  }
}
