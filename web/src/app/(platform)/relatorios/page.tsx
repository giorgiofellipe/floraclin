import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { REPORTS, REPORT_GROUPS } from '@/lib/reports/registry'
import type { ReportDefinition } from '@/lib/reports/types'

export const metadata: Metadata = {
  title: 'Relatórios | FloraClin',
}

function ReportCard({ report }: { report: ReportDefinition }) {
  return (
    <Link
      href={`/relatorios/${report.slug}`}
      data-testid={`report-card-${report.slug}`}
      className="group flex flex-col gap-3 rounded-xl border border-sage/15 bg-white p-5 transition-colors hover:border-sage/40 hover:bg-sage/5"
    >
      <h3 className="font-heading text-base font-medium text-charcoal">
        {report.title}
      </h3>
      <p className="flex-1 text-sm text-mid">{report.description}</p>
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-forest">
        Abrir relatório
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}

/**
 * Landing page for /relatorios: reports grouped into sections, one per entry
 * in REPORT_GROUPS, each holding the REPORTS whose `group` matches. Never
 * hardcode the list of reports or groups here — both REPORTS and
 * REPORT_GROUPS are the single source of truth the route handlers also read
 * from, so a report can't exist on this page but not behind its route, and a
 * group can't appear here without being declared in the registry. A group
 * with no reports is skipped rather than rendered as an empty heading.
 */
export default function RelatoriosPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-xl font-medium text-charcoal">Relatórios</h1>
        <p className="mt-1 text-sm text-mid">
          Listas prontas para ação: quem chamar, quem confirmar e quem já
          faltou demais.
        </p>
      </div>

      <div className="space-y-8">
        {REPORT_GROUPS.map((group) => {
          const reports = REPORTS.filter((report) => report.group === group.key)
          if (reports.length === 0) return null

          return (
            <div key={group.key} className="space-y-4">
              <div>
                <h2 className="text-sm font-medium text-charcoal">{group.title}</h2>
                <p className="mt-1 text-xs text-mid">{group.subtitle}</p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {reports.map((report) => (
                  <ReportCard key={report.slug} report={report} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
