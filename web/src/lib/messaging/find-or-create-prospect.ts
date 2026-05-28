const TERMINAL_STAGES = ['convertido', 'perdido'] as const

type MinimalProspect = { id: string; stage: string }

/**
 * Channel-agnostic helper applying the "reuse if not terminal, else create new"
 * rule for prospects. Callers inject channel-specific lookup and create callbacks.
 *
 * Used by both the WhatsApp and Instagram inbound webhooks.
 */
export async function findOrCreateProspect<P extends MinimalProspect>(opts: {
  lookup: () => Promise<P | null>
  createNew: () => Promise<P>
}): Promise<{ prospect: P; created: boolean }> {
  const existing = await opts.lookup()
  if (
    existing &&
    !TERMINAL_STAGES.includes(existing.stage as typeof TERMINAL_STAGES[number])
  ) {
    return { prospect: existing, created: false }
  }
  const fresh = await opts.createNew()
  return { prospect: fresh, created: true }
}
