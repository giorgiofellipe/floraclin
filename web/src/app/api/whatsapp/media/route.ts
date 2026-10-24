import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getSignedUrl } from '@/lib/storage'
import { handleApiError } from '@/lib/api-error'

// The signer runs with the service role, so the tenant prefix is the only thing
// keeping one clinic's keys out of another's. Dot segments are refused because
// storage-js sends the key unencoded and the URL parser would resolve them.
function isOwnTenantKey(path: string, tenantId: string): boolean {
  const segments = path.split('/')
  return segments[0] === tenantId && segments.every((s) => s !== '' && s !== '.' && s !== '..')
}

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()

    const { searchParams } = new URL(request.url)
    const path = searchParams.get('path')
    if (!path) {
      return NextResponse.json({ error: 'Missing path' }, { status: 400 })
    }
    if (!isOwnTenantKey(path, ctx.tenantId)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
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
