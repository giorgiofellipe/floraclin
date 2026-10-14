import { NextResponse, type NextRequest } from 'next/server'
import { captureFirstTouch } from '@/lib/first-touch'

export function middleware(request: NextRequest) {
  const response = NextResponse.next()
  captureFirstTouch(request, response)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)'],
}
