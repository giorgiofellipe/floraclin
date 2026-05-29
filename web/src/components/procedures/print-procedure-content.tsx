import * as React from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ProfessionalSignatureBlock } from '@/components/professional/professional-signature-block'
import { startOfBrDay } from '@/lib/dates'
import type { SignatureBlock } from '@/lib/professional'
import type { ProductApplicationRecord } from '@/db/queries/product-applications'

// ─── Types ──────────────────────────────────────────────────────────

export interface PrintProcedureContentProps {
  procedure: {
    id: string
    procedureTypeName: string
    procedureTypeCategory: string
    performedAt: Date
    technique: string | null
    clinicalResponse: string | null
    adverseEffects: string | null
    notes: string | null
    followUpDate: string | null
    nextSessionObjectives: string | null
    practitionerName: string
  }
  patient: {
    fullName: string
    cpf: string | null
    birthDate: string | null
    phone: string | null
  }
  applications: ProductApplicationRecord[]
  signature: SignatureBlock | null
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatLongDate(date: Date | string): string {
  const d = typeof date === 'string' ? startOfBrDay(date) : date
  return format(d, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
}

function formatShortDate(ymd: string): string {
  return format(startOfBrDay(ymd), 'dd/MM/yyyy', { locale: ptBR })
}

// ─── Sub-components ─────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-6 mb-2 border-b border-gray-300 pb-1 text-sm font-semibold uppercase tracking-wider text-gray-800">
      {children}
    </h2>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="mb-2">
      <span className="text-xs uppercase tracking-wider text-gray-600">{label}: </span>
      <span className="text-sm text-gray-900">{value}</span>
    </div>
  )
}

// ─── Component ──────────────────────────────────────────────────────

export function PrintProcedureContent({
  procedure,
  patient,
  applications,
  signature,
}: PrintProcedureContentProps) {
  return (
    <article className="mt-6 text-sm text-gray-900">
      {/* Document title */}
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold">Registro de Procedimento</h1>
        <p className="mt-1 text-xs text-gray-700">
          Realizado em {formatLongDate(procedure.performedAt)}
        </p>
      </div>

      {/* Patient */}
      <SectionTitle>Paciente</SectionTitle>
      <Field label="Nome" value={patient.fullName} />
      {patient.cpf && <Field label="CPF" value={patient.cpf} />}
      {patient.birthDate && (
        <Field label="Data de nascimento" value={formatShortDate(patient.birthDate)} />
      )}
      {patient.phone && <Field label="Telefone" value={patient.phone} />}

      {/* Procedure */}
      <SectionTitle>Procedimento</SectionTitle>
      <Field label="Tipo" value={procedure.procedureTypeName} />
      <Field label="Categoria" value={procedure.procedureTypeCategory} />
      <Field label="Data de execução" value={formatLongDate(procedure.performedAt)} />
      <Field label="Profissional responsável" value={procedure.practitionerName} />

      {/* Clinical data */}
      {(procedure.technique ||
        procedure.clinicalResponse ||
        procedure.adverseEffects ||
        procedure.notes) && (
        <>
          <SectionTitle>Dados Clínicos</SectionTitle>
          {procedure.technique && (
            <div className="mb-3">
              <div className="text-xs uppercase tracking-wider text-gray-600">Técnica</div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-900">
                {procedure.technique}
              </p>
            </div>
          )}
          {procedure.clinicalResponse && (
            <div className="mb-3">
              <div className="text-xs uppercase tracking-wider text-gray-600">
                Resposta clínica
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-900">
                {procedure.clinicalResponse}
              </p>
            </div>
          )}
          {procedure.adverseEffects && (
            <div className="mb-3">
              <div className="text-xs uppercase tracking-wider text-gray-600">
                Efeitos adversos
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-900">
                {procedure.adverseEffects}
              </p>
            </div>
          )}
          {procedure.notes && (
            <div className="mb-3">
              <div className="text-xs uppercase tracking-wider text-gray-600">Observações</div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-900">
                {procedure.notes}
              </p>
            </div>
          )}
        </>
      )}

      {/* Product applications */}
      {applications.length > 0 && (
        <>
          <SectionTitle>Produtos Aplicados</SectionTitle>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-400 text-left text-xs uppercase tracking-wider text-gray-700">
                <th className="py-2 pr-3 font-medium">Produto</th>
                <th className="py-2 pr-3 font-medium">Princípio ativo</th>
                <th className="py-2 pr-3 text-right font-medium">Quantidade</th>
                <th className="py-2 pr-3 font-medium">Lote</th>
                <th className="py-2 font-medium">Validade</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => (
                <tr key={app.id} className="border-b border-gray-200 align-top">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{app.productName}</div>
                    {app.applicationAreas && (
                      <div className="text-xs text-gray-700">{app.applicationAreas}</div>
                    )}
                  </td>
                  <td className="py-2 pr-3">{app.activeIngredient ?? '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {app.totalQuantity} {app.quantityUnit}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{app.batchNumber ?? '—'}</td>
                  <td className="py-2 text-xs">
                    {app.expirationDate ? formatShortDate(app.expirationDate) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Follow-up */}
      {(procedure.followUpDate || procedure.nextSessionObjectives) && (
        <>
          <SectionTitle>Acompanhamento</SectionTitle>
          {procedure.followUpDate && (
            <Field
              label="Próximo retorno"
              value={formatLongDate(procedure.followUpDate)}
            />
          )}
          {procedure.nextSessionObjectives && (
            <div className="mb-3">
              <div className="text-xs uppercase tracking-wider text-gray-600">
                Objetivos da próxima sessão
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-900">
                {procedure.nextSessionObjectives}
              </p>
            </div>
          )}
        </>
      )}

      {/* Signature */}
      <div className="mt-16 flex justify-center">
        {signature ? (
          <ProfessionalSignatureBlock
            signatureDataUrl={signature.signatureDataUrl}
            displayName={signature.displayName}
            registryLine={signature.registryLine}
          />
        ) : (
          <p className="text-sm italic text-gray-600">Sem assinatura registrada</p>
        )}
      </div>
    </article>
  )
}
