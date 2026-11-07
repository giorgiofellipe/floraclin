'use client'

import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangleIcon, Loader2Icon, UploadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn, formatCurrency } from '@/lib/utils'
import { useFinancialAccounts } from '@/hooks/queries/use-financial-accounts'
import {
  useConfirmDistinctLine,
  useStatementLines,
  useUndoMatch,
  useUnignoreLine,
  type StatementLineView,
} from '@/hooks/queries/use-bank-reconciliation'
import type { StatementLineFilter } from '@/db/queries/bank-reconciliation'
import { ImportDialog } from './import-dialog'
import { MatchDialog } from './match-dialog'
import { IgnoreDialog } from './ignore-dialog'
import { ExpenseFromLineDialog } from './expense-from-line-dialog'

const FILTERS: Array<{ value: StatementLineFilter; label: string }> = [
  { value: 'pending', label: 'Pendentes' },
  { value: 'matched', label: 'Conciliados' },
  { value: 'ignored', label: 'Ignorados' },
  { value: 'all', label: 'Todos' },
]

const STATUS_LABEL: Record<StatementLineView['status'], string> = {
  open: 'Pendente',
  partial: 'Parcial',
  matched: 'Conciliado',
  ignored: 'Ignorado',
}

const brDate = (ymd: string) => ymd.split('-').reverse().join('/')

type Dialog =
  | { kind: 'match'; line: StatementLineView }
  | { kind: 'ignore'; line: StatementLineView }
  | { kind: 'expense'; line: StatementLineView }
  | null

