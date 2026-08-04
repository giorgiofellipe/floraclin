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
    defaultDays: 180,
    // A patient is "inactive" once their last visit is OLDER than this many
    // days, so raising the number shrinks the list, not the other way round.
    filterLabel: 'Sem retornar há mais de (dias)',
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
    defaultDays: 30,
    // The window runs both directions from today: due soon AND overdue by up
    // to this many days.
    filterLabel: 'Próximos e vencidos em (dias)',
  },
  {
    slug: 'faltas',
    title: 'Faltas recorrentes',
    description:
      'Pacientes que faltaram ou cancelaram mais de uma vez no período, com o valor perdido nos horários.',
    // Same reasoning as retornos: `windowDays` is a day count.
    filters: ['threshold-days', 'min-count'],
    apiPath: '/api/reports/repeat-no-shows',
    paramName: 'windowDays',
    defaultDays: 180,
    // A lookback window counted backward from today, so raising the number
    // grows the list, unlike pacientes-inativos.
    filterLabel: 'Período analisado (últimos dias)',
    // Mirrors the route's own DEFAULT_MIN_COUNT (see
    // web/src/app/api/reports/repeat-no-shows/route.ts) so the UI default and
    // the route default cannot drift apart.
    defaultMinCount: 2,
  },
]

export function getReport(slug: string): ReportDefinition | undefined {
  return REPORTS.find((report) => report.slug === slug)
}
