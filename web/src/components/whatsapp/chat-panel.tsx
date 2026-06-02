'use client'

import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { MessageBubble, type Message } from './message-bubble'
import { TemplatePicker } from './template-picker'
import type { Conversation } from './conversation-list'
import { formatBrPhone, stripCountryCode } from '@/lib/phone'
import { toast } from 'sonner'
import {
  Send,
  FileText,
  CheckCheck,
  User,
  UserPlus,
  MessageSquare,
  Loader2,
  ChevronUp,
} from 'lucide-react'

export interface ChatPanelHandle {
  addMessage: (msg: Message) => void
  updateMessageStatus: (data: { messageId: string; status: string; metaMessageId?: string }) => void
  removeMessages: (ids: string[]) => void
}

interface ChatPanelProps {
  conversation: Conversation | null
  onMarkRead?: (convId: string) => void
  draft?: string | null
}

function isWindowOpen(lastInboundAt: string | null): boolean {
  if (!lastInboundAt) return false
  const lastInbound = new Date(lastInboundAt)
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  return lastInbound > twentyFourHoursAgo
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr)
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

function groupMessagesByDate(messages: Message[]): { dateKey: string; messages: Message[] }[] {
  const groups: Map<string, Message[]> = new Map()
  for (const msg of messages) {
    const dateKey = new Date(msg.createdAt).toDateString()
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

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(
  function ChatPanel({ conversation, onMarkRead, draft }, ref) {
    const [messages, setMessages] = useState<Message[]>([])
    const [loading, setLoading] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [hasMore, setHasMore] = useState(false)
    const [page, setPage] = useState(1)
    const [inputText, setInputText] = useState('')
    const [sending, setSending] = useState(false)
    const [templateOpen, setTemplateOpen] = useState(false)
    const [markingRead, setMarkingRead] = useState(false)
    const [fetchError, setFetchError] = useState<string | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const prevConvIdRef = useRef<string | null>(null)
    const firstQueueRef = useRef(true)

    const scrollToBottom = useCallback(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [])

    const fetchMessages = useCallback(
      async (convId: string, pageNum: number, append: boolean) => {
        if (append) {
          setLoadingMore(true)
        } else {
          setLoading(true)
          setFetchError(null)
        }
        try {
          const params = new URLSearchParams({
            page: String(pageNum),
            limit: '50',
          })
          const res = await fetch(
            `/api/whatsapp/conversations/${convId}/messages?${params}`
          )
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.error || `HTTP ${res.status}`)
          }
          const data = await res.json()
          const fetched: Message[] = data.data ?? []
          setHasMore(fetched.length === 50)
          if (append) {
            setMessages((prev) => [...fetched, ...prev])
          } else {
            setMessages(fetched)
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Erro ao carregar mensagens'
          console.error('Failed to fetch messages:', msg)
          if (!append) setFetchError(msg)
        } finally {
          setLoading(false)
          setLoadingMore(false)
        }
      },
      []
    )

    // Load messages when conversation changes
    useEffect(() => {
      if (!conversation) {
        setMessages([])
        return
      }
      if (conversation.id !== prevConvIdRef.current) {
        prevConvIdRef.current = conversation.id
        setPage(1)
        setInputText(draft ?? '')
        firstQueueRef.current = true
        fetchMessages(conversation.id, 1, false)
      }
    }, [conversation, fetchMessages])

    // Scroll to bottom when messages load initially
    useEffect(() => {
      if (!loading && messages.length > 0) {
        scrollToBottom()
      }
    }, [loading, messages.length, scrollToBottom])

    const addMessage = useCallback(
      (msg: Message) => {
        if (!conversation || msg.conversationId !== conversation.id) return
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev
          return [...prev, msg]
        })
        setTimeout(() => scrollToBottom(), 100)
      },
      [conversation, scrollToBottom]
    )

    const updateMessageStatus = useCallback(
      (data: { messageId: string; status: string; metaMessageId?: string }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.messageId
              ? { ...m, deliveryStatus: data.status, ...(data.metaMessageId ? { metaMessageId: data.metaMessageId } : {}) }
              : m
          )
        )
      },
      []
    )

    const removeMessages = useCallback((ids: string[]) => {
      const idSet = new Set(ids)
      setMessages((prev) => prev.filter((m) => !idSet.has(m.id)))
    }, [])

    useImperativeHandle(ref, () => ({ addMessage, updateMessageStatus, removeMessages }), [
      addMessage,
      updateMessageStatus,
      removeMessages,
    ])

    const handleSendText = async () => {
      if (!conversation || !inputText.trim() || sending) return
      setSending(true)
      try {
        const res = await fetch(
          `/api/whatsapp/conversations/${conversation.id}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: inputText.trim() }),
          }
        )
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Erro ao enviar mensagem' }))
          toast.error(err.error || 'Erro ao enviar mensagem')
          return
        }
        const data = await res.json()
        const newMsg: Message = data.data ?? data
        setMessages((prev) => [...prev, newMsg])
        setInputText('')
        setTimeout(() => scrollToBottom(), 100)

        if (data.queued && data.resumeSent && firstQueueRef.current) {
          firstQueueRef.current = false
          toast.info(
            'Janela expirada — enviamos um pedido de retomada ao paciente. Sua mensagem será enviada quando ele responder.',
            { duration: 6000 },
          )
        }
      } catch {
        toast.error('Erro ao enviar mensagem')
      } finally {
        setSending(false)
      }
    }

    const handleSendTemplate = async (templateName: string, language: string, params?: Record<string, string>) => {
      if (!conversation || sending) return
      setSending(true)
      try {
        const res = await fetch(
          `/api/whatsapp/conversations/${conversation.id}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ templateName, language, params }),
          }
        )
        if (!res.ok) throw new Error('Erro ao enviar template')
        const data = await res.json()
        const newMsg: Message = data.data ?? data
        setMessages((prev) => [...prev, newMsg])
        setTemplateOpen(false)
        setTimeout(() => scrollToBottom(), 100)
      } catch {
        // Could show toast error
      } finally {
        setSending(false)
      }
    }

    const handleMarkRead = async () => {
      if (!conversation || markingRead) return
      setMarkingRead(true)
      try {
        const res = await fetch(`/api/whatsapp/conversations/${conversation.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'mark_read' }),
        })
        if (res.ok) {
          onMarkRead?.(conversation.id)
        }
      } catch {
        // Silently fail
      } finally {
        setMarkingRead(false)
      }
    }

    const handleLoadMore = () => {
      if (!conversation || loadingMore) return
      const nextPage = page + 1
      setPage(nextPage)
      fetchMessages(conversation.id, nextPage, true)
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSendText()
      }
    }

    // Empty state -- no conversation selected
    if (!conversation) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#F0F2F5]">
          <div className="rounded-full bg-[#25D366]/10 p-6">
            <MessageSquare className="size-12 text-[#25D366]" />
          </div>
          <h3 className="text-lg font-medium text-[#41525D]">FloraClin WhatsApp</h3>
          <p className="max-w-sm text-center text-sm text-[#667781]">
            Selecione uma conversa para visualizar as mensagens e interagir com seus contatos.
          </p>
        </div>
      )
    }

    const windowOpen = isWindowOpen(conversation.lastInboundAt)
    const displayName = conversation.profileName || conversation.phoneNumber
    const messageGroups = groupMessagesByDate(messages)

    return (
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b bg-[#F0F2F5] px-4 py-2">
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarFallback className="bg-[#DFE5E7] text-[#54656F] text-xs">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <h3 className="text-sm font-medium text-[#111B21]">{displayName}</h3>
              <p className="text-xs text-[#667781]">{formatBrPhone(conversation.phoneNumber)}</p>
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

            {conversation.patientId ? (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/pacientes/${conversation.patientId}`} />}>
                <User className="mr-1 size-3.5" />
                Ver paciente
              </Button>
            ) : (
              conversation.prospectId && (
                <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/pacientes?novo=1&telefone=${encodeURIComponent(formatBrPhone(conversation.phoneNumber))}&nome=${encodeURIComponent(conversation.profileName ?? '')}`} />}>
                  <UserPlus className="mr-1 size-3.5" />
                  Converter
                </Button>
              )
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

          {!loading && hasMore && (
            <div className="mb-3 flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="bg-white/80 text-xs"
              >
                {loadingMore ? (
                  <Loader2 className="mr-1 size-3 animate-spin" />
                ) : (
                  <ChevronUp className="mr-1 size-3" />
                )}
                Carregar anteriores
              </Button>
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
                onClick={() => conversation && fetchMessages(conversation.id, 1, false)}
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
                {/* Date separator */}
                <div className="my-3 flex justify-center">
                  <span className="rounded-lg bg-white/90 px-3 py-1 text-xs font-medium text-[#54656F] shadow-sm">
                    {formatDateSeparator(group.messages[0].createdAt)}
                  </span>
                </div>
                <div className="space-y-1">
                  {group.messages.map((msg) => (
                    <MessageBubble key={msg.id} message={msg} />
                  ))}
                </div>
              </div>
            ))}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t bg-[#F0F2F5]">
          {!windowOpen && (
            <div className="bg-amber-50 px-4 py-2 text-xs text-amber-700 border-b border-amber-100">
              Janela de 24h expirada — mensagens serão enfileiradas
            </div>
          )}
          <div className="px-4 py-3">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => setTemplateOpen(true)}
                title="Enviar template"
              >
                <FileText className="size-5 text-[#54656F]" />
              </Button>

              <textarea
                className={cn(
                  'flex-1 resize-none rounded-lg border-0 bg-white px-3 py-2 text-sm text-[#111B21] outline-none ring-0',
                  'placeholder:text-[#667781]',
                  'focus:ring-0 focus:outline-none',
                  'min-h-[40px] max-h-[120px]'
                )}
                placeholder="Mensagem..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={sending}
              />

              <Button
                size="icon"
                onClick={handleSendText}
                disabled={!inputText.trim() || sending}
                className="bg-[#25D366] hover:bg-[#1DA851] text-white shrink-0"
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

        {/* Template picker modal */}
        <TemplatePicker
          open={templateOpen}
          onOpenChange={setTemplateOpen}
          onSelectTemplate={handleSendTemplate}
          sending={sending}
          contactName={conversation?.profileName}
        />
      </div>
    )
  }
)
