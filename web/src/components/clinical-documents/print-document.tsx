import * as React from 'react'
import { ClinicHeader } from '@/components/print/clinic-header'
import { ProfessionalSignatureBlock } from '@/components/professional/professional-signature-block'
import { renderPlaceholders, buildDocumentPlaceholders } from '@/lib/templates/placeholders'
import type { ClinicalDocumentWithContext } from '@/db/queries/clinical-documents'
import { formatDate } from '@/lib/utils'

export interface PrintDocumentProps {
  doc: ClinicalDocumentWithContext
  tenant?: ClinicalDocumentWithContext['tenant']
}

const KIND_LABEL: Record<string, string> = {
  receita: 'Receita',
  atestado: 'Atestado',
}

/**
 * Shared print/PDF render for a clinical document. Used by:
 *  - /(platform)/documentos/[id]/imprimir (browser print)
 *  - /api/clinical-documents/[id]/pdf (renderToStaticMarkup → Chromium → PDF)
 *
 * Reads the persisted `professionalSnapshot` rather than re-fetching the
 * current user — historical documents must show the signature/registry as
 * they were at issue time.
 */
export function PrintDocument({ doc, tenant }: PrintDocumentProps) {
  const tenantForHeader = tenant ?? doc.tenant
  const snapshot = doc.professionalSnapshot

  // Resolve placeholders in the body using the snapshot + patient/tenant data.
  const tenantAddress = (tenantForHeader.address ?? null) as {
    city?: string
    state?: string
  } | null

  const placeholderValues = buildDocumentPlaceholders({
    patient: {
      fullName: doc.patient.fullName,
      cpf: doc.patient.cpf,
      birthDate: doc.patient.birthDate,
    },
    practitioner: {
      displayName: snapshot.name,
      registryLine: snapshot.registryLine,
    },
    tenant: {
      name: tenantForHeader.name,
      address: tenantAddress,
    },
    date: doc.issuedAt,
  })

  const resolvedBody = renderPlaceholders(doc.body, placeholderValues)
  const kindLabel = KIND_LABEL[doc.kind] ?? doc.kind

  // Normalize the tenant address shape for the header — it accepts the
  // structured Address interface but tenants.address is a free JSONB. Pass
  // whatever fields exist; absent ones become undefined.
  const headerAddress = tenantForHeader.address
    ? (tenantForHeader.address as {
        street?: string
        number?: string
        complement?: string
        neighborhood?: string
        city?: string
        state?: string
        zip?: string
      })
    : null

  return (
    <div
      data-print-area
      className="print-document mx-auto max-w-[820px] bg-white p-8 text-black"
    >
      <ClinicHeader
        tenant={{
          name: tenantForHeader.name,
          phone: tenantForHeader.phone,
          email: tenantForHeader.email,
          logoUrl: tenantForHeader.logoUrl,
          address: headerAddress,
        }}
      />

      <h1 className="mt-6 text-lg font-semibold uppercase tracking-wide">
        {kindLabel} — {doc.title}
      </h1>
      <div className="meta-row text-xs text-gray-600">
        Paciente: <strong>{doc.patient.fullName}</strong>
        {doc.patient.cpf ? <> · CPF: {doc.patient.cpf}</> : null}
      </div>
      <div className="meta-row text-xs text-gray-600">
        Emitido em {formatDate(doc.issuedAt)}
      </div>

      <div className="body mt-6 whitespace-pre-wrap text-sm leading-relaxed">
        {resolvedBody}
      </div>

      <div className="footer mt-16">
        <ProfessionalSignatureBlock
          signatureDataUrl={snapshot.signatureDataUrl}
          displayName={snapshot.name}
          registryLine={snapshot.registryLine}
        />
      </div>

      {doc.verificationCode && (
        <div className="mt-12 border-t border-gray-200 pt-4">
          <div className="flex items-start justify-between text-[9px] text-gray-400 leading-relaxed">
            <div>
              <div>Documento emitido eletronicamente via FloraClin</div>
              <div>Código de verificação: <span className="font-mono font-medium text-gray-500">{doc.verificationCode}</span></div>
              <div>Emitido em: {formatDate(doc.issuedAt)} às {doc.issuedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
              <div>Profissional: {snapshot.name} — {snapshot.registryLine}</div>
              <div className="mt-1">
                Verifique a autenticidade: <a href={`https://app.floraclin.com.br/verify/${doc.verificationCode}`} className="font-mono text-gray-500 underline">app.floraclin.com.br/verify/{doc.verificationCode}</a>
              </div>
            </div>
            <div className="text-right shrink-0 ml-4">
              <div className="font-mono text-[8px] text-gray-300">ID: {doc.id.slice(0, 8)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
