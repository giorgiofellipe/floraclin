import * as React from 'react'
import type { TenantHeaderInfo } from '@/lib/tenant-header'

export interface Address {
  street?: string
  number?: string
  complement?: string
  neighborhood?: string
  city?: string
  state?: string
  zip?: string
}

/**
 * Narrows a tenant's free-form JSONB `address` column into the structured
 * shape `ClinicHeader` expects. The column has no fixed schema, so this is
 * a best-effort cast, not real validation: any object shape is accepted,
 * and non-objects (including `null`) become `null`.
 *
 * Arrays are rejected along with the other non-objects. `typeof [] === 'object'`,
 * so a JSONB array would otherwise pass through and render as an address whose
 * every field is undefined, i.e. an empty `.clinic-meta` line.
 */
export function toClinicHeaderAddress(raw: unknown): Address | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Address) : null
}

export interface ClinicHeaderProps {
  tenant: {
    name: string
    phone: string | null
    email: string | null
    logoUrl: string | null
    address: Address | null
  }
}

/**
 * Builds `ClinicHeader`'s `tenant` prop from a raw `TenantHeaderInfo`: passes
 * the identity fields through and narrows the free-form JSONB `address`. The
 * DB column has no fixed shape, `ClinicHeader` does.
 */
export function toClinicHeaderTenant(tenant: TenantHeaderInfo): ClinicHeaderProps['tenant'] {
  return { ...tenant, address: toClinicHeaderAddress(tenant.address) }
}

function formatAddress(a: Address | null): string {
  if (!a) return ''
  const parts = [
    [a.street, a.number, a.complement].filter(Boolean).join(', '),
    [a.neighborhood, a.city, a.state].filter(Boolean).join(' · '),
    a.zip,
  ].filter(Boolean)
  return parts.join(' — ')
}

export function ClinicHeader({ tenant }: ClinicHeaderProps) {
  return (
    <header className="flex items-center gap-4 border-b border-gray-300 pb-4">
      {tenant.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tenant.logoUrl} alt={tenant.name} className="h-16 w-16 object-contain" />
      )}
      <div className="flex-1">
        <div className="clinic-name text-lg font-semibold">{tenant.name}</div>
        {tenant.address && (
          <div className="clinic-meta text-xs text-gray-700">{formatAddress(tenant.address)}</div>
        )}
        <div className="clinic-meta text-xs text-gray-700">
          {[tenant.phone, tenant.email].filter(Boolean).join(' · ')}
        </div>
      </div>
    </header>
  )
}
