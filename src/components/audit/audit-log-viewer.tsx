'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  FilterIcon,
  Loader2Icon,
} from 'lucide-react'
import { listAuditLogsAction, getDistinctEntityTypesAction } from '@/actions/audit'
import { formatDateTime } from '@/lib/utils'
import type { AuditLogWithUser } from '@/db/queries/audit'

// ─── Entity type label mapping ──────────────────────────────────────

const ENTITY_TYPE_LABELS: Record<string, string> = {
  patient: 'Paciente',
  appointment: 'Agendamento',
  procedure_record: 'Procedimento',
  procedure_type: 'Tipo de Procedimento',
  financial_entry: 'Cobranca',
  installment: 'Parcela',
  consent_template: 'Termo',
  consent_acceptance: 'Aceite de Termo',
  photo_asset: 'Foto',
  photo_annotation: 'Anotacao de Foto',
  face_diagram: 'Diagrama Facial',
  product_application: 'Aplicacao de Produto',
  anamnesis: 'Anamnese',
  tenant: 'Clinica',
  tenant_user: 'Membro da Equipe',
}

const ACTION_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  create: { label: 'Criacao', variant: 'default' },
  update: { label: 'Atualizacao', variant: 'secondary' },
  delete: { label: 'Exclusao', variant: 'destructive' },
  consent_accepted: { label: 'Aceite', variant: 'outline' },
  login: { label: 'Login', variant: 'outline' },
  logout: { label: 'Logout', variant: 'outline' },
}

function getEntityTypeLabel(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType] ?? entityType
}

function getActionBadge(action: string) {
  const config = ACTION_LABELS[action] ?? { label: action, variant: 'outline' as const }
  return <Badge variant={config.variant}>{config.label}</Badge>
}

// ─── JSON Diff Viewer ───────────────────────────────────────────────

function JsonDiffViewer({ changes }: { changes: unknown }) {
  if (!changes || typeof changes !== 'object') {
    return <p className="text-sm text-mid">Sem detalhes disponíveis</p>
  }

  const entries = Object.entries(changes as Record<string, unknown>)

  return (
    <div className="space-y-3">
      {entries.map(([key, value]) => {
        const change = value as { old?: unknown; new?: unknown } | unknown

        if (
          change &&
          typeof change === 'object' &&
          ('old' in (change as Record<string, unknown>) || 'new' in (change as Record<string, unknown>))
        ) {
          const typed = change as { old?: unknown; new?: unknown }
          return (
            <div key={key} className="rounded-md border border-petal p-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-mid">
                {key}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="mb-1 text-xs text-mid">Anterior</p>
                  <pre className="whitespace-pre-wrap break-all rounded bg-red-50 p-2 text-xs text-charcoal">
                    {typed.old === null || typed.old === undefined
                      ? '(vazio)'
                      : typeof typed.old === 'object'
                        ? JSON.stringify(typed.old, null, 2)
                        : String(typed.old)}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 text-xs text-mid">Novo</p>
                  <pre className="whitespace-pre-wrap break-all rounded bg-green-50 p-2 text-xs text-charcoal">
                    {typed.new === null || typed.new === undefined
                      ? '(vazio)'
                      : typeof typed.new === 'object'
                        ? JSON.stringify(typed.new, null, 2)
                        : String(typed.new)}
                  </pre>
                </div>
              </div>
            </div>
          )
        }

        // Fallback for non-diff entries
        return (
          <div key={key} className="rounded-md border border-petal p-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-mid">
              {key}
            </p>
            <pre className="whitespace-pre-wrap break-all rounded bg-petal p-2 text-xs text-charcoal">
              {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
            </pre>
          </div>
        )
      })}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────

export function AuditLogViewer() {
  const [logs, setLogs] = useState<AuditLogWithUser[]>([])
  const [entityTypes, setEntityTypes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  // Filters
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Pagination
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [total, setTotal] = useState(0)
  const limit = 20

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listAuditLogsAction({
        entityType: entityTypeFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        limit,
      })
      setLogs(result.data)
      setTotalPages(result.totalPages)
      setTotal(result.total)
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [entityTypeFilter, dateFrom, dateTo, page])

  const fetchEntityTypes = useCallback(async () => {
    try {
      const types = await getDistinctEntityTypesAction()
      setEntityTypes(types)
    } catch {
      // silently fail
    }
  }, [])

  useEffect(() => {
    fetchEntityTypes()
  }, [fetchEntityTypes])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const handleFilterReset = () => {
    setEntityTypeFilter('')
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  const toggleRow = (id: string) => {
    setExpandedRow(expandedRow === id ? null : id)
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px]">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-mid">
            Tipo de Entidade
          </label>
          <Select
            value={entityTypeFilter}
            onValueChange={(value) => {
              setEntityTypeFilter(value === '__all__' || value === null ? '' : value)
              setPage(1)
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              {entityTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {getEntityTypeLabel(type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-mid">
            Data Inicial
          </label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value)
              setPage(1)
            }}
            className="w-[160px]"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-mid">
            Data Final
          </label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value)
              setPage(1)
            }}
            className="w-[160px]"
          />
        </div>

        {(entityTypeFilter || dateFrom || dateTo) && (
          <Button variant="outline" size="sm" onClick={handleFilterReset}>
            <FilterIcon className="mr-1.5 h-3.5 w-3.5" />
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Results count */}
      <p className="text-sm text-mid">
        {total} {total === 1 ? 'registro' : 'registros'} encontrados
      </p>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[32px]" />
              <TableHead>Data/Hora</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead>Acao</TableHead>
              <TableHead>Entidade</TableHead>
              <TableHead>ID da Entidade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <div className="flex items-center justify-center gap-2 text-mid">
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                    Carregando...
                  </div>
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-mid">
                  Nenhum registro de auditoria encontrado.
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <>
                  <TableRow
                    key={log.id}
                    className="cursor-pointer hover:bg-petal/50"
                    onClick={() => toggleRow(log.id)}
                  >
                    <TableCell className="w-[32px] px-2">
                      {log.changes ? (
                        expandedRow === log.id ? (
                          <ChevronDownIcon className="h-4 w-4 text-mid" />
                        ) : (
                          <ChevronRightIcon className="h-4 w-4 text-mid" />
                        )
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDateTime(log.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm">{log.userName}</TableCell>
                    <TableCell>{getActionBadge(log.action)}</TableCell>
                    <TableCell className="text-sm">
                      {getEntityTypeLabel(log.entityType)}
                    </TableCell>
                    <TableCell className="max-w-[120px] truncate font-mono text-xs text-mid">
                      {log.entityId ? log.entityId.slice(0, 8) + '...' : '-'}
                    </TableCell>
                  </TableRow>
                  {expandedRow === log.id && log.changes && (
                    <TableRow key={`${log.id}-detail`}>
                      <TableCell colSpan={6} className="bg-cream p-4">
                        <JsonDiffViewer changes={log.changes} />
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-mid">
            Pagina {page} de {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeftIcon className="mr-1 h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Proxima
              <ChevronRightIcon className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
