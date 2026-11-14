'use client'

import { useTenant } from '@/hooks/queries/use-tenant'

/** The clinic's public booking page (/c/[slug]), or null while online booking is off. */
export function useBookingUrl(): string | null {
  const { data: tenant } = useTenant()
  const settings = tenant?.settings as Record<string, unknown> | undefined
  return tenant?.slug && settings?.online_booking_enabled === true && typeof window !== 'undefined'
    ? `${window.location.origin}/c/${tenant.slug}`
    : null
}
