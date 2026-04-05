/**
 * Flutter Test Agent — Failure Diagnosis
 *
 * Diagnoses failures from test events, classifies the failure layer,
 * creates attempt fingerprints, detects stuck states, and generates
 * structured reflections to prevent repeated mistakes.
 */

import type {
  AttemptFingerprint,
  ControlAction,
  DiagnosisResult,
  ExecutionLane,
  FailureLayer,
  FailurePattern,
  FailureReflection,
  RunMemory,
  TestContext,
  TestEvent,
  TestPlan,
} from '../types'

// ---------------------------------------------------------------------------
// diagnoseFailure
// ---------------------------------------------------------------------------

export function diagnoseFailure(events: TestEvent[], ctx: TestContext): DiagnosisResult {
  const diagnosisId = crypto.randomUUID()
  const missionId = ctx.mission.missionId

  const failureLayer = classifyFailureLayer(events, ctx)
  const evidence = extractEvidence(events, ctx)
  const invalidatedAssumptions = detectInvalidatedAssumptions(failureLayer, ctx)
  const { suggestedAction, suggestedLane } = suggestAction(failureLayer, ctx)
  const stuckDetected = detectStuck(buildCurrentFingerprint(ctx), ctx.runMemory)

  const summary = buildSummary(failureLayer, events, ctx)

  const partialDiagnosis: Omit<DiagnosisResult, 'reflection'> = {
    diagnosisId,
    missionId,
    failureLayer,
    summary,
    evidence,
    invalidatedAssumptions,
    suggestedAction,
    suggestedLane,
    stuckDetected,
  }

  const reflection = createFailureReflection(partialDiagnosis, ctx)

  return {
    diagnosisId,
    missionId,
    failureLayer,
    summary,
    evidence,
    invalidatedAssumptions,
    suggestedAction,
    suggestedLane,
    stuckDetected,
    reflection,
  }
}

// ---------------------------------------------------------------------------
// classifyFailureLayer — internal
// ---------------------------------------------------------------------------

function classifyFailureLayer(events: TestEvent[], ctx: TestContext): FailureLayer {
  // Check for environment failures first
  for (const event of events) {
    const msg = (event.message ?? '').toLowerCase()
    const raw = (event.raw ?? '').toLowerCase()
    const combined = msg + ' ' + raw

    if (
      combined.includes('flutter not found') ||
      combined.includes('chrome not found') ||
      combined.includes('chromedriver not found') ||
      combined.includes('sdk not found') ||
      combined.includes('command not found') ||
      combined.includes('no such file or directory') ||
      combined.includes('flutter: command not found')
    ) {
      return 'environment'
    }

    if (
      combined.includes('failed to start') ||
      combined.includes('app failed to launch') ||
      combined.includes('launch failed') ||
      combined.includes('could not start the app') ||
      combined.includes('unable to launch')
    ) {
      return 'launch'
    }

    // Backend dependency failures (HTTP errors)
    if (
      combined.includes('401') ||
      combined.includes('403') ||
      combined.includes('500') ||
      combined.includes('502') ||
      combined.includes('503') ||
      combined.includes('http error') ||
      combined.includes('connection refused') ||
      combined.includes('network error') ||
      combined.includes('econnrefused')
    ) {
      return 'backend_dependency'
    }

    // Missing credentials / input
    if (
      combined.includes('credentials') ||
      combined.includes('login required') ||
      combined.includes('authentication required') ||
      combined.includes('missing env') ||
      combined.includes('api key') ||
      combined.includes('token required')
    ) {
      return 'missing_input'
    }

    // Interaction failures
    if (
      combined.includes('element not found') ||
      combined.includes('widget not found') ||
      combined.includes('timed out waiting') ||
      combined.includes('timeout') ||
      combined.includes('no element') ||
      combined.includes('could not find a widget')
    ) {
      return 'interaction'
    }

    // Assertion failures
    if (
      combined.includes('expectation failed') ||
      combined.includes('assertion failed') ||
      combined.includes('expected') ||
      combined.includes('expect(') ||
      combined.includes('matcher')
    ) {
      return 'assertion'
    }
  }

  // Check events with failed/error status
  const failedEvents = events.filter((e) => e.status === 'failed' || e.status === 'error')
  if (failedEvents.length === 0 && events.length === 0) {
    // No events at all — likely environment or launch issue
    return 'environment'
  }

  // Infer from missing input check in reasoning state
  if (ctx.reasoningState.understanding.missingInputs.length > 0) {
    return 'missing_input'
  }

  // Default to assertion if tests ran but failed
  if (failedEvents.length > 0) {
    return 'assertion'
  }

  return 'environment'
}

