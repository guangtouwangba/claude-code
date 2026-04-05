/**
 * Flutter Mission Interpretation
 *
 * Enhances a raw TestMission with Flutter-specific details and inferred context.
 */

import type { TestMission, InterpretedMission, AcceptancePoint } from '../../types'
import { detectFlutterRenderer } from './detect'

export async function interpretFlutterMission(mission: TestMission): Promise<InterpretedMission> {
  const inferredDetails: Record<string, unknown> = {}

  // Determine default lane based on target platform
  let defaultLane: string
  switch (mission.target.platform) {
    case 'web-chrome':
      defaultLane = 'drive'
      break
    case 'web-server':
      defaultLane = 'drive' // headless
      inferredDetails.headless = true
      break
    case 'android':
      defaultLane = 'drive'
      inferredDetails.androidDevice = true
      break
    case 'ios':
      defaultLane = 'drive'
      inferredDetails.iosDevice = true
      break
    default:
      defaultLane = 'inspect'
  }
  inferredDetails.defaultLane = defaultLane

  // Detect if wasm mode should be used
  // wasm is applicable for web targets with skwasm renderer
  let wasmMode = false
  if (mission.target.platform === 'web-chrome' || mission.target.platform === 'web-server') {
    // Check if project dir is embedded in the request or requirementSource
    // We attempt renderer detection if a path is available
    const projectDirHint = mission.requirementSource.path
      ? mission.requirementSource.path.replace(/\/[^/]+$/, '')
      : undefined

    if (projectDirHint) {
      try {
        const renderer = await detectFlutterRenderer(projectDirHint)
        wasmMode = renderer === 'skwasm'
        inferredDetails.renderer = renderer
      } catch {
        inferredDetails.renderer = 'canvaskit'
      }
    } else {
      inferredDetails.renderer = 'canvaskit'
    }
  }
  inferredDetails.wasmMode = wasmMode

  // Infer assertion mode from mission mode and platform
  let assertionMode: string
  if (mission.mode === 'full-auto') {
    assertionMode = defaultLane === 'drive' ? 'native-first' : 'browser-first'
  } else if (mission.mode === 'operator') {
    assertionMode = 'hybrid'
  } else {
    assertionMode = 'native-first'
  }
  inferredDetails.assertionMode = assertionMode

  // Determine framework details
  inferredDetails.framework = 'flutter'
  inferredDetails.testRunner = 'flutter_drive'

  // Infer integration test target file
  inferredDetails.integrationTestTarget = 'integration_test/app_test.dart'
  inferredDetails.driverFile = 'test_driver/integration_test.dart'

  // Build enriched mission with an empty acceptance points list
  // (extractAcceptancePoints handles actual extraction separately)
  const acceptancePoints: AcceptancePoint[] = []

  return {
    mission,
    acceptancePoints,
    inferredDetails,
  }
}
