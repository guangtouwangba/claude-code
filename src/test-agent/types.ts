/**
 * Flutter Test Agent — Type Definitions
 *
 * All types defined in the design document for the test agent system.
 * Covers mission model, acceptance points, adapter contract, state machine,
 * event sourcing, decision logging, memory, and reporting.
 */

// ---------------------------------------------------------------------------
// Mission Model
// ---------------------------------------------------------------------------

export type TestMission = {
  missionId: string
  userRequest: string
  mode: MissionMode
  intent: {
    kind: MissionIntentKind
    confidence: number
  }
  requirementSource: RequirementSource
  target: {
    appType: AppType
    platform: TargetPlatform
  }
  scope: ValidationScope
}

export type MissionMode = 'full-auto' | 'guided' | 'operator'

export type MissionIntentKind =
  | 'flow_validation'
  | 'requirement_validation'
  | 'post_fix_verification'
  | 'exploratory_smoke'

export type RequirementSource = {
  type: RequirementSourceType
  path?: string
  content?: string
  isAuthoritative: boolean
}

export type RequirementSourceType =
  | 'inline'
  | 'markdown'
  | 'prd'
  | 'issue'
  | 'unknown'

export type AppType = 'flutter' | 'unknown'

export type TargetPlatform =
  | 'web-chrome'
  | 'web-server'
  | 'android'
  | 'ios'
  | 'unknown'

export type ValidationScope = {
  verifyBehavior: boolean
  verifyVisualStructure: boolean
  verifyContent: boolean
  verifyAccessibility: boolean
}

// ---------------------------------------------------------------------------
// Acceptance Points
// ---------------------------------------------------------------------------

export type VerificationDimension =
  | 'behavior'
  | 'visual_structure'
  | 'copy'
  | 'state_transition'
  | 'error_handling'
  | 'accessibility'

export type VerificationStatus =
  | 'pending'
  | 'matched'
  | 'mismatched'
  | 'unverified'

export type VerificationMethod =
  | 'flutter_native'
  | 'browser_inspect'
  | 'screenshot'
  | 'semantics'
  | 'manual_input_required'

export type AcceptancePoint = {
  id: string
  description: string
  dimensions: VerificationDimension[]
  verificationStatus: VerificationStatus
  verificationMethod: VerificationMethod
  reason?: string
  evidence?: string[]
}

// ---------------------------------------------------------------------------
// Adapter Contract
// ---------------------------------------------------------------------------

export type TestContext = {
  mission: TestMission
  projectDir: string
  workingDir: string
  reasoningState: ReasoningState
  budget: MissionBudget
  runMemory: RunMemory
}

export type InterpretedMission = {
  mission: TestMission
  acceptancePoints: AcceptancePoint[]
  inferredDetails: Record<string, unknown>
}

export type PreflightCheck = {
  name: string
  status: 'passed' | 'failed' | 'warning'
  message: string
  blocksExecution: boolean
}

export type PreflightResult = {
  canProceed: boolean
  checks: PreflightCheck[]
  fallbackLane?: string
  reducedScope?: Partial<ValidationScope>
}

export type TestPlan = {
  primaryLane: ExecutionLane
  fallbackLane?: ExecutionLane
  steps: TestPlanStep[]
  assertionMode: AssertionMode
  acceptancePointMapping: Record<string, VerificationMethod>
}

export type ExecutionLane = 'drive' | 'inspect' | 'hybrid'

export type AssertionMode = 'native-first' | 'browser-first' | 'hybrid'

export type TestPlanStep = {
  id: string
  description: string
  command?: string
  args?: string[]
  lane: ExecutionLane
  targetAcceptancePoints: string[]
}

export type TestEventType =
  | 'test_started'
  | 'test_passed'
  | 'test_failed'
  | 'test_skipped'
  | 'test_error'
  | 'suite_started'
  | 'suite_finished'
  | 'artifact_captured'
  | 'console_output'
  | 'network_event'

export type TestEvent = {
  type: TestEventType
  framework: string
  target: string
  phase: string
  status: 'passed' | 'failed' | 'skipped' | 'error'
  testName?: string
  message?: string
  duration?: number
  artifactPaths?: string[]
  raw?: string
}

