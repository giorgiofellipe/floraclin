import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArmedProductStrip } from '../armed-product-strip'
import type { CatalogProduct } from '../types'

const FIXTURE_PRODUCTS: CatalogProduct[] = [
  { id: 'p1', name: 'Botox Allergan 100U', category: 'botox', activeIngredient: 'Onabotulinumtoxin A', defaultUnit: 'U', isActive: true },
  { id: 'p2', name: 'Dysport 500U', category: 'botox', activeIngredient: 'Abobotulinumtoxin A', defaultUnit: 'U', isActive: true },
  { id: 'p3', name: 'Juvederm Voluma', category: 'filler', activeIngredient: 'Ácido Hialurônico', defaultUnit: 'mL', isActive: true },
  { id: 'p4', name: 'Sculptra', category: 'biostimulator', activeIngredient: 'Ácido Poli-L-Láctico', defaultUnit: 'mL', isActive: true },
  { id: 'p5', name: 'Botox Discontinued', category: 'botox', activeIngredient: null, defaultUnit: 'U', isActive: false },
]

describe('ArmedProductStrip', () => {
  it('renders placeholder when no product is armed', () => {
    render(
      <ArmedProductStrip
        products={FIXTURE_PRODUCTS}
        armedProductId={null}
        onArmedProductIdChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId('armed-product-trigger')).toHaveTextContent('Buscar produto...')
    expect(screen.getByText(/Selecione um produto para começar/i)).toBeInTheDocument()
  })

  it('renders the armed product name when one is selected', () => {
    render(
      <ArmedProductStrip
        products={FIXTURE_PRODUCTS}
        armedProductId="p1"
        onArmedProductIdChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId('armed-product-trigger')).toHaveTextContent('Botox Allergan 100U')
    expect(screen.queryByText(/Selecione um produto para começar/i)).not.toBeInTheDocument()
  })

  it('shows empty-catalog message when no active products exist', () => {
    render(
      <ArmedProductStrip
        products={[]}
        armedProductId={null}
        onArmedProductIdChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/Configure produtos no catálogo/i)).toBeInTheDocument()
    const trigger = screen.getByTestId('armed-product-trigger') as HTMLButtonElement
    expect(trigger).toBeDisabled()
  })

  it('shows empty-catalog message when all products are inactive', () => {
    render(
      <ArmedProductStrip
        products={[FIXTURE_PRODUCTS[4]]}
        armedProductId={null}
        onArmedProductIdChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/Configure produtos no catálogo/i)).toBeInTheDocument()
  })

  it('fires onArmedProductIdChange when a product is selected from the list', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ArmedProductStrip
        products={FIXTURE_PRODUCTS}
        armedProductId={null}
        onArmedProductIdChange={onChange}
      />,
    )
    await user.click(screen.getByTestId('armed-product-trigger'))
    const option = await screen.findByTestId('product-autocomplete-option-p3')
    await user.click(option)
    expect(onChange).toHaveBeenCalledWith('p3')
  })

  it('filters by name via the search input', async () => {
    const user = userEvent.setup()
    render(
      <ArmedProductStrip
        products={FIXTURE_PRODUCTS}
        armedProductId={null}
        onArmedProductIdChange={vi.fn()}
      />,
    )
    await user.click(screen.getByTestId('armed-product-trigger'))
    const searchInput = await screen.findByTestId('product-autocomplete-search')
    await user.click(searchInput)
    await user.keyboard('Juv')
    expect(screen.queryByTestId('product-autocomplete-option-p1')).toBeNull()
    expect(screen.queryByTestId('product-autocomplete-option-p2')).toBeNull()
    expect(await screen.findByTestId('product-autocomplete-option-p3')).toBeInTheDocument()
    expect(screen.queryByTestId('product-autocomplete-option-p4')).toBeNull()
  })

  it('excludes inactive products from the list', async () => {
    const user = userEvent.setup()
    render(
      <ArmedProductStrip
        products={FIXTURE_PRODUCTS}
        armedProductId={null}
        onArmedProductIdChange={vi.fn()}
      />,
    )
    await user.click(screen.getByTestId('armed-product-trigger'))
    await screen.findByTestId('product-autocomplete-list')
    expect(screen.queryByTestId('product-autocomplete-option-p5')).toBeNull()
    expect(screen.getByTestId('product-autocomplete-option-p1')).toBeInTheDocument()
  })

  it('shows "Nenhum produto encontrado" when the filter has no matches', async () => {
    const user = userEvent.setup()
    render(
      <ArmedProductStrip
        products={FIXTURE_PRODUCTS}
        armedProductId={null}
        onArmedProductIdChange={vi.fn()}
      />,
    )
    await user.click(screen.getByTestId('armed-product-trigger'))
    const searchInput = await screen.findByTestId('product-autocomplete-search')
    await user.click(searchInput)
    await user.keyboard('zzzzz')
    expect(await screen.findByText('Nenhum produto encontrado')).toBeInTheDocument()
  })

  it('allows switching the armed product by selecting another one', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ArmedProductStrip
        products={FIXTURE_PRODUCTS}
        armedProductId="p1"
        onArmedProductIdChange={onChange}
      />,
    )
    await user.click(screen.getByTestId('armed-product-trigger'))
    const option = await screen.findByTestId('product-autocomplete-option-p3')
    await user.click(option)
    expect(onChange).toHaveBeenCalledWith('p3')
  })
})
