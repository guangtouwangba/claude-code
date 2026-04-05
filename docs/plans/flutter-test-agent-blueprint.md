# Flutter Test Agent Blueprint

## Purpose

This document defines the intended human-agent interaction model for a Flutter Test Agent.

It does not focus on low-level runtime architecture.

It focuses on:

- how users express testing intent
- how the agent interprets vague requests
- what the agent should ask, assume, or infer
- how progress, uncertainty, and results should be presented
- what primary usage scenarios the product should support

## Product Goal

The Flutter Test Agent should let a user describe a testing goal in natural language and receive a structured, observable, low-friction testing workflow in return.

The ideal interaction is:

1. the user describes a flow or quality goal
2. the agent identifies the likely app type, test lane, and evidence requirements
3. the agent executes the smallest reliable strategy first
4. the agent reports results with artifacts and plain-language conclusions
5. the agent avoids repeating failed strategies without new evidence

In many real workflows, the user's actual goal is more specific:

> I finished the Flutter frontend. Verify whether the implementation matches the requirement.

The Flutter Test Agent should therefore be designed not only as a flow runner, but as a requirement-to-behavior verifier.

## Interaction Principles

### 1. Intent-first

Users should not need to think in terms of `flutter drive`, `chromedriver`, or renderer details.

They should be able to say:

- `测试登录流程`
- `帮我测一下注册流程`
- `启动 Chrome 测一下支付流程`
- `看下这个 Flutter web 的下单流程是不是通的`

The agent should translate intent into a test mission.

### 2. Progressive disclosure

The agent should not front-load every detail.

It should reveal:

- what it inferred
- what it still needs
- what it is going to do next

Only when that information matters.

### 3. Lowest-friction reliable path

If a flow can be validated with a reliable default strategy, the agent should just start.

If key information is missing, the default behavior should be to continue automatically using the safest fallback, the narrowest reliable assumption, or a reduced verification scope.

The product should be designed `full-auto first`.

### 4. Evidence-first reporting

The agent should not merely say:

- `通过了`
- `失败了`

It should say:

- what it tried
- what evidence it collected
- what conclusion that evidence supports

### 5. Strategy transparency

The user should always be able to see:

- which lane the agent chose
- why it chose that lane
- what fallback it will use if the first path fails

### 6. Requirement-aware validation

When the user asks whether the implementation matches requirements, the agent should not reduce the task to "does the flow run".

It should explicitly separate:

- what the requirement says
- what is observable in the current implementation
- what could be verified
- what could not yet be verified

This distinction is critical for frontend validation work.

## Requirement-Driven Testing

This should be treated as a first-class interaction pattern.

Typical user requests:

- `我写完了 Flutter 前端，帮我测下是不是和需求一致`
- `帮我验证这个页面是不是按 PRD 做的`
- `这个登录页是不是符合需求要求`
- `你按照需求帮我验一下这个流程`

In this mode, the agent should behave differently from simple flow testing.

Its job is to compare three things:

1. requirement source
2. implemented UI and behavior
3. observable evidence from execution

### Requirement sources

The agent should support requirements from:

- a user message
- a markdown doc
- a PRD file
- acceptance criteria in issue text
- inline bullets supplied in chat

### Agent behavior in requirement-driven mode

The agent should:

1. extract requirement statements
2. normalize them into testable acceptance points
3. identify which points are behavior-based, visual, structural, or content-based
4. choose the right test lane per point
5. produce a gap report, not just a pass/fail

This mode should end with:

- verified items
- failed items
- unverified items
- missing-input items

## Acceptance-Point Extraction

When the user gives high-level requirements, the agent should transform them into a compact acceptance list before execution.

Example user request:

```text
我写完了 Flutter 登录页，帮我测试是不是符合需求：
1. 默认显示手机号登录
2. 验证码按钮 60 秒倒计时
3. 提交成功后进入首页
4. 错误时显示 toast
```

The agent should internally normalize this into something like:

