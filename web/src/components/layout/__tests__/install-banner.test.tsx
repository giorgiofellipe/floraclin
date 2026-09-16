import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { InstallBanner } from '../install-banner'

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'
const IPADOS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'

// jsdom has no matchMedia, and its userAgent lives on Navigator.prototype, so
// both are defined as own configurable properties and removed after each test.
function stubEnvironment({
  installed = false,
  mobile = true,
  userAgent = ANDROID_UA,
  touchPoints = 0,
}: { installed?: boolean; mobile?: boolean; userAgent?: string; touchPoints?: number } = {}) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.startsWith('(display-mode') ? installed : mobile,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent })
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: touchPoints })
}

function fireInstallPrompt() {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>
  }
  event.prompt = vi.fn().mockResolvedValue(undefined)
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

const banner = () => screen.queryByTestId('install-banner')

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia
  delete (navigator as { userAgent?: unknown }).userAgent
  delete (navigator as { maxTouchPoints?: unknown }).maxTouchPoints
  vi.restoreAllMocks()
})

describe('InstallBanner', () => {
  it('renders nothing when already running as an installed app', () => {
    stubEnvironment({ installed: true, userAgent: IOS_UA })
    render(<InstallBanner />)
    expect(banner()).not.toBeInTheDocument()
  })

  it('renders nothing when iOS reports the page as an installed app', () => {
    stubEnvironment({ userAgent: IOS_UA })
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    render(<InstallBanner />)
    expect(banner()).not.toBeInTheDocument()
    delete (navigator as { standalone?: unknown }).standalone
  })

  it('renders nothing after the user dismissed it before', () => {
    localStorage.setItem('floraclin.install-banner.dismissed', '1')
    stubEnvironment({ userAgent: IOS_UA })
    render(<InstallBanner />)
    expect(banner()).not.toBeInTheDocument()
  })

  it('tells iOS users to use Share and Add to Home Screen', () => {
    stubEnvironment({ userAgent: IOS_UA })
    render(<InstallBanner />)
    expect(banner()).toHaveTextContent(/Adicionar à Tela de Início/)
    expect(screen.queryByRole('button', { name: /instalar/i })).not.toBeInTheDocument()
  })

  it('treats a touch Macintosh user agent as iPadOS Safari', () => {
    stubEnvironment({ userAgent: IPADOS_UA, touchPoints: 5 })
    render(<InstallBanner />)
    expect(banner()).toHaveTextContent(/Adicionar à Tela de Início/)
  })

  it('tells other mobile browsers to use the browser menu until the browser offers to install', () => {
    stubEnvironment()
    render(<InstallBanner />)
    expect(banner()).toHaveTextContent(/menu do navegador/i)
    expect(screen.queryByRole('button', { name: /instalar/i })).not.toBeInTheDocument()
  })

  it('shows an install button once the browser offers to install, then prompts and hides', async () => {
    stubEnvironment()
    render(<InstallBanner />)
    const event = fireInstallPrompt()
    expect(event.defaultPrevented).toBe(true)

    fireEvent.click(await screen.findByRole('button', { name: /instalar/i }))

    expect(event.prompt).toHaveBeenCalledOnce()
    expect(banner()).not.toBeInTheDocument()
  })

  it('leaves the browser install prompt alone on wide viewports', () => {
    stubEnvironment({ mobile: false })
    render(<InstallBanner />)
    const event = fireInstallPrompt()

    expect(event.defaultPrevented).toBe(false)
    expect(screen.queryByRole('button', { name: /instalar/i })).not.toBeInTheDocument()
  })

  it('hides for good once the app gets installed from the browser menu', () => {
    stubEnvironment()
    render(<InstallBanner />)
    expect(banner()).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })

    expect(banner()).not.toBeInTheDocument()
    expect(localStorage.getItem('floraclin.install-banner.dismissed')).toBe('1')
  })

  it('hides and remembers the dismissal', () => {
    stubEnvironment({ userAgent: IOS_UA })
    render(<InstallBanner />)

    fireEvent.click(screen.getByRole('button', { name: /fechar/i }))

    expect(banner()).not.toBeInTheDocument()
    expect(localStorage.getItem('floraclin.install-banner.dismissed')).toBe('1')
  })
})
