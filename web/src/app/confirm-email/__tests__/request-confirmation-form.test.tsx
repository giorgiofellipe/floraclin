import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RequestConfirmationForm } from '../request-confirmation-form'

/**
 * The dead end this closes: signup no longer creates a session, so the
 * address exists only in the confirmation link. Someone who closed that tab
 * used to land on /login, where the password they had just chosen was refused
 * for being unconfirmed and the error said only that the credentials were
 * invalid. No session, no address, no resend, no explanation.
 */

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
})

describe('RequestConfirmationForm', () => {
  it('asks the resend endpoint for a new link', async () => {
    render(<RequestConfirmationForm />)

    fireEvent.change(screen.getByTestId('request-confirmation-email'), {
      target: { value: 'maria@clinica.com.br' },
    })
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/confirm/resend')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      email: 'maria@clinica.com.br',
    })
  })

  it('says the same thing regardless of whether the account exists', async () => {
    // The endpoint answers identically for unknown, already-confirmed and
    // throttled addresses. The form has to match that, or it becomes the
    // oracle the endpoint refuses to be.
    render(<RequestConfirmationForm />)

    fireEvent.change(screen.getByTestId('request-confirmation-email'), {
      target: { value: 'nobody@nowhere.com' },
    })
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(screen.getByText(/se houver uma conta/i)).toBeInTheDocument())
  })

  it('says the same thing when the request itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    render(<RequestConfirmationForm />)
    fireEvent.change(screen.getByTestId('request-confirmation-email'), {
      target: { value: 'maria@clinica.com.br' },
    })
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(screen.getByText(/se houver uma conta/i)).toBeInTheDocument())
  })

  it('does not submit an empty address', () => {
    render(<RequestConfirmationForm />)
    fireEvent.click(screen.getByRole('button'))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
