'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDownIcon, ChevronRightIcon, Loader2, PackageIcon, PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PackageCard } from './package-card'
import { usePatientPackages } from '@/hooks/queries/use-packages'

interface PatientPackagesTabProps {
  patientId: string
  patientName?: string
}

export function PatientPackagesTab({
  patientId,
}: PatientPackagesTabProps) {
  const { data, isLoading } = usePatientPackages(patientId)
  const [showHistory, setShowHistory] = useState(false)

  const { activePackages, historyPackages } = useMemo(() => {
    const all = data ?? []
    const active = all.filter((p) => p.status === 'active')
    const history = all.filter((p) => p.status !== 'active')
    return { activePackages: active, historyPackages: history }
  }, [data])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-5 animate-spin text-sage" />
        <span className="ml-2.5 text-[13px] text-mid">
          Carregando pacotes...
        </span>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-mid">
            Pacotes
          </span>
          <span className="text-[12px] text-mid/50">
            {activePackages.length}{' '}
            {activePackages.length === 1 ? 'ativo' : 'ativos'}
            {historyPackages.length > 0 && ` · ${historyPackages.length} no histórico`}
          </span>
        </div>
        <Link href={`/pacientes/${patientId}/atendimento?new=1`}>
          <Button size="sm">
            <PlusIcon data-icon="inline-start" />
            Novo atendimento
          </Button>
        </Link>
      </div>

      {activePackages.length === 0 && historyPackages.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-16">
          <div className="relative mb-5">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-[#F4F6F8]">
              <PackageIcon className="size-7 text-mid/40" />
            </div>
            <div className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full bg-forest text-cream shadow-sm">
              <PlusIcon className="size-3" />
            </div>
          </div>
          <p className="text-[15px] font-medium text-charcoal">
            Nenhum pacote ativo
          </p>
          <p className="mt-1 text-[13px] text-mid">
            Venda um pacote para este paciente.
          </p>
          <Link href={`/pacientes/${patientId}/atendimento?new=1`}>
            <Button size="sm" variant="outline" className="mt-4">
              <PlusIcon data-icon="inline-start" />
              Novo atendimento
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {activePackages.length > 0 ? (
            <div className="space-y-4">
              {activePackages.map((pkg) => (
                <PackageCard key={pkg.id} patientId={patientId} pkg={pkg} />
              ))}
            </div>
          ) : (
            <div className="rounded-[3px] border border-dashed border-[#E8ECEF] p-6 text-center text-[13px] text-mid">
              Nenhum pacote ativo no momento.
            </div>
          )}

          {historyPackages.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="flex w-full items-center gap-2 rounded-[3px] py-2 text-[12px] font-medium uppercase tracking-wider text-mid transition-colors hover:text-charcoal"
              >
                {showHistory ? (
                  <ChevronDownIcon className="size-3.5" />
                ) : (
                  <ChevronRightIcon className="size-3.5" />
                )}
                Histórico ({historyPackages.length})
              </button>

              {showHistory && (
                <div className="mt-3 space-y-4">
                  {historyPackages.map((pkg) => (
                    <PackageCard
                      key={pkg.id}
                      patientId={patientId}
                      pkg={pkg}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  )
}
