/**
 * Flutter Test Agent — Generic Project Detection
 *
 * Detects project type, target platform, and requirement sources
 * from the filesystem layout and file contents.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AppType, RequirementSource, RequirementSourceType, TargetPlatform } from '../types'

export type DetectionResult = {
  appType: AppType
  confidence: number
  evidence: string[]
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'build', '.dart_tool'])

function readdirRecursive(dir: string): string[] {
  const results: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue
    }
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...readdirRecursive(fullPath))
    } else {
      results.push(fullPath)
    }
  }
  return results
}

export async function detectProjectType(projectDir: string): Promise<DetectionResult> {
  const evidence: string[] = []

  const pubspecPath = path.join(projectDir, 'pubspec.yaml')
  if (fs.existsSync(pubspecPath)) {
    evidence.push('pubspec.yaml found')
    try {
      const content = fs.readFileSync(pubspecPath, 'utf-8')
      if (content.includes('flutter')) {
        evidence.push('pubspec.yaml contains flutter dependency')
        return { appType: 'flutter', confidence: 0.95, evidence }
      }
      evidence.push('pubspec.yaml exists but no flutter dependency found')
    } catch {
      evidence.push('pubspec.yaml could not be read')
    }
  }

  return { appType: 'unknown', confidence: 0.5, evidence }
}

export async function detectTargetPlatform(
  projectDir: string,
  appType: AppType,
): Promise<{ platform: TargetPlatform; confidence: number; evidence: string[] }> {
  const evidence: string[] = []

  if (appType === 'flutter') {
    const webIndexPath = path.join(projectDir, 'web', 'index.html')
    if (fs.existsSync(webIndexPath)) {
      evidence.push('web/index.html found')
      return { platform: 'web-chrome', confidence: 0.9, evidence }
    }

    const androidPath = path.join(projectDir, 'android')
    if (fs.existsSync(androidPath) && fs.statSync(androidPath).isDirectory()) {
      evidence.push('android/ directory found')
      return { platform: 'android', confidence: 0.85, evidence }
    }

    const iosPath = path.join(projectDir, 'ios')
    if (fs.existsSync(iosPath) && fs.statSync(iosPath).isDirectory()) {
      evidence.push('ios/ directory found')
      return { platform: 'ios', confidence: 0.85, evidence }
    }

    evidence.push('flutter project with no platform-specific directory, defaulting to web-chrome')
    return { platform: 'web-chrome', confidence: 0.6, evidence }
  }

  return { platform: 'unknown', confidence: 0.3, evidence: ['no recognizable project type'] }
}

type RequirementSourceCandidate = {
  path: string
  type: RequirementSourceType
  confidence: number
}

function classifyRequirementFile(filePath: string): RequirementSourceCandidate | null {
  const basename = path.basename(filePath).toLowerCase()

  if (basename === 'prd.md' || basename.endsWith('.prd.md')) {
    return { path: filePath, type: 'prd', confidence: 0.95 }
  }
  if (basename === 'requirements.md') {
    return { path: filePath, type: 'markdown', confidence: 0.85 }
  }
  if (basename === 'acceptance-criteria.md') {
    return { path: filePath, type: 'markdown', confidence: 0.8 }
  }

  return null
}

export async function findRequirementSources(
  projectDir: string,
): Promise<RequirementSource[]> {
  const allFiles = readdirRecursive(projectDir)

  const candidates: RequirementSourceCandidate[] = []

  for (const filePath of allFiles) {
    const candidate = classifyRequirementFile(filePath)
    if (candidate !== null) {
      candidates.push(candidate)
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence)

  return candidates.map(
    (c): RequirementSource => ({
      type: c.type,
      path: c.path,
      isAuthoritative: c.confidence >= 0.9,
    }),
  )
}