```text
Acceptance Points
- AP1: 默认进入手机号登录模式
- AP2: 点击获取验证码后按钮进入 60 秒倒计时
- AP3: 提交成功后页面进入首页状态
- AP4: 提交失败时显示错误反馈
```

These acceptance points should then drive the execution plan and final report.

The agent should not jump directly from raw requirements to execution without this normalization step.

## Primary Interaction Modes

The product should support four user-facing modes, with full-auto as the default operating posture.

### 1. Full-auto mode

This should be the default mode.

The user gives a goal and the agent never pauses waiting for clarification.

Instead, the agent must do one of the following:

- infer and continue
- downgrade scope and continue
- switch strategy automatically
- stop with `blocked` or `unverified`

Examples:

- `测试登录流程`
- `我写完了 Flutter 页面，帮我看是不是符合需求`
- `启动 Chrome 测一下注册流程`

Agent behavior:

1. infer app and platform
2. locate requirement source if implied
3. choose the best available lane
4. continue even when some data is missing
5. mark unverifiable parts explicitly instead of waiting for user input

### 2. Direct goal mode

The user gives one sentence.

Examples:

- `测试登录流程`
- `启动 Chrome 测一下首页到下单流程`
- `我写完了 Flutter 页面，帮我看是不是符合需求`

Agent behavior:

1. infer Flutter project type if possible
2. infer likely target platform
3. choose default lane
4. if requirements are implied, search for requirement source or use the best available one
5. present a short mission summary
6. begin execution

This is the normal user-facing expression style, and it usually runs under full-auto mode.

### 3. Guided mode

The user has an intent, but the flow or success criteria are unclear.

Examples:

- `测一下支付`
- `看看这个 app 能不能走通`

Agent behavior:

1. narrow the intent
2. identify missing inputs
3. ask only for the minimum required details

This mode is optional, not the default.

Questions should be precise, such as:

- `支付成功的判定是跳转成功页，还是只看接口返回成功？`
- `登录流程用哪个测试账号？`
- `需求是以哪个文档为准？`
- `你要我验证交互逻辑，还是连视觉/文案也一起对照？`

### 4. Operator mode

The user wants explicit control.

Examples:

- `只启动 Chrome，不要自动修复`
- `先做 smoke test，再决定要不要跑完整流程`
- `只抓失败截图和 console`

Agent behavior:

- honor explicit constraints
- reduce autonomy
- keep all reporting structured

## Agent Response Pattern

For each mission, the agent should communicate in a stable sequence.

### Step 1. Mission interpretation

The agent should first reflect back what it thinks the request means.

Example:

```text
Mission
- Flow: 登录流程
- Detected app: Flutter web
- Target: Chrome
- Mode: hybrid
```

This gives the user a quick chance to spot a wrong assumption.

### Step 1.5. Requirement framing

When the request is requirement-driven, the agent should surface the requirement basis explicitly.

Example:

```text
Requirement Basis
- Source: 用户消息中的 4 条验收要求
- Validation Scope: 交互 + 反馈 + 跳转
- Not Included Yet: 像素级视觉一致性
```

### Step 2. Execution plan

The agent should summarize the immediate plan in compact language.

Example:

```text
Plan
- 检查 Flutter + Chrome 环境
- 先走 Flutter 原生测试链路
- 失败时补抓 screenshot、console、semantics
```

### Step 3. Live progress

Progress updates should be concise and action-oriented.

Examples:

- `正在检查 Chrome 和 chromedriver`
- `已启动 Flutter web，准备进入登录流程`
- `原生断言失败，切换到浏览器观察模式`

### Step 4. Conclusion

The final report should always contain:

- status
- conclusion
- evidence
- next recommendation

Example:

```text
Result
- Status: failed
- Conclusion: 登录提交已触发，但认证接口返回 401
- Evidence: screenshot, browser console, Flutter test log
- Next: 提供有效测试账号后重跑
```

## Interaction Contract For Ambiguity

