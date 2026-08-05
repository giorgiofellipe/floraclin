import type { ReportDefinition } from './types'

/**
 * Width of the default date range, in days, for every report that declares
 * the `date-range` filter kind: the last 90 days up to today.
 *
 * It used to be "the current BR calendar month to date", which renders an
 * empty table for anyone opening a report on the 2nd of the month. A report
 * that opens empty by default reads as broken, so the default window is wide
 * enough to contain something for a clinic that saw any movement at all.
 */
const DEFAULT_RANGE_DAYS = 90

export const REPORTS: ReportDefinition[] = [
  {
    slug: 'pacientes-inativos',
    title: 'Pacientes inativos',
    description:
      'Pacientes sem procedimento recente, ordenados por quanto já gastaram na clínica, para priorizar o contato.',
    filters: ['threshold-days'],
    apiPath: '/api/reports/inactive-patients',
    paramName: 'thresholdDays',
    defaultDays: 180,
    // A patient is "inactive" once their last visit is OLDER than this many
    // days, so raising the number shrinks the list, not the other way round.
    filterLabel: 'Sem retornar há mais de (dias)',
    emptyHint: 'Reduza o número de dias sem retornar para incluir mais pacientes.',
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
    emptyHint: 'Aumente a janela de dias para alcançar retornos mais distantes.',
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
    emptyHint: 'Aumente o período analisado ou reduza o mínimo de faltas.',
  },
  {
    slug: 'extrato-periodo',
    title: 'Extrato por período',
    description:
      'Movimentações de caixa em um intervalo de datas, prontas para conferência ou para a contabilidade.',
    filters: ['date-range'],
    apiPath: '/api/reports/extrato-periodo',
    defaultRangeDays: DEFAULT_RANGE_DAYS,
    emptyHint: 'Amplie o período para incluir movimentações mais antigas.',
  },
  {
    slug: 'ganhos-profissional',
    title: 'Ganhos por profissional',
    description:
      'Procedimentos, receita gerada e receita recebida por profissional em um período, como documento para pagamento.',
    filters: ['date-range', 'practitioner'],
    apiPath: '/api/reports/ganhos-profissional',
    defaultRangeDays: DEFAULT_RANGE_DAYS,
    emptyHint: 'Amplie o período ou volte para todos os profissionais.',
  },
  {
    slug: 'procedimentos-realizados',
    title: 'Procedimentos realizados',
    description:
      'Registro de rastreabilidade por lote: produto, lote e validade de cada aplicação, para consulta caso um procedimento seja questionado.',
    // `patient` is a SUGGEST/autocomplete field (type to search, pick one),
    // not a plain dropdown: even the demo tenant alone has 50 patients and a
    // real clinic has thousands, so a `<select>`-style list would be
    // unusable. Only declared here; the other reports don't filter by a
    // single patient.
    filters: ['date-range', 'practitioner', 'patient'],
    apiPath: '/api/reports/procedimentos-realizados',
    defaultRangeDays: DEFAULT_RANGE_DAYS,
    emptyHint: 'Amplie o período ou volte para todos os profissionais.',
  },
  {
    slug: 'prontuario',
    title: 'Prontuário completo',
    description:
      'O histórico completo de um paciente em PDF: identificação, anamnese, procedimentos com produtos e doses, diagrama facial, fotos e consentimentos assinados.',
    // A different shape from every other report: one patient, not a
    // filtered table, so the only filter it declares is `patient` (see
    // `web/src/app/(platform)/relatorios/prontuario/page.tsx`, which reuses
    // `ReportFilters` directly rather than the `ReportShell` table layout).
    filters: ['patient'],
    apiPath: '/api/reports/prontuario',
    emptyHint: 'Escolha um paciente para gerar o prontuário completo.',
  },
]

export function getReport(slug: string): ReportDefinition | undefined {
  return REPORTS.find((report) => report.slug === slug)
}
