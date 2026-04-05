# Flutter Test Agent Design

## Status

- Branch: `feature/flutter-test-agent-design`
- Type: design only
- Target: a generic test agent with first-class Flutter support, able to launch Chrome for web testing

## Goal

Design a reusable test-agent lane on top of the existing headless runtime, with Flutter as the first concrete adapter.

This agent should:

- run in non-interactive mode
- launch Chrome for Flutter web testing when requested
- support reliable test execution for CanvasKit / skwasm based UIs
- support requirement-driven validation for completed Flutter frontend work
- produce structured machine-readable results for CI and higher-level orchestration
- leave room for additional adapters later, such as Jest, Vitest, Pytest, Go test, and Cargo test

The design should follow the interaction blueprint in [`flutter-test-agent-blueprint.md`](/Users/kids/Library/Mobile%20Documents/iCloud~md~obsidian/Documents/claude-code/docs/plans/flutter-test-agent-blueprint.md).

That means the system is not only a flow runner.

It is also a requirement-to-behavior verifier for the common real-world task:

> The user finished a Flutter frontend implementation and wants to know whether it matches the requirement.

## Why This Needs A Separate Design

The current repository already has a strong headless execution path:

- [`src/main.tsx`](/Users/kids/Library/Mobile%20Documents/iCloud~md~obsidian/Documents/claude-code/src/main.tsx#L1320) exposes `-p/--print`, JSON outputs, `stream-json`, `max-turns`, and non-interactive execution flags.
- [`src/main.tsx`](/Users/kids/Library/Mobile%20Documents/iCloud~md~obsidian/Documents/claude-code/src/main.tsx#L3926) routes print-mode execution into `runHeadless(...)`.
- [`src/cli/print.ts`](/Users/kids/Library/Mobile%20Documents/iCloud~md~obsidian/Documents/claude-code/src/cli/print.ts#L449) already behaves like a session-safe headless runtime with structured IO, permission routing, result streaming, and deterministic exit handling.

However, the current `--chrome` integration is not the right primitive for CI-grade Flutter testing:

- [`src/main.tsx`](/Users/kids/Library/Mobile%20Documents/iCloud~md~obsidian/Documents/claude-code/src/main.tsx#L1700) enables "Claude in Chrome".
- That path is optimized for user-browser control through the Chrome extension and MCP tools, not for stable test execution inside a disposable Chrome session.

Therefore the Flutter test agent should reuse the headless runtime, but not use the current user-browser integration as its primary execution strategy.

## External Constraints

These constraints are current as of April 5, 2026 and come from official Flutter docs:

1. Flutter web is canvas-first, not DOM-first.
   Source: Flutter's web accessibility docs state that Flutter renders on a single canvas and exposes meaning through a semantics layer.
   Link: https://docs.flutter.dev/ui/accessibility/web-accessibility

2. Flutter web now centers around `canvaskit` and `skwasm`.
   The default web run path uses `canvaskit`; `--wasm` enables `skwasm` with fallback to `canvaskit`.
   Link: https://docs.flutter.dev/platform-integration/web/renderers

3. Official browser integration testing still uses `chromedriver` plus `flutter drive -d chrome`.
   Link: https://docs.flutter.dev/testing/integration-tests

4. Headless web testing exists, but the official docs describe it as `flutter drive -d web-server`.
   That is useful for CI, but it is not the same as "launch Chrome and test inside it".
   Link: https://docs.flutter.dev/testing/integration-tests

5. Web accessibility is opt-in.
   Flutter documents that web accessibility is not enabled by default, and recommends turning it on in code with `SemanticsBinding.instance.ensureSemantics()` when needed.
   Link: https://docs.flutter.dev/ui/accessibility/web-accessibility

6. The old HTML-backend-centric testing assumptions are no longer the right foundation.
   Flutter's breaking-change docs explicitly tie older web golden behavior to the deprecated HTML backend.
   Link: https://docs.flutter.dev/release/breaking-changes/web-golden-comparator

## Problem Statement

The Flutter "canvas problem" is not that Chrome cannot be launched. Chrome can be launched today.

The real problem is that a generic browser agent cannot safely assume there will be stable DOM nodes to query and manipulate, because most Flutter web UI is rendered into canvas-backed layers.

That creates three different testing needs:

1. Functional test execution
   Best solved inside Flutter's own test APIs.

2. Browser-observable inspection
   Best solved through the semantics tree that Flutter exports to the DOM when accessibility is enabled.

3. Visual confidence
   Best solved with screenshots and artifacts, not DOM assertions.

A usable Flutter test agent needs all three lanes, but it should not treat them as the same thing.

## Design Principles

1. Prefer official Flutter execution paths over browser hacks.
2. Keep Chrome launching deterministic and owned by the adapter, not by a user session.
3. Treat semantics as the browser-facing contract for Flutter web.
4. Treat screenshots as a first-class verification artifact.
5. Keep the generic agent protocol adapter-driven so Flutter is first, not special forever.
6. Do not require the current Chrome extension or a logged-in personal browser for CI use.
7. Treat requirement comparison as a first-class workflow, not a side effect of smoke testing.
8. Make routing generic: the system should move from ambiguity to execution through search, constraints, evidence, diagnosis, and memory.

## Proposed Product Shape

Add a new top-level execution surface:

```text
ccb test-agent --framework flutter --target web-chrome
```

Representative commands:

```bash
ccb test-agent --framework flutter --target web-chrome --project /path/app
ccb test-agent --framework flutter --target web-chrome --mode drive
ccb test-agent --framework flutter --target web-chrome --mode inspect
ccb test-agent --framework flutter --target web-chrome --mode hybrid
ccb test-agent --framework flutter --target web-chrome --wasm
ccb test-agent --framework flutter --target web-server --headless
```

The internal unit of work should not be a raw shell command.

It should be a structured mission object produced from a natural-language request.

## Mission Model

The blueprint implies that user input should first be normalized into a mission before planning and execution begin.

Conceptual schema:

```ts
type TestMission = {
  missionId: string
  userRequest: string
  mode: 'full-auto' | 'guided' | 'operator'
  intent: {
    kind:
      | 'flow_validation'
      | 'requirement_validation'
      | 'post_fix_verification'
      | 'exploratory_smoke'
    confidence: number
  }
  requirementSource: {
    type: 'inline' | 'markdown' | 'prd' | 'issue' | 'unknown'
    path?: string
    isAuthoritative: boolean
  }
  target: {
    appType: 'flutter' | 'unknown'
    platform: 'web-chrome' | 'web-server' | 'android' | 'ios' | 'unknown'
  }
  scope: {
    verifyBehavior: boolean
    verifyVisualStructure: boolean
    verifyContent: boolean
    verifyAccessibility: boolean
  }
}
```

This mission object is what should flow into routing, planning, execution, and reporting.

## Requirement-Driven Mode

The blueprint changes the meaning of "test agent" in an important way.

Many real user requests are not asking:

- does the flow run

They are asking:

- does this implementation match the requirement

That means the design must support a dedicated requirement-driven path.

Typical requests:

- `我写完了 Flutter 前端，帮我测下是不是和需求一致`
- `帮我验证这个页面是不是按 PRD 做的`
- `你按需求帮我验一下这个登录页`

In this mode, the system should compare:

1. requirement source
2. implementation behavior
3. evidence collected from execution

The output should therefore be a gap/compliance report, not just pass/fail.

By default, this mode should run under `full-auto`, not guided interaction.

That means:

- missing inputs do not pause the mission
- missing inputs reduce confidence or scope
- unverifiable acceptance points are marked explicitly
- the mission terminates with `matched`, `mismatched`, `unverified`, or `blocked`

## Acceptance-Point Extraction

Before execution, requirement-driven requests should be normalized into acceptance points.

Conceptual schema:

```ts
type AcceptancePoint = {
  id: string
  description: string
  dimensions: Array<
    | 'behavior'
    | 'visual_structure'
    | 'copy'
    | 'state_transition'
    | 'error_handling'
    | 'accessibility'
  >
  verificationStatus: 'pending' | 'matched' | 'mismatched' | 'unverified'
  verificationMethod:
    | 'flutter_native'
    | 'browser_inspect'
    | 'screenshot'
    | 'semantics'
    | 'manual_input_required'
}
```

Example:

```text
Acceptance Points
- AP1: 默认显示手机号登录
- AP2: 验证码按钮进入 60 秒倒计时
- AP3: 登录成功后进入首页
- AP4: 错误时显示 toast
```

These acceptance points should be extracted before lane selection so the planner can choose verification methods per point instead of per mission only.

## Execution Modes

### 1. `drive`

Purpose: reliable functional execution inside Chrome using Flutter's own integration test stack.

Execution:

1. Validate Flutter environment.
2. Ensure `Chrome (web)` is visible in `flutter devices`.
3. Ensure `chromedriver` exists.
4. Start `chromedriver`.
5. Run:

```bash
flutter drive \
  --driver=test_driver/integration_test.dart \
  --target=integration_test/app_test.dart \
  -d chrome
```

Why this is the default for Flutter web:

- It follows Flutter's official browser integration path.
- It avoids the canvas/DOM instability problem because assertions run through Flutter APIs, not external selectors.
- It can reuse `flutter_test` style finders, such as `find.byKey`.

### 2. `inspect`

Purpose: browser-side inspection using launched Chrome plus semantics-host analysis.

Execution:

1. Launch app with:

```bash
flutter run -d chrome
```

or:

```bash
flutter run -d chrome --wasm
```

2. Require the app under test to enable semantics on web.
3. Attach a browser control lane to inspect:
   - semantics host tree
   - ARIA roles
   - accessible names
   - console
   - network
   - screenshots

This mode is for:

- smoke inspection
- accessibility assertions
- debugging flaky UI flows
- artifact capture

It is not the preferred primary assertion engine for Flutter app behavior.

### 3. `hybrid`

Purpose: combine Flutter-native functional checks with browser-level inspection artifacts.

Execution:

1. Run the `drive` lane first.
2. On failure or on explicit request, run the `inspect` lane.
3. Correlate:
   - Flutter test failure
   - browser console errors
   - network failures
   - screenshots
   - semantics-host snapshot

This should be the recommended mode for agentic repair loops.

## Flutter Adapter Contract

The generic test-agent core should not know Flutter command details directly.

Introduce an adapter interface conceptually like:

```ts
type TestAdapter = {
  detect(projectDir: string): Promise<boolean>
  interpret(mission: TestMission): Promise<InterpretedMission>
  preflight(ctx: TestContext): Promise<PreflightResult>
  extractAcceptancePoints?(ctx: TestContext): Promise<AcceptancePoint[]>
  plan(ctx: TestContext): Promise<TestPlan>
  run(ctx: TestContext, plan: TestPlan): AsyncIterable<TestEvent>
  collectArtifacts(ctx: TestContext): Promise<TestArtifacts>
  summarize(ctx: TestContext, events: TestEvent[]): Promise<TestSummary>
}
```

Flutter-specific responsibilities:

- detect `pubspec.yaml`
- detect `integration_test/`
- detect `test_driver/integration_test.dart`
- choose `drive`, `inspect`, or `hybrid`
- choose `chrome` vs `web-server`
- optionally choose default renderer path vs `--wasm`
- map acceptance points to verification methods
- parse Flutter stdout into structured test events
- collect screenshots, console logs, and semantics-host snapshots

## Chrome Strategy

### Primary Strategy

Use adapter-owned Chrome launch through Flutter tooling.

Rationale:

- `flutter drive -d chrome` is official and stable for browser testing.
- It avoids dependence on a personal browser profile.
- It works in local automation and CI more cleanly than extension-driven browser control.

### Secondary Strategy

Use a browser automation lane only after the app is already running.

That browser lane can be implemented using:

- existing Chrome MCP infrastructure, if available and suitable
- a dedicated browser automation provider later

But it should remain optional and should not block the first Flutter MVP.

### Explicit Non-Goal

Do not make the current `--chrome` extension integration the mandatory runtime for Flutter tests.

Reasons:

- depends on installed extension + native host
- oriented around user-tab control
- harder to make deterministic in CI
- wrong abstraction for the base test runner

## Solving The Flutter Canvas Problem

The design should solve it with layered observability, not a fake DOM strategy.

### Layer A: Flutter-native selectors

For behavior tests, use Flutter's test APIs:

- `find.byKey`
- `find.text`
- `pumpAndSettle`
- integration test bindings

This bypasses the canvas issue entirely.

### Layer B: Semantics contract

For browser-observable state, require a semantics contract in web mode:

- enable web semantics in code when running browser-inspection tests
- use clear labels and semantic roles on important controls
- prefer standard widgets when they already export semantics correctly

Minimum requirement for browser inspection mode:

```dart
import 'package:flutter/foundation.dart';
import 'package:flutter/semantics.dart';

void main() {
  runApp(const MyApp());
  if (kIsWeb) {
    SemanticsBinding.instance.ensureSemantics();
  }
}
```

This is aligned with Flutter's web accessibility guidance.

### Layer C: Screenshot artifacts

For rendering confidence:

- capture viewport screenshots
- capture failure screenshots automatically
- optionally compare against baselines later

This matters because semantics confirms meaning, not pixels.

## Recommended App-Side Conventions For Flutter Projects

To make the test agent reliable, the Flutter adapter should recommend:

1. Stable widget keys for functional tests.
2. Semantic labels and roles for browser-side inspection.
3. A dedicated test bootstrap flag, for example:

```bash
--dart-define=TEST_AGENT_MODE=1
```

4. Optional test-only semantics enablement on web:

```dart
const enableAgentSemantics = bool.fromEnvironment('TEST_AGENT_MODE');
```

This avoids forcing semantics on in normal production runs if the team does not want that overhead everywhere.

## Proposed Internal Architecture

### Core

New modules:

- `src/test-agent/`
- `src/test-agent/core/`
- `src/test-agent/adapters/flutter/`
- `src/test-agent/reporting/`
- `src/test-agent/artifacts/`

### Suggested file layout

```text
src/test-agent/
  cli.ts
  types.ts
  core/
    detect.ts
    interpret.ts
    planner.ts
    routing.ts
    runner.ts
    diagnoser.ts
    events.ts
  adapters/
    flutter/
      detect.ts
      interpret.ts
      extractAcceptancePoints.ts
      preflight.ts
      plan.ts
      runDrive.ts
      runInspect.ts
      parseFlutterOutput.ts
      collectArtifacts.ts
  reporting/
    jsonReport.ts
    junitReport.ts
```

### Integration point

The cleanest first integration is a dedicated subcommand that still reuses the existing process/bootstrap rules.

Suggested path:

- register `test-agent` in the CLI command layer
- keep output compatible with the repository's existing headless/JSON conventions where possible
- only route into the full `runHeadless(...)` loop when agentic repair is explicitly enabled

This keeps the first version simpler than forcing Flutter tests through the full conversational loop.

## Output Contract

The generic test agent should emit structured events such as:

```json
{
  "type": "test_event",
  "framework": "flutter",
  "target": "web-chrome",
  "phase": "run",
  "status": "failed",
  "testName": "counter increments",
  "artifactPaths": [
    ".artifacts/flutter/console.log",
    ".artifacts/flutter/failure.png"
  ]
}
```

Final summary object:

```json
{
  "framework": "flutter",
  "mode": "hybrid",
  "target": "web-chrome",
  "passed": false,
  "failures": 1,
  "artifacts": {
    "screenshots": ["..."],
    "consoleLogs": ["..."],
    "semanticsSnapshots": ["..."]
  }
}
```

For requirement-driven missions, the default terminal result should be a requirement comparison report rather than a generic pass/fail summary.

Conceptual schema:

```json
{
  "framework": "flutter",
  "mode": "hybrid",
  "target": "web-chrome",
  "intent": "requirement_validation",
  "requirementSource": {
    "type": "inline",
    "isAuthoritative": true
  },
  "acceptancePoints": [
    {
      "id": "AP1",
      "status": "matched",
      "reason": "default state shows phone login",
      "evidence": ["screenshot", "semantics"]
    },
    {
      "id": "AP2",
      "status": "mismatched",
      "reason": "countdown observed as 30s instead of 60s",
      "evidence": ["interaction log", "button state trace"]
    },
    {
      "id": "AP3",
      "status": "unverified",
      "reason": "missing valid test credential"
    }
  ]
}
```

This output model matches the blueprint's distinction between:

- matched
- mismatched
- not yet verified

## Observability Model

The test agent requires a stronger observability layer than ordinary application logging.

The goal is not only to record output streams such as stdout, stderr, screenshots, or console logs.

The goal is to record the full decision trace:

- the original user request
- the interpreted mission
- the chosen strategy
- the alternatives considered
- the evidence used for a decision
- the action taken
- the result of that action
- the reason the agent continued, switched, or stopped

In other words, the system should produce a replayable mission trace from start to finish.

### Observability goals

The observability system should make it possible to answer:

1. what did the user ask for
2. how did the agent interpret the request
3. what requirement source did it use
4. why did it choose a specific lane
5. what tool or command did it run next
6. what result came back
7. how did that result change the next decision
8. why did the agent stop

### Design rule

Do not log hidden chain-of-thought.

Log:

- decision summaries
- candidate options
- selected option
- evidence references
- outcome
- stop reason

This preserves auditability without depending on private internal reasoning text.

## Event-Sourced Trace

The recommended model is append-only event sourcing.

Every meaningful mission transition should emit a structured event into a local trace log.

This makes the run:

- replayable
- debuggable
- inspectable after failure
- compressible into summaries later

### Event schema

Conceptual schema:

```ts
type MissionEvent = {
  eventId: string
  missionId: string
  timestamp: string
  phase:
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
  eventType: string
  parentEventId?: string
  causeEventIds?: string[]
  status?: 'started' | 'succeeded' | 'failed' | 'blocked'
  payload: Record<string, unknown>
}
```

This should be the canonical trace unit.

### Causality

Each event should reference the earlier events or artifacts that caused it.

Examples:

- a `strategy_committed` event should reference the interpretation and requirement framing events
- a `diagnosis_created` event should reference the failed execution event and observed artifacts
- a `stop` event should reference the final decision event

This is critical because raw time order alone is not enough to explain why the agent changed course.

## Event Taxonomy

The system should define a finite event vocabulary.

Recommended mission-level events:

- `mission_received`
- `mission_interpreted`
- `requirement_source_selected`
- `acceptance_points_extracted`
- `assumptions_recorded`
- `strategy_candidates_generated`
- `strategy_committed`
- `preflight_started`
- `preflight_result`
- `execution_started`
- `tool_invoked`
- `tool_result`
- `artifact_recorded`
- `observation_recorded`
- `diagnosis_created`
- `decision_made`
- `memory_read`
- `memory_write`
- `lane_switched`
- `stop_reason_recorded`
- `mission_stopped`

This taxonomy should be small, stable, and composable.

## Decision Log Contract

The most important observable unit is the decision log entry.

Every non-trivial agent decision should be logged with:

- what the decision was about
- what options were available
- which option was selected
- why it was selected
- what evidence supported the selection
- what constraints blocked the rejected options

Conceptual schema:

```ts
type DecisionRecord = {
  decisionId: string
  missionId: string
  phase: string
  question: string
  options: Array<{
    id: string
    label: string
    score?: number
    blockedBy?: string[]
  }>
  selectedOptionId: string
  rationaleSummary: string
  evidenceRefs: string[]
  expectedOutcome: string
}
```

Example:

```json
{
  "decisionId": "dec-017",
  "missionId": "m-123",
  "phase": "strategy_build",
  "question": "Which lane should be used first?",
  "options": [
    {
      "id": "opt-drive",
      "label": "flutter-drive",
      "score": 0.91
    },
    {
      "id": "opt-inspect",
      "label": "chrome-inspect",
      "score": 0.42,
      "blockedBy": ["dom_primary_unreliable_for_canvaskit"]
    }
  ],
  "selectedOptionId": "opt-drive",
  "rationaleSummary": "Prefer Flutter-native assertions for functional validation on web",
  "evidenceRefs": ["evt-interpret-2", "evt-req-4", "mem-failure-9"],
  "expectedOutcome": "Reliable first-pass validation of acceptance points"
}
```

This should be persisted both:

- as an event in the trace
- as a structured decision record for memory and debugging

## Execution Trace And Artifacts

Execution logging should be separated into three layers:

### 1. Decision trace

Records why the agent did something.

### 2. Execution trace

Records what concrete action ran.

Examples:

- shell command started
- shell command exited
- Flutter test started
- Chrome launched
- browser inspection step executed

### 3. Artifact registry

Records what evidence was produced.

Examples:

- screenshot path
- console log path
- network summary path
- semantics snapshot path
- Flutter test log path

This separation matters because:

- execution traces are operational
- artifact records are evidence
- decision traces explain control flow

## Local Trace Storage

The local filesystem layout should explicitly include mission traces.

Suggested layout:

```text
.omx/test-agent/
  sessions/
    <mission-id>.json
  traces/
    <mission-id>.jsonl
  decisions/
    <mission-id>.jsonl
  memory/
    project-facts.json
    failure-patterns.jsonl
    successful-recipes.jsonl
    blocked-inputs.jsonl
    decision-records.jsonl
  artifacts/
    <mission-id>/
```

Storage rules:

- `traces/<mission-id>.jsonl` is append-only mission event log
- `decisions/<mission-id>.jsonl` is append-only decision summary stream
- `artifacts/<mission-id>/` holds raw evidence files
- `sessions/<mission-id>.json` stores the latest compact state snapshot

## Derived Views

The system should support generating higher-level derived views from the raw trace.

Recommended derived views:

- mission timeline
- decision tree
- lane switch summary
- acceptance-point verification table
- stop reason summary
- artifact index

These can be generated after the run finishes without changing the raw event log model.

## Required Stop Logging

The agent must emit an explicit terminal stop event.

It should include:

- final status
- stop reason
- whether the mission ended in pass, mismatch, blocked, or unverified state
- the final decision that caused stopping
- a list of the artifacts that support the final output

Conceptual schema:

```json
{
  "eventType": "mission_stopped",
  "phase": "stop",
  "status": "succeeded",
  "payload": {
    "finalStatus": "blocked",
    "stopReason": "missing_valid_test_credentials",
    "finalDecisionRef": "dec-024",
    "artifactRefs": ["art-12", "art-15"]
  }
}
```

This is required because "the run ended" is not the same thing as "the agent proved the requirement was satisfied".

## Instrumentation Boundaries

The observability layer should instrument:

- mission creation
- requirement framing
- acceptance-point extraction
- strategy generation and commitment
- memory reads and writes
- preflight checks
- every tool or command invocation
- every meaningful observation
- diagnosis
- lane switches
- final stop

It should not try to store arbitrary raw hidden reasoning text.

## Relationship To Memory

Observability and memory are related but not the same thing.

- observability records what happened during a mission
- memory stores selected reusable knowledge across missions

The trace log should be high-fidelity and append-only.

Memory should be selective and curated from the trace.

In other words:

- trace first
- summarize second
- persist reusable memory third

This ordering is important because it allows later debugging of why a memory record was created.

## Cognitive Control Model

The test agent should not be implemented as a free-form conversational loop that keeps "trying things".

Instead, it should be implemented as a constrained reasoning system:

- each phase answers a narrow question
- each phase has a limited tool budget
- each phase must produce structured output
- each phase must consume explicit evidence from the previous phase
- repeated failures must change strategy, not just repeat actions

The core control principle is:

> Do not try to control hidden chain-of-thought directly. Control the agent by constraining state, evidence, tools, transitions, and stopping conditions.

### Reasoning phases

The internal reasoning pipeline should be:

1. `interpret`
2. `requirement_frame`
3. `assumption_check`
4. `adapter_select`
5. `strategy_build`
6. `preflight`
7. `execute`
8. `observe`
9. `diagnose`
10. `decide`

Each phase should be allowed to answer only one class of question:

- `interpret`: what does the user want to test
- `requirement_frame`: what source requirement, acceptance points, and scope should govern this mission
- `assumption_check`: what may be safely assumed vs what is missing
- `adapter_select`: which framework adapter and target should be used
- `strategy_build`: which lane should be attempted first
- `preflight`: can this strategy run in the current environment
- `execute`: run the chosen plan
- `observe`: collect normalized evidence only
- `diagnose`: determine the most likely failure layer
- `decide`: rerun, switch lane, downgrade scope, stop with blocker, or mark unverified

### Reasoning state

The agent should maintain a local structured reasoning object rather than repeatedly re-deriving context from scratch.

Conceptual schema:

```ts
type ReasoningState = {
  mission: {
    missionId: string
    userGoal: string
    normalizedGoal: string
    confidence: number
  }
  requirement: {
    sourceType: 'inline' | 'markdown' | 'prd' | 'issue' | 'unknown'
    sourcePath?: string
    acceptancePoints: AcceptancePoint[]
    validationScope: string[]
  }
  understanding: {
    appType: 'flutter' | 'web' | 'unknown'
    flowUnderTest: string
    safeAssumptions: string[]
    missingInputs: string[]
    rejectedAssumptions: string[]
  }
  strategy: {
    primaryLane: string
    fallbackLane: string | null
    assertionMode: 'native-first' | 'browser-first' | 'hybrid'
  }
  execution: {
    phase:
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
      | 'done'
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
```

This state object should be persisted locally and updated after every meaningful transition.

## Full-Auto Execution Policy

The default execution policy should be `full-auto`.

This policy means the agent should never pause waiting for user clarification during a mission unless the user explicitly selected guided behavior.

When required information is missing, the decision layer should choose one of these actions:

1. safe assumption
2. scope downgrade
3. strategy switch
4. terminal stop with `blocked`
5. terminal completion with `unverified` acceptance points

Examples:

- missing requirement source -> search repo, then continue with best available source
- missing test credentials -> continue with credential-free acceptance points, mark the rest unverified
- ambiguous flow name -> choose highest-confidence candidate and record alternatives in trace
- repeated failure on the same lane -> switch lane automatically

## Full-Auto Loop And Termination Rules

Full-auto should not mean "retry forever".

It should mean:

- the system keeps advancing without waiting for the user
- every loop iteration is bounded
- the mission must terminate in an explicit end state

### Core loop

The control loop should be:

```text
interpret
-> requirement_frame
-> strategy_build
-> preflight
-> execute
-> observe
-> diagnose
-> decide
-> strategy_build | execute | stop
```

The loop may continue only if the `decide` phase determines that:

- a new strategy exists
- the new strategy is meaningfully different
- new evidence can still be collected
- the mission is still within budget
- no stop condition has been met

### Allowed decide actions

In full-auto mode, each `decide` phase may output only one of these actions:

1. `commit_next_strategy`
2. `switch_lane`
3. `downgrade_scope`
4. `stop_with_blocker`
5. `stop_with_result`

It must not output:

- `wait_for_user`
- `retry_same_strategy_without_new_evidence`

### Terminal states

Every mission must end in one of the following terminal states:

- `matched`
- `mismatched`
- `unverified`
- `blocked`
- optionally implementation-level `error`

These states should be treated as explicit completion states, not as vague outcomes.

### Stop condition classes

The agent should stop automatically when it reaches one of these classes of stop condition.

#### 1. Goal-complete stop

The system has enough evidence to evaluate the mission.

Examples:

- all acceptance points were verified
- one or more acceptance points clearly mismatched
- enough evidence exists to produce a conclusive requirement report

Typical result:

- `matched`
- `mismatched`

#### 2. Evidence-exhausted stop

The system has no meaningful new evidence path left.

Examples:

- all viable lanes have already been attempted
- no additional requirement source can be found
- no new probes can reduce uncertainty

Typical result:

- `unverified`
- `blocked`

#### 3. Constraint stop

Execution is prevented by hard constraints.

Examples:

- Flutter is not installed
- Chrome is unavailable
- `chromedriver` is unavailable and there is no fallback lane
- no runnable target exists

Typical result:

- `blocked`

#### 4. Stuck stop

The system detects that additional retries would be repetitive rather than productive.

Examples:

- same attempt fingerprint failed repeatedly
- same failure fingerprint keeps recurring
- all alternative lanes are blocked by memory or constraints

Typical result:

- `blocked`
- `unverified`

#### 5. Budget stop

The system reaches configured limits.

Examples:

- maximum attempts reached
- maximum mission time reached
- maximum lane switches reached
- token or compute budget reached

Typical result:

- `unverified`

### Bounded search rule

The full-auto loop should be treated as bounded autonomous search.

This means:

- automatic continuation is allowed
- infinite retry is not allowed
- every retry must be justified by either new evidence or a materially different strategy

### Practical example

Mission:

```text
我写完了 Flutter 登录页，帮我看是不是符合需求
```

Possible full-auto progression:

1. locate best available requirement source
2. extract acceptance points
3. run `flutter drive -d chrome`
4. verify AP1 as matched
5. verify AP2 as mismatched
6. mark AP3 as unverified due to missing valid credential
7. stop with requirement report

The system should not continue retrying after step 7 because it has already reached a valid terminal state.

## Generic Routing Model

Per the blueprint, generic routing should not be an improvised prompt pattern.

It should use algorithmic thinking patterns as a design guide:

- graph search for candidate path discovery
- constraint satisfaction for pruning
- information gain for deciding what to ask or probe next
- hypothesis ranking for adaptive interpretation
- hierarchical decomposition for mission breakdown
- model-based diagnosis for failure classification
- tabu-style negative memory for repeat-error suppression
- case-based reasoning for recipe reuse

The routing engine should therefore follow this abstract sequence:

1. generate candidate interpretations from the mission
2. apply project and environment constraints
3. rank hypotheses and candidate lanes
4. extract or confirm the authoritative requirement source
5. extract acceptance points when applicable
6. choose the highest-value next probe or question
7. commit to a lane
8. execute and observe
9. diagnose on failure
10. persist positive and negative learnings

This makes the design generic beyond Flutter while keeping Flutter as the first implemented adapter.

## Memory Model

The agent needs local memory not just to retain context, but to actively suppress repeated mistakes.

This memory should be split into different scopes with different retention behavior.

### 1. Run memory

Scope: current mission only.

Purpose:

- remember what has already been tried in the current run
- prevent immediate repetition
- preserve local hypotheses and invalidated assumptions

Contents:

- attempted actions
- attempt fingerprints
- observed failures
- current evidence
- current strategy

### 2. Project memory

Scope: current repository.

Purpose:

- store stable project facts
- reduce repeated environment discovery
- record app-specific conventions

Contents:

- project type
- known launch commands
- known test accounts or fixtures when explicitly configured
- known service dependencies
- known renderer defaults
- known semantics requirements

### 3. Failure memory

Scope: repository and optionally framework-wide.

Purpose:

- store reusable negative knowledge
- block repeated bad strategies

This is the most important memory layer.

Example:

```json
{
  "kind": "failure_pattern",
  "scope": "project",
  "framework": "flutter",
  "target": "web-chrome",
  "fingerprint": "flutter-web-canvas-dom-selector-failure",
  "conditions": {
    "renderer": "canvaskit",
    "mode": "inspect"
  },
  "badAction": "use_dom_selector_as_primary_assertion",
  "reason": "canvas-backed UI does not provide stable DOM nodes for core flow assertions",
  "recommendedAlternative": "use_flutter_drive_or_semantics",
  "confidence": 0.95
}
```

### 4. Recipe memory

Scope: repository and framework-wide.

Purpose:

- store successful execution recipes
- reuse proven paths before inventing new ones

Examples:

- Flutter web login flow: prefer `flutter drive -d chrome`
- on failure: collect console, screenshot, semantics snapshot

## Memory Storage

The first version should use local structured files, not a vector database.

Reason:

- easier to audit
- deterministic matching by fingerprint and conditions
- lower implementation complexity
- better fit for "do not repeat known bad actions"

Suggested layout:

```text
.omx/test-agent/
  sessions/
    <mission-id>.json
  traces/
    <mission-id>.jsonl
  decisions/
    <mission-id>.jsonl
  memory/
    project-facts.json
    failure-patterns.jsonl
    successful-recipes.jsonl
    blocked-inputs.jsonl
    decision-records.jsonl
  artifacts/
    <mission-id>/
```

Recommended object types:

- `fact`
- `failure_pattern`
- `successful_recipe`
- `blocked_by_missing_input`
- `decision_record`

Each persisted record should include:

- `id`
- `kind`
- `scope`
- `createdAt`
- `lastConfirmedAt`
- `confidence`
- `evidence`
- `hitCount`
- `expiresAt`
- `invalidatedBy`

This is necessary to avoid stale or incorrect memory poisoning future runs.

## Attempt Fingerprints

Every meaningful execution attempt should generate a normalized fingerprint.

The purpose is to detect when the agent is about to retry the same failed idea with no new evidence.

Conceptual schema:

```ts
type AttemptFingerprint = {
  adapter: string
  framework: string
  target: string
  lane: string
  flow: string
  commandFamily: string
  assertionMode: string
  environmentKey: string
}
```

Example:

```json
{
  "adapter": "flutter",
  "framework": "flutter",
  "target": "web-chrome",
  "lane": "inspect",
  "flow": "login",
  "commandFamily": "dom-interaction",
  "assertionMode": "dom-primary",
  "environmentKey": "renderer=canvaskit"
}
```

Before executing an action, the planner should ask:

1. has this fingerprint already failed in the current run
2. has a highly similar fingerprint already failed in memory
3. what new evidence makes this retry meaningfully different

If the answer to the third question is "none", the action should be blocked.

## Failure Reflection

Every failed attempt should produce a structured reflection object.

The goal is to force the agent to explain what changed, what was disproven, and why the next step is different.

Conceptual schema:

```json
{
  "failureFingerprint": "chrome-opened-but-login-not-observable",
  "likelyLayer": "assertion_layer",
  "invalidatedAssumption": "DOM can expose the login button reliably",
  "newEvidence": [
    "CanvasKit active",
    "No stable DOM node for submit button",
    "Console has no fatal errors"
  ],
  "nextStrategy": "switch_to_flutter_drive",
  "persistToFailureMemory": true
}
```

Without this reflection step, the agent is likely to repeat the same high-level strategy using slightly different prompts or commands.

## Stuck Detector

The test agent should have an explicit stuck detector.

The agent is `stuck` when it is no longer producing meaningful strategy change or new evidence.

### Stuck signals

The detector should trigger when one or more of the following are true:

- the same attempt fingerprint fails twice in one mission
- two consecutive failures map to the same failure fingerprint
- the plan changed only superficially but the assertion mode stayed the same
- no new evidence was collected between retries
- the agent has retried equivalent command families under equivalent conditions

### On stuck

When the detector fires, the agent must not continue along the same lane.

It must do exactly one of these:

1. switch execution lane
2. switch assertion mode
3. move from execute to diagnose
4. downgrade scope and continue
5. stop and report a blocked condition

Only guided mode may replace step 4 with a user question.

Examples:

- from `chrome-inspect` to `flutter-drive`
- from DOM assertions to semantics assertions
- from repeated rerun to environment diagnosis
- from incomplete validation to explicit `unverified` output in full-auto mode

## Planning Gate With Memory

Memory must be consulted before every new strategy, not just after failure.

The planning gate should run in this order:

1. read current reasoning state
2. load relevant run memory
3. retrieve matching project facts
4. retrieve matching failure patterns
5. retrieve matching successful recipes
6. generate candidate strategies
7. reject strategies blocked by failure memory
8. rank strategies that have prior success evidence
9. select the highest-ranked non-blocked strategy

This matters because the most valuable memory behavior is preventive, not retrospective.

## Write Rules

Memory should not be written on every step.

Write only when one of these is true:

- a previously held assumption was clearly disproven
- a strategy failed repeatedly enough to deserve a reusable failure pattern
- a strategy succeeded and appears reusable
- the user corrected the agent with durable project knowledge
- a stable environment fact was confirmed

This is necessary to keep local memory precise instead of turning it into an untrusted log dump.

## Negative Memory Priority

Negative memory should have higher planning priority than recipe memory.

In other words:

- "do not repeat this strategy under these conditions" is stronger than
- "this strategy sometimes worked elsewhere"

Example high-priority negative rules:

- do not use DOM-primary assertions for CanvasKit-backed Flutter web flows
- do not rerun the same `flutter drive` invocation with no new evidence
- do not claim login is broken when credentials are missing and no valid test account is configured

This priority rule is required to prevent optimistic but repetitive planning.

## Formal State Machine

The agent should use an explicit finite-state machine rather than an informal loop.

The state machine exists to guarantee:

- bounded progress
- observable transitions
- deterministic stop behavior
- separation between planning, execution, observation, and stopping

### Primary states

Recommended primary states:

```ts
type MissionState =
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
```

Interpretation:

- `received`: mission exists, no routing yet
- `interpreted`: core intent extracted
- `requirement_framed`: requirement source and acceptance points established or downgraded
- `assumptions_checked`: safe assumptions and missing inputs resolved into policy
- `adapter_selected`: concrete adapter and target chosen
- `strategy_built`: candidate plan exists
- `preflight_running`: environment validation in progress
- `preflight_failed`: preflight could not satisfy current plan
- `ready_to_execute`: plan is executable
- `running`: a concrete lane is executing
- `observed`: execution output normalized into evidence
- `diagnosed`: failure or uncertainty has been classified
- `decided`: next control action has been chosen
- `stopping`: final result is being assembled
- `stopped`: terminal state persisted

### Terminal outcomes

Mission outcomes are distinct from machine states.

Recommended terminal outcomes:

```ts
type MissionOutcome =
  | 'matched'
  | 'mismatched'
  | 'unverified'
  | 'blocked'
  | 'error'
```

The machine enters `stopped` with exactly one outcome.

### State events

Recommended transition-triggering events:

```ts
type MissionTransitionEvent =
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
```

### Allowed transitions

Recommended transition map:

```text
received -> interpreted
interpreted -> requirement_framed
requirement_framed -> assumptions_checked
assumptions_checked -> adapter_selected
adapter_selected -> strategy_built
strategy_built -> preflight_running
preflight_running -> ready_to_execute
preflight_running -> preflight_failed
preflight_failed -> diagnosed
ready_to_execute -> running
running -> observed
observed -> diagnosed
diagnosed -> decided
decided -> strategy_built
decided -> ready_to_execute
decided -> stopping
stopping -> stopped
```

Forbidden transitions:

- `running -> running` without a new execution event
- `observed -> running` without passing through `diagnosed` and `decided`
- `preflight_failed -> running`
- `decided -> decided` without a new decision record
- `stopped -> *`

### State invariants

Each state should enforce simple invariants.

- `interpreted`: mission intent must be present
- `requirement_framed`: requirement source policy must be present, even if downgraded to `unknown`
- `adapter_selected`: adapter and target must be selected
- `strategy_built`: at least one candidate strategy must have been evaluated
- `ready_to_execute`: selected strategy must not be blocked
- `observed`: at least one observation or artifact must have been recorded
- `diagnosed`: diagnosis summary must exist
- `decided`: one control action must be selected
- `stopping`: terminal outcome draft must exist
- `stopped`: final outcome and stop reason must be persisted

### Control action model

The `decided` state should choose exactly one control action.

```ts
type ControlAction =
  | 'commit_next_strategy'
  | 'switch_lane'
  | 'downgrade_scope'
  | 'stop_with_result'
  | 'stop_with_blocker'
```

This action is the only legal output of the decision phase in full-auto mode.

## State Transitions

The agent should be modeled as a state machine, not an open-ended dialogue.

Suggested transition skeleton:

```text
received
-> interpreted
-> assumptions_checked
-> adapter_selected
-> strategy_built
-> preflight_done
-> running
-> observed
-> diagnosed
-> decided
-> done
```

Allowed failure transitions:

- `preflight_done -> diagnosed`
- `running -> observed`
- `observed -> diagnosed`
- `diagnosed -> strategy_built`
- `diagnosed -> done`

There should be no direct transition from repeated failure back to `running` without passing through `diagnosed` and the planning gate.

## Stop Rule Set

Stop rules should be explicit, ordered, and evaluated on every `decide` phase.

The purpose of stop rules is to ensure that full-auto mode terminates cleanly instead of drifting into repetitive retries.

### Stop rule evaluation order

Recommended priority order:

1. fatal system error
2. hard constraint blocker
3. goal-complete
4. stuck
5. budget exhausted
6. evidence exhausted
7. continue

This priority matters because some states should stop immediately even if more retries are technically possible.

### Stop rule schema

Conceptual schema:

```ts
type StopRuleEvaluation = {
  ruleId: string
  missionId: string
  phase: 'decide'
  matched: boolean
  priority: number
  reasonSummary: string
  evidenceRefs: string[]
  resultingAction:
    | 'stop_with_result'
    | 'stop_with_blocker'
    | 'downgrade_scope'
    | 'continue'
  resultingOutcome?: MissionOutcome
}
```

### Stop rules

#### Rule 1. Fatal system error

Condition:

- runtime invariants broken
- trace write failure that prevents safe continuation
- internal executor failure with no recovery path

Action:

- `stop_with_blocker`

Outcome:

- `error`

#### Rule 2. Hard constraint blocker

Condition:

- required environment dependency missing
- no runnable target exists
- no fallback lane exists

Action:

- `stop_with_blocker`

Outcome:

- `blocked`

#### Rule 3. Goal-complete

Condition:

- all acceptance points resolved
- or enough evidence exists to conclude mismatch conclusively

Action:

- `stop_with_result`

Outcome:

- `matched` or `mismatched`

#### Rule 4. Stuck

Condition:

- stuck detector fires
- no materially different strategy remains

Action:

- prefer `downgrade_scope` if unresolved points can still be reported
- otherwise `stop_with_blocker`

Outcome:

- `unverified` or `blocked`

#### Rule 5. Budget exhausted

Condition:

- attempts exceed limit
- lane switches exceed limit
- mission time exceeds limit
- token or compute budget exceeded

Action:

- `stop_with_result`

Outcome:

- typically `unverified`

#### Rule 6. Evidence exhausted

Condition:

- no additional requirement source can be found
- all viable lanes and probes exhausted
- no new evidence source remains

Action:

- `stop_with_result`

Outcome:

- `unverified`

#### Rule 7. Continue

Condition:

- at least one non-blocked, materially different strategy remains

Action:

- `continue`

Outcome:

- none yet

### Budget defaults

The first implementation should define simple mission budgets.

Suggested defaults:

- `maxAttemptsPerMission`
- `maxLaneSwitchesPerMission`
- `maxMissionDurationMs`
- `maxDiagnosesPerMission`

These should be recorded in mission state and evaluated by stop rules.

### Stop rule design principle

A stop rule should never depend on opaque internal model confidence alone.

It should depend on observable facts such as:

- attempts
- artifacts
- failure fingerprints
- constraint failures
- strategy availability
- elapsed time

This is necessary for deterministic debugging and operator trust.

## Preflight Checks

The Flutter adapter should fail fast on:

- `flutter` not installed
- `flutter doctor` fatal issues
- Chrome not visible in `flutter devices`
- `chromedriver` missing for `drive` mode
- missing `integration_test/` target in `drive` mode
- no web semantics contract in `inspect` mode when DOM/ARIA assertions are requested
- requirement source missing when the mission is explicitly requirement-driven and no safe fallback source exists

In full-auto mode, preflight failures should never trigger a question by default.

They should produce either:

- an automatic fallback lane
- a reduced-scope execution plan
- or a terminal blocked result

## Phased Delivery

### Phase 1: Flutter MVP

Ship:

- `test-agent` subcommand
- Flutter project detection
- mission interpretation
- requirement source framing
- `drive` mode
- Chrome launch through Flutter tooling
- structured JSON summary
- artifact capture for stdout/stderr

Do not ship yet:

- browser-side semantics inspection
- screenshot diffs
- auto-repair loops

### Phase 2: Browser Inspection

Ship:

- `inspect` mode
- acceptance-point-aware verification routing
- semantics-host snapshot collection
- console + network collection
- screenshot capture

### Phase 3: Hybrid Agent Loop

Ship:

- `hybrid` mode
- requirement comparison report
- failure triage with correlated artifacts
- bounded auto-fix + rerun loop
- CI-friendly reports such as JUnit

## Key Tradeoffs

### Why not use browser automation as the main Flutter test engine?

Because Flutter web is not DOM-first. Browser automation should observe and debug, not own all core assertions.

### Why not force the full conversational agent loop from day one?

Because the first deliverable should be deterministic test execution, not open-ended agent behavior.

### Why not anchor on old HTML renderer assumptions?

Because current Flutter web guidance is centered on `canvaskit` and `skwasm`, and older HTML-backend-centric workarounds are not the right baseline anymore.

## Open Questions

1. Should `test-agent` be a pure subcommand, or a thin wrapper over `--print --output-format stream-json`?
2. Should artifact storage live under `.artifacts/`, `.omx/`, or a dedicated test-output directory?
3. Should browser inspection use the existing Chrome MCP implementation, or a separate provider with less user-session coupling?
4. Should Phase 1 support only `flutter drive`, or also `flutter test integration_test/...` when appropriate?
5. Should `--wasm` be automatic, opt-in, or matrixed?

## Recommendation

Build the Flutter test agent in this order:

1. `test-agent` core with mission object + adapter interface
2. requirement-source framing + acceptance-point extraction
3. Flutter `drive` mode on `web-chrome`
4. structured artifacts and requirement-aware summaries
5. semantics-aware browser inspection mode
6. hybrid repair loop

That order solves the user's immediate need, which is broader than "launch Chrome and run tests".

It supports the actual high-frequency task:

- the user finished Flutter frontend work
- the user wants the agent to verify whether the implementation matches the requirement

## References

- Flutter integration tests: https://docs.flutter.dev/testing/integration-tests
- Flutter web accessibility: https://docs.flutter.dev/ui/accessibility/web-accessibility
- Flutter accessibility testing: https://docs.flutter.dev/ui/accessibility/accessibility-testing
- Flutter web renderers: https://docs.flutter.dev/platform-integration/web/renderers
- Flutter web golden comparator breaking change: https://docs.flutter.dev/release/breaking-changes/web-golden-comparator
