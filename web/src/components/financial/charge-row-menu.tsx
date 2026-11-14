'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toBrYmd } from '@/lib/dates'
import { useSubscriptionAccess } from '@/components/layout/subscription-access'
import { CHARGE_MANAGER_ROLES, CHARGE_PAYER_ROLES, hasRole, LEDGER_VIEWER_ROLES } from '@/lib/financial/charge-roles'
import {
  BanknoteIcon,
  BookOpenIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  Undo2Icon,
  XCircleIcon,
} from 'lucide-react'
import type { ChargeDialog } from './charge-action-dialogs'

export interface ChargeRowMenuEntry {
  id: string
  patientId: string
  status: string
  createdAt: Date | string
  pendingInstallmentIds?: string[]
}

const OPEN_STATUSES = ['pending', 'partial', 'overdue']

/** Why Renegociar is off for this charge, or null when it applies (same rule as the bulk bar). */
export function renegotiateBlockedReason(status: string): string | null {
  if (status === 'pending' || status === 'partial') return null
  if (status === 'paid') return 'Cobrança já paga'
  if (status === 'cancelled') return 'Cobrança cancelada'
  if (status === 'renegotiated') return 'Já renegociada'
  return 'Só cobranças pendentes'
}

/** The Extrato filtered to this charge's patient, from the day it was created. */
export function ledgerHrefFor(entry: Pick<ChargeRowMenuEntry, 'patientId' | 'createdAt'>): string {
  const params = new URLSearchParams({
    tab: 'ledger',
    patientId: entry.patientId,
    dateFrom: toBrYmd(new Date(entry.createdAt)),
  })
  return `/financeiro?${params}`
}

/**
 * The "⋯" on a charge row: settle every open installment at once,
 * renegotiate, cancel or reactivate this one charge, plus a jump to its
 * payments in the Extrato. Receber (the next installment) is the row's own
 * button. Off items say why in the menu itself, so the reason is readable on
 * touch too.
 */
export function ChargeRowMenu({
  entry,
  onDialog,
  onRenegotiate,
  onPayAll,
}: {
  entry: ChargeRowMenuEntry
  onDialog: (dialog: ChargeDialog) => void
  onRenegotiate: () => void
  onPayAll: () => void
}) {
  const { role } = useSubscriptionAccess()
  const canManage = hasRole(CHARGE_MANAGER_ROLES, role)
  const canSeeLedger = hasRole(LEDGER_VIEWER_ROLES, role)
  const pendingCount = entry.pendingInstallmentIds?.length ?? 0
  const canPayAll = hasRole(CHARGE_PAYER_ROLES, role) && OPEN_STATUSES.includes(entry.status) && pendingCount > 1
  const renegotiateReason = renegotiateBlockedReason(entry.status)
  const isCancelled = entry.status === 'cancelled'

  if (!canManage && !canSeeLedger && !canPayAll) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="-my-1.5 size-11 shrink-0 text-mid hover:text-charcoal"
            aria-label="Mais ações"
            data-testid="charge-row-menu"
          >
            <MoreHorizontalIcon className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-60">
        {canPayAll && (
          <DropdownMenuItem className="min-h-11" onClick={onPayAll}>
            <BanknoteIcon />
            Receber todas as parcelas ({pendingCount})
          </DropdownMenuItem>
        )}
        {canManage && (
          <>
            <DropdownMenuItem className="min-h-11 flex-wrap" disabled={renegotiateReason !== null} onClick={onRenegotiate}>
              <RefreshCwIcon />
              Renegociar
              {renegotiateReason && <span className="basis-full pl-5.5 text-xs text-mid">{renegotiateReason}</span>}
            </DropdownMenuItem>
            {isCancelled ? (
              <DropdownMenuItem className="min-h-11" onClick={() => onDialog('uncancel')}>
                <Undo2Icon />
                Reativar
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem className="min-h-11" variant="destructive" onClick={() => onDialog('cancel')}>
                <XCircleIcon />
                Cancelar
              </DropdownMenuItem>
            )}
          </>
        )}
        {canManage && canSeeLedger && <DropdownMenuSeparator />}
        {canSeeLedger && (
          <DropdownMenuItem className="min-h-11" render={<Link href={ledgerHrefFor(entry)} />}>
            <BookOpenIcon />
            Ver no extrato
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
