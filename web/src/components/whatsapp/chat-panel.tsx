'use client'

import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { MessageBubble, type Message } from './message-bubble'
import { TemplatePicker } from './template-picker'
import { MOBILE_TAP_HEIGHT, MOBILE_TAP_TARGET } from './tap-targets'
import type { Conversation } from './conversation-list'
import { formatBrPhone } from '@/lib/phone'
import { findBlueprintForTemplateName } from '@/lib/whatsapp-blueprints'
import { toast } from 'sonner'
import { useSubscriptionAccess } from '@/components/layout/subscription-access'
import {
  ArrowLeft,
  Send,
  FileText,
  CheckCheck,
  User,
  UserPlus,
  MessageSquare,
  Loader2,
  ChevronUp,
  InfoIcon,
} from 'lucide-react'
import { InfoPopover } from '@/components/ui/info-popover'

const WINDOW_CLOSED_HELP =
  'O WhatsApp só permite mensagens livres até 24h após a última mensagem do paciente. ' +
  'Fora desse prazo, enviamos um template pedindo que ele responda. Quando ele responder, ' +
  'as mensagens da fila são enviadas. Se ele não responder em 24h, elas expiram. ' +
  'Cada mensagem enviada usa créditos.'

export const MESSAGES_PAGE_SIZE = 50

// Header actions collapse to 44px icon buttons on mobile; labelled on desktop.
const HEADER_ACTION_CLASS = 'h-11 min-w-11 px-0 md:h-7 md:min-w-0 md:px-2.5'

export interface ChatPanelHandle {
  addMessage: (msg: Message) => void
  updateMessageStatus: (data: { messageId: string; status: string; metaMessageId?: string; errorCode?: string | null }) => void
  removeMessages: (ids: string[]) => void
}

interface ChatPanelProps {
  conversation: Conversation | null
  onMarkRead?: (convId: string) => void
  /** Prefills the composer, only when `conversationId` is the one opening. */
  draft?: { conversationId: string; text: string } | null
  /** Mobile only: returns to the conversation list. */
  onBack?: () => void
  className?: string
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

function isConfirmationTemplate(templateName: string | null): boolean {
  return !!templateName && findBlueprintForTemplateName(templateName)?.purposeKey === 'appointment_confirmation'
}

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(
  function ChatPanel({ conversation, onMarkRead, draft, onBack, className }, ref) {
    // Read-only mode: the inbox stays readable, the composer is replaced by
    // a notice instead of sends that would only fail with a 402.
    const { readOnly, openPaywall } = useSubscriptionAccess()
    const [messages, setMessages] = useState<Message[]>([])
    const [loading, setLoading] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [hasMore, setHasMore] = useState(false)
    const [page, setPage] = useState(1)
    const [inputText, setInputText] = useState('')
    const [sending, setSending] = useState(false)
    const [templateOpen, setTemplateOpen] = useState(false)
    const [markingRead, setMarkingRead] = useState(false)
    const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null)
    const [fetchError, setFetchError] = useState<string | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const prevConvIdRef = useRef<string | null>(null)
    const firstQueueRef = useRef(true)
    // Jump (no animation) to the latest message when a conversation opens, so
    // the user isn't animated through the whole history; animate afterwards.
    const jumpOnNextScrollRef = useRef(true)

    const scrollToBottom = useCallback(() => {
      const behavior: ScrollBehavior = jumpOnNextScrollRef.current ? 'auto' : 'smooth'
      jumpOnNextScrollRef.current = false
      messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' })
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
            limit: String(MESSAGES_PAGE_SIZE),
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
          setHasMore(fetched.length === MESSAGES_PAGE_SIZE)
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
        // Reopening the same conversation must refetch.
        prevConvIdRef.current = null
        return
      }
      if (conversation.id !== prevConvIdRef.current) {
        prevConvIdRef.current = conversation.id
        setPage(1)
        setInputText(draft?.conversationId === conversation.id ? draft.text : '')
        firstQueueRef.current = true
        jumpOnNextScrollRef.current = true
        fetchMessages(conversation.id, 1, false)
      }
    }, [conversation, fetchMessages])

