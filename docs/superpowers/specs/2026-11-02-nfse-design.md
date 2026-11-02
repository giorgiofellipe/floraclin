# NFS-e emission after a patient payment

Date: 2026-11-02. Status: draft for approval.

## Intent

A clinic that receives a payment from a patient must issue an NFS-e (nota fiscal de serviço). Today FloraClin records the payment, and the clinic issues the note somewhere else (city portal, Emissor Nacional, accountant). The goal is that the note comes out of FloraClin at the moment the payment is marked as paid, with no retyping.

## Decided by Giorgio

1. The trigger is "payment marked as paid".
2. Default behavior: FloraClin asks whether to issue the NFS-e for that payment. The clinic can set "always emit" so FloraClin issues it automatically, with no prompt.
3. The note value is the paid amount of that payment (not the procedure total, not the installment value).
4. The clinic chooses whether FloraClin emails the NFS-e to the patient.
5. Library: `@bullcode/fiscal` (`git+https://github.com/bullcodeapps/fiscal.git#v0.1.1`), NFS-e Nacional only. Revezza `staging` already issues NFS-e with it; reuse its design where it fits (summary in "Prior art").

## Goals

- A clinic with an A1 e-CNPJ certificate and a city that is on the Emissor Nacional can issue NFS-e for patient payments from FloraClin.
- "Ask" mode: one short prompt after the payment succeeds. "Always" mode: zero clicks.
- Download PDF (DANFSe) and XML of every issued note. Cancel a note.
- Optional email of the PDF and XML to the patient.

## Non-goals

- Professionals who invoice with a CPF (autônomo). The library builds the DPS id with CNPJ only.
- City-specific NFS-e systems (ABRASF, GINFES, ISS.net, etc.). NFS-e Nacional only.
- Product invoices (NF-e / NFC-e), substitute notes (substituição), ISS reports, accountant exports.
- Sending the NFS-e over WhatsApp (possible later, the queue already supports documents).

## Anti-goals (failure even if it "works")

- A payment fails, slows down or rolls back because of NFS-e. Payment recording must never depend on Sefin.
- Two notes for the same payment (retry after timeout, double click, cron plus manual).
- A note issued for a reversed payment, or a reversed payment whose note silently stays active.
- The certificate or its password leaks: logs, Sentry, API responses, client bundle.

## Constraints

- Brazil dates: `dCompet` is a BR calendar day (see "Old payments" for how it is chosen). Use `toBrYmd` / `brToday`. Follow AGENTS.md date rules.
- Production runs on Vercel. The private git dependency needs a token at install time (`FISCAL_REPO_TOKEN`, `insteadOf` rewrite in a custom install command). CI needs the same.
- `NFSE_NACIONAL_ENVIRONMENT` = `production` | `restricted`. In production, unset means emission fails closed. Elsewhere it defaults to `restricted`.
- Migrations are hand-written SQL (`web/src/db/migrations/NNNN_name.sql`, next free number after 0046), additive, RLS enabled with no policies like recent tables.
- Secrets at rest use the existing `web/src/lib/crypto.ts` (`encryptSecret` / `decryptSecret`, `TOKEN_ENCRYPTION_KEY`).
- No HTTP call while the payment transaction holds row locks. Copy the Meta purchase-event pattern: write the outbox row in the transaction, send after commit (`web/src/db/queries/financial.ts` `emitPurchaseEventForEntry` / `deliverPurchaseEvents`).

## Design

### Clinic setup (Configurações, new tab "Nota fiscal", group Operações, owner only)

1. Upload the A1 certificate (.pfx/.p12) and password. Server loads it with `loadCertificate`, rejects expired or not-yet-valid certificates, reads CNPJ, holder, issuer and validity. Store pfx and password encrypted; never return them. Show holder, CNPJ, "válido até", and a warning at 30 days or fewer before expiry.
2. Fiscal settings: inscrição municipal (optional), municipality IBGE code (prefilled from `tenants.address` city/state with `findMunicipality`/`findMunicipalityCode`, editable), Simples Nacional option (não optante, MEI, ME/EPP) with regime and approximate tax rate for ME/EPP, ISS rate, ISS withheld switch.
3. Service: a preset select plus "Avançado" with raw codes (cTribNac, cNBS, tribISSQN, cIndOp, CST, cClassTrib), same as Revezza. Store the preset id and resolve codes at emission time.
4. Behavior: emission mode `ask` (default) or `always`; "Enviar a NFS-e por email ao paciente" switch (default off).

The settings form appears only after a valid certificate is stored.

### Data model

