import * as React from 'react'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NfsePromptProvider } from '@/components/nfse/nfse-prompt-provider'

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

export function createWrapper(client?: QueryClient) {
  const queryClient = client ?? createTestQueryClient()
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>
      <NfsePromptProvider>{children}</NfsePromptProvider>
    </QueryClientProvider>
  )
  return Wrapper
}

export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & { queryClient?: QueryClient },
): RenderResult {
  const { queryClient, ...rest } = options ?? {}
  return render(ui, { wrapper: createWrapper(queryClient), ...rest })
}

export * from '@testing-library/react'
