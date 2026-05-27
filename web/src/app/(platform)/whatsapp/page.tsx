'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { ConversationList, type Conversation, type ConversationListHandle } from '@/components/whatsapp/conversation-list'
import { ChatPanel, type ChatPanelHandle } from '@/components/whatsapp/chat-panel'
import { useWhatsappSse } from '@/hooks/use-whatsapp-sse'
import { StartConversationDialog } from '@/components/whatsapp/start-conversation-dialog'
import { MessageSquare, Settings, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Message } from '@/components/whatsapp/message-bubble'

type ConfigStatus = 'loading' | 'configured' | 'not_configured'

export default function WhatsAppPage() {
  const [configStatus, setConfigStatus] = useState<ConfigStatus>('loading')
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [showStartDialog, setShowStartDialog] = useState(false)
  const [conversationsLoaded, setConversationsLoaded] = useState(false)
  const conversationListRef = useRef<ConversationListHandle>(null)
  const chatPanelRef = useRef<ChatPanelHandle>(null)

  // Check if WhatsApp is configured by attempting to load conversations
  useEffect(() => {
    async function checkConfig() {
      try {
        const res = await fetch('/api/whatsapp/conversations?limit=1')
        if (res.status === 403) {
          setConfigStatus('not_configured')
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
  useEffect(() => {
    activeConvIdRef.current = activeConversation?.id ?? null
  }, [activeConversation])

  // Auto-mark-read when opening a conversation with unread messages
  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      setActiveConversation({ ...conv, unreadCount: 0 })
      if (conv.unreadCount > 0) {
        conversationListRef.current?.resetUnread(conv.id)
        fetch(`/api/whatsapp/conversations/${conv.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'mark_read' }),
        }).catch(() => {})
      }
    },
    [],
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
    const payload = data as { metaMessageId?: string; messageId?: string; status: string; conversationId?: string }
    chatPanelRef.current?.updateMessageStatus({
      messageId: payload.metaMessageId ?? payload.messageId ?? '',
      status: payload.status,
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
      messages: Array<{ id: string; metaMessageId: string; deliveryStatus: string }>
    }
    for (const msg of payload.messages) {
      chatPanelRef.current?.updateMessageStatus({
        messageId: msg.id,
        status: 'sent',
        metaMessageId: msg.metaMessageId,
      })
    }
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
      setActiveConversation(newConv)
    },
    [],
  )

  // Loading state
  if (configStatus === 'loading') {
    return (
      <div className="flex h-[calc(100vh-120px)] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Not configured state
  if (configStatus === 'not_configured') {
    return (
      <div className="flex h-[calc(100vh-120px)] flex-col items-center justify-center gap-4">
        <div className="rounded-full bg-[#25D366]/10 p-6">
          <MessageSquare className="size-16 text-[#25D366]" />
        </div>
        <h2 className="text-xl font-medium text-[#2A2A2A]">
          Configure o WhatsApp para começar
        </h2>
        <p className="max-w-md text-center text-sm text-muted-foreground">
          Conecte sua conta do WhatsApp Business nas configurações para gerenciar
          conversas, enviar templates e acompanhar prospects diretamente pelo FloraClin.
        </p>
        <Button
          className="bg-[#25D366] hover:bg-[#1DA851] text-white"
          nativeButton={false}
          render={<Link href="/configuracoes" />}
        >
          <Settings className="mr-2 size-4" />
          Ir para Configurações
        </Button>
      </div>
    )
  }

  // Full inbox layout
  return (
    <div className="-m-6 flex h-[calc(100vh-64px)] overflow-hidden bg-white">
      {/* Left sidebar -- conversation list */}
      <div className="w-[350px] shrink-0">
        <ConversationList
          ref={conversationListRef}
          activeConversationId={activeConversation?.id ?? null}
          onSelectConversation={handleSelectConversation}
          onNewConversation={() => setShowStartDialog(true)}
          onInitialLoadComplete={() => setConversationsLoaded(true)}
        />
      </div>

      {/* Right panel -- chat */}
      <ChatPanel
        ref={chatPanelRef}
        conversation={activeConversation}
        onMarkRead={(convId) => {
          conversationListRef.current?.resetUnread(convId)
          setActiveConversation((prev) => (prev?.id === convId ? { ...prev, unreadCount: 0 } : prev))
        }}
      />

      <StartConversationDialog
        open={showStartDialog}
        onOpenChange={setShowStartDialog}
        onConversationStarted={handleConversationStarted}
      />
    </div>
  )
}
