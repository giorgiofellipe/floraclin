# Card sales: maquininhas, card payments and repasses

Issue: #87. Related: #88 (bank reconciliation, out of scope here).

## Intent

When a patient pays by card, the patient owes nothing after the swipe. The maquininha company (Stone, InfinitePay, Cielo...) owes the clinic the amount minus a fee, on its own dates. Today FloraClin records "cartão 6x" as 6 pending patient installments. The patient then gets WhatsApp payment reminders (PR #85), overdue status and penalties for money already paid on the card. The only workaround (bulk "Marcar como pago") records the gross amount as cash received today, so revenue, cash flow and dates are wrong.

Success: a card sale settles the patient side at once, the clinic sees what each maquininha still owes and when, the ledger receives net amounts on the real payout dates, and reports show gross, fees and net.

## Core decision: card is a way to pay, not a type of charge

The card applies when a payment is recorded, not when a charge is created. The "6x" belongs to the card payment, not to the patient debt. This covers both real cases (confirmed by the user):

- The sale: a "cartão de crédito 6x" plan becomes a charge with 1 patient installment, paid by card.
- Later: a patient pays installment 3 of a Pix plan by card. That installment is paid, and the repasse schedule starts from that day.

## Goals

1. Save the planned payment method on the charge (`financial_entries`), from the procedure plan and from a new select in "Nova cobrança".
2. Maquininha settings per tenant (any number of maquininhas).
3. Recording a payment with `credit_card` or `debit_card` asks for the maquininha and (credit only) the card parcela count, shows gross, fee and net, and creates a repasse schedule. It creates no cash movement at payment time.
4. A daily job posts each due repasse to the ledger with its net amount, on its date.
5. A "Repasses de cartão" view in Financeiro, with "Ajustar repasse".
6. Reports show gross, "Taxas de cartão" and net.
7. Card reversal cancels future repasses, and the UI says clearly what happens and what the clinic must do.
8. `{{forma_pagamento}}` keeps working from the saved method (for example "Cartão de crédito em 6x").

## Non-goals

- Bank reconciliation, statement import, acquirer APIs, NSU matching (#88).
- On-demand antecipação. Automatic antecipação is covered by the payout mode.
- Bandeira groups (Visa/Master vs Elo/Amex). One rate table per maquininha.
- The "fixed % + % per parcela" rate form. The clinic types the effective rate per count.
- Parcelado emissor as a special case. For the clinic it is a credit 1x sale.
- Card fee as an expense in Despesas.
- Fee-adjusted practitioner commission.
- Migration of existing card charges. New rules apply only to new payments. For an old charge, the clinic pays the open installments with the new card option, and the schedule starts from that day.
- National holiday calendar for business days.

## Anti-goals

- The patient gets a reminder, overdue status or penalty for an installment paid by card.
- The ledger shows a card sale as cash received on the sale day.
- A reversal silently leaves future repasses in place, or leaves the user unsure whether to refund the patient.

## Decisions

### Maquininha settings (Configurações › Financeiro › Maquininhas)

User approved the mockup. Per maquininha:

- Name.
- "Padrão" flag. Exactly one active maquininha may be the default; the payment dialog preselects it.
- Debit: rate (%) and payout in D+X business days.
- Credit: rate (%) for each count 1x to 12x.
- Credit payout mode, one of:
  - "Por parcela": one repasse every 30 calendar days (D+30, D+60...).
  - "Valor único (antecipação automática)": one repasse at D+X business days. The rate the clinic enters already includes the antecipação cost, as acquirers quote it.
- Removing a maquininha is a soft delete. Its repasses stay. It leaves the payment dialog list.

Business days skip Saturday and Sunday only.

### Payment dialog ("Registrar Pagamento")

User approved summary B. When the method is "Cartão de crédito" or "Cartão de débito", two fields appear: "Maquininha" and (credit only) "Parcelas no cartão" (1x to 12x). A summary shows:

```
Valor da venda              R$ 3.000,00
Taxa (8,99%)              − R$ 269,70
Você recebe                 R$ 2.730,30
6 repasses de R$ 455,05, a partir de 17/11/2026
```

For a lump-sum maquininha the fee line reads "Taxa com antecipação (11,49%)" and the last line "1 repasse de R$ 2.655,30 em 19/10/2026 (antecipado)".

The rate is the maquininha's rate for that count at the moment of payment, and it is frozen on the card payment. Later rate edits never change existing repasses.

The same fields apply to bulk pay: one card payment for the total of the selected installments, one repasse schedule. Bulk pay must stop recording card payments as immediate cash.

### Rounding

Fee = round(gross × rate, 2). Net = gross − fee. For per-parcela payout, split net into N repasses in cents; the last repasse takes the remainder so the sum equals net exactly. Same for the fee per repasse (each repasse stores its gross, fee and net, and the sums match the payment).

### Repasse dates

Calendar days are BR days. Use `@/lib/dates` helpers (`brToday`, `parseBrDate`, `toBrYmd`); store dates as `date` columns. Per parcela: payment day + 30 × k calendar days. Lump sum and debit: payment day + X business days. The payment day is the payment's BR date (the dialog's "Data do pagamento" if given).

### Where card plans come from

Charges are created at plan approval (`lib/encounter-finalize.ts`), which can be before the procedure. The user said swipes happen about 50/50 at approval and on the procedure day. So:

- A card plan creates a charge with 1 installment, due today, and saves the planned method and planned card parcela count on the charge. The plan's installment count becomes the card parcela count; the patient installment count is 1.
- The approval step shows "Pagamento no cartão feito agora" with the maquininha select when the planned method is a card. If checked, the finalize route records the card payment right after the approval commits. If that payment fails, the approval stands, the installment stays pending and the UI says so.
- Otherwise the installment stays pending. It is a real open debt until paid, so overdue and reminders behave as today. "Registrar Pagamento" opens prefilled with the planned method, parcela count and the "Padrão" maquininha.
- "Nova cobrança" gets a "Método de Pagamento" select. When it is a card, the form also shows maquininha and parcelas, creates the charge with 1 installment and records the card payment in one step.
- Non-card plans keep their current installment behavior and also save the method.

### Fee accounting (option 2, user approved)

The fee lives on the repasse. It is not a row in Despesas. The ledger gets one net inflow per repasse. Reports show "Taxas de cartão" as their own line. Research basis: Codental posts net; accountants record gross revenue and the fee on settlement.

### Daily repasse job

New cron route under `app/api/cron/`, registered in `web/vercel.json`. Vercel crons run in UTC: schedule `0 9 * * *` is 06:00 in `America/Sao_Paulo`. It marks every repasse with status "Aguardando repasse" and expected date ≤ `brToday()` as "Recebido" and inserts one `cash_movements` inflow with the net amount, `movementDate` at that BR date, `paymentMethod` of the card, `patientId`, and a link to the repasse. It must be idempotent (safe to run twice, safe if a run was missed). Follow the auth and structure of the existing cron routes.

### "Repasses de cartão" view (Financeiro)

Lists repasses with expected date, maquininha, patient, gross, fee, net and status ("Aguardando repasse", "Recebido", "Cancelado"). Filters: period, maquininha, status. Totals at the top: amount still owed by maquininhas.

"Ajustar repasse": change net amount and/or date. On a pending repasse it edits the row. On a received repasse it reverses the old ledger line (setting `reversedByMovementId`) and inserts a new one. Fee is recalculated as gross − new net.

### Reversal

Reversing a card payment:

- Cancels all repasses still "Aguardando repasse".
- Leaves received repasses and their ledger lines in place.
- Reopens the installment as reversal does today.

The dialog states it in plain words, for example: "3 repasses futuros serão cancelados. 3 repasses já recebidos ficam no extrato. Estorne o valor ao paciente na maquininha." The clinic records the refund outflow by hand.

Known gap from #88 research: `reversePayment` does not set `reversedByMovementId` today. Card reversal and "Ajustar repasse" must set it correctly. Fixing it for non-card reversals is in scope since the same function is touched.

### Reports

- `getRevenueOverview` and dashboard: gross, "Taxas de cartão", net for the period. Gross keeps the existing `totalReceived` basis, and card fees use the same filter, so the two stay consistent.
- Ledger (Extrato): net per repasse on its date, from the job.
- "Ganhos por profissional" / practitioner P&L: unchanged ("Receita Recebida" stays gross on the payment day).

## Constraints

- Follow `AGENTS.md`: BR date helpers, no bare `new Date(ymd)`, cron timezone rule, `pnpm ci:checks` green, no `--no-verify`.
- Next.js version in this repo differs from training data: read `node_modules/next/dist/docs/` before writing routes.
- `cash_movements` is append-only. Corrections go through reversal plus a new row.
- Multi-tenant: every new table has `tenant_id` and every query filters by it.
- Payment method CHECK constraints live in migrations.
- No backward compatibility layers. Remove the old "card as cash now" path in `recordPayment` and `bulkPayInstallments`.

## Left to the builder

- Table names and exact columns (for example `card_terminals`, `card_payments` linked to `payment_records`, `card_repasses`), and whether credit rates are a JSON column or a child table.
- Where the maquininha UI lives in the settings code and the Financeiro tab layout.
- Exact copy beyond the strings above.
- Whether debit needs the parcela field hidden or fixed at 1x.

## Calls made by Claude (not explicitly confirmed by the user)

- Business days skip weekends only, no holidays.
- Rate frozen at payment time.
- Rounding: remainder on the last repasse.
- Job at 06:00 BR.
- Practitioner P&L unchanged.
- Bulk pay with card creates one card payment for the total.
- Fix `reversePayment`'s missing `reversedByMovementId` while touching it.
