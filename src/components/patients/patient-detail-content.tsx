'use client'

import Link from 'next/link'
import { ArrowLeft, Plus, CalendarPlus, Receipt, Phone, User } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn, maskCPF } from '@/lib/utils'
import { PatientTabs, type PatientTabKey } from './patient-tabs'
import { PatientDataTab } from './patient-data-tab'
import { PatientAnamnesisTab } from './patient-anamnesis-tab'
import { PatientProceduresTab } from './patient-procedures-tab'
import { PatientPhotosTab } from './patient-photos-tab'
import { PatientConsentTab } from './patient-consent-tab'
import { PatientFinancialTab } from './patient-financial-tab'
import { PatientTimelineTab } from './patient-timeline-tab'
import type { Patient } from '@/db/queries/patients'

// ─── Helpers ────────────────────────────────────────────────────────

function calculateAge(birthDate: string): number {
  const today = new Date()
  const birth = new Date(birthDate)
  let age = today.getFullYear() - birth.getFullYear()
  const monthDiff = today.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--
  }
  return age
}

const GENDER_LABELS: Record<string, string> = {
  feminino: 'Feminino',
  masculino: 'Masculino',
  outro: 'Outro',
  nao_informado: 'Nao informado',
}

const VALID_TABS: PatientTabKey[] = [
  'dados',
  'anamnese',
  'procedimentos',
  'fotos',
  'termos',
  'financeiro',
  'timeline',
]

// ─── Component ──────────────────────────────────────────────────────

interface PatientDetailContentProps {
  patient: Patient
  activeTab?: string
}

export function PatientDetailContent({
  patient,
  activeTab,
}: PatientDetailContentProps) {
  const tab: PatientTabKey = VALID_TABS.includes(activeTab as PatientTabKey)
    ? (activeTab as PatientTabKey)
    : 'dados'

  const age = patient.birthDate ? calculateAge(patient.birthDate) : null

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/pacientes"
        className="inline-flex items-center gap-1 text-sm text-mid hover:text-charcoal transition-colors"
      >
        <ArrowLeft className="size-4" />
        Voltar para lista
      </Link>

      {/* Patient header */}
      <div className="rounded-lg border bg-white p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <h1 className="font-display text-2xl text-forest">{patient.fullName}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-mid">
              {age !== null && (
                <span className="flex items-center gap-1">
                  <User className="size-3.5" />
                  {age} anos
                </span>
              )}
              {patient.gender && (
                <span>{GENDER_LABELS[patient.gender] ?? patient.gender}</span>
              )}
              <span className="flex items-center gap-1">
                <Phone className="size-3.5" />
                {patient.phone}
              </span>
              {patient.cpf && (
                <span>CPF: {maskCPF(patient.cpf)}</span>
              )}
            </div>
          </div>

          {/* Quick action buttons */}
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/pacientes/${patient.id}/procedimentos/novo`}
              className={cn(buttonVariants({ size: 'sm' }))}
            >
              <Plus className="size-4 mr-1" />
              Novo Procedimento
            </Link>
            <Link
              href={`/agenda?paciente=${patient.id}`}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              <CalendarPlus className="size-4 mr-1" />
              Novo Agendamento
            </Link>
            <Link
              href={`/pacientes/${patient.id}?tab=financeiro`}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              <Receipt className="size-4 mr-1" />
              Nova Cobranca
            </Link>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <PatientTabs activeTab={tab} />

      {/* Tab content */}
      <div className="min-h-[400px]">
        {tab === 'dados' && <PatientDataTab patient={patient} />}
        {tab === 'anamnese' && <PatientAnamnesisTab patientId={patient.id} />}
        {tab === 'procedimentos' && (
          <PatientProceduresTab patientId={patient.id} />
        )}
        {tab === 'fotos' && <PatientPhotosTab patientId={patient.id} />}
        {tab === 'termos' && <PatientConsentTab patientId={patient.id} />}
        {tab === 'financeiro' && (
          <PatientFinancialTab
            patientId={patient.id}
            patientName={patient.fullName}
          />
        )}
        {tab === 'timeline' && (
          <PatientTimelineTab patientId={patient.id} />
        )}
      </div>
    </div>
  )
}
