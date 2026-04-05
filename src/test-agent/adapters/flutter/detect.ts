/**
 * Flutter Project Detection
 *
 * Detects whether a directory is a Flutter project and determines
 * the Flutter web renderer in use.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export async function detectFlutterProject(
  projectDir: string,
): Promise<{ detected: boolean; evidence: string[] }> {
  const evidence: string[] = []

  // Check pubspec.yaml exists
  const pubspecPath = join(projectDir, 'pubspec.yaml')
  if (!existsSync(pubspecPath)) {
    return { detected: false, evidence }
  }
  evidence.push('pubspec.yaml found')

  // Parse pubspec.yaml for flutter keys
  try {
    const content = readFileSync(pubspecPath, 'utf-8')
    const lines = content.split('\n')

    let inDependencies = false
    let hasFlutterDependency = false
    let hasFlutterKey = false

    for (const line of lines) {
      // Check for top-level flutter: key
      if (/^flutter:/.test(line)) {
        hasFlutterKey = true
      }
      // Track dependencies: section
      if (/^dependencies:/.test(line)) {
        inDependencies = true
      } else if (/^\S/.test(line) && inDependencies) {
        inDependencies = false
      }
      // Check for flutter: under dependencies
      if (inDependencies && /^\s+flutter:/.test(line)) {
        hasFlutterDependency = true
      }
    }

    if (hasFlutterKey) {
      evidence.push('pubspec.yaml contains flutter: key')
    }
    if (hasFlutterDependency) {
      evidence.push('pubspec.yaml lists flutter as dependency')
    }
  } catch {
    // Could not parse pubspec.yaml
  }

  // Check for integration_test/ directory
  const integrationTestDir = join(projectDir, 'integration_test')
  if (existsSync(integrationTestDir)) {
    evidence.push('integration_test/ directory found')
  }

  // Check for test_driver/integration_test.dart
  const driverFile = join(projectDir, 'test_driver', 'integration_test.dart')
  if (existsSync(driverFile)) {
    evidence.push('test_driver/integration_test.dart found')
  }

  // Check for web/index.html (Flutter web support)
  const webIndexHtml = join(projectDir, 'web', 'index.html')
  if (existsSync(webIndexHtml)) {
    evidence.push('web/index.html found (Flutter web support)')
  }

  // Detected if pubspec.yaml exists plus at least one flutter indicator
  const detected = evidence.length >= 2

  return { detected, evidence }
}

export async function detectFlutterRenderer(
  projectDir: string,
): Promise<'canvaskit' | 'skwasm' | 'unknown'> {
  const webIndexHtml = join(projectDir, 'web', 'index.html')

  if (!existsSync(webIndexHtml)) {
    return 'canvaskit'
  }

  try {
    const content = readFileSync(webIndexHtml, 'utf-8')

    if (content.includes('skwasm')) {
      return 'skwasm'
    }
    if (content.includes('canvaskit')) {
      return 'canvaskit'
    }
    if (content.includes('--wasm')) {
      return 'skwasm'
    }
  } catch {
    // Could not read index.html
  }

  // Flutter web defaults to canvaskit
  return 'canvaskit'
}
