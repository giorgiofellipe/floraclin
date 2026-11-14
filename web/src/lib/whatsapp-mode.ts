export type WhatsAppMode = 'floraclin' | 'own'

export function resolveWhatsAppMode(settings: Record<string, unknown> | null | undefined): WhatsAppMode {
  return (settings?.whatsapp_mode as WhatsAppMode) ?? 'floraclin'
}

// WhatsApp is always available on the shared FloraClin mode (the default);
// the whatsapp_enabled flag only gates tenants using their own number.
export function isWhatsAppEnabled(settings: Record<string, unknown> | null | undefined): boolean {
  return resolveWhatsAppMode(settings) === 'floraclin' || !!settings?.whatsapp_enabled
}

// Owners always pass; other roles need to be listed in whatsapp_allowed_roles.
export function canRoleUseWhatsApp(settings: Record<string, unknown> | null | undefined, role: string): boolean {
  if (!isWhatsAppEnabled(settings)) return false
  const allowedRoles = settings?.whatsapp_allowed_roles
  return role === 'owner' || (Array.isArray(allowedRoles) && allowedRoles.includes(role))
}