export function ReconciliationView() {
  const { data: accountsResponse } = useFinancialAccounts()
  const bankAccounts = useMemo(
    () => (accountsResponse?.data ?? []).filter((a) => a.kind === 'bank' && !a.archivedAt),
    [accountsResponse],
  )
  const [pickedAccountId, setPickedAccountId] = useState('')
  const accountId = pickedAccountId || bankAccounts[0]?.id || ''
  const [status, setStatus] = useState<StatementLineFilter>('pending')
  const [offset, setOffset] = useState(0)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const { data, isLoading, error } = useStatementLines(accountId, status, offset)
  const undo = useUndoMatch()
  const unignore = useUnignoreLine()
  const confirmDistinct = useConfirmDistinctLine()

  if (!accountsResponse) return null

  if (bankAccounts.length === 0) {
    return (
      <div className="rounded-lg border border-[#E8ECEF] bg-white p-8 text-center text-sm text-mid" data-testid="reconciliation-no-bank">
        Cadastre uma conta bancária em Configurações › Financeiro › Contas para importar um extrato.
      </div>
    )
  }

  const accountItems = Object.fromEntries(bankAccounts.map((a) => [a.id, a.name]))

  async function run(action: Promise<unknown>, success: string) {
    try {
      await action
      toast.success(success)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar a conciliação')
    }
  }

  return (
    <div className="min-w-0 space-y-4" data-testid="reconciliation-view">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label>Conta</Label>
          <Select
            items={accountItems}
            value={accountId}
            onValueChange={(v) => {
              setPickedAccountId(v ?? '')
              setOffset(0)
            }}
          >
            <SelectTrigger className="min-h-11 w-56 max-w-full" aria-label="Conta bancária">
              <SelectValue />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept=".ofx,.OFX,application/x-ofx,text/plain"
          className="hidden"
          data-testid="ofx-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) setImportFile(file)
          }}
        />
        <Button className="min-h-11" onClick={() => fileInput.current?.click()}>
          <UploadIcon className="h-4 w-4" />
          Importar extrato (OFX)
        </Button>

        <div className="flex w-full min-w-0 gap-1 overflow-x-auto rounded-lg border border-[#E8ECEF] bg-white p-1 md:ml-auto md:w-auto">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={status === f.value}
              onClick={() => {
                setStatus(f.value)
                setOffset(0)
              }}
              className={cn(
                'min-h-11 shrink-0 rounded-md px-3 py-1.5 text-sm font-medium',
                status === f.value ? 'bg-forest text-cream' : 'text-mid hover:bg-[#F4F6F8]',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error instanceof Error ? error.message : 'Erro ao carregar o extrato'}</p>}

      <div className="rounded-lg border border-[#E8ECEF] bg-white">
        <Table className="block md:table">
          <TableHeader className="hidden md:table-header-group">
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Descrição do banco</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="block md:table-row-group">
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-mid">
                  <Loader2Icon className="mx-auto h-4 w-4 animate-spin" />
                </TableCell>
              </TableRow>
            )}
            {data && data.lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-mid">
                  {status === 'pending' ? 'Nada pendente. Importe um extrato ou veja os conciliados.' : 'Nenhum lançamento.'}
                </TableCell>
              </TableRow>
            )}
            {data?.lines.map((line) => {
              const credit = line.amountCents > 0
              const suspect = Boolean(line.suspectedDuplicateOf) && !line.suspectReviewedAt && line.status !== 'ignored'
              return (
                <TableRow key={line.id} data-testid="statement-line" className="grid min-w-0 grid-cols-2 gap-2 p-4 md:table-row md:p-0">
                  <TableCell className="order-1 block p-0 text-xs text-[#6B6B6B] md:table-cell md:p-2 md:text-sm">{brDate(line.postedDate)}</TableCell>
                  <TableCell className="order-3 col-span-2 block min-w-0 whitespace-normal p-0 [overflow-wrap:anywhere] md:table-cell md:p-2">
                    <div className="line-clamp-2 min-w-0 md:max-w-md" title={line.memo}>{line.memo}</div>
                    {suspect && (
                      <div className="flex items-start gap-1 text-xs text-amber-800" data-testid="suspect-note">
                        <AlertTriangleIcon className="size-3 shrink-0" aria-hidden="true" />Possível duplicado de outro lançamento já importado.
                      </div>
                    )}
                    {line.status === 'ignored' && <div className="text-xs text-mid">Motivo: {line.ignoreReason}</div>}
                    {line.allocations.map((a) => (
                      <div key={a.id} className="text-xs text-mid">
                        ↳ {a.description} · {formatCurrency(a.amountCents / 100)}
                      </div>
                    ))}
                  </TableCell>
                  <TableCell className={cn('order-2 block min-w-0 whitespace-normal p-0 text-right font-semibold tabular-nums md:table-cell md:p-2', credit ? 'text-forest' : 'text-red-600')}>
                    {credit ? '+' : '-'}
                    {formatCurrency(Math.abs(line.amountCents) / 100)}
                    {line.status === 'partial' && (
                      <div className="text-xs text-mid">falta {formatCurrency((Math.abs(line.amountCents) - line.allocatedCents) / 100)}</div>
                    )}
                  </TableCell>
                  <TableCell className="order-4 col-span-2 block p-0 text-xs text-[#6B6B6B] md:table-cell md:p-2 md:text-sm">{STATUS_LABEL[line.status]}</TableCell>
                  <TableCell className="order-5 col-span-2 flex min-w-0 flex-wrap gap-2 whitespace-normal p-0 md:table-cell md:space-x-1 md:whitespace-nowrap md:p-2 md:text-right">
                    {(line.status === 'open' || line.status === 'partial') && (
                      <>
                        <Button className="min-h-11 flex-1 md:flex-none" size="sm" onClick={() => setDialog({ kind: 'match', line })}>Conciliar</Button>
                        {!credit && line.status === 'open' && (
                          <Button className="min-h-11 flex-1 md:flex-none" size="sm" variant="outline" onClick={() => setDialog({ kind: 'expense', line })}>Criar despesa</Button>
                        )}
                      </>
                    )}
                    {line.status === 'open' && (
                      <Button className="min-h-11 flex-1 md:flex-none" size="sm" variant="outline" onClick={() => setDialog({ kind: 'ignore', line })}>Ignorar</Button>
                    )}
                    {suspect && (
                      <Button className="min-h-11 flex-1 md:flex-none" size="sm" variant="outline" disabled={confirmDistinct.isPending} onClick={() => run(confirmDistinct.mutateAsync(line.id), 'Mantido como lançamento distinto')}>
                        É outro lançamento
                      </Button>
                    )}
                    {(line.status === 'matched' || line.status === 'partial') && (
                      <Button className="min-h-11 flex-1 md:flex-none" size="sm" variant="outline" disabled={undo.isPending} onClick={() => run(undo.mutateAsync({ lineId: line.id }), 'Conciliação desfeita. O pagamento não foi alterado')}>
                        Desfazer
                      </Button>
                    )}
                    {line.status === 'ignored' && (
                      <Button className="min-h-11 flex-1 md:flex-none" size="sm" variant="outline" disabled={unignore.isPending} onClick={() => run(unignore.mutateAsync(line.id), 'Lançamento restaurado')}>
                        Restaurar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {data && (offset > 0 || data.hasMore) && (
        <div className="flex justify-end gap-2">
          <Button className="min-h-11" variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Anterior</Button>
          <Button className="min-h-11" variant="outline" size="sm" disabled={!data.hasMore} onClick={() => setOffset(offset + 50)}>Próxima</Button>
        </div>
      )}

      <ImportDialog accountId={accountId} file={importFile} onClose={() => setImportFile(null)} />
      <MatchDialog line={dialog?.kind === 'match' ? dialog.line : null} onClose={() => setDialog(null)} />
      <IgnoreDialog line={dialog?.kind === 'ignore' ? dialog.line : null} onClose={() => setDialog(null)} />
      <ExpenseFromLineDialog line={dialog?.kind === 'expense' ? dialog.line : null} onClose={() => setDialog(null)} />
    </div>
  )
}
