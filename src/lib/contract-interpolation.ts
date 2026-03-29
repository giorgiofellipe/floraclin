import type { PaymentMethod } from '@/types'

export interface ContractData {
  nomePaciente: string
  cpfPaciente: string
  data: string
  procedimentos: string
  produtos: string
  valorTotal: string
  formaPagamento: string
  parcelas: string
  profissional: string
  clinica: string
}

const PLACEHOLDER_MAP: Record<string, keyof ContractData> = {
  '{{nome_paciente}}': 'nomePaciente',
  '{{cpf_paciente}}': 'cpfPaciente',
  '{{data}}': 'data',
  '{{procedimentos}}': 'procedimentos',
  '{{produtos}}': 'produtos',
  '{{valor_total}}': 'valorTotal',
  '{{forma_pagamento}}': 'formaPagamento',
  '{{parcelas}}': 'parcelas',
  '{{profissional}}': 'profissional',
  '{{clinica}}': 'clinica',
}

/**
 * Available placeholders with human-readable descriptions (in pt-BR).
 * Used in the consent template form to document available variables.
 */
export const CONTRACT_PLACEHOLDERS: { placeholder: string; description: string }[] = [
  { placeholder: '{{nome_paciente}}', description: 'Nome completo do paciente' },
  { placeholder: '{{cpf_paciente}}', description: 'CPF do paciente' },
  { placeholder: '{{data}}', description: 'Data do procedimento (dd/mm/aaaa)' },
  { placeholder: '{{procedimentos}}', description: 'Lista de procedimentos contratados' },
  { placeholder: '{{produtos}}', description: 'Lista de produtos a serem utilizados' },
  { placeholder: '{{valor_total}}', description: 'Valor total do contrato (R$)' },
  { placeholder: '{{forma_pagamento}}', description: 'Forma de pagamento escolhida' },
  { placeholder: '{{parcelas}}', description: 'Detalhamento das parcelas' },
  { placeholder: '{{profissional}}', description: 'Nome do profissional responsavel' },
  { placeholder: '{{clinica}}', description: 'Nome da clinica' },
]

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: 'PIX',
  credit_card: 'Cartao de Credito',
  debit_card: 'Cartao de Debito',
  cash: 'Dinheiro',
  transfer: 'Transferencia Bancaria',
}

/**
 * Interpolates a service contract template, replacing `{{placeholder}}`
 * tokens with the corresponding values from `data`.
 *
 * Unknown placeholders are left as-is so the user can spot them in preview.
 */
export function interpolateContract(template: string, data: ContractData): string {
  let result = template

  for (const [placeholder, key] of Object.entries(PLACEHOLDER_MAP)) {
    result = result.replace(new RegExp(escapeRegExp(placeholder), 'g'), data[key])
  }

  return result
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Formats a currency value in BRL (e.g. "R$ 1.500,00").
 */
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

/**
 * Formats a date as dd/mm/yyyy.
 */
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR').format(date)
}

interface ProcedurePlanItem {
  name: string
  quantity?: number
  unit?: string
}

interface FinancialPlan {
  totalAmount: number
  installmentCount: number
  paymentMethod?: PaymentMethod
  notes?: string
}

interface PatientInfo {
  fullName: string
  cpf?: string | null
}

/**
 * Builds a `ContractData` object from procedure plan data, patient info,
 * practitioner name and clinic name.
 *
 * This is the main entry point used by the approval flow to prepare
 * data for `interpolateContract`.
 */
export function buildContractData(
  procedures: ProcedurePlanItem[],
  products: ProcedurePlanItem[],
  financialPlan: FinancialPlan,
  patient: PatientInfo,
  practitioner: string,
  clinicName: string,
  date?: Date
): ContractData {
  const procedimentosText = procedures
    .map((p) => (p.quantity ? `${p.name} (${p.quantity}${p.unit ?? ''})` : p.name))
    .join(', ')

  const produtosText = products
    .map((p) => (p.quantity ? `${p.name} — ${p.quantity}${p.unit ?? ''}` : p.name))
    .join(', ')

  const paymentMethod = financialPlan.paymentMethod
    ? PAYMENT_METHOD_LABELS[financialPlan.paymentMethod]
    : 'A definir'

  const parcelas =
    financialPlan.installmentCount > 1
      ? `Parcelamento: ${financialPlan.installmentCount}x de ${formatCurrency(financialPlan.totalAmount / financialPlan.installmentCount)}`
      : 'Pagamento a vista'

  return {
    nomePaciente: patient.fullName,
    cpfPaciente: patient.cpf ?? '___.___.___-__',
    data: formatDate(date ?? new Date()),
    procedimentos: procedimentosText || 'N/A',
    produtos: produtosText || 'N/A',
    valorTotal: formatCurrency(financialPlan.totalAmount),
    formaPagamento: paymentMethod,
    parcelas,
    profissional: practitioner,
    clinica: clinicName,
  }
}
