import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAnamnesisToken } from '@/db/queries/anamnesis-tokens'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner', 'receptionist'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: patientId } = await params
    const token = await createAnamnesisToken(ctx.tenantId, patientId, ctx.userId)

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
    const url = `${appUrl}/a/${token.token}`

    return NextResponse.json({ url, expiresAt: token.expiresAt })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Anamnesis link API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
