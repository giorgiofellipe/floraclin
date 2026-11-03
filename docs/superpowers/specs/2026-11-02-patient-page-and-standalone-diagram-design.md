# Patient page redesign and standalone face diagram

Date: 2026-11-02
Status: draft for approval

## Why

The face diagram is the center of FloraClin's marketing, but users do not find it in the app. Today the only way to reach it is: patient page, "Iniciar atendimento", then step 3 (Planejamento) of a 5-step wizard. The patient page itself does not mention it.

The patient page is also hard to use. It has 10 tabs in one row (Dados, Anamnese, Evoluções, Atendimentos, Pacotes, Termos, Documentos, Fotos, Financeiro, Timeline). On phones most of them are off screen. Some users do not understand the tabs at all. Labels overlap ("Evoluções" vs "Timeline", the "Atendimentos" tab vs the "Iniciar atendimento" button).

Clinics also work in different ways, and the wizard forces one process on all of them:

- Some clinics draw the diagram only to give the patient a quotation. Nothing is applied that day.
- Some clinics draw the diagram and apply right away, without an approval step.
- Some use the full process as it exists today.

## Goals

1. A clinic can create a face diagram for a patient without an atendimento, and generate a quotation from it.
2. A quotation patient who comes back continues from the same diagram inside an atendimento.
3. The Aprovação step (consent terms and contract signatures) can be skipped in any visit, with a clear and pleasant UI. Whether to sign is 100% the clinic's choice.
4. The patient page shows the face diagram and the main actions up front, and replaces the 10-tab row with a grouped side menu.
5. The patient page works well on phones.

## Non-goals

- No change to the content of any existing section (Anamnese, Pacotes, Termos, Documentos, Fotos, Financeiro, Evoluções, Atendimentos, Dados, Timeline). They move into the new layout as they are.
- No change to the Atendimento wizard order or steps, other than the two additions below (start from a saved quotation at Procedimentos, skip signatures at Aprovação).
- No clinic-level setting for the process or for signatures.
- No change to the face diagram editor itself.

## Anti-goals

- Losing any feature the patient page has today. Every header action and every bit of patient info stays (full list below).
- Two separate diagram systems that confuse users. There is one face diagram record, used from the patient page and from the wizard.
- A skip-signatures control that looks like an error path or a warning trap. It must feel like a normal, valid choice.

## Part 1: Standalone face diagram

### Data model

