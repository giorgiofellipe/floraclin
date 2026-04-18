import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PhotoComparisonDialog } from '../photo-comparison'
import type { PhotoAssetWithUrl } from '@/db/queries/photos'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

const mockPhotoA: PhotoAssetWithUrl = {
  id: 'photo-1',
  storagePath: '/path/1',
  originalFilename: 'foto-antes.jpg',
  mimeType: 'image/jpeg',
  fileSizeBytes: 1024,
  timelineStage: 'pre',
  takenAt: null,
  notes: null,
  createdAt: new Date('2026-03-15'),
  signedUrl: null,
  procedureRecordId: 'proc-1',
  procedureTypeName: 'Toxina Botulínica',
  procedurePerformedAt: new Date('2026-03-15'),
}

const mockPhotoB: PhotoAssetWithUrl = {
  id: 'photo-2',
  storagePath: '/path/2',
  originalFilename: 'foto-depois.jpg',
  mimeType: 'image/jpeg',
  fileSizeBytes: 2048,
  timelineStage: '30d',
  takenAt: null,
  notes: null,
  createdAt: new Date('2026-04-14'),
  signedUrl: null,
  procedureRecordId: 'proc-1',
  procedureTypeName: 'Toxina Botulínica',
  procedurePerformedAt: new Date('2026-03-15'),
}

const mockComparisonUrlsResponse = {
  success: true,
  data: {
    urlA: 'https://example.com/photo-a.jpg',
    urlB: 'https://example.com/photo-b.jpg',
  },
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockComparisonUrlsResponse,
    } as Response),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PhotoComparisonDialog', () => {
  it('renders mode buttons when open with both photos', async () => {
    render(
      <PhotoComparisonDialog
        open={true}
        onOpenChange={vi.fn()}
        photoA={mockPhotoA}
        photoB={mockPhotoB}
      />
    )

    const sliderButton = await screen.findByRole('button', { name: 'Slider' })
    expect(sliderButton).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lado a Lado' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sobreposição' })).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(
      <PhotoComparisonDialog
        open={false}
        onOpenChange={vi.fn()}
        photoA={mockPhotoA}
        photoB={mockPhotoB}
      />
    )

    expect(screen.queryByRole('button', { name: 'Slider' })).not.toBeInTheDocument()
  })
})
