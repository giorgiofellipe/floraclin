'use client'

import { FaceDiagramEditor } from '@/components/face-diagram/face-diagram-editor'
import type { DiagramPointData, CatalogProduct } from '@/components/face-diagram/types'
import type { FormQuestion } from '@/lib/forms/types'
import { QuestionWrapper } from '@/components/forms/question-renderers'

interface FaceDiagramQuestionProps {
  question: FormQuestion
  diagramRendered?: boolean
  diagramPoints?: DiagramPointData[]
  onDiagramChange?: (points: DiagramPointData[]) => void
  patientGender?: string | null
  products?: CatalogProduct[]
  readOnly?: boolean
}

export function FaceDiagramQuestion({
  question,
  diagramRendered,
  diagramPoints = [],
  onDiagramChange,
  patientGender,
  products,
  readOnly,
}: FaceDiagramQuestionProps) {
  return (
    <QuestionWrapper question={question}>
      {diagramRendered ? (
        <div className="flex items-center gap-2 rounded-[3px] bg-sage/10 px-3 py-2.5">
          <span className="text-sm text-sage">
            Preencha o diagrama facial na seção &quot;Diagrama Facial&quot; abaixo.
          </span>
        </div>
      ) : (
        <FaceDiagramEditor
          points={diagramPoints}
          onChange={onDiagramChange ?? (() => {})}
          readOnly={readOnly}
          gender={patientGender}
          products={products}
        />
      )}
    </QuestionWrapper>
  )
}
