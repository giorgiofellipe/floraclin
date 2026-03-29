'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Accordion } from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { AnamnesisSection } from './anamnesis-section'
import {
  anamnesisSchema,
  type AnamnesisFormData,
  type MedicalHistory,
} from '@/validations/anamnesis'
import { upsertAnamnesisAction } from '@/actions/anamnesis'
import { formatDateTime } from '@/lib/utils'

// ─── Types ──────────────────────────────────────────────────────────

interface AnamnesisFormProps {
  patientId: string
  initialData?: AnamnesisFormData & {
    id?: string
    updatedAt?: Date | string
    updatedBy?: string | null
  }
  updatedByName?: string
}

// ─── Constants ──────────────────────────────────────────────────────

const MEDICAL_HISTORY_LABELS: Record<keyof Omit<MedicalHistory, 'outros'>, string> = {
  diabetes: 'Diabetes',
  hipertensao: 'Hipertensão',
  autoimune: 'Doença autoimune',
  cardiovascular: 'Doença cardiovascular',
  hepatite: 'Hepatite',
  hiv: 'HIV/AIDS',
  cancer: 'Câncer',
  epilepsia: 'Epilepsia',
  disturbioCoagulacao: 'Distúrbio de coagulação',
  queloides: 'Queloides',
  herpes: 'Herpes',
}

const SEVERITY_OPTIONS = [
  { value: 'leve', label: 'Leve' },
  { value: 'moderada', label: 'Moderada' },
  { value: 'grave', label: 'Grave' },
]

const SATISFACTION_OPTIONS = [
  { value: 'muito_insatisfeito', label: 'Muito insatisfeito' },
  { value: 'insatisfeito', label: 'Insatisfeito' },
  { value: 'neutro', label: 'Neutro' },
  { value: 'satisfeito', label: 'Satisfeito' },
  { value: 'muito_satisfeito', label: 'Muito satisfeito' },
]

const SMOKING_OPTIONS = [
  { value: 'nao', label: 'Não' },
  { value: 'ex_fumante', label: 'Ex-fumante' },
  { value: 'sim_ocasional', label: 'Sim, ocasional' },
  { value: 'sim_diario', label: 'Sim, diário' },
]

const ALCOHOL_OPTIONS = [
  { value: 'nao', label: 'Não' },
  { value: 'ocasional', label: 'Ocasional' },
  { value: 'moderado', label: 'Moderado' },
  { value: 'frequente', label: 'Frequente' },
]

const EXERCISE_OPTIONS = [
  { value: 'sedentario', label: 'Sedentário' },
  { value: 'leve', label: 'Leve' },
  { value: 'moderado', label: 'Moderado' },
  { value: 'intenso', label: 'Intenso' },
]

const SLEEP_OPTIONS = [
  { value: 'ruim', label: 'Ruim' },
  { value: 'regular', label: 'Regular' },
  { value: 'bom', label: 'Bom' },
  { value: 'excelente', label: 'Excelente' },
]

const DIET_OPTIONS = [
  { value: 'desequilibrada', label: 'Desequilibrada' },
  { value: 'regular', label: 'Regular' },
  { value: 'equilibrada', label: 'Equilibrada' },
  { value: 'restritiva', label: 'Restritiva' },
]

const SUN_EXPOSURE_OPTIONS = [
  { value: 'minima', label: 'Mínima' },
  { value: 'moderada', label: 'Moderada' },
  { value: 'alta', label: 'Alta' },
  { value: 'muito_alta', label: 'Muito alta' },
]

const SKIN_TYPE_OPTIONS = [
  { value: 'I', label: 'Tipo I - Muito clara' },
  { value: 'II', label: 'Tipo II - Clara' },
  { value: 'III', label: 'Tipo III - Morena clara' },
  { value: 'IV', label: 'Tipo IV - Morena' },
  { value: 'V', label: 'Tipo V - Morena escura' },
  { value: 'VI', label: 'Tipo VI - Negra' },
]

