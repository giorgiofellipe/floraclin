'use client'

import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileTextIcon, Loader2, UserRoundIcon } from 'lucide-react'
import { getReport } from '@/lib/reports/registry'
import { ReportFilters, type ReportFilterValues } from '@/components/reports/report-filters'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils'
import { formatBrPhone } from '@/lib/phone'

// The registry is the single source of truth for which reports exist, see
// web/src/lib/reports/registry.ts. This slug is guaranteed to be present.
const REPORT = getReport('prontuario')!

const GENDER_LABELS: Record<string, string> = {
  feminino: 'Feminino',
  masculino: 'Masculino',
  outro: 'Outro',
  nao_informado: 'Não informado',
}

/** Shape of the JSON summary this page reads (`?format` absent). A lighter
 *  view than the PDF: enough to confirm this is the right patient and that
 *  the document will have something in it, not a full replica of every
 *  section (that's what the PDF is for). Dates arrive as ISO strings over
 *  JSON, not `Date` instances, same as every other report page's fetch. */
interface ProntuarioSummary {
  patient: {
    fullName: string
    phone: string
    cpf: string | null
    birthDate: string | null
    gender: string | null
    email: string | null
  }
  anamnesis: { mainComplaint: string | null } | null
  procedures: Array<{
    id: string
    procedureTypeName: string
    performedAt: string | null
    practitionerName: string
    productApplications: unknown[]
  }>
  proceduresTruncated: boolean
  photos: Array<{ stage: string; label: string; photos: unknown[] }>
  consents: Array<{ id: string; templateTitle: string; acceptedAt: string }>
}

function useProntuarioSummary(patientId: string | undefined) {
  return useQuery({
    queryKey: ['reports', 'prontuario', patientId],
    enabled: !!patientId,
    queryFn: async (): Promise<ProntuarioSummary> => {
      const params = new URLSearchParams({ patientId: patientId! })
      const res = await fetch(`/api/reports/prontuario?${params.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar prontuário')
      }
      const json = await res.json()
      return json.data as ProntuarioSummary
    },
  })
}

function SummaryCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[3px] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h2 className="text-[13px] font-medium text-charcoal">{title}</h2>
      <div className="mt-2 text-sm text-mid">{children}</div>
    </div>
  )
}

function ProntuarioSummaryView({ patientId, data }: { patientId: string; data: ProntuarioSummary }) {
  const totalPhotos = data.photos.reduce((sum, stage) => sum + stage.photos.length, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[3px] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div>
          <h2 className="font-heading text-base font-medium text-charcoal">{data.patient.fullName}</h2>
          <p className="mt-1 text-[13px] text-mid">
            {formatBrPhone(data.patient.phone)}
            {data.patient.cpf ? ` · ${data.patient.cpf}` : ''}
            {data.patient.birthDate ? ` · ${formatDate(data.patient.birthDate)}` : ''}
            {data.patient.gender ? ` · ${GENDER_LABELS[data.patient.gender] ?? data.patient.gender}` : ''}
          </p>
        </div>
        <a
          href={`/api/reports/prontuario?patientId=${patientId}&format=pdf`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button className="bg-forest text-white hover:bg-forest/90">
            <FileTextIcon data-icon="inline-start" />
            Baixar PDF do prontuário
          </Button>
        </a>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard title="Anamnese">
          {data.anamnesis ? (
            data.anamnesis.mainComplaint || 'Preenchida, sem queixa principal registrada.'
          ) : (
            'Não preenchida.'
          )}
        </SummaryCard>

        <SummaryCard title="Procedimentos">
          {data.procedures.length === 0
            ? 'Nenhum procedimento registrado.'
            : `${data.procedures.length} procedimento(s)${data.proceduresTruncated ? ' (exibindo os mais recentes)' : ''}.`}
        </SummaryCard>

        <SummaryCard title="Fotos">
          {totalPhotos === 0 ? 'Nenhuma foto registrada.' : `${totalPhotos} foto(s) na linha do tempo.`}
        </SummaryCard>

        <SummaryCard title="Consentimentos">
          {data.consents.length === 0
            ? 'Nenhum termo assinado.'
            : `${data.consents.length} termo(s) assinado(s).`}
        </SummaryCard>
      </div>

      {data.procedures.length > 0 && (
        <div className="rounded-[3px] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <h2 className="text-[13px] font-medium text-charcoal">Últimos procedimentos</h2>
          <ul className="mt-2 space-y-1 text-sm text-mid">
            {data.procedures.slice(0, 5).map((procedure) => (
              <li key={procedure.id}>
                {procedure.performedAt ? formatDate(procedure.performedAt) : 'Sem data'} ·{' '}
                {procedure.procedureTypeName} · {procedure.practitionerName}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function ProntuarioPage() {
  const [filterValues, setFilterValues] = useState<ReportFilterValues>({})
  const patientId = filterValues.patientId

  const { data, isLoading, isError, error } = useProntuarioSummary(patientId)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-xl font-medium text-charcoal">{REPORT.title}</h1>
        <p className="mt-1 text-sm text-mid">{REPORT.description}</p>
      </div>

      <ReportFilters filters={REPORT.filters} value={filterValues} onChange={setFilterValues} />

      {!patientId ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-[3px] bg-white py-16 text-center shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <UserRoundIcon className="size-6 text-mid" />
          <p className="text-[13px] text-mid">{REPORT.emptyHint}</p>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin text-mid" />
        </div>
      ) : isError ? (
        <div className="rounded-[3px] bg-white py-12 text-center text-[13px] text-mid shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          {error instanceof Error ? error.message : 'Não foi possível carregar o prontuário.'}
        </div>
      ) : data ? (
        <ProntuarioSummaryView patientId={patientId} data={data} />
      ) : null}
    </div>
  )
}