- `face_diagrams.procedure_record_id` becomes nullable.
- `face_diagrams` gets its own `patient_id` (NOT NULL, FK to `patients`). Backfill it from the procedure record for existing rows.
- A "diagram" as the user sees it is a group of `face_diagrams` rows (one per view: `front`, `left_profile`, `right_profile`). Add a parent record for this group (builder names it). It holds `patient_id`, the author practitioner, the quotation lines, and the link to a procedure record when there is one.
- **Every diagram is a group, old and new (user's decision).** "Diagramas faciais" and the Resumo card list all diagrams of the patient, including the ones drawn inside past atendimentos. A data migration creates groups for all existing rows. For an existing procedure, the planning rows (no session) form one group. Each executed session's rows (`saveFaceDiagramForSession`) form one more group, linked to the same procedure and shown under it, not as a separate quotation.
- Status, derived from the linked procedure (no stored status): Orçamento (no procedure, or the linked procedure was cancelled or its draft discarded), Em atendimento (procedure in draft, planned, approved or in progress), Aplicado (procedure completed).
- A diagram links to the procedure record when the user picks it in the wizard. If that atendimento is cancelled or abandoned, the link is removed and the diagram goes back to Orçamento. (My call.)
- The diagram is never copied. Do not keep a compatibility path for the old "diagram always has a procedure" assumption; update the queries that rely on it (`getFaceDiagram`, `getPreviousDiagramPoints`, prontuário report, evolutions print, timeline).

### Quotation

- From a standalone diagram the user builds a quotation the same way Planejamento's "Orçamento" section works today: pick procedure types (the cart), and the user can change the value of each line (custom price).
- Output: a PDF the clinic can print, and the same PDF sent by WhatsApp to the patient.
- Reuse what exists: `lib/pdf.ts` (puppeteer) with `lib/pdf-branding.tsx` for the PDF, and `sendOrEnqueueDocument` in `lib/whatsapp.ts` for the WhatsApp send (same credit rules as clinical documents).
- The PDF shows the clinic branding, the patient name, the diagram image (the views that have points), the lines with values, and the total. Builder's call on layout.
- The quotation is not a financial entry. No charge or installment is created until the atendimento, as today.
- Each generated PDF is stored (file in storage plus a row) and listed on the diagram page and in Histórico. It is a snapshot: later edits to the diagram do not change a PDF the patient already received. It is not a `clinical_documents` row, because those require a professional signature. (My call.)

### Follow-up of waiting quotations (user's decision)

- Diagrams in status Orçamento appear in the CRM "Planejamentos" follow-up list (`crm/planejamentos`, `listOpenPlanejamentos`) and in its dashboard card (`open-planejamentos-card`), next to the open plans that are there today.
- They get the same follow-up actions as today: snooze and "last contacted". The builder moves or copies these fields so they work for a diagram group without a procedure.
- Visibility follows the current rule of that list: practitioners see their own, owners see all.

### Where the user creates it

- "Novo diagrama" button in the patient page header (desktop). On phones it sits inside the "Mais" menu.
- "Diagramas faciais" section in the patient page lists all diagrams of the patient with date, status, and quotation total. Opening one shows the editor, the quotation, and the actions: Gerar PDF, Enviar por WhatsApp, Iniciar atendimento com este diagrama.
- Permissions: same as saving diagrams today (`owner`, `practitioner`). Read-only subscription lock applies as on other write actions.

### Using a saved diagram in an atendimento

- The offer happens at step 2 (Procedimentos), because step 2 builds the cart that the later steps depend on. If the patient has diagrams in status Orçamento, step 2 shows: "Usar orçamento de 12/10" or "Começar do zero". The most recent one is suggested. (My call.)
- Picking it fills the step 2 cart from the quotation lines, including custom values, and selects that diagram in step 3. The user can still change both.
- "Iniciar atendimento com este diagrama" from the diagram page starts the wizard with that choice already made.
- If the patient already has an open atendimento, the button changes to "Continuar atendimento" and does not attach the diagram. The user can cancel the open one first. (My call.)
- After a diagram is linked to an atendimento, it is read-only in the "Diagramas faciais" section. Edits happen inside the atendimento.
- In "Diagramas faciais", practitioners see all diagrams of the patient, the same as the Atendimentos section shows all atendimentos today. Only the CRM list filters by practitioner.

### Skipping signatures at Aprovação

- The Aprovação step keeps everything it has today (consent terms, contract, signing link).
- Add one clear action to continue without signatures, for this visit only. No clinic setting.
- The UX must make both paths feel normal. Builder's call on exact design; the goal is one obvious primary action and one equally clear secondary action, no scary warning modal. A short neutral confirmation is fine.
- Record in the audit log that the visit continued without signatures.
- The procedure moves to `approved` as it does after signing, so Execução works unchanged.
- **Signatures can be collected later (user's decision).** Skipped terms and contract stay "pendente" for that atendimento. The Termos section and the atendimento show them as pending, and the clinic can sign in person or send the signing link at any time, also after Execução.

## Part 2: Patient page redesign

### Desktop and tablet layout

- Header card (always visible above the content):
  - Name, gender, age and birth date, phone (with its current menu), email, CPF.
  - Actions: WhatsApp (new visible button, opens the in-app conversation), Novo agendamento, Nova cobrança, Novo documento, Novo diagrama (new), Iniciar / Continuar atendimento (primary).
- Left side menu replaces the tab row. One item per row, in labeled groups:
  - Resumo (default)
  - Clínico: Atendimentos, Diagramas faciais (new), Evoluções, Fotos, Anamnese
  - Administrativo: Agenda (new), Financeiro, Pacotes
  - Documentos: Termos, Documentos
  - Paciente: Dados, Histórico (renamed from "Timeline")
- Evoluções stays hidden for roles that cannot see it today.
- Resumo shows 4 cards, same for every role:
  - Diagramas faciais: last diagram thumbnail, status, quotation total, link "Ver todos".
  - Próximos agendamentos: next appointments with status, link to Agenda.
  - Últimos atendimentos: last 3 with status, link to Atendimentos.
  - Financeiro: open amount and next due date, package progress, link to Financeiro.
- Agenda section (new): the patient's future and past appointments, read from the existing appointments data. Builder's call on the list design.
- The selected section stays in the URL (`?tab=` today; keep the same parameter or rename it, builder's call, no compatibility redirect needed). Existing deep links into tabs from other parts of the app must point to the new section keys.

### Phone layout

- Header: name, age, phone. Then 4 icon buttons in one row: WhatsApp, Agendar, Cobrar, Mais. Then a full-width "Iniciar atendimento" button.
- "Mais" holds: Novo diagrama, Novo documento, Ligar, Solicitar documentos, Abrir no WhatsApp Web, Email.
- A fixed bottom bar with 4 entries: Resumo, Clínico, Administrativo, Outros (Outros holds the Documentos and Paciente groups). The active entry is highlighted.
- Tapping a group opens its sections, one per row (for example a bottom sheet). Tapping a section shows it in the main area. Builder's call on the exact pattern.
- A "section picker" dropdown near the header was rejected: users confused it with the "Mais" actions menu. Section navigation must look clearly different from actions.
- Resumo cards stack in one column. Page content needs bottom padding so the fixed bar does not cover it.

### Features that must not be lost (current header inventory)

- Age with birth date
- Phone menu: Ligar, Iniciar conversa (in-app WhatsApp, only when the WhatsApp API is enabled and the phone is valid), Solicitar documentos (same condition), Abrir no WhatsApp Web
- Email as a mailto link
- CPF (masked)
- Novo agendamento (opens `AppointmentForm` with the patient)
- Nova cobrança (opens `PaymentForm`, then goes to Financeiro on save)
- Novo documento (opens `IssueDocumentDialog`)
- Iniciar / Continuar atendimento, depending on an active service
- Read-only guards when the subscription is inactive
- Back link to the patient list

The visible WhatsApp button follows the same rule as "Iniciar conversa" today. When the in-app WhatsApp is not available, it opens WhatsApp Web instead. (My call.)

## Constraints

- Follow `AGENTS.md` date rules (appointment dates are BR calendar days; use `@/lib/dates`).
- This Next.js version differs from common knowledge; read `node_modules/next/dist/docs/` before writing routes.
- Multi-tenant: every new query filters by `tenant_id`.
- WhatsApp sends cost credits; the quotation send uses the same credit flow as clinical documents.

## Left to the builder

- Storage shape for a standalone diagram group, its status, and its quotation lines.
- PDF layout of the quotation.
- Exact UI of the skip-signatures action, inside the goals above.
- Agenda section list design.
- Whether parts 1 and 2 ship in one PR or several. Both are in scope now.

## Calls I made (not discussed in detail)

- The visible WhatsApp button falls back to WhatsApp Web when the in-app channel is not available.
- On phones, "Novo diagrama" is inside "Mais", because drawing on a small screen is hard. Tablets get the desktop layout.
- "Timeline" is renamed "Histórico".
- Resumo is the same for every role.
- A diagram linked to an atendimento is read-only on the patient page.
- The saved diagram is offered at step 2 (Procedimentos), not step 3, and fills the cart. The most recent one is suggested.
- Cancelling or abandoning an atendimento sends its diagram back to Orçamento.
- Status is derived from the linked procedure, not stored.
- Quotation PDFs are stored as snapshots, outside `clinical_documents`.
- With an open atendimento, "Iniciar atendimento com este diagrama" becomes "Continuar atendimento" and does not attach the diagram.
- Practitioners see all diagrams on the patient page; only the CRM list filters by practitioner.
