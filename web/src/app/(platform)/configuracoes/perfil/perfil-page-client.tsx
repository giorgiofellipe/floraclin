'use client'

import Link from 'next/link'
import {
  ArrowLeftIcon,
  CalendarIcon,
  KeyIcon,
  PenLineIcon,
  UserIcon,
} from 'lucide-react'
import { useProfile } from '@/hooks/queries/use-profile'
import { useCalendarConnections } from '@/hooks/queries/use-calendar'
import { AccountInfoForm } from '@/components/settings/account-info-form'
import { PasswordForm } from '@/components/settings/password-form'
import { ProfessionalSignatureForm } from '@/components/settings/professional-signature-form'
import { CalendarConnectionCard } from '@/components/settings/calendar-connection-card'

interface PerfilPageClientProps {
  /** Comes from the session — same source as the avatar dropdown used to use. */
  userRole?: string
}

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-white rounded-[3px] shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <header className="px-5 sm:px-6 py-4 border-b border-[#E8ECEF]">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 rounded-[3px] bg-sage/10">
            {icon}
          </div>
          <div>
            <h2 className="text-lg font-medium text-[#2A2A2A]">{title}</h2>
            {description ? (
              <p className="text-xs text-mid mt-0.5">{description}</p>
            ) : null}
          </div>
        </div>
      </header>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  )
}

export function PerfilPageClient({ userRole }: PerfilPageClientProps) {
  const { data, isLoading, error } = useProfile()
  const showCalendar = userRole === 'owner' || userRole === 'practitioner'
  const { data: connections } = useCalendarConnections()
  const profile = data?.data ?? null
  const myConnection =
    connections?.find((c: { userId: string | null }) => c.userId === profile?.id) ?? null

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
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
          Conta, senha, assinatura profissional e integrações da sua conta.
        </p>
      </div>

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

      {profile && (
        <div className="space-y-5">
          <Section
            icon={<UserIcon className="h-4 w-4 text-sage" />}
            title="Conta"
            description="Nome e contato exibidos no sistema."
          >
            <AccountInfoForm initial={profile} />
          </Section>

          <Section
            icon={<KeyIcon className="h-4 w-4 text-sage" />}
            title="Senha"
            description="Defina ou altere sua senha de acesso."
          >
            <PasswordForm />
          </Section>

          <Section
            icon={<PenLineIcon className="h-4 w-4 text-sage" />}
            title="Assinatura profissional"
            description="Usada em receitas, atestados e demais documentos clínicos."
          >
            <ProfessionalSignatureForm initialProfile={profile} />
          </Section>

          {showCalendar && (
            <Section
              icon={<CalendarIcon className="h-4 w-4 text-sage" />}
              title="Google Calendar"
              description="Sincronize seus agendamentos com o Google Calendar."
            >
              <CalendarConnectionCard
                type="practitioner"
                connection={myConnection}
                helperText="Sincronize seus agendamentos com o Google Calendar."
              />
            </Section>
          )}
        </div>
      )}
    </div>
  )
}
