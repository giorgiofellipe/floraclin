import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { verifyCredentials } from '@/lib/instagram'

const bodySchema = z.object({
  pageId: z.string().min(1),
  pageAccessToken: z.string().min(1),
})

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()

    // Owner-only: this endpoint probes arbitrary Page+token combinations
    // against the Graph API. Non-owners must not be able to use it to test
    // tokens they didn't supply through the settings UI.
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const json = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'pageId e pageAccessToken são obrigatórios' },
        { status: 400 },
      )
    }

    const result = await verifyCredentials(parsed.data.pageId, parsed.data.pageAccessToken)
    return NextResponse.json(result)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
