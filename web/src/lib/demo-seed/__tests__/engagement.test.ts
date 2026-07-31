import { describe, it, expect } from 'vitest'
import {
  buildProspects,
  buildConversations,
  buildPhotoPairs,
  PROSPECT_STAGES,
} from '../engagement'
import { FEATURED_PATIENT_COUNT } from '../clinical'
import { buildPatients } from '../identity'
import { PHONE_PREFIX } from '../config'
import { parseBrDate, toBrYmd } from '@/lib/dates'

/** Fixed reference point so assertions are reproducible, matching the other demo-seed test suites. */
const TODAY = parseBrDate('2026-07-27', '12:00:00')
const TODAY_YMD = toBrYmd(TODAY)

describe('buildProspects', () => {
  const prospects = buildProspects(TODAY)

  it('covers every stage the CRM board renders', () => {
    const stages = new Set(prospects.map((p) => p.stage))
    for (const stage of PROSPECT_STAGES) {
      expect(stages.has(stage)).toBe(true)
    }
  })

  it('gives every prospect a phone starting with PHONE_PREFIX', () => {
    for (const p of prospects) {
      expect(p.phone.startsWith(PHONE_PREFIX)).toBe(true)
    }
  })

  it('has no duplicate phones', () => {
    const phones = new Set(prospects.map((p) => p.phone))
    expect(phones.size).toBe(prospects.length)
  })

  it('gives every prospect at least one activity, starting with "created"', () => {
    for (const p of prospects) {
      expect(p.activities.length).toBeGreaterThan(0)
      expect(p.activities[0].action).toBe('created')
    }
  })

  it('orders every prospect\'s activity dates chronologically (non-decreasing)', () => {
    for (const p of prospects) {
      const dates = p.activities.map((a) => a.date)
      const sorted = [...dates].sort()
      expect(dates).toEqual(sorted)
    }
  })

  it('never dates an activity after today', () => {
    for (const p of prospects) {
      for (const a of p.activities) {
        expect(a.date <= TODAY_YMD).toBe(true)
      }
    }
  })

  it('sets createdAt to the first activity date and updatedAt to the last', () => {
    for (const p of prospects) {
      expect(p.createdAt).toBe(p.activities[0].date)
      expect(p.updatedAt).toBe(p.activities[p.activities.length - 1].date)
    }
  })

  it('logs a "lost" activity with a reason for every perdido prospect', () => {
    const lost = prospects.filter((p) => p.stage === 'perdido')
    expect(lost.length).toBeGreaterThan(0)
    for (const p of lost) {
      expect(p.lostReason).toBeTruthy()
      const lastActivity = p.activities[p.activities.length - 1]
      expect(lastActivity.action).toBe('lost')
    }
  })

  it('logs a "converted" activity (not stage_changed) for every convertido prospect', () => {
    const converted = prospects.filter((p) => p.stage === 'convertido')
    expect(converted.length).toBeGreaterThan(0)
    for (const p of converted) {
      const lastActivity = p.activities[p.activities.length - 1]
      expect(lastActivity.action).toBe('converted')
    }
  })

  it('never enables anything that could feed the WhatsApp automations cron', () => {
    // Prospects carry no automation/enabled-trigger fields at all; this
    // guards against a future edit accidentally adding one.
    for (const p of prospects) {
      expect(p).not.toHaveProperty('whatsapp_automations')
      expect(p).not.toHaveProperty('automations')
    }
  })

  it('is deterministic for the same input', () => {
    const again = buildProspects(TODAY)
    expect(again).toEqual(prospects)
  })
})

