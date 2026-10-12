'use client'

import { Loader2 } from 'lucide-react'
import { AnamnesisForm } from '@/components/anamnesis/anamnesis-form'
import { SendAnamnesisDialog } from '@/components/patients/send-anamnesis-dialog'
import { useAnamnesis, useAnamnesisTemplate } from '@/hooks/queries/use-anamnesis'

interface PatientAnamnesisTabProps {
  patientId: string
  patientName?: string
  patientPhone?: string | null
  whatsappApiEnabled?: boolean
}

export function PatientAnamnesisTab({ patientId, patientName, patientPhone, whatsappApiEnabled }: PatientAnamnesisTabProps) {
  const { data: record, isLoading: recordLoading } = useAnamnesis(patientId)
  const { data: template, isLoading: templateLoading, isError: templateError } = useAnamnesisTemplate()

  if (recordLoading || templateLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-mid" />
        <span className="ml-2 text-sm text-mid">Carregando anamnese...</span>
      </div>
    )
  }

  if (templateError || !template) {
    return <div className="py-12 text-center text-sm text-mid">Erro ao carregar a anamnese.</div>
  }

  return (
    <div className="w-full">
      {/* Send anamnesis link to patient */}
      {patientName && (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-mid">
            Envie o link para o paciente preencher a anamnese pelo celular.
          </p>
          <SendAnamnesisDialog
            patientId={patientId}
            patientName={patientName}
            patientPhone={patientPhone ?? undefined}
            whatsappApiEnabled={whatsappApiEnabled}
          />
        </div>
      )}

      <AnamnesisForm
        patientId={patientId}
        record={record ?? null}
        currentTemplate={template}
      />
    </div>
  )
}