The agent should classify ambiguity into three types.

### 1. Safe-to-assume ambiguity

Examples:

- default platform is web when Chrome is explicitly requested
- default first pass is smoke or happy-path validation

The agent should proceed automatically.

### 2. Must-confirm ambiguity

Examples:

- no valid success criterion
- no available test credentials
- multiple possible flows match the same phrase
- no clear requirement source when the user asks for requirement matching

In `guided` mode, the agent should ask a minimal question.

In `full-auto` mode, the agent should not ask.

It should instead:

- choose the highest-confidence interpretation
- continue with partial verification where possible
- mark blocked or unverified items explicitly in the output

### 3. Recoverable ambiguity

Examples:

- exact page path unknown
- test file not yet present
- semantics not enabled

The agent should try a best-effort path first, then report the gap if it blocks progress.

## Full-Auto Rule Set

Full-auto mode is the default system behavior.

In this mode, the agent must never pause waiting for user input.

Instead, when required information is missing, it must choose one of four automatic actions:

1. safe assumption
2. scope downgrade
3. strategy switch
4. terminal stop with explicit blocker or unverified result

### Full-auto examples

If no requirement source is available:

- search the repo for PRD, markdown, issue text, or acceptance bullets
- if no authoritative source is found, continue with best-effort validation
- report the result as partially verified or unverified where appropriate

If no valid test credential is available:

- verify anonymous or pre-login acceptance points
- mark credential-dependent points as `unverified`

If multiple flows are plausible:

- choose the highest-confidence flow
- record alternatives in trace

If the current lane fails:

- switch lane automatically if a better fallback exists

If all viable strategies fail:

- stop with a structured blocker report

## Suggested User Mental Model

Users should experience the agent as a test operator, not as a generic chat assistant.

The agent should feel like:

- a test lead when interpreting goals and requirements
- a QA runner when executing
- a debugger when diagnosing failure
- a reviewer when comparing implementation against acceptance points
- a reporter when summarizing evidence

It should not feel like:

- a shell wrapper
- a vague brainstorming bot
- a fully silent autonomous daemon

## Usage Scenarios

### Scenario 1. Happy-path flow validation

User:

```text
测试登录流程
```

Expected behavior:

1. detect Flutter app
2. choose `web-chrome` if the user environment supports it
3. run the default login flow path
4. report pass/fail with artifacts

Primary value:

- fast regression checking
- low-friction natural language testing

### Scenario 2. Requirement-matching validation

User:

```text
我写完了 Flutter 前端，帮我看是不是和需求一致
```

Context:

- the user has already implemented the page or flow
- the real question is whether the implementation matches intended behavior

Expected behavior:

1. locate the requirement source or use the best available one automatically
2. extract acceptance points
3. map each point to a verification method
4. run tests and observations
5. return a compliance-style report

Primary value:

- validates implementation against intent
- turns vague review requests into observable checks

### Scenario 3. Browser-visible validation

User:

```text
启动 Chrome 测一下注册流程
```

Expected behavior:

1. prioritize Chrome-backed execution
2. use Flutter-native assertions for core logic
3. use browser inspection for screenshot, console, semantics

Primary value:

- validates what the user can visually observe
- useful for Flutter web flows where browser behavior matters

### Scenario 4. Missing credentials

User:

```text
测试支付流程
```

Context:

- payment requires test credentials or sandbox account

Expected behavior:

1. detect missing credential dependency
2. avoid pretending the flow can fully pass
3. continue with the verifiable subset automatically
4. mark credential-dependent acceptance points as `unverified`

Primary value:

- avoids fake confidence
- keeps user interaction focused

### Scenario 5. Flaky or blocked test path

User:

```text
测一下下单流程
```

Context:

- initial attempt fails

Expected behavior:

1. diagnose whether failure is environment, interaction, assertion, or backend related
2. do not repeat the same strategy without new evidence
3. switch lane if needed
4. explain why the new lane is different

Primary value:

- intelligent recovery
- reduces wasted retries

