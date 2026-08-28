import { and, eq, gte, isNotNull, isNull } from 'drizzle-orm'

import { db } from '@/db/client'
import { leadAttributions } from '@/db/schema'
import type { MetaConnection } from '@/db/queries/meta-connections'

import { META_GRAPH_VERSION } from './types'

const LOOKUP_CAP = 50
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000

interface AdMetadataResponse {
  name?: string
  adset?: { id?: string }
  campaign?: { id?: string }
}

/**
 * Token goes in the Authorization header, never the query string: Vercel
 * and Sentry both log request URLs, and this GET has no body to carry it
 * in instead, unlike capi-client's POST.
 */
async function fetchAdMetadata(adId: string, accessToken: string): Promise<AdMetadataResponse | null> {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${adId}?fields=adset{id},campaign{id},name`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      // Mirrors capi-client: a hung Meta socket must not hang the cron run.
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${accessToken}` },
    })
  } catch {
    return null
  }

  if (!response.ok) return null

  try {
    return (await response.json()) as AdMetadataResponse
  } catch {
    return null
  }
}

/**
 * Fills in `adsetId` and `campaignId` on recent attribution rows, which the
 * webhook `referral` object never carries (it only has the ad id), so the
 * marketing report can group by campaign instead of falling back to ad id.
 * Manual system-user tokens are not guaranteed `ads_read`, so only an
 * OAuth connection is trusted to look this up.
 */
export async function backfillAdMetadata(
  tenantId: string,
  connection: MetaConnection,
): Promise<{ resolved: number }> {
  if (connection.connectionType !== 'oauth') return { resolved: 0 }

  const windowStart = new Date(Date.now() - WINDOW_MS)

  const rows = await db
    .select({
      id: leadAttributions.id,
      adId: leadAttributions.adId,
      adHeadline: leadAttributions.adHeadline,
    })
    .from(leadAttributions)
    .where(
      and(
        eq(leadAttributions.tenantId, tenantId),
        isNull(leadAttributions.campaignId),
        isNotNull(leadAttributions.adId),
        gte(leadAttributions.capturedAt, windowStart),
      ),
    )
    .limit(LOOKUP_CAP)

  let resolved = 0

  for (const row of rows) {
    if (!row.adId) continue

    // A failed lookup leaves adsetId/campaignId null; the 7-day window
    // above is what stops it from being retried forever, not a status flag.
    const metadata = await fetchAdMetadata(row.adId, connection.accessToken)
    if (!metadata) continue

    await db
      .update(leadAttributions)
      .set({
        adsetId: metadata.adset?.id ?? null,
        campaignId: metadata.campaign?.id ?? null,
        ...(row.adHeadline ? {} : { adHeadline: metadata.name ?? null }),
      })
      .where(and(eq(leadAttributions.tenantId, tenantId), eq(leadAttributions.id, row.id)))

    resolved += 1
  }

  return { resolved }
}
