import { VIEW_LABELS, VIEW_FILES, resolveGenderKey } from '@/components/face-diagram/face-template-data'
import { getAppUrl } from '@/lib/app-url'
import type { DiagramViewType } from '@/types'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'

export const DIAGRAM_PDF_CSS = `
  .diagram-pdf-list { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 0.5rem; }
  .diagram-pdf-title { font-size: 11px; font-weight: 600; margin-bottom: 0.35rem; }
  .diagram-pdf-body { display: flex; gap: 1rem; align-items: flex-start; flex-wrap: wrap; }
  .diagram-pdf-canvas { position: relative; width: 190px; height: 190px; flex-shrink: 0; border: 1px solid #eee; background: #fafafa; }
  .diagram-pdf-image { width: 100%; height: 100%; object-fit: contain; }
  .diagram-pdf-marker {
    position: absolute; transform: translate(-50%, -50%); width: 16px; height: 16px; border-radius: 50%;
    color: white; font-size: 8px; font-weight: 700; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 1px 2px rgba(0,0,0,0.4);
  }
  .diagram-pdf-legend { flex: 1; min-width: 200px; margin-top: 0; }
  .diagram-pdf-legend-dot {
    display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px;
    border-radius: 50%; color: white; font-size: 8px; font-weight: 700;
  }
  .diagram-pdf-empty { font-size: 12px; color: #888; font-style: italic; }
  table.diagram-pdf-table { width: 100%; border-collapse: collapse; margin-top: 0.4rem; font-size: 11px; }
  table.diagram-pdf-table th, table.diagram-pdf-table td { border-bottom: 1px solid #eee; padding: 4px 6px; text-align: left; vertical-align: top; }
  table.diagram-pdf-table th { font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: #666; }
`

// Mirrors `getPointColor` in diagram-point.tsx. Not imported: that module is
// 'use client' and must not run inside the server-only PDF render.
const POINT_COLOR_RULES: Array<{ match: RegExp; color: string }> = [
  { match: /botox|toxina|dysport|xeomin|botul[íi]nic/i, color: '#3b82f6' }, // neurotoxins
  { match: /filler|preenchedor|hialur[ôo]nic|juvederm|restylane|\bah\b/i, color: '#ec4899' }, // fillers
  { match: /bioestimulador|biostimulator|sculptra|radiesse|ellans[ée]/i, color: '#22c55e' }, // biostimulators
]

export function getPointColor(productName: string): string {
  return POINT_COLOR_RULES.find((rule) => rule.match.test(productName))?.color ?? '#a855f7'
}

// The PDF renderer loads HTML with no base URL, so the image needs the app origin.
// Reading from disk is not an option: Vercel does not ship arbitrary public/ files.
export function faceTemplateUrl(viewType: DiagramViewType, gender: string | null | undefined): string {
  const genderKey = resolveGenderKey(gender)
  const files = VIEW_FILES[genderKey]
  const path = files[viewType as keyof typeof files] ?? files.front
  return `${getAppUrl()}${path}`
}

export function FaceDiagramPdfSection({
  diagrams,
  gender,
}: {
  diagrams: DiagramWithPoints[]
  gender: string | null | undefined
}) {
  return (
    <div className="diagram-pdf-list">
      {diagrams.map((diagram) => (
        <div key={diagram.id}>
          <div className="diagram-pdf-title">
            Diagrama facial ({VIEW_LABELS[diagram.viewType as keyof typeof VIEW_LABELS] ?? diagram.viewType})
          </div>
          {diagram.points.length === 0 ? (
            <div className="diagram-pdf-empty">Nenhum ponto marcado neste diagrama.</div>
          ) : (
            <div className="diagram-pdf-body">
              <div className="diagram-pdf-canvas">
                <img
                  src={faceTemplateUrl(diagram.viewType as DiagramViewType, gender)}
                  alt={VIEW_LABELS[diagram.viewType as keyof typeof VIEW_LABELS] ?? diagram.viewType}
                  className="diagram-pdf-image"
                />
                {diagram.points.map((point, index) => (
                  <span
                    key={point.id}
                    className="diagram-pdf-marker"
                    style={{ left: `${point.x}%`, top: `${point.y}%`, backgroundColor: getPointColor(point.productName) }}
                  >
                    {index + 1}
                  </span>
                ))}
              </div>
              <table className="diagram-pdf-table diagram-pdf-legend">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Produto</th>
                    <th>Dose</th>
                  </tr>
                </thead>
                <tbody>
                  {diagram.points.map((point, index) => (
                    <tr key={point.id}>
                      <td>
                        <span
                          className="diagram-pdf-legend-dot"
                          style={{ backgroundColor: getPointColor(point.productName) }}
                        >
                          {index + 1}
                        </span>
                      </td>
                      <td>{point.productName}</td>
                      <td>{point.quantity} {point.quantityUnit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