// ---------------------------------------------------------------------------
// extractEvidence — internal
// ---------------------------------------------------------------------------

function extractEvidence(events: TestEvent[], ctx: TestContext): string[] {
  const evidence: string[] = []

  for (const event of events) {
    if (event.message !== undefined && event.message.trim().length > 0) {
      evidence.push(`[${event.type}/${event.status}] ${event.message}`)
    }
    if (event.artifactPaths !== undefined) {
      for (const p of event.artifactPaths) {
        evidence.push(`artifact: ${p}`)
      }
    }
  }

  // Include observations from run memory
  for (const obs of ctx.runMemory.observations) {
    evidence.push(`observation: ${obs}`)
  }

  // Include existing failures
  for (const f of ctx.reasoningState.evidence.failures) {
    evidence.push(`prior_failure: ${f}`)
  }

  return evidence
}

// ---------------------------------------------------------------------------
// detectInvalidatedAssumptions — internal
// ---------------------------------------------------------------------------

function detectInvalidatedAssumptions(
  failureLayer: FailureLayer,
  ctx: TestContext,
): string[] {
  const invalidated: string[] = []
  const safe = ctx.reasoningState.understanding.safeAssumptions

  switch (failureLayer) {
    case 'environment':
      invalidated.push(...safe.filter((a) => a.includes('installed') || a.includes('available')))
      break
    case 'launch':
      invalidated.push(...safe.filter((a) => a.includes('pubspec') || a.includes('dependencies')))
      break
    case 'backend_dependency':
      invalidated.push(...safe.filter((a) => a.includes('backend') || a.includes('server')))
      break
    case 'missing_input':
      invalidated.push(...safe.filter((a) => a.includes('credentials') || a.includes('api key')))
      break
    case 'interaction':
      invalidated.push(...safe.filter((a) => a.includes('widget') || a.includes('element')))
      break
    case 'assertion':
      // Assertion failures don't typically invalidate environment assumptions
      break
    case 'requirement_source_mismatch':
      invalidated.push(...safe.filter((a) => a.includes('requirement') || a.includes('spec')))
      break
  }

  return invalidated
}

// ---------------------------------------------------------------------------
// suggestAction — internal
// ---------------------------------------------------------------------------

function suggestAction(
  failureLayer: FailureLayer,
  ctx: TestContext,
): { suggestedAction: ControlAction; suggestedLane?: ExecutionLane } {
  const currentLane = ctx.reasoningState.strategy.primaryLane as ExecutionLane

  switch (failureLayer) {
    case 'environment':
      return { suggestedAction: 'stop_with_blocker' }

    case 'launch':
      return { suggestedAction: 'stop_with_blocker' }

    case 'missing_input':
      return { suggestedAction: 'stop_with_blocker' }

    case 'backend_dependency':
      return { suggestedAction: 'stop_with_blocker' }

    case 'interaction': {
      // Try switching lanes if possible
      const nextLane = currentLane === 'drive' ? 'inspect' : 'drive'
      const canSwitch =
        ctx.budget.currentLaneSwitches < ctx.budget.maxLaneSwitchesPerMission
      return canSwitch
        ? { suggestedAction: 'switch_lane', suggestedLane: nextLane }
        : { suggestedAction: 'stop_with_result' }
    }

    case 'assertion': {
      // Downgrade scope or retry with different assertion mode
      const attempts = ctx.budget.currentAttempts
      const maxAttempts = ctx.budget.maxAttemptsPerMission
      if (attempts < maxAttempts - 1) {
        return { suggestedAction: 'downgrade_scope' }
      }
      return { suggestedAction: 'stop_with_result' }
    }

    case 'requirement_source_mismatch':
      return { suggestedAction: 'stop_with_result' }

    default:
      return { suggestedAction: 'stop_with_result' }
  }
}

// ---------------------------------------------------------------------------
// buildSummary — internal
// ---------------------------------------------------------------------------

