'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { CopyIcon, CheckIcon, Loader2Icon } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/hooks/queries/query-keys'

interface CalendarConnectionCardProps {
  type: 'practitioner' | 'clinic'
  connection: {
    id: string
    feedToken: string
    enabled: boolean
  } | null
  helperText: string
}

export function CalendarConnectionCard({
  type,
  connection,
  helperText,
}: CalendarConnectionCardProps) {
  const queryClient = useQueryClient()
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [copied, setCopied] = useState(false)

  const appUrl = typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL || ''

  const feedUrl = connection
    ? `${appUrl}/api/calendar/feed/${connection.feedToken}`
    : ''

  async function handleConnect() {
    window.location.href = `/api/calendar/auth/connect?type=${type}`
  }

  async function handleToggle(enabled: boolean) {
    if (!connection) return
    setToggling(true)
    try {
      const res = await fetch(`/api/calendar/connections/${connection.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) throw new Error('Erro ao atualizar')
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.connections })
      toast.success(enabled ? 'Sincronização ativada' : 'Sincronização desativada')
    } catch {
      toast.error('Erro ao atualizar configuração')
    } finally {
      setToggling(false)
    }
  }

  async function handleDisconnect() {
    if (!connection) return
    setDisconnecting(true)
    try {
      const res = await fetch(`/api/calendar/connections/${connection.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Erro ao desconectar')
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.connections })
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all })
      toast.success('Google Calendar desconectado')
    } catch {
      toast.error('Erro ao desconectar')
    } finally {
      setDisconnecting(false)
      setConfirmOpen(false)
    }
  }

  async function handleCopyFeed() {
    try {
      await navigator.clipboard.writeText(feedUrl)
      setCopied(true)
      toast.success('Link copiado')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Erro ao copiar link')
    }
  }

  if (!connection) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-mid">{helperText}</p>
        <Button
          onClick={handleConnect}
          className="w-full bg-forest text-cream hover:bg-sage transition-colors"
        >
          <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Conectar Google Calendar
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-green-500" />
        <span className="text-sm font-medium text-charcoal">Conectado</span>
      </div>

      <div className="flex items-center gap-4 rounded-[3px] border border-[#E8ECEF] bg-white p-3">
        <Switch
          checked={connection.enabled}
          onCheckedChange={handleToggle}
          disabled={toggling}
        />
        <Label className="text-sm text-charcoal">
          Sincronizar automaticamente
        </Label>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium uppercase tracking-wider text-mid block">
          Link do calendario (iCal)
        </label>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 rounded border border-[#E8ECEF] bg-white px-3 py-2">
            <span className="text-xs font-mono text-charcoal truncate block">{feedUrl}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyFeed}
            className="shrink-0"
          >
            {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full text-red-600 border-red-200 hover:bg-red-50"
        onClick={() => setConfirmOpen(true)}
      >
        Desconectar
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desconectar Google Calendar</DialogTitle>
            <DialogDescription>
              Tem certeza? A sincronização será interrompida e os bloqueios de calendário externo serão removidos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Desconectar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
