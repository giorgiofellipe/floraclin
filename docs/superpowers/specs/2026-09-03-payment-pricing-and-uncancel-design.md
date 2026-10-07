# Payment pricing and un-cancel: design

**Status:** approved, ready for planning

## Problem

Sentry `FLORACLIN-S` (5 events, 2026-09-03, tenant `dra-micaela-floriani`). The
clinic owner tried to record a R$750 payment, was rejected five times with
"Valor do pagamento excede o total devido", and cancelled both charges instead.

The client and the server each compute the total due, independently, at
different instants:

1. The list projection prices interest as of **now**
   (`web/src/db/queries/financial.ts:1430-1443`, `getDaysOverdue` with no `asOf`).
2. The dialog prefills the amount field with that total
   (`web/src/components/financial/partial-payment-dialog.tsx:46-48`).
3. The dialog sends the picked date as `new Date(paidAt).toISOString()`
   (`partial-payment-dialog.tsx:79`). `DatePicker` emits `yyyy-MM-dd`
   (`web/src/components/ui/date-picker.tsx:37`), so this parses as UTC
   midnight, which is 21:00 BRT the previous day.
4. `recordPayment` reprices interest as of that earlier instant
   (`financial.ts:501-529`) and rejects at `financial.ts:531-533`, because the
   tolerance is 2 centavos.

Reproduced with the production row (750.00, due 2026-05-22, nothing paid) and
the tenant's settings (fine 2%, interest 1%/month, grace 0):

```
client / list (now)    asOf=2026-09-03T14:04:50Z  days=104  interest=26.00  totalDue=791.00
server (picked date)   asOf=2026-09-03T00:00:00Z  days=103  interest=25.75  totalDue=790.75

prefilled amount = 791.00
guard: 791.00 > 790.75 + 0.02  ->  throws      gap = R$ 0.25 (one day of interest)
```

Three more defects sit in the same path:

- The throw reaches `handleApiError`, so a user input error answers 500 and
  pages Discord. The route's 400 branch matches on message substrings
  (`web/src/app/api/financial/installments/[id]/pay/route.ts:57-58`) and this
  message is not in the list.
- Cancelling a charge is irreversible. The dialog says so
  (`web/src/components/financial/bulk-action-bar.tsx:188`). The owner had no
  way back after giving up.
- `web/src/components/financial/installment-table.tsx:83` reads
  `getDaysOverdue(startDate, inst.lastFineInterestCalcAt ? 0 : 0)`. Both
  branches are `0`, so that fallback ignores the tenant grace period.

Separately, the owner reported she cannot record a payment on the date it
actually happened. Backdating is half-built: `replayPayments`
(`web/src/lib/financial/penalties.ts:123-183`) already prices each payment as
of its own `paidAt`, but `recordPayment` only calls it when `isBackdated` is
true, meaning "earlier than an existing payment". A first payment with a past
date takes the ad-hoc branch instead.

## Scope

The installment payment path and the charge cancel path, tenant-facing.
Expenses (`/api/expenses/installments/:id/pay`) share none of this code and are
out of scope.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Who prices a payment | The server, through a quote endpoint | One pricer cannot disagree with itself. Removes the bug class rather than the instance. |
| The `isBackdated` fork | Deleted; always replay | `replayPayments` is the general form and the fork is a drifting specialization of it. |
| Backdate range | Any past date, future rejected | She forgot to record it. Future dates are always a mistake and are accepted today. |
| Un-cancel scope | Entry level, mirroring bulk cancel | There is no per-installment cancel to mirror, so a row-level un-cancel would be a one-way pair. |
| Renegotiation-derived charges | Refused, with a message | Cancel deletes the `renegotiation_links` rows, so the renegotiation cannot be rebuilt. |
| Payment allocations | Recomputed on every write | Art. 354 ordering depends on the full sequence. Reversal already does this. |
| Business errors | `BusinessError` plus one `instanceof` | The established pattern in this repo. Kills the message-substring matching. |

### Rejected alternatives

**Fix the timezone and widen the tolerance.** Two lines. Rejected because the
client and the server still price independently, so any genuinely backdated
payment drifts again, by more than a tolerance can absorb.

**Soft-delete `renegotiation_links` so un-cancel can rebuild a renegotiation.**
Fully reversible. Rejected as scope: it adds a column and widens the cancel
path to serve a case the owner has not hit.

## Part 1: one pricer

New pure function in `web/src/lib/financial/penalties.ts`, beside
`replayPayments`:

```ts
export function quoteInstallment(
  base: InstallmentBase,
  existingPayments: PaymentInput[],
  asOf: Date,
): { remainingPrincipal: number; fineAmount: number; interestAmount: number; totalDue: number }
```

It replays the existing payments, then prices the leftover state at `asOf`.
This is the only answer to "how much is owed on this installment at this
instant". The guard, the endpoint and the tests all read it.

`recordPayment` drops the `isBackdated` branch and always calls
`replayPayments(base, [...existing, new])`. The guard becomes:

```ts
if (data.amount > quote.totalDue + 0.01) {
  throw new BusinessError('PAYMENT_EXCEEDS_DUE', 'Valor do pagamento excede o total devido')
}
```

