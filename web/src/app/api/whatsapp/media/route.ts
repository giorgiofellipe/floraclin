import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getSignedUrl } from '@/lib/storage'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    await getAuthContext()

    const { searchParams } = new URL(request.url)
    const path = searchParams.get('path')
    if (!path) {
      return NextResponse.json({ error: 'Missing path' }, { status: 400 })
    }

    const url = await getSignedUrl(path, 3600)
    if (!url) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    return NextResponse.redirect(url)
  } catch (error) {
    return handleApiError(error, request)
  }
}
