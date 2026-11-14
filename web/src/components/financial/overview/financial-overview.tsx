'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRightIcon, PlusIcon, ReceiptIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { MonthSelector } from '@/components/dashboard/month-selector'
import { ReadOnlyGuard } from '@/components/layout/subscription-access'
import { useFinancialOverview } from '@/hooks/queries/use-financial'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { brToday, parseLocalDate } from '@/lib/dates'
import { cn, formatCurrency } from '@/lib/utils'
import { CashFlowChart } from './cash-flow-chart'
import { RankingBars } from './ranking-bars'

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  cash: 'Dinheiro',
  transfer: 'Transferência',
}

const OVERDUE_HREF = '/financeiro?tab=receivables&isOverdue=true'
const PENDING_HREF = '/financeiro?tab=receivables&status=pending'
const CARD_FEES_HREF = '/financeiro?tab=card-repasses'

function ledgerHref(type: 'inflow' | 'outflow', dateFrom: string, dateTo: string) {
  return `/financeiro?${new URLSearchParams({ tab: 'ledger', type, dateFrom, dateTo })}`
}

function monthName(month: string) {
  return format(parseLocalDate(`${month}-01`), "MMMM 'de' yyyy", { locale: ptBR })
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

function BreakdownRow({ href, label, value, sign }: { href: string; label: string; value: number; sign?: '−' }) {
  return (
    <Link
      href={href}
      className="group flex min-h-11 items-center justify-between gap-3 rounded-md px-2 -mx-2 text-sm transition-colors hover:bg-petal/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage"
    >
      <span className="text-mid">{label}</span>
      <span className="flex items-center gap-1 tabular-nums text-charcoal">
        {sign && <span className="text-mid">{sign}</span>}
        {formatCurrency(value)}
        <ChevronRightIcon className="size-4 text-mid/60 transition-colors group-hover:text-forest" aria-hidden="true" />
      </span>
    </Link>
  )
}

function StatCard({
  title,
  value,
  caption,
  href,
  action,
  tone = 'default',
  testId,
}: {
  title: string
  value: number
  caption: string
  href: string
  action: string
  tone?: 'default' | 'alert'
  testId: string
}) {
  return (
    <Card size="sm" className="flex-1" data-testid={testId}>
      <CardContent className="flex h-full flex-col gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-mid">{title}</p>
          <p
            className={cn(
              'mt-1 text-2xl font-semibold tabular-nums tracking-tight',
              tone === 'alert' ? 'text-amber-dark' : 'text-charcoal',
            )}
          >
            {formatCurrency(value)}
          </p>
          <p className="mt-0.5 text-xs text-mid">{caption}</p>
        </div>
        <Link
          href={href}
          className={cn(buttonVariants({ variant: 'outline' }), 'mt-auto h-11 justify-between md:h-9')}
        >
          {action}
          <ChevronRightIcon aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-charcoal">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function EmptyOverview() {
  return (
    <Card data-testid="overview-empty">
      <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="rounded-full bg-petal p-3">
          <ReceiptIcon className="size-5 text-sage" aria-hidden="true" />
        </div>
        <p className="max-w-sm text-sm text-charcoal">
          Seu lucro aparece aqui quando você registrar pagamentos e despesas.
        </p>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Link
            href="/financeiro?tab=receivables"
            className={cn(buttonVariants({ variant: 'outline' }), 'h-11 md:h-9')}
          >
            Ver cobranças
          </Link>
          <ReadOnlyGuard label="Lançar despesa">
            <Link
              href="/financeiro?tab=expenses&novo=1"
              className={cn(buttonVariants(), 'h-11 bg-forest text-cream hover:bg-sage md:h-9')}
            >
              <PlusIcon aria-hidden="true" />
              Lançar despesa
            </Link>
          </ReadOnlyGuard>
        </div>
      </CardContent>
    </Card>
  )
}

export function FinancialOverview() {
  const currentMonth = brToday().slice(0, 7)
  const [month, setMonth] = useState(currentMonth)
  const { data, isPending, isError, isPlaceholderData } = useFinancialOverview(month)

  const header = <MonthSelector month={month} currentMonth={currentMonth} onChange={setMonth} />

  if (isError) {
    return (
      <div className="space-y-4">
        {header}
        <p className="py-16 text-center text-sm text-mid">Não foi possível carregar a visão geral.</p>
      </div>
    )
  }

  if (isPending || !data) {
    return (
      <div className="space-y-4">
        {header}
        <div className="flex items-center justify-center gap-2 py-16">
          <span className="size-2 animate-pulse rounded-full bg-sage" />
          <span className="text-sm text-mid">Carregando dados financeiros...</span>
        </div>
      </div>
    )
  }

  const { summary, receivables, monthly, monthStart, monthEnd } = data
  const isEmpty =
    monthly.every((m) => m.received === 0 && m.expenses === 0) &&
    receivables.overdue.total === 0 &&
    receivables.dueSoon.total === 0

  if (isEmpty) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyOverview />
      </div>
    )
  }

  const profitIsNegative = summary.netProfit < 0

  return (
    <div
      className={cn('space-y-4 transition-opacity duration-150', isPlaceholderData && 'opacity-60')}
      aria-busy={isPlaceholderData}
      data-testid="financial-overview"
    >
      {header}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" data-testid="overview-profit">
          <CardContent className="flex h-full flex-col gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-mid">Lucro do mês</p>
              <p
                className={cn(
                  'mt-1 text-4xl font-semibold tabular-nums tracking-tight',
                  profitIsNegative ? 'text-red-700' : 'text-forest',
                )}
              >
                {formatCurrency(summary.netProfit)}
              </p>
            </div>
            <div className="divide-y divide-border border-t border-border pt-1">
              <BreakdownRow href={ledgerHref('inflow', monthStart, monthEnd)} label="Recebido" value={summary.totalReceived} />
              <BreakdownRow
                href={ledgerHref('outflow', monthStart, monthEnd)}
                label="Despesas pagas"
                value={summary.totalExpenses}
                sign="−"
              />
              <BreakdownRow href={CARD_FEES_HREF} label="Taxas de cartão" value={summary.totalCardFees} sign="−" />
            </div>
            <p className="mt-auto text-xs text-mid">O que entrou e saiu em {monthName(month)}, pela data do pagamento.</p>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4 sm:flex-row lg:flex-col">
          <StatCard
            testId="overview-overdue"
            title="Vencido"
            value={receivables.overdue.total}
            caption={
              receivables.overdue.patientCount > 0
                ? `${plural(receivables.overdue.patientCount, 'paciente', 'pacientes')} em atraso hoje`
                : 'Nada em atraso hoje'
            }
            href={OVERDUE_HREF}
            action="Ver vencidos"
            tone={receivables.overdue.total > 0 ? 'alert' : 'default'}
          />
          <StatCard
            testId="overview-due-soon"
            title="A receber em 7 dias"
            value={receivables.dueSoon.total}
            caption={plural(receivables.dueSoon.count, 'parcela', 'parcelas')}
            href={PENDING_HREF}
            action="Ver a receber"
          />
        </div>
      </div>

      <Section title="Recebido x despesas nos últimos 6 meses">
        <CashFlowChart months={monthly} selected={month} />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Recebido por procedimento">
          <RankingBars items={data.byProcedureType} emptyLabel="Nenhum pagamento recebido no mês" />
        </Section>
        <Section title="Recebido por forma de pagamento">
          <RankingBars
            items={data.byPaymentMethod.map((p) => ({
              name: PAYMENT_METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod,
              total: p.total,
            }))}
            emptyLabel="Nenhum pagamento recebido no mês"
          />
        </Section>
      </div>
    </div>
  )
}