describe('buildConversations', () => {
  const patients = buildPatients(50, TODAY)
  const conversations = buildConversations(patients, TODAY)

  it('builds at least one conversation', () => {
    expect(conversations.length).toBeGreaterThan(0)
  })

  it('gives every conversation at least one message', () => {
    for (const c of conversations) {
      expect(c.messages.length).toBeGreaterThan(0)
    }
  })

  it('marks every message delivered or read -- never queued, sent-only or failed', () => {
    for (const c of conversations) {
      for (const m of c.messages) {
        expect(['delivered', 'read']).toContain(m.deliveryStatus)
      }
    }
  })

  it('produces no whatsapp_queued_messages shape anywhere in the output', () => {
    const serialized = JSON.stringify(conversations)
    expect(serialized).not.toContain('"queued"')
    expect(serialized).not.toContain('resumeMetaMessageId')
    for (const c of conversations) {
      expect(c).not.toHaveProperty('queuedMessages')
      for (const m of c.messages) {
        expect(m).not.toHaveProperty('status')
      }
    }
  })

  it('carries a real patient id and a PHONE_PREFIX phone number per conversation', () => {
    const patientIds = new Set(patients.map((p) => p.id))
    for (const c of conversations) {
      expect(patientIds.has(c.patientId)).toBe(true)
      expect(c.phoneNumber.startsWith(PHONE_PREFIX)).toBe(true)
    }
  })

  it('links every conversation to a patient whose email ends @example.com', () => {
    const byId = new Map(patients.map((p) => [p.id, p]))
    for (const c of conversations) {
      const patient = byId.get(c.patientId)
      expect(patient?.email.endsWith('@example.com')).toBe(true)
    }
  })

  it('never dates a message after today', () => {
    for (const c of conversations) {
      for (const m of c.messages) {
        expect(m.date <= TODAY_YMD).toBe(true)
      }
    }
  })

  it('computes unreadCount as the trailing run of inbound messages', () => {
    for (const c of conversations) {
      const lastDirection = c.messages[c.messages.length - 1].direction
      if (lastDirection === 'inbound') {
        expect(c.unreadCount).toBeGreaterThan(0)
      } else {
        expect(c.unreadCount).toBe(0)
      }
    }
  })

  it('sets lastMessageDate/Time to the final message in the thread', () => {
    for (const c of conversations) {
      const last = c.messages[c.messages.length - 1]
      expect(c.lastMessageDate).toBe(last.date)
      expect(c.lastMessageTime).toBe(last.time)
    }
  })

  it('is deterministic for the same input', () => {
    const again = buildConversations(patients, TODAY)
    expect(again).toEqual(conversations)
  })

  it('returns fewer conversations than patients requested, never one per patient', () => {
    // Guards against accidentally wiring every single patient into the inbox.
    expect(conversations.length).toBeLessThan(patients.length)
  })
})

describe('buildPhotoPairs', () => {
  const pairs = buildPhotoPairs()

  it('builds exactly FEATURED_PATIENT_COUNT pairs', () => {
    expect(pairs).toHaveLength(FEATURED_PATIENT_COUNT)
  })

  it('gives every pair both a before and an after asset', () => {
    for (const pair of pairs) {
      expect(pair.before).toBeTruthy()
      expect(pair.after).toBeTruthy()
    }
  })

  it('marks the before asset "pre" and the after asset a later timeline stage', () => {
    const laterStages = ['immediate_post', '7d', '30d', '90d']
    for (const pair of pairs) {
      expect(pair.before.timelineStage).toBe('pre')
      expect(laterStages).toContain(pair.after.timelineStage)
    }
  })

  it('references an existing template file under web/public/face-templates for every asset', () => {
    for (const pair of pairs) {
      for (const asset of [pair.before, pair.after]) {
        expect(asset.sourceTemplatePath).toMatch(/^public\/face-templates\/(female|male)-front\.webp$/)
      }
    }
  })

  it('gives every asset a non-empty annotation', () => {
    for (const pair of pairs) {
      for (const asset of [pair.before, pair.after]) {
        expect(asset.annotation.annotationData.note.trim().length).toBeGreaterThan(0)
        expect(asset.annotation.annotationData.markers.length).toBeGreaterThan(0)
      }
    }
  })

  it('assigns each pair a distinct patientIndex, matching before/after within the pair', () => {
    const indices = pairs.map((p) => p.patientIndex)
    expect(new Set(indices).size).toBe(pairs.length)
    for (const pair of pairs) {
      expect(pair.before.patientIndex).toBe(pair.patientIndex)
      expect(pair.after.patientIndex).toBe(pair.patientIndex)
    }
  })

  it('is deterministic across calls', () => {
    expect(buildPhotoPairs()).toEqual(pairs)
  })
})
