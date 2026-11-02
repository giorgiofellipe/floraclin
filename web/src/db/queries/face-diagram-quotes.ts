import { db } from '@/db/client'
import { faceDiagramQuotes } from '@/db/schema'
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { QuotationLine } from '@/validations/face-diagram-group'

export interface DiagramQuote {
  id: string
  groupId: string
  patientId: string
  storagePath: string
  lines: QuotationLine[]
  total: number
  createdBy: string
  createdAt: Date
  whatsappStatus: 'queued' | 'sent' | null
  whatsappRequestedAt: Date | null
}

type QuoteRow = typeof faceDiagramQuotes.$inferSelect

function toDiagramQuote(row: QuoteRow): DiagramQuote {
  return {
    id: row.id,
    groupId: row.groupId,
    patientId: row.patientId,
    storagePath: row.storagePath,
    lines: row.lines as QuotationLine[],
    total: Number(row.total),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    whatsappStatus: row.whatsappStatus as DiagramQuote['whatsappStatus'],
    whatsappRequestedAt: row.whatsappRequestedAt,
  }
}

export async function createDiagramQuote(
  tx: typeof db,
  input: {
    id?: string
    tenantId: string
    patientId: string
    groupId: string
    storagePath: string
    lines: QuotationLine[]
    total: number
    createdBy: string
  },
): Promise<DiagramQuote> {
  const [row] = await tx
    .insert(faceDiagramQuotes)
    .values({
      id: input.id,
      tenantId: input.tenantId,
      patientId: input.patientId,
      groupId: input.groupId,
      storagePath: input.storagePath,
      lines: input.lines.map((l) => ({ ...l })),
      total: input.total.toFixed(2),
      createdBy: input.createdBy,
    })
    .returning()
  return toDiagramQuote(row)
}

export async function listDiagramQuotes(
  tenantId: string,
  groupId: string,
): Promise<DiagramQuote[]> {
  const rows = await db
    .select()
    .from(faceDiagramQuotes)
    .where(and(eq(faceDiagramQuotes.tenantId, tenantId), eq(faceDiagramQuotes.groupId, groupId)))
    .orderBy(desc(faceDiagramQuotes.createdAt))
  return rows.map(toDiagramQuote)
}

export async function getDiagramQuote(
  tenantId: string,
  quoteId: string,
): Promise<DiagramQuote | null> {
  const [row] = await db
    .select()
    .from(faceDiagramQuotes)
    .where(and(eq(faceDiagramQuotes.tenantId, tenantId), eq(faceDiagramQuotes.id, quoteId)))
    .limit(1)
  return row ? toDiagramQuote(row) : null
}

export async function markQuoteWhatsapp(
  tenantId: string,
  quoteId: string,
  input: { status: 'queued' | 'sent'; whatsappMessageId: string | null },
): Promise<void> {
  await db
    .update(faceDiagramQuotes)
    .set({
      whatsappStatus: input.status,
      whatsappRequestedAt: new Date(),
      whatsappMessageId: input.whatsappMessageId,
    })
    .where(and(eq(faceDiagramQuotes.tenantId, tenantId), eq(faceDiagramQuotes.id, quoteId)))
}

/**
 * Claims the quote for a WhatsApp send so concurrent requests cannot both send it.
 * A claim left by a crashed request expires after two minutes.
 */
export async function claimQuoteWhatsapp(tenantId: string, quoteId: string): Promise<boolean> {
  const claimed = await db
    .update(faceDiagramQuotes)
    .set({ whatsappRequestedAt: sql`now()` })
    .where(
      and(
        eq(faceDiagramQuotes.tenantId, tenantId),
        eq(faceDiagramQuotes.id, quoteId),
        isNull(faceDiagramQuotes.whatsappStatus),
        or(
          isNull(faceDiagramQuotes.whatsappRequestedAt),
          lt(faceDiagramQuotes.whatsappRequestedAt, sql`now() - interval '2 minutes'`),
        ),
      ),
    )
    .returning({ id: faceDiagramQuotes.id })
  return claimed.length > 0
}

export async function releaseQuoteWhatsappClaim(tenantId: string, quoteId: string): Promise<void> {
  await db
    .update(faceDiagramQuotes)
    .set({ whatsappRequestedAt: null })
    .where(
      and(
        eq(faceDiagramQuotes.tenantId, tenantId),
        eq(faceDiagramQuotes.id, quoteId),
        isNull(faceDiagramQuotes.whatsappStatus),
      ),
    )
}
