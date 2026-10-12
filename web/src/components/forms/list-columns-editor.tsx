'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { generateFormId } from '@/lib/forms/constants'
import type { FormListColumn } from '@/lib/forms/types'

const COLUMN_KIND_LABELS = { text: 'Texto', select: 'Lista de opções' }

interface ListColumnsEditorProps {
  columns: FormListColumn[]
  onChange: (columns: FormListColumn[]) => void
}

export function ListColumnsEditor({ columns, onChange }: ListColumnsEditorProps) {
  function update(index: number, patch: Partial<FormListColumn>) {
    onChange(columns.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= columns.length) return
    const next = [...columns]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {columns.map((column, index) => {
        const name = column.label.trim() || String(index + 1)
        const requiredId = `column-required-${column.id}`
        return (
          <div key={column.id} className="space-y-2 rounded-[3px] border border-[#E8ECEF] p-3">
            <div className="flex items-center gap-2">
              <Input
                value={column.label}
                onChange={(e) => update(index, { label: e.target.value })}
                placeholder="Nome da coluna"
                aria-label="Nome da coluna"
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Mover coluna ${name} para cima`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUpIcon className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Mover coluna ${name} para baixo`}
                disabled={index === columns.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDownIcon className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remover coluna ${name}`}
                onClick={() => onChange(columns.filter((_, i) => i !== index))}
              >
                <Trash2Icon className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Select
                items={COLUMN_KIND_LABELS}
                value={column.kind}
                onValueChange={(v) =>
                  update(index, v === 'select' ? { kind: 'select', options: column.options ?? [] } : { kind: 'text', options: undefined })
                }
              >
                <SelectTrigger className="w-44" aria-label="Tipo da coluna">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent />
              </Select>
              <div className="flex items-center gap-2">
                <Label htmlFor={requiredId} className="text-xs text-mid">Obrigatória</Label>
                <Switch
                  id={requiredId}
                  checked={column.required ?? false}
                  onCheckedChange={(checked) => update(index, { required: checked })}
                  size="sm"
                />
              </div>
            </div>
            {column.kind === 'select' && (
              <div className="space-y-1.5">
                <Label className="text-xs text-mid">Opções (uma por linha)</Label>
                <Textarea
                  defaultValue={(column.options ?? []).join('\n')}
                  onChange={(e) =>
                    update(index, {
                      options: e.target.value
                        .split('\n')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  rows={3}
                  aria-label="Opções (uma por linha)"
                />
              </div>
            )}
          </div>
        )
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => onChange([...columns, { id: generateFormId(), label: '', kind: 'text' }])}
      >
        <PlusIcon data-icon="inline-start" />
        Adicionar coluna
      </Button>
    </div>
  )
}
