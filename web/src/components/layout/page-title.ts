import { formatBrLongDate } from '@/lib/dates'

interface PageTitle {
  title: string
  subtitle?: string
  withDate?: boolean
}

// First match wins, so a sub-route sits above its section.
const SECTION_TITLES: Array<{ prefix: string } & PageTitle> = [
  { prefix: '/dashboard', title: 'Painel', withDate: true },
  { prefix: '/agenda/reagendamentos', title: 'Agenda', subtitle: 'Reagendamentos' },
  { prefix: '/agenda', title: 'Agenda', withDate: true },
  { prefix: '/pacientes/aniversariantes', title: 'Pacientes', subtitle: 'Aniversariantes' },
  { prefix: '/pacientes/', title: 'Pacientes', subtitle: 'Detalhes do paciente' },
  { prefix: '/pacientes', title: 'Pacientes' },
  { prefix: '/financeiro', title: 'Financeiro' },
  { prefix: '/relatorios', title: 'Relatórios' },
  { prefix: '/crm', title: 'CRM' },
  { prefix: '/whatsapp', title: 'WhatsApp' },
  { prefix: '/configuracoes', title: 'Configurações' },
  { prefix: '/admin/clinicas', title: 'Clínicas' },
  { prefix: '/admin/usuarios', title: 'Usuários' },
  { prefix: '/admin/assinaturas', title: 'Assinaturas' },
  { prefix: '/admin/planos', title: 'Planos' },
]

function matches(pathname: string, prefix: string) {
  if (prefix.endsWith('/')) return pathname.startsWith(prefix)
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function getPageTitle(pathname: string, now: Date): { title: string; subtitle?: string } {
  const path = pathname === '/' ? '/dashboard' : pathname
  const entry = SECTION_TITLES.find((e) => matches(path, e.prefix))
  if (!entry) return { title: 'FloraClin' }
  return { title: entry.title, subtitle: entry.withDate ? formatBrLongDate(now) : entry.subtitle }
}