export type TestArtifacts = {
  screenshots: string[]
  consoleLogs: string[]
  networkLogs: string[]
  semanticsSnapshots: string[]
  flutterTestLogs: string[]
  other: Record<string, string[]>
}

export type TestSummary = {
  framework: string
  mode: ExecutionLane
  target: string
  intent: MissionIntentKind
  passed: boolean
  totalTests: number
  passedTests: number
  failedTests: number
  skippedTests: number
  duration: number
  artifacts: TestArtifacts
  requirementSource?: RequirementSource
  acceptancePoints?: AcceptancePoint[]
}

export type TestAdapter = {
  name: string
  detect(projectDir: string): Promise<boolean>
  interpret(mission: TestMission): Promise<InterpretedMission>
  preflight(ctx: TestContext): Promise<PreflightResult>
  extractAcceptancePoints?(ctx: TestContext): Promise<AcceptancePoint[]>
  plan(ctx: TestContext): Promise<TestPlan>
  run(ctx: TestContext, plan: TestPlan): AsyncGenerator<TestEvent>
  collectArtifacts(ctx: TestContext): Promise<TestArtifacts>
  summarize(ctx: TestContext, events: TestEvent[]): Promise<TestSummary>
}

// ---------------------------------------------------------------------------
// State Machine
// ---------------------------------------------------------------------------

export type MissionState =
  | 'received'
  | 'interpreted'
  | 'requirement_framed'
  | 'assumptions_checked'
  | 'adapter_selected'
  | 'strategy_built'
  | 'preflight_running'
  | 'preflight_failed'
  | 'ready_to_execute'
  | 'running'
  | 'observed'
  | 'diagnosed'
  | 'decided'
  | 'stopping'
  | 'stopped'

export type MissionOutcome =
  | 'matched'
  | 'mismatched'
  | 'unverified'
  | 'blocked'
  | 'error'

export type MissionTransitionEvent =
  | 'mission_loaded'
  | 'intent_resolved'
  | 'requirement_resolved'
  | 'assumptions_resolved'
  | 'adapter_chosen'
  | 'strategy_generated'
  | 'preflight_passed'
  | 'preflight_failed'
  | 'execution_started'
  | 'execution_finished'
  | 'observation_recorded'
  | 'diagnosis_finished'
  | 'decision_committed'
  | 'stop_requested'
  | 'stop_persisted'

export type ControlAction =
  | 'commit_next_strategy'
  | 'switch_lane'
  | 'downgrade_scope'
  | 'stop_with_result'
  | 'stop_with_blocker'

/** Allowed state transitions map */
export const ALLOWED_TRANSITIONS: Record<MissionState, MissionState[]> = {
  received: ['interpreted'],
  interpreted: ['requirement_framed'],
  requirement_framed: ['assumptions_checked'],
  assumptions_checked: ['adapter_selected'],
  adapter_selected: ['strategy_built'],
  strategy_built: ['preflight_running'],
  preflight_running: ['ready_to_execute', 'preflight_failed'],
  preflight_failed: ['diagnosed'],
  ready_to_execute: ['running'],
  running: ['observed'],
  observed: ['diagnosed'],
  diagnosed: ['decided'],
  decided: ['strategy_built', 'ready_to_execute', 'stopping'],
  stopping: ['stopped'],
  stopped: [],
}

// ---------------------------------------------------------------------------
// Event Sourcing
// ---------------------------------------------------------------------------

export type MissionEventPhase =
  | 'received'
  | 'interpret'
  | 'requirement_frame'
  | 'assumption_check'
  | 'adapter_select'
  | 'strategy_build'
  | 'preflight'
  | 'execute'
  | 'observe'
  | 'diagnose'
  | 'decide'
  | 'stop'

export type MissionEventStatus = 'started' | 'succeeded' | 'failed' | 'blocked'

export type MissionEvent = {
  eventId: string
  missionId: string
  timestamp: string
  phase: MissionEventPhase
  eventType: MissionEventType
  parentEventId?: string
  causeEventIds?: string[]
  status?: MissionEventStatus
  payload: Record<string, unknown>
}