    // Scroll to the latest message on open and whenever a newer one arrives.
    // Keyed on the last id so "Carregar anteriores" (prepend) keeps position.
    const lastMessageId = messages.at(-1)?.id
    useEffect(() => {
      if (!loading && lastMessageId) {
        scrollToBottom()
      }
    }, [loading, lastMessageId, scrollToBottom])

    const addMessage = useCallback(
      (msg: Message) => {
        if (!conversation || msg.conversationId !== conversation.id) return
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev
          return [...prev, msg]
        })
      },
      [conversation]
    )

    const updateMessageStatus = useCallback(
      (data: { messageId: string; status: string; metaMessageId?: string; errorCode?: string | null }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.messageId || m.metaMessageId === data.messageId
              ? {
                  ...m,
                  deliveryStatus: data.status,
                  ...(data.metaMessageId ? { metaMessageId: data.metaMessageId } : {}),
                  ...(data.errorCode !== undefined ? { errorCode: data.errorCode } : {}),
                }
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

    const handleRetryMessage = async (message: Message) => {
      if (!conversation || retryingMessageId) return
      setRetryingMessageId(message.id)
      try {
        const res = await fetch(
          `/api/whatsapp/conversations/${conversation.id}/messages/${message.id}/retry`,
          { method: 'POST' },
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.error || 'Erro ao reenviar mensagem')
          return
        }

        const newMsg: Message | null = data.data
        const appendHere = newMsg?.conversationId === conversation.id
        setMessages((prev) => {
          const updated = prev.map((m) => m.id === message.id ? { ...m, deliveryStatus: 'retried' } : m)
          if (!newMsg || !appendHere || updated.some((m) => m.id === newMsg.id)) return updated
          return [...updated, newMsg]
        })
        if (appendHere) setTimeout(() => scrollToBottom(), 100)
        if (data.warning) {
          toast.warning(data.warning)
        } else if (!appendHere) {
          toast.success('Mensagem reenviada para o telefone atual do paciente.')
        }
      } catch {
        toast.error('Erro ao reenviar mensagem')
      } finally {
        setRetryingMessageId(null)
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
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Erro ao enviar template' }))
          toast.error(err.error || 'Erro ao enviar template')
          return
        }
        const data = await res.json()
        const newMsg: Message = data.data ?? data
        setMessages((prev) => [...prev, newMsg])
        setTemplateOpen(false)
        setTimeout(() => scrollToBottom(), 100)
      } catch {
        toast.error('Erro ao enviar template')
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
        <div className={cn('flex flex-1 flex-col items-center justify-center gap-3 bg-[#F0F2F5]', className)}>
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
      <div className={cn('flex min-w-0 flex-1 flex-col', className)}>
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b bg-[#F0F2F5] py-2 pr-2 pl-1 md:px-4">
          <div className="flex min-w-0 items-center gap-2 md:gap-3">
            {onBack && (
              <Button
                variant="ghost"
                size="icon"
                className={cn('md:hidden', MOBILE_TAP_TARGET)}
                onClick={onBack}
                aria-label="Voltar para conversas"
              >
                <ArrowLeft className="size-5 text-[#54656F]" />
              </Button>
            )}
            <Avatar className="shrink-0">
              <AvatarFallback className="bg-[#DFE5E7] text-[#54656F] text-xs">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-medium text-[#111B21]">{displayName}</h3>
              <p className="truncate text-xs text-[#667781]">{formatBrPhone(conversation.phoneNumber)}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1 md:gap-2">
            {conversation.unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className={HEADER_ACTION_CLASS}
                onClick={handleMarkRead}
                disabled={markingRead}
                aria-label="Marcar como lido"
              >
                <CheckCheck className="size-3.5 md:mr-1" />
                <span className="hidden md:inline">Marcar como lido</span>
              </Button>
            )}

            {conversation.patientId ? (
              <Button variant="outline" size="sm" className={HEADER_ACTION_CLASS} aria-label="Ver paciente" nativeButton={false} render={<Link href={`/pacientes/${conversation.patientId}`} />}>
                <User className="size-3.5 md:mr-1" />
                <span className="hidden md:inline">Ver paciente</span>
              </Button>
            ) : (
              conversation.prospectId && (
                <Button variant="outline" size="sm" className={HEADER_ACTION_CLASS} aria-label="Converter" nativeButton={false} render={<Link href={`/pacientes?novo=1&telefone=${encodeURIComponent(formatBrPhone(conversation.phoneNumber))}&nome=${encodeURIComponent(conversation.profileName ?? '')}`} />}>
                  <UserPlus className="size-3.5 md:mr-1" />
                  <span className="hidden md:inline">Converter</span>
                </Button>
              )
            )}
          </div>
        </div>

        {/* Messages area */}
        <div
          className="flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain bg-[#ECE5DD] px-3 py-3 md:px-4"
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
                className={cn('bg-white/80 text-xs', MOBILE_TAP_HEIGHT)}
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
                className={cn('bg-white/80 text-xs', MOBILE_TAP_HEIGHT)}
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
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      onRetry={!readOnly && isConfirmationTemplate(msg.templateName) ? handleRetryMessage : undefined}
                      retrying={retryingMessageId === msg.id}
                    />
                  ))}
                </div>
              </div>
            ))}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t bg-[#F0F2F5]">
          {!windowOpen && !readOnly && (
            <div className="flex items-center gap-1.5 bg-amber-50 px-4 py-2 text-xs text-amber-700 border-b border-amber-100">
              Janela de 24h fechada: novas mensagens ficam na fila
              <InfoPopover content={WINDOW_CLOSED_HELP} className="cursor-help">
                <InfoIcon className="size-3.5" aria-label="Entenda a janela de 24h" />
              </InfoPopover>
            </div>
          )}
          {readOnly ? (
            <div
              role="status"
              data-testid="whatsapp-read-only"
              className="flex flex-col gap-2 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-sm text-[#54656F] md:flex-row md:items-center md:justify-between"
            >
              <p>
                <span className="font-medium text-[#111B21]">Assinatura inativa.</span> Você pode ler as
                conversas, mas não enviar mensagens. Assine um plano para voltar a usar o WhatsApp.
              </p>
              <Button
                size="sm"
                className="shrink-0 bg-forest text-cream hover:bg-sage"
                onClick={openPaywall}
              >
                Ver planos
              </Button>
            </div>
          ) : (
          <div className="px-2 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:px-4">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className={cn('shrink-0', MOBILE_TAP_TARGET)}
                onClick={() => setTemplateOpen(true)}
                title="Enviar template"
                aria-label="Enviar template"
              >
                <FileText className="size-5 text-[#54656F]" />
              </Button>

              <textarea
                className={cn(
                  // text-base on mobile: iOS zooms the page when focusing inputs under 16px.
                  'min-w-0 flex-1 resize-none rounded-lg border-0 bg-white px-3 py-2 text-base text-[#111B21] outline-none ring-0 md:text-sm',
                  'placeholder:text-[#667781]',
                  'focus:ring-0 focus:outline-none',
                  'min-h-[40px] max-h-[120px]'
                )}
                placeholder="Mensagem..."
                aria-label="Mensagem"
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
                className={cn('bg-[#25D366] hover:bg-[#1DA851] text-white shrink-0', MOBILE_TAP_TARGET)}
                aria-label="Enviar mensagem"
              >
                {sending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </Button>
            </div>
          </div>
          )}
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