### Scenario 6. Post-fix verification

User:

```text
刚修完登录问题，帮我复测
```

Expected behavior:

1. identify likely affected flow
2. prefer a focused regression path rather than a full sweep
3. report whether the fix holds
4. mention any residual risk

Primary value:

- fast developer feedback loop

### Scenario 7. Exploratory smoke testing

User:

```text
看下这个 app 基本流程是不是通的
```

Expected behavior:

1. decompose into likely key flows
2. run a lightweight pass
3. report what was covered and what was not

Primary value:

- useful for onboarding, demos, and early-stage QA

## Requirement Comparison Report

When the task is "test whether this frontend matches the requirement", the final output should not be a generic test result.

It should be a comparison report with explicit requirement coverage.

Suggested output shape:

```text
Requirement Report
- AP1: pass
  reason: 默认进入手机号登录模式
  evidence: initial screenshot + semantics text
- AP2: fail
  reason: 验证码倒计时只显示 30 秒，不是需求要求的 60 秒
  evidence: interaction recording + button state log
- AP3: unverified
  reason: 缺少可用测试账号，无法验证成功跳转
- AP4: pass
  reason: 错误提交后出现 toast
  evidence: screenshot + console
```

This reporting style is closer to how developers and PMs reason about requirement compliance.

## Verification Dimensions

When comparing implementation to requirements, the agent should classify each requirement into one or more dimensions:

- behavior
- visual structure
- copy or content
- state transition
- error handling
- accessibility or semantics

This matters because not all requirements should be validated the same way.

Examples:

- behavior: use Flutter-native assertions
- visual structure: use screenshot and browser inspection
- copy or content: use text extraction
- accessibility: use semantics snapshot when available

## Human-Agent Loop For Finished Frontend Work

This is the most important end-to-end interaction pattern for day-to-day use.

### User intent

The user has already built the page or flow and now wants the agent to act like a requirement-aware tester.

Typical requests:

- `页面我写完了，帮我测一下是不是符合需求`
- `这个 Flutter 页面你按需求帮我验一遍`

### Recommended interaction sequence

1. user gives validation request
2. agent identifies the requirement source
3. agent extracts acceptance points
4. agent states scope and non-scope
5. agent runs focused verification
6. agent returns a requirement comparison report
7. agent recommends next action only where there is a real gap

### Key UX rule

The agent should frame the result as:

- matched
- mismatched
- not yet verified

not merely:

- pass
- fail

That wording better matches the user's actual question.

## Human Control Levels

The blueprint should support clear levels of autonomy.

### Level 1. Full automatic

The user gives a goal and the agent acts without asking follow-up questions.

Best for:

- common regressions
- repeated validation
- CI-adjacent local use
- default developer workflow

### Level 2. Guided automatic

The user gives a goal, and the agent asks only for missing essentials.

Best for:

- flows with business-specific criteria
- flows needing credentials or fixture setup

### Level 3. Constrained execution

The user sets boundaries, such as:

- no code changes
- no auto-fix
- only browser mode
- only smoke test

Best for:

- debugging
- demos
- production-like validation

## Interaction Rules For Failure

When a test fails, the agent should not immediately jump to implementation or code repair.

The interaction contract should be:

1. state what failed
2. state what evidence supports that conclusion
3. classify the failure
4. propose the next action

In full-auto mode, the next action should also be automatic unless the user explicitly requested guided behavior.

Failure classes:

- environment failure
- launch failure
- interaction failure
- assertion failure
- backend dependency failure
- missing-input failure

Example:

```text
Failure
- Class: backend dependency failure
- Reason: 登录请求返回 401
- Evidence: network log + console + unchanged logged-out UI
- Suggested next action: 提供有效测试账号后重跑
```

## Artifact Expectations

From a user interaction perspective, artifacts should be first-class outputs, not internal implementation details.

The most important artifacts are:

- screenshot
- browser console log
- network summary
- Flutter test log
- semantics snapshot when available

