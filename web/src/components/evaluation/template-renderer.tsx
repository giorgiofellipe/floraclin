'use client'

import * as React from 'react'
import { FormRenderer } from '@/components/forms/form-renderer'
import { FaceDiagramQuestion } from './face-diagram-question'
import type { FormSection } from '@/lib/forms/types'
import type { DiagramPointData, CatalogProduct } from '@/components/face-diagram/types'
import type { WizardOverrides } from '@/components/service-wizard/types'

export interface TemplateRendererProps {
  sections: FormSection[]
  responses: Record<string, unknown>
  onChange: (responses: Record<string, unknown>) => void
  readOnly?: boolean
  patientGender?: string | null
  diagramPoints?: DiagramPointData[]
  onDiagramChange?: (points: DiagramPointData[]) => void
  diagramRendered?: boolean
  products?: CatalogProduct[]
  wizardOverrides?: WizardOverrides
  showErrors?: boolean
}

export function TemplateRenderer({
  sections,
  responses,
  onChange,
  readOnly = false,
  patientGender,
  diagramPoints,
  onDiagramChange,
  diagramRendered = false,
  products,
  showErrors = false,
}: TemplateRendererProps) {
  // Only the first face_diagram question gets the real editor
  const firstDiagramQuestionId = React.useMemo(() => {
    for (const section of [...sections].sort((a, b) => a.order - b.order)) {
      for (const question of [...section.questions].sort((a, b) => a.order - b.order)) {
        if (question.type === 'face_diagram') {
          return question.id
        }
      }
    }
    return null
  }, [sections])

  return (
    <FormRenderer
      sections={sections}
      responses={responses}
      onChange={onChange}
      readOnly={readOnly}
      showErrors={showErrors}
      renderQuestion={(q) =>
        q.type === 'face_diagram' ? (
          <FaceDiagramQuestion
            question={q}
            diagramRendered={diagramRendered || q.id !== firstDiagramQuestionId}
            diagramPoints={diagramPoints}
            onDiagramChange={onDiagramChange}
            patientGender={patientGender}
            products={products}
            readOnly={readOnly}
          />
        ) : undefined
      }
    />
  )
}
