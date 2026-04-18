'use client'

import { useState, useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  CalendarPlus,
  Receipt,
  Phone,
  Mail,
  MapPin,
  Cake,
} from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn, maskCPF } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { PatientTabs, type PatientTabKey } from './patient-tabs'
import { PatientDataTab } from './patient-data-tab'
import { PatientAnamnesisTab } from './patient-anamnesis-tab'
import { PatientProceduresTab } from './patient-procedures-tab'
import { PatientPhotosTab } from './patient-photos-tab'
import { PatientConsentTab } from './patient-consent-tab'
import { PatientFinancialTab } from './patient-financial-tab'
import { PatientTimelineTab } from './patient-timeline-tab'
import { PaymentForm } from '@/components/financial/payment-form'
import { AppointmentForm } from '@/components/scheduling/appointment-form'
import { usePractitioners, useAppointmentProcedureTypes } from '@/hooks/queries/use-appointments'
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

function formatBirthDate(birthDate: string): string {
  const date = new Date(birthDate + 'T12:00:00')
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/** Strip non-digit chars to build tel: / whatsapp links */
function phoneToDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  // If it doesn't start with country code, assume Brazil (+55)
  return digits.startsWith('55') ? digits : `55${digits}`
}

const GENDER_LABELS: Record<string, string> = {
  feminino: 'Feminino',
  masculino: 'Masculino',
  outro: 'Outro',
  nao_informado: 'Não informado',
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
  hasActiveService?: boolean
}

export function PatientDetailContent({
  patient,
  activeTab,
  hasActiveService = false,
}: PatientDetailContentProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [showAppointmentForm, setShowAppointmentForm] = useState(false)
  const { data: practitioners = [] } = usePractitioners()
  const { data: procedureTypes = [] } = useAppointmentProcedureTypes()

  const [tab, setTabState] = useState<PatientTabKey>(
    VALID_TABS.includes(activeTab as PatientTabKey)
      ? (activeTab as PatientTabKey)
      : 'dados'
  )

  const setTab = useCallback((newTab: PatientTabKey) => {
    setTabState(newTab)
    const params = new URLSearchParams(searchParams.toString())
    if (newTab === 'dados') {
      params.delete('tab')
    } else {
      params.set('tab', newTab)
    }
    const qs = params.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
  }, [router, pathname, searchParams])

  const age = patient.birthDate ? calculateAge(patient.birthDate) : null

  function getInitials(name: string) {
    const parts = name.trim().split(/\s+/)
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
  }

  return (
    <div className="space-y-5">
      {/* Back link */}
      <Link
        href="/pacientes"
        className="inline-flex items-center gap-1.5 text-[13px] text-mid hover:text-forest transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        Voltar para lista
      </Link>

      {/* Patient header card */}
      <div className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        {/* Top accent line */}
        <div className="h-[2px] bg-gradient-to-r from-forest via-sage to-mint" />

        <div className="p-6 sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            {/* Left: avatar + info */}
            <div className="flex items-start gap-5">
              {/* Avatar */}
              <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-sage/15 text-xl font-semibold text-sage">
                {getInitials(patient.fullName)}
              </div>

              <div className="space-y-2.5 min-w-0">
                {/* Name + gender */}
                <div>
                  <h1 className="text-[22px] font-semibold text-charcoal leading-tight truncate">
                    {patient.fullName}
                  </h1>
                  {patient.gender && (
                    <p className="text-[13px] text-mid mt-0.5">
                      {GENDER_LABELS[patient.gender] ?? patient.gender}
                    </p>
                  )}
                </div>

                {/* Details row */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-mid">
                  {age !== null && patient.birthDate && (
                    <span className="inline-flex items-center gap-1.5">
                      <Cake className="size-3.5 text-sage" />
                      {age} anos
                      <span className="text-mid/40">({formatBirthDate(patient.birthDate)})</span>
                    </span>
                  )}
                  <Popover>
                    <PopoverTrigger className="inline-flex items-center gap-1.5 cursor-pointer hover:text-forest transition-colors rounded-md px-1 -mx-1 py-0.5">
                      <Phone className="size-3.5 text-sage" />
                      {patient.phone}
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-1.5" align="start">
                      <div className="flex flex-col gap-0.5">
                        <a
                          href={`tel:+${phoneToDigits(patient.phone)}`}
                          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-charcoal hover:bg-[#F4F6F8] transition-colors"
                        >
                          <Phone className="size-3.5 text-sage" />
                          Ligar
                        </a>
                        <a
                          href={`https://wa.me/${phoneToDigits(patient.phone)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-charcoal hover:bg-[#F4F6F8] transition-colors"
                        >
                          <svg className="size-3.5 text-[#25D366]" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                          WhatsApp
                        </a>
                      </div>
                    </PopoverContent>
                  </Popover>
                  {patient.email && (
                    <a
                      href={`mailto:${patient.email}`}
                      className="inline-flex items-center gap-1.5 hover:text-forest transition-colors rounded-md px-1 -mx-1 py-0.5"
                    >
                      <Mail className="size-3.5 text-sage" />
                      {patient.email}
                    </a>
                  )}
                  {patient.cpf && (
                    <span className="inline-flex items-center gap-1.5 font-mono text-[12px]">
                      {maskCPF(patient.cpf)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Right: actions */}
            <div className="flex items-center gap-2 shrink-0">
              <TooltipProvider delay={300}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="outline"
                        size="icon-sm"
                        className="border-sage/20 text-sage hover:bg-sage/5 transition-colors size-10 rounded-xl"
                        onClick={() => setShowAppointmentForm(true)}
                      >
                        <CalendarPlus className="size-4" />
                      </Button>
                    }
                  />
                  <TooltipContent side="bottom"><p>Novo Agendamento</p></TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="outline"
                        size="icon-sm"
                        className="border-sage/20 text-sage hover:bg-sage/5 transition-colors size-10 rounded-xl"
                        onClick={() => setShowPaymentForm(true)}
                      >
                        <Receipt className="size-4" />
                      </Button>
                    }
                  />
                  <TooltipContent side="bottom"><p>Nova Cobrança</p></TooltipContent>
                </Tooltip>

              </TooltipProvider>

              <Link
                href={`/pacientes/${patient.id}/atendimento`}
                className={cn(
                  buttonVariants({ size: 'default' }),
                  'bg-forest text-cream hover:bg-sage transition-all duration-200 rounded-xl px-5 py-2.5 text-[13px] font-semibold gap-2 min-h-[42px] shadow-sm hover:shadow-md',
                )}
              >
                {hasActiveService ? 'Continuar Atendimento' : 'Iniciar Atendimento'}
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <PatientTabs activeTab={tab} onTabChange={setTab} />

      {/* Tab content */}
      <div className="min-h-[400px]">
        <div className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6">
          {tab === 'dados' && <PatientDataTab patient={patient} />}
          {tab === 'anamnese' && <PatientAnamnesisTab patientId={patient.id} patientName={patient.fullName} patientPhone={patient.phone} />}
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

      <PaymentForm
        open={showPaymentForm}
        onClose={() => setShowPaymentForm(false)}
        defaultPatient={patient}
        onSuccess={() => {
          setShowPaymentForm(false)
          setTab('financeiro')
        }}
      />

      <AppointmentForm
        open={showAppointmentForm}
        onOpenChange={setShowAppointmentForm}
        practitioners={practitioners}
        procedureTypes={procedureTypes}
        defaultPatient={patient}
        onSaved={() => {
          setShowAppointmentForm(false)
        }}
      />
    </div>
  )
}
