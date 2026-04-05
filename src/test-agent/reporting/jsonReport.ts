/**
 * Flutter Test Agent — JSON Report Generator
 *
 * Generates structured JSON reports from TestSummary objects.
 * Supports requirement_validation (acceptance-point-based) and standard test reports.
 */

import type { AcceptancePoint, TestSummary } from '../../types'

// ---------------------------------------------------------------------------
// Report Shapes
// ---------------------------------------------------------------------------

export type AcceptancePointResult = {
  id: string
  status: 'matched' | 'mismatched' | 'unverified' | 'pending'
  reason?: string
  evidence?: string[]
}

export type AcceptancePointSummary = {
  matched: number
  mismatched: number
  unverified: number
  pending: number
}

export type RequirementValidationReport = {
  framework: string
  mode: string
  target: string
  intent: 'requirement_validation'
  requirementSource: {
    type: string
    path?: string
    isAuthoritative: boolean
  }
  acceptancePoints: AcceptancePointResult[]
  summary: AcceptancePointSummary
  passed: boolean
  totalTests: number
  passedTests: number
  failedTests: number
  skippedTests: number
  duration: number
  artifacts: TestSummary['artifacts']
}

export type StandardTestReport = {
  framework: string
  mode: string
  target: string
  intent: string
  passed: boolean
  totalTests: number
  passedTests: number
  failedTests: number
  skippedTests: number
  duration: number
  artifacts: TestSummary['artifacts']
}

export type JsonReport = RequirementValidationReport | StandardTestReport

// ---------------------------------------------------------------------------
// computeAcceptancePointSummary
// ---------------------------------------------------------------------------

export function computeAcceptancePointSummary(
  points: AcceptancePoint[]
): AcceptancePointSummary {
  const result: AcceptancePointSummary = { matched: 0, mismatched: 0, unverified: 0, pending: 0 }
  for (const point of points) {
    result[point.verificationStatus] += 1
  }
  return result
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildAcceptancePointResult(point: AcceptancePoint): AcceptancePointResult {
  const result: AcceptancePointResult = {
    id: point.id,
    status: point.verificationStatus,
  }
  if (point.reason !== undefined) {
    result.reason = point.reason
  }
  if (point.evidence !== undefined && point.evidence.length > 0) {
    result.evidence = point.evidence
  }
  return result
}

function buildRequirementValidationReport(summary: TestSummary): RequirementValidationReport {
  const points = summary.acceptancePoints ?? []
  const source = summary.requirementSource ?? { type: 'unknown', isAuthoritative: false }

  const requirementSource: RequirementValidationReport['requirementSource'] = {
    type: source.type,
    isAuthoritative: source.isAuthoritative,
  }
  if (source.path !== undefined) {
    requirementSource.path = source.path
  }

  return {
    framework: summary.framework,
    mode: summary.mode,
    target: summary.target,
    intent: 'requirement_validation',
    requirementSource,
    acceptancePoints: points.map(buildAcceptancePointResult),
    summary: computeAcceptancePointSummary(points),
    passed: summary.passed,
    totalTests: summary.totalTests,
    passedTests: summary.passedTests,
    failedTests: summary.failedTests,
    skippedTests: summary.skippedTests,
    duration: summary.duration,
    artifacts: summary.artifacts,
  }
}

function buildStandardReport(summary: TestSummary): StandardTestReport {
  return {
    framework: summary.framework,
    mode: summary.mode,
    target: summary.target,
    intent: summary.intent,
    passed: summary.passed,
    totalTests: summary.totalTests,
    passedTests: summary.passedTests,
    failedTests: summary.failedTests,
    skippedTests: summary.skippedTests,
    duration: summary.duration,
    artifacts: summary.artifacts,
  }
}

function buildReport(summary: TestSummary): JsonReport {
  if (summary.intent === 'requirement_validation') {
    return buildRequirementValidationReport(summary)
  }
  return buildStandardReport(summary)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a pretty-printed JSON report string from a TestSummary.
 * For requirement_validation intent, produces an acceptance-point-based report.
 * For all other intents, produces a standard test counts report.
 */
export function generateJsonReport(summary: TestSummary): string {
  return JSON.stringify(buildReport(summary), null, 2)
}

/**
 * Generate a single-line compact JSON report string for CI/streaming use.
 */
export function generateCompactReport(summary: TestSummary): string {
  return JSON.stringify(buildReport(summary))
}
