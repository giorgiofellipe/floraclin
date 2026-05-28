import { db } from '@/db/client'
import { procedureTypes } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { classifyMessage } from '@/lib/classify-prospect'
import {
  updateProspect,
  setProspectProcedures,
  logProspectActivity,
} from '@/db/queries/prospects'
import { pushSseEvent, type SseChannel } from '@/db/queries/whatsapp'

/**
 * Fire-and-forget prospect classification from inbound messages. Should be invoked
 * without `await` by callers — catches and logs all errors instead of throwing.
 *
 * Behavior must match the original WhatsApp webhook classification block:
 * - Skip if prospectStage !== 'novo'
 * - Run classifyMessage() over recentInboundBodies
 * - Match returned procedures against tenant's procedureTypes
 * - Set prospect.value = sum of matched procedures' defaultPrice
 * - Update prospect via updateProspect()
 * - Update procedure links via setProspectProcedures()
 * - Log activity via logProspectActivity('ai_classified', ...)
 * - Push SSE 'prospect_updated' event
 */
export async function classifyProspectFromInbound(opts: {
  tenantId: string
  prospectId: string
  prospectStage: string
  recentInboundBodies: string[]
  channel?: SseChannel
}): Promise<void> {
  const { tenantId, prospectId, prospectStage, recentInboundBodies } = opts
  const channel = opts.channel ?? 'whatsapp'
  try {
    if (prospectStage !== 'novo') return
    if (recentInboundBodies.length === 0) return

    const procedures = await db
      .select({
        id: procedureTypes.id,
        name: procedureTypes.name,
        defaultPrice: procedureTypes.defaultPrice,
      })
      .from(procedureTypes)
      .where(eq(procedureTypes.tenantId, tenantId))

    const procedureNames = procedures.map((p) => p.name)
    const classification = await classifyMessage(recentInboundBodies, procedureNames)

    // Match classified procedure names to actual procedure type IDs
    const matchedProcedures = classification.interestedProcedures
      .map((procName) => procedures.find((p) => p.name.toLowerCase() === procName.toLowerCase()))
      .filter((p): p is typeof procedures[number] => !!p)

    // Auto-set value by summing matched procedures' default prices
    let autoValue: string | undefined
    if (matchedProcedures.length > 0) {
      const total = matchedProcedures.reduce(
        (sum, p) => sum + (p.defaultPrice ? parseFloat(p.defaultPrice) : 0),
        0,
      )
      if (total > 0) autoValue = total.toFixed(2)

      await setProspectProcedures(tenantId, prospectId, matchedProcedures.map((p) => p.id))
    }

    await updateProspect(tenantId, prospectId, {
      intent: classification.intent,
      sentiment: classification.sentiment,
      ...(autoValue ? { value: autoValue } : {}),
      ...(classification.extractedName
        ? { name: classification.extractedName }
        : {}),
    })

    await logProspectActivity(tenantId, prospectId, 'ai_classified', {
      intent: classification.intent,
      sentiment: classification.sentiment,
      interestedProcedures: matchedProcedures.map((p) => p.name),
      ...(autoValue ? { autoValue } : {}),
    })

    // Push SSE event for prospect update
    await pushSseEvent(tenantId, 'prospect_updated', {
      prospectId,
      ...classification,
    }, channel)
  } catch (err) {
    console.error('Classification failed:', err)
  }
}
