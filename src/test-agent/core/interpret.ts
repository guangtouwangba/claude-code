/**
 * Flutter Test Agent — Mission Interpretation
 *
 * Translates a user request string into a structured TestMission by
 * detecting intent kind, mode, target platform, and validation scope.
 */

import type {
  MissionIntentKind,
  MissionMode,
  RequirementSource,
  TargetPlatform,
  TestMission,
  ValidationScope,
} from '../types'
import { detectProjectType, detectTargetPlatform, findRequirementSources } from './detect'

function detectIntentKind(userRequest: string): { kind: MissionIntentKind; confidence: number } {
  const req = userRequest.toLowerCase()

  const requirementPatterns = [
    '需求',
    '符合',
    'prd',
    '验证',
    '一致',
    'requirement',
    'match',
    'comply',
  ]
  if (requirementPatterns.some((p) => req.includes(p))) {
    return { kind: 'requirement_validation', confidence: 0.9 }
  }

  const postFixPatterns = ['修完', '复测', '修复', 'retest', 'regression']
  // 'fix' is a substring of many words — only match as standalone word
  const fixWordMatch = /\bfix\b/.test(req)
  if (postFixPatterns.some((p) => req.includes(p)) || fixWordMatch) {
    return { kind: 'post_fix_verification', confidence: 0.88 }
  }

  const smokePatterns = ['基本', '通的', 'smoke', '看下', '看看', 'explore']
  if (smokePatterns.some((p) => req.includes(p))) {
    return { kind: 'exploratory_smoke', confidence: 0.85 }
  }

  // Default fallback
  return { kind: 'flow_validation', confidence: 0.7 }
}

function detectMode(userRequest: string): MissionMode {
  const req = userRequest.toLowerCase()

  const operatorPatterns = ['只', '不要', 'only', ' no ']
  if (operatorPatterns.some((p) => req.includes(p))) {
    return 'operator'
  }

  const guidedPatterns = ['看看', '能不能']
  if (guidedPatterns.some((p) => req.includes(p))) {
    return 'guided'
  }

  return 'full-auto'
}

function detectPlatformFromKeywords(userRequest: string): TargetPlatform | null {
  const req = userRequest.toLowerCase()

  if (req.includes('headless') || req.includes('ci')) {
    return 'web-server'
  }
  if (req.includes('chrome') || req.includes('浏览器') || req.includes('browser')) {
    return 'web-chrome'
  }
  if (req.includes('android') || req.includes('手机') || req.includes('mobile')) {
    return 'android'
  }
  if (req.includes('ios') || req.includes('iphone')) {
    return 'ios'
  }

  return null
}

function buildValidationScope(intentKind: MissionIntentKind): ValidationScope {
  switch (intentKind) {
    case 'requirement_validation':
      return {
        verifyBehavior: true,
        verifyVisualStructure: true,
        verifyContent: true,
        verifyAccessibility: true,
      }
    case 'flow_validation':
      return {
        verifyBehavior: true,
        verifyVisualStructure: false,
        verifyContent: false,
        verifyAccessibility: false,
      }
    case 'exploratory_smoke':
      return {
        verifyBehavior: true,
        verifyVisualStructure: false,
        verifyContent: false,
        verifyAccessibility: false,
      }
    case 'post_fix_verification':
      return {
        verifyBehavior: true,
        verifyVisualStructure: false,
        verifyContent: false,
        verifyAccessibility: false,
      }
  }
}

function pickBestRequirementSource(
  sources: RequirementSource[],
  userRequest: string,
): RequirementSource {
  if (sources.length > 0 && sources[0] !== undefined) {
    return sources[0]
  }

  // Inline fallback: use the user request text itself
  return {
    type: 'inline',
    content: userRequest,
    isAuthoritative: false,
  }
}

export async function interpretRequest(
  userRequest: string,
  projectDir: string,
): Promise<TestMission> {
  const missionId = crypto.randomUUID()

  const intent = detectIntentKind(userRequest)
  const mode = detectMode(userRequest)

  const [projectDetection, requirementSources] = await Promise.all([
    detectProjectType(projectDir),
    findRequirementSources(projectDir),
  ])

  const keywordPlatform = detectPlatformFromKeywords(userRequest)
  let platform: TargetPlatform
  if (keywordPlatform !== null) {
    platform = keywordPlatform
  } else {
    const platformDetection = await detectTargetPlatform(projectDir, projectDetection.appType)
    platform = platformDetection.platform
  }

  const requirementSource = pickBestRequirementSource(requirementSources, userRequest)
  const scope = buildValidationScope(intent.kind)

  const mission: TestMission = {
    missionId,
    userRequest,
    mode,
    intent,
    requirementSource,
    target: {
      appType: projectDetection.appType,
      platform,
    },
    scope,
  }

  return mission
}
