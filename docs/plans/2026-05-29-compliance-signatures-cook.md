# Compliance, Legal Signatures & Remote Consent Signing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden signatures with cryptographic evidence packages, add remote consent signing via WhatsApp, and enforce clinical record retention (Lei 13.787/2018).

**Architecture:** Evidence-based signatures produce a SHA-256 hash chain (contentHash + signatureHash → evidenceHash) with RFC 3161 timestamp, device fingerprint, and optional geolocation. Remote signing uses a token-based WhatsApp link to `/sign/[token]`. Every signed document gets a `FLC-XXXXXXXX` verification code linkable at `/verify/[code]`. Audit logs become append-only via a PostgreSQL trigger.

**Tech Stack:** SHA-256 (Web Crypto API), RFC 3161 (FreeTSA), WhatsApp Business API (existing `sendTemplateMessage`), Puppeteer PDF (existing), React Signature Canvas (existing), Drizzle ORM, Next.js 16, React Query.

---

## File Inventory

### New Files

| File | Purpose |
|------|---------|
| `web/src/lib/signature-evidence.ts` | Evidence hash chain, RFC 3161 timestamp, device fingerprint |
| `web/src/lib/__tests__/signature-evidence.test.ts` | Unit tests for evidence utilities |
| `web/src/db/migrations/0016_consent_evidence.sql` | Schema migration |
| `web/src/db/queries/consent-signing-tokens.ts` | Token CRUD for remote signing |
| `web/src/app/api/consent/send-signing-link/route.ts` | Generate token + send WhatsApp |
| `web/src/app/api/consent/sign/route.ts` | Remote signing endpoint (no auth, token-based) |
| `web/src/app/verify/[code]/layout.tsx` | Minimal public layout for verification |
| `web/src/app/verify/[code]/page.tsx` | Public verification page |
| `web/src/app/sign/[token]/layout.tsx` | Branded layout for remote signing |
| `web/src/app/sign/[token]/page.tsx` | Token validation + signing page |
| `web/src/components/consent/remote-consent-signing.tsx` | Client component for `/sign/[token]` |
| `web/src/hooks/mutations/use-consent-signing-mutations.ts` | Mutation hooks for signing link |

### Modified Files

| File | Changes |
|------|---------|
| `web/src/db/schema.ts` | Add `consentSigningTokens` table, `signatureEvidence` + `verificationCode` on `consentAcceptances`, `verificationCode` on `clinicalDocuments` |
| `web/src/db/queries/consent.ts` | Integrate evidence package into `acceptConsent()`, add `findByVerificationCode()` |
| `web/src/validations/consent.ts` | Add `remoteSigningSchema`, `deviceFingerprintSchema`, `CONSENT_SIGNING_TEMPLATE_PURPOSE` |
| `web/src/validations/__tests__/consent.test.ts` | Tests for new schemas |
| `web/src/lib/pdf.ts` | Add verification code footer to `PRINT_BASE_CSS` |
| `web/src/app/api/consent/accept/route.ts` | Forward `deviceFingerprint` + `geolocation` to `acceptConsent()` |
| `web/src/components/consent/consent-viewer.tsx` | Collect device fingerprint + optional geolocation |
| `web/src/components/procedures/approval/consent-status-list.tsx` | Add "Enviar via WhatsApp" button, show remote signing status |

---

## Parallelization Groups

```
Group A (parallel — foundation):
  Task 1: signature-evidence utility       (files: lib/signature-evidence.ts, lib/__tests__/signature-evidence.test.ts)
  Task 2: migration SQL                    (files: db/migrations/0016_consent_evidence.sql)
  Task 3: Drizzle schema                   (files: db/schema.ts)
  Task 4: validation schemas               (files: validations/consent.ts, validations/__tests__/consent.test.ts)

Group B (depends on A — data layer):
  Task 5: consent-signing-tokens queries   (files: db/queries/consent-signing-tokens.ts)
  Task 6: consent query evidence           (files: db/queries/consent.ts)
  Task 7: PDF verification footer          (files: lib/pdf.ts)

Group C (depends on B — API routes + pages):
  Task 8:  send-signing-link API           (files: app/api/consent/send-signing-link/route.ts)
  Task 9:  remote sign API                 (files: app/api/consent/sign/route.ts)
  Task 10: accept route evidence           (files: app/api/consent/accept/route.ts)
  Task 11: public verification page        (files: app/verify/[code]/layout.tsx, app/verify/[code]/page.tsx)
  Task 12: remote signing page             (files: app/sign/[token]/layout.tsx, app/sign/[token]/page.tsx,
                                                   components/consent/remote-consent-signing.tsx)

Group D (depends on C — UI integration):
  Task 13: consent-viewer evidence         (files: components/consent/consent-viewer.tsx)
  Task 14: consent-status-list WhatsApp    (files: components/procedures/approval/consent-status-list.tsx,
                                                   hooks/mutations/use-consent-signing-mutations.ts)

Group E (parallel with D — compliance guardrails):
  Task 15: deletion guard + registry       (files: lib/compliance.ts, lib/clinical-documents.ts)
```

---

## Group A — Foundation

### Task 1: Signature Evidence Utility

Pure crypto utility — no DB, no framework deps. Provides hash chain construction, RFC 3161 timestamps, device fingerprint collection, and evidence verification.

