'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Printer } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { ptBR } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { ClinicHeader, type ClinicHeaderProps } from '@/components/print/clinic-header'
import { PrintStylesheet } from '@/components/print/print-stylesheet'
import { BR_TZ, startOfBrDay } from '@/lib/dates'
import type { EvolutionFeedEntry } from '@/db/queries/patient-evolutions'

export interface PrintEvolucoesPageClientProps {
  tenant: ClinicHeaderProps['tenant']
  patient: {
    fullName: string
    cpf: string | null
    birthDate: string | null
    phone: string | null
  }
  /**
   * Pre-merged + pre-sorted feed (RA-2). Sorted (occurredAt DESC, id DESC).
   * Render in array order — do NOT re-sort here.
   */
  entries: EvolutionFeedEntry[]
}

// ─── Date helpers ───────────────────────────────────────────────────

// All wall-clock rendering goes through `formatInTimeZone(BR_TZ)` per
// AGENTS.md date rules: the print page is rendered server-side too
// (Next can prerender into HTML before client hydration), and the host
// runs UTC, so plain `format()` would shift timestamps by −3h. Locale
// is forwarded for Portuguese month/word formatting.
function formatLongDateTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return formatInTimeZone(
    date,
    BR_TZ,
    "dd 'de' MMMM 'de' yyyy 'às' HH:mm",
    { locale: ptBR },
  )
}

function formatShortDate(ymd: string): string {
  // `startOfBrDay(ymd)` returns the BR-midnight instant; rendering it in
  // BR back out yields the original calendar day regardless of host TZ.
  return formatInTimeZone(startOfBrDay(ymd), BR_TZ, 'dd/MM/yyyy', { locale: ptBR })
}

function calcAge(birthDate: string | null): number | null {
  if (!birthDate) return null
  // `startOfBrDay` keeps the birth day stable on UTC hosts; comparing to
  // `new Date()` is fine because the offset cancels out in the YoY math.
  const birth = startOfBrDay(birthDate)
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const m = now.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) {
    age--
  }
  return age
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
    <div className="mb-1">
      <span className="text-xs uppercase tracking-wider text-gray-600">{label}: </span>
      <span className="text-sm text-gray-900">{value}</span>
    </div>
  )
}

function EntryBlock({ children }: { children: React.ReactNode }) {
  // Each entry stays on a single page where possible. `break-inside-avoid`
  // is the canonical CSS hint; pair it with margin/border so the visual
  // separation reads as a unit to the print engine.
  return (
    <article
      className="mb-5 border-b border-gray-200 pb-4 last:border-b-0 evolucoes-entry"
    >
      {children}
    </article>
  )
}

function ClinicalField({ label, value }: { label: string; value: string | null }) {
  if (!value || !value.trim()) return null
  return (
    <div className="mb-2">
      <div className="text-xs uppercase tracking-wider text-gray-600">{label}</div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-900">{value}</p>
    </div>
  )
}

// ─── Per-entry renderers ────────────────────────────────────────────

function NoteEntry({ entry }: { entry: Extract<EvolutionFeedEntry, { kind: 'note' }> }) {
  return (
    <EntryBlock>
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <div className="text-sm font-medium text-gray-900">
          {formatLongDateTime(entry.occurredAt)}
        </div>
        <div className="text-xs uppercase tracking-wider text-gray-600">
          Evolução · {entry.authorName}
        </div>
      </header>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-900">{entry.body}</p>
    </EntryBlock>
  )
}