// ─── Tag Input Component ────────────────────────────────────────────

function TagInput({
  value = [],
  onChange,
  placeholder,
}: {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder: string
}) {
  const [inputValue, setInputValue] = useState('')

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const tag = inputValue.trim()
      if (tag && !value.includes(tag)) {
        onChange([...value, tag])
      }
      setInputValue('')
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  const removeTag = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    <div className="flex flex-wrap gap-1.5 rounded-[3px] border border-sage/20 p-2.5 min-h-[42px] focus-within:border-sage/40 focus-within:ring-2 focus-within:ring-sage/10 transition-all duration-150">
      {value.map((tag, i) => (
        <Badge
          key={i}
          variant="secondary"
          className="gap-1 text-xs rounded-full bg-mint/15 text-forest border-0 px-2.5 py-0.5"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(i)}
            className="ml-0.5 hover:text-red-600 transition-colors"
          >
            &times;
          </button>
        </Badge>
      ))}
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={value.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-mid/50"
      />
    </div>
  )
}

// ─── SelectField helper (wraps base-ui Select for react-hook-form) ──

function SelectField({
  value,
  onValueChange,
  options,
  placeholder,
}: {
  value: string | undefined
  onValueChange: (val: string) => void
  options: { value: string; label: string }[]
  placeholder: string
}) {
  return (
    <Select
      value={value ?? ''}
      onValueChange={(val) => {
        if (val !== null) onValueChange(val)
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder}>
          {(val: string) => options.find((o) => o.value === val)?.label ?? val}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ─── Main Component ─────────────────────────────────────────────────

export function AnamnesisForm({ patientId, initialData, updatedByName }: AnamnesisFormProps) {
  const [isPending, startTransition] = useTransition()
  const [lastSaved, setLastSaved] = useState<Date | null>(
    initialData?.updatedAt ? new Date(initialData.updatedAt) : null
  )
  const [lastSavedBy, setLastSavedBy] = useState<string | null>(updatedByName ?? null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const expectedUpdatedAtRef = useRef<string | undefined>(
    initialData?.updatedAt ? new Date(initialData.updatedAt).toISOString() : undefined
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const form = useForm<AnamnesisFormData>({
    resolver: zodResolver(anamnesisSchema) as any,
    defaultValues: {
      mainComplaint: initialData?.mainComplaint ?? '',
      patientGoals: initialData?.patientGoals ?? '',
      medicalHistory: {
        diabetes: false,
        hipertensao: false,
        autoimune: false,
        cardiovascular: false,
        hepatite: false,
        hiv: false,
        cancer: false,
        epilepsia: false,
        disturbioCoagulacao: false,
        queloides: false,
        herpes: false,
        outros: '',
        ...(initialData?.medicalHistory as Record<string, unknown> ?? {}),
      },
      medications: initialData?.medications ?? [],
      allergies: initialData?.allergies ?? [],
      previousSurgeries: initialData?.previousSurgeries ?? [],
      chronicConditions: (initialData?.chronicConditions ?? []) as string[],
      isPregnant: initialData?.isPregnant ?? false,
      isBreastfeeding: initialData?.isBreastfeeding ?? false,
      lifestyle: {
        smoking: undefined,
        alcohol: undefined,
        exercise: undefined,
        sleep: undefined,
        diet: undefined,
        sunExposure: undefined,
        ...(initialData?.lifestyle as Record<string, unknown> ?? {}),
      },
      skinType: initialData?.skinType as AnamnesisFormData['skinType'] ?? undefined,
      skinConditions: (initialData?.skinConditions ?? []) as string[],
      skincareRoutine: initialData?.skincareRoutine ?? [],
      previousAestheticTreatments: initialData?.previousAestheticTreatments ?? [],
      contraindications: (initialData?.contraindications ?? []) as string[],
      facialEvaluationNotes: initialData?.facialEvaluationNotes ?? '',
    },
  })

  const { control, watch, getValues, handleSubmit } = form

  // Field arrays
  const medications = useFieldArray({ control, name: 'medications' })
  const allergies = useFieldArray({ control, name: 'allergies' })
  const previousSurgeries = useFieldArray({ control, name: 'previousSurgeries' })
  const skincareRoutine = useFieldArray({ control, name: 'skincareRoutine' })
  const previousTreatments = useFieldArray({ control, name: 'previousAestheticTreatments' })

  // ─── Auto-save ──────────────────────────────────────────────────

  const saveForm = useCallback(() => {
    const data = getValues()
    startTransition(async () => {
      const result = await upsertAnamnesisAction(
        patientId,
        data,
        expectedUpdatedAtRef.current
      )
      if (result.success && result.data) {
        expectedUpdatedAtRef.current = new Date(result.data.updatedAt).toISOString()
        setLastSaved(new Date(result.data.updatedAt))
        setLastSavedBy(null) // current user just saved
      } else if (!result.success && result.error) {
        toast.error(result.error)
      }
    })
  }, [patientId, getValues])

  const debouncedSave = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      saveForm()
    }, 1000)
  }, [saveForm])

  // Watch all form fields and auto-save on change
  useEffect(() => {
    const subscription = watch(() => {
      debouncedSave()
    })
    return () => {
      subscription.unsubscribe()
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [watch, debouncedSave])

  // ─── Section completeness checks ─────────────────────────────

  const formValues = watch()

  const isComplaintComplete = Boolean(formValues.mainComplaint?.trim())
  const isMedicalHistoryComplete = Boolean(
    formValues.medicalHistory &&
    Object.entries(formValues.medicalHistory).some(
      ([key, val]) => key !== 'outros' && val === true
    ) ||
    formValues.medicalHistory?.outros?.trim()
  )
  const isMedicationsComplete = (formValues.medications?.length ?? 0) > 0
  const isAllergiesComplete = (formValues.allergies?.length ?? 0) > 0
  const isSurgeriesComplete = (formValues.previousSurgeries?.length ?? 0) > 0
  const isChronicComplete = (formValues.chronicConditions?.length ?? 0) > 0
  const isPregnancyComplete = formValues.isPregnant === true || formValues.isBreastfeeding === true
  const isLifestyleComplete = Boolean(
    formValues.lifestyle &&
    Object.values(formValues.lifestyle).some(v => v != null && String(v) !== '')
  )
  const isSkinTypeComplete = Boolean(formValues.skinType)
  const isSkinConditionsComplete = (formValues.skinConditions?.length ?? 0) > 0
  const isSkincareComplete = (formValues.skincareRoutine?.length ?? 0) > 0
  const isTreatmentsComplete = (formValues.previousAestheticTreatments?.length ?? 0) > 0
  const isContraindicationsComplete = (formValues.contraindications?.length ?? 0) > 0
  const isFacialEvalComplete = Boolean(formValues.facialEvaluationNotes?.trim())

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[#2A2A2A]">Anamnese</h2>
        {isPending && (
          <div className="flex items-center gap-1.5 text-xs text-sage">
            <Loader2 className="size-3 animate-spin" />
            Salvando...
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit(saveForm)}>
        <Accordion defaultValue={['complaint']}>
          {/* ── Queixa principal e objetivos ── */}
          <AnamnesisSection
            value="complaint"
            title="Queixa principal e objetivos"
            isComplete={isComplaintComplete}
          >
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="mainComplaint" className="uppercase tracking-wider text-xs text-mid">Queixa principal</Label>
                <Controller
                  control={control}
                  name="mainComplaint"
                  render={({ field }) => (
                    <Textarea
                      id="mainComplaint"
                      placeholder="Descreva a queixa principal do paciente..."
                      rows={3}
                      className="min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
                      {...field}
                    />
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="patientGoals" className="uppercase tracking-wider text-xs text-mid">Objetivos do paciente</Label>
                <Controller
                  control={control}
                  name="patientGoals"
                  render={({ field }) => (
                    <Textarea
                      id="patientGoals"
                      placeholder="O que o paciente espera alcancar..."
                      rows={3}
                      className="min-h-[80px] resize-none border-sage/20 focus:border-sage/40"
                      {...field}
                    />
                  )}
                />
              </div>
            </div>
          </AnamnesisSection>

          {/* ── Histórico médico ── */}
          <AnamnesisSection
            value="medicalHistory"
            title="Histórico médico"
            isComplete={isMedicalHistoryComplete}
          >
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {(Object.entries(MEDICAL_HISTORY_LABELS) as [keyof Omit<MedicalHistory, 'outros'>, string][]).map(
                  ([key, label]) => (
                    <Controller
                      key={key}
                      control={control}
                      name={`medicalHistory.${key}`}
                      render={({ field }) => (
                        <label className={cn(
                          'flex items-center gap-2.5 text-sm cursor-pointer rounded-lg border px-3 py-2.5 transition-all duration-150',
                          field.value
                            ? 'border-sage/30 bg-sage/5 text-forest'
                            : 'border-sage/10 hover:border-sage/20 hover:bg-petal/20 text-charcoal'
                        )}>
                          <Checkbox
                            checked={field.value ?? false}
                            onCheckedChange={field.onChange}
                            className="border-sage data-[state=checked]:bg-forest data-[state=checked]:border-forest"
                          />
                          {label}
                        </label>
                      )}
                    />
                  )
                )}
              </div>
              <div className="space-y-1.5 pt-2 border-t border-petal">
                <Label htmlFor="medicalHistoryOutros" className="uppercase tracking-wider text-xs text-mid">Outros</Label>
                <Controller
                  control={control}
                  name="medicalHistory.outros"
                  render={({ field }) => (
                    <Input
                      id="medicalHistoryOutros"
                      placeholder="Especifique..."
                      {...field}
                    />
                  )}
                />
              </div>
            </div>
          </AnamnesisSection>

          {/* ── Medicamentos ── */}
          <AnamnesisSection
            value="medications"
            title="Medicamentos em uso"
            isComplete={isMedicationsComplete}
          >
            <div className="space-y-3">
              {medications.fields.map((field, index) => (
                <div key={field.id} className="flex gap-2 items-start">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1">
                    <Controller
                      control={control}
                      name={`medications.${index}.name`}
                      render={({ field }) => (
                        <Input placeholder="Nome" {...field} />
                      )}
                    />
                    <Controller
                      control={control}
                      name={`medications.${index}.dosage`}
                      render={({ field }) => (
                        <Input placeholder="Dosagem" {...field} />
                      )}
                    />
                    <Controller
                      control={control}
                      name={`medications.${index}.frequency`}
                      render={({ field }) => (
                        <Input placeholder="Frequência" {...field} />
                      )}
                    />
                    <Controller
                      control={control}
                      name={`medications.${index}.reason`}
                      render={({ field }) => (
                        <Input placeholder="Motivo" {...field} />
                      )}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => medications.remove(index)}
                    className="shrink-0 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  medications.append({ name: '', dosage: '', frequency: '', reason: '' })
                }
                className="border-sage/30 text-forest hover:bg-petal/30 hover:border-sage/50 transition-all duration-150"
              >
                <Plus className="size-4 mr-1" />
                Adicionar medicamento
              </Button>
            </div>
          </AnamnesisSection>

          {/* ── Alergias ── */}
          <AnamnesisSection
            value="allergies"
            title="Alergias"
            isComplete={isAllergiesComplete}
          >
            <div className="space-y-3">
              {allergies.fields.map((field, index) => (
                <div key={field.id} className="flex gap-2 items-start">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 flex-1">
                    <Controller
                      control={control}
                      name={`allergies.${index}.substance`}
                      render={({ field }) => (
                        <Input placeholder="Substância" {...field} />
                      )}
                    />
                    <Controller
                      control={control}
                      name={`allergies.${index}.reaction`}
                      render={({ field }) => (
                        <Input placeholder="Reação" {...field} />
                      )}
                    />
                    <Controller
                      control={control}
                      name={`allergies.${index}.severity`}
                      render={({ field }) => (
                        <SelectField
                          value={field.value}
                          onValueChange={field.onChange}
                          options={SEVERITY_OPTIONS}
                          placeholder="Gravidade"
                        />
                      )}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => allergies.remove(index)}
                    className="shrink-0 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  allergies.append({ substance: '', reaction: '', severity: undefined })
                }
                className="border-sage/30 text-forest hover:bg-petal/30 hover:border-sage/50 transition-all duration-150"
              >
                <Plus className="size-4 mr-1" />
                Adicionar alergia
              </Button>
            </div>
          </AnamnesisSection>

          {/* ── Cirurgias anteriores ── */}
          <AnamnesisSection
            value="surgeries"
            title="Cirurgias anteriores"
            isComplete={isSurgeriesComplete}
          >
            <div className="space-y-3">
              {previousSurgeries.fields.map((field, index) => (
                <div key={field.id} className="flex gap-2 items-start">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 flex-1">
                    <Controller
                      control={control}
                      name={`previousSurgeries.${index}.procedure`}
                      render={({ field }) => (
                        <Input placeholder="Procedimento" {...field} />
                      )}
                    />
                    <Controller
                      control={control}
                      name={`previousSurgeries.${index}.year`}
                      render={({ field }) => (
                        <Input placeholder="Ano" {...field} />
                      )}
                    />
                    <Controller
                      control={control}
                      name={`previousSurgeries.${index}.notes`}
                      render={({ field }) => (
                        <Input placeholder="Observações" {...field} />
                      )}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => previousSurgeries.remove(index)}
                    className="shrink-0 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  previousSurgeries.append({ procedure: '', year: '', notes: '' })
                }
                className="border-sage/30 text-forest hover:bg-petal/30 hover:border-sage/50 transition-all duration-150"
              >
                <Plus className="size-4 mr-1" />
                Adicionar cirurgia
              </Button>
            </div>
          </AnamnesisSection>

          {/* ── Condições crônicas ── */}
          <AnamnesisSection
            value="chronicConditions"
            title="Condições crônicas"
            isComplete={isChronicComplete}
          >
            <Controller
              control={control}
              name="chronicConditions"
              render={({ field }) => (
                <TagInput
                  value={field.value ?? []}
                  onChange={field.onChange}
                  placeholder="Digite e pressione Enter para adicionar..."
                />
              )}
            />
          </AnamnesisSection>

          {/* ── Gestação / Amamentação ── */}
          <AnamnesisSection
            value="pregnancy"
            title="Gestação / Amamentação"
            isComplete={isPregnancyComplete}
          >
            <div className="flex flex-col sm:flex-row gap-6">
              <Controller
                control={control}
                name="isPregnant"
                render={({ field }) => (
                  <label className="flex items-center gap-3 cursor-pointer">
                    <Switch
                      checked={field.value ?? false}
                      onCheckedChange={field.onChange}
                    />
                    <span className="text-sm">Gestante</span>
                  </label>
                )}
              />
              <Controller
                control={control}
                name="isBreastfeeding"
                render={({ field }) => (
                  <label className="flex items-center gap-3 cursor-pointer">
                    <Switch
                      checked={field.value ?? false}
                      onCheckedChange={field.onChange}
                    />
                    <span className="text-sm">Amamentando</span>
                  </label>
                )}
              />
            </div>
          </AnamnesisSection>

          {/* ── Estilo de vida ── */}
          <AnamnesisSection
            value="lifestyle"
            title="Estilo de vida"
            isComplete={isLifestyleComplete}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="uppercase tracking-wider text-xs text-mid">Tabagismo</Label>
                <Controller
                  control={control}
                  name="lifestyle.smoking"
                  render={({ field }) => (
                    <SelectField
                      value={field.value}
                      onValueChange={field.onChange}
                      options={SMOKING_OPTIONS}
                      placeholder="Selecione..."
                    />
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="uppercase tracking-wider text-xs text-mid">Alcool</Label>
                <Controller
                  control={control}
                  name="lifestyle.alcohol"
                  render={({ field }) => (
                    <SelectField
                      value={field.value}
                      onValueChange={field.onChange}
                      options={ALCOHOL_OPTIONS}
                      placeholder="Selecione..."
                    />
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="uppercase tracking-wider text-xs text-mid">Exercicio fisico</Label>
                <Controller
                  control={control}
                  name="lifestyle.exercise"
                  render={({ field }) => (
                    <SelectField
                      value={field.value}
                      onValueChange={field.onChange}
                      options={EXERCISE_OPTIONS}
                      placeholder="Selecione..."
                    />
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="uppercase tracking-wider text-xs text-mid">Qualidade do sono</Label>
                <Controller
                  control={control}
                  name="lifestyle.sleep"
                  render={({ field }) => (
                    <SelectField
                      value={field.value}
                      onValueChange={field.onChange}
                      options={SLEEP_OPTIONS}
                      placeholder="Selecione..."
                    />
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="uppercase tracking-wider text-xs text-mid">Alimentacao</Label>
                <Controller
                  control={control}
                  name="lifestyle.diet"
                  render={({ field }) => (
                    <SelectField
                      value={field.value}
                      onValueChange={field.onChange}
                      options={DIET_OPTIONS}
                      placeholder="Selecione..."
                    />
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="uppercase tracking-wider text-xs text-mid">Exposicao solar</Label>
                <Controller
                  control={control}
                  name="lifestyle.sunExposure"
                  render={({ field }) => (
                    <SelectField
                      value={field.value}
                      onValueChange={field.onChange}
                      options={SUN_EXPOSURE_OPTIONS}
                      placeholder="Selecione..."
                    />
                  )}
                />
              </div>
            </div>
          </AnamnesisSection>

          {/* ── Tipo de pele ── */}
          <AnamnesisSection
            value="skinType"
            title="Tipo de pele (Fitzpatrick)"
            isComplete={isSkinTypeComplete}
          >
            <Controller
              control={control}
              name="skinType"
              render={({ field }) => (
                <SelectField
                  value={field.value ?? undefined}
                  onValueChange={field.onChange}
                  options={SKIN_TYPE_OPTIONS}
                  placeholder="Selecione o tipo de pele..."
                />
              )}
            />
          </AnamnesisSection>

          {/* ── Condições da pele ── */}
          <AnamnesisSection
            value="skinConditions"
            title="Condições da pele"
            isComplete={isSkinConditionsComplete}
          >
            <Controller
              control={control}
              name="skinConditions"
              render={({ field }) => (
                <TagInput
                  value={field.value ?? []}
                  onChange={field.onChange}
                  placeholder="Ex: acne, rosácea, melasma... (Enter para adicionar)"
                />
              )}
            />
          </AnamnesisSection>

          {/* ── Rotina de cuidados ── */}
          <AnamnesisSection
            value="skincareRoutine"
            title="Rotina de cuidados com a pele"
            isComplete={isSkincareComplete}
          >
            <div className="space-y-3">
              {skincareRoutine.fields.map((field, index) => (
                <div key={field.id} className="flex gap-2 items-start">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 flex-1">
                    <Controller
                      control={control}
                      name={`skincareRoutine.${index}.product`}
                      render={({ field }) => (
                        <Input placeholder="Produto" {...field} />
                      )}
                    />
                    <Controller
                      control={control}
                      name={`skincareRoutine.${index}.frequency`}
                      render={({ field }) => (
                        <Input placeholder="Frequência" {...field} />
                      )}
                    />
                    <Controller
                      control={control}
                      name={`skincareRoutine.${index}.notes`}
                      render={({ field }) => (
                        <Input placeholder="Observações" {...field} />
                      )}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => skincareRoutine.remove(index)}
                    className="shrink-0 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  skincareRoutine.append({ product: '', frequency: '', notes: '' })
                }
                className="border-sage/30 text-forest hover:bg-petal/30 hover:border-sage/50 transition-all duration-150"
              >
                <Plus className="size-4 mr-1" />
                Adicionar produto
              </Button>
            </div>
          </AnamnesisSection>

          {/* ── Tratamentos estéticos anteriores ── */}
          <AnamnesisSection
            value="previousTreatments"
            title="Tratamentos estéticos anteriores"
            isComplete={isTreatmentsComplete}
          >
            <div className="space-y-3">
              {previousTreatments.fields.map((field, index) => (
                <div key={field.id} className="space-y-2.5 rounded-[3px] border border-[#E8ECEF] bg-white p-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-mid uppercase tracking-wider">
                      Tratamento {index + 1}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => previousTreatments.remove(index)}
                      className="text-destructive hover:text-destructive h-7"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Controller
                      control={control}
                      name={`previousAestheticTreatments.${index}.procedure`}
                      render={({ field }) => (
                        <Input placeholder="Procedimento" {...field} />
                      )}
                    />
                    <Controller
                      control={control}
                      name={`previousAestheticTreatments.${index}.date`}
                      render={({ field }) => (
                        <Input placeholder="Data (ex: Jan 2025)" {...field} />
                      )}
                    />
                    <Controller
                      control={control}
                      name={`previousAestheticTreatments.${index}.professional`}
                      render={({ field }) => (
                        <Input placeholder="Profissional" {...field} />
                      )}
                    />
                    <Controller
                      control={control}
                      name={`previousAestheticTreatments.${index}.satisfaction`}
                      render={({ field }) => (
                        <SelectField
                          value={field.value}
                          onValueChange={field.onChange}
                          options={SATISFACTION_OPTIONS}
                          placeholder="Satisfação"
                        />
                      )}
                    />
                  </div>
                  <Controller
                    control={control}
                    name={`previousAestheticTreatments.${index}.notes`}
                    render={({ field }) => (
                      <Input placeholder="Observações" {...field} />
                    )}
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  previousTreatments.append({
                    procedure: '',
                    date: '',
                    professional: '',
                    notes: '',
                    satisfaction: undefined,
                  })
                }
                className="border-sage/30 text-forest hover:bg-petal/30 hover:border-sage/50 transition-all duration-150"
              >
                <Plus className="size-4 mr-1" />
                Adicionar tratamento
              </Button>
            </div>
          </AnamnesisSection>

          {/* ── Contraindicações ── */}
          <AnamnesisSection
            value="contraindications"
            title="Contraindicações"
            isComplete={isContraindicationsComplete}
          >
            <Controller
              control={control}
              name="contraindications"
              render={({ field }) => (
                <TagInput
                  value={field.value ?? []}
                  onChange={field.onChange}
                  placeholder="Ex: gravidez, uso de isotretinoína... (Enter para adicionar)"
                />
              )}
            />
          </AnamnesisSection>

          {/* ── Avaliação facial ── */}
          <AnamnesisSection
            value="facialEvaluation"
            title="Avaliação facial"
            isComplete={isFacialEvalComplete}
          >
            <div className="space-y-2">
              <Controller
                control={control}
                name="facialEvaluationNotes"
                render={({ field }) => (
                  <Textarea
                    placeholder="Observações da avaliação facial..."
                    rows={4}
                    className="min-h-[100px] resize-none border-sage/20 focus:border-sage/40"
                    {...field}
                  />
                )}
              />
              <p className="text-xs text-mid/60">
                Fotos podem ser adicionadas na aba de Fotos do paciente.
              </p>
            </div>
          </AnamnesisSection>
        </Accordion>
      </form>

      {/* ── Footer: last saved info ── */}
      {lastSaved && (
        <div className="text-xs text-mid pt-3 border-t border-petal">
          Ultima atualizacao: {formatDateTime(lastSaved)}
          {lastSavedBy && <> por {lastSavedBy}</>}
        </div>
      )}
    </div>
  )
}