**Files:**
- Create: `web/src/lib/signature-evidence.ts`
- Create: `web/src/lib/__tests__/signature-evidence.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/lib/__tests__/signature-evidence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock crypto.subtle for Node test env
const mockDigest = vi.fn()
beforeEach(() => {
  vi.stubGlobal('crypto', {
    subtle: { digest: mockDigest },
  })
  mockDigest.mockImplementation(async (_algo: string, data: ArrayBuffer) => {
    // Deterministic fake hash: just return first 32 bytes padded
    const view = new Uint8Array(data)
    const hash = new Uint8Array(32)
    for (let i = 0; i < Math.min(view.length, 32); i++) hash[i] = view[i]
    return hash.buffer
  })
})

describe('sha256', () => {
  it('hashes a string to a 64-char hex string', async () => {
    const { sha256 } = await import('../signature-evidence')
    const result = await sha256('hello')
    expect(result).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('buildEvidencePackage', () => {
  it('returns evidence object with all required fields', async () => {
    const { buildEvidencePackage } = await import('../signature-evidence')
    const result = await buildEvidencePackage({
      contentText: 'Consent text',
      signatureData: 'data:image/png;base64,abc',
      signerCpf: '123.456.789-00',
      ipAddress: '189.10.1.1',
      userAgent: 'Mozilla/5.0',
      deviceFingerprint: { screen: '1920x1080', timezone: 'America/Sao_Paulo', language: 'pt-BR' },
    })

    expect(result.evidence.version).toBe(1)
    expect(result.evidence.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.evidence.signatureHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.evidence.evidenceHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.evidence.signerCpf).toBe('***.***.*89-00')
    expect(result.evidence.ipAddress).toBe('189.10.1.1')
    expect(result.evidence.signedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(result.evidence.deviceFingerprint.screen).toBe('1920x1080')
    expect(result.verificationCode).toMatch(/^FLC-[0-9A-F]{8}$/)
  })

  it('masks CPF keeping only last 6 chars visible', async () => {
    const { buildEvidencePackage } = await import('../signature-evidence')
    const result = await buildEvidencePackage({
      contentText: 'text',
      signatureData: 'data:image/png;base64,x',
      signerCpf: '987.654.321-00',
      ipAddress: '1.2.3.4',
      userAgent: 'test',
      deviceFingerprint: { screen: '1920x1080', timezone: 'America/Sao_Paulo', language: 'pt-BR' },
    })
    expect(result.evidence.signerCpf).toBe('***.***.*21-00')
  })

  it('includes geolocation when provided', async () => {
    const { buildEvidencePackage } = await import('../signature-evidence')
    const result = await buildEvidencePackage({
      contentText: 'text',
      signatureData: 'data:image/png;base64,x',
      signerCpf: '123.456.789-00',
      ipAddress: '1.2.3.4',
      userAgent: 'test',
      deviceFingerprint: { screen: '1920x1080', timezone: 'America/Sao_Paulo', language: 'pt-BR' },
      geolocation: { lat: -23.55, lng: -46.63 },
    })
    expect(result.evidence.geolocation).toEqual({ lat: -23.55, lng: -46.63 })
  })

  it('omits geolocation when not provided', async () => {
    const { buildEvidencePackage } = await import('../signature-evidence')
    const result = await buildEvidencePackage({
      contentText: 'text',
      signatureData: 'data:image/png;base64,x',
      signerCpf: '123.456.789-00',
      ipAddress: '1.2.3.4',
      userAgent: 'test',
      deviceFingerprint: { screen: '1920x1080', timezone: 'America/Sao_Paulo', language: 'pt-BR' },
    })
    expect(result.evidence.geolocation).toBeUndefined()
  })
})

describe('verifyEvidencePackage', () => {
  it('returns valid for a correctly built package', async () => {
    const { buildEvidencePackage, verifyEvidencePackage } = await import('../signature-evidence')
    const { evidence } = await buildEvidencePackage({
      contentText: 'Consent text',
      signatureData: 'data:image/png;base64,abc',
      signerCpf: '123.456.789-00',
      ipAddress: '1.2.3.4',
      userAgent: 'test',
      deviceFingerprint: { screen: '1920x1080', timezone: 'America/Sao_Paulo', language: 'pt-BR' },
    })

    const result = await verifyEvidencePackage(
      'Consent text',
      'data:image/png;base64,abc',
      evidence,
    )
    expect(result.valid).toBe(true)
  })

  it('returns invalid when content was tampered', async () => {
    const { buildEvidencePackage, verifyEvidencePackage } = await import('../signature-evidence')
    const { evidence } = await buildEvidencePackage({
      contentText: 'Original text',
      signatureData: 'data:image/png;base64,abc',
      signerCpf: '123.456.789-00',
      ipAddress: '1.2.3.4',
      userAgent: 'test',
      deviceFingerprint: { screen: '1920x1080', timezone: 'America/Sao_Paulo', language: 'pt-BR' },
    })

    const result = await verifyEvidencePackage(
      'Tampered text',
      'data:image/png;base64,abc',
      evidence,
    )
    expect(result.valid).toBe(false)
  })
})

describe('collectDeviceFingerprint', () => {
  it('returns screen, timezone, and language', async () => {
    vi.stubGlobal('window', {
      screen: { width: 1920, height: 1080 },
      navigator: { language: 'pt-BR' },
    })
    vi.stubGlobal('Intl', {
      DateTimeFormat: vi.fn(() => ({ resolvedOptions: () => ({ timeZone: 'America/Sao_Paulo' }) })),
    })
    const { collectDeviceFingerprint } = await import('../signature-evidence')
    const fp = collectDeviceFingerprint()
    expect(fp).toEqual({
      screen: '1920x1080',
      timezone: 'America/Sao_Paulo',
      language: 'pt-BR',
    })
  })
})

describe('deriveVerificationCode', () => {
  it('returns FLC- prefix with 8 uppercase hex chars', async () => {
    const { deriveVerificationCode } = await import('../signature-evidence')
    const code = deriveVerificationCode('abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890')
    expect(code).toBe('FLC-ABCDEF12')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @floraclin/web test:run -- web/src/lib/__tests__/signature-evidence.test.ts`
Expected: FAIL — module `../signature-evidence` does not exist

- [ ] **Step 3: Implement signature-evidence.ts**

