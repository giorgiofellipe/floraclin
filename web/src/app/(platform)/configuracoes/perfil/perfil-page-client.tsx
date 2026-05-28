'use client'

import Link from 'next/link'
import { ArrowLeftIcon, UserIcon } from 'lucide-react'
import { useProfile } from '@/hooks/queries/use-profile'
import { ProfessionalSignatureForm } from '@/components/settings/professional-signature-form'

export function PerfilPageClient() {
  const { data, isLoading, error } = useProfile()

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <Link
          href="/configuracoes"
          className="inline-flex items-center gap-1.5 text-sm text-mid hover:text-charcoal transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Configurações
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-[#2A2A2A]">Meu Perfil</h1>
        <p className="text-sm text-mid mt-0.5">
          Configure sua assinatura digital e registro profissional para uso em
          receitas, atestados e demais documentos clínicos.
        </p>
      </div>

      <div className="bg-white rounded-[3px] shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="px-5 sm:px-6 py-4 border-b border-[#E8ECEF]">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-[3px] bg-sage/10">
              <UserIcon className="h-4 w-4 text-sage" />
            </div>
            <h2 className="text-lg font-medium text-[#2A2A2A]">
              Assinatura profissional
            </h2>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {isLoading && (
            <div className="py-12 text-center text-sm text-mid">
              Carregando perfil...
            </div>
          )}
          {error && !isLoading && (
            <div className="py-12 text-center text-sm text-mid">
              Erro ao carregar perfil:{' '}
              {error instanceof Error ? error.message : 'erro desconhecido'}
            </div>
          )}
          {data?.data && (
            <ProfessionalSignatureForm initialProfile={data.data} />
          )}
        </div>
      </div>
    </div>
  )
}
