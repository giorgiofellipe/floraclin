'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface CustomProductInput {
  name: string
  category: 'botox' | 'filler' | 'biostimulator' | 'skinbooster' | 'peel' | 'other'
  activeIngredient: string
  defaultUnit: 'U' | 'mL'
}

interface CustomProductFormProps {
  onAdd: (product: CustomProductInput) => void
  onCancel: () => void
}

const CATEGORY_ITEMS: Record<string, string> = {
  botox: 'Toxina Botulínica',
  filler: 'Preenchedor',
  biostimulator: 'Bioestimulador',
  skinbooster: 'Skinbooster',
  peel: 'Peeling',
  other: 'Outro',
}

const UNIT_ITEMS: Record<string, string> = { U: 'U (Unidades)', mL: 'mL (Mililitros)' }

export function CustomProductForm({ onAdd, onCancel }: CustomProductFormProps) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<CustomProductInput['category']>('botox')
  const [activeIngredient, setActiveIngredient] = useState('')
  const [defaultUnit, setDefaultUnit] = useState<CustomProductInput['defaultUnit']>('U')

  function handleAdd() {
    const trimmed = name.trim()
    if (!trimmed) return
    onAdd({
      name: trimmed,
      category,
      activeIngredient: activeIngredient.trim(),
      defaultUnit,
    })
    setName('')
    setActiveIngredient('')
    setCategory('botox')
    setDefaultUnit('U')
  }

  return (
    <div className="rounded-lg border border-[#E8ECEF] bg-[#F4F6F8] p-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="uppercase tracking-wider text-xs font-medium text-mid">Nome</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do produto"
            maxLength={150}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label className="uppercase tracking-wider text-xs font-medium text-mid">Categoria</Label>
          <Select
            items={CATEGORY_ITEMS}
            value={category}
            onValueChange={(v) => v && setCategory(v as CustomProductInput['category'])}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CATEGORY_ITEMS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="uppercase tracking-wider text-xs font-medium text-mid">Unidade</Label>
          <Select
            items={UNIT_ITEMS}
            value={defaultUnit}
            onValueChange={(v) => v && setDefaultUnit(v as CustomProductInput['defaultUnit'])}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(UNIT_ITEMS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="uppercase tracking-wider text-xs font-medium text-mid">Princípio ativo</Label>
          <Input
            value={activeIngredient}
            onChange={(e) => setActiveIngredient(e.target.value)}
            placeholder="Princípio ativo (opcional)"
            maxLength={150}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="button" size="sm" onClick={handleAdd} disabled={!name.trim()}>
          Adicionar
        </Button>
      </div>
    </div>
  )
}