```ts
// web/src/lib/signature-evidence.ts

export interface DeviceFingerprint {
  screen: string
  timezone: string
  language: string
}

export interface Geolocation {
  lat: number
  lng: number
}

export interface SignatureEvidence {
  version: 1
  contentHash: string
  signatureHash: string
  evidenceHash: string
  signerCpf: string
  ipAddress: string
  userAgent: string
  signedAt: string
  deviceFingerprint: DeviceFingerprint
  geolocation?: Geolocation
  timestampToken?: string
}

export interface EvidenceResult {
  evidence: SignatureEvidence
  verificationCode: string
}

export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

function maskCpf(cpf: string): string {
  const digits = cpf.replace(/\D/g, '')
  if (digits.length < 11) return cpf
  return `***.***.*${digits.slice(7, 9)}-${digits.slice(9, 11)}`
}

export function deriveVerificationCode(evidenceHash: string): string {
  const raw = evidenceHash.replace('sha256:', '')
  return `FLC-${raw.slice(0, 8).toUpperCase()}`
}

export async function buildEvidencePackage(input: {
  contentText: string
  signatureData: string
  signerCpf: string
  ipAddress: string
  userAgent: string
  deviceFingerprint: DeviceFingerprint
  geolocation?: Geolocation
}): Promise<EvidenceResult> {
  const contentHash = `sha256:${await sha256(input.contentText)}`
  const signatureHash = `sha256:${await sha256(input.signatureData)}`

  const signedAt = new Date().toISOString()
  const rawEvidenceInput = [
    contentHash,
    signatureHash,
    input.signerCpf,
    input.ipAddress,
    input.userAgent,
    signedAt,
  ].join('|')

  const evidenceHashHex = await sha256(rawEvidenceInput)
  const evidenceHash = `sha256:${evidenceHashHex}`

  const timestampToken = await fetchTimestampToken(evidenceHashHex).catch(() => undefined)

  const evidence: SignatureEvidence = {
    version: 1,
    contentHash,
    signatureHash,
    evidenceHash,
    signerCpf: maskCpf(input.signerCpf),
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    signedAt,
    deviceFingerprint: input.deviceFingerprint,
    ...(input.geolocation ? { geolocation: input.geolocation } : {}),
    ...(timestampToken ? { timestampToken } : {}),
  }

  return {
    evidence,
    verificationCode: deriveVerificationCode(evidenceHashHex),
  }
}

export async function verifyEvidencePackage(
  contentText: string,
  signatureData: string,
  evidence: SignatureEvidence,
): Promise<{ valid: boolean; details: string }> {
  const recomputedContentHash = `sha256:${await sha256(contentText)}`
  if (recomputedContentHash !== evidence.contentHash) {
    return { valid: false, details: 'Conteúdo do documento foi alterado' }
  }

  const recomputedSignatureHash = `sha256:${await sha256(signatureData)}`
  if (recomputedSignatureHash !== evidence.signatureHash) {
    return { valid: false, details: 'Assinatura foi alterada' }
  }

  // Recompute evidence hash to verify full chain integrity
  const rawEvidenceInput = [
    recomputedContentHash,
    recomputedSignatureHash,
    evidence.signerCpf,
    evidence.ipAddress,
    evidence.userAgent,
    evidence.signedAt,
  ].join('|')
  const recomputedEvidenceHash = `sha256:${await sha256(rawEvidenceInput)}`
  if (recomputedEvidenceHash !== evidence.evidenceHash) {
    return { valid: false, details: 'Cadeia de evidência comprometida' }
  }

  return { valid: true, details: 'Documento autêntico e íntegro' }
}

async function fetchTimestampToken(evidenceHash: string): Promise<string | undefined> {
  try {
    const hashBytes = new Uint8Array(evidenceHash.match(/.{2}/g)!.map((b) => parseInt(b, 16)))

    const tsqBody = buildTimestampQuery(hashBytes)
    const res = await fetch('https://freetsa.org/tsr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query' },
      body: tsqBody,
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) return undefined
    const buf = new Uint8Array(await res.arrayBuffer())
    let binary = ''
    for (const byte of buf) binary += String.fromCharCode(byte)
    return btoa(binary)
  } catch {
    return undefined
  }
}

function buildTimestampQuery(hashBytes: Uint8Array): Uint8Array {
  // Minimal DER-encoded RFC 3161 TimeStampReq:
  // SEQUENCE { version INTEGER 1, messageImprint SEQUENCE { algorithm AlgorithmIdentifier(SHA-256), hashedMessage OCTET STRING } }
  const sha256Oid = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00])
  const hashOctet = new Uint8Array([0x04, hashBytes.length, ...hashBytes])
  const messageImprint = new Uint8Array([0x30, sha256Oid.length + hashOctet.length, ...sha256Oid, ...hashOctet])
  const versionInt = new Uint8Array([0x02, 0x01, 0x01])
  const body = new Uint8Array([...versionInt, ...messageImprint])
  return new Uint8Array([0x30, body.length, ...body])
}

// Client-only — guard against server-side import
export function collectDeviceFingerprint(): DeviceFingerprint {
  if (typeof window === 'undefined') {
    return { screen: 'unknown', timezone: 'unknown', language: 'unknown' }
  }
  return {
    screen: `${window.screen.width}x${window.screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: window.navigator.language,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @floraclin/web test:run -- web/src/lib/__tests__/signature-evidence.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/signature-evidence.ts web/src/lib/__tests__/signature-evidence.test.ts
git commit -m "feat(compliance): add signature evidence utility with hash chain and RFC 3161"
```

---

### Task 2: Migration SQL

Standalone SQL file — no code deps.

**Files:**
- Create: `web/src/db/migrations/0016_consent_evidence.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- web/src/db/migrations/0016_consent_evidence.sql

-- Evidence columns on consent_acceptances
ALTER TABLE floraclin.consent_acceptances
  ADD COLUMN signature_evidence JSONB,
  ADD COLUMN verification_code VARCHAR(16) UNIQUE;

-- Verification code on clinical_documents
ALTER TABLE floraclin.clinical_documents
  ADD COLUMN verification_code VARCHAR(16) UNIQUE;

-- Remote consent signing tokens
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

-- Audit log immutability trigger (Lei 13.787 Art. 6°)
CREATE OR REPLACE FUNCTION floraclin.prevent_audit_modification() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs table is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON floraclin.audit_logs
  FOR EACH ROW EXECUTE FUNCTION floraclin.prevent_audit_modification();
```

- [ ] **Step 2: Update the Drizzle migration journal**

Add entry to `web/src/db/migrations/meta/_journal.json`:

```json
{
  "idx": 16,
  "version": "7",
  "when": 1780700000000,
  "tag": "0016_consent_evidence",
  "breakpoints": true
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/db/migrations/0016_consent_evidence.sql web/src/db/migrations/meta/_journal.json
git commit -m "feat(compliance): add consent evidence migration with audit immutability trigger"
```

---

### Task 3: Drizzle Schema Updates

Add the new table definition and columns to the Drizzle schema.

**Files:**
- Modify: `web/src/db/schema.ts`

- [ ] **Step 1: Add `signatureEvidence` and `verificationCode` columns to `consentAcceptances`**

In `web/src/db/schema.ts`, add two columns to the `consentAcceptances` table definition (after `userAgent` on line 357):

```ts
// Add inside consentAcceptances table definition, after the userAgent column:
  signatureEvidence: jsonb('signature_evidence'),
  verificationCode: varchar('verification_code', { length: 16 }).unique(),
```

- [ ] **Step 2: Add `verificationCode` column to `clinicalDocuments`**

In `web/src/db/schema.ts`, add one column to the `clinicalDocuments` table definition (after `storagePath` on line 921):

```ts
// Add inside clinicalDocuments table definition, after storagePath:
  verificationCode: varchar('verification_code', { length: 16 }).unique(),
```

- [ ] **Step 3: Add `consentSigningTokens` table definition**

Add the new table after the `consentAcceptances` table (after the closing `})` at line 361), before the `// ─── FINANCIAL ───` comment:

```ts
export const consentSigningTokens = floraclinSchema.table('consent_signing_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  token: varchar('token', { length: 64 }).notNull().unique(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  procedureRecordId: uuid('procedure_record_id').notNull().references(() => procedureRecords.id),
  consentTemplateIds: uuid('consent_template_ids').array().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_consent_signing_tokens_token').on(table.token),
  index('idx_consent_signing_tokens_tenant').on(table.tenantId),
])
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS — no type errors

- [ ] **Step 5: Commit**

```bash
git add web/src/db/schema.ts
git commit -m "feat(compliance): add consent signing tokens table and evidence columns to schema"
```

---

### Task 4: Validation Schemas

Add zod schemas for remote signing, device fingerprint, and the WhatsApp template purpose constant.

**Files:**
- Modify: `web/src/validations/consent.ts`
- Modify: `web/src/validations/__tests__/consent.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the end of `web/src/validations/__tests__/consent.test.ts`:

```ts
import { deviceFingerprintSchema, remoteConsentSignatureSchema, CONSENT_SIGNING_TEMPLATE_PURPOSE } from '../consent'

describe('deviceFingerprintSchema', () => {
  it('passes with valid fingerprint', () => {
    const result = deviceFingerprintSchema.safeParse({
      screen: '1920x1080',
      timezone: 'America/Sao_Paulo',
      language: 'pt-BR',
    })
    expect(result.success).toBe(true)
  })

  it('fails when screen is missing', () => {
    const result = deviceFingerprintSchema.safeParse({
      timezone: 'America/Sao_Paulo',
      language: 'pt-BR',
    })
    expect(result.success).toBe(false)
  })
})

describe('remoteConsentSignatureSchema', () => {
  const valid = {
    token: 'abc123def456',
    signatures: [
      {
        consentTemplateId: '550e8400-e29b-41d4-a716-446655440001',
        signatureData: 'data:image/png;base64,abc',
        deviceFingerprint: { screen: '1920x1080', timezone: 'America/Sao_Paulo', language: 'pt-BR' },
      },
    ],
  }

  it('passes with valid data', () => {
    const result = remoteConsentSignatureSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('passes with optional geolocation', () => {
    const result = remoteConsentSignatureSchema.safeParse({
      ...valid,
      signatures: [{ ...valid.signatures[0], geolocation: { lat: -23.55, lng: -46.63 } }],
    })
    expect(result.success).toBe(true)
  })

  it('fails with empty signatures array', () => {
    const result = remoteConsentSignatureSchema.safeParse({ ...valid, signatures: [] })
    expect(result.success).toBe(false)
  })

  it('fails with invalid signature data', () => {
    const result = remoteConsentSignatureSchema.safeParse({
      ...valid,
      signatures: [{ ...valid.signatures[0], signatureData: 'not-a-data-uri' }],
    })
    expect(result.success).toBe(false)
  })
})

describe('CONSENT_SIGNING_TEMPLATE_PURPOSE', () => {
  it('is defined as consent_signing_link', () => {
    expect(CONSENT_SIGNING_TEMPLATE_PURPOSE).toBe('consent_signing_link')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @floraclin/web test:run -- web/src/validations/__tests__/consent.test.ts`
