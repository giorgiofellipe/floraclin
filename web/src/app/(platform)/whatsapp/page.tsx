'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { ConversationList, type Conversation, type ConversationListHandle } from '@/components/whatsapp/conversation-list'
import { ChatPanel, type ChatPanelHandle } from '@/components/whatsapp/chat-panel'
import { useWhatsappSse } from '@/hooks/use-whatsapp-sse'
import { MessageSquare, Settings, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Message } from '@/components/whatsapp/message-bubble'

type ConfigStatus = 'loading' | 'configured' | 'not_configured'

export default function WhatsAppPage() {
  const [configStatus, setConfigStatus] = useState<ConfigStatus>('loading')
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
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

  // SSE event handlers
  const handleNewMessage = useCallback(
    (data: unknown) => {
      const msg = data as Message
      // Update the chat panel with the new message
      chatPanelRef.current?.addMessage(msg)

      // Update the conversation list entry
      if (msg.conversationId) {
        conversationListRef.current?.addOrUpdateConversation({
          id: msg.conversationId,
          lastMessageBody: msg.body,
          lastMessageAt: msg.createdAt,
          ...(msg.direction === 'inbound' ? { lastInboundAt: msg.createdAt } : {}),
        } as Conversation)
      }
    },
    []
  )

  const handleStatusUpdate = useCallback((data: unknown) => {
    const update = data as { messageId: string; status: string }
    chatPanelRef.current?.updateMessageStatus(update)
  }, [])

  const handleNewConversation = useCallback((data: unknown) => {
    const conv = data as Conversation
    conversationListRef.current?.addOrUpdateConversation(conv)
  }, [])

  const handleProspectUpdated = useCallback((data: unknown) => {
    const update = data as Conversation
    conversationListRef.current?.addOrUpdateConversation(update)

    // Also update local active conversation if it matches
    setActiveConversation((prev) => {
      if (prev && prev.id === update.id) {
        return { ...prev, ...update }
      }
      return prev
    })
  }, [])

  useWhatsappSse(
    {
      onMessage: handleNewMessage,
      onStatusUpdate: handleStatusUpdate,
      onNewConversation: handleNewConversation,
      onProspectUpdated: handleProspectUpdated,
    },
    configStatus === 'configured',
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
          onSelectConversation={setActiveConversation}
        />
      </div>

      {/* Right panel -- chat */}
      <ChatPanel ref={chatPanelRef} conversation={activeConversation} />
    </div>
  )
}
