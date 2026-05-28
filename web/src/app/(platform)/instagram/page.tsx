'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ConversationList, type InstagramConversation } from '@/components/instagram/conversation-list'
import { StartConversationDialog } from '@/components/instagram/start-conversation-dialog'
import { useInstagramSse } from '@/hooks/use-instagram-sse'
import { ChatPanel } from '@/components/instagram/chat-panel'
import { Button } from '@/components/ui/button'
import { Camera, Loader2, Settings, MessageSquarePlus } from 'lucide-react'

type ConfigStatus = 'loading' | 'configured' | 'not_configured'

export default function InstagramPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const conversaParam = searchParams.get('conversa')

  const [configStatus, setConfigStatus] = useState<ConfigStatus>('loading')
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    conversaParam,
  )
  const [activeConversation, setActiveConversation] = useState<InstagramConversation | null>(null)
  const [showStartDialog, setShowStartDialog] = useState(false)
  // Bumped on any SSE event that should invalidate the cached list / messages.
  // Each consumer keys off these to refetch (mirrors the WA invalidation pattern,
  // adapted for the imperative refs that aren't available on Instagram components yet).
  const [listRefreshKey, setListRefreshKey] = useState(0)
  const [chatRefreshKey, setChatRefreshKey] = useState(0)

  // Probe whether Instagram is configured for this tenant.
  useEffect(() => {
    let cancelled = false
    async function checkConfig() {
      try {
        const res = await fetch('/api/instagram/conversations?limit=1')
        if (cancelled) return
        setConfigStatus(res.status === 403 ? 'not_configured' : 'configured')
      } catch {
        if (!cancelled) setConfigStatus('not_configured')
      }
    }
    checkConfig()
    return () => {
      cancelled = true
    }
  }, [])

  // Keep state in sync with the URL deep link.
  useEffect(() => {
    if (conversaParam !== selectedConversationId) {
      setSelectedConversationId(conversaParam)
    }
    // We intentionally only react to URL changes here; selection→URL is handled
    // in handleSelect to avoid a render loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversaParam])

  // Fetch the selected conversation object so ChatPanel receives the full row.
  useEffect(() => {
    if (!selectedConversationId) {
      setActiveConversation(null)
      return
    }
    let cancelled = false
    fetch(`/api/instagram/conversations/${selectedConversationId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((conv: InstagramConversation | null) => {
        if (!cancelled && conv) setActiveConversation(conv)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [selectedConversationId, chatRefreshKey])

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedConversationId(id)
      const params = new URLSearchParams(searchParams.toString())
      params.set('conversa', id)
      router.replace(`/instagram?${params.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  // SSE → invalidate caches by bumping refresh keys.
  const invalidateList = useCallback(() => setListRefreshKey((k) => k + 1), [])
  const invalidateChat = useCallback(() => setChatRefreshKey((k) => k + 1), [])

  const handleNewMessage = useCallback(
    (data: unknown) => {
      invalidateList()
      const payload = data as { conversationId?: string }
      if (payload?.conversationId && payload.conversationId === selectedConversationId) {
        invalidateChat()
      }
    },
    [selectedConversationId, invalidateList, invalidateChat],
  )

  const handleStatusUpdate = useCallback(
    (data: unknown) => {
      invalidateList()
      const payload = data as { conversationId?: string }
      if (payload?.conversationId && payload.conversationId === selectedConversationId) {
        invalidateChat()
      }
    },
    [selectedConversationId, invalidateList, invalidateChat],
  )

  const handleNewConversation = useCallback(() => {
    invalidateList()
  }, [invalidateList])

  const handleProspectUpdated = useCallback(
    (data: unknown) => {
      invalidateList()
      const payload = data as { id?: string; conversationId?: string }
      const convId = payload?.conversationId ?? payload?.id
      if (convId && convId === selectedConversationId) {
        invalidateChat()
      }
    },
    [selectedConversationId, invalidateList, invalidateChat],
  )

  useInstagramSse(
    {
      onMessage: handleNewMessage,
      onStatusUpdate: handleStatusUpdate,
      onNewConversation: handleNewConversation,
      onProspectUpdated: handleProspectUpdated,
    },
    configStatus === 'configured',
  )

  if (configStatus === 'loading') {
    return (
      <div className="flex h-[calc(100vh-120px)] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (configStatus === 'not_configured') {
    return (
      <div className="flex h-[calc(100vh-120px)] flex-col items-center justify-center gap-4">
        <div className="rounded-full bg-fuchsia-500/10 p-6">
          <Camera className="size-16 text-fuchsia-600" />
        </div>
        <h2 className="text-xl font-medium text-[#2A2A2A]">
          Configure o Instagram para começar
        </h2>
        <p className="max-w-md text-center text-sm text-muted-foreground">
          Conecte sua conta do Instagram nas configurações para gerenciar conversas e
          acompanhar prospects diretamente pelo FloraClin.
        </p>
        <Button
          className="bg-fuchsia-600 text-white hover:bg-fuchsia-700"
          nativeButton={false}
          render={<Link href="/configuracoes" />}
        >
          <Settings className="mr-2 size-4" />
          Ir para Configurações
        </Button>
      </div>
    )
  }

  return (
    <div className="-m-6 flex h-[calc(100vh-64px)] overflow-hidden bg-white">
      {/* Left sidebar -- conversation list */}
      <div className="flex w-[350px] shrink-0 flex-col border-r">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium text-[#111B21]">Instagram</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 px-2 text-xs text-fuchsia-700 hover:bg-fuchsia-500/10"
            onClick={() => setShowStartDialog(true)}
          >
            <MessageSquarePlus className="size-4" />
            Nova conversa
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <ConversationList
            key={`list-${listRefreshKey}`}
            activeConversationId={selectedConversationId ?? undefined}
            onSelect={handleSelect}
          />
        </div>
      </div>

      {/* Right panel -- chat */}
      <div className="min-w-0 flex-1">
        {selectedConversationId && activeConversation ? (
          <ChatPanel
            key={`chat-${selectedConversationId}-${chatRefreshKey}`}
            conversation={activeConversation}
          />
        ) : selectedConversationId ? (
          <div className="flex h-full items-center justify-center bg-[#F0F2F5]">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#F0F2F5] text-center">
            <div className="rounded-full bg-fuchsia-500/10 p-5">
              <Camera className="size-12 text-fuchsia-600" />
            </div>
            <h3 className="text-base font-medium text-[#111B21]">
              Selecione uma conversa
            </h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Escolha uma conversa à esquerda ou inicie uma nova para começar a
              responder mensagens do Instagram.
            </p>
          </div>
        )}
      </div>

      <StartConversationDialog
        open={showStartDialog}
        onOpenChange={setShowStartDialog}
      />
    </div>
  )
}
