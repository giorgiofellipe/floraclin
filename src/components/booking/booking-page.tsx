'use client'

import { useState, useCallback } from 'react'
import { Calendar } from '@/components/ui/calendar'
import { SlotPicker } from '@/components/booking/slot-picker'
import { cn, formatDate } from '@/lib/utils'
import { maskPhone } from '@/lib/masks'
import { ptBR } from 'date-fns/locale'
import { format, addDays, isBefore, startOfDay } from 'date-fns'

interface Practitioner {
  id: string
  name: string
}

interface ClinicInfo {
  name: string
  logoUrl: string | null
  phone: string | null
  email: string | null
}

interface Slot {
  startTime: string
  endTime: string
}

interface BookingPageProps {
  clinic: ClinicInfo
  practitioners: Practitioner[]
  slug: string
}

type Step = 1 | 2 | 3 | 4

const STEP_LABELS = [
  'Profissional',
  'Data e Horário',
  'Seus Dados',
  'Confirmação',
]

function Logo({ clinicName }: { clinicName: string }) {
  return (
    <div className="text-center">
      <div className="font-display text-3xl sm:text-4xl tracking-tight">
        <span className="text-forest font-semibold">Flora</span>
        <span className="text-mint font-medium">Clin</span>
      </div>
      <div className="mt-1.5 flex items-center justify-center gap-2">
        <div className="h-px w-8 bg-blush" />
        <p className="text-mid text-sm font-medium">{clinicName}</p>
        <div className="h-px w-8 bg-blush" />
      </div>
    </div>
  )
}

