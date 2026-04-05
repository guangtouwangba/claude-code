/**
 * Flutter Test Agent — Event Sourcing System
 *
 * Append-only event trace system for mission observability.
 * Writes MissionEvent objects to JSONL trace files and decision records
 * to separate JSONL decision files.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { DecisionRecord, MissionEvent, MissionEventPhase } from '../types'

export class MissionTracer {
  private readonly missionId: string
  private readonly tracePath: string
  private readonly decisionsPath: string

  constructor(missionId: string, baseDir: string) {
    this.missionId = missionId
    const tracesDir = path.join(baseDir, '.omx', 'test-agent', 'traces')
    const decisionsDir = path.join(baseDir, '.omx', 'test-agent', 'decisions')

    fs.mkdirSync(tracesDir, { recursive: true })
    fs.mkdirSync(decisionsDir, { recursive: true })

    this.tracePath = path.join(tracesDir, `${missionId}.jsonl`)
    this.decisionsPath = path.join(decisionsDir, `${missionId}.jsonl`)
  }

  emit(event: Omit<MissionEvent, 'eventId' | 'timestamp'>): MissionEvent {
    const full: MissionEvent = {
      ...event,
      eventId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    }
    fs.appendFileSync(this.tracePath, JSON.stringify(full) + '\n', 'utf-8')
    return full
  }

  emitDecision(record: Omit<DecisionRecord, 'decisionId'>): DecisionRecord {
    const full: DecisionRecord = {
      ...record,
      decisionId: crypto.randomUUID(),
    }
    fs.appendFileSync(this.decisionsPath, JSON.stringify(full) + '\n', 'utf-8')
    return full
  }

  getTrace(): MissionEvent[] {
    if (!fs.existsSync(this.tracePath)) {
      return []
    }
    const raw = fs.readFileSync(this.tracePath, 'utf-8')
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as MissionEvent)
  }

  getDecisions(): DecisionRecord[] {
    if (!fs.existsSync(this.decisionsPath)) {
      return []
    }
    const raw = fs.readFileSync(this.decisionsPath, 'utf-8')
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as DecisionRecord)
  }

  getEventsByPhase(phase: MissionEventPhase): MissionEvent[] {
    return this.getTrace().filter((event) => event.phase === phase)
  }

  getLastEvent(): MissionEvent | null {
    const trace = this.getTrace()
    return trace.length > 0 ? (trace[trace.length - 1] ?? null) : null
  }
}
