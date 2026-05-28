export interface PlaceholderDescriptor {
  token: string // e.g. "{{patient.name}}"
  description: string // human-readable label in pt-BR
}

export function renderPlaceholders(body: string, values: Record<string, string>): string {
  let out = body
  for (const [token, value] of Object.entries(values)) {
    out = out.split(token).join(value ?? '')
  }
  return out
}

export interface DocumentContextInput {
  patient: { fullName: string; cpf: string | null; birthDate: string | null }
  practitioner: { displayName: string; registryLine: string }
  tenant: { name: string; address: { city?: string; state?: string } | null }
  date: Date
}

const LONG_DATE = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

export function buildDocumentPlaceholders(ctx: DocumentContextInput): Record<string, string> {
  const city = ctx.tenant.address?.city ?? '' // empty if not set — never split a string
  const dateLong = LONG_DATE.format(ctx.date)
  return {
    '{{patient.name}}': ctx.patient.fullName,
    '{{patient.cpf}}': ctx.patient.cpf ?? '',
    '{{patient.birthDate}}': ctx.patient.birthDate ?? '',
    '{{date}}': ctx.date.toLocaleDateString('pt-BR'),
    '{{date.long}}': city ? `${city}, ${dateLong}` : dateLong,
    '{{practitioner.name}}': ctx.practitioner.displayName,
    '{{practitioner.registry}}': ctx.practitioner.registryLine,
    '{{tenant.name}}': ctx.tenant.name,
  }
}

export const AVAILABLE_DOCUMENT_PLACEHOLDERS: PlaceholderDescriptor[] = [
  { token: '{{patient.name}}', description: 'Nome do paciente' },
  { token: '{{patient.cpf}}', description: 'CPF' },
  { token: '{{patient.birthDate}}', description: 'Data de nascimento' },
  { token: '{{date}}', description: 'Data atual (DD/MM/AAAA)' },
  { token: '{{date.long}}', description: 'Data por extenso (com cidade)' },
  { token: '{{practitioner.name}}', description: 'Nome do profissional' },
  { token: '{{practitioner.registry}}', description: 'Registro profissional (ex: CRM-SP 12345)' },
  { token: '{{tenant.name}}', description: 'Nome da clínica' },
]
