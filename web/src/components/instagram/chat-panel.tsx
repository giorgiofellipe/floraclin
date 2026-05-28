'use client'

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
} from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { MessageBubble, type BubbleReaction } from './message-bubble'
import { LinkPatientDialog } from './link-patient-dialog'
import { SavedReplyPicker } from './saved-reply-picker'
import type { InstagramConversation } from './conversation-list'
import { displayHandle, getInitials } from './utils'
import type { InstagramMessage } from '@/db/queries/instagram'
import { toast } from 'sonner'
import {
  Send,
  CheckCheck,
  User,
  UserPlus,
  MessageSquare,
  Loader2,
  Image as ImageIcon,
} from 'lucide-react'

export interface InstagramChatPanelHandle {
  addMessage: (msg: InstagramMessage) => void
  updateMessageStatus: (data: {
    messageId: string
    status: string
    metaMessageId?: string
  }) => void
  removeMessages: (ids: string[]) => void
}

interface ChatPanelProps {
  conversation: InstagramConversation | null
  onMarkRead?: (convId: string) => void
}

const HOUR_MS = 3_600_000
const STANDARD_WINDOW_HOURS = 24
const HUMAN_AGENT_WINDOW_HOURS = 24 * 7
// Wait one frame for the freshly-appended bubble (and any inline media)
// to commit to the DOM before scrolling — otherwise scrollIntoView lands
// short by the height of the new message.
const SCROLL_DELAY_MS = 100

type WindowState =
  | { kind: 'standard'; hoursRemaining: number }
  | { kind: 'human_agent'; daysRemaining: number }
  | { kind: 'outside' }
  | { kind: 'no_inbound' }

function computeWindowState(lastInboundAt: string | Date | null): WindowState {
  if (!lastInboundAt) return { kind: 'no_inbound' }
  const lastMs =
    typeof lastInboundAt === 'string'
      ? new Date(lastInboundAt).getTime()
      : lastInboundAt.getTime()
  const hoursSince = (Date.now() - lastMs) / HOUR_MS
  if (hoursSince <= STANDARD_WINDOW_HOURS) {
    return {
      kind: 'standard',
      hoursRemaining: Math.max(0, Math.ceil(STANDARD_WINDOW_HOURS - hoursSince)),
    }
  }
  if (hoursSince <= HUMAN_AGENT_WINDOW_HOURS) {
    const hoursRemaining = HUMAN_AGENT_WINDOW_HOURS - hoursSince
    return {
      kind: 'human_agent',
      daysRemaining: Math.max(1, Math.ceil(hoursRemaining / 24)),
    }
  }
  return { kind: 'outside' }
}

