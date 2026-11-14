'use client'

import { AlertTriangle, ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AnamnesisForm } from '@/components/anamnesis/anamnesis-form'
import { SendAnamnesisDialog } from '@/components/patients/send-anamnesis-dialog'
import { anamnesisAlerts, hasAnamnesisAnswers } from '@/lib/anamnesis/summary'
import { brCalendarDaysBetween, formatBrDate } from '@/lib/dates'
import type { AnamnesisRecord, AnamnesisTemplate } from '@/lib/anamnesis/types'
import type { WizardOverrides } from './types'

interface AnamnesisStepProps {
  patient: { id: string; fullName: string; phone: string }
  whatsappApiEnabled?: boolean
  record: AnamnesisRecord | null
  template: AnamnesisTemplate
  updatedByName?: string
  wizardOverrides: WizardOverrides
  readOnly: boolean
  formOpen: boolean
  onOpenForm: () => void
  onSkip: () => void
}

const CARD = 'rounded-[3px] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]'

function updatedAgo(updatedAt: Date | string): string {
  const days = brCalendarDaysBetween(new Date(updatedAt), new Date())
  if (days <= 0) return 'hoje'
  if (days === 1) return 'ontem'
  return `há ${days} dias`
}

export function AnamnesisStep({
  patient,
  whatsappApiEnabled,
  record,
  template,
  updatedByName,
  wizardOverrides,
  readOnly,
  formOpen,
  onOpenForm,
  onSkip,
}: AnamnesisStepProps) {
  if (formOpen) {
    return (
      <AnamnesisForm
        patientId={patient.id}
        record={record}
        currentTemplate={template}
        updatedByName={updatedByName}
        wizardOverrides={wizardOverrides}
        readOnly={readOnly}
      />
    )
  }

  if (record && hasAnamnesisAnswers(record)) {
    const alerts = anamnesisAlerts(record)
    return (
      <section className={CARD} aria-label="Resumo da anamnese">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-sage/10">
              <ClipboardList className="size-4 text-sage" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-charcoal">Anamnese preenchida</p>
              <p className="text-xs text-mid">
                Atualizada {updatedAgo(record.updatedAt)} ({formatBrDate(record.updatedAt)})
                {updatedByName && <> por {updatedByName}</>}
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onOpenForm}>
            {readOnly ? 'Ver respostas' : 'Editar'}
          </Button>
        </div>
        {alerts.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Alertas da anamnese">
            {alerts.map((alert) => (
              <li
                key={alert}
                title={alert}
                className="flex max-w-full items-center gap-1.5 rounded-full border border-amber-mid bg-amber-light px-2.5 py-1 text-xs font-medium text-amber-dark"
              >
                <AlertTriangle className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{alert}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-xs text-mid">Nenhuma alergia, condição de saúde ou gestação registrada.</p>
        )}
      </section>
    )
  }

  if (readOnly) {
    return (
      <section className={CARD}>
        <p className="text-sm text-mid">A anamnese não foi preenchida neste atendimento.</p>
      </section>
    )
  }

  return (
    <section className={CARD} aria-label="Anamnese não preenchida">
      <p className="text-sm font-medium text-charcoal">Anamnese ainda não preenchida</p>
      <p className="mt-1 text-xs text-mid">
        Envie o link para o paciente responder pelo celular, ou preencha agora junto com ele.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {patient.phone && (
          <SendAnamnesisDialog
            patientId={patient.id}
            patientName={patient.fullName}
            patientPhone={patient.phone}
            whatsappApiEnabled={whatsappApiEnabled}
            label="Enviar link por WhatsApp"
            className="min-h-11 sm:min-h-8"
          />
        )}
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" onClick={onOpenForm}>
          Preencher agora
        </Button>
        <Button type="button" variant="ghost" className="min-h-11 text-mid sm:min-h-8" onClick={onSkip}>
          Pular
        </Button>
      </div>
    </section>
  )
}
