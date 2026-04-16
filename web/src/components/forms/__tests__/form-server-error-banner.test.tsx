import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { FormServerErrorBanner } from '../form-server-error-banner'

function Host({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const form = useForm()
  useEffect(() => {
    if (message) form.setError('root.serverError', { message })
  }, [form, message])
  return <FormServerErrorBanner form={form} onRetry={onRetry} />
}

describe('FormServerErrorBanner', () => {
  it('renders nothing when no server error is set', () => {
    const { container } = render(<Host />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the error message when set', async () => {
    render(<Host message="Erro de servidor" />)
    expect(await screen.findByText('Erro de servidor')).toBeInTheDocument()
  })

  it('calls onRetry when the retry button is clicked', async () => {
    const onRetry = vi.fn()
    render(<Host message="Erro" onRetry={onRetry} />)
    await userEvent.click(await screen.findByRole('button', { name: /Tentar novamente/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
