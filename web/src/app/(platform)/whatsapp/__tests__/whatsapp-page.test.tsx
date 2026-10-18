/**
 * The open conversation is mirrored in `?conversa=<id>` so that, on mobile
 * (where list and chat are separate full-screen views), the header back arrow
 * and the browser / Android back button both return to the list. Links from
 * other screens deep-link straight into a conversation, and the back arrow
 * must not leave the app when there is no list entry behind it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import WhatsAppPage from '../page'

const mockPush = vi.fn()
const mockReplace = vi.fn()
const mockBack = vi.fn()
// Next's router is stable across renders; a fresh object each call would
// re-run every effect that depends on it.
const mockRouter = { push: mockPush, replace: mockReplace, back: mockBack }
let searchParamsValue = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/whatsapp',
  useSearchParams: () => searchParamsValue,
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('@/hooks/use-whatsapp-sse', () => ({ useWhatsappSse: () => {} }))

function conversation(id: string, profileName: string, phoneNumber: string) {
  return {
    id,
    phoneNumber,
    profileName,
    prospectId: null,
    patientId: null,
    lastMessageBody: `Oi da ${profileName}`,
    lastMessageDirection: 'inbound',
    lastMessageStatus: null,
    lastMessageAt: '2026-10-18T12:00:00.000Z',
    lastInboundAt: '2026-10-18T12:00:00.000Z',
    unreadCount: 0,
    status: 'active',
  }
}

const ANA = conversation('c1', 'Ana Souza', '5511999990000')
const BIA = conversation('c2', 'Bia Lima', '5511988880000')

const ANA_MESSAGE = {
  id: 'm1',
  conversationId: 'c1',
  metaMessageId: null,
  direction: 'inbound',
  body: 'Oi, tudo bem?',
  mediaType: null,
  mediaUrl: null,
  mediaFilename: null,
  templateName: null,
  deliveryStatus: 'delivered',
  errorCode: null,
  timestamp: '2026-10-18T12:00:00.000Z',
  createdAt: '2026-10-18T12:00:00.000Z',
}

function json(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body })
}

function stubApi() {
  const fetchMock = vi.fn((url: string) => {
    const path = url.split('?')[0]
    if (path === '/api/whatsapp/conversations') return json({ data: [ANA, BIA] })
    if (path === '/api/whatsapp/conversations/c1/messages') return json({ data: [ANA_MESSAGE] })
    if (path.endsWith('/messages')) return json({ data: [] })
    const byId = [ANA, BIA].find((c) => path === `/api/whatsapp/conversations/${c.id}`)
    if (byId) return json(byId)
    return json({ error: 'Not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderPage() {
  const view = render(<WhatsAppPage />)
  // Simulates Next updating useSearchParams after router.push / replace / back.
  const navigate = (qs: string) => {
    searchParamsValue = new URLSearchParams(qs)
    view.rerender(<WhatsAppPage />)
  }
  return { ...view, navigate }
}

const messagesFetches = (fetchMock: ReturnType<typeof stubApi>, convId: string) =>
  fetchMock.mock.calls.filter(([url]) => url.startsWith(`/api/whatsapp/conversations/${convId}/messages?`)).length

const listRow = (name: string) => screen.findByRole('button', { name: new RegExp(name) })
const backButton = () => screen.queryByRole('button', { name: 'Voltar para conversas' })
// jsdom has no CSS; the list wrapper's classes decide which view mobile shows.
const listView = () => screen.getByRole('region', { name: 'Conversas' })

describe('WhatsAppPage mobile navigation', () => {
  let fetchMock: ReturnType<typeof stubApi>

  beforeEach(() => {
    vi.clearAllMocks()
    searchParamsValue = new URLSearchParams()
    Element.prototype.scrollIntoView = vi.fn()
    fetchMock = stubApi()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows only the list on mobile when nothing is open', async () => {
    renderPage()
    await listRow('Ana Souza')
    expect(listView()).not.toHaveClass('hidden')
    expect(backButton()).not.toBeInTheDocument()
    // The desktop "select a conversation" placeholder must not show alone on mobile.
    const placeholder = screen.getByText(/Selecione uma conversa/).parentElement
    expect(placeholder).toHaveClass('hidden', 'md:flex')
  })

  it('opening a conversation pushes ?conversa= and the back arrow pops that entry', async () => {
    const { navigate } = renderPage()
    fireEvent.click(await listRow('Ana Souza'))

    expect(mockPush).toHaveBeenCalledWith('/whatsapp?conversa=c1', { scroll: false })
    expect(screen.getByRole('heading', { name: 'Ana Souza' })).toBeInTheDocument()
    expect(listView()).toHaveClass('hidden', 'md:block')
    navigate('conversa=c1')

    const back = backButton()
    expect(back).toHaveClass('md:hidden')
    fireEvent.click(back!)

    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(mockReplace).not.toHaveBeenCalled()
    expect(listView()).not.toHaveClass('hidden')
    expect(backButton()).not.toBeInTheDocument()
  })

  it('browser / hardware back (param removed) returns to the list', async () => {
    const { navigate } = renderPage()
    fireEvent.click(await listRow('Ana Souza'))
    navigate('conversa=c1')
    expect(backButton()).toBeInTheDocument()

    navigate('')

    await waitFor(() => expect(backButton()).not.toBeInTheDocument())
    expect(listView()).not.toHaveClass('hidden')
  })

  it('reopening the same conversation after going back refetches its messages', async () => {
    const { navigate } = renderPage()
    fireEvent.click(await listRow('Ana Souza'))
    navigate('conversa=c1')
    await screen.findByText('Oi, tudo bem?')
    expect(messagesFetches(fetchMock, 'c1')).toBe(1)

    fireEvent.click(backButton()!)
    navigate('')
    await waitFor(() => expect(backButton()).not.toBeInTheDocument())

    fireEvent.click(await listRow('Ana Souza'))
    navigate('conversa=c1')

    await waitFor(() => expect(messagesFetches(fetchMock, 'c1')).toBe(2))
    expect(await screen.findByText('Oi, tudo bem?')).toBeInTheDocument()
    expect(screen.queryByText(/Nenhuma mensagem ainda/)).not.toBeInTheDocument()
  })

  it('switching conversations replaces the entry so back still lands on the list', async () => {
    const { navigate } = renderPage()
    fireEvent.click(await listRow('Ana Souza'))
    navigate('conversa=c1')

    fireEvent.click(await listRow('Bia Lima'))

    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(mockReplace).toHaveBeenCalledWith('/whatsapp?conversa=c2', { scroll: false })
    expect(screen.getByRole('heading', { name: 'Bia Lima' })).toBeInTheDocument()
  })

  it('a ?conversa= deep link opens that conversation and back replaces to the list', async () => {
    searchParamsValue = new URLSearchParams('conversa=c2&draft=Ol%C3%A1')
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Bia Lima' })).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Olá')).toBe(screen.getByLabelText('Mensagem'))

    fireEvent.click(backButton()!)

    expect(mockBack).not.toHaveBeenCalled()
    expect(mockReplace).toHaveBeenCalledWith('/whatsapp?draft=Ol%C3%A1', { scroll: false })
    expect(listView()).not.toHaveClass('hidden')
  })

  it('an unknown ?conversa= id falls back to the list and drops the param', async () => {
    searchParamsValue = new URLSearchParams('conversa=missing')
    renderPage()

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/whatsapp', { scroll: false }))
    expect(listView()).not.toHaveClass('hidden')
    expect(backButton()).not.toBeInTheDocument()
  })

  describe('?phone= deep link', () => {
    it('opens the matching conversation and rewrites the URL to ?conversa=', async () => {
      searchParamsValue = new URLSearchParams('phone=11988880000')
      renderPage()

      expect(await screen.findByRole('heading', { name: 'Bia Lima' })).toBeInTheDocument()
      expect(mockReplace).toHaveBeenCalledWith('/whatsapp?conversa=c2', { scroll: false })
      expect(listView()).toHaveClass('hidden', 'md:block')
      expect(screen.queryByRole('dialog', { name: 'Nova conversa' })).not.toBeInTheDocument()
    })

    it('opens the start-conversation dialog when no conversation matches', async () => {
      searchParamsValue = new URLSearchParams('phone=11977770000')
      renderPage()

      expect(await screen.findByRole('dialog', { name: 'Nova conversa' })).toBeInTheDocument()
      expect(mockReplace).not.toHaveBeenCalled()
      expect(backButton()).not.toBeInTheDocument()
    })
  })
})
