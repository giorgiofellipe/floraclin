'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card } from '@/components/ui/card'
import { updateBookingSettingsAction } from '@/actions/tenants'
import { toast } from 'sonner'
import { CopyIcon, CheckIcon, ExternalLinkIcon } from 'lucide-react'

interface BookingSettingsProps {
  slug: string
  publicBookingEnabled: boolean
  /** When embedded in onboarding wizard, hides the save button and exposes data via onChange */
  embedded?: boolean
  onChange?: (data: { publicBookingEnabled: boolean }) => void
}

export function BookingSettings({
  slug,
  publicBookingEnabled: initialEnabled,
  embedded = false,
  onChange,
}: BookingSettingsProps) {
  const [isPending, startTransition] = useTransition()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [copied, setCopied] = useState(false)

  const appUrl = typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL || ''
  const bookingUrl = `${appUrl}/c/${slug}`

  function handleToggle(checked: boolean) {
    setEnabled(checked)

    if (embedded) {
      onChange?.({ publicBookingEnabled: checked })
      return
    }

    startTransition(async () => {
      const result = await updateBookingSettingsAction({
        publicBookingEnabled: checked,
      })
      if (result?.success) {
        toast.success(
          checked
            ? 'Agendamento online ativado'
            : 'Agendamento online desativado'
        )
      } else {
        setEnabled(!checked) // revert
        toast.error(result?.error || 'Erro ao atualizar configurações')
      }
    })
  }

  async function handleCopyUrl() {
    try {
      await navigator.clipboard.writeText(bookingUrl)
      setCopied(true)
      toast.success('Link copiado')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Erro ao copiar link')
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-foreground">Agendamento Online</h3>
        <p className="text-sm text-muted-foreground">
          Permita que pacientes agendem consultas diretamente pela internet através de um link
          exclusivo da sua clínica.
        </p>
      </div>

      <div className="flex items-center gap-4 rounded-lg border p-4">
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={isPending}
        />
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">
            {enabled ? 'Agendamento online ativado' : 'Agendamento online desativado'}
          </Label>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? 'Pacientes podem agendar pela página pública da clínica.'
              : 'Apenas agendamentos internos são permitidos.'}
          </p>
        </div>
      </div>

      {enabled && (
        <div className="space-y-3">
          <Label>Link de Agendamento</Label>
          <div className="flex items-center gap-2">
            <Input
              value={bookingUrl}
              readOnly
              className="font-mono text-sm"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopyUrl}
              title="Copiar link"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => window.open(bookingUrl, '_blank')}
              title="Abrir página"
            >
              <ExternalLinkIcon />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Compartilhe este link com seus pacientes para que possam agendar online.
            O slug &ldquo;{slug}&rdquo; foi definido durante a criação da clínica e não pode ser alterado.
          </p>
        </div>
      )}
    </div>
  )
}
