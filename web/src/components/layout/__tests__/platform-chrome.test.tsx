import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PlatformFooter } from '../platform-chrome'

const route = vi.hoisted(() => ({ pathname: '/dashboard' }))
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }))

describe('PlatformFooter', () => {
  beforeEach(() => {
    route.pathname = '/dashboard'
  })

  it('renders its links on regular pages', () => {
    render(<PlatformFooter><a href="/privacidade">Privacidade</a></PlatformFooter>)
    const footer = screen.getByRole('contentinfo')
    expect(footer).toHaveTextContent('Privacidade')
    expect(footer).not.toHaveClass('hidden')
  })

  it('is hidden below md on the WhatsApp inbox, which fills the screen below the header', () => {
    route.pathname = '/whatsapp'
    render(<PlatformFooter><a href="/privacidade">Privacidade</a></PlatformFooter>)
    const footer = screen.getByRole('contentinfo', { hidden: true })
    expect(footer).toHaveClass('hidden', 'md:block')
    expect(footer).toHaveTextContent('Privacidade')
  })
})
