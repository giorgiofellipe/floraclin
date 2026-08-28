import { db } from '@/db/client'
import { prospects, leadAttributions, financialEntries, installments, paymentRecords } from '@/db/schema'
import { and, asc, eq, gte, lte, inArray, isNull } from 'drizzle-orm'
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
 *
 * Revenue is what the patient actually paid inside the reported window
 * (`payment_records.principal_covered` by `paid_at`), the same "Receita
 * Recebida" figure `getPractitionerPL` produces, not the patient's lifetime
 * billing.
 *
 * Every prospect in the window is loaded: `leads`, `contacted`, `scheduled`
 * and `converted` are counts over the whole set, so a SQL `LIMIT` here would
 * silently understate them. `MAX_ROWS` caps the grouped output instead.
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
    .leftJoin(
      leadAttributions,
      and(eq(leadAttributions.prospectId, prospects.id), eq(leadAttributions.tenantId, prospects.tenantId)),
    )
    .where(
      and(
        eq(prospects.tenantId, tenantId),
        isNull(prospects.deletedAt),
        gte(prospects.createdAt, startOfBrDay(dateFrom)),
        lte(prospects.createdAt, endOfBrDay(dateTo)),
      ),
    )
    // Two `convertido` prospects can point at the same patient, and only one
    // of them may claim that patient's revenue. Without an explicit order the
    // planner decides which, so the same data yields different reports.
    .orderBy(asc(prospects.createdAt), asc(prospects.id))

  const convertedPatientIds = [
    ...new Set(leadRows.map((row) => row.convertedPatientId).filter((id): id is string => id !== null)),
  ]

  const revenueByPatient = new Map<string, number>()
  if (convertedPatientIds.length > 0) {
    const revenueRows = await db
      .select({
        patientId: financialEntries.patientId,
        amount: paymentRecords.principalCovered,
      })
      .from(paymentRecords)
      .innerJoin(installments, eq(installments.id, paymentRecords.installmentId))
      // Tenant equality is asserted in the join, not just filtered on the
      // entry: the foreign keys allow an installment of one tenant to hang
      // off another tenant's entry, and there is no row level security to
      // catch it, so one clinic's payment could land in another's report.
      .innerJoin(
        financialEntries,
        and(
          eq(financialEntries.id, installments.financialEntryId),
          eq(financialEntries.tenantId, installments.tenantId),
        ),
      )
      .where(
        and(
          eq(financialEntries.tenantId, tenantId),
          eq(installments.tenantId, tenantId),
          inArray(financialEntries.patientId, convertedPatientIds),
          isNull(financialEntries.deletedAt),
          isNull(paymentRecords.reversedAt),
          gte(paymentRecords.paidAt, startOfBrDay(dateFrom)),
          lte(paymentRecords.paidAt, endOfBrDay(dateTo)),
        ),
      )

    for (const row of revenueRows) {
      revenueByPatient.set(row.patientId, (revenueByPatient.get(row.patientId) ?? 0) + Number(row.amount))
    }
  }

  const groups = new Map<string, MarketingReportRow>()
  // `uq_prospects_tenant_phone` excludes `convertido`, so the same patient can
  // be pointed at by several converted prospect rows. The revenue belongs to
  // the oldest of them (the query orders by `createdAt`), never to both.
  const countedPatientIds = new Set<string>()

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
    if (row.convertedPatientId && !countedPatientIds.has(row.convertedPatientId)) {
      countedPatientIds.add(row.convertedPatientId)
      group.revenue += revenueByPatient.get(row.convertedPatientId) ?? 0
    }
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
