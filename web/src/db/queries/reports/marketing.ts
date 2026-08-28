import { db } from '@/db/client'
import { prospects, leadAttributions, financialEntries } from '@/db/schema'
import { and, eq, gte, lte, inArray } from 'drizzle-orm'
import { startOfBrDay, endOfBrDay } from '@/lib/dates'
import { directionalCompare, type SortDirection } from '@/lib/reports/sort'

export interface MarketingReportRow {
  key: string
  adLabel: string
  leads: number
  contacted: number
  scheduled: number
  converted: number
  revenue: number
  conversionRate: number
}

/** Server-recognized sort keys for this report. */
export type MarketingReportSortKey =
  | 'adLabel'
  | 'leads'
  | 'contacted'
  | 'scheduled'
  | 'converted'
  | 'revenue'
  | 'conversionRate'

export interface ListMarketingReportOptions {
  dateFrom: string
  dateTo: string
  sort?: { key: MarketingReportSortKey; dir: SortDirection }
}

const SORT_ACCESSORS: Record<MarketingReportSortKey, (row: MarketingReportRow) => string | number | null> = {
  adLabel: (row) => row.adLabel,
  leads: (row) => row.leads,
  contacted: (row) => row.contacted,
  scheduled: (row) => row.scheduled,
  converted: (row) => row.converted,
  revenue: (row) => row.revenue,
  conversionRate: (row) => row.conversionRate,
}

// A current stage is the only signal available (there is no stage-history
// table), so a `perdido` lead counts only toward `leads`: its current stage
// says nothing about how far it got before being lost.
const CONTACTED_STAGES = new Set(['contatado', 'qualificado', 'agendado', 'convertido'])
const SCHEDULED_STAGES = new Set(['agendado', 'convertido'])

const PAID_STATUSES = ['paid', 'partial'] as const

// Applied after sorting, same precedent as the other reports.
const MAX_ROWS = 200

/**
 * "Desempenho de campanhas": leads, funnel progress and revenue grouped by
 * the ad that produced them.
 *
 * Selects from `prospects` LEFT JOIN `lead_attributions`, never the other
 * way round: a manually added prospect has no attribution row, and an inner
 * join would silently drop it, overstating the ad-driven share of the
 * funnel. Grouping key is `campaignId ?? adId ?? channel ?? source`, so a
 * prospect with no attribution row (all three attribution fields null)
 * falls back to its own `source`.
 */
export async function listMarketingReportRows(
  tenantId: string,
  { dateFrom, dateTo, sort }: ListMarketingReportOptions,
): Promise<MarketingReportRow[]> {
  const leadRows = await db
    .select({
      stage: prospects.stage,
      source: prospects.source,
      convertedPatientId: prospects.convertedPatientId,
      campaignId: leadAttributions.campaignId,
      adId: leadAttributions.adId,
      channel: leadAttributions.channel,
      adHeadline: leadAttributions.adHeadline,
    })
    .from(prospects)
    .leftJoin(leadAttributions, eq(leadAttributions.prospectId, prospects.id))
    .where(
      and(
        eq(prospects.tenantId, tenantId),
        gte(prospects.createdAt, startOfBrDay(dateFrom)),
        lte(prospects.createdAt, endOfBrDay(dateTo)),
      ),
    )

  const convertedPatientIds = [
    ...new Set(leadRows.map((row) => row.convertedPatientId).filter((id): id is string => id !== null)),
  ]

  const revenueByPatient = new Map<string, number>()
  if (convertedPatientIds.length > 0) {
    const revenueRows = await db
      .select({
        patientId: financialEntries.patientId,
        totalAmount: financialEntries.totalAmount,
      })
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.tenantId, tenantId),
          inArray(financialEntries.patientId, convertedPatientIds),
          inArray(financialEntries.status, [...PAID_STATUSES]),
        ),
      )

    for (const row of revenueRows) {
      revenueByPatient.set(row.patientId, (revenueByPatient.get(row.patientId) ?? 0) + Number(row.totalAmount))
    }
  }

  const groups = new Map<string, MarketingReportRow>()

  for (const row of leadRows) {
    const key = row.campaignId ?? row.adId ?? row.channel ?? row.source
    let group = groups.get(key)
    if (!group) {
      group = { key, adLabel: row.adHeadline ?? key, leads: 0, contacted: 0, scheduled: 0, converted: 0, revenue: 0, conversionRate: 0 }
      groups.set(key, group)
    } else if (group.adLabel === key && row.adHeadline) {
      group.adLabel = row.adHeadline
    }

    group.leads += 1
    if (CONTACTED_STAGES.has(row.stage)) group.contacted += 1
    if (SCHEDULED_STAGES.has(row.stage)) group.scheduled += 1
    if (row.stage === 'convertido') group.converted += 1
    if (row.convertedPatientId) group.revenue += revenueByPatient.get(row.convertedPatientId) ?? 0
  }

  const rows = Array.from(groups.values()).map((group) => ({
    ...group,
    conversionRate: group.converted / group.leads,
  }))

  if (sort) {
    const accessor = SORT_ACCESSORS[sort.key]
    rows.sort((a, b) => directionalCompare(accessor(a), accessor(b), sort.dir))
  } else {
    rows.sort((a, b) => b.leads - a.leads)
  }

  return rows.slice(0, MAX_ROWS)
}
