export type WhatsAppMode = 'floraclin' | 'own'

// WhatsApp is always available on the shared FloraClin mode (the default);
// the whatsapp_enabled flag only gates tenants using their own number.
export function isWhatsAppEnabled(settings: Record<string, unknown> | null | undefined): boolean {
  const mode = (settings?.whatsapp_mode as WhatsAppMode) ?? 'floraclin'
  if (mode === 'floraclin') return true
  return !!settings?.whatsapp_enabled
}