- `nfse_settings` (one row per tenant, PK `tenant_id`): encrypted `certificate_pfx`, encrypted `certificate_password`, `cnpj`, `certificate_subject`, `certificate_issuer`, `certificate_valid_from`, `certificate_valid_to`, `municipal_registration`, `municipality_code`, `simples_nacional_option`, `simples_nacional_regime`, `simples_nacional_tax_rate`, `service_preset`, raw code columns (nullable when a preset is used), `iss_rate`, `iss_withheld`, `emission_mode` ('ask' | 'always'), `email_patient` boolean, timestamps.
- `nfse_dps_sequences`: PK `(cnpj, municipality_code, series)`, `last_number bigint`. Atomic upsert `ON CONFLICT DO UPDATE SET last_number = last_number + 1 RETURNING`. Series fixed at a FloraClin value in 00001-49999 (Revezza uses 00700; FloraClin picks its own, e.g. 00800, so a clinic that also used Revezza never collides).
- `nfse_documents`: `id`, `tenant_id`, `payment_record_id` UNIQUE, `status` (`pending` | `processing` | `issued` | `failed` | `cancelled`), `value` (fixed at row creation from the payment amount), `payload_snapshot jsonb` (built DPS input), `dps_number`, `dps_id`, `access_key`, `nfse_number`, `nfse_xml text`, `error_code`, `error_message`, `attempt_count`, `claimed_at`, `issued_at`, `email_sent_at`, `email_requested boolean`, `cancelled_at`, `cancel_reason`, `cancel_justification`, `created_by`, timestamps.

