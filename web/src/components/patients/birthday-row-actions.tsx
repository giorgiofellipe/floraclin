'use client'

import { Check, ExternalLink, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  useBirthdayTemplate,
  useSendBirthdayMessage,
  useToggleGreeting,
} from '@/hooks/queries/use-birthdays'
import { useTenant } from '@/hooks/queries/use-tenant'

/** Strip non-digit chars and prepend the BR country code if absent. */
function phoneToWhatsappDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.startsWith('55') ? digits : `55${digits}`
}

/** First word of the full name, sentence-cased — used in the WhatsApp template. */
function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? fullName
  return first
}

interface BirthdayRowActionsProps {
  patientId: string
  patientFullName: string
  patientPhone: string | null
  greetedAt: string | null
  year: number
  /** Compact icon-only layout for dense cards. */
  size?: 'sm' | 'default'
}

/**
 * Three-action set shared by the dashboard widget and the full Aniversariantes
 * page:
 *
 *  1. **Enviar mensagem** — sends the tenant's birthday-greeting template
 *     through the WhatsApp Cloud API and auto-marks the patient as greeted.
 *     Only enabled when WhatsApp is configured AND a template with
 *     `purposeKey = 'birthday_greeting'` exists with status APPROVED.
 *
 *  2. **Abrir no WhatsApp Web** — opens https://wa.me/<digits> in a new tab so
 *     the user can talk to the patient outside of FloraClin. No API call.
 *
 *  3. **Parabenizar** — flips `/api/birthdays/[id]/greeting` POST/DELETE
 *     manually, for cases where the user greeted by another channel.
 */
export function BirthdayRowActions({
  patientId,
  patientFullName,
  patientPhone,
  greetedAt,
  year,
  size = 'default',
}: BirthdayRowActionsProps) {
  const toggleGreeting = useToggleGreeting()
  const sendBirthday = useSendBirthdayMessage()
  const { data: template } = useBirthdayTemplate()
  const { data: tenantData } = useTenant()

  const greeted = greetedAt != null
  const hasPhone = !!(patientPhone && patientPhone.trim())
  const waHref = hasPhone
    ? `https://wa.me/${phoneToWhatsappDigits(patientPhone!)}`
    : undefined

  const tenantName: string =
    (tenantData?.data?.name as string | undefined) ??
    (tenantData?.name as string | undefined) ??
    'nossa clínica'

  const canSendTemplate =
    !!template && template.status === 'APPROVED' && hasPhone && !sendBirthday.isPending

  async function handleSendMessage() {
    if (!template) return
    try {
      // Build params keyed by template variable index — matches the existing
      // POST /api/whatsapp/conversations contract (`params: Record<string, string>`).
      // Variable mapping from the blueprint has stable `key` values
      // (patient_name, clinic_name); fall back to position-based keys if the
      // mapping is missing.
      const valueByKey: Record<string, string> = {
        patient_name: firstName(patientFullName),
        clinic_name: tenantName,
      }
      const params: Record<string, string> = {}
      const mapping = template.variableMapping ?? [
        { index: 1, key: 'patient_name', label: '' },
        { index: 2, key: 'clinic_name', label: '' },
      ]
      for (const v of mapping) {
        params[String(v.index)] = valueByKey[v.key] ?? ''
      }

      await sendBirthday.mutateAsync({
        patientId,
        templateName: template.name,
        language: template.language,
        params,
      })

      // Auto-mark as greeted on successful send.
      if (!greeted) {
        try {
          await toggleGreeting.mutateAsync({ patientId, year, greeted: true })
        } catch {
          // Don't block success feedback on the secondary toggle failing.
        }
      }
      toast.success('Mensagem de aniversário enviada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao enviar mensagem')
    }
  }

  async function handleToggle() {
    try {
      await toggleGreeting.mutateAsync({
        patientId,
        year,
        greeted: !greeted,
      })
      toast.success(greeted ? 'Parabéns desmarcado' : 'Marcado como parabenizado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar')
    }
  }

  const btnSize = size === 'sm' ? 'icon-sm' : 'sm'
  const iconClass = size === 'sm' ? 'size-3.5' : 'size-4'

  const sendButton = (
    <Button
      type="button"
      variant="default"
      size={btnSize}
      disabled={!canSendTemplate}
      onClick={handleSendMessage}
      title={
        !template
          ? 'Modelo de aniversário indisponível ou WhatsApp desativado'
          : template.status !== 'APPROVED'
            ? `Modelo aguardando aprovação no WhatsApp (${template.status})`
            : !hasPhone
              ? 'Paciente sem telefone cadastrado'
              : 'Enviar mensagem de aniversário via WhatsApp'
      }
      className="bg-[#25D366] text-white hover:bg-[#1DA851] disabled:opacity-50"
    >
      <Send className={iconClass} />
      {size === 'default' && <span>Enviar mensagem</span>}
    </Button>
  )

  const waButton = waHref ? (
    <a
      href={waHref}
      target="_blank"
      rel="noopener noreferrer"
      title="Abrir conversa no WhatsApp Web"
      className={cn(
        'inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-background text-sm font-medium transition-colors hover:bg-muted hover:text-foreground',
        size === 'sm'
          ? 'h-7 w-7 rounded-[12px]'
          : 'h-7 gap-1 px-2.5 text-[0.8rem]'
      )}
    >
      <ExternalLink className={cn(iconClass, 'text-[#25D366]')} />
      {size === 'default' && <span>Abrir no WhatsApp Web</span>}
    </a>
  ) : (
    <Button
      type="button"
      variant="outline"
      size={btnSize}
      disabled
      title="Paciente sem telefone cadastrado"
    >
      <ExternalLink className={cn(iconClass, 'text-mid')} />
      {size === 'default' && <span>Abrir no WhatsApp Web</span>}
    </Button>
  )

  return (
    <div className="flex items-center gap-2">
      {sendButton}
      {waButton}

      <Button
        type="button"
        variant={greeted ? 'secondary' : 'outline'}
        size={btnSize}
        disabled={toggleGreeting.isPending}
        onClick={handleToggle}
        title={greeted ? 'Desmarcar como parabenizado' : 'Marcar como parabenizado'}
      >
        <Check
          className={cn(
            iconClass,
            greeted ? 'text-sage' : 'text-mid'
          )}
        />
        {size === 'default' && (
          <span>{greeted ? 'Parabenizado' : 'Parabenizar'}</span>
        )}
      </Button>
    </div>
  )
}
