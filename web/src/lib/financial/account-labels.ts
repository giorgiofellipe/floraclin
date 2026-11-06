import type { FinancialAccountKind } from '@/db/schema'

export const ACCOUNT_KIND_LABELS: Record<FinancialAccountKind, string> = {
  bank: 'Conta bancária',
  cash: 'Caixa (dinheiro)',
  acquirer: 'Adquirente (maquininha)',
  legacy: 'Anterior às contas',
}
