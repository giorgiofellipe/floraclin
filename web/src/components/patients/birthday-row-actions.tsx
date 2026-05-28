'use client'

import { Check, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToggleGreeting } from '@/hooks/queries/use-birthdays'

/** Strip non-digit chars and prepend the BR country code if absent. */
function phoneToWhatsappDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.startsWith('55') ? digits : `55${digits}`
}

interface BirthdayRowActionsProps {
  patientId: string
  patientPhone: string | null
  greetedAt: string | null
  year: number
  /** Compact icon-only layout for dense cards. */
  size?: 'sm' | 'default'
}

/**
 * Action pair shared by the dashboard widget and the full Aniversariantes page.
 * Renders a WhatsApp button (links to https://wa.me/<digits>) and a "greeted"
 * toggle that flips `/api/birthdays/[patientId]/greeting` POST/DELETE.
 *
 * The WhatsApp button uses wa.me (no API call, no conversation lookup) — matches
 * the pattern in `patient-detail-content.tsx` for sending an ad-hoc message.
 */
export function BirthdayRowActions({
  patientId,
  patientPhone,
  greetedAt,
  year,
  size = 'default',
}: BirthdayRowActionsProps) {
  const toggleGreeting = useToggleGreeting()
  const greeted = greetedAt != null

  const hasPhone = !!(patientPhone && patientPhone.trim())
  const waHref = hasPhone
    ? `https://wa.me/${phoneToWhatsappDigits(patientPhone!)}`
    : undefined

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

  const waButton = waHref ? (
    <a
      href={waHref}
      target="_blank"
      rel="noopener noreferrer"
      title="Abrir conversa no WhatsApp"
      className={cn(
        'inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-background text-sm font-medium transition-colors hover:bg-muted hover:text-foreground',
        size === 'sm'
          ? 'h-7 w-7 rounded-[12px]'
          : 'h-7 gap-1 px-2.5 text-[0.8rem]'
      )}
    >
      <MessageSquare className={cn(iconClass, 'text-[#25D366]')} />
      {size === 'default' && <span>WhatsApp</span>}
    </a>
  ) : (
    <Button
      type="button"
      variant="outline"
      size={btnSize}
      disabled
      title="Paciente sem telefone cadastrado"
    >
      <MessageSquare className={cn(iconClass, 'text-mid')} />
      {size === 'default' && <span>WhatsApp</span>}
    </Button>
  )

  return (
    <div className="flex items-center gap-2">
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
