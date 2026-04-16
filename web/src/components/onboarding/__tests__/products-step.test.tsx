import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductsStep, type ProductStepItem } from '../products-step'

describe('ProductsStep', () => {
  const baseProps = {
    selectedNames: new Set<string>(),
    customProducts: [] as ProductStepItem[],
    onSelectionChange: vi.fn(),
    onAddCustom: vi.fn(),
    onRemoveCustom: vi.fn(),
  }

  it('renders all default products grouped by category', () => {
    render(<ProductsStep {...baseProps} />)
    expect(screen.getByText('Toxina Botulínica')).toBeInTheDocument()
    expect(screen.getByText('Preenchedores')).toBeInTheDocument()
    expect(screen.getByText('Bioestimuladores')).toBeInTheDocument()
    expect(screen.getByText('Skinboosters')).toBeInTheDocument()
    expect(screen.getByText('Botulift 100U')).toBeInTheDocument()
    expect(screen.getByText('Sculptra')).toBeInTheDocument()
  })

  it('marks pre-selected products as checked', () => {
    const selectedNames = new Set(['Botox Allergan 100U', 'Sculptra'])
    render(<ProductsStep {...baseProps} selectedNames={selectedNames} />)
    const botox = screen.getByRole('checkbox', { name: /^Botox Allergan 100U/ })
    const sculptra = screen.getByRole('checkbox', { name: /^Sculptra/ })
    expect(botox.getAttribute('aria-checked')).toBe('true')
    expect(sculptra.getAttribute('aria-checked')).toBe('true')
  })

  it('calls onSelectionChange when a default product is toggled', async () => {
    const onSelectionChange = vi.fn()
    render(<ProductsStep {...baseProps} onSelectionChange={onSelectionChange} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /^Botulift 100U/ }))
    expect(onSelectionChange).toHaveBeenCalledWith('Botulift 100U', true)
  })

  it('renders custom products', () => {
    const customProducts: ProductStepItem[] = [
      { name: 'My Custom', category: 'botox', activeIngredient: '', defaultUnit: 'U', isCustom: true },
    ]
    render(<ProductsStep {...baseProps} customProducts={customProducts} />)
    expect(screen.getByText('My Custom')).toBeInTheDocument()
  })

  it('opens the custom form when Adicionar produto personalizado is clicked', async () => {
    render(<ProductsStep {...baseProps} />)
    await userEvent.click(screen.getByRole('button', { name: /Adicionar outro produto/ }))
    expect(screen.getByPlaceholderText('Nome do produto')).toBeInTheDocument()
  })

  it('calls onRemoveCustom when removing a custom product', async () => {
    const onRemoveCustom = vi.fn()
    const customProducts: ProductStepItem[] = [
      { name: 'My Custom', category: 'botox', activeIngredient: '', defaultUnit: 'U', isCustom: true },
    ]
    render(
      <ProductsStep {...baseProps} customProducts={customProducts} onRemoveCustom={onRemoveCustom} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Remover My Custom/ }))
    expect(onRemoveCustom).toHaveBeenCalledWith('My Custom')
  })

  it('shows "already configured" notice when alreadyConfigured=true', () => {
    render(<ProductsStep {...baseProps} alreadyConfigured={true} />)
    expect(screen.getByText(/já possui produtos cadastrados/)).toBeInTheDocument()
  })
})