Expected: FAIL — `deviceFingerprintSchema`, `remoteConsentSignatureSchema`, `CONSENT_SIGNING_TEMPLATE_PURPOSE` not exported

- [ ] **Step 3: Add the new schemas to consent.ts**

Add to the end of `web/src/validations/consent.ts`:

```ts
export const CONSENT_SIGNING_TEMPLATE_PURPOSE = 'consent_signing_link' as const

export const deviceFingerprintSchema = z.object({
  screen: z.string(),
  timezone: z.string(),
  language: z.string(),
})

const geolocationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
})

export const remoteConsentSignatureSchema = z.object({
  token: z.string().min(1),
  signatures: z
    .array(
      z.object({
        consentTemplateId: z.string().uuid(),
        signatureData: z
          .string()
          .refine((s) => s.startsWith('data:image/'), 'Assinatura inválida'),
        deviceFingerprint: deviceFingerprintSchema,
        geolocation: geolocationSchema.optional(),
      }),
    )
    .min(1, 'Pelo menos uma assinatura é obrigatória'),
})

export type RemoteConsentSignatureInput = z.infer<typeof remoteConsentSignatureSchema>
export type DeviceFingerprintInput = z.infer<typeof deviceFingerprintSchema>

export const sendSigningLinkSchema = z.object({
  patientId: z.string().uuid(),
  procedureRecordId: z.string().uuid(),
  consentTypes: z.array(z.string().min(1)).min(1, 'Pelo menos um tipo de termo é obrigatório'),
})

export type SendSigningLinkInput = z.infer<typeof sendSigningLinkSchema>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @floraclin/web test:run -- web/src/validations/__tests__/consent.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/validations/consent.ts web/src/validations/__tests__/consent.test.ts
git commit -m "feat(compliance): add remote signing and device fingerprint validation schemas"
```

---

## Group B — Data Layer

### Task 5: Consent Signing Token Queries

CRUD for the `consent_signing_tokens` table. Follows the same pattern as `anamnesis-tokens.ts`.

**Files:**
- Create: `web/src/db/queries/consent-signing-tokens.ts`

- [ ] **Step 1: Write the token queries**

```ts
// web/src/db/queries/consent-signing-tokens.ts
import crypto from 'node:crypto'
import { db } from '@/db/client'
import { consentSigningTokens, patients, consentTemplates } from '@/db/schema'
import { eq, and, isNull, sql, inArray } from 'drizzle-orm'

export async function createSigningToken(
  tenantId: string,
  patientId: string,
  procedureRecordId: string,
  consentTemplateIds: string[],
  createdBy: string,
) {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

  const [row] = await db
    .insert(consentSigningTokens)
    .values({
      token,
      tenantId,
      patientId,
      procedureRecordId,
      consentTemplateIds,
      expiresAt,
      createdBy,
    })
    .returning()

  return row
}

export async function getValidSigningToken(token: string) {
  const [row] = await db
    .select({
      id: consentSigningTokens.id,
      token: consentSigningTokens.token,
      tenantId: consentSigningTokens.tenantId,
      patientId: consentSigningTokens.patientId,
      procedureRecordId: consentSigningTokens.procedureRecordId,
      consentTemplateIds: consentSigningTokens.consentTemplateIds,
      expiresAt: consentSigningTokens.expiresAt,
      createdBy: consentSigningTokens.createdBy,
      patientName: patients.fullName,
    })
    .from(consentSigningTokens)
    .innerJoin(patients, eq(patients.id, consentSigningTokens.patientId))
    .where(
      and(
        eq(consentSigningTokens.token, token),
        isNull(consentSigningTokens.usedAt),
        sql`${consentSigningTokens.expiresAt} > now()`,
      ),
    )
    .limit(1)

  return row ?? null
}

export async function markSigningTokenUsed(token: string) {
  const [row] = await db
    .update(consentSigningTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(consentSigningTokens.token, token),
        isNull(consentSigningTokens.usedAt),
        sql`${consentSigningTokens.expiresAt} > now()`,
      ),
    )
    .returning()

  return row ?? null
}

export async function getTemplatesForToken(tenantId: string, templateIds: string[]) {
  return db
    .select({
      id: consentTemplates.id,
      type: consentTemplates.type,
      title: consentTemplates.title,
      content: consentTemplates.content,
      version: consentTemplates.version,
    })
    .from(consentTemplates)
    .where(
      and(
        eq(consentTemplates.tenantId, tenantId),
        inArray(consentTemplates.id, templateIds),
        eq(consentTemplates.isActive, true),
      ),
    )
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/db/queries/consent-signing-tokens.ts
git commit -m "feat(compliance): add consent signing token CRUD queries"
```

---

### Task 6: Integrate Evidence into Consent Queries

Modify `acceptConsent()` to build and store the evidence package. Add `findByVerificationCode()` for the public verification page.

**Files:**
- Modify: `web/src/db/queries/consent.ts`

- [ ] **Step 1: Add evidence imports and update acceptConsent**

In `web/src/db/queries/consent.ts`:

1. Add import at the top (line 1):
```ts
import { db } from '@/db/client'
import { consentTemplates, consentAcceptances, patients, procedureRecords } from '@/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { withTransaction } from '@/lib/tenant'
import type { ConsentAcceptanceInput } from '@/validations/consent'
import { verifyTenantOwnership } from './helpers'
import { sha256, buildEvidencePackage, type DeviceFingerprint, type Geolocation } from '@/lib/signature-evidence'
```

2. Remove the local `hashContent` function (lines 9-15) — replaced by `sha256` from `signature-evidence.ts`.

3. Replace the `hashContent(snapshotContent)` call on line 158 with `sha256(snapshotContent)`.

4. Update the `meta` parameter type and `acceptConsent` body to accept and store evidence:

