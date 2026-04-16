import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { FormFieldError } from '../form-field-error'

function Host({ path, message }: { path?: string; message?: string }) {
  const form = useForm()
  useEffect(() => {
    if (path && message) form.setError(path, { message })
  }, [form, path, message])
  return <FormFieldError form={form} name={path ?? 'missing'} />
}

describe('FormFieldError', () => {
  it('renders nothing when no error at the path', () => {
    const { container } = render(<Host />)
    expect(container.firstChild).toBeNull()
  })

  it('renders error message when error exists', async () => {
    render(<Host path="technique" message="Campo obrigatório" />)
    expect(await screen.findByText('Campo obrigatório')).toBeInTheDocument()
  })

  it('supports nested dot-paths', async () => {
    render(<Host path="financialPlan.totalAmount" message="Valor inválido" />)
    expect(await screen.findByText('Valor inválido')).toBeInTheDocument()
  })
})