The user should be told which artifacts were collected and why they matter.

## Algorithmic Thinking Patterns For Generic Routing

The Flutter Test Agent should not rely on a single ad hoc intuition loop to move from vague requests to actionable test plans.

Instead, it should borrow classic algorithmic thinking patterns as a design language for generic problem solving.

This does not mean the agent must literally execute these textbook algorithms in raw form.

It means the system should adopt their problem-solving shape:

- represent ambiguity as a search problem
- reduce possibility space using constraints
- choose the next question or observation for maximum information gain
- diagnose failure by eliminating competing explanations
- prevent repeated mistakes with explicit negative memory

### Why this matters

A user request such as:

```text
帮我测一下是不是符合需求
```

is not an executable command.

It is an under-specified search space.

The agent must discover:

- what exactly should be tested
- what requirement source is authoritative
- which platform and lane to use
- what evidence counts as verification
- what to do if the first path is wrong

The following algorithmic patterns are a good fit for this kind of generic routing.

## 1. Graph Search

### What it contributes

Graph search is the right mental model for path discovery.

The system can treat each partial interpretation as a node, and each action or observation as an edge.

Example:

- node A: user wants a flow test
- node B: user wants requirement comparison
- node C: user wants browser-visible validation
- edge: inspect repo
- edge: locate PRD
- edge: ask a clarifying question
- edge: run Flutter-native lane

### Most useful variant

Best-first search or A-star style thinking is more useful than blind traversal.

The agent should prefer paths that are:

- lower cost
- lower risk
- higher confidence
- more likely to produce disambiguating evidence

### Product mapping

Use this pattern for:

- choosing the first lane
- deciding whether to inspect docs, ask a question, or run a probe
- evaluating fallback strategies

## 2. Constraint Satisfaction

### What it contributes

A large amount of ambiguity can be removed before execution by applying constraints.

Instead of guessing freely, the agent should treat the problem as a partially constrained system.

Variables may include:

- requirement source
- target platform
- validation scope
- available credentials
- execution lane

Constraints may include:

- project is Flutter
- Chrome was explicitly requested
- no requirement source has been given
- no test credential is available
- semantics are disabled

### Product mapping

Use this pattern for:

- pruning impossible interpretations
- reducing candidate plans before search
- deciding what is safe to assume

## 3. Information Gain

### What it contributes

When the agent lacks information, it should not ask arbitrary questions.

It should ask for the smallest input that most reduces uncertainty.

That is the core idea behind information gain.

Good examples:

- `需求以哪个文档为准？`
- `你要我验证功能，还是连文案和视觉也一起对照？`
- `有没有可用测试账号？`

Bad examples:

- `你想让我怎么测？`

### Product mapping

Use this pattern for:

- deciding whether to ask a question or continue
- choosing which clarifying question to ask first
- ordering environment probes and document probes

## 4. Bayesian Updating Or Hypothesis Ranking

### What it contributes

The agent should maintain several competing interpretations at once instead of overcommitting too early.

Examples:

- the user wants a simple flow check
- the user wants requirement compliance
- the user wants visual review
- the user wants post-fix regression

As evidence arrives, the system should update confidence and promote or demote these hypotheses.

### Product mapping

Use this pattern for:

- ranking mission interpretations
- dynamically changing the preferred lane
- deciding whether the task is still under-specified

## 5. Hierarchical Task Decomposition

### What it contributes

Many user requests are too high-level to execute directly.

The system should break them down into subgoals.

Example:

`验证这个 Flutter 页面是不是符合需求`

becomes:

1. find requirement source
2. extract acceptance points
3. classify verification dimensions
4. choose lane per acceptance point
5. execute checks
6. produce comparison report

This is the same broad thinking pattern as hierarchical task networks or AND-OR decomposition.

### Product mapping

Use this pattern for:

- converting vague goals into mission structure
- building execution plans
- decomposing requirement-driven validation

## 6. Model-Based Diagnosis

