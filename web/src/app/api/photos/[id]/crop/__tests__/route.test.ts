import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(),
}))

vi.mock('@/db/queries/photos', () => ({
  getPhotoAsset: vi.fn(),
  updateCropBox: vi.fn(),
}))

import { requireRole } from '@/lib/auth'
import { getPhotoAsset, updateCropBox } from '@/db/queries/photos'
import { PATCH } from '../route'

const validCropBox = {
  cropBox: {
    x: 0.1,
    y: 0.1,
    width: 0.5,
    height: 0.6,
    rotation: 0,
    aspect: '3:4' as const,
    landmarks: {
      leftEye: { x: 0.35, y: 0.3 },
      rightEye: { x: 0.65, y: 0.3 },
      noseTip: { x: 0.5, y: 0.45 },
      interPupillaryDistance: 0.3,
    },
  },
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/photos/photo-1/crop', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const context = { params: Promise.resolve({ id: 'photo-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireRole).mockResolvedValue({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'owner',
  } as ReturnType<typeof requireRole> extends Promise<infer T> ? T : never)
  vi.mocked(getPhotoAsset).mockResolvedValue({ id: 'photo-1' } as never)
  vi.mocked(updateCropBox).mockResolvedValue({ id: 'photo-1' } as never)
})

describe('PATCH /api/photos/[id]/crop', () => {
  it('saves valid crop data', async () => {
    const res = await PATCH(makeRequest(validCropBox), context)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(updateCropBox).toHaveBeenCalledWith('tenant-1', 'photo-1', validCropBox.cropBox)
  })

  it('rejects invalid crop data with 400', async () => {
    const res = await PATCH(makeRequest({ cropBox: { x: 2 } }), context)
    expect(res.status).toBe(400)
  })

  it('rejects crop exceeding bounds with 400', async () => {
    const res = await PATCH(
      makeRequest({
        cropBox: { ...validCropBox.cropBox, x: 0.8, width: 0.5 },
      }),
      context,
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when photo not found', async () => {
    vi.mocked(getPhotoAsset).mockResolvedValue(null as never)
    const res = await PATCH(makeRequest(validCropBox), context)
    expect(res.status).toBe(404)
  })

  it('returns 403 when user lacks permission', async () => {
    vi.mocked(requireRole).mockRejectedValue(new Error('Forbidden'))
    const res = await PATCH(makeRequest(validCropBox), context)
    expect(res.status).toBe(403)
  })

  it('returns 400 for malformed JSON body', async () => {
    const req = new Request('http://localhost/api/photos/photo-1/crop', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    const res = await PATCH(req, context)
    expect(res.status).toBe(400)
  })
})
