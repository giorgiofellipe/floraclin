'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { BOOKING_SLUG_CHANGES_PER_DAY, SLUG_RESERVATION_DAYS } from '@/lib/booking-slug'
import { useUpdateBookingSettings, useUpdateBookingSlug } from '@/hooks/mutations/use-tenant-mutations'
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
  slug: initialSlug,
  publicBookingEnabled: initialEnabled,
  embedded = false,
  onChange,
}: BookingSettingsProps) {
  const updateBookingSettings = useUpdateBookingSettings()
  const isPending = updateBookingSettings.isPending
  const [enabled, setEnabled] = useState(initialEnabled)
  const [copied, setCopied] = useState(false)
  const updateSlug = useUpdateBookingSlug()
  const [slug, setSlug] = useState(initialSlug)
  const [slugDraft, setSlugDraft] = useState(initialSlug)
  const [slugError, setSlugError] = useState<string | null>(null)
  const [confirmSlugOpen, setConfirmSlugOpen] = useState(false)
  const slugChanged = slugDraft.trim() !== slug

  const appUrl = typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL || ''
  const bookingUrl = `${appUrl}/c/${slug}`
  // The slug field's prefix: the readable address, without the protocol.
  const bookingHost = appUrl.replace(/^https?:\/\//, '')

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

  // The change takes effect at once, so it is confirmed first.
  function handleSubmitSlug(e: React.FormEvent) {
    e.preventDefault()
    if (!slugChanged) return
    setSlugError(null)
    setConfirmSlugOpen(true)
  }

  async function handleSaveSlug() {
    setConfirmSlugOpen(false)
    try {
      const result = (await updateSlug.mutateAsync(slugDraft.trim())) as { slug?: string } | undefined
      const saved = result?.slug ?? slugDraft.trim()
      setSlug(saved)
      setSlugDraft(saved)
      toast.success('Link de agendamento atualizado')
    } catch (err) {
      setSlugError(err instanceof Error ? err.message : 'Erro ao atualizar o link')
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
          Permita que pacientes agendem consultas diretamente pela internet através de um link
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
          </p>
        </div>
      )}

      {!embedded && (
        <form onSubmit={handleSubmitSlug} className="space-y-2" data-testid="booking-slug-form">
          <Label htmlFor="booking-slug" className="uppercase tracking-wider text-xs text-mid font-medium">
            Endereço do link
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-1 min-w-0">
              {/* The host gives way on narrow screens; "/c/" and the slug field stay. */}
              <span className="flex min-w-0 items-center text-sm text-mid" title={`${bookingHost}/c/`}>
                <span className="truncate">{bookingHost}</span>
                <span className="shrink-0">/c/</span>
              </span>
              <Input
                id="booking-slug"
                value={slugDraft}
                onChange={(e) => {
                  setSlugDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                  setSlugError(null)
                }}
                maxLength={100}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={!!slugError || undefined}
                aria-describedby={slugError ? 'booking-slug-error booking-slug-hint' : 'booking-slug-hint'}
                className="h-9 min-w-32 flex-1 font-mono"
              />
            </div>
            <Button type="submit" variant="outline" disabled={!slugChanged || updateSlug.isPending} className="h-9">
              {updateSlug.isPending ? 'Salvando...' : 'Salvar link'}
            </Button>
          </div>
          {slugError && <p id="booking-slug-error" className="text-xs text-red-600">{slugError}</p>}
          <p id="booking-slug-hint" className="text-xs text-mid">
            Criado a partir do nome da clínica. Ao mudar, o endereço antigo redireciona para o novo por {SLUG_RESERVATION_DAYS} dias.
          </p>
        </form>
      )}

      {!embedded && (
        <Dialog open={confirmSlugOpen} onOpenChange={setConfirmSlugOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Alterar o link de agendamento?</DialogTitle>
              <DialogDescription>
                O novo link será {bookingHost}/c/{slugDraft.trim()}. Quem abrir o link antigo
                ({bookingHost}/c/{slug}) será redirecionado para o novo por {SLUG_RESERVATION_DAYS} dias; depois
                disso, o link antigo deixa de funcionar e pode ser usado por outra clínica. Você pode trocar o link
                até {BOOKING_SLUG_CHANGES_PER_DAY} vezes a cada 24 horas.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
              <Button onClick={handleSaveSlug} disabled={updateSlug.isPending}>
                Alterar link
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
