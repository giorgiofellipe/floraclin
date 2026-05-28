import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { pollSseEvents, cleanupSseEvents, getLatestSseEventId } from '@/db/queries/whatsapp'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getAuthContext()
  const tenant = await getTenant(ctx.tenantId)
  const settings = tenant?.settings as Record<string, unknown> | null
  if (!settings?.whatsapp_enabled) {
    return NextResponse.json({ error: 'WhatsApp not enabled' }, { status: 400 })
  }

  const allowedRoles = (settings.whatsapp_allowed_roles as string[] | undefined) ?? ['owner']
  if (!allowedRoles.includes(ctx.role) && ctx.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let lastEventId = await getLatestSseEventId(ctx.tenantId, 'whatsapp')
  const encoder = new TextEncoder()
  let interval: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      const poll = async () => {
        try {
          const events = await pollSseEvents(ctx.tenantId, lastEventId, 'whatsapp')
          for (const event of events) {
            send(event.eventType, event.payload)
            if (event.id > lastEventId) lastEventId = event.id
          }
          await cleanupSseEvents()
        } catch { /* connection closed */ }
      }

      // Heartbeat + poll every 2 seconds
      interval = setInterval(async () => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
          await poll()
        } catch {
          clearInterval(interval!)
        }
      }, 2000)

      // Initial poll
      await poll()

      controller.enqueue(encoder.encode(': connected\n\n'))
    },
    cancel() {
      if (interval) clearInterval(interval)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
