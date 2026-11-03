import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import { getNfseSettings } from '@/db/queries/nfse'

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('owner', 'receptionist', 'financial')
    const settings = await getNfseSettings(ctx.tenantId)
    return NextResponse.json({
      data: {
        configured: settings?.configured === true,
        canCancel: ctx.role === 'owner' || ctx.role === 'financial',
      },
    })
  } catch (error) {
    return handleApiError(error, request)
  }
}
