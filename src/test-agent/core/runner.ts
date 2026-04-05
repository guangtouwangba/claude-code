/**
 * Flutter Test Agent — Formal State Machine Runner
 *
 * Orchestrates mission execution through a validated state machine.
 * Each phase delegates to the adapter, collects events, evaluates stop
 * rules, and manages budget tracking.
 */

import type {
  ALLOWED_TRANSITIONS,
  AttemptFingerprint,
  ControlAction,
  ExecutionLane,
  MissionBudget,
  MissionEvent,
  MissionOutcome,
  MissionState,
  MissionTransitionEvent,
  ProjectMemory,
  ReasoningState,
  StopRuleEvaluation,
  StopRuleId,
  TestAdapter,
  TestContext,
  TestEvent,
  TestMission,
  TestPlan,
  TestSummary,
} from '../types'
import { DEFAULT_BUDGET } from '../types'
import { MissionTracer } from './events'
import { generateStrategyCandidates, applyMemoryGates, selectStrategy, buildTestPlan } from './planner'
import { diagnoseFailure, createAttemptFingerprint, detectStuck } from './diagnoser'

// Re-import the const value (not just type)
import { ALLOWED_TRANSITIONS as TRANSITIONS } from '../types'

// ---------------------------------------------------------------------------
// MissionRunner
// ---------------------------------------------------------------------------

export class MissionRunner {
  state: MissionState = 'received'
  outcome: MissionOutcome | null = null
  reasoningState: ReasoningState
  budget: MissionBudget

  private readonly mission: TestMission
  private readonly adapter: TestAdapter
  private readonly tracer: MissionTracer
  private readonly memory: ProjectMemory
  private readonly baseDir: string

  private collectedEvents: TestEvent[] = []
  private currentPlan: TestPlan | null = null
  private ctx: TestContext

  constructor(
    mission: TestMission,
    adapter: TestAdapter,
    tracer: MissionTracer,
    memory: ProjectMemory,
    baseDir: string,
  ) {
    this.mission = mission
    this.adapter = adapter
    this.tracer = tracer
    this.memory = memory
    this.baseDir = baseDir

    this.budget = {
      ...DEFAULT_BUDGET,
      currentAttempts: 0,
      currentLaneSwitches: 0,
      currentDiagnoses: 0,
      startedAt: Date.now(),
    }

    this.reasoningState = this.initReasoningState()

    this.ctx = {
      mission,
      projectDir: baseDir,
      workingDir: baseDir,
      reasoningState: this.reasoningState,
      budget: this.budget,
      runMemory: {
        attemptedFingerprints: [],
        failedFingerprints: [],
        observations: [],
        invalidatedAssumptions: [],
        currentHypotheses: [],
      },
    }
  }

  // ---------------------------------------------------------------------------
  // State machine transition
  // ---------------------------------------------------------------------------

