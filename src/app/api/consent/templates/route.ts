import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listConsentTemplates } from '@/db/queries/consent'

export async function GET() {
  try {
    const ctx = await getAuthContext()
    const data = await listConsentTemplates(ctx.tenantId)
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
