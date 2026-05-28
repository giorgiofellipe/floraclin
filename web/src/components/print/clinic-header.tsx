import * as React from 'react'

interface Address {
  street?: string
  number?: string
  complement?: string
  neighborhood?: string
  city?: string
  state?: string
  zip?: string
}

export interface ClinicHeaderProps {
  tenant: {
    name: string
    phone: string | null
    email: string | null
    logoUrl: string | null
    address: Address | null
  }
  className?: string
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

export function ClinicHeader({ tenant, className }: ClinicHeaderProps) {
  return (
    <header className={`flex items-center gap-4 border-b border-gray-300 pb-4 ${className ?? ''}`}>
      {tenant.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tenant.logoUrl} alt={tenant.name} className="h-16 w-16 object-contain" />
      )}
      <div className="flex-1">
        <div className="text-lg font-semibold">{tenant.name}</div>
        {tenant.address && <div className="text-xs text-gray-700">{formatAddress(tenant.address)}</div>}
        <div className="text-xs text-gray-700">
          {[tenant.phone, tenant.email].filter(Boolean).join(' · ')}
        </div>
      </div>
    </header>
  )
}
