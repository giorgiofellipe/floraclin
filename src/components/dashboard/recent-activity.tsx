import { Card, CardContent, CardHeader } from '@/components/ui/card'
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

const ACTION_ICON_COLORS: Record<string, string> = {
  create: 'bg-sage/15 text-sage',
  update: 'bg-mint/15 text-mint',
  delete: 'bg-red-100 text-red-500',
  login: 'bg-petal text-forest',
  logout: 'bg-petal text-mid',
  consent_accepted: 'bg-sage/10 text-sage',
}

const ACTION_VERBS: Record<string, string> = {
  create: 'criou',
  update: 'atualizou',
  delete: 'removeu',
  login: 'entrou no sistema',
  logout: 'saiu do sistema',
  consent_accepted: 'aceitou um termo de',
  impersonation_start: 'iniciou impersonacao em',
  impersonation_end: 'finalizou impersonacao em',
}

const ENTITY_LABELS: Record<string, string> = {
  patient: 'paciente',
  patients: 'paciente',
  appointment: 'agendamento',
  appointments: 'agendamento',
  procedure: 'procedimento',
  procedure_record: 'procedimento',
  procedure_records: 'procedimento',
  financial_entry: 'cobranca',
  financial_entries: 'cobranca',
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
  tenant: 'clinica',
  tenants: 'clinica',
  user: 'usuario',
  users: 'usuario',
  tenant_user: 'membro da equipe',
  tenant_users: 'membro da equipe',
  procedure_type: 'tipo de procedimento',
  procedure_types: 'tipo de procedimento',
  consent_template: 'modelo de consentimento',
  consent_templates: 'modelo de consentimento',
  product_application: 'aplicacao de produto',
  product_applications: 'aplicacao de produto',
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
    <Card className="border-0 shadow-sm bg-white rounded-xl">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-sage" />
          <span className="text-xs font-medium uppercase tracking-wider text-mid">
            Atividade recente
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {activity.length === 0 ? (
          <p className="py-8 text-center text-mid">
            Nenhuma atividade recente
          </p>
        ) : (
          <div className="relative">
            {/* Timeline connecting line */}
            <div className="absolute left-[15px] top-3 bottom-3 w-px bg-petal" />

            <div className="space-y-0">
              {activity.map((entry) => {
                const Icon = ACTION_ICONS[entry.action] ?? Activity
                const iconColor = ACTION_ICON_COLORS[entry.action] ?? 'bg-petal text-sage'
                const { userName, action } = formatActivityDescription(entry)
                const timeAgo = formatDistanceToNow(new Date(entry.createdAt), {
                  addSuffix: true,
                  locale: ptBR,
                })

                return (
                  <div
                    key={entry.id}
                    className="relative flex items-start gap-4 py-2.5 pl-0"
                  >
                    {/* Timeline node */}
                    <div className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconColor}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="text-sm text-charcoal">
                        <span className="font-medium">{userName}</span>{' '}
                        <span className="text-mid">{action}</span>
                      </p>
                    </div>

                    {/* Timestamp */}
                    <span className="shrink-0 pt-1 text-xs text-mid/70">
                      {timeAgo}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
