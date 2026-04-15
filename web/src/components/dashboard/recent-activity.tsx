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
}

const ACTION_VERBS: Record<string, string> = {
  create: 'criou',
  update: 'atualizou',
  delete: 'removeu',
  login: 'entrou no sistema',
  logout: 'saiu do sistema',
  consent_accepted: 'aceitou um termo de',
  impersonation_start: 'iniciou impersonação em',
  impersonation_end: 'finalizou impersonação em',
}

const ENTITY_LABELS: Record<string, string> = {
  patient: 'paciente',
  patients: 'paciente',
  appointment: 'agendamento',
  appointments: 'agendamento',
  procedure: 'procedimento',
  procedure_record: 'procedimento',
  procedure_records: 'procedimento',
  financial_entry: 'cobrança',
  financial_entries: 'cobrança',
  installment: 'parcela',
  installments: 'parcela',
  consent_acceptance: 'consentimento',
  consent_acceptances: 'consentimento',
  anamnesis: 'anamnese',
  anamneses: 'anamnese',
  photo_asset: 'foto',
  photo_assets: 'foto',
  face_diagram: 'diagrama facial',
  face_diagrams: 'diagrama facial',
  tenant: 'clínica',
  tenants: 'clínica',
  user: 'usuário',
  users: 'usuário',
  tenant_user: 'membro da equipe',
  tenant_users: 'membro da equipe',
  procedure_type: 'tipo de procedimento',
  procedure_types: 'tipo de procedimento',
  consent_template: 'modelo de consentimento',
  consent_templates: 'modelo de consentimento',
  product_application: 'aplicação de produto',
  product_applications: 'aplicação de produto',
}

function formatActivityDescription(entry: RecentActivityEntry): { userName: string; action: string } {
  const verb = ACTION_VERBS[entry.action] ?? entry.action
  const entityLabel =
    ENTITY_LABELS[entry.entityType] ?? entry.entityType

  if (entry.action === 'login' || entry.action === 'logout') {
    return { userName: entry.userName, action: verb }
  }

  return { userName: entry.userName, action: `${verb} um(a) ${entityLabel}` }
}

interface RecentActivityProps {
  activity: RecentActivityEntry[]
}

export function RecentActivity({ activity }: RecentActivityProps) {
  return (
    <div
      className="bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px] p-5"
      data-testid="dashboard-activity"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[14px] font-medium text-[#2A2A2A]">
          Atividade recente
        </span>
      </div>

      {activity.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[#7A7A7A]">
          Nenhuma atividade recente
        </p>
      ) : (
        <div>
          {activity.map((entry, index) => {
            const Icon = ACTION_ICONS[entry.action] ?? Activity
            const { userName, action } = formatActivityDescription(entry)
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
                      <span className="font-medium">{userName}</span>{' '}
                      <span className="text-[#7A7A7A]">{action}</span>
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-[#7A7A7A]">
                    {timeAgo}
                  </span>
                </div>
                {index < activity.length - 1 && (
                  <div className="border-b border-[#F0F0F0]" />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
