import { db } from '@/db/client'
import { whatsappCredits, whatsappCreditLedger, users, patients } from '@/db/schema'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import { PURPOSE_LABELS } from '@/lib/whatsapp-blueprints'
import type { LedgerEntry, LedgerPeriod } from '@/lib/whatsapp-credit-ledger'

export type LedgerCursor = { createdAt: Date; id: string }
export const LEDGER_PAGE_SIZE = 50

export function encodeLedgerCursor(c: LedgerCursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`).toString('base64url')
}

const UUID = z.string().uuid()

export function decodeLedgerCursor(raw: string): LedgerCursor | null {
  const [iso, id] = Buffer.from(raw, 'base64url').toString().split('|')
  const createdAt = new Date(iso)
  if (!UUID.safeParse(id).success || Number.isNaN(createdAt.getTime())) return null
  return { createdAt, id }
}

export async function listCreditPeriods(tenantId: string): Promise<LedgerPeriod[]> {
  const rows = await db.select().from(whatsappCredits)
    .where(eq(whatsappCredits.tenantId, tenantId))
    .orderBy(desc(whatsappCredits.periodStart))
  return rows.map((r) => ({
    id: r.id,
    start: r.periodStart.toISOString(),
    end: r.periodEnd.toISOString(),
    used: r.creditsUsed,
    total: r.creditsTotal,
  }))
}

function actorName(type: LedgerEntry['actor']['type'], userName: string | null, recipientName: string): string | null {
  if (type === 'user') return userName
  if (type === 'patient') return recipientName
  return null
}

export async function listLedgerEntries(
  tenantId: string,
  periodId: string,
  cursor: LedgerCursor | null,
  limit = LEDGER_PAGE_SIZE,
): Promise<{ entries: LedgerEntry[]; nextCursor: string | null }> {
  const l = whatsappCreditLedger
  const rows = await db
    .select({ line: l, userName: users.fullName, patientName: patients.fullName })
    .from(l)
    .leftJoin(users, eq(users.id, l.actorUserId))
    .leftJoin(patients, and(eq(patients.id, l.patientId), eq(patients.tenantId, l.tenantId)))
    .where(and(
      eq(l.tenantId, tenantId),
      eq(l.creditPeriodId, periodId),
      cursor ? or(lt(l.createdAt, cursor.createdAt), and(eq(l.createdAt, cursor.createdAt), lt(l.id, cursor.id))) : undefined,
    ))
    .orderBy(desc(l.createdAt), desc(l.id))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    entries: page.map(({ line, userName, patientName }) => {
      const recipientName = patientName ?? line.contactName ?? line.contactPhone
      const actorType = line.actorType as LedgerEntry['actor']['type']
      return {
        id: line.id,
        kind: line.kind as LedgerEntry['kind'],
        amount: line.amount,
        refundReason: (line.refundReason as LedgerEntry['refundReason']) ?? null,
        actor: { type: actorType, name: actorName(actorType, userName, recipientName) },
        recipientName,
        item: {
          kind: line.itemKind as LedgerEntry['item']['kind'],
          label: line.itemKind === 'template'
            ? (line.purposeKey && PURPOSE_LABELS[line.purposeKey]) || line.templateName
            : line.documentLabel,
        },
        createdAt: line.createdAt.toISOString(),
      }
    }),
    nextCursor: rows.length > limit && last ? encodeLedgerCursor({ createdAt: last.line.createdAt, id: last.line.id }) : null,
  }
}