```ts
export async function acceptConsent(
  tenantId: string,
  data: ConsentAcceptanceInput,
  meta: {
    ipAddress?: string
    userAgent?: string
    renderedContent?: string
    signerCpf?: string
    deviceFingerprint?: DeviceFingerprint
    geolocation?: Geolocation
  },
  tx?: typeof db,
) {
  const target = tx ?? db

  await Promise.all([
    verifyTenantOwnership(tenantId, patients, data.patientId, 'Patient'),
    ...(data.procedureRecordId
      ? [verifyTenantOwnership(tenantId, procedureRecords, data.procedureRecordId, 'Procedure record')]
      : []),
  ])

  const template = await getConsentTemplateById(tenantId, data.consentTemplateId)
  if (!template) {
    throw new Error('Termo não encontrado')
  }

  const snapshotContent = (template.type === 'service_contract' && meta.renderedContent)
    ? meta.renderedContent
    : template.content

  const contentHash = await sha256(snapshotContent)

  let signatureEvidence: unknown = null
  let verificationCode: string | null = null

  if (data.signatureData && meta.signerCpf && meta.deviceFingerprint) {
    const evidenceResult = await buildEvidencePackage({
      contentText: snapshotContent,
      signatureData: data.signatureData,
      signerCpf: meta.signerCpf,
      ipAddress: meta.ipAddress ?? 'unknown',
      userAgent: meta.userAgent ?? 'unknown',
      deviceFingerprint: meta.deviceFingerprint,
      geolocation: meta.geolocation,
    })
    signatureEvidence = evidenceResult.evidence
    verificationCode = evidenceResult.verificationCode
  }

  const [acceptance] = await target
    .insert(consentAcceptances)
    .values({
      tenantId,
      patientId: data.patientId,
      consentTemplateId: data.consentTemplateId,
      procedureRecordId: data.procedureRecordId ?? null,
      acceptanceMethod: data.acceptanceMethod,
      signatureData: data.signatureData ?? null,
      contentHash,
      contentSnapshot: snapshotContent,
      acceptedAt: new Date(),
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      signatureEvidence,
      verificationCode,
    })
    .returning()

  return acceptance
}
```

> **Note:** The `tx` parameter ensures `acceptConsent` participates in the caller's transaction. Both the accept route and the remote sign route pass their transaction context.

- [ ] **Step 2: Add findByVerificationCode function**

Add at the end of `web/src/db/queries/consent.ts`:

```ts
export async function findByVerificationCode(code: string) {
  const [row] = await db
    .select({
      id: consentAcceptances.id,
      contentSnapshot: consentAcceptances.contentSnapshot,
      signatureData: consentAcceptances.signatureData,
      signatureEvidence: consentAcceptances.signatureEvidence,
      verificationCode: consentAcceptances.verificationCode,
      acceptedAt: consentAcceptances.acceptedAt,
      acceptanceMethod: consentAcceptances.acceptanceMethod,
      templateTitle: consentTemplates.title,
      templateType: consentTemplates.type,
    })
    .from(consentAcceptances)
    .innerJoin(consentTemplates, eq(consentAcceptances.consentTemplateId, consentTemplates.id))
    .where(eq(consentAcceptances.verificationCode, code))
    .limit(1)

  return row ?? null
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/db/queries/consent.ts
git commit -m "feat(compliance): integrate evidence package into consent acceptance queries"
```

---

### Task 7: PDF Verification Footer

Add a verification code footer line to the base CSS used by all PDF generation.

**Files:**
- Modify: `web/src/lib/pdf.ts`

- [ ] **Step 1: Add verification footer CSS**

In `web/src/lib/pdf.ts`, add to the end of `PRINT_BASE_CSS` (before the closing backtick on line 80):

```css
  .verification-footer {
    margin-top: 2rem;
    padding-top: 0.75rem;
    border-top: 1px solid #ddd;
    text-align: center;
    font-size: 10px;
    color: #888;
  }
```

- [ ] **Step 2: Add verification footer React component helper**

Add a new exported function after `renderReactToPdf`:

```ts
export function VerificationFooter({ code }: { code: string }) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  return (
    <div className="verification-footer">
      Documento assinado eletronicamente · Verifique: {appUrl}/verify/{code}
    </div>
  )
}
```

Note: add `import type { ReactElement } from 'react'` → already imported. Add the React import if needed for JSX:

At the top of the file (after `import 'server-only'`), ensure:
```ts
import React from 'react'
import type { ReactElement } from 'react'
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/pdf.ts
git commit -m "feat(compliance): add verification footer to PDF generation"
```

---

## Group C — API Routes & Pages

### Task 8: Send Signing Link API

Generate a token and send the signing link via WhatsApp. Follows the same pattern as `anamnesis-link/send/route.ts`.

**Files:**
- Create: `web/src/app/api/consent/send-signing-link/route.ts`

- [ ] **Step 1: Implement the route**

```ts
// web/src/app/api/consent/send-signing-link/route.ts
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { getPatient } from '@/db/queries/patients'
import { getTemplateByPurpose, upsertConversation, createMessage, pushSseEvent } from '@/db/queries/whatsapp'
import { sendTemplateMessage, resolveTemplateBody } from '@/lib/whatsapp'
import { createSigningToken } from '@/db/queries/consent-signing-tokens'
import { getActiveConsentForType } from '@/db/queries/consent'
import { sendSigningLinkSchema, CONSENT_SIGNING_TEMPLATE_PURPOSE } from '@/validations/consent'

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = sendSigningLinkSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const tenant = await getTenant(ctx.tenantId)
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>
    if (!settings.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp não habilitado' }, { status: 403 })
    }

    const patient = await getPatient(ctx.tenantId, parsed.data.patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }
    if (!patient.phone) {
      return NextResponse.json({ error: 'Paciente sem telefone cadastrado' }, { status: 400 })
    }

    // Resolve consent types to active template IDs server-side
    const templateResults = await Promise.all(
      parsed.data.consentTypes.map((type) => getActiveConsentForType(ctx.tenantId, type)),
    )
    const consentTemplateIds = templateResults
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .map((t) => t.id)

    if (consentTemplateIds.length === 0) {
      return NextResponse.json({ error: 'Nenhum modelo de termo encontrado para os tipos solicitados' }, { status: 400 })
    }

    const signingToken = await createSigningToken(
      ctx.tenantId,
      parsed.data.patientId,
      parsed.data.procedureRecordId,
      consentTemplateIds,
      ctx.userId,
    )

    const signingUrl = `${appUrl}/sign/${signingToken.token}`

    const template = await getTemplateByPurpose(ctx.tenantId, CONSENT_SIGNING_TEMPLATE_PURPOSE)
    if (!template) {
      return NextResponse.json(
        { error: 'Template de assinatura de consentimento não cadastrado. Cadastre um template com finalidade "consent_signing_link".' },
        { status: 400 },
      )
    }
    if (template.status !== 'APPROVED') {
      return NextResponse.json(
        { error: 'Template de assinatura aguardando aprovação da Meta.' },
        { status: 400 },
      )
    }

    const phone = patient.phone.replace(/\D/g, '')
    const normalizedPhone = phone.startsWith('55') ? phone : `55${phone}`
    const firstName = patient.fullName.split(' ')[0]

    const templateParams = { '1': firstName, '2': tenant!.name, '3': signingUrl }
    const result = await sendTemplateMessage(
      ctx.tenantId,
      normalizedPhone,
      template.name,
      template.language,
      templateParams,
    )

    const conversation = await upsertConversation(
      ctx.tenantId,
      normalizedPhone,
      patient.fullName,
      undefined,
      parsed.data.patientId,
    )

    const message = await createMessage(ctx.tenantId, conversation.id, {
      direction: 'outbound',
      metaMessageId: result.metaMessageId,
      body: resolveTemplateBody(template.components, templateParams),
      templateName: template.name,
      deliveryStatus: 'sent',
    })

    await pushSseEvent(ctx.tenantId, 'new_message', {
      conversationId: conversation.id,
      message,
    })

    return NextResponse.json({
      success: true,
      data: { token: signingToken.token, expiresAt: signingToken.expiresAt },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Meta API error')) {
      return NextResponse.json({ error: `Falha ao enviar via WhatsApp: ${msg.replace('Meta API error: ', '')}` }, { status: 502 })
    }
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Consent signing link API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/consent/send-signing-link/route.ts
git commit -m "feat(compliance): add send-signing-link API route with WhatsApp integration"
```

