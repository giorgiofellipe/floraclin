# Relatórios: design

**Status:** approved, ready for planning
**Scope:** three related but independently shippable sub-projects behind one shell

## Problem

`Relatórios` exists in the sidebar as `{ href: '#', disabled: true }`
(`web/src/components/layout/sidebar.tsx:50`). Nothing is behind it.

The trap is building a Relatórios section that re-renders what Financeiro
already shows. Financeiro already has a monthly revenue chart with breakdowns by
procedure type and payment method, a cash ledger with CSV export, and a
per-practitioner P&L. Reports must earn their place by doing something those
screens do not.

Business intelligence was explicitly rejected during design. The clinic does not
need another chart of how it is doing. It needs lists that end in an action,
documents that leave the system, and clinical records it can hand to a patient.

## Decisions

| Decision | Choice | Consequence |
|---|---|---|
| Purpose | Actionable lists, exports, clinical records. Not BI. | No retention-rate or funnel dashboards. Revisit only if asked. |
| Access | Owner and financial only | Practitioners cannot pull a clinical report on their own patients. Recorded as a known cost, see Trade-offs. |
| Formats | CSV and PDF from the start | Affordable because the PDF pipeline already exists, see below. |
| Decomposition | Three sub-projects, one shell, built in sequence | Each ships independently. |

## What already exists and gets reused

Nothing here needs a new pipeline.

- **PDF.** `web/src/lib/pdf.ts` exports `renderReactToPdf()` on puppeteer-core
  plus `@sparticuz/chromium-min`, with shared `PRINT_BASE_CSS`. Already in
  production behind `/api/consent/[id]/pdf` and
  `/api/clinical-documents/[id]/pdf`. Reports render React and hand it to the
  same function.
- **CSV.** `/api/financial/ledger/export/route.ts` establishes the pattern:
  build the string in a query module, return it with `text/csv; charset=utf-8`
  and a `Content-Disposition` attachment header.
- **Queries.** `db/queries/followups.ts` and `db/queries/birthdays.ts` already
  compute part of the recall data.
- **Traceability.** `product_applications` carries `product_name`,
  `active_ingredient`, `total_quantity`, `quantity_unit`, `batch_number`,
  `expiration_date` and `label_photo_id`. The procedure log is a real lot-level
  record, not a list of product names.

No migration is required. The one piece of configuration, the inactivity
threshold, lives in `tenants.settings` rather than a new column.

## Shell

Route `/relatorios`, with each report at `/relatorios/<slug>`.

Permission is enforced once, in the shell, not per report. A single guard
checks the role is `owner` or `financial` and the sidebar entry is hidden
otherwise, so an unauthorised role never sees a link it cannot open.

`<ReportShell>` owns the filter bar, the empty state, the loading state and the
export buttons. Adding a report is a query plus a column definition plus a
filter declaration. It is not a new page layout.

Every report route accepts `?format=csv` and `?format=pdf` and returns a file;
without the parameter it returns JSON for the table. One route, three
representations, so the exported file and the screen can never disagree.

Filters are declarative per report (`date-range`, `practitioner`, `threshold`)
and the shell renders them. Date filtering uses `@/lib/dates` helpers
throughout: `startOfBrDay` for lower bounds, `endOfBrDay` for upper bounds.

## Sub-project 1: Recall e retorno

Every row ends in a WhatsApp message. These are work lists, so each row carries
a patient phone and a send action, and the table is ordered by urgency rather
than alphabetically.

**1.1 Pacientes inativos.** Patients whose most recent `procedure_records.performed_at`
is older than N days, plus patients with no procedure at all who were created
more than N days ago. N is configurable per clinic in `tenants.settings`,
default 180. Columns: patient, last procedure, days since, last procedure type,
lifetime value. Ordered by lifetime value descending, because a lapsed patient
who spent R$ 8.000 is worth calling before one who spent R$ 350.

**1.2 Retornos a vencer.** `procedure_records.follow_up_date` falling in a
window, defaulting to the next 30 days, excluding patients who already have a
future appointment. That exclusion is the whole point: a list that tells you to
chase someone already booked is noise. Builds on `followups.ts`.

**1.3 Faltas recorrentes.** Patients with two or more `no_show` or late
`cancelled` appointments in a rolling window. Columns: patient, count, dates,
total value of the missed slots. Informs whether to require a deposit.

## Sub-project 2: Exportações

The value is the file, not the screen. Each of these renders a compact on-screen
preview and a correct document.

**2.1 Extrato por período.** Extends the existing ledger export with a PDF
variant carrying clinic letterhead. CSV output stays byte-compatible with what
`exportLedgerCSV` produces today so nobody's existing spreadsheet breaks.

**2.2 Ganhos por profissional.** The practitioner P&L figures as a signed
document, per practitioner per period, for actually paying people. Includes
procedure count, gross, commission basis and net.

**2.3 Procedimentos realizados.** The traceability log. One row per
`product_applications` record: date, patient, practitioner, product, active
ingredient, quantity and unit, batch number, expiration. This is the record a
clinic produces if an application is ever questioned, so it must be exportable
as a tamper-evident PDF with a generation timestamp, not only as CSV.

## Sub-project 3: Clínicos

**3.1 Prontuário completo.** One patient's full history as a PDF: identification,
anamnese, every procedure with products and doses, face diagram points, photo
timeline and signed consents. Printable and handable to the patient. This is the
heaviest single report and the most differentiating: generic clinic software
does not produce it.

**3.2 Pendências documentais.** Patients missing a completed anamnese or a
signed consent for a procedure already performed. Both a compliance gap and a
work list, so rows carry a send action for the anamnesis or signing link.

## Testing

Each report gets query-level unit tests covering the boundary that defines it,
because these reports are mostly one predicate each and the predicate is the
product:

- inactivity threshold exactly at the boundary day, in BR time, on a UTC host
- a follow-up due today, and one for a patient who already rebooked (excluded)
- a patient with exactly one no-show (excluded) and exactly two (included)
- CSV output shape asserted against a fixture, since a column reorder silently
  breaks whatever the accountant imports into

Shell tests assert the permission guard rejects practitioner and receptionist
roles, and that `?format=` returns the right content type and disposition.

## Trade-offs recorded

**Practitioners cannot see clinical reports.** Owner-and-financial-only was
chosen for simplicity. The cost is that a practitioner cannot pull a prontuário
for a patient they treated, which is the single most defensible use of that
report. If practitioners ask, the fix is to move report 3.1 to a per-report role
list rather than loosening the whole section.

**No aniversariantes report.** `birthdays.ts` already feeds the dashboard. A
report that duplicates an existing widget does not justify a route.

**No BI.** Retention rate, conversion funnel and procedure-mix trend were
considered and cut. They answer "how is the clinic doing", which the Painel and
Financeiro already partly serve, rather than "what do I do today".

## Build order

1. Shell plus sub-project 1. Ships the fastest value and proves the shell.
2. Sub-project 2. Reuses established export machinery.
3. Sub-project 3. Heaviest, and benefits from the shell being settled.
