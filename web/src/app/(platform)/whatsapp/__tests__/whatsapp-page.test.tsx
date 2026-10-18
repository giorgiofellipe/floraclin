/**
 * The open conversation is mirrored in `?conversa=<id>` so that, on mobile
 * (where list and chat are separate full-screen views), the header back arrow
 * and the browser / Android back button both return to the list. Links from
 * other screens deep-link straight into a conversation, and the back arrow
 * must not leave the inbox when there is no list entry behind it.
 *
 * The page writes the URL with window.history.pushState / replaceState. The
 * next/navigation mock below stands in for Next's patch of those methods: it
 * copies Next's internal state keys into the entry and updates
 * useSearchParams on the next task (Next applies it in a transition, so a
 * render can lag behind the URL). Like Next, it treats a call whose state
 * already carries `__NA` as its own and does not sync it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import WhatsAppPage from '../page'

const router = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  return {
    // The URL as far as useSearchParams knows.
    search: '',
    listeners,
    sync() {
      router.search = window.location.search
      for (const listener of listeners) listener()
    },
  }
})

vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react')
  const subscribe = (listener: () => void) => {
    router.listeners.add(listener)
    return () => {
      router.listeners.delete(listener)
    }
  }
  return {
    usePathname: () => window.location.pathname,
    useSearchParams: () => {
      const search = useSyncExternalStore(subscribe, () => router.search)
      return useMemo(() => new URLSearchParams(search), [search])
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('@/hooks/use-whatsapp-sse', () => ({ useWhatsappSse: () => {} }))

const NEXT_STATE = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: 'tree' }
const originalPushState = History.prototype.pushState
const originalReplaceState = History.prototype.replaceState

type HistoryState = Record<string, unknown> | null

// Mirrors Next's patched pushState/replaceState: state already carrying `__NA`
// or `_N` passes through untouched; otherwise Next copies its keys from the
// *current* entry and syncs useSearchParams.
function patchHistoryLikeNext() {
  const patch = (original: typeof originalPushState) =>
    function (this: History, data: HistoryState, unused: string, url?: string | URL | null) {
      if (data?.__NA || data?._N) return original.call(this, data, unused, url)
      const current = (window.history.state ?? {}) as Record<string, unknown>
      const next: Record<string, unknown> = { ...data }
      if (current.__NA) next.__NA = current.__NA
      if (current.__PRIVATE_NEXTJS_INTERNALS_TREE) {
        next.__PRIVATE_NEXTJS_INTERNALS_TREE = current.__PRIVATE_NEXTJS_INTERNALS_TREE
      }
      original.call(this, next, unused, url)
      setTimeout(() => act(() => router.sync()))
    }
  return {
    push: vi.spyOn(window.history, 'pushState').mockImplementation(patch(originalPushState)),
    replace: vi.spyOn(window.history, 'replaceState').mockImplementation(patch(originalReplaceState)),
    back: vi.spyOn(window.history, 'back'),
  }
}

const onPopState = () => act(() => router.sync())

// Puts the browser on `url` before the page mounts, as a load or reload would.
// Pushing (rather than replacing) drops forward entries left by earlier tests,
// so history.length comparisons hold. `belowIt` adds a list entry underneath,
// like one we pushed earlier.
function startAt(url: string, { marker, belowIt }: { marker?: boolean; belowIt?: string } = {}) {
  if (belowIt) originalPushState.call(window.history, { ...NEXT_STATE }, '', belowIt)
  originalPushState.call(window.history, { ...NEXT_STATE, floraclinInbox: marker }, '', url)
  router.search = window.location.search
}

// md breakpoint: list and chat side by side.
function stubViewport(viewport: 'mobile' | 'desktop') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(min-width: 768px)' && viewport === 'desktop',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
}

function conversation(id: string, profileName: string, phoneNumber: string, unreadCount = 0) {
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
    unreadCount,
    status: 'active',
  }
}

const ANA = conversation('c1', 'Ana Souza', '5511999990000')
const BIA = conversation('c2', 'Bia Lima', '5511988880000')
const CAIO = conversation('c3', 'Caio Reis', '5511977770000', 2)

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
  const conversations = [ANA, BIA, CAIO]
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = url.split('?')[0]
    if (init?.method === 'PATCH') return json({ ok: true })
    if (path === '/api/whatsapp/conversations') return json({ data: conversations })
    if (path === '/api/whatsapp/conversations/c1/messages') return json({ data: [ANA_MESSAGE] })
    if (path.endsWith('/messages')) return json({ data: [] })
    const byId = conversations.find((c) => path === `/api/whatsapp/conversations/${c.id}`)
    if (byId) return json(byId)
    return json({ error: 'Not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const messagesFetches = (fetchMock: ReturnType<typeof stubApi>, convId: string) =>
  fetchMock.mock.calls.filter(([url]) => url.startsWith(`/api/whatsapp/conversations/${convId}/messages?`)).length

const markReadCalls = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PATCH' && init.body === JSON.stringify({ action: 'mark_read' }))
    .map(([url]) => url)

const listRow = (name: string) => screen.findByRole('button', { name: new RegExp(name) })
const backButton = () => screen.queryByRole('button', { name: 'Voltar para conversas' })
// jsdom has no CSS; the list wrapper's classes decide which view mobile shows.
const listView = () => screen.getByRole('region', { name: 'Conversas' })
const currentUrl = () => `${window.location.pathname}${window.location.search}`
const composer = () => screen.getByLabelText('Mensagem')

describe('WhatsAppPage navigation', () => {
  let fetchMock: ReturnType<typeof stubApi>
  let history: ReturnType<typeof patchHistoryLikeNext>

  beforeEach(() => {
    vi.clearAllMocks()
    startAt('/whatsapp')
    stubViewport('mobile')
    history = patchHistoryLikeNext()
    window.addEventListener('popstate', onPopState)
    // jsdom has no scrollIntoView; ChatPanel scrolls to the latest message.
    Element.prototype.scrollIntoView = vi.fn()
    fetchMock = stubApi()
  })
  afterEach(() => {
    window.removeEventListener('popstate', onPopState)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (window as { matchMedia?: unknown }).matchMedia
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('shows only the list on mobile when nothing is open', async () => {
    render(<WhatsAppPage />)
    await listRow('Ana Souza')
    // Unread badge, which opening from the URL must clear (see below).
    expect(within(await listRow('Caio Reis')).getByText('2')).toBeInTheDocument()
    expect(markReadCalls(fetchMock)).toEqual([])
    expect(listView()).not.toHaveClass('hidden')
    expect(backButton()).not.toBeInTheDocument()
    // The desktop "select a conversation" placeholder must not show alone on mobile.
    const placeholder = screen.getByText(/Selecione uma conversa/).parentElement
    expect(placeholder).toHaveClass('hidden', 'md:flex')
  })

  it('opening a conversation pushes a marked ?conversa= entry and the back arrow pops it', async () => {
    render(<WhatsAppPage />)
    const lengthBefore = window.history.length
    fireEvent.click(await listRow('Ana Souza'))

    expect(history.push).toHaveBeenCalledTimes(1)
    expect(currentUrl()).toBe('/whatsapp?conversa=c1')
    expect(window.history.length).toBe(lengthBefore + 1)
    // Our marker sits next to Next's own keys, and Next still synced the URL.
    expect(window.history.state).toMatchObject({ ...NEXT_STATE, floraclinInbox: true })
    await waitFor(() => expect(router.search).toBe('?conversa=c1'))
    expect(screen.getByRole('heading', { name: 'Ana Souza' })).toBeInTheDocument()
    expect(listView()).toHaveClass('hidden', 'md:block')

    const back = backButton()
    expect(back).toHaveClass('md:hidden')
    fireEvent.click(back!)

    expect(history.back).toHaveBeenCalledTimes(1)
    expect(history.replace).not.toHaveBeenCalled()
    expect(listView()).not.toHaveClass('hidden')
    expect(backButton()).not.toBeInTheDocument()
    await waitFor(() => expect(currentUrl()).toBe('/whatsapp'))
  })

  it('a fast double tap pushes only one entry', async () => {
    render(<WhatsAppPage />)
    const lengthBefore = window.history.length
    const ana = await listRow('Ana Souza')
    const bia = await listRow('Bia Lima')

    // Second tap lands before the page re-renders with the new URL.
    fireEvent.click(ana)
    fireEvent.click(bia)

    expect(history.push).toHaveBeenCalledTimes(1)
    expect(window.history.length).toBe(lengthBefore + 1)
    expect(currentUrl()).toBe('/whatsapp?conversa=c2')
    expect(screen.getByRole('heading', { name: 'Bia Lima' })).toBeInTheDocument()

    // Back still lands on the list, not on Ana.
    fireEvent.click(backButton()!)
    await waitFor(() => expect(currentUrl()).toBe('/whatsapp'))
    expect(history.back).toHaveBeenCalledTimes(1)
  })

  it('on desktop, opening and switching conversations replace the entry instead of adding one', async () => {
    stubViewport('desktop')
    render(<WhatsAppPage />)
    const lengthBefore = window.history.length

    fireEvent.click(await listRow('Ana Souza'))
    expect(currentUrl()).toBe('/whatsapp?conversa=c1')
    fireEvent.click(await listRow('Bia Lima'))
    expect(currentUrl()).toBe('/whatsapp?conversa=c2')

    expect(history.push).not.toHaveBeenCalled()
    expect(history.replace).toHaveBeenCalledTimes(2)
    expect(window.history.length).toBe(lengthBefore)
    expect(screen.getByRole('heading', { name: 'Bia Lima' })).toBeInTheDocument()
  })

  it('browser / hardware back returns to the list', async () => {
    render(<WhatsAppPage />)
    fireEvent.click(await listRow('Ana Souza'))
    await waitFor(() => expect(router.search).toBe('?conversa=c1'))
    expect(backButton()).toBeInTheDocument()

    act(() => window.history.back())

    await waitFor(() => expect(backButton()).not.toBeInTheDocument())
    expect(currentUrl()).toBe('/whatsapp')
    expect(listView()).not.toHaveClass('hidden')
  })

  it('reopening the same conversation after going back refetches its messages', async () => {
    render(<WhatsAppPage />)
    fireEvent.click(await listRow('Ana Souza'))
    await screen.findByText('Oi, tudo bem?')
    expect(messagesFetches(fetchMock, 'c1')).toBe(1)

    fireEvent.click(backButton()!)
    await waitFor(() => expect(router.search).toBe(''))

    fireEvent.click(await listRow('Ana Souza'))

    await waitFor(() => expect(messagesFetches(fetchMock, 'c1')).toBe(2))
    expect(await screen.findByText('Oi, tudo bem?')).toBeInTheDocument()
    expect(screen.queryByText(/Nenhuma mensagem ainda/)).not.toBeInTheDocument()
  })

  it('switching conversations replaces the entry so back still lands on the list', async () => {
    render(<WhatsAppPage />)
    fireEvent.click(await listRow('Ana Souza'))
    await waitFor(() => expect(router.search).toBe('?conversa=c1'))
    const lengthAfterOpen = window.history.length

    fireEvent.click(await listRow('Bia Lima'))

    expect(history.push).toHaveBeenCalledTimes(1)
    expect(window.history.length).toBe(lengthAfterOpen)
    expect(currentUrl()).toBe('/whatsapp?conversa=c2')
    expect(window.history.state).toMatchObject({ floraclinInbox: true })
    expect(screen.getByRole('heading', { name: 'Bia Lima' })).toBeInTheDocument()
  })

  it('a row tap while the back arrow pop is in flight is ignored', async () => {
    render(<WhatsAppPage />)
    fireEvent.click(await listRow('Ana Souza'))
    await waitFor(() => expect(router.search).toBe('?conversa=c1'))
    const lengthAfterOpen = window.history.length

    fireEvent.click(backButton()!)
    // history.back() is async: the URL is still ?conversa=c1 here.
    expect(currentUrl()).toBe('/whatsapp?conversa=c1')
    fireEvent.click(screen.getByRole('button', { name: /Bia Lima/ }))

    // The entry being left is not rewritten to Bia, and Bia doesn't open.
    expect(history.replace).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Bia Lima' })).not.toBeInTheDocument()
    await waitFor(() => expect(currentUrl()).toBe('/whatsapp'))
    expect(window.history.length).toBe(lengthAfterOpen)
    expect(listView()).not.toHaveClass('hidden')

    // Once the pop has landed, taps open again.
    fireEvent.click(await listRow('Bia Lima'))
    expect(history.push).toHaveBeenCalledTimes(2)
    expect(currentUrl()).toBe('/whatsapp?conversa=c2')
    expect(screen.getByRole('heading', { name: 'Bia Lima' })).toBeInTheDocument()
  })

  it('a pageshow (bfcache restore) clears a back arrow pop that never landed', async () => {
    render(<WhatsAppPage />)
    fireEvent.click(await listRow('Ana Souza'))
    await waitFor(() => expect(router.search).toBe('?conversa=c1'))

    // The pop crosses into another document, so this page never sees popstate.
    history.back.mockImplementation(() => {})
    fireEvent.click(backButton()!)
    expect(history.back).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /Bia Lima/ }))
    expect(screen.queryByRole('heading', { name: 'Bia Lima' })).not.toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('pageshow'))
    })
    fireEvent.click(screen.getByRole('button', { name: /Bia Lima/ }))

    expect(screen.getByRole('heading', { name: 'Bia Lima' })).toBeInTheDocument()
  })

  describe('back arrow and our history marker', () => {
    it('after a reload of a pushed entry, pops back to the list instead of adding another', async () => {
      startAt('/whatsapp?conversa=c1', { marker: true, belowIt: '/whatsapp' })
      const lengthBefore = window.history.length
      render(<WhatsAppPage />)
      expect(await screen.findByRole('heading', { name: 'Ana Souza' })).toBeInTheDocument()

      fireEvent.click(backButton()!)

      expect(history.back).toHaveBeenCalledTimes(1)
      expect(history.replace).not.toHaveBeenCalled()
      await waitFor(() => expect(currentUrl()).toBe('/whatsapp'))
      expect(window.history.length).toBe(lengthBefore)
    })

    it('after browser back then forward, pops back to the list', async () => {
      render(<WhatsAppPage />)
      fireEvent.click(await listRow('Ana Souza'))
      await waitFor(() => expect(router.search).toBe('?conversa=c1'))
      act(() => window.history.back())
      await waitFor(() => expect(backButton()).not.toBeInTheDocument())

      act(() => window.history.forward())
      expect(await screen.findByRole('heading', { name: 'Ana Souza' })).toBeInTheDocument()
      history.back.mockClear()
      fireEvent.click(backButton()!)

      expect(history.back).toHaveBeenCalledTimes(1)
      expect(history.replace).not.toHaveBeenCalled()
      await waitFor(() => expect(currentUrl()).toBe('/whatsapp'))
    })

    it('a ?conversa= deep link (no marker) is replaced by the list, so back does not leave the inbox', async () => {
      startAt('/whatsapp?conversa=c2')
      const lengthBefore = window.history.length
      render(<WhatsAppPage />)
      expect(await screen.findByRole('heading', { name: 'Bia Lima' })).toBeInTheDocument()

      fireEvent.click(backButton()!)

      expect(history.back).not.toHaveBeenCalled()
      expect(currentUrl()).toBe('/whatsapp')
      expect(window.history.length).toBe(lengthBefore)
      expect(window.history.state).toMatchObject({ ...NEXT_STATE, floraclinInbox: false })
      expect(listView()).not.toHaveClass('hidden')
    })
  })

  it('an unknown ?conversa= id falls back to the list and drops the param', async () => {
    startAt('/whatsapp?conversa=missing')
    render(<WhatsAppPage />)

    await waitFor(() => expect(currentUrl()).toBe('/whatsapp'))
    expect(history.back).not.toHaveBeenCalled()
    expect(listView()).not.toHaveClass('hidden')
    expect(backButton()).not.toBeInTheDocument()
  })

  describe('reschedule draft (?draft=)', () => {
    it('prefills the linked conversation and is dropped when going back to the list', async () => {
      startAt('/whatsapp?conversa=c2&draft=Ol%C3%A1')
      render(<WhatsAppPage />)

      expect(await screen.findByDisplayValue('Olá')).toBe(composer())
      fireEvent.click(backButton()!)
      expect(currentUrl()).toBe('/whatsapp')

      fireEvent.click(await listRow('Ana Souza'))
      expect(currentUrl()).toBe('/whatsapp?conversa=c1')
      await screen.findByText('Oi, tudo bem?')
      expect(composer()).toHaveValue('')
    })

    it('does not prefill a different conversation opened from the list', async () => {
      startAt('/whatsapp?conversa=c2&draft=Ol%C3%A1')
      render(<WhatsAppPage />)
      expect(await screen.findByDisplayValue('Olá')).toBe(composer())

      fireEvent.click(await listRow('Ana Souza'))

      expect(screen.getByRole('heading', { name: 'Ana Souza' })).toBeInTheDocument()
      expect(composer()).toHaveValue('')
      expect(currentUrl()).toBe('/whatsapp?conversa=c1')
      await waitFor(() => expect(router.search).toBe('?conversa=c1'))
      await screen.findByText('Oi, tudo bem?')
      expect(composer()).toHaveValue('')
    })
  })

  describe('mark as read when opened from the URL', () => {
    it('a ?conversa= deep link with unread messages marks it read and clears the list badge', async () => {
      startAt('/whatsapp?conversa=c3')
      render(<WhatsAppPage />)
      expect(await screen.findByRole('heading', { name: 'Caio Reis' })).toBeInTheDocument()

      await waitFor(() => expect(markReadCalls(fetchMock)).toEqual(['/api/whatsapp/conversations/c3']))
      expect(within(await listRow('Caio Reis')).queryByText('2')).not.toBeInTheDocument()
    })

    it('a conversation without unread messages is not marked read again', async () => {
      startAt('/whatsapp?conversa=c2')
      render(<WhatsAppPage />)
      expect(await screen.findByRole('heading', { name: 'Bia Lima' })).toBeInTheDocument()
      expect(markReadCalls(fetchMock)).toEqual([])
    })
  })

  describe('?phone= deep link', () => {
    it('opens the matching conversation and rewrites the URL to ?conversa=', async () => {
      startAt('/whatsapp?phone=11988880000')
      render(<WhatsAppPage />)

      expect(await screen.findByRole('heading', { name: 'Bia Lima' })).toBeInTheDocument()
      expect(currentUrl()).toBe('/whatsapp?conversa=c2')
      expect(history.push).not.toHaveBeenCalled()
      expect(listView()).toHaveClass('hidden', 'md:block')
      expect(screen.queryByRole('dialog', { name: 'Nova conversa' })).not.toBeInTheDocument()
    })

    it('a match with unread messages marks it read and clears the list badge', async () => {
      startAt('/whatsapp?phone=11977770000')
      render(<WhatsAppPage />)

      expect(await screen.findByRole('heading', { name: 'Caio Reis' })).toBeInTheDocument()
      await waitFor(() => expect(markReadCalls(fetchMock)).toEqual(['/api/whatsapp/conversations/c3']))
      expect(within(await listRow('Caio Reis')).queryByText('2')).not.toBeInTheDocument()
    })

    it('opens the start-conversation dialog when no conversation matches', async () => {
      startAt('/whatsapp?phone=11966660000')
      render(<WhatsAppPage />)

      expect(await screen.findByRole('dialog', { name: 'Nova conversa' })).toBeInTheDocument()
      expect(history.replace).not.toHaveBeenCalled()
      expect(currentUrl()).toBe('/whatsapp?phone=11966660000')
      expect(backButton()).not.toBeInTheDocument()
    })

    it.each([
      ['a match', '11988880000'],
      ['no match', '11966660000'],
    ])('a lookup resolving (%s) after the user opened a conversation is dropped', async (_, phone) => {
      let resolveLookup = () => {}
      const lookup = new Promise<void>((resolve) => {
        resolveLookup = resolve
      })
      const api = fetchMock.getMockImplementation()!
      fetchMock.mockImplementation((url: string, init?: RequestInit) =>
        url.includes(`search=${phone}`) ? lookup.then(() => api(url, init)) : api(url, init),
      )
      startAt(`/whatsapp?phone=${phone}`)
      render(<WhatsAppPage />)
      await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes(`search=${phone}`))).toBe(true))

      fireEvent.click(await listRow('Ana Souza'))
      expect(currentUrl()).toBe('/whatsapp?conversa=c1')
      await act(async () => resolveLookup())

      expect(screen.getByRole('heading', { name: 'Ana Souza' })).toBeInTheDocument()
      expect(currentUrl()).toBe('/whatsapp?conversa=c1')
      expect(window.history.state).toMatchObject({ floraclinInbox: true })
      expect(history.replace).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog', { name: 'Nova conversa' })).not.toBeInTheDocument()
    })

    it('starting a conversation from the dialog drops ?phone= from the entry underneath', async () => {
      const PATIENT = { id: 'p9', fullName: 'Duda Melo', phone: '11966660000' }
      const STARTED = { id: 'c9', phoneNumber: '5511966660000', profileName: 'Duda Melo', patientId: 'p9' }
      const api = fetchMock.getMockImplementation()!
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        // A single patient match makes the dialog start the conversation itself.
        if (url.startsWith('/api/patients?')) return json({ data: [PATIENT] })
        if (url === '/api/whatsapp/conversations' && init?.method === 'POST') {
          return json({ data: { conversation: STARTED } })
        }
        return api(url, init)
      })
      startAt('/whatsapp?phone=11966660000')
      const lengthBefore = window.history.length
      render(<WhatsAppPage />)

      expect(await screen.findByRole('heading', { name: 'Duda Melo' })).toBeInTheDocument()
      expect(currentUrl()).toBe('/whatsapp?conversa=c9')
      expect(window.history.length).toBe(lengthBefore + 1)

      fireEvent.click(backButton()!)

      expect(history.back).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(currentUrl()).toBe('/whatsapp'))
      expect(window.history.state).toMatchObject({ floraclinInbox: false })
    })
  })
})
