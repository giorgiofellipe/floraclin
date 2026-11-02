'use client'

import Link from 'next/link'
import { Plus } from 'lucide-react'
import { FaceDiagramEditor } from '@/components/face-diagram/face-diagram-editor'
import { groupToPoints } from '@/components/face-diagram-groups/diagram-group-editor'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { ReadOnlyGuard } from '@/components/layout/subscription-access'
import { usePatientDiagramGroups } from '@/hooks/queries/use-face-diagram-groups'
import { formatBrDate } from '@/lib/dates'
import { DIAGRAM_STATUS_LABELS } from '@/lib/face-diagram-status'
import { cn } from '@/lib/utils'
import type { DiagramGroupDetail } from '@/db/queries/face-diagram-groups'
import type { Role } from '@/types'

const CARD = 'rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]'
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

interface Entry {
  key: string
  heading: string | null
  planning: DiagramGroupDetail | null
  sessions: DiagramGroupDetail[]
  sortDate: string
}

function buildEntries(groups: DiagramGroupDetail[]): Entry[] {
  const sessionsByProcedure = new Map<string, DiagramGroupDetail[]>()
  for (const g of groups) {
    if (g.procedureSessionId && g.procedureRecordId) {
      const list = sessionsByProcedure.get(g.procedureRecordId) ?? []
      list.push(g)
      sessionsByProcedure.set(g.procedureRecordId, list)
    }
  }
  const byOrdinal = (a: DiagramGroupDetail, b: DiagramGroupDetail) =>
    (a.sessionOrdinal ?? 0) - (b.sessionOrdinal ?? 0)

  const entries: Entry[] = []
  const planned = new Set<string>()
  for (const g of groups) {
    if (g.procedureSessionId) continue
    if (g.procedureRecordId) planned.add(g.procedureRecordId)
    entries.push({
      key: g.id,
      heading: null,
      planning: g,
      sessions: (g.procedureRecordId ? sessionsByProcedure.get(g.procedureRecordId) : null)?.sort(byOrdinal) ?? [],
      sortDate: String(g.createdAt),
    })
  }
  for (const [procedureId, sessions] of sessionsByProcedure) {
    if (planned.has(procedureId)) continue
    const first = sessions[0]
    const when = first.procedurePerformedAt ?? first.createdAt
    entries.push({
      key: `procedure-${procedureId}`,
      heading: `Atendimento ${formatBrDate(when)} · ${first.procedureTypeName ?? 'Procedimento'}`,
      planning: null,
      sessions: sessions.sort(byOrdinal),
      sortDate: String(when),
    })
  }
  return entries.sort((a, b) => b.sortDate.localeCompare(a.sortDate))
}

function StatusBadge({ status }: { status: DiagramGroupDetail['status'] }) {
  return (
    <Badge variant="outline" className="border-sage/30 text-sage">
      {DIAGRAM_STATUS_LABELS[status]}
    </Badge>
  )
}

function Thumbnail({ group }: { group: DiagramGroupDetail }) {
  return (
    <div aria-hidden className="pointer-events-none h-20 w-16 shrink-0 overflow-hidden rounded-[3px] bg-cream">
      <div className="w-[256px] origin-top-left scale-[0.25]">
        <FaceDiagramEditor points={groupToPoints(group)} onChange={() => {}} readOnly />
      </div>
    </div>
  )
}

function GroupRow({
  patientId,
  group,
  label,
}: {
  patientId: string
  group: DiagramGroupDetail
  label?: string
}) {
  return (
    <Link
      href={`/pacientes/${patientId}/diagramas/${group.id}`}
      className="flex items-center gap-3 p-3 transition-colors hover:bg-sage/5"
    >
      <Thumbnail group={group} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-charcoal">
            {label ?? formatBrDate(group.createdAt)}
          </span>
          <StatusBadge status={group.status} />
        </div>
        <p className="truncate text-xs text-mid">
          {[label ? formatBrDate(group.createdAt) : null, group.practitionerName]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {group.quotationTotal !== null && (
          <p className="text-xs text-forest">Orçamento {brl.format(group.quotationTotal)}</p>
        )}
      </div>
    </Link>
  )
}

export function PatientDiagramsSection({ patientId, role }: { patientId: string; role: Role }) {
  const { data: groups, isLoading } = usePatientDiagramGroups(patientId)
  const canCreate = role === 'owner' || role === 'practitioner'
  const entries = buildEntries(groups ?? [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg text-forest">Diagramas faciais</h2>
        {canCreate && (
          <ReadOnlyGuard label="Novo diagrama">
            <Link
              href={`/pacientes/${patientId}/diagramas/novo`}
              className={cn(buttonVariants({ variant: 'outline' }), 'gap-1 border-sage/20 text-sage')}
            >
              <Plus className="size-4" />
              Novo diagrama
            </Link>
          </ReadOnlyGuard>
        )}
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-mid">Carregando...</p>
      ) : entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-mid">Nenhum diagrama facial ainda</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.key} className={cn(CARD, 'divide-y divide-sage/10 overflow-hidden')}>
              {entry.heading && (
                <p className="p-3 text-sm font-medium text-charcoal">{entry.heading}</p>
              )}
              {entry.planning && <GroupRow patientId={patientId} group={entry.planning} />}
              {entry.sessions.map((session) => (
                <div key={session.id} className={entry.heading ? '' : 'pl-4 sm:pl-8'}>
                  <GroupRow
                    patientId={patientId}
                    group={session}
                    label={`Sessão ${session.sessionOrdinal ?? ''}`.trim()}
                  />
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