function formatDateSeparator(dateStr: string | Date): string {
  const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Hoje'
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem'
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function groupMessagesByDate(
  messages: InstagramMessage[],
): { dateKey: string; messages: InstagramMessage[] }[] {
  const groups: Map<string, InstagramMessage[]> = new Map()
  for (const msg of messages) {
    const dateKey = new Date(msg.timestamp).toDateString()
    const existing = groups.get(dateKey)
    if (existing) {
      existing.push(msg)
    } else {
      groups.set(dateKey, [msg])
    }
  }
  return Array.from(groups.entries()).map(([dateKey, msgs]) => ({
    dateKey,
    messages: msgs,
  }))
}

export const ChatPanel = forwardRef<InstagramChatPanelHandle, ChatPanelProps>(
  function ChatPanel({ conversation, onMarkRead }, ref) {
    const [messages, setMessages] = useState<InstagramMessage[]>([])
    const [loading, setLoading] = useState(false)
    const [inputText, setInputText] = useState('')
    const [sending, setSending] = useState(false)
    const [markingRead, setMarkingRead] = useState(false)
    const [fetchError, setFetchError] = useState<string | null>(null)
    const [linkDialogOpen, setLinkDialogOpen] = useState(false)
    const [linkedPatientId, setLinkedPatientId] = useState<string | null>(null)
    const [linkedPatientName, setLinkedPatientName] = useState<string | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const prevConvIdRef = useRef<string | null>(null)

    const scrollToBottom = useCallback(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [])

    const fetchMessages = useCallback(async (convId: string) => {
      setLoading(true)
      setFetchError(null)
      try {
        const res = await fetch(
          `/api/instagram/conversations/${convId}/messages?page=1&limit=100`,
        )
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `HTTP ${res.status}`)
        }
        const data = await res.json()
        const fetched: InstagramMessage[] = data.data ?? []
        setMessages(fetched)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro ao carregar mensagens'
        console.error('Failed to fetch IG messages:', msg)
        setFetchError(msg)
      } finally {
        setLoading(false)
      }
    }, [])

    // Load patient name when conversation changes and has patientId.
    useEffect(() => {
      if (!conversation?.patientId) {
        setLinkedPatientId(null)
        setLinkedPatientName(null)
        return
      }
      setLinkedPatientId(conversation.patientId)
      let cancelled = false
      ;(async () => {
        try {
          const res = await fetch(`/api/patients/${conversation.patientId}`)
          if (!res.ok) return
          const data = await res.json()
          if (!cancelled) {
            setLinkedPatientName(data?.fullName ?? data?.data?.fullName ?? null)
          }
        } catch {
          // Silently ignore — fall back to generic badge.
        }
      })()
      return () => {
        cancelled = true
      }
    }, [conversation?.patientId])

    // Load messages when conversation changes.
    useEffect(() => {
      if (!conversation) {
        setMessages([])
        return
      }
      if (conversation.id !== prevConvIdRef.current) {
        prevConvIdRef.current = conversation.id
        setInputText('')
        fetchMessages(conversation.id)
      }
    }, [conversation, fetchMessages])

    // Scroll to bottom when messages load initially.
    useEffect(() => {
      if (!loading && messages.length > 0) {
        scrollToBottom()
      }
    }, [loading, messages.length, scrollToBottom])

    const addMessage = useCallback(
      (msg: InstagramMessage) => {
        if (!conversation || msg.conversationId !== conversation.id) return
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev
          return [...prev, msg]
        })
        setTimeout(() => scrollToBottom(), SCROLL_DELAY_MS)
      },
      [conversation, scrollToBottom],
    )

    const updateMessageStatus = useCallback(
      (data: { messageId: string; status: string; metaMessageId?: string }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.messageId
              ? {
                  ...m,
                  deliveryStatus: data.status,
                  ...(data.metaMessageId ? { metaMessageId: data.metaMessageId } : {}),
                }
              : m,
          ),
        )
      },
      [],
    )

    const removeMessages = useCallback((ids: string[]) => {
      const idSet = new Set(ids)
      setMessages((prev) => prev.filter((m) => !idSet.has(m.id)))
    }, [])

    useImperativeHandle(
      ref,
      () => ({ addMessage, updateMessageStatus, removeMessages }),
      [addMessage, updateMessageStatus, removeMessages],
    )

    const handleSendText = async (overrideText?: string) => {
      const text = (overrideText ?? inputText).trim()
      if (!conversation || !text || sending) return
      setSending(true)
      try {
        const res = await fetch(
          `/api/instagram/conversations/${conversation.id}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'text', body: text }),
          },
        )
        if (!res.ok) {
          const err = await res
            .json()
            .catch(() => ({ error: 'Erro ao enviar mensagem' }))
          toast.error(err.error || 'Erro ao enviar mensagem')
          return
        }
        setInputText('')
        await fetchMessages(conversation.id)
        setTimeout(() => scrollToBottom(), SCROLL_DELAY_MS)
      } catch {
        toast.error('Erro ao enviar mensagem')
      } finally {
        setSending(false)
      }
    }

    const handleSendMedia = async () => {
      if (!conversation || sending) return
      const url = window.prompt(
        'URL da mídia (imagem/vídeo/áudio acessível publicamente):',
      )
      if (!url) return
      const trimmed = url.trim()
      try {
        // Validate URL shape early.
        new URL(trimmed)
      } catch {
        toast.error('URL inválida')
        return
      }
      // Naive media-type inference from extension.
      const lower = trimmed.toLowerCase()
      let mediaType: 'image' | 'video' | 'audio' | 'file' = 'file'
      if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/.test(lower)) mediaType = 'image'
      else if (/\.(mp4|mov|webm)(\?|$)/.test(lower)) mediaType = 'video'
      else if (/\.(mp3|m4a|ogg|wav)(\?|$)/.test(lower)) mediaType = 'audio'

      setSending(true)
      try {
        const res = await fetch(
          `/api/instagram/conversations/${conversation.id}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'media', mediaType, mediaUrl: trimmed }),
          },
        )
        if (!res.ok) {
          const err = await res
            .json()
            .catch(() => ({ error: 'Erro ao enviar mídia' }))
          toast.error(err.error || 'Erro ao enviar mídia')
          return
        }
        await fetchMessages(conversation.id)
        setTimeout(() => scrollToBottom(), SCROLL_DELAY_MS)
      } catch {
        toast.error('Erro ao enviar mídia')
      } finally {
        setSending(false)
      }
    }

    const handleMarkRead = async () => {
      if (!conversation || markingRead) return
      setMarkingRead(true)
      try {
        const res = await fetch(
          `/api/instagram/conversations/${conversation.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'mark_read' }),
          },
        )
        if (res.ok) {
          onMarkRead?.(conversation.id)
        }
      } catch {
        // Silently fail.
      } finally {
        setMarkingRead(false)
      }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSendText()
      }
    }

    // Empty state — no conversation selected.
    if (!conversation) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#F0F2F5]">
          <div className="rounded-full bg-fuchsia-500/10 p-6">
            <MessageSquare className="size-12 text-fuchsia-600" />
          </div>
          <h3 className="text-lg font-medium text-[#41525D]">FloraClin Instagram</h3>
          <p className="max-w-sm text-center text-sm text-[#667781]">
            Selecione uma conversa para visualizar as mensagens e interagir com seus contatos.
          </p>
        </div>
      )
    }

    const windowState = computeWindowState(conversation.lastInboundAt)
    const composerDisabled = windowState.kind === 'outside'
    const messageGroups = groupMessagesByDate(messages)

    // Build reaction map keyed by reactsToMessageId.
    const reactionMap = new Map<string, BubbleReaction[]>()
    for (const m of messages) {
      if (m.messageType === 'reaction' && m.reactsToMessageId && m.reactionEmoji) {
        const list = reactionMap.get(m.reactsToMessageId) ?? []
        list.push({
          emoji: m.reactionEmoji,
          senderType: m.direction === 'outbound' ? 'us' : 'them',
        })
        reactionMap.set(m.reactsToMessageId, list)
      }
    }

    return (
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b bg-[#F0F2F5] px-4 py-2">
          <div className="flex items-center gap-3">
            <Avatar>
              {conversation.igProfilePictureUrl && (
                <AvatarImage src={conversation.igProfilePictureUrl} />
              )}
              <AvatarFallback className="bg-[#DFE5E7] text-[#54656F] text-xs">
                {getInitials(conversation)}
              </AvatarFallback>
            </Avatar>
            <div>
              <h3 className="text-sm font-medium text-[#111B21]">
                {displayHandle(conversation)}
              </h3>
              {conversation.igHandle && conversation.igProfileName && (
                <p className="text-xs text-[#667781]">{conversation.igProfileName}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {conversation.unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleMarkRead}
                disabled={markingRead}
              >
                <CheckCheck className="mr-1 size-3.5" />
                Marcar como lido
              </Button>
            )}

            {linkedPatientId ? (
              <>
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  Vinculado{linkedPatientName ? ` a ${linkedPatientName}` : ''}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={`/pacientes/${linkedPatientId}`} />}
                >
                  <User className="mr-1 size-3.5" />
                  Ver paciente
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLinkDialogOpen(true)}
              >
                <UserPlus className="mr-1 size-3.5" />
                Vincular a paciente
              </Button>
            )}
          </div>
        </div>

        {/* Messages area */}
        <div
          className="flex-1 overflow-y-auto bg-[#ECE5DD] px-4 py-3"
          style={{
            backgroundImage:
              'url("data:image/svg+xml,%3Csvg width=\'200\' height=\'200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3Cpattern id=\'p\' width=\'40\' height=\'40\' patternUnits=\'userSpaceOnUse\'%3E%3Ccircle cx=\'20\' cy=\'20\' r=\'1\' fill=\'%23d5cec3\' opacity=\'0.3\'/%3E%3C/pattern%3E%3C/defs%3E%3Crect fill=\'url(%23p)\' width=\'200\' height=\'200\'/%3E%3C/svg%3E")',
          }}
        >
          {loading && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Skeleton className="h-10 w-48 rounded-lg" />
              <Skeleton className="ml-auto h-10 w-36 rounded-lg" />
              <Skeleton className="h-10 w-56 rounded-lg" />
              <Skeleton className="ml-auto h-10 w-40 rounded-lg" />
            </div>
          )}

          {!loading && messages.length === 0 && fetchError && (
            <div className="flex h-full flex-col items-center justify-center gap-2">
              <p className="rounded-lg bg-white/80 px-4 py-2 text-sm text-destructive shadow-sm">
                {fetchError}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="bg-white/80 text-xs"
                onClick={() => conversation && fetchMessages(conversation.id)}
              >
                Tentar novamente
              </Button>
            </div>
          )}

          {!loading && messages.length === 0 && !fetchError && (
            <div className="flex h-full items-center justify-center">
              <p className="rounded-lg bg-white/80 px-4 py-2 text-sm text-[#667781] shadow-sm">
                Nenhuma mensagem ainda. Envie a primeira!
              </p>
            </div>
          )}

          {!loading &&
            messageGroups.map((group) => (
              <div key={group.dateKey}>
                <div className="my-3 flex justify-center">
                  <span className="rounded-lg bg-white/90 px-3 py-1 text-xs font-medium text-[#54656F] shadow-sm">
                    {formatDateSeparator(group.messages[0].timestamp)}
                  </span>
                </div>
                <div className="space-y-1">
                  {group.messages.map((msg) => {
                    // Hide reaction rows that reference another message — they're
                    // grouped into the parent bubble instead.
                    if (msg.messageType === 'reaction' && msg.reactsToMessageId) {
                      return null
                    }
                    const reactions = reactionMap.get(msg.id)
                    return (
                      <MessageBubble
                        key={msg.id}
                        message={msg}
                        reactions={reactions}
                      />
                    )
                  })}
                </div>
              </div>
            ))}

          <div ref={messagesEndRef} />
        </div>

        {/* Composer */}
        <div className="border-t bg-[#F0F2F5]">
          {/* Window-state banner */}
          {windowState.kind === 'standard' && (
            <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">
              Janela padrão aberta — {windowState.hoursRemaining}h restantes
            </div>
          )}
          {windowState.kind === 'human_agent' && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
              Janela de agente humano — {windowState.daysRemaining}{' '}
              {windowState.daysRemaining === 1 ? 'dia' : 'dias'} restantes
            </div>
          )}
          {windowState.kind === 'outside' && (
            <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
              Fora da janela de 7 dias — não é possível enviar mensagens.
            </div>
          )}

          <div className="px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <SavedReplyPicker
                onPick={(filled) => setInputText((prev) => (prev ? prev + '\n' + filled : filled))}
                disabled={composerDisabled || sending}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={handleSendMedia}
                disabled={composerDisabled || sending}
                title="Enviar mídia por URL"
              >
                <ImageIcon className="size-5 text-[#54656F]" />
              </Button>

              <textarea
                className={cn(
                  'flex-1 resize-none rounded-lg border-0 bg-white px-3 py-2 text-sm text-[#111B21] outline-none ring-0',
                  'placeholder:text-[#667781]',
                  'focus:ring-0 focus:outline-none',
                  'min-h-[40px] max-h-[120px]',
                  composerDisabled && 'opacity-60',
                )}
                placeholder={
                  composerDisabled
                    ? 'Janela de mensagens encerrada.'
                    : 'Mensagem...'
                }
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={composerDisabled || sending}
              />

              <Button
                size="icon"
                onClick={() => handleSendText()}
                disabled={composerDisabled || !inputText.trim() || sending}
                className="bg-fuchsia-500 hover:bg-fuchsia-600 text-white shrink-0"
              >
                {sending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </div>

        <LinkPatientDialog
          conversationId={conversation.id}
          open={linkDialogOpen}
          onOpenChange={setLinkDialogOpen}
          currentPatientId={linkedPatientId}
          onLinked={(patientId) => {
            setLinkedPatientId(patientId)
            if (!patientId) setLinkedPatientName(null)
          }}
        />
      </div>
    )
  },
)
