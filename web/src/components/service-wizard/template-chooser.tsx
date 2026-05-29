'use client'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { cn, formatCurrency } from '@/lib/utils'

interface TemplateChooserProps {
  selectedTemplateId: string | null
  onSelect: (templateId: string | null) => void
}

interface TemplateLine {
  procedureTypeId: string
  procedureTypeName: string
  sessionsCount: number
}

interface Template {
  id: string
  name: string
  description: string | null
  defaultPrice: string | null
  validityMonths: number | null
  lines: TemplateLine[]
}

export function TemplateChooser({ selectedTemplateId, onSelect }: TemplateChooserProps) {
  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ['package-templates'],
    queryFn: async () => {
      const res = await fetch('/api/package-templates')
      if (!res.ok) throw new Error('Falha ao carregar pacotes')
      const json = await res.json()
      // The GET endpoint currently returns a bare array (NextResponse.json(templates)).
      // Defensively accept { data } / { templates } wrappers in case the shape changes.
      if (Array.isArray(json)) return json as Template[]
      if (Array.isArray(json?.data)) return json.data as Template[]
      if (Array.isArray(json?.templates)) return json.templates as Template[]
      return []
    },
  })

  if (templates.length === 0) return null

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">Pacotes</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => {
          const isSelected = selectedTemplateId === t.id
          const priceNumber = t.defaultPrice != null ? Number(t.defaultPrice) : 0
          return (
            <Card
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(isSelected ? null : t.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(isSelected ? null : t.id)
                }
              }}
              className={cn(
                'cursor-pointer transition-colors',
                isSelected ? 'border-primary ring-2 ring-primary/30' : 'hover:border-primary/40',
              )}
            >
              <CardContent className="space-y-1 p-3">
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground">
                  {t.lines.map((l) => `${l.sessionsCount}× ${l.procedureTypeName}`).join(' + ')}
                </div>
                <div className="text-xs">{formatCurrency(Number.isFinite(priceNumber) ? priceNumber : 0)}</div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
