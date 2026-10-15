export type WhatsAppMode = 'floraclin' | 'own'

export function resolveWhatsAppMode(settings: Record<string, unknown> | null | undefined): WhatsAppMode {
  return (settings?.whatsapp_mode as WhatsAppMode) ?? 'floraclin'
}

// WhatsApp is always available on the shared FloraClin mode (the default);
// the whatsapp_enabled flag only gates tenants using their own number.
export function isWhatsAppEnabled(settings: Record<string, unknown> | null | undefined): boolean {
  return resolveWhatsAppMode(settings) === 'floraclin' || !!settings?.whatsapp_enabled
}
