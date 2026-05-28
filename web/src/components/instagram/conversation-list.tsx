'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Search, MessageSquare } from 'lucide-react'
import { displayLabel, getInitials } from './utils'

export interface InstagramConversation {
  id: string
  igsid: string
  igHandle: string | null
  igProfileName: string | null
  igProfilePictureUrl: string | null
  prospectId: string | null
  patientId: string | null
  lastMessageAt: string | null
  lastInboundAt: string | null
  unreadCount: number
  status: string
}

type FilterType = 'all' | 'unread' | 'prospects' | 'patients'

interface ConversationListProps {
  activeConversationId?: string
  onSelect: (id: string) => void
}

const FILTER_TABS: { value: FilterType; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'unread', label: 'Não lidos' },
  { value: 'prospects', label: 'Leads' },
  { value: 'patients', label: 'Pacientes' },
]

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMs / 3_600_000)
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffMins < 1) return 'agora'
  if (diffMins < 60) return `${diffMins}min`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays < 7) return `${diffDays}d`
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function StageBadge({ conversation }: { conversation: InstagramConversation }) {
  if (conversation.patientId) {
    return (
      <Badge className="text-[10px] h-4 px-1.5 bg-emerald-100 text-emerald-700 border-emerald-200">
        Paciente
      </Badge>
    )
  }
  if (conversation.prospectId) {
    return (
      <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
        Lead
      </Badge>
    )
  }
  return null
}

export function ConversationList({ activeConversationId, onSelect }: ConversationListProps) {
  const [conversations, setConversations] = useState<InstagramConversation[]>([])
  const [filter, setFilter] = useState<FilterType>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchConversations = useCallback(async (f: FilterType, s: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ filter: f, limit: '50' })
      if (s) params.set('search', s)
      const res = await fetch(`/api/instagram/conversations?${params}`)
      if (!res.ok) {
        if (res.status === 403) {
          setError('not_configured')
          return
        }
        throw new Error('Erro ao carregar conversas')
      }
      const data = await res.json()
      setConversations((data.data ?? []) as InstagramConversation[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConversations(filter, search)
  }, [filter, fetchConversations, search])

  function handleSearchChange(value: string) {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      setSearch(value)
    }, 300)
  }

  if (error === 'not_configured') {
    return null
  }

  return (
    <div className="flex h-full flex-col border-r bg-white">
      <div className="border-b p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar contato..."
            className="pl-8 h-9"
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-1 border-b px-3 py-2">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              filter === tab.value
                ? 'bg-fuchsia-500/10 text-fuchsia-700'
                : 'text-muted-foreground hover:bg-muted',
            )}
            onClick={() => setFilter(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="space-y-1 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg p-3">
                <Skeleton className="size-10 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-36" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && conversations.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <MessageSquare className="size-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {search ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa ainda.'}
            </p>
          </div>
        )}

        {!loading && error && error !== 'not_configured' && (
          <div className="p-4 text-center text-sm text-destructive">{error}</div>
        )}

        {!loading &&
          conversations.map((conv) => (
            <button
              key={conv.id}
              type="button"
              className={cn(
                'flex w-full items-center gap-3 border-b border-gray-50 px-3 py-3 text-left transition-colors hover:bg-[#F0F2F5]',
                activeConversationId === conv.id && 'bg-[#F0F2F5]',
              )}
              onClick={() => onSelect(conv.id)}
            >
              <Avatar size="lg">
                {conv.igProfilePictureUrl && <AvatarImage src={conv.igProfilePictureUrl} />}
                <AvatarFallback className="bg-[#DFE5E7] text-[#54656F] text-xs">
                  {getInitials(conv.igHandle, conv.igProfileName)}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 overflow-hidden">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-[#111B21]">
                    {displayLabel(conv)}
                  </span>
                  <span className="shrink-0 text-[11px] text-[#667781]">
                    {formatTimeAgo(conv.lastMessageAt)}
                  </span>
                </div>

                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p className="truncate text-xs text-[#667781]">
                    {conv.igHandle && conv.igProfileName ? conv.igProfileName : 'Sem prévia'}
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    {conv.unreadCount > 0 && (
                      <span className="flex size-5 items-center justify-center rounded-full bg-fuchsia-500 text-[10px] font-medium text-white">
                        {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-1">
                  <StageBadge conversation={conv} />
                </div>
              </div>
            </button>
          ))}
      </div>
    </div>
  )
}
