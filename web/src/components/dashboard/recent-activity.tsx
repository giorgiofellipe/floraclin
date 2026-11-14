import {
  Activity,
  Plus,
  Pencil,
  Trash2,
  LogIn,
  LogOut,
  FileCheck,
  type LucideIcon,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { RecentActivityEntry } from '@/db/queries/dashboard'

const ACTION_ICONS: Record<string, LucideIcon> = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  login: LogIn,
  logout: LogOut,
  consent_accepted: FileCheck,
  impersonation_start: LogIn,
  impersonation_end: LogOut,
}

const ACTION_VERBS: Record<string, string> = {
  create: 'criou',
  update: 'atualizou',
  delete: 'removeu',
  login: 'entrou no sistema',
  logout: 'saiu do sistema',
  consent_accepted: 'assinou um termo de consentimento',
  impersonation_start: 'iniciou impersonação em',
  impersonation_end: 'finalizou impersonação em',
}

// The article agrees with the noun ("uma parcela", "um paciente"). Types without
// an entry stay out of the feed instead of showing a raw table name.
const ENTITIES: Record<string, string> = {
  patient: 'um paciente',
  appointment: 'um agendamento',
  procedure: 'um procedimento',
  procedure_record: 'um procedimento',
  financial_entry: 'uma cobrança',
  installment: 'uma parcela',
  consent_acceptance: 'um consentimento',
  anamnesis: 'uma anamnese',
  photo_asset: 'uma foto',
  face_diagram: 'um diagrama facial',
  tenant: 'os dados da clínica',
  user: 'um usuário',
  tenant_user: 'um membro da equipe',
  procedure_type: 'um tipo de procedimento',
  consent_template: 'um modelo de termo',
  product_application: 'uma aplicação de produto',
  expense: 'uma despesa',
  cash_movement: 'uma movimentação',
}

const SINGULAR: Record<string, string> = {
  patients: 'patient',
  appointments: 'appointment',
  procedure_records: 'procedure_record',
  financial_entries: 'financial_entry',
  installments: 'installment',
  consent_acceptances: 'consent_acceptance',
  anamneses: 'anamnesis',
  photo_assets: 'photo_asset',
  face_diagrams: 'face_diagram',
  tenants: 'tenant',
  users: 'user',
  tenant_users: 'tenant_user',
  procedure_types: 'procedure_type',
  consent_templates: 'consent_template',
  product_applications: 'product_application',
  expenses: 'expense',
  cash_movements: 'cash_movement',
}

const VISIBLE_ROWS = 10

const STANDALONE = new Set(['login', 'logout', 'consent_accepted', 'impersonation_start', 'impersonation_end'])

function formatActivityDescription(entry: RecentActivityEntry): string | null {
  const verb = ACTION_VERBS[entry.action]
  if (!verb) return null
  if (STANDALONE.has(entry.action)) return verb
  const entity = ENTITIES[SINGULAR[entry.entityType] ?? entry.entityType]
  return entity ? `${verb} ${entity}` : null
}

interface RecentActivityProps {
  activity: RecentActivityEntry[]
}

export function RecentActivity({ activity }: RecentActivityProps) {
  const rows = activity
    .map((entry) => ({ entry, action: formatActivityDescription(entry) }))
    .filter((row): row is { entry: RecentActivityEntry; action: string } => row.action !== null)
    .slice(0, VISIBLE_ROWS)
  if (rows.length === 0) return null

  return (
    <div
      className="rounded-lg bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
      data-testid="dashboard-activity"
    >
      <h2 className="mb-4 text-[15px] font-semibold text-charcoal">Atividade recente</h2>

      <div>
        {rows.map(({ entry, action }, index) => {
          const Icon = ACTION_ICONS[entry.action] ?? Activity
          const timeAgo = formatDistanceToNow(new Date(entry.createdAt), {
            addSuffix: true,
            locale: ptBR,
          })

          return (
            <div key={entry.id}>
              <div className="flex items-center gap-3 py-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F4F6F8]">
                  <Icon className="h-3.5 w-3.5 text-[#7A7A7A]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-[#2A2A2A]">
                    <span className="font-medium">{entry.userName}</span>{' '}
                    <span className="text-[#7A7A7A]">{action}</span>
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-[#7A7A7A]">
                  {timeAgo}
                </span>
              </div>
              {index < rows.length - 1 && (
                <div className="border-b border-[#F0F0F0]" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
