import { ClinicHeader, toClinicHeaderTenant } from '@/components/print/clinic-header'
import { FaceDiagramPdfSection } from '@/components/face-diagram/diagram-pdf'
import { formatBrDate } from '@/lib/dates'
import { formatCurrency } from '@/lib/utils'
import { quoteTotal } from '@/lib/diagram-quote'
import type { TenantHeaderInfo } from '@/lib/tenant-header'
import type { DiagramGroupDetail } from '@/db/queries/face-diagram-groups'
import type { QuotationLine } from '@/validations/face-diagram-group'

export function QuotePdf({
  tenant,
  patient,
  group,
  lines,
  total,
  generatedAt,
}: {
  tenant: TenantHeaderInfo
  patient: { fullName: string; gender: string | null }
  group: DiagramGroupDetail
  lines: QuotationLine[]
  total: number
  generatedAt: Date
}) {
  const views = group.views.filter((v) => v.points.length > 0)
  return (
    <div>
      <ClinicHeader tenant={toClinicHeaderTenant(tenant)} />
      <h1 style={{ fontSize: '20px', margin: '16px 0 4px' }}>Orçamento</h1>
      <p style={{ margin: 0 }}>
        Paciente: {patient.fullName} · {formatBrDate(generatedAt)}
      </p>
      {views.length > 0 && (
        <FaceDiagramPdfSection diagrams={views} gender={patient.gender} />
      )}
      <table className="diagram-pdf-table" style={{ marginTop: '16px', width: '100%' }}>
        <thead>
          <tr>
            <th>Procedimento</th>
            <th>Sessões</th>
            <th>Valor unitário</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.procedureTypeId}>
              <td>{l.procedureTypeName}</td>
              <td>{l.sessions}</td>
              <td>{formatCurrency(l.unitPrice)}</td>
              <td>{formatCurrency(quoteTotal([l]))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} style={{ textAlign: 'right', fontWeight: 600 }}>Total</td>
            <td style={{ fontWeight: 600 }}>{formatCurrency(total)}</td>
          </tr>
        </tfoot>
      </table>
      <p style={{ marginTop: '16px', fontSize: '12px' }}>
        Valores sujeitos a alteração após avaliação.
      </p>
    </div>
  )
}
