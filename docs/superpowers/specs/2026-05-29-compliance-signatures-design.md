# Compliance, Legal Signatures & Remote Consent Signing

## Goal

Harden FloraClin's consent and signature system to be legally defensible under MP 2.200-2 Art. 10 §2° and Lei 13.787/2018, add remote consent signing via WhatsApp, and enforce clinical record retention.

## Architecture

Evidence-based signatures (no ICP-Brasil certificates). Every signed document produces a cryptographic evidence package with hash chain, trusted timestamp, signer metadata, and a public verification code. Patients can sign remotely via a WhatsApp link to a token-protected page. Clinical records are protected against deletion to satisfy the 20-year retention requirement across all professional councils (CRM, CRO, CREFITO, CRBM, COREN).

## Tech Stack

- SHA-256 (Web Crypto API, already in use for contentHash)
- RFC 3161 timestamp server (FreeTSA — free, no account needed)
- WhatsApp Business API (existing integration via `sendTemplateMessage`)
- Puppeteer PDF generation (existing)
- React Signature Canvas (existing)

---

## 1. Evidence-Based Signature Hardening

### Problem

Signatures today are PNG images stored as base64 with an app-set `acceptedAt` timestamp. No cryptographic proof of what was signed, by whom, or when. Weak legal standing.

### Solution

Every consent acceptance and clinical document signature produces a sealed evidence package.

### Evidence Package Structure

New `signatureEvidence` JSONB column on `consent_acceptances`:

```json
{
  "version": 1,
  "contentHash": "sha256:abc...",
  "signatureHash": "sha256:def...",
  "evidenceHash": "sha256:ghi...",
  "signerCpf": "***.***.123-45",
  "ipAddress": "189.10.xx.xx",
  "userAgent": "Mozilla/5.0...",
  "deviceFingerprint": {
    "screen": "1920x1080",
    "timezone": "America/Sao_Paulo",
    "language": "pt-BR"
  },
  "geolocation": { "lat": -23.55, "lng": -46.63 },
  "timestampToken": "base64:MIIEpg..."
}
```

**Fields:**

| Field | Source | Purpose |
|-------|--------|---------|
| `contentHash` | SHA-256 of consent text shown to signer | Proves what was signed |
| `signatureHash` | SHA-256 of PNG signature data | Proves the exact signature image |
| `evidenceHash` | SHA-256 of `contentHash + signatureHash + cpf + ip + userAgent + timestamp` | Tamper-evident seal |
| `signerCpf` | Patient record (masked for storage) | Signer identity |
| `ipAddress` | Request headers (x-forwarded-for, x-real-ip) | Already captured |
| `userAgent` | Request headers | Already captured |
| `deviceFingerprint` | Client-side: screen, timezone, language | Lightweight device identity |
| `geolocation` | Browser Geolocation API (optional, user must grant) | Location evidence |
| `timestampToken` | RFC 3161 TSR from FreeTSA | Independent proof of time |

### Hash Chain Construction

```
contentHash = SHA-256(consentText)
signatureHash = SHA-256(signatureDataPng)
evidenceHash = SHA-256(contentHash + signatureHash + cpf + ip + userAgent + isoTimestamp)
```

### RFC 3161 Trusted Timestamp

- Submit `evidenceHash` to FreeTSA (`https://freetsa.org/tsr`)
- Store the timestamp response (TSR) as base64 in `timestampToken`
- This proves the evidence hash existed at a specific moment, independently verifiable by any third party
- If FreeTSA is unreachable, proceed without it (degrade gracefully) — the rest of the evidence package still stands

### Verification Code

Every signed document gets a short verification code:

- Format: `FLC-{8 hex chars}` derived from first 8 hex chars of `evidenceHash`
- Stored in new `verificationCode` VARCHAR(16) column on `consent_acceptances`
- Also added to `clinical_documents` table for receitas/atestados
- Unique index on `verificationCode`

### Verification Footer on PDFs

All generated PDFs (consent PDFs and clinical documents) include a footer:

```
Documento assinado eletronicamente · Verifique: {APP_URL}/verify/FLC-8A3FB2D1
```

### Public Verification Endpoint

`GET /verify/[code]` — public page, no authentication required.

Displays:
- Document type (consent / receita / atestado)
- Signing date
- Signer info (masked CPF: `***.***. 123-45`)
- Verification result: re-hashes stored content + signature, compares to stored `evidenceHash`
- Status: "Documento autêntico e íntegro" or "Documento adulterado ou não encontrado"

### Implementation: `web/src/lib/signature-evidence.ts`

Functions:
- `buildEvidencePackage(contentText, signatureData, signerCpf, ip, userAgent, deviceFingerprint, geolocation)` → `{ evidence, verificationCode }`
- `verifyEvidencePackage(acceptance)` → `{ valid: boolean, details: string }`
- `fetchTimestampToken(evidenceHash)` → `base64 string | null`