function buildSummary(
  failureLayer: FailureLayer,
  events: TestEvent[],
  ctx: TestContext,
): string {
  const failedCount = events.filter((e) => e.status === 'failed' || e.status === 'error').length
  const totalCount = events.length
  const platform = ctx.mission.target.platform
  const lane = ctx.reasoningState.strategy.primaryLane

  switch (failureLayer) {
    case 'environment':
      return `Environment failure on ${platform}: required tools not found or not configured. ` +
        `${totalCount === 0 ? 'No test events received.' : `${failedCount}/${totalCount} events failed.`}`
    case 'launch':
      return `App launch failure on ${platform} via ${lane} lane. ` +
        `The application could not start. ${failedCount}/${totalCount} events failed.`
    case 'interaction':
      return `Interaction failure: element or widget not found during ${lane} lane execution. ` +
        `${failedCount}/${totalCount} events failed.`
    case 'assertion':
      return `Assertion failure: test expectations not met during ${lane} lane execution. ` +
        `${failedCount}/${totalCount} events failed.`
    case 'backend_dependency':
      return `Backend dependency failure: HTTP errors or connection refused during ${lane} execution. ` +
        `${failedCount}/${totalCount} events failed.`
    case 'missing_input':
      return `Missing required input: credentials, API keys, or environment variables not provided. ` +
        `Cannot proceed without operator input.`
    case 'requirement_source_mismatch':
      return `Requirement source mismatch: test results do not align with provided specification.`
    default:
      return `Unknown failure layer. ${failedCount}/${totalCount} events failed.`
  }
}

// ---------------------------------------------------------------------------
// buildCurrentFingerprint — internal helper
// ---------------------------------------------------------------------------

function buildCurrentFingerprint(ctx: TestContext): AttemptFingerprint {
  return {
    adapter: 'flutter',
    framework: ctx.mission.target.appType,
    target: ctx.mission.target.platform,
    lane: ctx.reasoningState.strategy.primaryLane,
    flow: ctx.reasoningState.understanding.flowUnderTest || 'unknown',
    commandFamily: ctx.reasoningState.strategy.primaryLane,
    assertionMode: ctx.reasoningState.strategy.assertionMode,
    environmentKey: ctx.mission.target.platform,
  }
}

// ---------------------------------------------------------------------------
// createAttemptFingerprint
// ---------------------------------------------------------------------------

export function createAttemptFingerprint(ctx: TestContext, plan: TestPlan): AttemptFingerprint {
  const flow = ctx.reasoningState.understanding.flowUnderTest || 'unknown_flow'

  // commandFamily derived from the first command-bearing step
  const commandStep = plan.steps.find((s) => s.command !== undefined)
  const commandFamily = commandStep?.command ?? plan.primaryLane

  // environmentKey: combination of platform and OS-level facts
  const environmentKey = [
    ctx.mission.target.platform,
    ctx.mission.target.appType,
  ].join('_')

  return {
    adapter: 'flutter',
    framework: ctx.mission.target.appType,
    target: ctx.mission.target.platform,
    lane: plan.primaryLane,
    flow,
    commandFamily,
    assertionMode: plan.assertionMode,
    environmentKey,
  }
}

// ---------------------------------------------------------------------------
// matchesFailurePattern
// ---------------------------------------------------------------------------

export function matchesFailurePattern(
  fingerprint: AttemptFingerprint,
  patterns: FailurePattern[],
): FailurePattern | null {
  for (const pattern of patterns) {
    const p = pattern.payload

    // Must match adapter-level framework and target
    if (p.framework !== fingerprint.framework) continue
    if (p.target !== fingerprint.target) continue

    // Check lane if specified in conditions
    if (p.conditions['lane'] !== undefined && p.conditions['lane'] !== fingerprint.lane) {
      continue
    }

    // Check assertionMode if specified
    if (
      p.conditions['assertionMode'] !== undefined &&
      p.conditions['assertionMode'] !== fingerprint.assertionMode
    ) {
      continue
    }

    // Check commandFamily if specified
    if (
      p.conditions['commandFamily'] !== undefined &&
      p.conditions['commandFamily'] !== fingerprint.commandFamily
    ) {
      continue
    }

    // Check environmentKey if specified
    if (
      p.conditions['environmentKey'] !== undefined &&
      p.conditions['environmentKey'] !== fingerprint.environmentKey
    ) {
      continue
    }

    // Pattern matches
    return pattern
  }

  return null
}

