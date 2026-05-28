import { google } from 'googleapis'
import { db } from '@/db/client'
import { calendarConnections } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { randomBytes, createHmac, timingSafeEqual } from 'crypto'

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

function getConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID!
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const callbackUrl = `${appUrl}/api/calendar/auth/callback`
  const stateSecret = process.env.CALENDAR_STATE_SECRET || clientSecret
  return { clientId, clientSecret, appUrl, callbackUrl, stateSecret }
}

export function createOAuth2Client() {
  const { clientId, clientSecret, callbackUrl } = getConfig()
  return new google.auth.OAuth2(clientId, clientSecret, callbackUrl)
}

export function buildAuthUrl(state: string): string {
  const oauth2Client = createOAuth2Client()
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [CALENDAR_SCOPE],
    state,
  })
}

export async function exchangeCodeForTokens(code: string) {
  const oauth2Client = createOAuth2Client()
  const { tokens } = await oauth2Client.getToken(code)
  return tokens
}

export function signOAuthState(payload: { userId: string; tenantId: string; type: 'practitioner' | 'clinic' }): string {
  const json = JSON.stringify(payload)
  const encoded = Buffer.from(json).toString('base64url')
  const { stateSecret } = getConfig()
  const signature = createHmac('sha256', stateSecret).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

export function verifyOAuthState(state: string): { userId: string; tenantId: string; type: 'practitioner' | 'clinic' } | null {
  const dotIndex = state.lastIndexOf('.')
  if (dotIndex === -1) return null

  const encoded = state.slice(0, dotIndex)
  const signature = state.slice(dotIndex + 1)

  const { stateSecret } = getConfig()
  const expectedSig = createHmac('sha256', stateSecret).update(encoded).digest('base64url')
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

export function generateFeedToken(): string {
  return randomBytes(32).toString('hex')
}

export async function getGoogleCalendarClient(connectionId: string) {
  const [connection] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, connectionId))
    .limit(1)

  if (!connection) {
    throw new Error('Calendar connection not found')
  }

  const oauth2Client = createOAuth2Client()
  oauth2Client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
    expiry_date: connection.tokenExpiresAt.getTime(),
  })

  const fiveMinFromNow = Date.now() + 5 * 60 * 1000
  if (connection.tokenExpiresAt.getTime() < fiveMinFromNow) {
    const { credentials } = await oauth2Client.refreshAccessToken()

    await db
      .update(calendarConnections)
      .set({
        accessToken: credentials.access_token!,
        refreshToken: credentials.refresh_token ?? connection.refreshToken,
        tokenExpiresAt: new Date(credentials.expiry_date!),
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, connectionId))

    oauth2Client.setCredentials(credentials)
  }

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })
  return { calendar, connection }
}

export async function registerWebhookChannel(
  connectionId: string,
  calendarId: string
) {
  const { calendar } = await getGoogleCalendarClient(connectionId)
  const channelId = randomBytes(16).toString('hex')
  const { appUrl } = getConfig()
  const webhookUrl = `${appUrl}/api/calendar/webhook`

  const response = await calendar.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: webhookUrl,
    },
  })

  return {
    channelId,
    resourceId: response.data.resourceId!,
    expiration: new Date(Number(response.data.expiration!)),
  }
}

export async function stopWebhookChannel(
  connectionId: string,
  channelId: string,
  resourceId: string
) {
  try {
    const { calendar } = await getGoogleCalendarClient(connectionId)
    await calendar.channels.stop({
      requestBody: {
        id: channelId,
        resourceId,
      },
    })
  } catch (error) {
    console.warn('Failed to stop webhook channel:', error)
  }
}

export async function revokeToken(accessToken: string) {
  try {
    const oauth2Client = createOAuth2Client()
    await oauth2Client.revokeToken(accessToken)
  } catch (error) {
    console.warn('Failed to revoke Google token:', error)
  }
}
