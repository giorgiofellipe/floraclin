'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ConversationList, type Conversation, type ConversationListHandle } from '@/components/whatsapp/conversation-list'
import { ChatPanel, type ChatPanelHandle } from '@/components/whatsapp/chat-panel'
import { useWhatsappSse } from '@/hooks/use-whatsapp-sse'
import { StartConversationDialog } from '@/components/whatsapp/start-conversation-dialog'
import { MessageSquare, Settings, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Message } from '@/components/whatsapp/message-bubble'
import { cn } from '@/lib/utils'

type ConfigStatus = 'loading' | 'configured' | 'not_configured' | 'no_access' | 'subscription_expired'

// Selected conversation lives in the URL so browser / Android back closes it
// on mobile and links from other screens can open one directly.
const CONVERSATION_PARAM = 'conversa'
// One-shot deep link; dropped once it has resolved to a conversation.
const PHONE_PARAM = 'phone'
// Composer text prefilled by the reschedule screen for the conversation in
// ?conversa=. Dropped whenever the open conversation changes so it can never
// land in another patient's composer.
const DRAFT_PARAM = 'draft'

// Tailwind's md breakpoint. From here up the list and the chat sit side by
// side, so opening a conversation replaces the history entry instead of
// adding one, and browser back leaves /whatsapp as it always did.
const DESKTOP_QUERY = '(min-width: 768px)'

function isDesktopViewport() {
  return window.matchMedia(DESKTOP_QUERY).matches
}

// Set in history.state on entries we push on top of the list, so the back
// arrow knows popping returns to the list (survives reload and forward).
const HISTORY_MARKER = 'floraclinInbox'

type InboxHistoryState = Record<string, unknown> & { [HISTORY_MARKER]?: boolean }

// Next copies its own keys (__NA, the router tree) into whatever state we pass,
// but skips syncing useSearchParams when the state already carries __NA (or the
// pages-router _N), treating the call as its own. So we pass everything else
// and let Next add those back.
function currentHistoryState(): InboxHistoryState {
  const state: unknown = window.history.state
  if (!state || typeof state !== 'object') return {}
  const rest: InboxHistoryState = { ...state }
  delete rest.__NA
  delete rest._N
  return rest
}

function isPushedOverList() {
  return window.history.state?.[HISTORY_MARKER] === true
}

// pushState/replaceState update the URL synchronously (no server round-trip),
// and Next keeps useSearchParams in sync with them.
function pushInboxEntry(url: string) {
  window.history.pushState({ ...currentHistoryState(), [HISTORY_MARKER]: true }, '', url)
}

function replaceInboxEntry(url: string, { pushedOverList }: { pushedOverList: boolean }) {
  window.history.replaceState({ ...currentHistoryState(), [HISTORY_MARKER]: pushedOverList }, '', url)
}

// Live-URL readers, not a render's searchParams, so taps that land before
// React re-renders still see the entry they are about to change.
function liveConversationParam() {
  return new URLSearchParams(window.location.search).get(CONVERSATION_PARAM)
}

function buildInboxUrl(convId: string | null) {
  const params = new URLSearchParams(window.location.search)
  params.delete(PHONE_PARAM)
  if (convId !== params.get(CONVERSATION_PARAM)) params.delete(DRAFT_PARAM)
  if (convId) {
    params.set(CONVERSATION_PARAM, convId)
  } else {
    params.delete(CONVERSATION_PARAM)
  }
  const qs = params.toString()
  return qs ? `${window.location.pathname}?${qs}` : window.location.pathname
}

// Back to the list: pop our own entry when it sits on top of the list,
// otherwise (deep link, ?phone=, desktop) rewrite this one so back doesn't
// leave the inbox.
function returnToListUrl() {
  if (isPushedOverList()) {
    window.history.back()
  } else {
    replaceInboxEntry(buildInboxUrl(null), { pushedOverList: false })
  }
}

// Mobile: the inbox fills the *dynamic* viewport below the app header
// (--app-header-h, plus the notch inset the header pads itself with) so the
// composer isn't pushed under the browser toolbar. The layout hides its footer
// (below md) and the install banner here. Desktop keeps its original vh-based
// height: 64px = the 52px header + 12px left from the desktop page padding.
const INBOX_HEIGHT_CLASS =
  'h-[calc(100dvh-var(--app-header-h)-env(safe-area-inset-top))] md:h-[calc(100vh-64px)]'
// Centered status screens (loading / not configured) subtract a fixed 120px for
// the surrounding chrome. On mobile that's more than the real 84px (the app
// header, --app-header-h, + 2×16px page padding), so the screen slightly
// under-fills; harmless for a centered layout.
const STATUS_HEIGHT_CLASS = 'h-[calc(100dvh-120px)] md:h-[calc(100vh-120px)]'

function WhatsAppEmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 px-4', STATUS_HEIGHT_CLASS)}>
      <div className="rounded-full bg-[#25D366]/10 p-6">
        <MessageSquare className="size-16 text-[#25D366]" />
      </div>
      <h2 className="text-xl font-medium text-charcoal">{title}</h2>
      <p className="max-w-md text-center text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  )
}

export default function WhatsAppPage() {
  const searchParams = useSearchParams()
  const [configStatus, setConfigStatus] = useState<ConfigStatus>('loading')
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [showStartDialog, setShowStartDialog] = useState(false)
  const [startDialogPhone, setStartDialogPhone] = useState<string | null>(null)
  const [conversationsLoaded, setConversationsLoaded] = useState(false)
  const draftText = searchParams.get(DRAFT_PARAM)
  const conversationListRef = useRef<ConversationListHandle>(null)
  const chatPanelRef = useRef<ChatPanelHandle>(null)
  const deepLinkHandledRef = useRef(false)
  const selectedConversationId = searchParams.get(CONVERSATION_PARAM)
  // Tied to the conversation it was linked for; ChatPanel ignores it for any
  // other one (e.g. a render where the tap is ahead of the URL).
  const draft =
    draftText && selectedConversationId ? { conversationId: selectedConversationId, text: draftText } : null

  // Check if WhatsApp is configured by attempting to load conversations
  useEffect(() => {
    async function checkConfig() {
      try {
        const res = await fetch('/api/whatsapp/conversations?limit=1')
        if (res.status === 402) {
          setConfigStatus('subscription_expired')
        } else if (res.status === 403) {
          // 403 covers two distinct cases: own-number mode without a
          // finished setup vs. the user's role lacking WhatsApp access.
          const body = await res.json().catch(() => null)
          setConfigStatus(body?.error === 'Forbidden' ? 'no_access' : 'not_configured')
        } else {
          setConfigStatus('configured')
        }
      } catch {
        setConfigStatus('not_configured')
      }
    }
    checkConfig()
  }, [])

  const activeConvIdRef = useRef<string | null>(null)

  // Every change of the open conversation's id goes through here, keeping the
  // ref in sync immediately so the URL-sync effect below doesn't refetch a
  // conversation we just opened locally.
  const showConversation = useCallback((conv: Conversation | null) => {
    activeConvIdRef.current = conv?.id ?? null
    setActiveConversation(conv)
  }, [])

  // Every open (row tap, deep link, browser forward, ?phone= match) goes
  // through here so the server and the list badge agree it has been read.
  const openConversation = useCallback(
    (conv: Conversation) => {
      showConversation({ ...conv, unreadCount: 0 })
      if (conv.unreadCount > 0) {
        conversationListRef.current?.resetUnread(conv.id)
        fetch(`/api/whatsapp/conversations/${conv.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'mark_read' }),
        }).catch(() => {})
      }
    },
    [showConversation],
  )

  // Opening from the list pushes a history entry on mobile so back returns to
  // the list; switching between conversations, and every open on desktop,
  // replaces it to keep history as it was.
  const navigateToConversation = useCallback((convId: string) => {
    const url = buildInboxUrl(convId)
    const urlHasConversation = liveConversationParam() !== null
    if (urlHasConversation || isDesktopViewport()) {
      replaceInboxEntry(url, { pushedOverList: isPushedOverList() })
    } else {
      pushInboxEntry(url)
    }
  }, [])

  const handleBackToList = useCallback(() => {
    showConversation(null)
    returnToListUrl()
  }, [showConversation])

  // URL -> selection: deep links (?conversa=), browser/hardware back and
  // forward. An id that can't be loaded is dropped so the list shows instead.
  const prevSelectedIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!conversationsLoaded) return
    const prevSelectedId = prevSelectedIdRef.current
    prevSelectedIdRef.current = selectedConversationId
    if (!selectedConversationId) {
      // Only a real id -> none transition (back) closes the chat; a late run
      // on initial load must not close one the user has just tapped.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the URL (browser back) into the open conversation
      if (prevSelectedId) showConversation(null)
      return
    }
    deepLinkHandledRef.current = true
    if (selectedConversationId === activeConvIdRef.current) return

    let cancelled = false
    fetch(`/api/whatsapp/conversations/${selectedConversationId}`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((conv: Conversation | null) => {
        if (cancelled) return
        // The user opened a different conversation locally while this loaded.
        const activeId = activeConvIdRef.current
        if (activeId !== null && activeId !== selectedConversationId) return
        if (conv) {
          openConversation(conv)
        } else {
          returnToListUrl()
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedConversationId, conversationsLoaded, showConversation, openConversation])

  // Deep-link: ?phone=<number> looks up an existing conversation by phone; if
  // none exists, opens the start-conversation dialog with the phone pre-searched
  // so the user can pick the matching patient (or auto-select if exactly one matches).
  useEffect(() => {
    if (deepLinkHandledRef.current || !conversationsLoaded) return

    const phoneParam = searchParams.get(PHONE_PARAM)
    if (!phoneParam) return
    deepLinkHandledRef.current = true

    async function openByPhone(phone: string) {
      try {
        const res = await fetch(`/api/whatsapp/conversations?search=${encodeURIComponent(phone)}&limit=20`)
        if (res.ok) {
          const data = await res.json()
          // listConversations searches by phoneNumber ILIKE, so we may get
          // partial matches — narrow to an exact-suffix match on digits.
          const phoneDigits = phone.replace(/\D/g, '')
          const match = (data.data ?? []).find((c: Conversation) => {
            const convDigits = c.phoneNumber.replace(/\D/g, '')
            return convDigits === phoneDigits || convDigits.endsWith(phoneDigits)
          })
          if (match) {
            openConversation(match)
            replaceInboxEntry(buildInboxUrl(match.id), { pushedOverList: isPushedOverList() })
            return
          }
        }
      } catch {
        // fall through to opening the start dialog
      }
      // No existing conversation — open the start dialog pre-searched.
      setStartDialogPhone(phone)
      setShowStartDialog(true)
    }
    openByPhone(phoneParam)
  }, [searchParams, conversationsLoaded, openConversation])

  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      openConversation(conv)
      if (liveConversationParam() !== conv.id) {
        navigateToConversation(conv.id)
      }
    },
    [navigateToConversation, openConversation],
  )

  // SSE event handlers
  const handleNewMessage = useCallback(
    (data: unknown) => {
      const payload = data as { conversationId: string; message: Message }
      const msg = payload.message ?? (data as Message)
      chatPanelRef.current?.addMessage(msg)

      const convId = payload.conversationId ?? msg.conversationId
      if (convId) {
        const mediaLabels: Record<string, string> = { image: 'Imagem', video: 'Video', audio: 'Audio', sticker: 'Sticker' }
        const displayBody = msg.body
          || (msg.templateName ? `[Template: ${msg.templateName}]` : null)
          || (msg.mediaType ? (mediaLabels[msg.mediaType] ?? msg.mediaFilename ?? msg.mediaType) : null)
        conversationListRef.current?.updateConversation({
          id: convId,
          ...(displayBody != null ? { lastMessageBody: displayBody } : {}),
          lastMessageDirection: msg.direction,
          lastMessageStatus: msg.deliveryStatus,
          lastMessageAt: msg.createdAt,
          ...(msg.direction === 'inbound' ? { lastInboundAt: msg.createdAt } : {}),
        })

        if (msg.direction === 'inbound' && convId !== activeConvIdRef.current) {
          conversationListRef.current?.incrementUnread(convId)
        }
      }
    },
    []
  )

  const handleStatusUpdate = useCallback((data: unknown) => {
    const payload = data as { metaMessageId?: string; messageId?: string; status: string; conversationId?: string; errorCode?: string | null }
    chatPanelRef.current?.updateMessageStatus({
      messageId: payload.metaMessageId ?? payload.messageId ?? '',
      status: payload.status,
      errorCode: payload.errorCode,
    })
    if (payload.conversationId) {
      conversationListRef.current?.updateConversation({
        id: payload.conversationId,
        lastMessageStatus: payload.status,
      })
    }
  }, [])

  const handleNewConversation = useCallback((data: unknown) => {
    const payload = data as { conversation?: Conversation } & Conversation
    const conv = payload.conversation ?? payload
    conversationListRef.current?.addOrUpdateConversation(conv)
  }, [])

  const handleProspectUpdated = useCallback((data: unknown) => {
    const update = data as Partial<Conversation> & { prospectId?: string }
    if (!update.id && update.prospectId) return
    conversationListRef.current?.addOrUpdateConversation(update as Conversation)

    // Also update local active conversation if it matches
    setActiveConversation((prev) => {
      if (prev && prev.id === update.id) {
        return { ...prev, ...update }
      }
      return prev
    })
  }, [])

  const handleQueueDrained = useCallback((data: unknown) => {
    const payload = data as {
      conversationId: string
      queuedMessageIds: string[]
    }
    chatPanelRef.current?.removeMessages(payload.queuedMessageIds)
  }, [])

  const handleQueueExpired = useCallback((data: unknown) => {
    const payload = data as {
      conversationId: string
      queuedMessageIds: string[]
    }
    for (const id of payload.queuedMessageIds) {
      chatPanelRef.current?.updateMessageStatus({
        messageId: id,
        status: 'expired',
      })
    }
  }, [])

  useWhatsappSse(
    {
      onMessage: handleNewMessage,
      onStatusUpdate: handleStatusUpdate,
      onNewConversation: handleNewConversation,
      onProspectUpdated: handleProspectUpdated,
      onQueueDrained: handleQueueDrained,
      onQueueExpired: handleQueueExpired,
    },
    configStatus === 'configured' && conversationsLoaded,
  )

  const handleConversationStarted = useCallback(
    (conv: { id: string; phoneNumber: string; profileName: string | null; patientId: string | null }) => {
      const newConv: Conversation = {
        id: conv.id,
        phoneNumber: conv.phoneNumber,
        profileName: conv.profileName,
        prospectId: null,
        patientId: conv.patientId,
        lastMessageBody: null,
        lastMessageDirection: null,
        lastMessageStatus: null,
        lastMessageAt: new Date().toISOString(),
        lastInboundAt: null,
        unreadCount: 0,
        status: 'active',
      }
      conversationListRef.current?.addOrUpdateConversation(newConv)
      showConversation(newConv)
      navigateToConversation(newConv.id)
    },
    [navigateToConversation, showConversation],
  )

  // Loading state
  if (configStatus === 'loading') {
    return (
      <div className={cn('flex items-center justify-center', STATUS_HEIGHT_CLASS)}>
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Subscription not active (expired, canceled or past_due past its period end)
  if (configStatus === 'subscription_expired') {
    return (
      <WhatsAppEmptyState
        title="Assinatura inativa"
        body="Sua assinatura não está ativa. Assine um plano para voltar a enviar e receber mensagens pelo WhatsApp."
        action={
          <Button
            className="bg-forest text-cream hover:bg-sage"
            nativeButton={false}
            render={<Link href="/configuracoes?tab=assinatura" />}
          >
            Ver planos
          </Button>
        }
      />
    )
  }

  // Role without WhatsApp access
  if (configStatus === 'no_access') {
    return (
      <WhatsAppEmptyState
        title="Sem acesso ao WhatsApp"
        body="Seu perfil não tem permissão para acessar o WhatsApp. Fale com o proprietário da clínica para liberar o acesso nas configurações."
      />
    )
  }

  // Own-number mode selected but setup not finished
  if (configStatus === 'not_configured') {
    return (
      <WhatsAppEmptyState
        title="Conclua a configuração do WhatsApp"
        body="Sua clínica está configurada para usar um número próprio de WhatsApp, mas a conexão ainda não foi concluída. Finalize a configuração, ou volte para o modo FloraClin, que funciona sem nenhuma configuração."
        action={
          <Button
            className="bg-[#25D366] hover:bg-[#1DA851] text-white"
            nativeButton={false}
            render={<Link href="/configuracoes?tab=whatsapp" />}
          >
            <Settings className="mr-2 size-4" />
            Ir para Configurações
          </Button>
        }
      />
    )
  }

  // Mobile shows either the list or the open conversation full-screen;
  // desktop always shows both side by side.
  const isConversationOpen = activeConversation !== null
  const chatPanelVisibility = isConversationOpen ? undefined : 'hidden md:flex'

  // Full inbox layout
  return (
    <div className={cn('-m-4 md:-m-6 flex overflow-hidden bg-white', INBOX_HEIGHT_CLASS)}>
      {/* Left sidebar -- conversation list */}
      <section
        aria-label="Conversas"
        className={cn('w-full min-w-0 shrink-0 md:w-[350px]', isConversationOpen && 'hidden md:block')}
      >
        <ConversationList
          ref={conversationListRef}
          activeConversationId={activeConversation?.id ?? null}
          onSelectConversation={handleSelectConversation}
          onNewConversation={() => setShowStartDialog(true)}
          onInitialLoadComplete={() => setConversationsLoaded(true)}
        />
      </section>

      {/* Right panel -- chat */}
      <ChatPanel
        ref={chatPanelRef}
        conversation={activeConversation}
        draft={draft}
        onBack={handleBackToList}
        className={chatPanelVisibility}
        onMarkRead={(convId) => {
          conversationListRef.current?.resetUnread(convId)
          setActiveConversation((prev) => (prev?.id === convId ? { ...prev, unreadCount: 0 } : prev))
        }}
      />

      <StartConversationDialog
        open={showStartDialog}
        onOpenChange={(open) => {
          setShowStartDialog(open)
          if (!open) setStartDialogPhone(null)
        }}
        onConversationStarted={handleConversationStarted}
        preselectedPhone={startDialogPhone}
      />
    </div>
  )
}
