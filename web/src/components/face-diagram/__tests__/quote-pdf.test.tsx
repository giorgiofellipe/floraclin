import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuotePdf } from '../quote-pdf'
import { EMPTY_TENANT_HEADER } from '@/lib/tenant-header'
import type { DiagramGroupDetail } from '@/db/queries/face-diagram-groups'

const lines = [
  { procedureTypeId: '11111111-1111-4111-8111-111111111111', procedureTypeName: 'Botox Testa', sessions: 2, unitPrice: 999.99 },
  { procedureTypeId: '22222222-2222-4222-8222-222222222222', procedureTypeName: 'Preenchimento Labial', sessions: 1, unitPrice: 200.01 },
]

describe('QuotePdf', () => {
  // Regression: quote PDF must show every line and the BR-formatted total the patient is quoted.
  it('renders every line name and the formatted total', () => {
    const html = renderToStaticMarkup(
      <QuotePdf
        tenant={EMPTY_TENANT_HEADER}
        patient={{ fullName: 'Maria Silva', gender: 'female' }}
        group={{ views: [] } as unknown as DiagramGroupDetail}
        lines={lines}
        total={2199.99}
        generatedAt={new Date('2026-11-02T15:00:00Z')}
      />,
    ).replace(/ /g, ' ')

    expect(html).toContain('Botox Testa')
    expect(html).toContain('Preenchimento Labial')
    expect(html).toContain('R$ 2.199,99')
    expect(html).toContain('02/11/2026')
  })
})
