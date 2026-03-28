import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'

export async function GET() {
  try {
    const context = await getAuthContext()
    return NextResponse.json(context)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
