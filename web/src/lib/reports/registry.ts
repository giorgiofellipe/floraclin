import type { ReportDefinition } from './types'

export const REPORTS: ReportDefinition[] = [
  {
    slug: 'pacientes-inativos',
    title: 'Pacientes inativos',
    description:
      'Pacientes sem procedimento recente, ordenados por valor gasto: quem vale mais liga primeiro.',
    filters: ['threshold-days'],
  },
  {
    slug: 'retornos',
    title: 'Retornos a vencer',
    description:
      'Retornos agendados que estão próximos ou já venceram, excluindo quem já tem consulta marcada.',
    filters: ['date-range'],
  },
  {
    slug: 'faltas',
    title: 'Faltas recorrentes',
    description:
      'Pacientes que faltaram ou cancelaram mais de uma vez no período, com o valor perdido nos horários.',
    filters: ['date-range'],
  },
]

export function getReport(slug: string): ReportDefinition | undefined {
  return REPORTS.find((report) => report.slug === slug)
}
