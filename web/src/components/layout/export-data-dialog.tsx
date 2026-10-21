'use client'

import { useState } from 'react'
import Link from 'next/link'
import { DownloadIcon } from 'lucide-react'
import { useSubscriptionAccess } from '@/components/layout/subscription-access'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * One place that lists the exports the app already has. Reading and exporting
 * stay open in read-only mode (they are GET routes, never behind
 * `requireWrite`), so a clinic whose subscription ended can always take its
 * data with it, which LGPD expects of us.
 */
// `roles` mirrors each page's own guard: /relatorios (and /relatorios/
// prontuario under it) requires owner or financial, the ledger API owner,
// financial or receptionist. A role that cannot open the page never sees it.
const EXPORTS = [
  {
    roles: ['owner', 'financial'],
    href: '/relatorios/prontuario',
    title: 'Prontuário do paciente (PDF)',
    description: 'Escolha o paciente e baixe o prontuário completo, com procedimentos e anotações.',
  },
  {
    roles: ['owner', 'financial'],
    href: '/relatorios',
    title: 'Relatórios (CSV e PDF)',
    description: 'Procedimentos realizados, retornos, faltas, pacientes inativos, ganhos e extrato do período.',
  },
  {
    roles: ['owner', 'financial', 'receptionist'],
    href: '/financeiro?tab=ledger',
    title: 'Extrato financeiro (CSV)',
    description: 'Todas as entradas e saídas, com filtros por período e forma de pagamento.',
  },
] as const

export function exportsForRole(role: string) {
  return EXPORTS.filter((item) => (item.roles as readonly string[]).includes(role))
}

export function ExportDataDialog({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called when an export is picked, before navigating: the paywall uses it
   *  to get out of the way of the page being opened. */
  onNavigate?: () => void
}) {
  const { role } = useSubscriptionAccess()
  const items = exportsForRole(role)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="export-data-dialog">
        <DialogHeader>
          <DialogTitle>Exportar meus dados</DialogTitle>
          <DialogDescription>
            Seus dados continuam seus. Baixe o que precisar, mesmo sem uma assinatura ativa.
          </DialogDescription>
        </DialogHeader>
        {items.length === 0 && (
          <p className="text-sm text-charcoal" data-testid="export-data-no-access">
            As exportações ficam com a pessoa responsável pela clínica. Peça a ela, ou escreva para nós.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => {
                  onOpenChange(false)
                  onNavigate?.()
                }}
                className="flex items-start gap-3 rounded-lg border border-topbar-border p-3 transition-colors hover:bg-content-bg"
              >
                <DownloadIcon className="mt-0.5 size-4 shrink-0 text-sage" />
                <span>
                  <span className="block text-sm font-medium text-charcoal">{item.title}</span>
                  <span className="block text-xs text-mid">{item.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-xs text-mid">
          Precisa de uma cópia completa de todos os dados da clínica? Escreva para{' '}
          <a href="mailto:contato@floraclin.com.br" className="underline underline-offset-2">
            contato@floraclin.com.br
          </a>{' '}
          e enviamos para você.
        </p>
      </DialogContent>
    </Dialog>
  )
}

/** Inline "Exportar meus dados" trigger with its own dialog. */
export function ExportDataLink({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} data-testid="export-data-link">
        Exportar meus dados
      </button>
      <ExportDataDialog open={open} onOpenChange={setOpen} onNavigate={onNavigate} />
    </>
  )
}
