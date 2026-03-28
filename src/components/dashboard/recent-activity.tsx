import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

function formatActivityDescription(entry: RecentActivityEntry): string {
  const verb = ACTION_VERBS[entry.action] ?? entry.action
  const entityLabel =
    ENTITY_LABELS[entry.entityType] ?? entry.entityType

  // For login/logout, no entity is needed
  if (entry.action === 'login' || entry.action === 'logout') {
    return `${entry.userName} ${verb}`
  }

  return `${entry.userName} ${verb} um(a) ${entityLabel}`
}

interface RecentActivityProps {
  activity: RecentActivityEntry[]
}

export function RecentActivity({ activity }: RecentActivityProps) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-forest">
          <Activity className="h-5 w-5" />
          Atividade recente
        </CardTitle>
      </CardHeader>
      <CardContent>
        {activity.length === 0 ? (
          <p className="py-8 text-center text-mid">
            Nenhuma atividade recente
          </p>
        ) : (
          <div className="space-y-3">
            {activity.map((entry) => {
              const Icon = ACTION_ICONS[entry.action] ?? Activity
              const description = formatActivityDescription(entry)
              const timeAgo = formatDistanceToNow(new Date(entry.createdAt), {
                addSuffix: true,
                locale: ptBR,
              })

              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 rounded-lg p-2"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-petal">
                    <Icon className="h-4 w-4 text-sage" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-charcoal">{description}</p>
                  </div>
                  <span className="shrink-0 text-xs text-mid">{timeAgo}</span>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