function SessionEntry({ entry }: { entry: Extract<EvolutionFeedEntry, { kind: 'session' }> }) {
  const isCancelled = entry.recordStatus === 'cancelled'
  return (
    <EntryBlock>
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <div className="text-sm font-medium text-gray-900">
          {formatLongDateTime(entry.occurredAt)}
        </div>
        <div className="text-xs uppercase tracking-wider text-gray-600">
          Sessão {entry.sessionOrdinal} de {entry.sessionsTotal} · {entry.executedByName}
        </div>
      </header>
      <p className="mb-2 text-xs text-gray-700">
        {entry.procedureTypeName}
        {isCancelled && (
          <span className="ml-2 italic text-gray-600">· linha cancelada</span>
        )}
      </p>

      <ClinicalField label="Técnica" value={entry.technique} />
      <ClinicalField label="Resposta clínica" value={entry.clinicalResponse} />
      <ClinicalField label="Efeitos adversos" value={entry.adverseEffects} />
      <ClinicalField label="Observações" value={entry.notes} />
      <ClinicalField label="Próximos objetivos" value={entry.nextSessionObjectives} />

      {entry.productApplications.length > 0 && (
        <div className="mb-2">
          <div className="text-xs uppercase tracking-wider text-gray-600">Produtos aplicados</div>
          <ul className="ml-4 list-disc text-sm text-gray-900">
            {entry.productApplications.map((p, i) => (
              <li key={i}>
                {p.productName}
                <span className="text-gray-700">
                  {' '}
                  — {p.totalQuantity} {p.quantityUnit}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {entry.diagramPointCount > 0 && (
        <div className="mb-1 text-xs text-gray-700">
          {entry.diagramPointCount} ponto(s) de aplicação registrados no diagrama
        </div>
      )}

      {entry.followUpDate && (
        <div className="mb-1 text-xs text-gray-700">
          <span className="uppercase tracking-wider">Retorno:</span>{' '}
          {formatShortDate(entry.followUpDate)}
        </div>
      )}
    </EntryBlock>
  )
}

// ─── Main component ─────────────────────────────────────────────────

export function PrintEvolucoesPageClient({
  tenant,
  patient,
  entries,
}: PrintEvolucoesPageClientProps) {
  const router = useRouter()
  const age = calcAge(patient.birthDate)

  return (
    <>
      <PrintStylesheet />
      {/* Print-only adjustments: keep each entry from splitting across pages
          and force a monochrome, shadow-free layout for ink-faithful output. */}
      <style jsx global>{`
        @media print {
          .evolucoes-entry {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .print-document {
            box-shadow: none !important;
          }
        }
      `}</style>
      <div className="mx-auto max-w-3xl p-6">
        {/* Toolbar — hidden in print */}
        <div className="no-print mb-6 flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-1.5 text-[13px] text-mid hover:text-forest transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            Voltar
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.print()}
            className="text-mid hover:text-charcoal text-[12px] h-8"
          >
            <Printer className="size-3.5 mr-1.5" />
            Imprimir
          </Button>
        </div>

        <div
          data-print-area
          className="print-document rounded-md bg-white p-8 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
        >
          <ClinicHeader tenant={tenant} />

          <article className="mt-6 text-sm text-gray-900">
            <div className="mb-6 text-center">
              <h1 className="text-xl font-semibold">Evoluções do Paciente</h1>
            </div>

            <SectionTitle>Paciente</SectionTitle>
            <Field label="Nome" value={patient.fullName} />
            {age !== null && <Field label="Idade" value={`${age} anos`} />}
            {patient.cpf && <Field label="CPF" value={patient.cpf} />}
            {patient.phone && <Field label="Telefone" value={patient.phone} />}

            <SectionTitle>Histórico clínico</SectionTitle>
            {entries.length === 0 ? (
              <p className="text-sm italic text-gray-600">
                Nenhuma evolução registrada para este paciente.
              </p>
            ) : (
              <div className="mt-4">
                {entries.map((entry) =>
                  entry.kind === 'note' ? (
                    <NoteEntry key={`note-${entry.id}`} entry={entry} />
                  ) : (
                    <SessionEntry key={`session-${entry.id}`} entry={entry} />
                  ),
                )}
              </div>
            )}
          </article>
        </div>
      </div>
    </>
  )
}