export type MissionEventType =
  | 'mission_received'
  | 'mission_interpreted'
  | 'requirement_source_selected'
  | 'acceptance_points_extracted'
  | 'assumptions_recorded'
  | 'strategy_candidates_generated'
  | 'strategy_committed'
  | 'preflight_started'
  | 'preflight_result'
  | 'execution_started'
  | 'tool_invoked'
  | 'tool_result'
  | 'artifact_recorded'
  | 'observation_recorded'
  | 'diagnosis_created'
  | 'decision_made'
  | 'memory_read'
  | 'memory_write'
  | 'lane_switched'
  | 'stop_reason_recorded'
  | 'mission_stopped'

// ---------------------------------------------------------------------------
// Decision Log
// ---------------------------------------------------------------------------

export type DecisionOption = {
  id: string
  label: string
  score?: number
  blockedBy?: string[]
}

export type DecisionRecord = {
  decisionId: string
  missionId: string
  phase: string
  question: string
  options: DecisionOption[]
  selectedOptionId: string
  rationaleSummary: string
  evidenceRefs: string[]
  expectedOutcome: string
}

// ---------------------------------------------------------------------------
// Reasoning State
// ---------------------------------------------------------------------------

export type ReasoningState = {
  mission: {
    missionId: string
    userGoal: string
    normalizedGoal: string
    confidence: number
  }
  requirement: {
    sourceType: RequirementSourceType
    sourcePath?: string
    acceptancePoints: AcceptancePoint[]
    validationScope: string[]
  }
  understanding: {
    appType: AppType | 'web'
    flowUnderTest: string
    safeAssumptions: string[]
    missingInputs: string[]
    rejectedAssumptions: string[]
  }
  strategy: {
    primaryLane: string
    fallbackLane: string | null
    assertionMode: AssertionMode
  }
  execution: {
    phase: MissionEventPhase | 'done'
    attempt: number
    maxAttempts: number
  }
  evidence: {
    artifacts: string[]
    observations: string[]
    failures: string[]
  }
  verdict: {
    status: 'unknown' | 'passed' | 'failed' | 'blocked'
    blockerType?: string
    nextAction?: string
  }
}

// ---------------------------------------------------------------------------
// Attempt Fingerprints & Failure Memory
// ---------------------------------------------------------------------------

export type AttemptFingerprint = {
  adapter: string
  framework: string
  target: string
  lane: string
  flow: string
  commandFamily: string
  assertionMode: string
  environmentKey: string
}

export type FailureReflection = {
  failureFingerprint: string
  likelyLayer: FailureLayer
  invalidatedAssumption: string
  newEvidence: string[]
  nextStrategy: string
  persistToFailureMemory: boolean
}

export type FailureLayer =
  | 'environment'
  | 'launch'
  | 'interaction'
  | 'assertion'
  | 'backend_dependency'
  | 'requirement_source_mismatch'
  | 'missing_input'

// ---------------------------------------------------------------------------
// Stop Rules
// ---------------------------------------------------------------------------

export type StopRuleId =
  | 'fatal_system_error'
  | 'hard_constraint_blocker'
  | 'goal_complete'
  | 'stuck'
  | 'budget_exhausted'
  | 'evidence_exhausted'
  | 'continue'

export type StopRuleEvaluation = {
  ruleId: StopRuleId
  missionId: string
  phase: 'decide'
  matched: boolean
  priority: number
  reasonSummary: string
  evidenceRefs: string[]
  resultingAction: ControlAction | 'continue'
  resultingOutcome?: MissionOutcome
}

// ---------------------------------------------------------------------------
// Memory Model
// ---------------------------------------------------------------------------

export type MemoryRecordKind =
  | 'fact'
  | 'failure_pattern'
  | 'successful_recipe'
  | 'blocked_by_missing_input'
  | 'decision_record'

export type MemoryRecord = {
  id: string
  kind: MemoryRecordKind
  scope: 'run' | 'project' | 'framework'
  createdAt: string
  lastConfirmedAt: string
  confidence: number
  evidence: string[]
  hitCount: number
  expiresAt?: string
  invalidatedBy?: string
  payload: Record<string, unknown>
}

