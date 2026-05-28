'use client'

import { useState } from 'react'
import Link from 'next/link'
import { differenceInDays } from 'date-fns'
import {
  Clock,
  MessageCircle,
  MoreHorizontal,
  PauseCircle,
  PhoneCall,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { brToday, parseBrDate } from '@/lib/dates'
import type { OpenPlanejamento } from '@/hooks/queries/use-planejamentos'

import { FollowupModal } from './followup-modal'
import { SnoozeModal } from './snooze-modal'

function formatCurrencyBrl(value: string | null): string {
  if (!value) return '—'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '—'
  return numeric.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function buildWhatsappHref(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '')
  // Internal route — opens our WhatsApp module with the patient pre-selected if possible
  if (!digits) return '/whatsapp'
  return `/whatsapp?phone=${digits}`
}

function getDaysSinceLastContact(row: OpenPlanejamento): number {
  const reference = row.lastContactedAt ?? row.createdAt
  const ref = new Date(reference)
  const today = parseBrDate(brToday(), '12:00:00')
  return Math.max(0, differenceInDays(today, ref))
}

function formatPlannedDate(value: string): string {
  // performedAt is a timestamptz instant — display BR-local date
  try {
    const d = new Date(value)
    return d.toLocaleDateString('pt-BR')
  } catch {
    return '—'
  }
}

function StalenessChip({ days }: { days: number }) {
  const label = days === 0 ? 'Hoje' : days === 1 ? '1 dia' : `${days} dias`
  const tone =
    days >= 14
      ? 'bg-destructive/10 text-destructive'
      : days >= 7
        ? 'bg-amber-light text-amber-dark'
        : 'bg-sage/10 text-sage'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      <Clock className="h-3 w-3" />
      {label}
    </span>
  )
}

export interface PlanejamentosTableProps {
  rows: OpenPlanejamento[]
  loading?: boolean
  showSnoozeBadge?: boolean
}

export function PlanejamentosTable({
  rows,
  loading,
  showSnoozeBadge,
}: PlanejamentosTableProps) {
  const [followupTarget, setFollowupTarget] =
    useState<OpenPlanejamento | null>(null)
  const [snoozeTarget, setSnoozeTarget] = useState<OpenPlanejamento | null>(null)

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-input p-8 text-center">
        <p className="text-sm text-mid">Nenhum planejamento aberto.</p>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-lg border border-input bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Paciente</TableHead>
              <TableHead>Procedimento</TableHead>
              <TableHead>Profissional</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Sem contato</TableHead>
              <TableHead className="w-[60px] text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const days = getDaysSinceLastContact(row)
              const isSnoozed =
                row.snoozedUntil != null && row.snoozedUntil > brToday()

              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/pacientes/${row.patientId}/procedimentos/${row.id}`}
                      className="block max-w-[220px] truncate font-medium text-charcoal hover:text-forest"
                    >
                      {row.patientName}
                    </Link>
                    <div className="text-xs text-mid">
                      {formatPlannedDate(row.performedAt)}
                      {showSnoozeBadge && isSnoozed && row.snoozedUntil && (
                        <span className="ml-2 inline-flex items-center gap-1 text-amber-mid">
                          <PauseCircle className="h-3 w-3" />
                          até {new Date(row.snoozedUntil).toLocaleDateString('pt-BR')}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.procedureTypeName}
                  </TableCell>
                  <TableCell className="text-sm text-mid">
                    {row.practitionerName}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {formatCurrencyBrl(row.totalAmount)}
                  </TableCell>
                  <TableCell>
                    <StalenessChip days={days} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Enviar WhatsApp"
                        render={
                          <a
                            href={buildWhatsappHref(row.patientPhone)}
                            aria-label="Enviar WhatsApp"
                          />
                        }
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Mais ações"
                            />
                          }
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => setFollowupTarget(row)}
                          >
                            <PhoneCall className="mr-2 h-3.5 w-3.5" />
                            Registrar contato
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setSnoozeTarget(row)}
                          >
                            <PauseCircle className="mr-2 h-3.5 w-3.5" />
                            Adiar até...
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {followupTarget && (
        <FollowupModal
          open={followupTarget !== null}
          onClose={() => setFollowupTarget(null)}
          procedureRecordId={followupTarget.id}
          patientName={followupTarget.patientName}
          procedureTypeName={followupTarget.procedureTypeName}
        />
      )}
      {snoozeTarget && (
        <SnoozeModal
          open={snoozeTarget !== null}
          onClose={() => setSnoozeTarget(null)}
          procedureRecordId={snoozeTarget.id}
          currentSnoozedUntil={snoozeTarget.snoozedUntil}
          patientName={snoozeTarget.patientName}
          procedureTypeName={snoozeTarget.procedureTypeName}
        />
      )}
    </>
  )
}
