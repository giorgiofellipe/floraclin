import { getPractitionerPL, type PractitionerPLRow } from '@/db/queries/cash-movements'
import { directionalCompare, type SortDirection } from '@/lib/reports/sort'

export type { PractitionerPLRow }

/** Server-recognized sort keys for this report. */
export type PractitionerEarningsSortKey =
  | 'practitionerName'
  | 'procedureCount'
  | 'revenueGenerated'
  | 'revenueCollected'

export interface ListPractitionerEarningsOptions {
  dateFrom: string
  dateTo: string
  practitionerId?: string
  sort?: { key: PractitionerEarningsSortKey; dir: SortDirection }
}

const SORT_ACCESSORS: Record<
  PractitionerEarningsSortKey,
  (row: PractitionerPLRow) => string | number | null
> = {
  practitionerName: (row) => row.practitionerName,
  procedureCount: (row) => row.procedureCount,
  revenueGenerated: (row) => row.revenueGenerated,
  revenueCollected: (row) => row.revenueCollected,
}

// Applied after sorting, same precedent as the other reports. In practice a
// clinic has nowhere near 200 practitioners, but the cap is kept for
// consistency with the rest of the reports section and as a hard ceiling.
const MAX_ROWS = 200

/**
 * "Ganhos por profissional": per-practitioner procedure count, gross revenue
 * (accrual, "Receita Gerada") and net revenue actually collected (cash,
 * "Receita Recebida") for a period, as a document practitioners can be paid
 * against.
 *
 * This deliberately reuses `getPractitionerPL` (the same query that backs
 * the existing Financeiro > Por Profissional P&L view) rather than
 * recomputing the figures a second way, so the report and the screen can
 * never disagree. There is no separate "commission" concept anywhere in the
 * codebase (no commission-rate column, no commission table), so "gross" and
 * "net" here map onto the two figures that query already produces:
 * `revenueGenerated` (accrual, gross) and `revenueCollected` (cash actually
 * received, net of what's still pending). This function only adds the
 * report-standard sort allow-list and the 200-row cap on top.
 */
export async function listPractitionerEarnings(
  tenantId: string,
  { dateFrom, dateTo, practitionerId, sort }: ListPractitionerEarningsOptions,
): Promise<PractitionerPLRow[]> {
  const rows = await getPractitionerPL(tenantId, dateFrom, dateTo, practitionerId)

  if (sort) {
    const accessor = SORT_ACCESSORS[sort.key]
    rows.sort((a, b) => directionalCompare(accessor(a), accessor(b), sort.dir))
  } else {
    // Default order: highest gross revenue first, so the clinic sees who
    // earned the most in the period without having to sort manually.
    rows.sort((a, b) => b.revenueGenerated - a.revenueGenerated)
  }

  return rows.slice(0, MAX_ROWS)
}
