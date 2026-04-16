import { describe, it, expect, vi } from 'vitest'

// storage-client has a server-only guard that throws in jsdom (where `window` exists).
// Mock it so importing @/lib/storage doesn't trip the guard at module load.
vi.mock('@/lib/supabase/storage-client', () => ({
  createStorageClient: vi.fn(() => ({
    storage: {
      from: () => ({
        upload: vi.fn(),
        createSignedUrl: vi.fn(),
        remove: vi.fn(),
      }),
    },
  })),
}))

import { getStoragePath } from '@/lib/storage'

describe('getStoragePath', () => {
  it('returns correct format {tenantId}/patients/{patientId}/{filename}', () => {
    const result = getStoragePath('tenant-abc', 'patient-123', 'photo.jpg')
    expect(result).toBe('tenant-abc/patients/patient-123/photo.jpg')
  })

  it('handles filenames with special characters', () => {
    const result = getStoragePath('t1', 'p1', 'before photo (1).png')
    expect(result).toBe('t1/patients/p1/before photo (1).png')
  })

  it('handles UUID-style IDs', () => {
    const tenantId = '550e8400-e29b-41d4-a716-446655440000'
    const patientId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
    const result = getStoragePath(tenantId, patientId, 'consent-signature.png')
    expect(result).toBe(`${tenantId}/patients/${patientId}/consent-signature.png`)
  })
})
