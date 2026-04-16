import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreateCategoryModal } from '../create-category-modal'

const mockMutateAsync = vi.fn()

vi.mock('@/hooks/mutations/use-financial-settings-mutations', () => ({
  useCreateExpenseCategory: vi.fn().mockReturnValue({
    mutateAsync: (...args: unknown[]) => mockMutateAsync(...args),
    isPending: false,
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('CreateCategoryModal', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onCreated: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockMutateAsync.mockResolvedValue({ data: { id: 'new-cat-id', name: 'Test', icon: 'circle' } })
  })

  it('renders modal with name input and icon picker', () => {
    render(<CreateCategoryModal {...defaultProps} />, { wrapper: createWrapper() })
    expect(screen.getByText('Nova Categoria')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Nome da categoria')).toBeInTheDocument()
  })

  it('disables Criar button when name is empty', () => {
    render(<CreateCategoryModal {...defaultProps} />, { wrapper: createWrapper() })
    const createButton = screen.getByRole('button', { name: 'Criar' })
    expect(createButton).toBeDisabled()
  })

  it('calls mutateAsync and onCreated on successful submit', async () => {
    render(<CreateCategoryModal {...defaultProps} />, { wrapper: createWrapper() })
    await userEvent.type(screen.getByPlaceholderText('Nome da categoria'), 'Nova Cat')
    await userEvent.click(screen.getByRole('button', { name: 'Criar' }))
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({ name: 'Nova Cat', icon: 'circle' })
    })
    expect(defaultProps.onCreated).toHaveBeenCalledWith('new-cat-id')
  })

  it('submits via Enter key on name input', async () => {
    render(<CreateCategoryModal {...defaultProps} />, { wrapper: createWrapper() })
    await userEvent.type(screen.getByPlaceholderText('Nome da categoria'), 'Via Enter{Enter}')
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({ name: 'Via Enter', icon: 'circle' })
    })
  })

  it('shows error message when mutation fails', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Categoria duplicada'))
    render(<CreateCategoryModal {...defaultProps} />, { wrapper: createWrapper() })
    await userEvent.type(screen.getByPlaceholderText('Nome da categoria'), 'Duplicada')
    await userEvent.click(screen.getByRole('button', { name: 'Criar' }))
    await waitFor(() => {
      expect(screen.getByText('Categoria duplicada')).toBeInTheDocument()
    })
    expect(defaultProps.onCreated).not.toHaveBeenCalled()
  })
})
