'use client'

import { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { getTemplateDisplayLabel, buildTemplatePreview } from '@/lib/whatsapp-blueprints'

interface SystemTemplate {
  id: string
  name: string
  purposeKey: string | null
  components: unknown
  variableMapping: unknown
}

export function WhatsAppSystemTemplates() {
  const [templates, setTemplates] = useState<SystemTemplate[]>([])
  const [clinicName, setClinicName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const res = await fetch('/api/whatsapp/templates/system')
        if (!res.ok) return
        const data = await res.json()
        if (!active) return
        setTemplates((data.data ?? []) as SystemTemplate[])
        setClinicName((data.clinicName as string) ?? '')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [])

  if (!loading && templates.length === 0) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
          Mensagens enviadas
        </h3>
        <div className="flex-1 h-px bg-blush/60" />
      </div>

      <p className="text-xs text-mid">
        Estas são as mensagens que o FloraClin envia aos seus pacientes pelo número
        compartilhado. O texto é definido pelo FloraClin e não pode ser editado.
      </p>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((template) => {
            const preview = buildTemplatePreview(template, clinicName)
            return (
              <div
                key={template.id}
                className="rounded-[3px] border border-[#E8ECEF] bg-white p-4 space-y-3"
              >
                <h4 className="text-sm font-medium text-charcoal">
                  {getTemplateDisplayLabel(template)}
                </h4>

                <div className="rounded-[3px] bg-[#F4F6F8] px-4 py-3 space-y-2">
                  <p className="text-sm text-charcoal whitespace-pre-wrap">
                    {preview.body}
                  </p>
                  {preview.buttons.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {preview.buttons.map((label) => (
                        <span
                          key={label}
                          className="rounded-[3px] border border-[#E8ECEF] bg-white px-3 py-1 text-xs text-sage"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          <p className="text-xs text-mid">
            Nome do paciente, data, horário e valores são exemplos. Cada mensagem é
            preenchida com os dados reais do agendamento.
          </p>
        </div>
      )}
    </div>
  )
}
