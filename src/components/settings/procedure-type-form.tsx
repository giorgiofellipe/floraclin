'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MaskedInput } from '@/components/ui/masked-input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { maskCurrency, parseCurrency } from '@/lib/masks'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useCreateProcedureType, useUpdateProcedureType } from '@/hooks/mutations/use-procedure-type-mutations'
import { PROCEDURE_CATEGORIES } from '@/lib/constants'
import { toast } from 'sonner'

const CATEGORY_LABELS: Record<string, string> = {
  botox: 'Toxina Botulínica',
  filler: 'Preenchimento',
  biostimulator: 'Bioestimulador',
  peel: 'Peeling',
  skinbooster: 'Skinbooster',
  laser: 'Laser',
  microagulhamento: 'Microagulhamento',
  outros: 'Outros',
}

interface ProcedureTypeFormProps {
  initialData?: {
    id: string
    name: string
    category: string
    description?: string | null
    defaultPrice?: string | null
    estimatedDurationMin?: number | null
    isActive: boolean
  }
  onSuccess?: () => void
  onCancel?: () => void
}

export function ProcedureTypeForm({ initialData, onSuccess, onCancel }: ProcedureTypeFormProps) {
  const createProcedureType = useCreateProcedureType()
  const updateProcedureTypeMutation = useUpdateProcedureType()
  const isPending = createProcedureType.isPending || updateProcedureTypeMutation.isPending
  const [name, setName] = useState(initialData?.name || '')
  const [category, setCategory] = useState(initialData?.category || '')
  const [description, setDescription] = useState(initialData?.description || '')
  const [defaultPrice, setDefaultPrice] = useState(() => {
    if (!initialData?.defaultPrice) return ''
    // Convert stored value (e.g. "150.00" or "150") to masked format
    const num = parseFloat(initialData.defaultPrice)
    if (isNaN(num)) return ''
    // Convert to cents string then mask
    const cents = Math.round(num * 100).toString()
    return maskCurrency(cents)
  })
  const [estimatedDurationMin, setEstimatedDurationMin] = useState(
    initialData?.estimatedDurationMin?.toString() || '60'
  )
  const [isActive, setIsActive] = useState(initialData?.isActive ?? true)

  const isEditing = !!initialData?.id

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const formData = {
      name,
      category: category as (typeof PROCEDURE_CATEGORIES)[number],
      description,
      defaultPrice: defaultPrice ? String(parseCurrency(defaultPrice)) : '',
      estimatedDurationMin: parseInt(estimatedDurationMin) || 60,
      isActive,
    }

    try {
      if (isEditing) {
        await updateProcedureTypeMutation.mutateAsync({ id: initialData!.id, ...formData })
      } else {
        await createProcedureType.mutateAsync(formData)
      }
      toast.success(isEditing ? 'Procedimento atualizado' : 'Procedimento criado')
      onSuccess?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar procedimento')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="pt-name">Nome *</Label>
        <Input
          id="pt-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Toxina Botulínica"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="pt-category">Categoria *</Label>
        <Select value={category} onValueChange={(v) => setCategory(v ?? '')}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecione a categoria">
              {(value: string) => CATEGORY_LABELS[value] || value}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PROCEDURE_CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {CATEGORY_LABELS[cat] || cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="pt-description">Descrição</Label>
        <Textarea
          id="pt-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descrição do procedimento"
          rows={3}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pt-price">Preço Padrão (R$)</Label>
          <MaskedInput
            id="pt-price"
            mask={maskCurrency}
            inputMode="numeric"
            value={defaultPrice}
            onChange={(e) => setDefaultPrice(e.target.value)}
            placeholder="0,00"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="pt-duration">Duração Estimada (min)</Label>
          <Input
            id="pt-duration"
            type="number"
            min={5}
            max={480}
            value={estimatedDurationMin}
            onChange={(e) => setEstimatedDurationMin(e.target.value)}
            placeholder="60"
          />
        </div>
      </div>

      {isEditing && (
        <div className="flex items-center gap-3">
          <Switch
            checked={isActive}
            onCheckedChange={setIsActive}
          />
          <Label>Ativo</Label>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Salvando...' : isEditing ? 'Atualizar' : 'Criar Procedimento'}
        </Button>
      </div>
    </form>
  )
}
