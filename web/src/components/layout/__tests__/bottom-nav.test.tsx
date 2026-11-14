import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BottomNav } from '../bottom-nav'
import { SubscriptionAccessProvider, useSubscriptionAccess } from '../subscription-access'

const route = vi.hoisted(() => ({ pathname: '/agenda', push: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: route.push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

function PaywallProbe() {
  return <span data-testid="paywall">{String(useSubscriptionAccess().paywallOpen)}</span>
}

function renderNav({ role = 'owner', readOnly = false } = {}) {
  const onOpenMenu = vi.fn()
  render(
    <SubscriptionAccessProvider readOnly={readOnly} reason={null} tenantId="t1" canSubscribe plans={[]} role={role}>
      <BottomNav onOpenMenu={onOpenMenu} menuOpen={false} />
      <PaywallProbe />
    </SubscriptionAccessProvider>,
  )
  return { onOpenMenu }
}

async function openCreateMenu() {
  await userEvent.click(screen.getByRole('button', { name: 'Criar novo' }))
  return (await screen.findAllByRole('menuitem')).map((item) => item.textContent)
}

describe('BottomNav', () => {
  beforeEach(() => {
    route.pathname = '/agenda'
    route.push.mockClear()
  })

  it.each([
    '/pacientes/p1/atendimento',
    '/pacientes/p1/procedimentos/x1',
    '/pacientes/p1/diagramas/novo',
    '/whatsapp',
  ])('stays out of the way on %s, which has its own bottom bar or fills the screen', (pathname) => {
    route.pathname = pathname
    renderNav()
    expect(screen.queryByRole('navigation', { name: 'Navegação principal' })).not.toBeInTheDocument()
  })

  it('marks the section the user is in, including its sub-routes', () => {
    route.pathname = '/pacientes/p1'
    renderNav()
    expect(screen.getByRole('link', { name: 'Pacientes' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Agenda' })).not.toHaveAttribute('aria-current')
  })

  it('opens the nav drawer from Mais', async () => {
    const { onOpenMenu } = renderNav()
    await userEvent.click(screen.getByRole('button', { name: 'Mais' }))
    expect(onOpenMenu).toHaveBeenCalled()
  })

  // Each list mirrors the POST role check of the API the form saves to.
  it.each([
    ['owner', ['Novo agendamento', 'Novo paciente', 'Nova cobrança']],
    ['receptionist', ['Novo agendamento', 'Novo paciente', 'Nova cobrança']],
    ['practitioner', ['Novo agendamento', 'Novo paciente']],
    ['financial', ['Nova cobrança']],
  ])('offers %s only the creates its role can save', async (role, expected) => {
    renderNav({ role })
    expect(await openCreateMenu()).toEqual(expected)
  })

  it('opens the new appointment form from the + menu', async () => {
    renderNav()
    await openCreateMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Novo agendamento' }))
    expect(route.push).toHaveBeenCalledWith(expect.stringMatching(/^\/agenda\?open=new&/))
  })

  it('opens the paywall instead of a create form in read-only mode', async () => {
    renderNav({ readOnly: true })
    await openCreateMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Novo paciente' }))
    expect(route.push).not.toHaveBeenCalled()
    expect(screen.getByTestId('paywall')).toHaveTextContent('true')
  })
})
