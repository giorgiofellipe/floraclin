import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoogleSignIn } from '@/components/auth/google-sign-in'
import type { InAppBrowser } from '@/lib/in-app-browser'

const WHATSAPP_ANDROID: InAppBrowser = { app: 'whatsapp', os: 'android' }
const INSTAGRAM_IOS: InAppBrowser = { app: 'instagram', os: 'ios' }

afterEach(() => vi.restoreAllMocks())

function setup(inAppBrowser: InAppBrowser | null) {
  const action = vi.fn()
  render(
    <>
      <GoogleSignIn
        action={action}
        inAppBrowser={inAppBrowser}
        callbackUrl="/onboarding"
        emailFallbackLabel="Entrar com e-mail e senha"
        emailFallbackHint="Criou a conta com o Google e não tem senha?"
        emailInputId="email"
      />
      <input id="email" aria-label="E-mail" />
    </>,
  )
  return { action }
}

describe('GoogleSignIn', () => {
  it('is a plain submit button in a real browser, carrying the callbackUrl', () => {
    setup(null)
    const button = screen.getByRole('button', { name: /Continuar com Google/ })
    expect(button.getAttribute('type')).toBe('submit')
    expect(document.querySelector<HTMLInputElement>('input[name=callbackUrl]')?.value).toBe('/onboarding')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows nothing extra on load in an in-app browser, and opens the modal on tap instead of OAuth', async () => {
    const { action } = setup(WHATSAPP_ANDROID)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(/não permite login/)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /Continuar com Google/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Abra no Chrome para entrar com Google' })
    expect(dialog.textContent).toContain('O Google não permite login dentro do WhatsApp')
    expect(screen.getByRole('link', { name: 'Abrir no Chrome' }).getAttribute('href')).toMatch(/^intent:\/\//)
    expect(action).not.toHaveBeenCalled()
  })

  it('offers Safari steps, not an intent link, on iOS', async () => {
    setup(INSTAGRAM_IOS)
    await userEvent.click(screen.getByRole('button', { name: /Continuar com Google/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Abra no Safari para entrar com Google' })
    expect(dialog.textContent).toContain('Abrir no Safari')
    expect(screen.queryByRole('link', { name: 'Abrir no Chrome' })).toBeNull()
  })

  it('keeps Tab inside the modal', async () => {
    setup(WHATSAPP_ANDROID)
    await userEvent.click(screen.getByRole('button', { name: /Continuar com Google/ }))
    const dialog = await screen.findByRole('dialog')
    screen.getByRole('button', { name: 'Tentar com Google mesmo assim' }).focus()
    await userEvent.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)
    await userEvent.tab({ shift: true })
    expect(dialog.contains(document.activeElement)).toBe(true)
    dialog.focus()
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Tentar com Google mesmo assim' }))
  })

  it('closes on Escape', async () => {
    setup(WHATSAPP_ANDROID)
    await userEvent.click(screen.getByRole('button', { name: /Continuar com Google/ }))
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes and focuses the email field when the person picks email and password', async () => {
    setup(WHATSAPP_ANDROID)
    await userEvent.click(screen.getByRole('button', { name: /Continuar com Google/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Entrar com e-mail e senha' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement?.id).toBe('email'))
  })

  it('still goes to Google when asked to, posting the callbackUrl', async () => {
    const { action } = setup(WHATSAPP_ANDROID)
    await userEvent.click(screen.getByRole('button', { name: /Continuar com Google/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Tentar com Google mesmo assim' }))
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
    expect((action.mock.calls[0][0] as FormData).get('callbackUrl')).toBe('/onboarding')
  })

  it('ties the "Esqueci minha senha" hint to the email button', async () => {
    setup(WHATSAPP_ANDROID)
    await userEvent.click(screen.getByRole('button', { name: /Continuar com Google/ }))
    const button = await screen.findByRole('button', { name: 'Entrar com e-mail e senha' })
    expect(button.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toContain('não tem senha')
  })
})