---

### Task 9: Remote Sign API

Token-based endpoint — no auth required. Validates token, creates consent acceptances with evidence packages, marks token used.

**Files:**
- Create: `web/src/app/api/consent/sign/route.ts`

- [ ] **Step 1: Implement the route**

```ts
// web/src/app/api/consent/sign/route.ts
import { NextResponse } from 'next/server'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { acceptConsent } from '@/db/queries/consent'
import { getValidSigningToken, markSigningTokenUsed, getTemplatesForToken } from '@/db/queries/consent-signing-tokens'
import { getPatient } from '@/db/queries/patients'
import { remoteConsentSignatureSchema } from '@/validations/consent'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = remoteConsentSignatureSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const tokenData = await getValidSigningToken(parsed.data.token)
    if (!tokenData) {
      return NextResponse.json({ error: 'Link expirado ou já utilizado' }, { status: 410 })
    }

    const patient = await getPatient(tokenData.tenantId, tokenData.patientId)
    const signerCpf = patient?.cpf ?? ''

    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-real-ip')
      ?? undefined
    const userAgent = request.headers.get('user-agent') ?? undefined

    const templates = await getTemplatesForToken(tokenData.tenantId, tokenData.consentTemplateIds as string[])
    const templateMap = new Map(templates.map((t) => [t.id, t]))

    await withTransaction(async (tx) => {
      for (const sig of parsed.data.signatures) {
        const template = templateMap.get(sig.consentTemplateId)
        if (!template) continue

        const acceptance = await acceptConsent(
          tokenData.tenantId,
          {
            patientId: tokenData.patientId,
            consentTemplateId: sig.consentTemplateId,
            procedureRecordId: tokenData.procedureRecordId,
            acceptanceMethod: 'signature',
            signatureData: sig.signatureData,
          },
          {
            ipAddress,
            userAgent,
            signerCpf,
            deviceFingerprint: sig.deviceFingerprint,
            geolocation: sig.geolocation,
          },
          tx,
        )

        // Use createdBy (the practitioner who sent the link) as userId —
        // patientId is NOT in the users table and would violate the FK.
        await createAuditLog({
          tenantId: tokenData.tenantId,
          userId: tokenData.createdBy,
          action: 'consent_accepted',
          entityType: 'consent_acceptance',
          entityId: acceptance.id,
          changes: {
            method: { old: null, new: 'remote_whatsapp' },
            patientId: { old: null, new: tokenData.patientId },
            consentTemplateId: { old: null, new: sig.consentTemplateId },
          },
          ipAddress,
          userAgent,
        }, tx)
      }

      await markSigningTokenUsed(parsed.data.token)
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Remote consent sign API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/consent/sign/route.ts
git commit -m "feat(compliance): add remote consent signing API route (token-based, no auth)"
```

---

### Task 10: Update Accept Route with Evidence Fields

Forward `deviceFingerprint`, `geolocation`, and `signerCpf` from the request body to `acceptConsent()`.

**Files:**
- Modify: `web/src/app/api/consent/accept/route.ts`

- [ ] **Step 1: Update the route handler**

In `web/src/app/api/consent/accept/route.ts`, update the `acceptConsent` call (around line 30-34) to forward the new fields:

```ts
    const acceptance = await withTransaction(async (tx) => {
      const result = await acceptConsent(ctx.tenantId, parsed.data, {
        ipAddress,
        userAgent,
        renderedContent: body.renderedContent,
        signerCpf: body.signerCpf,
        deviceFingerprint: body.deviceFingerprint,
        geolocation: body.geolocation,
      }, tx)

      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'consent_accepted',
        entityType: 'consent_acceptance',
        entityId: result.id,
        changes: {
          patientId: { old: null, new: body.patientId },
          consentTemplateId: { old: null, new: body.consentTemplateId },
          method: { old: null, new: body.acceptanceMethod },
        },
      }, tx)

      return result
    })
```

The only change is adding `signerCpf`, `deviceFingerprint`, and `geolocation` to the meta object.

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/consent/accept/route.ts
git commit -m "feat(compliance): forward device fingerprint and geolocation to consent acceptance"
```

---

### Task 11: Public Verification Page

Public page at `/verify/[code]` — no authentication. Displays document type, signing date, masked CPF, and re-verifies the evidence hash chain.

**Files:**
- Create: `web/src/app/verify/[code]/layout.tsx`
- Create: `web/src/app/verify/[code]/page.tsx`

- [ ] **Step 1: Create the layout**

```tsx
// web/src/app/verify/[code]/layout.tsx
export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2">
            <img src="/brand/logo-sage.svg" alt="" className="h-8" />
            <span className="font-display text-xl font-semibold">
              <span className="text-forest">Flora</span>
              <span className="text-sage">Clin</span>
            </span>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the page**

```tsx
// web/src/app/verify/[code]/page.tsx
import { findByVerificationCode } from '@/db/queries/consent'
import { verifyEvidencePackage, type SignatureEvidence } from '@/lib/signature-evidence'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const TYPE_LABELS: Record<string, string> = {
  general: 'Termo de Consentimento',
  botox: 'Termo — Toxina Botulínica',
  filler: 'Termo — Preenchedor',
  biostimulator: 'Termo — Bioestimulador',
  limpeza_pele: 'Termo — Limpeza de Pele',
  enzima: 'Termo — Enzima Lipolítica',
  skinbooster: 'Termo — Skinbooster',
  microagulhamento: 'Termo — Microagulhamento',
  custom: 'Termo Personalizado',
  service_contract: 'Contrato de Serviços',
}

export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const acceptance = await findByVerificationCode(code)

  if (!acceptance) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-red-100">
          <svg className="size-7 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 className="text-lg font-medium text-red-800">Documento não encontrado</h2>
        <p className="mt-2 text-sm text-red-600">
          O código de verificação informado não corresponde a nenhum documento registrado.
        </p>
      </div>
    )
  }

  const evidence = acceptance.signatureEvidence as SignatureEvidence | null
  let verification = { valid: false, details: 'Pacote de evidência não disponível' }

  if (evidence && acceptance.contentSnapshot && acceptance.signatureData) {
    verification = await verifyEvidencePackage(
      acceptance.contentSnapshot,
      acceptance.signatureData,
      evidence,
    )
  }

  return (
    <div className="space-y-6">
      <div className={`rounded-lg border p-8 text-center ${verification.valid ? 'border-sage/30 bg-[#F0F7F1]' : 'border-red-200 bg-red-50'}`}>
        <div className={`mx-auto mb-4 flex size-14 items-center justify-center rounded-full ${verification.valid ? 'bg-mint/20' : 'bg-red-100'}`}>
          {verification.valid ? (
            <svg className="size-7 text-sage" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          ) : (
            <svg className="size-7 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            </svg>
          )}
        </div>
        <h2 className={`text-lg font-medium ${verification.valid ? 'text-sage' : 'text-red-800'}`}>
          {verification.valid ? 'Documento autêntico e íntegro' : 'Documento adulterado ou não encontrado'}
        </h2>
        <p className={`mt-1 text-sm ${verification.valid ? 'text-mid' : 'text-red-600'}`}>
          {verification.details}
        </p>
      </div>

      <div className="rounded-lg border border-[#E8ECEF] bg-white p-6 space-y-3">
        <h3 className="text-sm font-medium text-charcoal uppercase tracking-wider">Detalhes do documento</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-mid">Tipo</span>
            <p className="font-medium text-charcoal">{TYPE_LABELS[acceptance.templateType] ?? acceptance.templateType}</p>
          </div>
          <div>
            <span className="text-mid">Título</span>
            <p className="font-medium text-charcoal">{acceptance.templateTitle}</p>
          </div>
          <div>
            <span className="text-mid">Data da assinatura</span>
            <p className="font-medium text-charcoal">{format(acceptance.acceptedAt, "d 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}</p>
          </div>
          <div>
            <span className="text-mid">CPF do signatário</span>
            <p className="font-medium text-charcoal">{evidence?.signerCpf ?? '—'}</p>
          </div>
          <div>
            <span className="text-mid">Método</span>
            <p className="font-medium text-charcoal">{acceptance.acceptanceMethod === 'both' ? 'Checkbox + Assinatura' : acceptance.acceptanceMethod === 'signature' ? 'Assinatura' : 'Checkbox'}</p>
          </div>
          <div>
            <span className="text-mid">Código</span>
            <p className="font-medium text-charcoal font-mono">{acceptance.verificationCode}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/app/verify/\[code\]/layout.tsx web/src/app/verify/\[code\]/page.tsx
git commit -m "feat(compliance): add public document verification page"
```

