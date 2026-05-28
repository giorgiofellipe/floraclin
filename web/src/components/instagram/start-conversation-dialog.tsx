'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Info, Search, MessageSquare } from 'lucide-react'
import { displayLabel, getInitials } from './utils'

interface InstagramConversationItem {
  id: string
  igsid: string
  igHandle: string | null
  igProfileName: string | null
  igProfilePictureUrl: string | null
  prospectId: string | null
  patientId: string | null
}

interface StartConversationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function StartConversationDialog({ open, onOpenChange }: StartConversationDialogProps) {
  const router = useRouter()
  const [conversations, setConversations] = useState<InstagramConversationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const fetchConversations = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/instagram/conversations?limit=100')
      if (!res.ok) throw new Error('Erro ao carregar conversas')
      const data = await res.json()
      setConversations((data.data ?? []) as InstagramConversationItem[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setSearch('')
      fetchConversations()
    }
  }, [open, fetchConversations])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => {
      const handle = (c.igHandle ?? '').toLowerCase()
      const name = (c.igProfileName ?? '').toLowerCase()
      return handle.includes(q) || name.includes(q)
    })
  }, [conversations, search])

  // Group by first letter of handle (or profile name) for an alphabetical grouping.
  const groups = useMemo(() => {
    const map = new Map<string, InstagramConversationItem[]>()
    for (const conv of filtered) {
      const label = displayLabel(conv)
      const key = label.replace(/^@/, '').charAt(0).toUpperCase() || '#'
      const list = map.get(key) ?? []
      list.push(conv)
      map.set(key, list)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
  }, [filtered])

  function handleSelect(id: string) {
    onOpenChange(false)
    router.push(`/instagram?conversa=${id}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova conversa</DialogTitle>
          <DialogDescription>
            Selecione um contato que já conversou com a clínica.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5">
          <Info className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p className="text-xs text-amber-800">
            O Instagram permite enviar mensagens apenas para contatos que já interagiram com sua conta.
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-mid" />
          <Input
            placeholder="Buscar por @handle ou nome..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
            autoFocus
          />
        </div>

        <div className="max-h-80 overflow-y-auto space-y-3">
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {!loading && error && (
            <div className="py-6 text-center text-sm text-destructive">{error}</div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <MessageSquare className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {search ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa ainda.'}
              </p>
            </div>
          )}

          {!loading && !error && groups.map(([letter, items]) => (
            <div key={letter} className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground pl-1">
                {letter}
              </p>
              {items.map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                  onClick={() => handleSelect(conv.id)}
                >
                  <Avatar>
                    {conv.igProfilePictureUrl && (
                      <AvatarImage src={conv.igProfilePictureUrl} />
                    )}
                    <AvatarFallback className="bg-[#DFE5E7] text-[#54656F] text-xs">
                      {getInitials(conv.igHandle, conv.igProfileName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-charcoal">
                      {displayLabel(conv)}
                    </p>
                    {conv.igHandle && conv.igProfileName && (
                      <p className="truncate text-xs text-mid">{conv.igProfileName}</p>
                    )}
                  </div>
                  {conv.patientId ? (
                    <Badge className="text-[10px] h-4 px-1.5 bg-emerald-100 text-emerald-700 border-emerald-200">
                      Paciente
                    </Badge>
                  ) : conv.prospectId ? (
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                      Lead
                    </Badge>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
