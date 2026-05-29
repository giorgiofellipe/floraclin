'use client'

import Link from 'next/link'
import { ArrowLeftIcon, PackageIcon } from 'lucide-react'
import { PackageTemplateList } from '@/components/packages/package-template-list'
import { usePackageTemplates } from '@/hooks/queries/use-packages'

export function PacotesPageClient() {
  const { data, isLoading } = usePackageTemplates()

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <Link
          href="/configuracoes"
          className="inline-flex items-center gap-1.5 text-sm text-mid transition-colors hover:text-charcoal"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Configurações
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-[#2A2A2A]">
          Modelos de pacote
        </h1>
        <p className="mt-0.5 text-sm text-mid">
          Crie modelos de pacotes reutilizáveis combinando procedimentos e
          quantidade de sessões. Modelos servem como ponto de partida na venda
          para um paciente.
        </p>
      </div>

      <div className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="border-b border-[#E8ECEF] px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[3px] bg-sage/10">
              <PackageIcon className="h-4 w-4 text-sage" />
            </div>
            <h2 className="text-lg font-medium text-[#2A2A2A]">
              Modelos cadastrados
            </h2>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <PackageTemplateList
            templates={data ?? []}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  )
}
