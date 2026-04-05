/**
 * Flutter Test Agent — Generic Routing Engine
 *
 * Algorithmic thinking patterns for routing from ambiguity to execution.
 * Generates hypotheses, applies constraints, ranks candidates, and selects
 * the best probe to resolve uncertainty before committing to a strategy.
 */

import type {
  MissionIntentKind,
  MissionTransitionEvent,
  RoutingConstraint,
  RoutingHypothesis,
  RoutingProbe,
  TestMission,
} from '../types'

// ---------------------------------------------------------------------------
// Internal cost ordering for tie-breaking (lower = cheaper)
// ---------------------------------------------------------------------------

const LANE_COST: Record<MissionIntentKind, number> = {
  flow_validation: 1,
  requirement_validation: 2,
  post_fix_verification: 3,
  exploratory_smoke: 4,
}

// ---------------------------------------------------------------------------
// Base confidence for each intent kind
// ---------------------------------------------------------------------------

const BASE_CONFIDENCE: Record<MissionIntentKind, number> = {
  flow_validation: 0.7,
  requirement_validation: 0.65,
  post_fix_verification: 0.75,
  exploratory_smoke: 0.55,
}

// ---------------------------------------------------------------------------
// generateHypotheses
// ---------------------------------------------------------------------------

export function generateHypotheses(mission: TestMission): RoutingHypothesis[] {
  const kinds: MissionIntentKind[] = [
    'flow_validation',
    'requirement_validation',
    'post_fix_verification',
    'exploratory_smoke',
  ]

  return kinds.map((kind): RoutingHypothesis => {
    // Boost confidence when the mission intent already matches this hypothesis
    const intentMatch = mission.intent.kind === kind ? mission.intent.confidence : 0
    const baseConf = BASE_CONFIDENCE[kind]
    // Weighted blend: 60% base heuristic, 40% intent signal
    const confidence = Math.min(1, baseConf * 0.6 + intentMatch * 0.4)

    const constraints: string[] = []

    // Requirement validation needs an authoritative requirement source
    if (kind === 'requirement_validation') {
      constraints.push('authoritative_requirement_source')
    }
    // Post-fix verification implies there was a prior fix to verify
    if (kind === 'post_fix_verification') {
      constraints.push('prior_fix_exists')
    }
    // Flow validation and smoke need a runnable app
    if (kind === 'flow_validation' || kind === 'exploratory_smoke') {
      constraints.push('app_runnable')
    }

    return {
      id: crypto.randomUUID(),
      label: `${kind.replace(/_/g, ' ')} — ${mission.target.platform}`,
      intentKind: kind,
      confidence,
      constraints,
      blockedBy: [],
    }
  })
}

// ---------------------------------------------------------------------------
// applyConstraints
// ---------------------------------------------------------------------------

export function applyConstraints(
  hypotheses: RoutingHypothesis[],
  constraints: RoutingConstraint[],
): RoutingHypothesis[] {
  const constraintMap = new Map<string, RoutingConstraint>(
    constraints.map((c) => [c.name, c]),
  )

  return hypotheses.map((h): RoutingHypothesis => {
    const blockedBy: string[] = []
    let confidenceMultiplier = 1.0

    for (const constraintName of h.constraints) {
      const constraint = constraintMap.get(constraintName)
      if (constraint === undefined) {
        // Unknown constraint: mildly penalise
        confidenceMultiplier *= 0.9
        continue
      }
      if (!constraint.satisfied) {
        blockedBy.push(constraintName)
      } else {
        // Satisfied constraint: slight boost
        confidenceMultiplier *= 1.05
      }
    }

    return {
      ...h,
      blockedBy,
      confidence: Math.min(1, h.confidence * confidenceMultiplier),
    }
  })
}

// ---------------------------------------------------------------------------
// rankHypotheses
// ---------------------------------------------------------------------------

export function rankHypotheses(hypotheses: RoutingHypothesis[]): RoutingHypothesis[] {
  return [...hypotheses].sort((a, b) => {
    // Primary: confidence descending
    const confDiff = b.confidence - a.confidence
    if (Math.abs(confDiff) > 0.001) {
      return confDiff
    }
    // Tie-break: prefer lower-cost intent kind
    return LANE_COST[a.intentKind] - LANE_COST[b.intentKind]
  })
}

// ---------------------------------------------------------------------------
// selectBestProbe
// ---------------------------------------------------------------------------

export function selectBestProbe(
  hypotheses: RoutingHypothesis[],
  availableProbes: RoutingProbe[],
): RoutingProbe | null {
  // Uncertainty is meaningful only when top two hypotheses are close
  const ranked = rankHypotheses(hypotheses)
  const top = ranked[0]
  const second = ranked[1]

  if (top === undefined) {
    return null
  }

  // If the top hypothesis is highly confident (≥0.85), no probe needed
  if (top.confidence >= 0.85) {
    return null
  }

  // If there's a meaningful gap to second place, also no probe needed
  if (second === undefined || top.confidence - second.confidence >= 0.2) {
    return null
  }

  // Choose the probe with the highest information gain
  const sorted = [...availableProbes].sort((a, b) => b.informationGain - a.informationGain)
  const best = sorted[0]

  if (best === undefined || best.informationGain < 0.1) {
    // No probe would meaningfully reduce uncertainty
    return null
  }

  return best
}

// ---------------------------------------------------------------------------
// resolveRoute
// ---------------------------------------------------------------------------

export function resolveRoute(
  mission: TestMission,
  projectConstraints: RoutingConstraint[],
): {
  selectedHypothesis: RoutingHypothesis
  probesUsed: RoutingProbe[]
  reasoning: string
} {
  const raw = generateHypotheses(mission)
  const constrained = applyConstraints(raw, projectConstraints)
  const ranked = rankHypotheses(constrained)

  // Filter to non-blocked candidates
  const viable = ranked.filter((h) => h.blockedBy.length === 0)

  if (viable.length === 0) {
    // All hypotheses blocked — pick the least-blocked one
    const fallback = [...ranked].sort((a, b) => a.blockedBy.length - b.blockedBy.length)[0]!
    return {
      selectedHypothesis: fallback,
      probesUsed: [],
      reasoning:
        `All hypotheses blocked by constraints. Fallback to least-blocked: ` +
        `'${fallback.intentKind}' (blocked by: ${fallback.blockedBy.join(', ')}).`,
    }
  }

  const probesUsed: RoutingProbe[] = []

  // Probe loop: keep probing while a useful probe exists and we have candidates
  let current = viable
  // We don't have probe execution capability here — record which would be used
  const candidate = selectBestProbe(current, [])
  // (In a real runtime the caller would execute probes and call back; here we
  //  model the decision without side effects.)

  const selected = current[0]!

  const blockedCount = constrained.filter((h) => h.blockedBy.length > 0).length
  const reasoning =
    `Generated ${raw.length} hypotheses for mission '${mission.intent.kind}'. ` +
    `After applying ${projectConstraints.length} constraints, ${blockedCount} were blocked. ` +
    `Ranked ${viable.length} viable candidates; selected '${selected.intentKind}' ` +
    `with confidence ${selected.confidence.toFixed(3)}. ` +
    (probesUsed.length > 0
      ? `Used ${probesUsed.length} probe(s) to reduce uncertainty.`
      : `No additional probes required.`)

  return {
    selectedHypothesis: selected,
    probesUsed,
    reasoning,
  }
}