// ---------------------------------------------------------------------------
// createFailureReflection
// ---------------------------------------------------------------------------

export function createFailureReflection(
  diagnosis: Omit<DiagnosisResult, 'reflection'>,
  ctx: TestContext,
): FailureReflection {
  const fingerprintKey = [
    diagnosis.failureLayer,
    ctx.mission.target.platform,
    ctx.reasoningState.strategy.primaryLane,
    ctx.reasoningState.strategy.assertionMode,
  ].join(':')

  const invalidatedAssumption =
    diagnosis.invalidatedAssumptions.length > 0
      ? diagnosis.invalidatedAssumptions[0]!
      : 'No specific assumption invalidated'

  const newEvidence = diagnosis.evidence.slice(0, 5) // cap to top 5 evidence items

  const nextStrategy = buildNextStrategyDescription(
    diagnosis.suggestedAction,
    diagnosis.suggestedLane,
    diagnosis.failureLayer,
    ctx,
  )

  // Persist to failure memory for environment/launch/backend failures (persistent blockers)
  const persistToFailureMemory = (
    diagnosis.failureLayer === 'environment' ||
    diagnosis.failureLayer === 'launch' ||
    diagnosis.failureLayer === 'backend_dependency' ||
    diagnosis.failureLayer === 'missing_input'
  )

  return {
    failureFingerprint: fingerprintKey,
    likelyLayer: diagnosis.failureLayer,
    invalidatedAssumption,
    newEvidence,
    nextStrategy,
    persistToFailureMemory,
  }
}

// ---------------------------------------------------------------------------
// buildNextStrategyDescription — internal
// ---------------------------------------------------------------------------

function buildNextStrategyDescription(
  suggestedAction: ControlAction,
  suggestedLane: ExecutionLane | undefined,
  failureLayer: FailureLayer,
  ctx: TestContext,
): string {
  switch (suggestedAction) {
    case 'switch_lane':
      return `Switch to '${suggestedLane ?? 'inspect'}' lane to work around ${failureLayer} failure`
    case 'downgrade_scope':
      return `Downgrade validation scope (disable visual/accessibility checks) and retry`
    case 'stop_with_blocker':
      return `Stop mission — ${failureLayer} is a hard blocker requiring operator intervention`
    case 'stop_with_result':
      return `Stop mission and report partial results — ${failureLayer} failure after exhausting retries`
    case 'commit_next_strategy':
      return `Commit next candidate strategy from the ranked hypothesis list`
    default:
      return `No further automated action available for ${failureLayer}`
  }
}

// ---------------------------------------------------------------------------
// detectStuck
// ---------------------------------------------------------------------------

export function detectStuck(
  currentFingerprint: AttemptFingerprint,
  runMemory: RunMemory,
): boolean {
  // Check if the exact same fingerprint already failed in this run
  let failCount = 0
  for (const fp of runMemory.failedFingerprints) {
    if (
      fp.adapter === currentFingerprint.adapter &&
      fp.framework === currentFingerprint.framework &&
      fp.target === currentFingerprint.target &&
      fp.lane === currentFingerprint.lane &&
      fp.flow === currentFingerprint.flow &&
      fp.commandFamily === currentFingerprint.commandFamily &&
      fp.assertionMode === currentFingerprint.assertionMode &&
      fp.environmentKey === currentFingerprint.environmentKey
    ) {
      failCount++
    }
  }

  if (failCount >= 2) {
    return true
  }

  // Check if no new evidence since last attempt
  // "New evidence" means new observations were added since the last failed attempt
  const totalAttempts = runMemory.attemptedFingerprints.length
  if (totalAttempts >= 2 && runMemory.observations.length === 0) {
    return true
  }

  // Check for equivalent command families under equivalent conditions
  if (runMemory.failedFingerprints.length >= 1) {
    const lastFailed = runMemory.failedFingerprints[runMemory.failedFingerprints.length - 1]!
    const sameConditions =
      lastFailed.commandFamily === currentFingerprint.commandFamily &&
      lastFailed.environmentKey === currentFingerprint.environmentKey &&
      lastFailed.assertionMode === currentFingerprint.assertionMode
    if (sameConditions) {
      return true
    }
  }

  return false
}