function Stepper({ currentStep }: { currentStep: Step }) {
  return (
    <div className="flex items-center justify-center gap-0">
      {STEP_LABELS.map((label, index) => {
        const step = (index + 1) as Step
        const isActive = step === currentStep
        const isComplete = step < currentStep

        return (
          <div key={step} className="flex items-center">
            {index > 0 && (
              <div
                className={cn(
                  'w-8 sm:w-12 h-[2px] transition-colors duration-300',
                  isComplete ? 'bg-sage' : 'bg-blush'
                )}
              />
            )}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  'w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs sm:text-sm font-semibold transition-all duration-300',
                  isActive
                    ? 'bg-forest text-cream shadow-md shadow-forest/20 ring-4 ring-forest/10'
                    : isComplete
                      ? 'bg-sage text-cream'
                      : 'bg-blush/80 text-mid'
                )}
              >
                {isComplete ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  step
                )}
              </div>
              <span
                className={cn(
                  'text-[10px] sm:text-xs hidden sm:block transition-colors',
                  isActive ? 'text-forest font-semibold' : isComplete ? 'text-sage font-medium' : 'text-mid'
                )}
              >
                {label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function BookingPage({ clinic, practitioners, slug }: BookingPageProps) {
  const [step, setStep] = useState<Step>(1)
  const [selectedPractitioner, setSelectedPractitioner] = useState<Practitioner | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  const fetchSlots = useCallback(
    async (practitionerId: string, date: Date) => {
      setSlotsLoading(true)
      setSelectedSlot(null)
      try {
        const dateStr = format(date, 'yyyy-MM-dd')
        const res = await fetch(
          `/api/book/${slug}/slots?practitioner_id=${practitionerId}&date=${dateStr}`
        )
        const data = await res.json()
        if (res.ok) {
          setSlots(data.slots ?? [])
        } else {
          setSlots([])
        }
      } catch {
        setSlots([])
      } finally {
        setSlotsLoading(false)
      }
    },
    [slug]
  )

  const handleDateSelect = useCallback(
    (date: Date | undefined) => {
      setSelectedDate(date)
      if (date && selectedPractitioner) {
        fetchSlots(selectedPractitioner.id, date)
      }
    },
    [selectedPractitioner, fetchSlots]
  )

  const handleSubmit = async () => {
    if (!selectedPractitioner || !selectedDate || !selectedSlot) return

    setSubmitting(true)
    setError(null)
    setFieldErrors({})

    try {
      const res = await fetch(`/api/book/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          email: email || undefined,
          practitionerId: selectedPractitioner.id,
          date: format(selectedDate, 'yyyy-MM-dd'),
          startTime: selectedSlot,
        }),
      })

      const data = await res.json()

      if (res.ok) {
        setStep(4)
      } else if (res.status === 400 && data.details) {
        setFieldErrors(data.details)
      } else {
        setError(data.error ?? 'Erro ao realizar agendamento. Tente novamente.')
      }
    } catch {
      setError('Erro de conexão. Verifique sua internet e tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  const canAdvance = () => {
    switch (step) {
      case 1:
        return selectedPractitioner !== null
      case 2:
        return selectedDate !== undefined && selectedSlot !== null
      case 3:
        return name.trim().length >= 2 && phone.trim().length >= 10
      default:
        return false
    }
  }

  const today = startOfDay(new Date())
  const maxDate = addDays(today, 60)

  return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-lg mx-auto px-4 py-8 sm:py-12">
        {/* Header */}
        <div className="mb-10">
          <Logo clinicName={clinic.name} />
        </div>

        {/* Stepper */}
        <div className="mb-10">
          <Stepper currentStep={step} />
        </div>

        {/* Step Content */}
        <div className="bg-white rounded-[3px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] border border-blush/30 p-6 sm:p-8 transition-all duration-300">
          {/* Step 1: Select Practitioner */}
          {step === 1 && (
            <div data-testid="booking-step-1">
              <h2 className="text-xl sm:text-2xl text-charcoal font-medium mb-1">
                Selecione o profissional
              </h2>
              <p className="text-sm text-mid mb-6">
                Escolha o profissional para seu atendimento
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {practitioners.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPractitioner(p)}
                    className={cn(
                      'text-left rounded-[3px] border p-4 transition-all duration-200',
                      'focus:outline-none focus:ring-2 focus:ring-sage/50',
                      selectedPractitioner?.id === p.id
                        ? 'border-forest bg-petal shadow-md shadow-forest/5 scale-[1.02]'
                        : 'border-blush hover:border-sage hover:bg-petal/40 hover:shadow-sm'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'w-11 h-11 rounded-full flex items-center justify-center text-sm font-semibold transition-colors duration-200 shrink-0',
                          selectedPractitioner?.id === p.id
                            ? 'bg-forest text-cream'
                            : 'bg-blush text-forest'
                        )}
                      >
                        {p.name
                          .split(' ')
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join('')
                          .toUpperCase()}
                      </div>
                      <div>
                        <span className="font-medium text-charcoal block">
                          {p.name}
                        </span>
                        {selectedPractitioner?.id === p.id && (
                          <span className="text-xs text-sage font-medium">Selecionado</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
                {practitioners.length === 0 && (
                  <p className="text-center text-mid py-8 text-sm sm:col-span-2">
                    Nenhum profissional disponivel no momento.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Select Date and Time */}
          {step === 2 && (
            <div data-testid="booking-step-2">
              <h2 className="text-xl sm:text-2xl text-charcoal font-medium mb-1">
                Selecione a data e horario
              </h2>
              <p className="text-sm text-mid mb-6">
                Escolha o melhor dia e horario para voce
              </p>

              <div className="flex justify-center mb-6">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={handleDateSelect}
                  locale={ptBR}
                  disabled={(date) =>
                    isBefore(date, today) || date > maxDate
                  }
                  className="rounded-[3px] border border-blush/50"
                />
              </div>

              {selectedDate && (
                <div>
                  <p className="uppercase tracking-wider text-xs text-mid mb-3 font-medium">
                    Horarios disponiveis para {formatDate(selectedDate)}
                  </p>
                  <SlotPicker
                    slots={slots}
                    selectedSlot={selectedSlot}
                    onSelectSlot={setSelectedSlot}
                    loading={slotsLoading}
                  />
                </div>
              )}
            </div>
          )}

          {/* Step 3: Contact Info */}
          {step === 3 && (
            <div data-testid="booking-step-3">
              <h2 className="text-xl sm:text-2xl text-charcoal font-medium mb-1">
                Seus dados
              </h2>
              <p className="text-sm text-mid mb-6">
                Preencha suas informacoes para contato
              </p>

              {error && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="booking-name"
                    className="uppercase tracking-wider text-xs text-mid font-medium block mb-1.5"
                  >
                    Nome *
                  </label>
                  <input
                    id="booking-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Seu nome completo"
                    className={cn(
                      'w-full rounded-lg border px-3 py-2.5 text-sm bg-white transition-colors',
                      'focus:outline-none focus:ring-2 focus:ring-sage/50 focus:border-sage',
                      'placeholder:text-mid/50',
                      fieldErrors.name
                        ? 'border-red-300'
                        : 'border-blush'
                    )}
                  />
                  {fieldErrors.name && (
                    <p className="text-red-600 text-xs mt-1">
                      {fieldErrors.name[0]}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="booking-phone"
                    className="uppercase tracking-wider text-xs text-mid font-medium block mb-1.5"
                  >
                    Telefone *
                  </label>
                  <input
                    id="booking-phone"
                    type="tel"
                    value={maskPhone(phone)}
                    onChange={(e) => setPhone(maskPhone(e.target.value))}
                    placeholder="(11) 99999-9999"
                    className={cn(
                      'w-full rounded-lg border px-3 py-2.5 text-sm bg-white transition-colors',
                      'focus:outline-none focus:ring-2 focus:ring-sage/50 focus:border-sage',
                      'placeholder:text-mid/50',
                      fieldErrors.phone
                        ? 'border-red-300'
                        : 'border-blush'
                    )}
                  />
                  {fieldErrors.phone && (
                    <p className="text-red-600 text-xs mt-1">
                      {fieldErrors.phone[0]}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="booking-email"
                    className="uppercase tracking-wider text-xs text-mid font-medium block mb-1.5"
                  >
                    E-mail{' '}
                    <span className="normal-case tracking-normal text-mid/60">
                      (opcional)
                    </span>
                  </label>
                  <input
                    id="booking-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className={cn(
                      'w-full rounded-lg border px-3 py-2.5 text-sm bg-white transition-colors',
                      'focus:outline-none focus:ring-2 focus:ring-sage/50 focus:border-sage',
                      'placeholder:text-mid/50',
                      fieldErrors.email
                        ? 'border-red-300'
                        : 'border-blush'
                    )}
                  />
                  {fieldErrors.email && (
                    <p className="text-red-600 text-xs mt-1">
                      {fieldErrors.email[0]}
                    </p>
                  )}
                </div>
              </div>

              {/* Summary preview */}
              <div className="mt-6 p-4 rounded-[3px] bg-[#F0F7F1] border border-sage/20">
                <p className="uppercase tracking-wider text-xs text-mid font-medium mb-2">
                  Resumo
                </p>
                <div className="space-y-1 text-sm text-charcoal">
                  <p>
                    <span className="text-mid">Profissional:</span>{' '}
                    {selectedPractitioner?.name}
                  </p>
                  <p>
                    <span className="text-mid">Data:</span>{' '}
                    {selectedDate ? formatDate(selectedDate) : ''}
                  </p>
                  <p>
                    <span className="text-mid">Horário:</span> {selectedSlot}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Confirmation */}
          {step === 4 && (
            <div className="text-center py-8" data-testid="booking-step-4">
              <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-sage/15 flex items-center justify-center animate-[scaleIn_0.5s_ease-out]">
                <div className="w-14 h-14 rounded-full bg-sage/20 flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-sage animate-[checkDraw_0.6s_ease-out_0.3s_both]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              </div>

              <h2 className="text-2xl sm:text-3xl text-charcoal font-medium mb-2 animate-[fadeInUp_0.4s_ease-out_0.4s_both]" data-testid="booking-success">
                Agendamento solicitado!
              </h2>
              <p className="text-mid text-sm mb-8 animate-[fadeInUp_0.4s_ease-out_0.5s_both]">
                Voce recebera uma confirmacao em breve.
              </p>

              <div className="inline-block text-left w-full max-w-sm p-5 rounded-[3px] bg-[#F0F7F1] border border-sage/20 animate-[fadeInUp_0.4s_ease-out_0.6s_both]">
                <p className="uppercase tracking-wider text-[10px] text-mid font-medium mb-3">Resumo do agendamento</p>
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-mid">Profissional</span>
                    <span className="font-medium text-charcoal">
                      {selectedPractitioner?.name}
                    </span>
                  </div>
                  <div className="h-px bg-blush/40" />
                  <div className="flex justify-between items-center">
                    <span className="text-mid">Data</span>
                    <span className="font-medium text-charcoal">
                      {selectedDate ? formatDate(selectedDate) : ''}
                    </span>
                  </div>
                  <div className="h-px bg-blush/40" />
                  <div className="flex justify-between items-center">
                    <span className="text-mid">Horario</span>
                    <span className="font-medium text-charcoal">
                      {selectedSlot}
                    </span>
                  </div>
                  <div className="h-px bg-blush/40" />
                  <div className="flex justify-between items-center">
                    <span className="text-mid">Paciente</span>
                    <span className="font-medium text-charcoal">{name}</span>
                  </div>
                </div>
              </div>

              {clinic.phone && (
                <p className="text-xs text-mid mt-8 animate-[fadeInUp_0.4s_ease-out_0.7s_both]">
                  Duvidas? Entre em contato pelo telefone{' '}
                  <span className="font-medium text-charcoal">{clinic.phone}</span>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        {step < 4 && (
          <div className="mt-6 flex gap-3">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => (s - 1) as Step)}
                className="flex-1 rounded-lg border border-forest/30 text-forest py-3 text-sm font-medium hover:bg-petal hover:border-forest/50 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-sage/50"
              >
                Voltar
              </button>
            )}
            {step < 3 && (
              <button
                type="button"
                onClick={() => setStep((s) => (s + 1) as Step)}
                disabled={!canAdvance()}
                className={cn(
                  'flex-1 rounded-lg py-3 text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-sage/50',
                  canAdvance()
                    ? 'bg-forest text-cream hover:bg-sage shadow-sm hover:shadow-md'
                    : 'bg-blush text-mid cursor-not-allowed'
                )}
              >
                Proximo
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canAdvance() || submitting}
                data-testid="booking-submit"
                className={cn(
                  'flex-1 rounded-lg py-3 text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-sage/50',
                  canAdvance() && !submitting
                    ? 'bg-forest text-cream hover:bg-sage shadow-sm hover:shadow-md'
                    : 'bg-blush text-mid cursor-not-allowed'
                )}
              >
                {submitting ? 'Agendando...' : 'Confirmar agendamento'}
              </button>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-10 text-center">
          <p className="text-[11px] text-gold">
            Powered by{' '}
            <span className="font-display text-sm">
              <span className="text-gold">Flora</span>
              <span className="text-gold/70">Clin</span>
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}
