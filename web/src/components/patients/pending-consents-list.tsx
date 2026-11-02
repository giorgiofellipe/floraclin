'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { usePendingConsents } from '@/hooks/queries/use-consent'
import { formatBrDate } from '@/lib/dates'

const CONSENT_TYPE_LABELS: Record<string, string> = {
  general: 'Termo geral',
  botox: 'Toxina botulínica',
  filler: 'Preenchimento',
  biostimulator: 'Bioestimulador',
  service_contract: 'Contrato',
}

export function PendingConsentsList({ patientId }: { patientId: string }) {
  const { data: items } = usePendingConsents(patientId)

  if (!items || items.length === 0) return null

  return (
    <section
      aria-label="Assinaturas pendentes"
      className="space-y-2 rounded-[3px] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
    >
      <h3 className="text-sm font-medium text-charcoal">Assinaturas pendentes</h3>
      <ul className="space-y-3">
        {items.map((item) => (
          <li
            key={item.procedureRecordId}
            className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="space-y-1">
              <p className="text-sm font-medium text-charcoal">
                {item.procedureTypeName}
                {item.approvedAt && (
                  <span className="ml-2 font-normal text-mid">
                    Aprovado em {formatBrDate(item.approvedAt)}
                  </span>
                )}
              </p>
              <div className="flex flex-wrap gap-1">
                {item.pendingTypes.map((type) => (
                  <span
                    key={type}
                    className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
                  >
                    {CONSENT_TYPE_LABELS[type] ?? type}
                  </span>
                ))}
              </div>
            </div>
            <Button
              variant="outline"
              render={
                <Link
                  href={`/pacientes/${patientId}/procedimentos/${item.procedureRecordId}?action=sign`}
                />
              }
            >
              Coletar assinaturas
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
