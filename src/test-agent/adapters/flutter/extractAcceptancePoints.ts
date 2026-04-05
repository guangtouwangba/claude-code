/**
 * Acceptance Point Extraction
 *
 * Parses requirement source content into structured AcceptancePoint objects,
 * classifying each by verification dimension and method.
 */

import { readFileSync, existsSync } from 'node:fs'
import type {
  TestContext,
  AcceptancePoint,
  VerificationDimension,
  VerificationMethod,
} from '../../types'

const NUMBERED_LIST_RE = /^\d+[\.)]\s*(.+)$/
const BULLET_RE = /^[-*]\s*(.+)$/
const AP_TAG_RE = /^AP\d+:\s*(.+)$/i

function classifyDimensions(text: string): VerificationDimension[] {
  const lower = text.toLowerCase()
  const dimensions: VerificationDimension[] = []

  // behavior keywords
  if (
    /\b(click|tap|button|submit|navigate|route|redirect|load|fetch|send|request|response|action|trigger|open|close|expand|collapse|scroll|swipe|drag|drop)\b/.test(
      lower,
    )
  ) {
    dimensions.push('behavior')
  }

  // visual_structure keywords
  if (
    /\b(display|show|render|visible|hidden|appear|disappear|layout|widget|container|row|column|stack|alignment|size|color|style|theme|icon|image|logo|font|spacing|padding|margin)\b/.test(
      lower,
    )
  ) {
    dimensions.push('visual_structure')
  }

  // copy keywords
  if (
    /\b(text|label|title|heading|copy|message|placeholder|hint|tooltip|content|string|wording|read|says|displays the text)\b/.test(
      lower,
    )
  ) {
    dimensions.push('copy')
  }

  // state_transition keywords
  if (
    /\b(state|transition|change|update|toggle|enable|disable|active|inactive|selected|deselected|checked|unchecked|focused|blurred|loading|loaded|idle|success|failure|empty|filled)\b/.test(
      lower,
    )
  ) {
    dimensions.push('state_transition')
  }

  // error_handling keywords
  if (
    /\b(error|fail|invalid|validation|exception|crash|timeout|retry|fallback|warning|alert|snackbar|dialog|modal|404|500)\b/.test(
      lower,
    )
  ) {
    dimensions.push('error_handling')
  }

  // accessibility keywords
  if (
    /\b(accessible|accessibility|aria|semantics|screen reader|keyboard|focus|tab order|contrast|alt text|a11y)\b/.test(
      lower,
    )
  ) {
    dimensions.push('accessibility')
  }

  // Default to behavior if nothing matched
  if (dimensions.length === 0) {
    dimensions.push('behavior')
  }

  return dimensions
}

function chooseVerificationMethod(dimensions: VerificationDimension[]): VerificationMethod {
  // Priority order: accessibility > visual_structure > copy > state_transition, error_handling > behavior
  if (dimensions.includes('accessibility')) {
    return 'semantics'
  }
  if (dimensions.includes('visual_structure')) {
    return 'screenshot'
  }
  if (dimensions.includes('copy')) {
    return 'browser_inspect'
  }
  if (dimensions.includes('state_transition') || dimensions.includes('error_handling')) {
    return 'flutter_native'
  }
  return 'flutter_native'
}

function parseRequirementContent(content: string): AcceptancePoint[] {
  const points: AcceptancePoint[] = []
  const lines = content.split('\n')
  let index = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let description: string | null = null

    const apMatch = AP_TAG_RE.exec(trimmed)
    const numberedMatch = NUMBERED_LIST_RE.exec(trimmed)
    const bulletMatch = BULLET_RE.exec(trimmed)

    if (apMatch) {
      description = apMatch[1].trim()
    } else if (numberedMatch) {
      description = numberedMatch[1].trim()
    } else if (bulletMatch) {
      description = bulletMatch[1].trim()
    }

    if (description && description.length > 5) {
      index++
      const id = `ap-${String(index).padStart(3, '0')}`
      const dimensions = classifyDimensions(description)
      const verificationMethod = chooseVerificationMethod(dimensions)

      points.push({
        id,
        description,
        dimensions,
        verificationStatus: 'pending',
        verificationMethod,
      })
    }
  }

  return points
}

export async function extractAcceptancePoints(ctx: TestContext): Promise<AcceptancePoint[]> {
  const { requirementSource } = ctx.mission

  // If inline content is provided, parse it directly
  if (requirementSource.content) {
    return parseRequirementContent(requirementSource.content)
  }

  // If a file path is provided, read it first
  if (requirementSource.path) {
    if (!existsSync(requirementSource.path)) {
      return []
    }

    try {
      const content = readFileSync(requirementSource.path, 'utf-8')
      return parseRequirementContent(content)
    } catch {
      return []
    }
  }

  return []
}