### What it contributes

When something fails, the agent should not simply retry.

It should determine which layer most likely failed by eliminating competing explanations.

Possible failure layers:

- environment
- launch
- interaction
- assertion
- backend dependency
- requirement-source mismatch

Example:

- Chrome started successfully
- Flutter page rendered
- button click fired
- auth request returned 401

The likely failure is not the browser lane itself.
It is a backend dependency or credential problem.

### Product mapping

Use this pattern for:

- failure classification
- deciding whether to rerun, switch lane, or stop
- producing trustworthy explanations

## 7. Tabu Search And Negative Memory

### What it contributes

A generic agent needs a mechanism for saying:

`do not try that same idea again under the same conditions`

This is the value of tabu-style thinking.

Examples:

- do not use DOM-primary assertions for CanvasKit-backed Flutter flows
- do not rerun the same failed lane without new evidence
- do not claim success-path verification when valid credentials are missing

### Product mapping

Use this pattern for:

- memory-backed planning gates
- repeated-failure suppression
- stuck detection

## 8. Case-Based Reasoning

### What it contributes

The system should reuse prior solved cases rather than rediscovering a plan from zero every time.

Examples:

- Flutter web login validation
- OTP countdown verification
- requirement comparison against PRD bullets

The agent should look for similar prior missions and adapt them.

### Product mapping

Use this pattern for:

- selecting known-good recipes
- speeding up common validation tasks
- improving consistency across runs

## Recommended Combined Pattern

The most useful generic combination is:

1. graph search for candidate path discovery
2. constraint satisfaction for pruning
3. information gain for choosing the next question or probe
4. hypothesis ranking for adaptive confidence updates
5. hierarchical decomposition for turning goals into executable plans
6. diagnosis for failure handling
7. tabu memory for blocking repeated mistakes
8. case-based reasoning for reusing proven paths

This combination is well suited for generic test-agent routing because it covers:

- ambiguity
- planning
- execution
- failure recovery
- learning from prior runs

## Generic Routing Sequence

The blueprint should treat generic routing as the following abstract process:

1. generate candidate interpretations
2. prune using project and environment constraints
3. rank the remaining hypotheses
4. ask or probe for the highest-information next signal
5. choose the current best path
6. execute and observe
7. diagnose on failure
8. persist positive and negative learnings

This sequence is generic enough to apply beyond Flutter.

It can support:

- frontend requirement validation
- flow testing
- post-fix verification
- exploratory smoke checks

## Design Rule

The important takeaway is:

The agent should not pretend ambiguity can be solved by "more intelligence" alone.

It should solve ambiguity by combining:

- search
- constraints
- evidence collection
- diagnosis
- memory

That makes the system more predictable, more generic, and more robust under vague user requests.

## What The Agent Should Never Do

The interaction model should explicitly avoid these behaviors:

- ask broad vague questions when a narrow one is sufficient
- silently retry the same failed path
- claim confidence without evidence
- hide lane switches from the user
- present every internal detail when a simple conclusion is enough
- confuse "could not verify" with "failed"
- confuse "flow runs" with "requirement is satisfied"
- report visual or product compliance without stating what source requirement it compared against
- block indefinitely waiting for missing input in default mode

## Future UX Extensions

This blueprint should leave room for:

- mission templates such as `login`, `checkout`, `signup`, `smoke`
- saved project flow aliases
- reusable success criteria
- shared team recipes
- one-command rerun of a previous mission

## Summary

The Flutter Test Agent should feel like a focused QA operator with strong runtime intelligence.

Its interaction model should be:

- natural-language in
- structured mission interpretation
- compact visible planning
- reliable execution
- evidence-backed conclusion
- full-auto by default, with explicit unverified or blocked outcomes instead of waiting

The primary usage scenarios should center on:

- flow validation
- requirement-matching validation for completed Flutter frontend work
- browser-visible testing
- post-fix verification
- exploratory smoke testing
- failure diagnosis without repetitive retries
