import { getSignatureBlock } from '@/lib/professional'
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

  return insertClinicalDocument({
    tenantId: args.tenantId,
    patientId: args.patientId,
    practitionerId: args.practitionerId,
    kind: args.kind,
    title: args.title,
    body: args.body,
    templateId: args.templateId ?? null,
    professionalSnapshot: snapshot,
  })
}

/**
 * Computes the next deliveredVia value when WhatsApp delivery succeeds.
 *  - 'download' → 'whatsapp'
 *  - 'print' → 'multiple'
 *  - 'whatsapp' → 'whatsapp' (already there)
 *  - 'multiple' → 'multiple'
 */
export function nextDeliveredViaAfterWhatsapp(current: string): string {
  if (current === 'whatsapp') return 'whatsapp'
  if (current === 'multiple') return 'multiple'
  if (current === 'download') return 'whatsapp'
  // print or any other prior value → mixed
  return 'multiple'
}