Replaying rewrites the `interest_covered` / `fine_covered` / `principal_covered`
split on every prior `payment_record` for that installment. The backdated
branch and `reversePayment` already do exactly this; the change makes it
uniform, not new.

## Part 2: the quote endpoint and the dialog

`GET /api/financial/installments/[id]/quote?paidAt=<ISO>`. Roles match the pay
route: owner, receptionist, financial. `paidAt` is optional and defaults to
now. Response:

```json
{
  "remainingPrincipal": 750,
  "fineAmount": 15,
  "interestAmount": 26,
  "totalDue": 791,
  "asOf": "2026-09-03T15:00:00.000Z"
}
```

`PartialPaymentDialog` stops doing money math:

- prefills the amount from `totalDue`
- refetches when the date changes
- renders the breakdown from the response
- keeps `allocatePayment` for the Art. 354 preview only, fed by the server's
  state, so the preview cannot disagree with the charge
- sends `parseBrDate(paidAt, '12:00:00').toISOString()` for both the quote and
  the pay call, so the two agree by construction

`isOverpayment` stays as a client guard but reads the server's `totalDue`.

The `installment` prop keeps feeding the dialog's identity and the initial
render; the quote replaces it as the source of the numbers.

## Part 3: backdate rules and the Meta side effect

- `recordPaymentSchema` and `bulkPaySchema`
  (`web/src/validations/financial.ts`) reject a `paidAt` in the future. Today
  neither bounds it.
- No lower bound.
- `emitPurchaseEventForEntry` (`financial.ts:222`) returns `null` when
  `eventTime` is older than `META_EVENT_WINDOW_DAYS`
  (`web/src/db/queries/meta-events.ts:7`, currently 7).

The Meta rule matters because `eventTime` is `paidAt`
(`financial.ts:607-612`, `financial.ts:983-989`). Without the gate, recording a
three-month-old payment enqueues a Purchase that Meta rejects on age: the row
lands `failed` and can trip the per-tenant failure alert. The cron already
drops stale rows in `dropStaleEvents`
(`web/src/app/api/cron/meta-events/route.ts:120-137`); this makes the inline
path agree with it. `eventId` is `purchase:<entryId>`, one per charge, so a
later on-time payment on the same charge still emits.

## Part 4: un-cancel

`uncancelEntries(tenantId, userId, { entryIds, reason })` in
`web/src/db/queries/financial.ts`, mirroring `bulkCancelEntries`. Route
`POST /api/financial/bulk/uncancel`, roles owner and financial, matching bulk
cancel.

Order of work inside the transaction:

1. Load the entries, scoped to the tenant and not soft-deleted. Refuse any that
   are not `cancelled`.
2. Refuse any entry whose cancel wrote `changes.revertedOriginals`. Cancel
   deletes the `renegotiation_links` rows (`financial.ts:1105-1106`), so the
   audit log is the only durable trace. `audit_logs` is indexed on
   `(entity_type, entity_id)`. Message: the charge came from a cancelled
   renegotiation and the renegotiation has to be redone.
3. Restore that entry's installments from `cancelled` to `pending`. Paid ones
   were never cancelled, so they need no filter beyond the status match.
4. Call the existing `updateEntryStatus` (`financial.ts:1708`), which already
   derives `pending` / `partial` / `paid` / `cancelled` from the installments.
   No new status logic.
5. Write one audit log per entry, with the reason.

No migration. `pg_constraint` has no CHECK on `financial_entries.status` or
`installments.status` in production, and no new status value is introduced
regardless.

UI: a "Reativar" action in `bulk-action-bar.tsx`, enabled when every selected
entry is `cancelled`, with a reason field matching the cancel dialog. The list
already supports a `cancelled` status filter
(`web/src/validations/financial.ts:5`), so the charges are reachable. The
cancel dialog's "Esta ação não pode ser desfeita" is corrected.

## Part 5: the four original defects

1. Timezone: absorbed by `parseBrDate` in Part 2.
2. Dual pricing: absorbed by the quote endpoint in Part 2.
3. The 500: `recordPayment`'s business throws become `BusinessError`, and the
   pay route does one `instanceof` check returning 409. This deletes the
   substring matching at `pay/route.ts:57-58`, which is the same fragility that
   `ForbiddenError` was introduced to remove.
4. The grace typo at `installment-table.tsx:83`.

## Testing

Unit tests only. No Supabase, per the project rule.

- `quoteInstallment` reproduces the production case: 750.00, due 2026-05-22,
  fine 2%, interest 1%/month, grace 0. A quote at `2026-09-03T14:04:50Z` is
  791.00 and one at `2026-09-03T00:00:00Z` is 790.75. Paying the quoted amount
  succeeds in both cases.
- Always-replay parity: a single on-time payment and a single overdue payment
  produce the same installment state the old normal flow produced.
- A `paidAt` in the future is rejected by both schemas.
- The Purchase event is skipped when `paidAt` is older than the Meta window,
  and emitted when it is inside it.
- `uncancelEntries` restores entry and installment statuses, refuses an entry
  that is not cancelled, and refuses a renegotiation-derived one.
- `PartialPaymentDialog` prefills from the quote and refetches when the date
  changes.

## Out of scope

- Expense installment payments.
- Rebuilding a renegotiation after its replacement charge was cancelled.
- Per-installment cancel and un-cancel.
- Freezing `payment_records` allocations once written.
