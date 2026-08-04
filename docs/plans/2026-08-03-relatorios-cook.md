# Relatórios shell + recall lists: implementation plan

> **For agentic workers:** implement task by task. Steps use `- [ ]` for tracking.

**Goal:** ship `/relatorios` with the three recall reports from
`docs/superpowers/specs/2026-08-03-relatorios-design.md`, sub-project 1 only.

**Scope:** shell plus Pacientes inativos, Retornos a vencer, Faltas recorrentes.
Exports (sub-project 2) and clinical reports (sub-project 3) are out of scope.

**Architecture:** a report is a query module plus a definition. The shell owns
permission, filters, table, empty state and export wiring, so adding a report
never means writing a page layout.

---

## Verified against the source

Checked, not assumed. Getting any of these wrong wastes a task.

1. `requireRole(...roles)` exists at `web/src/lib/auth.ts:127` and **throws**
   `Error('Forbidden: insufficient permissions')`. It does not return a flag, so
   callers must catch or let the route boundary handle it.
2. The sidebar entry is `{ href: '#', label: 'Relatórios', icon: TrendingUp, disabled: true }`
   at `web/src/components/layout/sidebar.tsx:50`. It must become a real link,
   conditional on role.
3. **`followups.ts` does NOT compute follow-up dates.** It exports
   `listOpenPlanejamentos` / `OpenPlanejamentoRow`, which is about open treatment
   plans. The design doc's claim that it partly covers recall is wrong. Retornos
   needs a new query against `procedure_records.follow_up_date`.
4. CSV pattern: `web/src/app/api/financial/ledger/export/route.ts` returns a
   string with `Content-Type: text/csv; charset=utf-8` and a
   `Content-Disposition: attachment; filename="..."` header.
5. PDF pipeline: `web/src/lib/pdf.ts` exports `renderReactToPdf()` and
   `PRINT_BASE_CSS`. Read its actual signature before calling it.
6. `procedure_records.follow_up_date` is a `date` column (BR calendar day), and
   `performed_at` is `timestamptz` (an instant). They need different date
   handling: `startOfBrDay`/`endOfBrDay` for `performed_at` ranges, direct string
   comparison for `follow_up_date`.
7. The sidebar **does** receive the role: `Sidebar({ ..., userRole, ... })` at
   `web/src/components/layout/sidebar.tsx:436`. But the nav array is a
   module-level constant, so gating must happen at render time, not by editing
   the array literal.
8. `web/src/components/patients/birthday-row-actions.tsx` is an existing per-row
   WhatsApp action. Reuse it for the recall lists rather than inventing a new
   send affordance.
9. Appointment statuses are `'scheduled' | 'confirmed' | 'in_progress' |
   'completed' | 'cancelled' | 'no_show' | 'pending_reschedule'`
   (`web/src/types/index.ts:3`).

---

## Group A: shared contracts

### Task A1: report types, registry and CSV helper

**Files:**
- Create: `web/src/lib/reports/types.ts`
- Create: `web/src/lib/reports/registry.ts`
- Create: `web/src/lib/reports/csv.ts`
- Test: `web/src/lib/reports/__tests__/csv.test.ts`

`types.ts` defines:

```ts
export type ReportFilterKind = 'date-range' | 'threshold-days' | 'practitioner'

export interface ReportColumn<Row> {
  key: string
  header: string
  /** Rendered in the table and written to CSV. Keep them the same so the
   *  exported file and the screen can never disagree. */
  value: (row: Row) => string
  align?: 'left' | 'right'
}

export interface ReportDefinition {
  slug: string
  title: string
  description: string
  filters: ReportFilterKind[]
}
```

`registry.ts` exports `REPORTS: ReportDefinition[]` with the three recall
reports, and `getReport(slug)`. The landing page and the route handlers both
read from it, so a report cannot exist in one and not the other.

`csv.ts` exports:
- `toCsv<Row>(rows: Row[], columns: ReportColumn<Row>[]): string` — RFC 4180
  quoting: wrap in double quotes when the value contains a comma, quote or
  newline, and escape embedded quotes by doubling them. Emits a header row.
  Prefix a value starting with `=`, `+`, `-` or `@` with a single quote, because
  a patient name field is attacker-influenced and Excel executes formulas.
- `csvFilename(slug: string, today: string): string`

Tests: quoting for commas, embedded quotes, newlines; formula-injection prefix;
header row matches column order; empty rows still emit the header.

- [ ] Write the three files and the test, run `pnpm test:run src/lib/reports`, commit.

---

## Group B: report queries (3 agents in parallel)

Each owns one query file and its test. No shared files. All accept `today: Date`
as a parameter rather than calling `new Date()`, so tests are deterministic and
month boundaries cannot break them.

### Task B1: pacientes inativos

**Files:** `web/src/db/queries/reports/inactive-patients.ts`, `__tests__/inactive-patients.test.ts`

`listInactivePatients(tenantId, { thresholdDays, today })`. Returns patients
whose most recent `procedure_records.performed_at` is older than
`thresholdDays`, **plus** patients with no procedure at all created more than
`thresholdDays` ago. Columns: patient name, phone, last procedure date, days
since, last procedure type, lifetime value (sum of paid installments).

Ordered by lifetime value descending: a lapsed patient worth R$ 8.000 gets
called before one worth R$ 350.

Excludes soft-deleted patients (`deleted_at IS NULL`) everywhere.

