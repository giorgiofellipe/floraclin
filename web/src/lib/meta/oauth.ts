import { createHmac, timingSafeEqual } from 'crypto'
import { META_GRAPH_VERSION } from './types'

const OAUTH_SCOPES = 'business_management,ads_management'

const STATE_MAX_AGE_MS = 10 * 60 * 1000

export interface MetaOAuthStatePayload {
  userId: string
  tenantId: string
  acknowledgementVersion: string
  datasetId?: string
}

interface SignedOAuthState extends MetaOAuthStatePayload {
  issuedAt: number
}

function getConfig() {
  const appId = process.env.META_APP_ID!
  const appSecret = process.env.META_APP_SECRET!
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const redirectUri = process.env.META_OAUTH_REDIRECT_URI || `${appUrl}/api/integrations/meta/auth/callback`
  return { appId, appSecret, appUrl, redirectUri }
}

export function buildAuthUrl(state: string): string {
  const { appId, redirectUri } = getConfig()
  const url = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`)
  url.searchParams.set('client_id', appId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('scope', OAUTH_SCOPES)
  url.searchParams.set('response_type', 'code')
  return url.toString()
}

export function signOAuthState(payload: MetaOAuthStatePayload): string {
  const signed: SignedOAuthState = { ...payload, issuedAt: Date.now() }
  const json = JSON.stringify(signed)
  const encoded = Buffer.from(json).toString('base64url')
  const { appSecret } = getConfig()
  const signature = createHmac('sha256', appSecret).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

export function verifyOAuthState(state: string): MetaOAuthStatePayload | null {
  const dotIndex = state.lastIndexOf('.')
  if (dotIndex === -1) return null

  const encoded = state.slice(0, dotIndex)
  const signature = state.slice(dotIndex + 1)

  const { appSecret } = getConfig()
  const expectedSig = createHmac('sha256', appSecret).update(encoded).digest('base64url')
  const sigBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expectedSig)
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null

  let payload: SignedOAuthState
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as SignedOAuthState
  } catch {
    return null
  }

  // A signed state stays valid until the app secret rotates unless it expires
  // on its own, so a captured redirect cannot be replayed days later.
  if (typeof payload.issuedAt !== 'number') return null
  if (Date.now() - payload.issuedAt > STATE_MAX_AGE_MS) return null

  return payload
}

interface MetaTokenResponse {
  access_token: string
  expires_in?: number
  error?: { message?: string }
}

const TOKEN_ENDPOINT = `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`

/**
 * Meta documents this endpoint as GET with query parameters, but it reads a
 * form-encoded POST body just as well (verified against the live endpoint:
 * with no parameters it answers "Missing client_id parameter", with a body it
 * moves on to validating the value). The body is what we want, because the
 * app secret, the authorization code and both tokens would otherwise sit in a
 * request URL, and Vercel and Sentry both log those.
 */
async function requestToken(
  params: Record<string, string>,
  failureLabel: string,
): Promise<MetaTokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })

  const body = (await response.json().catch(() => ({}))) as MetaTokenResponse
  if (!response.ok || !body.access_token) {
    throw new Error(body.error?.message ?? `${failureLabel}: HTTP ${response.status}`)
  }

  return body
}

/**
 * The initial code exchange returns a short-lived user token. A second call
 * trades that for the long-lived token FloraClin actually stores, so the
 * connection survives longer than the ~1-2 hour short-lived window.
 */
export async function exchangeCodeForLongLivedToken(
  code: string,
): Promise<{ accessToken: string; expiresAt: Date | null }> {
  const { appId, appSecret, redirectUri } = getConfig()

  const shortLived = await requestToken(
    {
      client_id: appId,
      redirect_uri: redirectUri,
      client_secret: appSecret,
      code,
    },
    'Meta token exchange failed',
  )

  const longLived = await requestToken(
    {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLived.access_token,
    },
    'Meta long-lived token exchange failed',
  )

  return {
    accessToken: longLived.access_token,
    expiresAt: longLived.expires_in ? new Date(Date.now() + longLived.expires_in * 1000) : null,
  }
}
