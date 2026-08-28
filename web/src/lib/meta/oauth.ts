import { createHmac, timingSafeEqual } from 'crypto'
import { META_GRAPH_VERSION } from './types'

export { ACKNOWLEDGEMENT_VERSION, ACKNOWLEDGEMENT_TEXT } from './acknowledgement'

const OAUTH_SCOPES = 'business_management,ads_management'

export interface MetaOAuthStatePayload {
  userId: string
  tenantId: string
  acknowledgementVersion: string
  datasetId?: string
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
  const json = JSON.stringify(payload)
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

  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf-8')
    return JSON.parse(json)
  } catch {
    return null
  }
}

interface MetaTokenResponse {
  access_token: string
  expires_in?: number
  error?: { message?: string }
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

  const shortLivedUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`)
  shortLivedUrl.searchParams.set('client_id', appId)
  shortLivedUrl.searchParams.set('redirect_uri', redirectUri)
  shortLivedUrl.searchParams.set('client_secret', appSecret)
  shortLivedUrl.searchParams.set('code', code)

  const shortLivedRes = await fetch(shortLivedUrl.toString())
  const shortLivedBody = (await shortLivedRes.json().catch(() => ({}))) as MetaTokenResponse
  if (!shortLivedRes.ok || !shortLivedBody.access_token) {
    throw new Error(shortLivedBody.error?.message ?? `Meta token exchange failed: HTTP ${shortLivedRes.status}`)
  }

  const longLivedUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`)
  longLivedUrl.searchParams.set('grant_type', 'fb_exchange_token')
  longLivedUrl.searchParams.set('client_id', appId)
  longLivedUrl.searchParams.set('client_secret', appSecret)
  longLivedUrl.searchParams.set('fb_exchange_token', shortLivedBody.access_token)

  const longLivedRes = await fetch(longLivedUrl.toString())
  const longLivedBody = (await longLivedRes.json().catch(() => ({}))) as MetaTokenResponse
  if (!longLivedRes.ok || !longLivedBody.access_token) {
    throw new Error(longLivedBody.error?.message ?? `Meta long-lived token exchange failed: HTTP ${longLivedRes.status}`)
  }

  return {
    accessToken: longLivedBody.access_token,
    expiresAt: longLivedBody.expires_in ? new Date(Date.now() + longLivedBody.expires_in * 1000) : null,
  }
}
