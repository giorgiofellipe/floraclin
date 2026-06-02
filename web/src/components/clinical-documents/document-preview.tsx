'use client'

import * as React from 'react'
import { ClinicHeader } from '@/components/print/clinic-header'
import { ProfessionalSignatureBlock } from '@/components/professional/professional-signature-block'
import {
  renderPlaceholders,
  buildDocumentPlaceholders,
} from '@/lib/templates/placeholders'
import { formatDate } from '@/lib/utils'

interface PreviewPatient {
  fullName: string
  cpf: string | null
  birthDate: string | null
}

interface PreviewTenant {
  name: string
  phone: string | null
  email: string | null
  logoUrl: string | null
  address: {
    street?: string
    number?: string
    complement?: string
    neighborhood?: string
    city?: string
    state?: string
    zip?: string
  } | null
}

interface PreviewPractitioner {
  displayName: string
  registryLine: string
  signatureDataUrl: string | null
}

export interface DocumentPreviewProps {
  kind: 'receita' | 'atestado'
  title: string
  body: string
  patient: PreviewPatient
  practitioner: PreviewPractitioner
  tenant: PreviewTenant
  date?: Date
  className?: string
}

const KIND_LABEL: Record<string, string> = {
  receita: 'Receita',
  atestado: 'Atestado',
}

/**
 * On-screen preview of a clinical document used inside the issuance wizard
 * and when re-opening historical documents. Shares the same render shape as
 * `<PrintDocument>` but doesn't depend on the persisted DB row — the wizard
 * passes the in-progress draft fields.
 */
export function DocumentPreview({
  kind,
  title,
  body,
  patient,
  practitioner,
  tenant,
  date,
  className,
}: DocumentPreviewProps) {
  const renderDate = date ?? new Date()
  const placeholders = buildDocumentPlaceholders({
    patient,
    practitioner: {
      displayName: practitioner.displayName,
      registryLine: practitioner.registryLine,
    },
    tenant: { name: tenant.name, address: tenant.address },
    date: renderDate,
  })
  const resolvedBody = renderPlaceholders(body, placeholders)
  const kindLabel = KIND_LABEL[kind] ?? kind

  return (
    <div
      className={`mx-auto max-w-[820px] rounded-[3px] border border-[#E8ECEF] bg-white p-8 text-black ${
        className ?? ''
      }`}
    >
      <ClinicHeader tenant={tenant} />

      <h1 className="mt-6 text-lg font-semibold uppercase tracking-wide">
        {kindLabel} — {title || '(sem título)'}
      </h1>
      <div className="mt-1 text-xs text-gray-600">
        Paciente: <strong>{patient.fullName}</strong>
        {patient.cpf ? <> · CPF: {patient.cpf}</> : null}
      </div>
      <div className="mt-0.5 text-xs text-gray-600">
        Emitido em {formatDate(renderDate)}
      </div>

      <div className="mt-6 whitespace-pre-wrap text-sm leading-relaxed font-serif">
        {resolvedBody || (
          <span className="italic text-gray-400">
            O corpo do documento aparecerá aqui.
          </span>
        )}
      </div>

      <div className="mt-16">
        {practitioner.signatureDataUrl ? (
          <ProfessionalSignatureBlock
            signatureDataUrl={practitioner.signatureDataUrl}
            displayName={practitioner.displayName}
            registryLine={practitioner.registryLine}
          />
        ) : (
          <div className="text-center text-sm italic text-gray-500">
            Assinatura do profissional aparecerá aqui após emissão.
          </div>
        )}
      </div>

      <div className="mt-12 border-t border-gray-200 pt-4">
        <div className="text-[9px] text-gray-300 leading-relaxed">
          <div>Documento emitido eletronicamente via FloraClin</div>
          <div>Código de verificação: <span className="font-mono">FLC-XXXXXXXXXXXX</span></div>
          <div>Emitido em: {formatDate(renderDate)}</div>
          <div>Profissional: {practitioner.displayName} — {practitioner.registryLine}</div>
          <div className="mt-1">Verifique a autenticidade: <span className="font-mono">app.floraclin.com.br/verify/FLC-XXXXXXXXXXXX</span></div>
        </div>
      </div>
    </div>
  )
}