Tests: a patient exactly at the threshold boundary (excluded) and one day past
(included), computed in BR time on a UTC host; a never-treated patient older
than the threshold (included); a never-treated patient created yesterday
(excluded); ordering by lifetime value; soft-deleted patients absent.

### Task B2: retornos a vencer

**Files:** `web/src/db/queries/reports/due-followups.ts`, `__tests__/due-followups.test.ts`

`listDueFollowUps(tenantId, { windowDays, today })`. Rows where
`procedure_records.follow_up_date` falls within the window,
**excluding patients who already have a future appointment** in
`scheduled`, `confirmed` or `in_progress`. That exclusion is the point of the
report: telling the clinic to chase someone already booked is noise.

`follow_up_date` is a DATE column holding a BR calendar day. Compare it as a
`YYYY-MM-DD` string built with `brToday()` and date arithmetic. Do NOT convert it
through `new Date()`.

Tests: a follow-up due today (included); due tomorrow within the window
(included); one day past the window (excluded); a patient with a future
appointment (excluded); the same patient with only a past appointment
(included); an overdue follow-up (included, and flagged).

### Task B3: faltas recorrentes

**Files:** `web/src/db/queries/reports/repeat-no-shows.ts`, `__tests__/repeat-no-shows.test.ts`

`listRepeatNoShows(tenantId, { windowDays, minCount, today })`. Patients with
`minCount` or more appointments in status `no_show` or `cancelled` within the
window. Default `minCount` 2, window 180 days. Returns count, the dates, and the
total value of the missed slots via the appointment's procedure type price.

Tests: exactly `minCount - 1` occurrences (excluded); exactly `minCount`
(included); occurrences straddling the window edge; cancelled and no_show both
counted; value summed from procedure type price; a patient with zero (absent).

---

## Group C: shell (2 agents in parallel)

### Task C1: shell components

**Files:**
- Create: `web/src/components/reports/report-shell.tsx`
- Create: `web/src/components/reports/report-table.tsx`
- Create: `web/src/components/reports/report-filters.tsx`
- Create: `web/src/components/reports/export-buttons.tsx`
- Create: `web/src/components/reports/report-pdf.tsx`
- Test: `web/src/components/reports/__tests__/report-table.test.tsx`

`<ReportShell>` renders title, description, filters, the table and the export
buttons. `<ReportTable>` takes `columns` and `rows` and renders both the header
and the cells through `column.value`, the same function CSV uses.

`report-pdf.tsx` is a React component rendering a report as a printable
document with clinic name, report title, filter summary and a generation
timestamp, styled with `PRINT_BASE_CSS` from `@/lib/pdf`. Read that module's
actual export signature before wiring it.

Export buttons link to `?format=csv` and `?format=pdf` on the current route with
the current filters preserved in the query string.

Tests: table renders one row per record and applies `column.value`; empty state
appears when rows are empty; export links carry the active filters.

### Task C2: route shell, landing page and sidebar

**Files:**
- Create: `web/src/app/(platform)/relatorios/layout.tsx`
- Create: `web/src/app/(platform)/relatorios/page.tsx`
- Modify: `web/src/components/layout/sidebar.tsx`
- Test: `web/src/app/(platform)/relatorios/__tests__/layout.test.tsx`

`layout.tsx` guards the whole section with `requireRole('owner', 'financial')`.
It throws, so catch it and render a forbidden state rather than letting a raw
error escape. Enforce here once, never per report.

`page.tsx` lists report cards from `REPORTS` in the registry.

`sidebar.tsx`: replace the disabled stub with a real link to `/relatorios`,
shown only for `owner` and `financial`. A role that cannot open it must not see
it. Check how the sidebar already accesses the current role before adding a new
mechanism.

Tests: practitioner and receptionist are refused; owner and financial pass.

---

## Group D: report pages and routes (3 agents in parallel)

Each task owns one page and one API route. No shared files.

| Task | Page | Route | Query |
|---|---|---|---|
| D1 | `relatorios/pacientes-inativos/page.tsx` | `api/reports/inactive-patients/route.ts` | `listInactivePatients` |
| D2 | `relatorios/retornos/page.tsx` | `api/reports/due-followups/route.ts` | `listDueFollowUps` |
| D3 | `relatorios/faltas/page.tsx` | `api/reports/repeat-no-shows/route.ts` | `listRepeatNoShows` |

Every route:
- calls `requireRole('owner', 'financial')` and returns 403 on refusal
- reads filters from the query string and validates them, rejecting a
  non-numeric or negative threshold with 400 rather than coercing it
- returns JSON with no `format`, CSV with `format=csv`, PDF with `format=pdf`
- uses the same query and the same column definitions for all three, so the file
  and the screen cannot disagree

Each page renders `<ReportShell>` with its columns and a WhatsApp send action per
row, reusing whatever the CRM or patient list already uses to open a conversation
rather than inventing a new one. Find it before writing it.

Tests per task: route returns 403 for a practitioner, 400 for a bad filter, and
the right content type and `Content-Disposition` for each format.

---

## Notes

**Inactivity threshold** reads from `tenants.settings.inactive_threshold_days`,
defaulting to 180 when absent. No settings UI in this build: the report's own
filter control is enough, and a settings screen is separate scope.

**No migration.** Everything derives from existing tables.

## Self-review focus

- Bare `new Date('YYYY-MM-DD')` or `.toISOString().split('T')[0]`
- A report route that skips the role guard
- Column definitions duplicated between the page and the export route
- Any query missing `deleted_at IS NULL`
