'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MaskedInput } from '@/components/ui/masked-input'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { maskCurrency, parseCurrency } from '@/lib/masks'
import { useProcedureTypes } from '@/hooks/queries/use-procedure-types'
import {
  useCreatePackageTemplate,
  useUpdatePackageTemplate,
  type PackageTemplate,
  type PackageTemplatePayload,
} from '@/hooks/queries/use-packages'

interface ProcedureType {
  id: string
  name: string
  isActive: boolean
}

interface LineDraft {
  procedureTypeId: string
  sessionsCount: number
}

interface PackageTemplateFormProps {
  initialData?: PackageTemplate
  onSuccess?: () => void
  onCancel?: () => void
}

function priceToMasked(price: string | null | undefined): string {
  if (!price) return ''
  const num = parseFloat(price)
  if (isNaN(num)) return ''
  return maskCurrency(String(Math.round(num * 100)))
}

export function PackageTemplateForm({
  initialData,
  onSuccess,
  onCancel,
}: PackageTemplateFormProps) {
  const { data: procedureTypesRaw } = useProcedureTypes()
  const procedureTypes = ((procedureTypesRaw ?? []) as ProcedureType[]).filter(
    (pt) => pt.isActive,
  )

  const createMutation = useCreatePackageTemplate()
  const updateMutation = useUpdatePackageTemplate()
  const isPending = createMutation.isPending || updateMutation.isPending

  const [name, setName] = useState(initialData?.name ?? '')
  const [description, setDescription] = useState(initialData?.description ?? '')
  const [defaultPrice, setDefaultPrice] = useState<string>(
    priceToMasked(initialData?.defaultPrice ?? null),
  )
  const [validityMonths, setValidityMonths] = useState<string>(
    initialData?.validityMonths != null ? String(initialData.validityMonths) : '',
  )
  const [lines, setLines] = useState<LineDraft[]>(
    initialData?.lines.length
      ? initialData.lines.map((l) => ({
          procedureTypeId: l.procedureTypeId,
          sessionsCount: l.sessionsCount,
        }))
      : [{ procedureTypeId: '', sessionsCount: 1 }],
  )

  const isEditing = !!initialData?.id

  const procedureTypeItems: Record<string, string> = procedureTypes.reduce(
    (acc, pt) => {
      acc[pt.id] = pt.name
      return acc
    },
    {} as Record<string, string>,
  )

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function addLine() {
    setLines((prev) => [...prev, { procedureTypeId: '', sessionsCount: 1 }])
  }

  function removeLine(index: number) {
    setLines((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev,
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!name.trim()) {
      toast.error('Nome é obrigatório')
      return
    }

    const cleanedLines = lines
      .filter((l) => l.procedureTypeId && l.sessionsCount > 0)
      .map((l, idx) => ({
        procedureTypeId: l.procedureTypeId,
        sessionsCount: l.sessionsCount,
        sortOrder: idx,
      }))

    if (cleanedLines.length === 0) {
      toast.error('Adicione ao menos um procedimento ao pacote')
      return
    }

    const seen = new Set<string>()
    for (const line of cleanedLines) {
      if (seen.has(line.procedureTypeId)) {
        toast.error('Não repita o mesmo procedimento mais de uma vez')
        return
      }
      seen.add(line.procedureTypeId)
    }

    const priceNumber = defaultPrice ? parseCurrency(defaultPrice) : null
    const validityNumber = validityMonths
      ? parseInt(validityMonths, 10)
      : null

    if (validityNumber != null && (isNaN(validityNumber) || validityNumber < 1)) {
      toast.error('Validade deve ser de pelo menos 1 mês')
      return
    }

    const payload: PackageTemplatePayload = {
      name: name.trim(),
      description: description.trim() || null,
      defaultPrice: priceNumber,
      validityMonths: validityNumber,
      lines: cleanedLines,
    }

    try {
      if (isEditing) {
        await updateMutation.mutateAsync({ id: initialData!.id, ...payload })
        toast.success('Modelo de pacote atualizado')
      } else {
        await createMutation.mutateAsync(payload)
        toast.success('Modelo de pacote criado')
      }
      onSuccess?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar modelo')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="pkg-name">Nome do pacote *</Label>
        <Input
          id="pkg-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Combo Skinbooster + Toxina"
          required
          maxLength={255}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="pkg-description">Descrição</Label>
        <Textarea
          id="pkg-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descrição do pacote, indicações, observações..."
          rows={3}
          maxLength={2000}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pkg-price">Preço sugerido (R$)</Label>
          <MaskedInput
            id="pkg-price"
            mask={maskCurrency}
            inputMode="numeric"
            value={defaultPrice}
            onChange={(e) => setDefaultPrice(e.target.value)}
            placeholder="0,00"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="pkg-validity">Validade (meses)</Label>
          <Input
            id="pkg-validity"
            type="number"
            min={1}
            max={120}
            value={validityMonths}
            onChange={(e) => setValidityMonths(e.target.value)}
            placeholder="Ex: 12"
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Procedimentos incluídos *</Label>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={addLine}
          >
            <PlusIcon data-icon="inline-start" />
            Adicionar
          </Button>
        </div>

        <div className="space-y-2">
          {lines.map((line, index) => (
            <div
              key={index}
              className="flex items-end gap-2 rounded-[3px] border border-[#E8ECEF] bg-[#FAFBFC] p-3"
            >
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-mid">Procedimento</Label>
                <Select
                  items={procedureTypeItems}
                  value={line.procedureTypeId}
                  onValueChange={(v) =>
                    updateLine(index, { procedureTypeId: v ?? '' })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione o procedimento" />
                  </SelectTrigger>
                  <SelectContent />
                </Select>
              </div>

              <div className="w-24 space-y-1">
                <Label className="text-xs text-mid">Sessões</Label>
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={line.sessionsCount}
                  onChange={(e) =>
                    updateLine(index, {
                      sessionsCount: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                />
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => removeLine(index)}
                disabled={lines.length <= 1}
                title="Remover linha"
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Salvando...' : isEditing ? 'Atualizar' : 'Criar pacote'}
        </Button>
      </div>
    </form>
  )
}
