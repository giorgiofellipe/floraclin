import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { createAnamnesisToken } from '@/db/queries/anamnesis-tokens'
import { handleApiError } from '@/lib/api-error'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner', 'receptionist')
    if (blocked) return blocked

    const { id: patientId } = await params
    const token = await createAnamnesisToken(ctx.tenantId, patientId, ctx.userId)

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
    const url = `${appUrl}/a/${token.token}`

    return NextResponse.json({ url, expiresAt: token.expiresAt })
  } catch (error) {
    return handleApiError(error, request)
  }
}
