import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CustomProductForm } from '../custom-product-form'

describe('CustomProductForm', () => {
  it('renders all fields', () => {
    render(<CustomProductForm onAdd={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByPlaceholderText('Nome do produto')).toBeInTheDocument()
    expect(screen.getByText('Adicionar')).toBeInTheDocument()
    expect(screen.getByText('Cancelar')).toBeInTheDocument()
  })

  it('disables Adicionar when name is empty', () => {
    render(<CustomProductForm onAdd={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Adicionar' })).toBeDisabled()
  })

  it('calls onAdd with product data when submitted', async () => {
    const onAdd = vi.fn()
    render(<CustomProductForm onAdd={onAdd} onCancel={vi.fn()} />)

    await userEvent.type(screen.getByPlaceholderText('Nome do produto'), 'Custom Toxin')
    await userEvent.type(screen.getByPlaceholderText('Princípio ativo (opcional)'), 'Toxina X')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }))

    expect(onAdd).toHaveBeenCalledWith({
      name: 'Custom Toxin',
      category: 'botox',
      activeIngredient: 'Toxina X',
      defaultUnit: 'U',
    })
  })

  it('calls onCancel when Cancelar is clicked', async () => {
    const onCancel = vi.fn()
    render(<CustomProductForm onAdd={vi.fn()} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