One active note per `payment_records` row: a partial unique index on `payment_record_id` where `status <> 'cancelled'`. A partial payment of R$ 500 gives a R$ 500 note. After a cancellation the clinic can issue a new note for the same payment (Claude's call: cancel reason "Erro na emissão" exists to fix a wrong note), and the table keeps the cancelled ones as history.

### Emission flow

1. `always` mode: inside `recordPayment` / `bulkPayInstallments`, insert a `pending` `nfse_documents` row per new payment record (`ON CONFLICT DO NOTHING`, inside a savepoint so a failure cannot abort the payment). After commit, process it with `after()`.
2. `ask` mode: the payment API response includes `nfse: { prompt: true, paymentRecordIds }` when the clinic has a valid setup. The UI shows a dialog: "Emitir NFS-e de R$ 500,00 para Maria Silva?" with "Enviar por email" (default from settings, only when the patient has an email) and buttons "Emitir" / "Agora não". "Emitir" calls `POST /api/nfse` with the payment record ids. That creates the rows and processes them, and the dialog shows the result.
3. Manual: every paid, non-reversed payment without an active note shows "Emitir NFS-e" in the installment table. This covers "Agora não", the card payment paths (charge creation and encounter finalize), and setup done after the payment.
4. Processing (shared by all paths): claim the row (conditional update to `processing`, stale after 15 min), recheck that the payment is not reversed, validate taker data locally, allocate the DPS number (reuse it when rebuilding after a rejection with the same CNPJ/city/series), build, sign, `SefinClient.emit`. On success store access key, number and XML, set `issued`, then send the email if requested.
5. Failure handling, as in Revezza: Sefin rejection is terminal (`invalid_request`, message shown to the user, rebuild allowed after the data is fixed); unavailable/network is transient. Before any resend of a row that may have reached Sefin, reconcile with `findAccessKeyByDpsId` and adopt the note only if taker document, value, competence date and description match; otherwise mark `reconcile_ambiguous` (terminal, needs a human). E0014 reconciles inline. E0008: backdate `dhEmi` 60 s.
6. Cron `api/cron/nfse-retry` (hourly, `CRON_SECRET`, `withCronMonitor`): retries transient rows, max 5 attempts, sequential.

Payment flow is unchanged when NFS-e is not configured. NFS-e errors never change the payment API status.

### Old payments (decided with Giorgio, 2026-11-02)

Any paid, non-reversed payment can get a note, also payments from before the NFS-e setup.

Checked in the official Anexo I (v1.01, 2026-02-09), 2026-11-02:
- `dCompet` must be on or before `dhEmi`. There is no maximum age. Lower bounds: the city's convênio activation date, the CNPJ registration date, and the clinic's municipal registration/authorization date (Sefin rejects with a message; show it).
- "A data de competência deve ser única e ser a mesma que a data do fato gerador do tributo, ou seja, a data da prestação do serviço."
- Emissor Nacional (web, app and API) is free for the taxpayer.

Default competence (decided with Giorgio): the service date, as BR calendar day:
1. `procedure_records.performed_at` of the entry's procedure, when set.
2. Else `appointments.date` of the entry's appointment.
3. Else the payment day.
If the result is after today (prepaid service), use today, because Sefin rejects a competence after `dhEmi`.

When the default competence is in a month before the current one, the emission dialog shows a choice:
- "Data do serviço (DD/MM/AAAA)" (default), with the warning: "O ISS dessa competência pode ter juros e multa."
- "Mês atual (DD/MM/AAAA, hoje)": kept on purpose by Giorgio. Sefin accepts it. The warning says this competence does not match the date the service was provided, which the national rules require, and can lead to a fine from the city.

The chosen competence is stored on the `nfse_documents` row (`competence_date`) and in the snapshot, so retries and reconciliation use the same value. `always` mode uses the default competence with no prompt.

### Taker (patient) data

The patient is the taker (`toma`): CPF, name, full address (CEP, street, number, neighborhood, city/state resolved to IBGE code), email optional. Patient CPF and address are optional in FloraClin today, so the emission dialog (ask and manual) shows the missing fields inline, validates CPF checksum and CEP, saves them to the patient, then emits. In `always` mode a patient with missing data gives a `failed` row with code `missing_taker_data`, visible in the table with a "Completar dados e emitir" action.

### Description and values

- `xDescServ`: the financial entry description, plus "Parcela N/M" when the entry has more than one installment.
- `vServ` = paid amount. `tribISSQN`, `tpRetISSQN`, `pAliq` (non-optants only), `totTrib` as in Revezza. IBSCBS block always sent with `indFinal = 1` for CPF takers.

### Reversal and cancellation

- Cancel: dialog with reasons (1 Erro na emissão, 2 Serviço não prestado, 9 Outros) and a 15-255 character justification. Signed cancellation event via `buildCancellation` + `registerEvent`; E0840 counts as success. Roles: owner, financial.
- Reversal of a payment that has an issued note: the "Estornar Pagamento" dialog shows that the payment has an NFS-e and a checkbox "Cancelar a NFS-e também", checked by default. The reversal commits first; the cancellation runs after commit and its failure is shown, not rolled into the reversal. A reversed payment with a `pending`/`failed` note marks that note so it is never sent.

### Email to the patient

Sent from `EMAIL_FROM` with the clinic name in the subject and display text, `reply-to` the clinic email. Attach the DANFSe PDF (`renderDanfse(xml)`) and the XML through Resend attachments. Skip when the patient has no email. Record `email_sent_at`; a resend action exists on issued notes.

### Where notes show up

- Installment table, per payment: a status chip (Emitida, Processando, Falhou, Cancelada) and a menu: Ver PDF, Baixar XML, Reenviar email, Cancelar, or Emitir / Tentar de novo.
- PDF is rendered on demand from the stored XML; XML downloads from the stored column.

### Roles

| Action | Roles |
|---|---|
| Setup tab | owner |
| Emit (prompt, manual, retry), download, resend email | owner, receptionist, financial (same as recording a payment) |
| Cancel | owner, financial (same as reversal) |

### Security

- Certificate and password encrypted with `crypto.ts`, loaded only in the emission/cancel path, never selected by list queries or returned by any API.
- Upload limits: 64 KB pfx, 200-char password. Add `password`, `pfx` keys and the certificate upload route to Sentry scrubbing.
- Audit log entries for setup changes (without secrets), emission, cancellation.

### Testing

- Integration tests against local Docker Postgres with a mocked Sefin client: outbox row in the payment transaction, no duplicate notes on double submit and cron plus manual, reconcile adopts only on match, reversal blocks a pending note, DPS numbering is atomic.
- Test certificate built with node-forge carrying the ICP-Brasil e-CNPJ OID (copy Revezza's factory).
- One manual smoke emission in produção restrita with a real certificate before production. During development use Revezza's certificate (flow only; its CNPJ activity does not match health codes). Dra. Micaela Floriani will provide her certificate to verify the health/aesthetic presets in produção restrita before release.

### Plan access

All plans. No `checkPlanFeature` gate (decided with Giorgio).

## Prior art: Revezza

Revezza staging (commit e8e96e30, #139): certificate table with AES-GCM, `nfse_dps_sequences`, `nfs_documents` outbox with claim/terminal codes, gateway adapter, presets file, connect modal, certificate card, cancel dialog, PDF/XML endpoints. Files under `api/src/lib/accountant/adapters/nfse-nacional/`, `api/src/services/nfs/`, `web/src/components/accountant/`.

## Left to the builder

- Exact service presets for FloraClin clinics, derived from Anexo VIII (cTribNac, cNBS, cClassTrib) and each one verified with a real emission in produção restrita. Expected families: odontologia (HOF by dentists), medicina, biomedicina/enfermagem estética, estética (esteticista).
- Component structure, query/route names, the exact prompt copy.
- Whether to add AAD (row binding) to `crypto.ts` or keep it as is.
