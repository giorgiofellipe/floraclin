import { buildTemplatePreview } from '@/lib/whatsapp-blueprints'

interface WhatsAppTemplatePreviewProps {
  template: {
    name: string
    purposeKey: string | null
    components: unknown
    variableMapping?: unknown
  }
  clinicName: string
}

export function WhatsAppTemplatePreview({ template, clinicName }: WhatsAppTemplatePreviewProps) {
  const preview = buildTemplatePreview(template, clinicName)

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-mid">Modelo</p>
        <div className="rounded-[3px] border border-[#E8ECEF] bg-white px-4 py-3">
          <p className="text-sm text-charcoal whitespace-pre-wrap leading-relaxed">
            {preview.segments.map((segment, i) =>
              'variable' in segment ? (
                <span
                  key={i}
                  className="rounded-[3px] bg-sage/10 px-1.5 py-0.5 text-xs font-medium text-sage"
                >
                  {segment.variable}
                </span>
              ) : (
                <span key={i}>{segment.text}</span>
              ),
            )}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-mid">Exemplo</p>
        <div className="rounded-[3px] bg-[#F4F6F8] px-4 py-3 space-y-2">
          <p className="text-sm text-charcoal whitespace-pre-wrap">{preview.body}</p>
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
    </div>
  )
}
