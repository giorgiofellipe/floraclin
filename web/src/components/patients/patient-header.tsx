'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  Cake,
  ExternalLink,
  FileQuestion,
  FileText,
  MessageCircle,
  MessageSquarePlus,
  Mail,
  MoreHorizontal,
  Phone,
  Plus,
  Receipt,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ReadOnlyGuard, useReadOnly, useWriteGuard } from '@/components/layout/subscription-access'
import { cn, maskCPF } from '@/lib/utils'
import { GENDER_LABELS } from '@/lib/constants'
import { parseLocalDate } from '@/lib/dates'
import { formatBrPhone, toWaMeUrl, tryNormalizeBrPhoneForWhatsApp } from '@/lib/phone'
import type { Patient } from '@/db/queries/patients'
import type { Role } from '@/types'

function calculateAge(birthDate: string): number {
  const today = new Date()
  const birth = parseLocalDate(birthDate, '12:00:00')
  let age = today.getFullYear() - birth.getFullYear()
  const monthDiff = today.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--
  }
  return age
}

function formatBirthDate(birthDate: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(parseLocalDate(birthDate, '12:00:00'))
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

const ICON_BUTTON =
  'border-sage/20 text-sage hover:bg-sage/5 transition-colors size-10 rounded-xl'
const START_BUTTON =
  'bg-forest text-cream hover:bg-sage transition-all duration-200 rounded-xl px-5 py-2.5 text-[13px] font-semibold gap-2 min-h-[42px] shadow-sm hover:shadow-md'

interface PatientHeaderProps {
  patient: Patient
  role: Role
  hasActiveService: boolean
  whatsappApiEnabled?: boolean
  onNewAppointment: () => void
  onNewCharge: () => void
  onNewDocument: () => void
  onRequestDocuments: () => void
}

export function PatientHeader({
  patient,
  role,
  hasActiveService,
  whatsappApiEnabled,
  onNewAppointment,
  onNewCharge,
  onNewDocument,
  onRequestDocuments,
}: PatientHeaderProps) {
  const router = useRouter()
  const readOnly = useReadOnly()
  const guardWrite = useWriteGuard()
  const [openingWhatsapp, setOpeningWhatsapp] = useState(false)

  const age = patient.birthDate ? calculateAge(patient.birthDate) : null
  const normalizedPhone = tryNormalizeBrPhoneForWhatsApp(patient.phone)
  const telHref = normalizedPhone.ok
    ? `tel:+${normalizedPhone.phone}`
    : `tel:${patient.phone.replace(/\D/g, '')}`
  const waHref = toWaMeUrl(patient.phone)
  const canUseInAppWhatsapp = Boolean(whatsappApiEnabled && normalizedPhone.ok)
  const canWriteDiagrams = role === 'owner' || role === 'practitioner'
  const startLabel = hasActiveService ? 'Continuar Atendimento' : 'Iniciar Atendimento'
  const newDiagramHref = `/pacientes/${patient.id}/diagramas/novo`

  async function handleOpenWhatsapp() {
    setOpeningWhatsapp(true)
    try {
      const res = await fetch('/api/whatsapp/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId: patient.id }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao abrir conversa' }))
        throw new Error(err.error || 'Erro ao abrir conversa')
      }
      const data = await res.json()
      router.push(`/whatsapp?conversa=${data.data.conversation.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao abrir conversa')
    } finally {
      setOpeningWhatsapp(false)
    }
  }

  const startLink = (
    <ReadOnlyGuard label={startLabel}>
      <Link
        href={`/pacientes/${patient.id}/atendimento`}
        className={cn(buttonVariants({ size: 'default' }), START_BUTTON)}
      >
        {startLabel}
        <ArrowRight className="size-4" />
      </Link>
    </ReadOnlyGuard>
  )

  function whatsappControl(className: string, content: React.ReactNode) {
    if (canUseInAppWhatsapp) {
      return (
        <Button
          type="button"
          variant="outline"
          className={className}
          aria-label="WhatsApp"
          disabled={openingWhatsapp}
          onClick={guardWrite(handleOpenWhatsapp)}
        >
          {content}
        </Button>
      )
    }
    if (waHref) {
      return (
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="WhatsApp"
          className={cn(buttonVariants({ variant: 'outline' }), className)}
        >
          {content}
        </a>
      )
    }
    return null
  }

  const desktopWhatsapp = whatsappControl(
    'border-sage/20 text-sage hover:bg-sage/5 rounded-xl h-10 gap-2 text-[13px]',
    <>
      <MessageCircle className="size-4" />
      WhatsApp
    </>,
  )
  const mobileWhatsapp = whatsappControl(
    `${ICON_BUTTON} shrink-0`,
    <MessageCircle className="size-4" />,
  )

  const newDiagramButton = canWriteDiagrams && (
    <ReadOnlyGuard label="Novo diagrama">
      <Link
        href={newDiagramHref}
        className={cn(
          buttonVariants({ variant: 'outline' }),
          'border-sage/20 text-sage hover:bg-sage/5 rounded-xl h-10 gap-2 text-[13px]',
        )}
      >
        <Plus className="size-4" />
        Novo diagrama
      </Link>
    </ReadOnlyGuard>
  )

  function iconAction(label: string, icon: React.ReactNode, onClick: () => void) {
    if (readOnly && label === 'Novo Agendamento') {
      return (
        <ReadOnlyGuard label={label}>
          <Button variant="outline" size="icon-sm" aria-label={label} className={ICON_BUTTON}>
            {icon}
          </Button>
        </ReadOnlyGuard>
      )
    }
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={label}
              className={ICON_BUTTON}
              onClick={label === 'Novo Agendamento' ? onClick : guardWrite(onClick)}
            >
              {icon}
            </Button>
          }
        />
        <TooltipContent side="bottom">
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  const phoneItemClass =
    'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-charcoal hover:bg-[#F4F6F8] transition-colors'

  return (
    <div className="space-y-5">
      <Link
        href="/pacientes"
        className="inline-flex items-center gap-1.5 text-[13px] text-mid hover:text-forest transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        Voltar para lista
      </Link>

      <div
        data-testid="patient-header-desktop"
        className="hidden md:block rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden"
      >
        <div className="h-[2px] bg-gradient-to-r from-forest via-sage to-mint" />
        <div className="p-6 sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-5">
              <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-sage/15 text-xl font-semibold text-sage">
                {getInitials(patient.fullName)}
              </div>

              <div className="space-y-2.5 min-w-0">
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
                      {formatBrPhone(patient.phone)}
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-1.5" align="start">
                      <div className="flex flex-col gap-0.5">
                        <a href={telHref} className={phoneItemClass}>
                          <Phone className="size-3.5 text-sage" />
                          Ligar
                        </a>
                        {canUseInAppWhatsapp && (
                          <>
                            <button
                              type="button"
                              className={phoneItemClass}
                              onClick={guardWrite(handleOpenWhatsapp)}
                              disabled={openingWhatsapp}
                            >
                              <MessageSquarePlus className="size-3.5 text-[#25D366]" />
                              {openingWhatsapp ? 'Abrindo...' : 'Iniciar conversa'}
                            </button>
                            <button
                              type="button"
                              data-testid="request-documents"
                              className={phoneItemClass}
                              onClick={guardWrite(onRequestDocuments)}
                            >
                              <FileQuestion className="size-3.5 text-[#25D366]" />
                              Solicitar documentos
                            </button>
                          </>
                        )}
                        {waHref && (
                          <a
                            href={waHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={phoneItemClass}
                          >
                            <ExternalLink className="size-3.5 text-[#25D366]" />
                            Abrir no WhatsApp Web
                          </a>
                        )}
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

            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
              <TooltipProvider delay={300}>
                {desktopWhatsapp}
                {iconAction('Novo Agendamento', <CalendarPlus className="size-4" />, onNewAppointment)}
                {iconAction('Nova Cobrança', <Receipt className="size-4" />, onNewCharge)}
                {iconAction('Novo Documento', <FileText className="size-4" />, onNewDocument)}
              </TooltipProvider>
              {newDiagramButton}
              {startLink}
            </div>
          </div>
        </div>
      </div>

      <div
        data-testid="patient-header-mobile"
        className="md:hidden rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden"
      >
        <div className="h-[2px] bg-gradient-to-r from-forest via-sage to-mint" />
        <div className="space-y-4 p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-sage/15 text-base font-semibold text-sage">
              {getInitials(patient.fullName)}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold leading-tight text-charcoal">
                {patient.fullName}
              </h1>
              <p className="text-[13px] text-mid">
                {[age !== null ? `${age} anos` : null, formatBrPhone(patient.phone)]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </div>

          <div className="flex items-start justify-between gap-2">
            {mobileWhatsapp && (
              <div className="flex flex-1 flex-col items-center gap-1 text-[11px] text-mid">
                {mobileWhatsapp}
                <span aria-hidden>WhatsApp</span>
              </div>
            )}
            <div className="flex flex-1 flex-col items-center gap-1 text-[11px] text-mid">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Agendar"
                className={ICON_BUTTON}
                onClick={guardWrite(onNewAppointment)}
              >
                <CalendarPlus className="size-4" />
              </Button>
              <span aria-hidden>Agendar</span>
            </div>
            <div className="flex flex-1 flex-col items-center gap-1 text-[11px] text-mid">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Cobrar"
                className={ICON_BUTTON}
                onClick={guardWrite(onNewCharge)}
              >
                <Receipt className="size-4" />
              </Button>
              <span aria-hidden>Cobrar</span>
            </div>
            <div className="flex flex-1 flex-col items-center gap-1 text-[11px] text-mid">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label="Mais"
                      className={ICON_BUTTON}
                    />
                  }
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {canWriteDiagrams && (
                    <DropdownMenuItem render={<Link href={newDiagramHref} />}>
                      <Plus className="size-4" />
                      Novo diagrama
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={guardWrite(onNewDocument)}>
                    <FileText className="size-4" />
                    Novo documento
                  </DropdownMenuItem>
                  <DropdownMenuItem render={<a href={telHref} />}>
                    <Phone className="size-4" />
                    Ligar
                  </DropdownMenuItem>
                  {canUseInAppWhatsapp && (
                    <DropdownMenuItem onClick={guardWrite(onRequestDocuments)}>
                      <FileQuestion className="size-4" />
                      Solicitar documentos
                    </DropdownMenuItem>
                  )}
                  {waHref && (
                    <DropdownMenuItem
                      render={<a href={waHref} target="_blank" rel="noopener noreferrer" />}
                    >
                      <ExternalLink className="size-4" />
                      Abrir no WhatsApp Web
                    </DropdownMenuItem>
                  )}
                  {patient.email && (
                    <DropdownMenuItem render={<a href={`mailto:${patient.email}`} />}>
                      <Mail className="size-4" />
                      Email
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <span aria-hidden>Mais</span>
            </div>
          </div>

          <div className="[&>*]:w-full [&_a]:w-full [&_a]:justify-center">{startLink}</div>
        </div>
      </div>
    </div>
  )
}
