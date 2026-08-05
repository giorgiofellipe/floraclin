import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { REPORTS } from '@/lib/reports/registry'

export const metadata: Metadata = {
  title: 'Relatórios | FloraClin',
}

/**
 * Landing page for /relatorios: one card per entry in the report registry.
 * Never hardcode the list here — REPORTS is the single source of truth the
 * route handlers also read from, so a report can't exist on this page but
 * not behind its route, or the other way around.
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((report) => (
          <Link
            key={report.slug}
            href={`/relatorios/${report.slug}`}
            data-testid={`report-card-${report.slug}`}
            className="group flex flex-col gap-3 rounded-xl border border-sage/15 bg-white p-5 transition-colors hover:border-sage/40 hover:bg-sage/5"
          >
            <h2 className="font-heading text-base font-medium text-charcoal">
              {report.title}
            </h2>
            <p className="flex-1 text-sm text-mid">{report.description}</p>
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-forest">
              Abrir relatório
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