export type FailurePattern = MemoryRecord & {
  kind: 'failure_pattern'
  payload: {
    framework: string
    target: string
    fingerprint: string
    conditions: Record<string, string>
    badAction: string
    reason: string
    recommendedAlternative: string
  }
}

export type SuccessfulRecipe = MemoryRecord & {
  kind: 'successful_recipe'
  payload: {
    framework: string
    target: string
    flow: string
    lane: ExecutionLane
    commands: string[]
    assertionMode: AssertionMode
  }
}

export type RunMemory = {
  attemptedFingerprints: AttemptFingerprint[]
  failedFingerprints: AttemptFingerprint[]
  observations: string[]
  invalidatedAssumptions: string[]
  currentHypotheses: Array<{ label: string; confidence: number }>
}

export type ProjectMemory = {
  facts: MemoryRecord[]
  failurePatterns: FailurePattern[]
  successfulRecipes: SuccessfulRecipe[]
  blockedInputs: MemoryRecord[]
  decisionRecords: MemoryRecord[]
}

// ---------------------------------------------------------------------------
// Mission Budget
// ---------------------------------------------------------------------------

export type MissionBudget = {
  maxAttemptsPerMission: number
  maxLaneSwitchesPerMission: number
  maxMissionDurationMs: number
  maxDiagnosesPerMission: number
  currentAttempts: number
  currentLaneSwitches: number
  currentDiagnoses: number
  startedAt: number
}

export const DEFAULT_BUDGET: Omit<
  MissionBudget,
  'currentAttempts' | 'currentLaneSwitches' | 'currentDiagnoses' | 'startedAt'
> = {
  maxAttemptsPerMission: 5,
  maxLaneSwitchesPerMission: 3,
  maxMissionDurationMs: 10 * 60 * 1000, // 10 minutes
  maxDiagnosesPerMission: 5,
}

// ---------------------------------------------------------------------------
// Routing Model
// ---------------------------------------------------------------------------

export type RoutingHypothesis = {
  id: string
  label: string
  intentKind: MissionIntentKind
  confidence: number
  constraints: string[]
  blockedBy: string[]
}

export type RoutingConstraint = {
  name: string
  satisfied: boolean
  source: string
}

export type RoutingProbe = {
  id: string
  question: string
  informationGain: number
  probeType: 'environment' | 'document' | 'user_question' | 'execution'
  result?: unknown
}

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------

export type DiagnosisResult = {
  diagnosisId: string
  missionId: string
  failureLayer: FailureLayer
  summary: string
  evidence: string[]
  invalidatedAssumptions: string[]
  suggestedAction: ControlAction
  suggestedLane?: ExecutionLane
  stuckDetected: boolean
  reflection: FailureReflection
}

// ---------------------------------------------------------------------------
// CLI Options
// ---------------------------------------------------------------------------

export type TestAgentCliOptions = {
  framework: string
  target: string
  mode: ExecutionLane
  project: string
  wasm: boolean
  headless: boolean
  requirement?: string
  maxAttempts?: number
  outputFormat: 'json' | 'junit' | 'text'
}

// ---------------------------------------------------------------------------
// Storage Paths
// ---------------------------------------------------------------------------

export const STORAGE_BASE = '.omx/test-agent'

export const STORAGE_PATHS = {
  sessions: `${STORAGE_BASE}/sessions`,
  traces: `${STORAGE_BASE}/traces`,
  decisions: `${STORAGE_BASE}/decisions`,
  memory: `${STORAGE_BASE}/memory`,
  artifacts: `${STORAGE_BASE}/artifacts`,
} as const

export const MEMORY_FILES = {
  projectFacts: `${STORAGE_PATHS.memory}/project-facts.json`,
  failurePatterns: `${STORAGE_PATHS.memory}/failure-patterns.jsonl`,
  successfulRecipes: `${STORAGE_PATHS.memory}/successful-recipes.jsonl`,
  blockedInputs: `${STORAGE_PATHS.memory}/blocked-inputs.jsonl`,
  decisionRecords: `${STORAGE_PATHS.memory}/decision-records.jsonl`,
} as const
