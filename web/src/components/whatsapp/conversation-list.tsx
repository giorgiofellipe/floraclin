'use client'

import { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Search, MessageSquare, Plus, Check, CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatBrPhone } from '@/lib/phone'

export interface Conversation {
  id: string
  phoneNumber: string
  profileName: string | null
  prospectId: string | null
  patientId: string | null
  lastMessageBody: string | null
  lastMessageDirection: string | null
  lastMessageStatus: string | null
  lastMessageAt: string | null
  lastInboundAt: string | null
  unreadCount: number
  status: string
}

type FilterType = 'all' | 'unread' | 'prospects' | 'patients'

export interface ConversationListHandle {
  addOrUpdateConversation: (conv: Conversation) => void
  updateConversation: (conv: Partial<Conversation> & { id: string }) => void
  incrementUnread: (convId: string) => void
  resetUnread: (convId: string) => void
}

interface ConversationListProps {
  activeConversationId: string | null
  onSelectConversation: (conversation: Conversation) => void
  onNewConversation?: () => void
  onInitialLoadComplete?: () => void
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

function getInitials(name: string | null, phone: string | undefined): string {
  if (name) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    }
    return name.slice(0, 2).toUpperCase()
  }
  return phone?.slice(-2) ?? '?'
}

function StageBadge({ conversation }: { conversation: Conversation }) {
  if (conversation.patientId) {
    return <Badge className="text-[10px] h-4 px-1.5 bg-emerald-100 text-emerald-700 border-emerald-200">Paciente</Badge>
  }
  if (conversation.prospectId) {
    return <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Lead</Badge>
  }
  return null
}

export const ConversationList = forwardRef<ConversationListHandle, ConversationListProps>(
  function ConversationList({ activeConversationId, onSelectConversation, onNewConversation, onInitialLoadComplete }, ref) {
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [filter, setFilter] = useState<FilterType>('all')
    const [search, setSearch] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const initialLoadDoneRef = useRef(false)
    const onInitialLoadCompleteRef = useRef(onInitialLoadComplete)
    onInitialLoadCompleteRef.current = onInitialLoadComplete

    const fetchConversations = useCallback(async (f: FilterType, s: string) => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ filter: f, limit: '50' })
        if (s) params.set('search', s)
        const res = await fetch(`/api/whatsapp/conversations?${params}`)
        if (!res.ok) {
          if (res.status === 403) {
            setError('not_configured')
            return
          }
          throw new Error('Erro ao carregar conversas')
        }
        const data = await res.json()
        setConversations(data.data ?? [])
        if (!initialLoadDoneRef.current) {
          initialLoadDoneRef.current = true
          onInitialLoadCompleteRef.current?.()
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro desconhecido')
      } finally {
        setLoading(false)
      }
    }, [])

    useEffect(() => {
      fetchConversations(filter, search)
    }, [filter, fetchConversations, search])

    const handleSearchChange = (value: string) => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
      searchTimeoutRef.current = setTimeout(() => {
        setSearch(value)
      }, 300)
    }

    const addOrUpdateConversation = useCallback((conv: Conversation) => {
      if (!initialLoadDoneRef.current) return
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === conv.id)
        if (idx >= 0) {
          const updated = [...prev]
          updated[idx] = { ...updated[idx], ...conv }
          return updated.sort((a, b) =>
            (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')
          )
        }
        return [conv, ...prev]
      })
    }, [])

    const updateConversation = useCallback((conv: Partial<Conversation> & { id: string }) => {
      if (!initialLoadDoneRef.current) return
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === conv.id)
        if (idx < 0) return prev
        const existing = prev[idx]
        if (conv.lastMessageAt && existing.lastMessageAt && conv.lastMessageAt < existing.lastMessageAt) {
          return prev
        }
        const updated = [...prev]
        updated[idx] = { ...existing, ...conv }
        return updated.sort((a, b) =>
          (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')
        )
      })
    }, [])

    const incrementUnread = useCallback((convId: string) => {
      if (!initialLoadDoneRef.current) return
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, unreadCount: c.unreadCount + 1 } : c)),
      )
    }, [])

    const resetUnread = useCallback((convId: string) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, unreadCount: 0 } : c)),
      )
    }, [])

    useImperativeHandle(ref, () => ({ addOrUpdateConversation, updateConversation, incrementUnread, resetUnread }), [addOrUpdateConversation, updateConversation, incrementUnread, resetUnread])

    if (error === 'not_configured') {
      return null
    }

    return (
      <div className="flex h-full flex-col border-r bg-white">
        {/* Search + New conversation */}
        <div className="border-b p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar contato..."
                className="pl-8 h-9"
                onChange={(e) => handleSearchChange(e.target.value)}
              />
            </div>
            {onNewConversation && (
              <Button
                variant="outline"
                size="icon-sm"
                className="shrink-0 size-9 text-[#25D366] border-[#25D366]/30 hover:bg-[#25D366]/10"
                onClick={onNewConversation}
              >
                <Plus className="size-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 border-b px-3 py-2">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                filter === tab.value
                  ? 'bg-[#25D366]/10 text-[#128C7E]'
                  : 'text-muted-foreground hover:bg-muted'
              )}
              onClick={() => setFilter(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Conversation list */}
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
                  activeConversationId === conv.id && 'bg-[#F0F2F5]'
                )}
                onClick={() => onSelectConversation(conv)}
              >
                <Avatar size="lg">
                  <AvatarFallback className="bg-[#DFE5E7] text-[#54656F] text-xs">
                    {getInitials(conv.profileName, conv.phoneNumber)}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 overflow-hidden">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-[#111B21]">
                      {conv.profileName || formatBrPhone(conv.phoneNumber)}
                    </span>
                    <span className="shrink-0 text-[11px] text-[#667781]">
                      {formatTimeAgo(conv.lastMessageAt)}
                    </span>
                  </div>

                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1 truncate text-xs text-[#667781]">
                      {conv.lastMessageDirection === 'outbound' && (
                        <span className="shrink-0">
                          {conv.lastMessageStatus === 'read' ? (
                            <CheckCheck className="size-3.5 text-[#53BDEB]" />
                          ) : conv.lastMessageStatus === 'delivered' ? (
                            <CheckCheck className="size-3.5 text-[#8696A0]" />
                          ) : (
                            <Check className="size-3.5 text-[#8696A0]" />
                          )}
                        </span>
                      )}
                      <span className="truncate">{conv.lastMessageBody || 'Sem mensagens'}</span>
                    </p>
                    <div className="flex shrink-0 items-center gap-1">
                      {conv.unreadCount > 0 && (
                        <span className="flex size-5 items-center justify-center rounded-full bg-[#25D366] text-[10px] font-medium text-white">
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
)