---

## 2. Remote Consent Signing via WhatsApp

### Problem

Step 4 (Aprovação) requires the patient to be physically present at the clinic to sign consent terms and the service contract. Clinics want to send documents for signature before the appointment.

### Flow

1. **Clinic triggers send:** In Step 4 consent list, an "Enviar via WhatsApp" button appears next to unsigned consents. Clicking it:
   - Creates a `consent_signing_tokens` row
   - Sends a WhatsApp template message with the signing link

2. **WhatsApp template message:**
   - Template name: `consent_signing_link` (category: UTILITY)
   - Body: `Olá {{1}}, a clínica {{2}} enviou os termos do seu procedimento para assinatura. Acesse o link para revisar e assinar: {{3}}`
   - Variables: patient first name, clinic name, signing URL
   - Must be pre-approved by Meta before use

3. **Patient opens `/sign/[token]`:**
   - Token validation (not expired, not used)
   - Branded page: clinic logo (if set) + FloraClin branding
   - Displays each consent/contract text in sequence (full scrollable text)
   - Patient draws signature on SignaturePad
   - Collects device fingerprint, IP, optional geolocation
   - On submit: creates `consentAcceptances` for each template with full evidence package
   - Marks token as used
   - Shows confirmation: "Termos assinados com sucesso"

4. **Real-time update in clinic UI:**
   - Consent status list in Step 4 uses React Query polling (refetch on focus + 30s interval)
   - Once patient signs remotely, statuses flip to "Assinado" without manual refresh

5. **Token lifecycle:**
   - Expiry: 24 hours
   - Single use: `usedAt` set on completion
   - Clinic can re-send (creates new token, old one remains valid until expired)

### Schema: `consent_signing_tokens`

```sql
CREATE TABLE floraclin.consent_signing_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token VARCHAR(64) UNIQUE NOT NULL,
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  patient_id UUID NOT NULL REFERENCES floraclin.patients(id),
  procedure_record_id UUID NOT NULL REFERENCES floraclin.procedure_records(id),
  consent_template_ids UUID[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES floraclin.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_consent_signing_tokens_token ON floraclin.consent_signing_tokens(token);
CREATE INDEX idx_consent_signing_tokens_tenant ON floraclin.consent_signing_tokens(tenant_id);
```

### API Endpoints

**POST `/api/consent/send-signing-link`**
- Body: `{ patientId, procedureRecordId, consentTemplateIds }`
- Creates token (crypto.randomBytes, 32 bytes hex)
- Sends WhatsApp template message to patient phone
- Returns `{ token, expiresAt }`
- Auth: owner or practitioner

**POST `/api/consent/sign`**
- Body: `{ token, signatures: [{ consentTemplateId, signatureData, deviceFingerprint, geolocation? }] }`
- No auth required (token-based)
- Validates token, creates consent acceptances with evidence packages
- Marks token used
- Creates audit log entries
- Returns `{ success: true }`

### Pages

**`/sign/[token]/layout.tsx`**
- Branded layout matching `/a/[token]` style
- FloraClin logo, cream background, max-w-2xl

**`/sign/[token]/page.tsx`**
- Server component: validates token, fetches consent templates and patient first name
- Renders `RemoteConsentSigning` client component
- If token invalid/expired: shows "Link expirado" message

**`RemoteConsentSigning` client component:**
- Scrollable consent text display (one at a time or all)
- SignaturePad at the bottom
- "Assinar" submit button
- Loading/success/error states
- Collects device fingerprint on mount

---

## 3. Compliance Framework (Lei 13.787/2018 + LGPD)

### Clinical Record Deletion Guard

Prevent deletion of clinical records regardless of patient soft-delete status.

**Protected entities:**
- `consent_acceptances`
- `procedure_records`
- `evaluation_responses`
- `clinical_documents`
- `anamnesis_responses`
- `photos`

**Implementation:**
- Add a `protectClinicalRecord(tableName)` helper that throws if any code attempts DELETE on these tables
- Apply at the query layer: ensure no `delete()` calls exist for protected tables (only soft-delete via `deletedAt` for patient-facing hiding)
- The existing `deletePatient` flow sets `deletedAt` on the patient row — clinical records under that patient remain untouched in the DB
- This satisfies Lei 13.787/2018 and the 20-year minimum retention requirement across all professional councils

### Audit Log Immutability

- Add a PostgreSQL trigger on `audit_logs` that prevents UPDATE and DELETE:
  ```sql
  CREATE FUNCTION floraclin.prevent_audit_modification() RETURNS TRIGGER AS $$
  BEGIN
    RAISE EXCEPTION 'audit_logs table is append-only';
  END;
  $$ LANGUAGE plpgsql;

  CREATE TRIGGER audit_logs_immutable
    BEFORE UPDATE OR DELETE ON floraclin.audit_logs
    FOR EACH ROW EXECUTE FUNCTION floraclin.prevent_audit_modification();
  ```