---

### Task 12: Remote Signing Page

Token-based signing page at `/sign/[token]` with branded layout. Server component validates token, client component handles signature capture.

**Files:**
- Create: `web/src/app/sign/[token]/layout.tsx`
- Create: `web/src/app/sign/[token]/page.tsx`
- Create: `web/src/components/consent/remote-consent-signing.tsx`

- [ ] **Step 1: Create the layout**

```tsx
// web/src/app/sign/[token]/layout.tsx
export default function SignLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2">
            <img src="/brand/logo-sage.svg" alt="" className="h-8" />
            <span className="font-display text-xl font-semibold">
              <span className="text-forest">Flora</span>
              <span className="text-sage">Clin</span>
            </span>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the server page**

```tsx
// web/src/app/sign/[token]/page.tsx
import { getValidSigningToken, getTemplatesForToken } from '@/db/queries/consent-signing-tokens'
import { RemoteConsentSigning } from '@/components/consent/remote-consent-signing'

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const tokenData = await getValidSigningToken(token)

  if (!tokenData) {
    return (
      <div className="text-center py-16">
        <h2 className="text-xl font-medium text-charcoal">Link expirado</h2>
        <p className="text-mid mt-2">Este link não é mais válido ou já foi utilizado.</p>
      </div>
    )
  }

  const templates = await getTemplatesForToken(
    tokenData.tenantId,
    tokenData.consentTemplateIds as string[],
  )

  const firstName = tokenData.patientName?.split(' ')[0] ?? 'Paciente'

  return (
    <RemoteConsentSigning
      token={token}
      firstName={firstName}
      templates={templates.map((t) => ({
        id: t.id,
        type: t.type,
        title: t.title,
        content: t.content,
        version: t.version,
      }))}
    />
  )
}
```

- [ ] **Step 3: Create the client component**

```tsx
// web/src/components/consent/remote-consent-signing.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { SignaturePad } from './signature-pad'
import { collectDeviceFingerprint, type DeviceFingerprint, type Geolocation } from '@/lib/signature-evidence'

interface ConsentTemplate {
  id: string
  type: string
  title: string
  content: string
  version: number
}

interface RemoteConsentSigningProps {
  token: string
  firstName: string
  templates: ConsentTemplate[]
}

type Status = 'idle' | 'submitting' | 'success' | 'error'

