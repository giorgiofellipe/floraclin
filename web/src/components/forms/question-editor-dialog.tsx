'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PlusIcon, XIcon } from 'lucide-react'
import { QUESTION_TYPE_LABELS, CHOICE_QUESTION_TYPES } from '@/lib/forms/constants'
import { formQuestionSchema } from '@/lib/forms/sections-schema'
import type { FormListColumn, FormQuestion, FormQuestionType } from '@/lib/forms/types'
import { ListColumnsEditor } from './list-columns-editor'

export interface QuestionEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  question?: FormQuestion | null
  allowedTypes: readonly FormQuestionType[]
  onSave: (question: Omit<FormQuestion, 'id' | 'order'>) => void
}

export function QuestionEditorDialog({
  open,
  onOpenChange,
  question,
  allowedTypes,
  onSave,
}: QuestionEditorDialogProps) {
  const [label, setLabel] = useState('')
  const [type, setType] = useState<FormQuestionType>(allowedTypes[0])
  const [required, setRequired] = useState(true)
  const [options, setOptions] = useState<string[]>([''])
  const [scaleMin, setScaleMin] = useState(1)
  const [scaleMax, setScaleMax] = useState(5)
  const [scaleMinLabel, setScaleMinLabel] = useState('')
  const [scaleMaxLabel, setScaleMaxLabel] = useState('')
  const [helpText, setHelpText] = useState('')
  const [warningText, setWarningText] = useState('')
  const [columns, setColumns] = useState<FormListColumn[]>([])

  useEffect(() => {
    if (open) {
      if (question) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- dialog-open reset pattern; intentional prop-to-state sync
        setLabel(question.label)
        setType(question.type)
        setRequired(question.required)
        setOptions(question.options?.length ? [...question.options] : [''])
        setScaleMin(question.scaleMin ?? 1)
        setScaleMax(question.scaleMax ?? 5)
        setScaleMinLabel(question.scaleMinLabel ?? '')
        setScaleMaxLabel(question.scaleMaxLabel ?? '')
        setHelpText(question.helpText ?? '')
        setWarningText(question.warningText ?? '')
        setColumns(question.columns ? question.columns.map((c) => ({ ...c })) : [])
      } else {
        setLabel('')
        setType(allowedTypes[0])
        setRequired(true)
        setOptions([''])
        setScaleMin(1)
        setScaleMax(5)
        setScaleMinLabel('')
        setScaleMaxLabel('')
        setHelpText('')
        setWarningText('')
        setColumns([])
      }
    }
  }, [open, question, allowedTypes])

  const showOptions = CHOICE_QUESTION_TYPES.includes(type)
  const showScale = type === 'scale'
  const showList = type === 'list'
  const typeItems = Object.fromEntries(allowedTypes.map((t) => [t, QUESTION_TYPE_LABELS[t]]))

  function handleAddOption() {
    setOptions([...options, ''])
  }

  function handleRemoveOption(index: number) {
    setOptions(options.filter((_, i) => i !== index))
  }

  function handleOptionChange(index: number, value: string) {
    const newOptions = [...options]
    newOptions[index] = value
    setOptions(newOptions)
  }

  function buildData(): Omit<FormQuestion, 'id' | 'order'> {
    const data: Omit<FormQuestion, 'id' | 'order'> = {
      label: label.trim(),
      type,
      required,
    }

    if (showOptions) {
      data.options = options.filter((o) => o.trim()).map((o) => o.trim())
    }

    if (showScale) {
      data.scaleMin = scaleMin
      data.scaleMax = scaleMax
      if (scaleMinLabel.trim()) data.scaleMinLabel = scaleMinLabel.trim()
      if (scaleMaxLabel.trim()) data.scaleMaxLabel = scaleMaxLabel.trim()
    }

    if (helpText.trim()) data.helpText = helpText.trim()
    if (warningText.trim()) data.warningText = warningText.trim()

    if (showList) data.columns = columns

    return data
  }

  const validation = formQuestionSchema.safeParse({ ...buildData(), id: 'draft', order: 0 })
  const isValid = validation.success

  function handleSave() {
    if (!isValid) return
    onSave(buildData())
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {question ? 'Editar Pergunta' : 'Nova Pergunta'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Label */}
          <div className="space-y-1.5">
            <Label htmlFor="q-label" className="uppercase tracking-wider text-xs text-mid">
              Pergunta *
            </Label>
            <Input
              id="q-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex: Possui histórico de alergia?"
            />
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <Label className="uppercase tracking-wider text-xs text-mid">
              Tipo
            </Label>
            <Select items={typeItems} value={type} onValueChange={(v) => setType(v as FormQuestionType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>

          {/* Required */}
          <div className="flex items-center justify-between">
            <Label className="uppercase tracking-wider text-xs text-mid">
              Obrigatória
            </Label>
            <Switch
              checked={required}
              onCheckedChange={(checked) => setRequired(checked as boolean)}
              size="sm"
            />
          </div>

          {/* Options (for radio/checkbox types) */}
          {showOptions && (
            <div className="space-y-1.5">
              <Label className="uppercase tracking-wider text-xs text-mid">
                Opções
              </Label>
              <div className="space-y-2">
                {options.map((option, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={option}
                      onChange={(e) => handleOptionChange(index, e.target.value)}
                      placeholder={`Opção ${index + 1}`}
                      className="flex-1"
                    />
                    {options.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleRemoveOption(index)}
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddOption}
                  className="w-full"
                >
                  <PlusIcon data-icon="inline-start" />
                  Adicionar opção
                </Button>
              </div>
            </div>
          )}

          {showList && (
            <div className="space-y-1.5">
              <Label className="uppercase tracking-wider text-xs text-mid">
                Colunas
              </Label>
              <ListColumnsEditor columns={columns} onChange={setColumns} />
            </div>
          )}

          {/* Scale config */}
          {showScale && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="scale-min" className="uppercase tracking-wider text-xs text-mid">
                    Mínimo
                  </Label>
                  <Input
                    id="scale-min"
                    type="number"
                    value={scaleMin}
                    onChange={(e) => setScaleMin(parseInt(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="scale-max" className="uppercase tracking-wider text-xs text-mid">
                    Máximo
                  </Label>
                  <Input
                    id="scale-max"
                    type="number"
                    value={scaleMax}
                    onChange={(e) => setScaleMax(parseInt(e.target.value) || 5)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="scale-min-label" className="uppercase tracking-wider text-xs text-mid">
                    Label mínimo
                  </Label>
                  <Input
                    id="scale-min-label"
                    value={scaleMinLabel}
                    onChange={(e) => setScaleMinLabel(e.target.value)}
                    placeholder="Ex: Muito insatisfeita"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="scale-max-label" className="uppercase tracking-wider text-xs text-mid">
                    Label máximo
                  </Label>
                  <Input
                    id="scale-max-label"
                    value={scaleMaxLabel}
                    onChange={(e) => setScaleMaxLabel(e.target.value)}
                    placeholder="Ex: Muito satisfeita"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Help text */}
          <div className="space-y-1.5">
            <Label htmlFor="help-text" className="uppercase tracking-wider text-xs text-mid">
              Texto de ajuda
            </Label>
            <Input
              id="help-text"
              value={helpText}
              onChange={(e) => setHelpText(e.target.value)}
              placeholder="Texto auxiliar exibido abaixo da pergunta"
            />
          </div>

          {/* Warning text */}
          <div className="space-y-1.5">
            <Label htmlFor="warning-text" className="uppercase tracking-wider text-xs text-mid">
              Texto de alerta
            </Label>
            <Textarea
              id="warning-text"
              value={warningText}
              onChange={(e) => setWarningText(e.target.value)}
              placeholder="Alerta exibido como aviso (opcional)"
              rows={2}
            />
          </div>

          {!validation.success && (
            <p role="alert" className="text-xs font-medium text-red-600">
              {validation.error.issues[0]?.message}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!isValid}>
            {question ? 'Salvar' : 'Adicionar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