- Satisfies Lei 13.787 Art. 6° (integrity and authenticity)

### Professional Registry Enforcement

- Before generating a clinical document (receita, atestado), check that the practitioner has `registryType`, `registryNumber`, and `registryState` filled
- If missing, show an error: "Preencha seu registro profissional em Meu Perfil antes de emitir documentos"
- Display registry on all PDF footers: e.g., "Dra. Maria Silva — CRO-SP 12345"
- No external validation against council APIs (unreliable)

### Consent Version Tracking

- When displaying a signed consent in the patient timeline, compare stored `contentHash` against the hash of the current active template version
- If they differ, show a badge: "Assinado na versão X" (where X is the template version at signing time)
- Already stored: `consentTemplateId` references the exact versioned template, and `contentSnapshot` preserves the full text

### LGPD Data Subject Rights

- Patient data export ("Exportar dados do paciente") — **deferred to separate spec**
- Soft-delete already covers "right to deletion" with the clinical record retention exception (LGPD Art. 16, II)
- Consent templates already include LGPD clauses — no changes needed

---

## 4. File Inventory

### New Files

| File | Purpose |
|------|---------|
| `web/src/app/sign/[token]/layout.tsx` | Branded layout for remote signing |
| `web/src/app/sign/[token]/page.tsx` | Token validation + signing page |
| `web/src/app/api/consent/sign/route.ts` | Remote signing endpoint |
| `web/src/app/api/consent/send-signing-link/route.ts` | Generate token + send WhatsApp |
| `web/src/app/api/consent/verify/[id]/route.ts` | Evidence chain verification API |
| `web/src/app/verify/[code]/page.tsx` | Public verification page |
| `web/src/app/verify/[code]/layout.tsx` | Minimal public layout |
| `web/src/db/queries/consent-signing-tokens.ts` | Token CRUD |
| `web/src/lib/signature-evidence.ts` | Evidence hash chain + RFC 3161 |
| `web/src/components/consent/remote-consent-signing.tsx` | Client component for /sign/[token] |
| `web/src/db/migrations/XXXX_consent_evidence.sql` | Schema migration |

### Modified Files

| File | Changes |
|------|---------|
| `web/src/db/schema.ts` | Add `consent_signing_tokens` table, `signatureEvidence` + `verificationCode` columns on `consent_acceptances`, `verificationCode` on `clinical_documents` |
| `web/src/db/queries/consent.ts` | Integrate evidence package into `acceptConsent()`, add delete guard |
| `web/src/components/procedures/approval/consent-status-list.tsx` | Add "Enviar via WhatsApp" button, show remote signing status, polling |
| `web/src/components/consent/consent-viewer.tsx` | Collect device fingerprint + optional geolocation before signing |
| `web/src/validations/consent.ts` | Add WhatsApp template name constant |
| `web/src/lib/pdf.ts` | Add verification code footer to all generated PDFs |
| `web/src/app/api/clinical-documents/` | Add registry enforcement check, store verificationCode |

### Migration

```sql
-- Add evidence columns to consent_acceptances
ALTER TABLE floraclin.consent_acceptances
  ADD COLUMN signature_evidence JSONB,
  ADD COLUMN verification_code VARCHAR(16) UNIQUE;

-- Add verification code to clinical_documents
ALTER TABLE floraclin.clinical_documents
  ADD COLUMN verification_code VARCHAR(16) UNIQUE;

-- Create consent_signing_tokens table
CREATE TABLE floraclin.consent_signing_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token VARCHAR(64) UNIQUE NOT NULL,
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  patient_id UUID NOT NULL REFERENCES floraclin.patients(id),
  procedure_record_id UUID NOT NULL REFERENCES floraclin.procedure_records(id),
  consent_template_ids UUID[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES floraclin.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_consent_signing_tokens_token ON floraclin.consent_signing_tokens(token);
CREATE INDEX idx_consent_signing_tokens_tenant ON floraclin.consent_signing_tokens(tenant_id);

-- Audit log immutability trigger
CREATE FUNCTION floraclin.prevent_audit_modification() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs table is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON floraclin.audit_logs
  FOR EACH ROW EXECUTE FUNCTION floraclin.prevent_audit_modification();
```

---

## Not In Scope

- ICP-Brasil A1 certificate integration
- Row-Level Security (remains deferred)
- External council registry validation (CRM, CRO, etc. APIs)
- Patient data export (LGPD portability — separate spec)
- Signature manifest page appended to PDFs
- Council-specific compliance rules (using Lei 13.787 umbrella)
