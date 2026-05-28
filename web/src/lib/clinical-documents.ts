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

export type DeliveryChannel = 'whatsapp' | 'print' | 'download'
export type DeliveredVia = 'pending' | DeliveryChannel | 'multiple'

/**
 * Computes the next deliveredVia value when a delivery event happens.
 *
 *  - 'pending' + any channel → that channel
 *  - 'multiple' + any → 'multiple'
 *  - current === incoming channel → unchanged
 *  - otherwise (different channel already recorded) → 'multiple'
 */
export function nextDeliveredViaAfterChannel(
  current: string,
  channel: DeliveryChannel,
): DeliveredVia {
  if (current === 'pending') return channel
  if (current === 'multiple') return 'multiple'
  if (current === channel) return channel
  // current is a different channel → mixed
  return 'multiple'
}

/**
 * Convenience wrapper preserved for callers that only emit WhatsApp deliveries.
 */
export function nextDeliveredViaAfterWhatsapp(current: string): DeliveredVia {
  return nextDeliveredViaAfterChannel(current, 'whatsapp')
}
