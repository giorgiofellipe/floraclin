import { getSignatureBlock } from '@/lib/professional'
import { sha256, deriveVerificationCode } from '@/lib/signature-evidence'
import {
  insertClinicalDocument,
  type ClinicalDocument,
} from '@/db/queries/clinical-documents'
import type {
  ClinicalDocumentKind,
  ProfessionalSnapshot,
} from '@/validations/clinical-document'

export interface IssueDocumentInput {
  tenantId: string
  practitionerId: string
  patientId: string
  kind: ClinicalDocumentKind
  title: string
  body: string
  templateId?: string | null
}

export class SignatureRequiredError extends Error {
  constructor(message = 'Profissional sem assinatura/registro configurados') {
    super(message)
    this.name = 'SignatureRequiredError'
  }
}

/**
 * Issues a clinical document, capturing the professional's signature + registry
 * as a JSONB snapshot at issue time. The snapshot is the source of truth — never
 * re-fetch the user's current signature when rendering historical documents.
 */
export async function issueClinicalDocument(
  args: IssueDocumentInput,
): Promise<ClinicalDocument> {
  const sig = await getSignatureBlock(args.practitionerId)
  if (!sig) {
    throw new SignatureRequiredError()
  }

  const snapshot: ProfessionalSnapshot = {
    name: sig.displayName,
    registryLine: sig.registryLine,
    signatureDataUrl: sig.signatureDataUrl,
  }

  const bodyHash = await sha256(args.body)
  const verificationCode = deriveVerificationCode(bodyHash)

  return insertClinicalDocument({
    tenantId: args.tenantId,
    patientId: args.patientId,
    practitionerId: args.practitionerId,
    kind: args.kind,
    title: args.title,
    body: args.body,
    templateId: args.templateId ?? null,
    professionalSnapshot: snapshot,
    verificationCode,
  })
}

/**
 * `clinical_documents.delivered_via` was originally a multi-channel state
 * machine (pending → whatsapp/print/download → multiple). Print and download
 * aren't real "delivered to patient" events — the user often opens the
 * preview to inspect it — so the column is now effectively two-state:
 * `'pending'` until the document is sent via WhatsApp, then `'whatsapp'`.
 *
 * The CHECK constraint still accepts the legacy values for backward
 * compatibility (any historical row written by an older deploy stays valid),
 * but new writes only ever use `'pending'` or `'whatsapp'`.
 */
export type DeliveredVia = 'pending' | 'whatsapp'
