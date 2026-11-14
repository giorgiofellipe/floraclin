import { readdirSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Header } from '../header'

const route = vi.hoisted(() => ({ pathname: '/dashboard' }))
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const { stub } = vi.hoisted(() => ({ stub: () => null }))
vi.mock('../user-menu', () => ({ UserMenu: stub }))
vi.mock('../help-menu', () => ({ HelpMenu: stub }))
vi.mock('../sidebar', () => ({ MobileSidebarContent: stub }))
vi.mock('../patient-search', () => ({ PatientSearch: stub }))
vi.mock('../quick-create', () => ({ QuickCreateMenu: stub }))
vi.mock('../bottom-nav', () => ({ BottomNav: stub }))
vi.mock('@/components/layout/expired-paywall', () => ({ ReadOnlyBadge: stub }))

// Every page under app/(platform), with dynamic segments filled in, so a new
// section without a header title fails here.
const platformDir = path.resolve(__dirname, '../../../app/(platform)')
const platformRoutes = readdirSync(platformDir, { recursive: true, encoding: 'utf8' })
  .filter((file) => path.basename(file) === 'page.tsx')
  .map((file) => `/${path.dirname(file)}`.replace(/\[[^\]]+\]/g, 'x'))

function phoneTitle() {
  return screen.getByTestId('header-title-mobile').textContent
}

describe('Header title', () => {
  beforeEach(() => {
    route.pathname = '/dashboard'
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('finds the platform pages to check', () => {
    expect(platformRoutes).toEqual(expect.arrayContaining(['/dashboard', '/relatorios/faltas', '/crm/planejamentos']))
  })

  it.each(platformRoutes)('names the section on %s', (pathname) => {
    route.pathname = pathname
    render(<Header userName="Ana" userEmail="ana@example.com" />)
    expect(phoneTitle()).not.toBe('')
    expect(phoneTitle()).not.toBe('FloraClin')
  })

  it.each([
    ['/relatorios/procedimentos-realizados', 'Relatórios'],
    ['/crm/planejamentos', 'CRM'],
    ['/configuracoes/avaliacao/x', 'Configurações'],
    ['/pacientes/x/atendimento', 'Pacientes'],
  ])('uses the section title on the sub-route %s', (pathname, title) => {
    route.pathname = pathname
    render(<Header userName="Ana" userEmail="ana@example.com" />)
    expect(phoneTitle()).toBe(title)
  })

  it('dates the Painel by the BR calendar day, not the host clock', () => {
    // 22:30 BRT on Saturday the 14th is already Sunday the 15th on a UTC host.
    vi.stubEnv('TZ', 'UTC')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-15T01:30:00Z'))
    render(<Header userName="Ana" userEmail="ana@example.com" />)
    expect(screen.getByText('Sábado, 14 de novembro de 2026')).toBeInTheDocument()
  })
})
