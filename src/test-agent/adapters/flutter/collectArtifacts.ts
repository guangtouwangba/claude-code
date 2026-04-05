/**
 * Flutter Artifact Collection
 *
 * Collects screenshots, logs, and other test artifacts after a test run
 * and copies them to the standard artifacts directory.
 */

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join, basename, extname } from 'node:path'
import type { TestContext, TestArtifacts } from '../../types'
import { STORAGE_PATHS } from '../../types'

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function copyArtifact(src: string, destDir: string): string {
  const name = basename(src)
  const dest = join(destDir, name)
  copyFileSync(src, dest)
  return dest
}

/**
 * Recursively find files matching a predicate in a directory (non-recursive depth limit).
 */
function findFiles(
  dir: string,
  predicate: (filePath: string) => boolean,
  maxDepth = 3,
): string[] {
  if (!existsSync(dir) || maxDepth <= 0) return []

  const results: string[] = []
  let entries: string[]

  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    try {
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        results.push(...findFiles(fullPath, predicate, maxDepth - 1))
      } else if (stat.isFile() && predicate(fullPath)) {
        results.push(fullPath)
      }
    } catch {
      // skip inaccessible entries
    }
  }

  return results
}

function isScreenshot(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return ['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext)
}

function isLogFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  const name = basename(filePath).toLowerCase()
  return (
    ext === '.log' ||
    ext === '.txt' ||
    name.includes('log') ||
    name.includes('output') ||
    name.includes('test-result')
  )
}

export async function collectFlutterArtifacts(ctx: TestContext): Promise<TestArtifacts> {
  const { projectDir, mission } = ctx
  const missionId = mission.missionId

  // Create artifacts directory
  const artifactsDir = join(projectDir, STORAGE_PATHS.artifacts, missionId)
  ensureDir(artifactsDir)

  const screenshots: string[] = []
  const consoleLogs: string[] = []
  const networkLogs: string[] = []
  const semanticsSnapshots: string[] = []
  const flutterTestLogs: string[] = []
  const other: Record<string, string[]> = {}

  // --- Flutter test logs from build directory ---
  const buildDir = join(projectDir, 'build')
  if (existsSync(buildDir)) {
    const logFiles = findFiles(buildDir, isLogFile)
    for (const logFile of logFiles) {
      try {
        const dest = copyArtifact(logFile, artifactsDir)
        flutterTestLogs.push(dest)
      } catch {
        // skip unreadable files
      }
    }
  }

  // --- Screenshots from build/ or project root ---
  const screenshotSearchDirs = [
    join(projectDir, 'build'),
    join(projectDir, 'screenshots'),
    projectDir,
  ]

  for (const searchDir of screenshotSearchDirs) {
    if (!existsSync(searchDir)) continue
    const found = findFiles(searchDir, isScreenshot, searchDir === projectDir ? 1 : 3)
    for (const screenshotFile of found) {
      try {
        const dest = copyArtifact(screenshotFile, artifactsDir)
        screenshots.push(dest)
      } catch {
        // skip
      }
    }
  }

  // --- Console logs from test output files ---
  const consoleLogSearchDirs = [
    join(projectDir, '.omx', 'test-agent'),
    join(projectDir, 'test_output'),
  ]

  for (const searchDir of consoleLogSearchDirs) {
    if (!existsSync(searchDir)) continue
    const found = findFiles(searchDir, isLogFile, 2)
    for (const logFile of found) {
      try {
        const dest = copyArtifact(logFile, artifactsDir)
        consoleLogs.push(dest)
      } catch {
        // skip
      }
    }
  }

  // --- Semantics snapshots (accessibility tree dumps) ---
  const semanticsSearchDir = join(projectDir, 'build', 'semantics')
  if (existsSync(semanticsSearchDir)) {
    const found = findFiles(
      semanticsSearchDir,
      (f) => extname(f).toLowerCase() === '.json' || isLogFile(f),
    )
    for (const f of found) {
      try {
        const dest = copyArtifact(f, artifactsDir)
        semanticsSnapshots.push(dest)
      } catch {
        // skip
      }
    }
  }

  // --- Write a manifest file listing all collected artifacts ---
  const manifest = {
    missionId,
    collectedAt: new Date().toISOString(),
    screenshots,
    consoleLogs,
    networkLogs,
    semanticsSnapshots,
    flutterTestLogs,
  }

  const manifestPath = join(artifactsDir, 'manifest.json')
  try {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
    other['manifest'] = [manifestPath]
  } catch {
    // non-fatal
  }

  return {
    screenshots,
    consoleLogs,
    networkLogs,
    semanticsSnapshots,
    flutterTestLogs,
    other,
  }
}
