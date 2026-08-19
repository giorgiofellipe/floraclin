import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const context = await getAuthContext()
    return NextResponse.json(context)
  } catch (error) {
    // The bare `catch { 401 }` this replaces answered "unauthorized" to
    // everything, so a database outage read as a logout and never reached
    // Sentry. `handleApiError` still answers 401 for the genuine case, which
    // arrives as the `redirect('/login')` throw from `getAuthContext`, and
    // reports anything else as the 500 it is.
    return handleApiError(error, request)
  }
}
