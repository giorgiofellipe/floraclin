import { and, eq } from 'drizzle-orm'

import { db } from '@/db/client'
import { leadAttributions } from '@/db/schema'

export type LeadAttribution = typeof leadAttributions.$inferSelect

export interface RecordAttributionInput {
  tenantId: string
  prospectId: string
  channel: string
  ctwaClid?: string | null
  fbclid?: string | null
  fbp?: string | null
  fbc?: string | null
  adId?: string | null
  adsetId?: string | null
  campaignId?: string | null
  adHeadline?: string | null
  sourceUrl?: string | null
  landingUrl?: string | null
  clientIp?: string | null
  userAgent?: string | null
}

export async function getAttribution(
  tenantId: string,
  prospectId: string,
): Promise<LeadAttribution | null> {
  const [row] = await db
    .select()
    .from(leadAttributions)
    .where(and(eq(leadAttributions.tenantId, tenantId), eq(leadAttributions.prospectId, prospectId)))
    .limit(1)

  return row ?? null
}

/**
 * The unique index on prospectId, not a read-then-write check, is the
 * first-touch rule: whichever capture site inserts first wins, and every
 * later capture for the same prospect is a no-op.
 */
export async function recordAttribution(
  input: RecordAttributionInput,
): Promise<{ recorded: boolean }> {
  const [inserted] = await db
    .insert(leadAttributions)
    .values(input)
    .onConflictDoNothing({ target: leadAttributions.prospectId })
    .returning()

  return { recorded: Boolean(inserted) }
}