  transition(event: MissionTransitionEvent): void {
    const allowed = TRANSITIONS[this.state]
    const nextState = this.resolveNextState(event)

    if (!allowed.includes(nextState)) {
      throw new Error(
        `Forbidden transition: ${this.state} --[${event}]--> ${nextState}. ` +
          `Allowed from ${this.state}: [${allowed.join(', ')}]`,
      )
    }

    const prevState = this.state
    this.state = nextState

    this.tracer.emit({
      missionId: this.mission.missionId,
      phase: this.phaseForState(nextState),
      eventType: 'mission_interpreted',
      status: 'succeeded',
      payload: {
        transition: event,
        fromState: prevState,
        toState: nextState,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Main run loop
  // ---------------------------------------------------------------------------

  async run(): Promise<TestSummary> {
    // Phase 1: received → interpret → interpreted
    this.transition('mission_loaded')
    const interpreted = await this.adapter.interpret(this.mission)
    this.reasoningState.requirement.acceptancePoints = interpreted.acceptancePoints
    this.ctx.reasoningState = this.reasoningState
    this.emitPhase('interpret', 'mission_interpreted', { acceptancePoints: interpreted.acceptancePoints.length })
    this.transition('intent_resolved')

    // Phase 2: interpreted → requirement_frame → requirement_framed
    this.emitPhase('requirement_frame', 'requirement_source_selected', {
      sourceType: this.mission.requirementSource.type,
      isAuthoritative: this.mission.requirementSource.isAuthoritative,
    })
    this.transition('requirement_resolved')

    // Phase 3: requirement_framed → assumption_check → assumptions_checked
    this.reasoningState.understanding.safeAssumptions = this.buildSafeAssumptions()
    this.emitPhase('assumption_check', 'assumptions_recorded', {
      safeAssumptions: this.reasoningState.understanding.safeAssumptions,
    })
    this.transition('assumptions_resolved')

    // Phase 4: assumptions_checked → adapter_select → adapter_selected
    this.emitPhase('adapter_select', 'strategy_candidates_generated', {
      adapter: this.adapter.name,
    })
    this.transition('adapter_chosen')

    // Strategy + execution loop
    return await this.strategyLoop()
  }

  // ---------------------------------------------------------------------------
  // Strategy + execution loop
  // ---------------------------------------------------------------------------

  private async strategyLoop(): Promise<TestSummary> {
    while (true) {
      // Phase 5: adapter_selected / decided → strategy_build → strategy_built
      const candidates = generateStrategyCandidates(this.ctx)
      const gated = applyMemoryGates(candidates, this.memory.failurePatterns, this.memory.successfulRecipes)
      const { primary, fallback } = selectStrategy(gated)

      this.reasoningState.strategy.primaryLane = primary.lane
      this.reasoningState.strategy.fallbackLane = fallback?.lane ?? null
      this.reasoningState.strategy.assertionMode = primary.assertionMode

      const plan = buildTestPlan(this.ctx, { primary, fallback })
      this.currentPlan = plan

      this.emitPhase('strategy_build', 'strategy_committed', {
        primaryLane: primary.lane,
        fallbackLane: fallback?.lane ?? null,
        assertionMode: primary.assertionMode,
        stepCount: plan.steps.length,
      })
      this.transition('strategy_generated')

      // Phase 6: strategy_built → preflight → preflight_running
      this.emitPhase('preflight', 'preflight_started', {})
      this.transition('preflight_passed') // moves to preflight_running

      const preflight = await this.adapter.preflight(this.ctx)
      this.emitPhase('preflight', 'preflight_result', {
        canProceed: preflight.canProceed,
        checks: preflight.checks.map((c) => ({ name: c.name, status: c.status })),
      })

      if (!preflight.canProceed) {
        this.transition('preflight_failed')
        // preflight_failed → diagnosed (skip execution)
        const diagnosis = diagnoseFailure([], this.ctx)
        this.budget.currentDiagnoses++
        this.emitPhase('diagnose', 'diagnosis_created', { diagnosisId: diagnosis.diagnosisId })
        this.transition('diagnosis_finished')

        const stopEval = this.evaluateStopRules()
        this.emitPhase('decide', 'decision_made', { ruleId: stopEval.ruleId })
        this.transition('decision_committed')

        if (stopEval.resultingAction !== 'continue' && stopEval.resultingAction !== 'commit_next_strategy') {
          return await this.doStop(stopEval.resultingOutcome ?? 'blocked')
        }
        // Try next strategy
        continue
      }

      this.transition('execution_started') // preflight_running → ready_to_execute

      // Phase 7: ready_to_execute → execute → running → observed
      this.transition('execution_started') // ready_to_execute → running

      this.budget.currentAttempts++
      this.reasoningState.execution.attempt = this.budget.currentAttempts
      this.collectedEvents = []

      const fingerprint = createAttemptFingerprint(this.ctx, plan)
      this.ctx.runMemory.attemptedFingerprints.push(fingerprint)

      this.emitPhase('execute', 'execution_started', {
        attempt: this.budget.currentAttempts,
        lane: plan.primaryLane,
        fingerprint,
      })

      for await (const event of this.adapter.run(this.ctx, plan)) {
        this.collectedEvents.push(event)
        this.emitPhase('execute', 'tool_result', {
          eventType: event.type,
          status: event.status,
          testName: event.testName,
        })
      }

      this.transition('execution_finished') // running → observed

      // Phase 8: observed → diagnose → diagnosed
      const diagnosis = diagnoseFailure(this.collectedEvents, this.ctx)
      this.budget.currentDiagnoses++

      if (diagnosis.stuckDetected) {
        this.ctx.runMemory.failedFingerprints.push(fingerprint)
      }

      this.reasoningState.evidence.failures = diagnosis.invalidatedAssumptions
      this.reasoningState.evidence.observations = this.ctx.runMemory.observations

      this.emitPhase('diagnose', 'diagnosis_created', {
        diagnosisId: diagnosis.diagnosisId,
        failureLayer: diagnosis.failureLayer,
        stuckDetected: diagnosis.stuckDetected,
        summary: diagnosis.summary,
      })
      this.transition('diagnosis_finished')

      // Phase 9: diagnosed → decide → decided
      const stopEval = this.evaluateStopRules()
      this.emitPhase('decide', 'decision_made', {
        ruleId: stopEval.ruleId,
        resultingAction: stopEval.resultingAction,
        resultingOutcome: stopEval.resultingOutcome,
      })
      this.transition('decision_committed')

      // Decide what to do next
      if (stopEval.resultingAction === 'continue' || stopEval.resultingAction === 'commit_next_strategy') {
        // Loop back: decided → strategy_built
        this.transition('strategy_generated')
        continue
      }

      if (stopEval.resultingAction === 'switch_lane') {
        this.budget.currentLaneSwitches++
        this.reasoningState.strategy.primaryLane =
          diagnosis.suggestedLane ?? this.nextLane(plan.primaryLane)
        this.transition('strategy_generated')
        continue
      }

      if (stopEval.resultingAction === 'downgrade_scope') {
        // Reduce scope and retry
        this.ctx.mission.scope.verifyVisualStructure = false
        this.ctx.mission.scope.verifyAccessibility = false
        this.transition('strategy_generated')
        continue
      }

      // stop_with_result or stop_with_blocker
      return await this.doStop(stopEval.resultingOutcome ?? 'unverified')
    }
  }

  // ---------------------------------------------------------------------------
  // evaluateStopRules
  // ---------------------------------------------------------------------------

  evaluateStopRules(): StopRuleEvaluation {
    const missionId = this.mission.missionId
    const phase = 'decide' as const
    const elapsed = Date.now() - this.budget.startedAt

    const rules: Array<{
      ruleId: StopRuleId
      priority: number
      check: () => { matched: boolean; reason: string; action: ControlAction | 'continue'; outcome?: MissionOutcome }
    }> = [
      {
        ruleId: 'fatal_system_error',
        priority: 1,
        check: () => {
          const hasFatal = this.collectedEvents.some(
            (e) => e.type === 'test_error' && e.message?.includes('fatal'),
          )
          return {
            matched: hasFatal,
            reason: 'Fatal system error encountered during execution',
            action: 'stop_with_blocker',
            outcome: 'error',
          }
        },
      },
      {
        ruleId: 'hard_constraint_blocker',
        priority: 2,
        check: () => {
          const hasBlocker = this.reasoningState.understanding.missingInputs.length > 0
          return {
            matched: hasBlocker,
            reason: `Missing required inputs: ${this.reasoningState.understanding.missingInputs.join(', ')}`,
            action: 'stop_with_blocker',
            outcome: 'blocked',
          }
        },
      },
      {
        ruleId: 'goal_complete',
        priority: 3,
        check: () => {
          const allPassed = this.collectedEvents.length > 0 &&
            this.collectedEvents.every((e) => e.status === 'passed' || e.status === 'skipped')
          return {
            matched: allPassed,
            reason: 'All test events passed — goal complete',
            action: 'stop_with_result',
            outcome: 'matched',
          }
        },
      },
      {
        ruleId: 'stuck',
        priority: 4,
        check: () => {
          const stuck = this.isStuck()
          return {
            matched: stuck,
            reason: 'Same fingerprint has failed multiple times with no new evidence',
            action: 'stop_with_blocker',
            outcome: 'unverified',
          }
        },
      },
      {
        ruleId: 'budget_exhausted',
        priority: 5,
        check: () => {
          const attemptsExhausted = this.budget.currentAttempts >= this.budget.maxAttemptsPerMission
          const timeExhausted = elapsed >= this.budget.maxMissionDurationMs
          const diagnosesExhausted = this.budget.currentDiagnoses >= this.budget.maxDiagnosesPerMission
          const matched = attemptsExhausted || timeExhausted || diagnosesExhausted
          return {
            matched,
            reason: attemptsExhausted
              ? `Attempt budget exhausted (${this.budget.currentAttempts}/${this.budget.maxAttemptsPerMission})`
              : timeExhausted
                ? `Time budget exhausted (${elapsed}ms / ${this.budget.maxMissionDurationMs}ms)`
                : `Diagnosis budget exhausted (${this.budget.currentDiagnoses}/${this.budget.maxDiagnosesPerMission})`,
            action: 'stop_with_result',
            outcome: 'unverified',
          }
        },
      },
      {
        ruleId: 'evidence_exhausted',
        priority: 6,
        check: () => {
          const noEvidence = this.reasoningState.evidence.artifacts.length === 0 &&
            this.budget.currentAttempts >= 2
          return {
            matched: noEvidence,
            reason: 'No artifacts collected after multiple attempts — evidence exhausted',
            action: 'stop_with_result',
            outcome: 'unverified',
          }
        },
      },
      {
        ruleId: 'continue',
        priority: 7,
        check: () => ({
          matched: true,
          reason: 'No stop condition met — continue execution',
          action: 'continue',
          outcome: undefined,
        }),
      },
    ]

    for (const rule of rules) {
      const result = rule.check()
      if (result.matched) {
        return {
          ruleId: rule.ruleId,
          missionId,
          phase,
          matched: true,
          priority: rule.priority,
          reasonSummary: result.reason,
          evidenceRefs: [],
          resultingAction: result.action,
          resultingOutcome: result.outcome,
        }
      }
    }

    // Unreachable — 'continue' always matches
    return {
      ruleId: 'continue',
      missionId,
      phase,
      matched: true,
      priority: 7,
      reasonSummary: 'Fallback continue',
      evidenceRefs: [],
      resultingAction: 'continue',
    }
  }

  // ---------------------------------------------------------------------------
  // isStuck
  // ---------------------------------------------------------------------------

  isStuck(): boolean {
    if (this.currentPlan === null) return false

    const failedFingerprints = this.ctx.runMemory.failedFingerprints
    if (failedFingerprints.length < 2) return false

    const current = createAttemptFingerprint(this.ctx, this.currentPlan)

    // Count how many times the same fingerprint has failed
    let sameFailCount = 0
    for (const fp of failedFingerprints) {
      if (
        fp.adapter === current.adapter &&
        fp.framework === current.framework &&
        fp.target === current.target &&
        fp.lane === current.lane &&
        fp.flow === current.flow &&
        fp.commandFamily === current.commandFamily &&
        fp.assertionMode === current.assertionMode
      ) {
        sameFailCount++
      }
    }

    if (sameFailCount >= 2) return true

    // No new evidence between retries
    const previousObservationCount =
      this.ctx.runMemory.observations.length - this.collectedEvents.length
    if (previousObservationCount <= 0 && this.budget.currentAttempts > 1) return true

    return false
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async doStop(outcome: MissionOutcome): Promise<TestSummary> {
    this.outcome = outcome
    this.reasoningState.verdict.status =
      outcome === 'matched' ? 'passed' : outcome === 'blocked' ? 'blocked' : 'failed'

    this.emitPhase('stop', 'stop_reason_recorded', { outcome })
    this.transition('stop_requested')
    this.transition('stop_persisted')

    const artifacts = await this.adapter.collectArtifacts(this.ctx)
    this.reasoningState.evidence.artifacts = [
      ...artifacts.screenshots,
      ...artifacts.consoleLogs,
      ...artifacts.flutterTestLogs,
    ]

    this.emitPhase('stop', 'mission_stopped', { outcome, artifacts: this.reasoningState.evidence.artifacts.length })

    return this.adapter.summarize(this.ctx, this.collectedEvents)
  }

  private initReasoningState(): ReasoningState {
    return {
      mission: {
        missionId: this.mission.missionId,
        userGoal: this.mission.userRequest,
        normalizedGoal: this.mission.userRequest.toLowerCase().trim(),
        confidence: this.mission.intent.confidence,
      },
      requirement: {
        sourceType: this.mission.requirementSource.type,
        sourcePath: this.mission.requirementSource.path,
        acceptancePoints: [],
        validationScope: [],
      },
      understanding: {
        appType: this.mission.target.appType,
        flowUnderTest: '',
        safeAssumptions: [],
        missingInputs: [],
        rejectedAssumptions: [],
      },
      strategy: {
        primaryLane: 'drive',
        fallbackLane: null,
        assertionMode: 'native-first',
      },
      execution: {
        phase: 'received',
        attempt: 0,
        maxAttempts: DEFAULT_BUDGET.maxAttemptsPerMission,
      },
      evidence: {
        artifacts: [],
        observations: [],
        failures: [],
      },
      verdict: {
        status: 'unknown',
      },
    }
  }

  private buildSafeAssumptions(): string[] {
    const assumptions: string[] = []
    const { appType, platform } = this.mission.target

    if (appType === 'flutter') {
      assumptions.push('Flutter SDK is installed')
      assumptions.push('pubspec.yaml exists and dependencies are resolved')
    }
    if (platform === 'web-chrome') {
      assumptions.push('Chrome browser is available')
      assumptions.push('chromedriver is available')
    }
    if (platform === 'android') {
      assumptions.push('Android emulator or device is connected')
    }
    if (platform === 'ios') {
      assumptions.push('iOS simulator or device is connected')
    }

    return assumptions
  }

  private resolveNextState(event: MissionTransitionEvent): MissionState {
    // Map transition events to next states based on current state
    const mapping: Partial<Record<MissionState, Partial<Record<MissionTransitionEvent, MissionState>>>> = {
      received: { mission_loaded: 'interpreted' },
      interpreted: { intent_resolved: 'requirement_framed' },
      requirement_framed: { requirement_resolved: 'assumptions_checked' },
      assumptions_checked: { assumptions_resolved: 'adapter_selected' },
      adapter_selected: { adapter_chosen: 'strategy_built' },
      strategy_built: { strategy_generated: 'preflight_running' },
      preflight_running: {
        preflight_passed: 'ready_to_execute',
        preflight_failed: 'preflight_failed',
        execution_started: 'ready_to_execute',
      },
      preflight_failed: { diagnosis_finished: 'diagnosed' },
      ready_to_execute: { execution_started: 'running' },
      running: { execution_finished: 'observed' },
      observed: { observation_recorded: 'diagnosed', diagnosis_finished: 'diagnosed' },
      diagnosed: { diagnosis_finished: 'decided' },
      decided: {
        strategy_generated: 'strategy_built',
        decision_committed: 'stopping',
        stop_requested: 'stopping',
      },
      stopping: { stop_persisted: 'stopped' },
    }

    const stateMap = mapping[this.state]
    const next = stateMap?.[event]

    if (next !== undefined) {
      return next
    }

    // Fallback: infer from allowed transitions
    const allowed = TRANSITIONS[this.state]
    if (allowed.length === 1) {
      return allowed[0]!
    }

    throw new Error(
      `Cannot resolve next state from '${this.state}' with event '${event}'`,
    )
  }

  private phaseForState(state: MissionState): import('../types').MissionEventPhase {
    const map: Record<MissionState, import('../types').MissionEventPhase> = {
      received: 'received',
      interpreted: 'interpret',
      requirement_framed: 'requirement_frame',
      assumptions_checked: 'assumption_check',
      adapter_selected: 'adapter_select',
      strategy_built: 'strategy_build',
      preflight_running: 'preflight',
      preflight_failed: 'preflight',
      ready_to_execute: 'preflight',
      running: 'execute',
      observed: 'observe',
      diagnosed: 'diagnose',
      decided: 'decide',
      stopping: 'stop',
      stopped: 'stop',
    }
    return map[state]
  }

  private nextLane(current: ExecutionLane): ExecutionLane {
    switch (current) {
      case 'drive': return 'inspect'
      case 'inspect': return 'hybrid'
      case 'hybrid': return 'drive'
    }
  }

  private emitPhase(
    phase: import('../types').MissionEventPhase,
    eventType: import('../types').MissionEventType,
    payload: Record<string, unknown>,
  ): void {
    this.tracer.emit({
      missionId: this.mission.missionId,
      phase,
      eventType,
      status: 'succeeded',
      payload,
    })
  }
}
