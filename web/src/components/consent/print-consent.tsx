import * as React from 'react'
import { ClinicHeader } from '@/components/print/clinic-header'
import { formatDate } from '@/lib/utils'
import { CONSENT_TYPE_LABELS } from '@/lib/constants'

interface ProfessionalSnapshot {
  name: string
  registryLine: string
  signatureDataUrl: string
}

interface PrintConsentProps {
  acceptance: {
    contentSnapshot: string
    contentHash: string
    signatureData: string | null
    signatureEvidence: unknown
    professionalSnapshot: unknown
    verificationCode: string | null
    acceptedAt: Date
    acceptanceMethod: string
    templateTitle: string
    templateType: string
    templateVersion: number
    patientName: string
    patientCpf: string | null
    tenantName: string
    tenantPhone: string | null
    tenantEmail: string | null
    tenantLogoUrl: string | null
    tenantAddress: unknown
  }
}

const METHOD_LABELS: Record<string, string> = {
  checkbox: 'Checkbox',
  signature: 'Assinatura',
  both: 'Checkbox + Assinatura',
}

export function PrintConsent({ acceptance }: PrintConsentProps) {
  const a = acceptance
  const professional = a.professionalSnapshot as ProfessionalSnapshot | null
  const evidence = a.signatureEvidence as { contentHash: string; evidenceHash: string; signedAt: string; timestampToken?: string } | null
  const headerAddress = a.tenantAddress && typeof a.tenantAddress === 'object'
    ? (a.tenantAddress as {
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
          name: a.tenantName,
          phone: a.tenantPhone,
          email: a.tenantEmail,
          logoUrl: a.tenantLogoUrl,
          address: headerAddress,
        }}
      />

      <h1 className="mt-6 text-lg font-semibold uppercase tracking-wide">
        {a.templateTitle}
      </h1>
      <div className="meta-row text-xs text-gray-600">
        {CONSENT_TYPE_LABELS[a.templateType] ?? a.templateType} · Versão {a.templateVersion}
      </div>
      <div className="meta-row text-xs text-gray-600">
        Paciente: <strong>{a.patientName}</strong>
        {a.patientCpf ? <> · CPF: {a.patientCpf}</> : null}
      </div>
      <div className="meta-row text-xs text-gray-600">
        Aceito em {formatDate(a.acceptedAt)} · {METHOD_LABELS[a.acceptanceMethod] ?? a.acceptanceMethod}
      </div>

      <div className="body mt-6 whitespace-pre-wrap text-sm leading-relaxed">
        {a.contentSnapshot}
      </div>

      <div style={{ marginTop: '16rem', display: 'flex', justifyContent: 'space-around', gap: '32px' }}>
        {a.signatureData && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={a.signatureData}
              alt="Assinatura do paciente"
              style={{ height: '96px', maxWidth: '240px', objectFit: 'contain' }}
            />
            <div style={{ marginTop: '4px', width: '240px', borderTop: '1px solid black' }} />
            <div style={{ marginTop: '8px', fontSize: '14px', fontWeight: 500 }}>{a.patientName}</div>
            <div style={{ fontSize: '12px', color: '#4b5563' }}>Paciente</div>
          </div>
        )}
        {professional && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={professional.signatureDataUrl}
              alt={`Assinatura de ${professional.name}`}
              style={{ height: '96px', maxWidth: '240px', objectFit: 'contain' }}
            />
            <div style={{ marginTop: '4px', width: '240px', borderTop: '1px solid black' }} />
            <div style={{ marginTop: '8px', fontSize: '14px', fontWeight: 500 }}>{professional.name}</div>
            <div style={{ fontSize: '12px', color: '#4b5563' }}>{professional.registryLine}</div>
          </div>
        )}
      </div>

      {a.verificationCode && (
        <div
          className="mt-16"
          style={{ border: '1px solid #e5e7eb', borderRadius: '4px', backgroundColor: '#f9fafb', padding: '16px' }}
        >
          <div style={{ fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af', fontWeight: 600, marginBottom: '8px' }}>
            Assinatura Eletrônica
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontSize: '8px', color: '#6b7280', lineHeight: 1.6 }}>
            <div>
              <div style={{ color: '#9ca3af' }}>Código</div>
              <div style={{ fontFamily: 'monospace', fontWeight: 500, color: '#4b5563' }}>{a.verificationCode}</div>
            </div>
            <div>
              <div style={{ color: '#9ca3af' }}>Aceito em</div>
              <div>{formatDate(a.acceptedAt)} às {a.acceptedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
            {evidence && (
              <>
                <div style={{ gridColumn: 'span 2', marginTop: '4px' }}>
                  <div style={{ color: '#9ca3af' }}>Hash do conteúdo</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '7px', wordBreak: 'break-all' }}>{evidence.contentHash}</div>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ color: '#9ca3af' }}>Hash da evidência</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '7px', wordBreak: 'break-all' }}>{evidence.evidenceHash}</div>
                </div>
                <div>
                  <div style={{ color: '#9ca3af' }}>Assinado em</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '7px' }}>{evidence.signedAt}</div>
                </div>
                {evidence.timestampToken && (
                  <div>
                    <div style={{ color: '#9ca3af' }}>Carimbo TSA</div>
                    <div style={{ fontFamily: 'monospace', fontSize: '7px', wordBreak: 'break-all' }}>{evidence.timestampToken.slice(0, 48)}…</div>
                  </div>
                )}
              </>
            )}
            <div style={{ gridColumn: 'span 2', marginTop: '4px', color: '#9ca3af' }}>
              Verifique: <a href={`https://app.floraclin.com.br/verify/${a.verificationCode}`} style={{ fontFamily: 'monospace', textDecoration: 'underline', color: '#6b7280' }}>app.floraclin.com.br/verify/{a.verificationCode}</a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
