import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PhotoComparison } from '../photo-comparison'

// Mock server actions
vi.mock('@/actions/photos', () => ({
  listPhotosAction: vi.fn().mockResolvedValue({
    success: true,
    data: [
      {
        stage: 'pre',
        photos: [
          {
            id: 'photo-1',
            originalFilename: 'foto-antes.jpg',
            timelineStage: 'pre',
            storagePath: '/path/1',
          },
          {
            id: 'photo-2',
            originalFilename: 'foto-depois.jpg',
            timelineStage: 'immediate_post',
            storagePath: '/path/2',
          },
        ],
      },
    ],
  }),
  getComparisonUrlsAction: vi.fn().mockResolvedValue({
    success: true,
    data: { urlA: 'https://example.com/a.jpg', urlB: 'https://example.com/b.jpg' },
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

describe('PhotoComparison', () => {
  it('renders mode selector with 3 modes', async () => {
    render(<PhotoComparison patientId="patient-1" />)

    // Wait for loading to finish and tabs to appear
    const sideBySideTab = await screen.findByRole('tab', { name: 'Lado a Lado' })
    expect(sideBySideTab).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sobreposição' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Slider' })).toBeInTheDocument()
  })

  it('shows photo selectors', async () => {
    render(<PhotoComparison patientId="patient-1" />)

    // Wait for loading
    const labelA = await screen.findByText('Foto A')
    expect(labelA).toBeInTheDocument()
    expect(screen.getByText('Foto B')).toBeInTheDocument()
  })
})
