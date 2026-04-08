import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { listAllUsers, createUserWithMembership } from '@/db/queries/admin-users'
import { adminSearchSchema, createAdminUserSchema } from '@/validations/admin'

export async function GET(request: Request) {
  try {
    await requirePlatformAdmin()
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') ?? ''
    const page = Number(searchParams.get('page') ?? '1')
    const limit = Number(searchParams.get('limit') ?? '20')

    const parsed = adminSearchSchema.safeParse({ search, page, limit })
    if (!parsed.success) {
      return NextResponse.json({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 })
    }

    const data = await listAllUsers(parsed.data.search, parsed.data.page, parsed.data.limit)
    return NextResponse.json(data)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    await requirePlatformAdmin()
    const body = await request.json()
    const parsed = createAdminUserSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados invalidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const user = await createUserWithMembership(parsed.data)
    return NextResponse.json({ success: true, data: user })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
