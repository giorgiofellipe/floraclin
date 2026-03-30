'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card } from '@/components/ui/card'
import { useUpdateBookingSettings } from '@/hooks/mutations/use-tenant-mutations'
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
  const updateBookingSettings = useUpdateBookingSettings()
  const isPending = updateBookingSettings.isPending
  const [enabled, setEnabled] = useState(initialEnabled)
  const [copied, setCopied] = useState(false)

  const appUrl = typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL || ''
  const bookingUrl = `${appUrl}/c/${slug}`

  async function handleToggle(checked: boolean) {
    setEnabled(checked)

    if (embedded) {
      onChange?.({ publicBookingEnabled: checked })
      return
    }

    try {
      await updateBookingSettings.mutateAsync({ publicBookingEnabled: checked })
      toast.success(
        checked
          ? 'Agendamento online ativado'
          : 'Agendamento online desativado'
      )
    } catch (err) {
      setEnabled(!checked) // revert
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar configurações')
    }
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
      <div className="space-y-2">
        <p className="text-sm text-mid">
          Permita que pacientes agendem consultas diretamente pela internet atraves de um link
          exclusivo da sua clínica.
        </p>
      </div>

      <div className="flex items-center gap-4 rounded-[3px] border border-[#E8ECEF] bg-white p-4 transition-colors">
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={isPending}
        />
        <div className="space-y-0.5">
          <Label className="text-sm font-medium text-charcoal">
            {enabled ? 'Agendamento online ativado' : 'Agendamento online desativado'}
          </Label>
          <p className="text-xs text-mid">
            {enabled
              ? 'Pacientes podem agendar pela página pública da clínica.'
              : 'Apenas agendamentos internos são permitidos.'}
          </p>
        </div>
      </div>

      {enabled && (
        <div className="space-y-3">
          <label className="uppercase tracking-wider text-xs text-mid font-medium block">
            Link de Agendamento
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 bg-white rounded-full border border-[#E8ECEF] pl-4 pr-1.5 py-1.5 min-w-0">
              <span className="text-sm font-mono text-charcoal truncate flex-1">
                {bookingUrl}
              </span>
              <button
                type="button"
                onClick={handleCopyUrl}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-white border border-blush/50 px-3 py-1.5 text-xs font-medium text-forest hover:bg-forest hover:text-cream transition-colors shadow-sm"
              >
                {copied ? (
                  <>
                    <CheckIcon className="h-3.5 w-3.5" />
                    Copiado
                  </>
                ) : (
                  <>
                    <CopyIcon className="h-3.5 w-3.5" />
                    Copiar
                  </>
                )}
              </button>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => window.open(bookingUrl, '_blank')}
              title="Abrir página"
              className="shrink-0 rounded-full"
            >
              <ExternalLinkIcon />
            </Button>
          </div>
          <p className="text-xs text-mid">
            Compartilhe este link com seus pacientes para que possam agendar online.
            O slug &ldquo;{slug}&rdquo; foi definido durante a criação da clínica e não pode ser alterado.
          </p>
        </div>
      )}
    </div>
  )
}
