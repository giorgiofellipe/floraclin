import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { createRef, type ReactNode } from 'react'
import { ChatPanel, MESSAGES_PAGE_SIZE, type ChatPanelHandle } from '../chat-panel'
import type { Conversation } from '../conversation-list'
import type { Message } from '../message-bubble'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

const CONVERSATION: Conversation = {
  id: 'c1',
  phoneNumber: '5511999990000',
  profileName: 'Maria Aparecida dos Santos Albuquerque de Oliveira',
  prospectId: null,
  patientId: 'p1',
  lastMessageBody: null,
  lastMessageDirection: null,
  lastMessageStatus: null,
  lastMessageAt: null,
  lastInboundAt: null,
  unreadCount: 0,
  status: 'active',
}

function message(id: string, createdAt: string): Message {
  return {
    id,
    conversationId: 'c1',
    metaMessageId: null,
    direction: 'inbound',
    body: `mensagem ${id}`,
    mediaType: null,
    mediaUrl: null,
    mediaFilename: null,
    templateName: null,
    deliveryStatus: 'delivered',
    errorCode: null,
    timestamp: createdAt,
    createdAt,
  }
}

describe('ChatPanel', () => {
  // jsdom doesn't implement scrollIntoView.
  const scrollIntoView = vi.fn<Element['scrollIntoView']>()
  const originalScrollIntoView = Element.prototype.scrollIntoView

  beforeEach(() => {
    scrollIntoView.mockClear()
    Element.prototype.scrollIntoView = scrollIntoView
  })
  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView
    vi.unstubAllGlobals()
  })

  function stubMessages(...pages: Message[][]) {
    const fetchMock = vi.fn()
    for (const data of pages) {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data }) })
    }
    vi.stubGlobal('fetch', fetchMock)
  }

  describe('back to list (mobile)', () => {
    it('renders a mobile-only, labelled back button that calls onBack', async () => {
      stubMessages([])
      const onBack = vi.fn()
      render(<ChatPanel conversation={CONVERSATION} onBack={onBack} />)

      const back = screen.getByRole('button', { name: 'Voltar para conversas' })
      expect(back).toHaveClass('md:hidden', 'size-11')
      fireEvent.click(back)
      expect(onBack).toHaveBeenCalledTimes(1)
      await screen.findByText(/Nenhuma mensagem ainda/)
    })
  })

  describe('header', () => {
    it('shows name and phone, truncating long names', async () => {
      stubMessages([])
      render(<ChatPanel conversation={CONVERSATION} onBack={() => {}} />)
      expect(screen.getByRole('heading', { name: CONVERSATION.profileName! })).toHaveClass('truncate')
      expect(screen.getByText('(11) 99999-0000')).toBeInTheDocument()
      await screen.findByText(/Nenhuma mensagem ainda/)
    })
  })

  describe('scroll to latest', () => {
    it('jumps to the latest message on open, then animates for new ones', async () => {
      stubMessages([message('m1', '2026-10-18T12:00:00.000Z')])
      const ref = createRef<ChatPanelHandle>()
      render(<ChatPanel ref={ref} conversation={CONVERSATION} />)

      await screen.findByText('mensagem m1')
      expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'end' })
      scrollIntoView.mockClear()

      act(() => ref.current!.addMessage(message('m2', '2026-10-18T12:01:00.000Z')))

      await screen.findByText('mensagem m2')
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'end' })
    })

    it('keeps position when loading older messages', async () => {
      const firstPage = Array.from({ length: MESSAGES_PAGE_SIZE }, (_, i) =>
        message(`m${i + 10}`, `2026-10-18T12:${String(i).padStart(2, '0')}:00.000Z`),
      )
      stubMessages(firstPage, [message('old', '2026-10-17T12:00:00.000Z')])
      render(<ChatPanel conversation={CONVERSATION} />)

      fireEvent.click(await screen.findByRole('button', { name: /Carregar anteriores/ }))
      scrollIntoView.mockClear()

      await screen.findByText('mensagem old')
      expect(scrollIntoView).not.toHaveBeenCalled()
    })
  })
})
