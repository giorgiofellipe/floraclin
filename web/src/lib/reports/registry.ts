import type { ReportDefinition } from './types'

export const REPORTS: ReportDefinition[] = [
  {
    slug: 'pacientes-inativos',
    title: 'Pacientes inativos',
    description:
      'Pacientes sem procedimento recente, ordenados por valor gasto: quem vale mais liga primeiro.',
    filters: ['threshold-days'],
    apiPath: '/api/reports/inactive-patients',
    paramName: 'thresholdDays',
  },
  {
    slug: 'retornos',
    title: 'Retornos a vencer',
    description:
      'Retornos agendados que estão próximos ou já venceram, excluindo quem já tem consulta marcada.',
    // The route filters by a day-count window (`windowDays`), not a calendar
    // range, so it reuses the same numeric filter kind as pacientes-inativos
    // rather than the date-range picker.
    filters: ['threshold-days'],
    apiPath: '/api/reports/due-followups',
    paramName: 'windowDays',
  },
  {
    slug: 'faltas',
    title: 'Faltas recorrentes',
    description:
      'Pacientes que faltaram ou cancelaram mais de uma vez no período, com o valor perdido nos horários.',
    // Same reasoning as retornos: `windowDays` is a day count. `minCount`
    // has no dedicated filter UI yet and keeps its server-side default.
    filters: ['threshold-days'],
    apiPath: '/api/reports/repeat-no-shows',
    paramName: 'windowDays',
  },
]

export function getReport(slug: string): ReportDefinition | undefined {
  return REPORTS.find((report) => report.slug === slug)
}
