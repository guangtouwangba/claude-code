/**
 * Flutter Test Agent — JUnit XML Report Generator
 *
 * Produces JUnit-compatible XML output for CI systems (Jenkins, GitHub Actions, etc.).
 * Supports both requirement_validation (acceptance-point-based) and standard test reports.
 */

import type { AcceptancePoint, TestSummary } from '../../types'

// ---------------------------------------------------------------------------
// XML Escaping
// ---------------------------------------------------------------------------

/**
 * Escape XML special characters so they are safe to embed in attribute values
 * and text content.
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function msToSeconds(ms: number): string {
  return (ms / 1000).toFixed(3)
}

/**
 * Build a single <testcase> element for a requirement_validation acceptance point.
 *
 * - matched    → no child elements (passing)
 * - mismatched → <failure> child
 * - unverified → <skipped> child
 * - pending    → <skipped message="pending"/> child
 */
function acceptancePointToTestcase(
  point: AcceptancePoint,
  classname: string,
  timeSeconds: string,
  indent: string
): string {
  const name = escapeXml(`${point.id}: ${point.description}`)
  const open = `${indent}<testcase name="${name}" classname="${escapeXml(classname)}" time="${timeSeconds}">`

  if (point.verificationStatus === 'matched') {
    return `${indent}<testcase name="${name}" classname="${escapeXml(classname)}" time="${timeSeconds}"/>`
  }

  if (point.verificationStatus === 'pending') {
    return `${open}\n${indent}  <skipped message="pending"/>\n${indent}</testcase>`
  }

  if (point.verificationStatus === 'unverified') {
    const reason = escapeXml(point.reason ?? 'unverified')
    return `${open}\n${indent}  <skipped message="unverified: ${reason}"/>\n${indent}</testcase>`
  }

  // mismatched
  const reason = escapeXml(point.reason ?? 'assertion failed')
  const evidence =
    point.evidence && point.evidence.length > 0
      ? escapeXml(point.evidence.join(', '))
      : ''
  const failureBody = evidence ? `${evidence}` : ''
  return (
    `${open}\n` +
    `${indent}  <failure message="${reason}">${failureBody}</failure>\n` +
    `${indent}</testcase>`
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a JUnit XML report string from a TestSummary.
 *
 * For requirement_validation intent, each AcceptancePoint becomes a testcase.
 * For all other intents, test events from the summary drive the testcases
 * (falling back to a single synthetic testcase when no event detail is available).
 */
export function generateJunitReport(summary: TestSummary): string {
  const suiteName = escapeXml(`${summary.framework}-${summary.target}`)
  const totalSeconds = msToSeconds(summary.duration)

  let testcases: string[]
  let testsCount: number
  let failuresCount: number

  if (summary.intent === 'requirement_validation') {
    const points = summary.acceptancePoints ?? []
    const classname = 'requirement_validation'
    // Each AP gets an equal share of the total duration
    const perApSeconds = points.length > 0 ? msToSeconds(summary.duration / points.length) : '0.000'
    testcases = points.map((ap) =>
      acceptancePointToTestcase(ap, classname, perApSeconds, '    ')
    )
    testsCount = points.length
    failuresCount = points.filter((ap) => ap.verificationStatus === 'mismatched').length
  } else {
    // For non-requirement_validation, derive testcases from summary counts.
    // If we have no fine-grained events, synthesise one testcase per test bucket.
    const classname = escapeXml(`${summary.framework}.${summary.intent}`)
    testcases = []

    // Passed tests
    for (let i = 0; i < summary.passedTests; i++) {
      const name = escapeXml(`test_${i + 1}`)
      const t = msToSeconds(summary.passedTests > 0 ? summary.duration / summary.passedTests : 0)
      testcases.push(`    <testcase name="${name}" classname="${classname}" time="${t}"/>`)
    }

    // Failed tests
    for (let i = 0; i < summary.failedTests; i++) {
      const name = escapeXml(`failed_test_${i + 1}`)
      const t = '0.000'
      testcases.push(
        `    <testcase name="${name}" classname="${classname}" time="${t}">\n` +
        `      <failure message="test failed"/>\n` +
        `    </testcase>`
      )
    }

    // Skipped tests
    for (let i = 0; i < summary.skippedTests; i++) {
      const name = escapeXml(`skipped_test_${i + 1}`)
      testcases.push(
        `    <testcase name="${name}" classname="${classname}" time="0.000">\n` +
        `      <skipped message="skipped"/>\n` +
        `    </testcase>`
      )
    }

    testsCount = summary.totalTests
    failuresCount = summary.failedTests
  }

  const testsuiteAttrs =
    `name="${suiteName}" tests="${testsCount}" failures="${failuresCount}" errors="0" time="${totalSeconds}"`

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="test-agent" tests="${testsCount}" failures="${failuresCount}" errors="0" time="${totalSeconds}">`,
    `  <testsuite ${testsuiteAttrs}>`,
    ...testcases,
    '  </testsuite>',
    '</testsuites>',
  ]

  return lines.join('\n')
}