export function RemoteConsentSigning({ token, firstName, templates }: RemoteConsentSigningProps) {
  const [signatureData, setSignatureData] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [deviceFingerprint, setDeviceFingerprint] = useState<DeviceFingerprint | null>(null)
  const [geolocation, setGeolocation] = useState<Geolocation | undefined>(undefined)

  useEffect(() => {
    setDeviceFingerprint(collectDeviceFingerprint())

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setGeolocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { timeout: 5000 },
      )
    }
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!signatureData || !deviceFingerprint) return

    setStatus('submitting')
    setErrorMessage(null)

    try {
      const res = await fetch('/api/consent/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          signatures: templates.map((t) => ({
            consentTemplateId: t.id,
            signatureData,
            deviceFingerprint,
            geolocation,
          })),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      setStatus('success')
    } catch (err) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : 'Erro inesperado')
    }
  }, [signatureData, deviceFingerprint, geolocation, token, templates])

  if (status === 'success') {
    return (
      <Card className="border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <CardContent className="flex flex-col items-center gap-3 py-10">
          <div className="flex size-14 items-center justify-center rounded-full bg-mint/20 text-sage">
            <svg className="size-7" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-medium text-charcoal">Termos assinados com sucesso</p>
          <p className="text-sm text-mid">Você pode fechar esta página.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-lg font-medium text-charcoal">Olá, {firstName}</h2>
        <p className="text-sm text-mid mt-1">
          Revise os termos abaixo e assine ao final.
        </p>
      </div>

      {templates.map((template) => (
        <Card key={template.id} className="border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          <CardHeader className="bg-white pb-4">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-[#2A2A2A] text-base">{template.title}</CardTitle>
              <Badge variant="outline" className="border-sage/30 bg-sage/5 text-sage text-xs shrink-0">
                v{template.version}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[50vh] rounded-[3px] border border-[#E8ECEF] bg-white p-5">
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal">
                {template.content}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      ))}

      <Card className="border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm font-medium text-charcoal">Assinatura</p>
          <SignaturePad onSignatureChange={setSignatureData} disabled={status === 'submitting'} />

          {errorMessage && (
            <p className="text-sm text-red-600">{errorMessage}</p>
          )}

          <Button
            onClick={handleSubmit}
            disabled={!signatureData || !deviceFingerprint || status === 'submitting'}
            className="w-full bg-forest text-cream hover:bg-sage shadow-md hover:shadow-lg transition-all duration-200"
            size="lg"
          >
            {status === 'submitting' ? 'Assinando...' : 'Assinar'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/app/sign/\[token\]/layout.tsx web/src/app/sign/\[token\]/page.tsx web/src/components/consent/remote-consent-signing.tsx
git commit -m "feat(compliance): add remote consent signing page with token validation"
```

---

## Group D — UI Integration

### Task 13: Consent Viewer — Device Fingerprint & Geolocation

Collect device fingerprint on mount and optional geolocation, pass them to the accept mutation.

**Files:**
- Modify: `web/src/components/consent/consent-viewer.tsx`

- [ ] **Step 1: Add imports and state**

At the top of `web/src/components/consent/consent-viewer.tsx`, add:

```ts
import { useEffect } from 'react'
import { collectDeviceFingerprint, type DeviceFingerprint, type Geolocation } from '@/lib/signature-evidence'
```

Update the existing `import { useState, useCallback } from 'react'` to:

```ts
import { useState, useCallback, useEffect } from 'react'
```

- [ ] **Step 2: Add fingerprint and geolocation state**

Inside the `ConsentViewer` component, after the existing state declarations (after `const [accepted, setAccepted] = useState(false)` on line 40), add:

```ts
  const [deviceFingerprint, setDeviceFingerprint] = useState<DeviceFingerprint | null>(null)
  const [geolocation, setGeolocation] = useState<Geolocation | undefined>(undefined)

  useEffect(() => {
    setDeviceFingerprint(collectDeviceFingerprint())
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setGeolocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { timeout: 5000 },
      )
    }
  }, [])
```

- [ ] **Step 3: Forward fingerprint data in the mutation call**

In the `handleSubmit` callback, update the `acceptConsent.mutateAsync` call to include the new fields:

```ts
      await acceptConsent.mutateAsync({
        patientId,
        consentTemplateId: template.id,
        procedureRecordId,
        acceptanceMethod: signatureData ? (checked ? 'both' : 'signature') : 'checkbox',
        signatureData: signatureData ?? undefined,
        deviceFingerprint: deviceFingerprint ?? undefined,
        geolocation,
      })
```

Update the `useCallback` dependency array to include `deviceFingerprint` and `geolocation`.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/consent/consent-viewer.tsx
git commit -m "feat(compliance): collect device fingerprint and geolocation in consent viewer"
```

---

### Task 14: Consent Status List — WhatsApp Button

Add an "Enviar via WhatsApp" button to each unsigned consent in the Step 4 approval flow. Add a mutation hook for sending the signing link.

**Files:**
- Modify: `web/src/components/procedures/approval/consent-status-list.tsx`
- Create: `web/src/hooks/mutations/use-consent-signing-mutations.ts`

- [ ] **Step 1: Create the mutation hook**

```ts
// web/src/hooks/mutations/use-consent-signing-mutations.ts
'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../queries/query-keys'

export function useSendSigningLink() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: {
      patientId: string
      procedureRecordId: string
      consentTypes: string[]
    }) => {
      const res = await fetch('/api/consent/send-signing-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || `HTTP ${res.status}`)
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.consent.all })
    },
  })
}
```

- [ ] **Step 2: Add WhatsApp button to consent-status-list**

In `web/src/components/procedures/approval/consent-status-list.tsx`:

1. Add imports:

```ts
import { Send } from 'lucide-react'
import { useSendSigningLink } from '@/hooks/mutations/use-consent-signing-mutations'
```

2. No new props needed — derive unsigned consent types from existing `consentStatuses`.

3. Inside the component, add the mutation hook and handler:

```ts
  const sendSigningLink = useSendSigningLink()

  const unsignedConsentTypes = consentStatuses
    .filter((c) => !c.signed && !c.loading)
    .map((c) => c.type)

  const handleSendWhatsApp = useCallback(() => {
    if (unsignedConsentTypes.length === 0) return
    sendSigningLink.mutate({
      patientId,
      procedureRecordId: procedureId,
      consentTypes: unsignedConsentTypes,
    })
  }, [patientId, procedureId, unsignedConsentTypes, sendSigningLink])
```

Add `import { useCallback } from 'react'` to the existing React import.

4. Add the WhatsApp button below the header title (after the "Todos assinados" badge, inside `CardHeader`):

```tsx
        {!allConsentsSigned && unsignedConsentTypes.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendWhatsApp}
            disabled={sendSigningLink.isPending}
            className="ml-auto border-forest/30 text-forest hover:bg-petal text-xs gap-1.5"
          >
            <Send className="size-3.5" />
            {sendSigningLink.isPending ? 'Enviando...' : 'Enviar via WhatsApp'}
          </Button>
        )}
```

5. If the send was successful, show a brief confirmation:

```tsx
        {sendSigningLink.isSuccess && (
          <p className="text-xs text-sage mt-1">Link enviado via WhatsApp</p>
        )}
        {sendSigningLink.isError && (
          <p className="text-xs text-red-600 mt-1">{sendSigningLink.error.message}</p>
        )}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/components/procedures/approval/consent-status-list.tsx web/src/hooks/mutations/use-consent-signing-mutations.ts
git commit -m "feat(compliance): add WhatsApp signing link button to consent status list"
```

---

## Group E — Compliance Guardrails

Can run in parallel with Group D — no shared files.

### Task 15: Clinical Record Deletion Guard + Registry Enforcement

Add a `protectClinicalRecord` guardrail and ensure professional registry is enforced before clinical document generation. Also populate `verificationCode` on clinical documents.

**Files:**
- Create: `web/src/lib/compliance.ts`
- Modify: `web/src/lib/clinical-documents.ts`

- [ ] **Step 1: Create the compliance utility**

```ts
// web/src/lib/compliance.ts

const PROTECTED_TABLES = [
  'consent_acceptances',
  'procedure_records',
  'evaluation_responses',
  'clinical_documents',
  'anamnesis_responses',
  'photos',
] as const

export function assertNotProtectedTable(tableName: string): void {
  if (PROTECTED_TABLES.includes(tableName as typeof PROTECTED_TABLES[number])) {
    throw new Error(
      `Illegal operation: DELETE on '${tableName}' is prohibited (Lei 13.787/2018 — 20-year retention).`,
    )
  }
}

export { PROTECTED_TABLES }
```

- [ ] **Step 2: Add verificationCode generation to clinical document issuance**

In `web/src/lib/clinical-documents.ts`, update `issueClinicalDocument` to generate and store a verification code:

```ts
import { sha256, deriveVerificationCode } from '@/lib/signature-evidence'
```

After building the `snapshot`, before the `insertClinicalDocument` call:

```ts
  const bodyHash = await sha256(args.body)
  const verificationCode = deriveVerificationCode(bodyHash)
```

Pass `verificationCode` to `insertClinicalDocument`. Update the `insertClinicalDocument` function in `web/src/db/queries/clinical-documents.ts` to accept and store it:

```ts
verificationCode: args.verificationCode ?? null,
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @floraclin/web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/compliance.ts web/src/lib/clinical-documents.ts
git commit -m "feat(compliance): add clinical record deletion guard and verification code on clinical documents"
```

---

## Post-Implementation Checklist

After all groups are done, run:

```bash
pnpm ci:checks   # lint + typecheck + test:run
```

All must pass. Then manually verify:

1. **Evidence package**: Accept a consent in-app with signature → check DB for `signature_evidence` JSONB and `verification_code`
2. **Verification page**: Open `/verify/FLC-XXXXXXXX` → shows "Documento autêntico e íntegro"
3. **Remote signing**: Send signing link via WhatsApp → open `/sign/[token]` → sign → verify consent accepted in Step 4
4. **PDF footer**: Generate a clinical document → verify footer has `Documento assinado eletronicamente · Verifique: ...`
5. **Audit immutability**: Try `UPDATE floraclin.audit_logs SET action = 'test' WHERE id = '...'` → should raise exception
6. **Token expiry**: Verify `/sign/[token]` shows "Link expirado" for expired/used tokens
