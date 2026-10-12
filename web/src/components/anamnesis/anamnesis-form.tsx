'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import isEqual from 'fast-deep-equal'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { FormRenderer } from '@/components/forms/form-renderer'
import { formatDateTime } from '@/lib/utils'
import { carryResponses } from '@/lib/forms/carry-responses'
import { buildFormResponseSchema } from '@/lib/forms/response-schema'
import type { FormResponses } from '@/lib/forms/types'
import type { AnamnesisRecord, AnamnesisTemplate } from '@/lib/anamnesis/types'
import { AnamnesisSaveError, useUpsertAnamnesis } from '@/hooks/mutations/use-anamnesis-mutations'
import { fetchAnamnesis, fetchAnamnesisTemplate } from '@/hooks/queries/use-anamnesis'
import { queryKeys } from '@/hooks/queries/query-keys'
import type { WizardOverrides } from '@/components/service-wizard/types'

export interface AnamnesisFormProps {
  patientId: string
  currentTemplate: AnamnesisTemplate
  record?: AnamnesisRecord | null
  updatedByName?: string
  wizardOverrides?: WizardOverrides
  readOnly?: boolean
  publicMode?: boolean
  onPublicSubmit?: (payload: { templateVersion: number; responses: FormResponses }) => Promise<void>
}

type SaveOutcome = 'ok' | 'conflict' | 'error'

interface QueuedSave {
  applyCurrentTemplate: boolean
  waiters: Array<(ok: boolean) => void>
}

const AUTOSAVE_DELAY_MS = 1000
const STALE_RELOADED_MESSAGE = 'Outro usuário alterou esta anamnese. Os dados foram atualizados.'

export function AnamnesisForm({
  patientId,
  currentTemplate,
  record,
  updatedByName,
  wizardOverrides,
  readOnly = false,
  publicMode = false,
  onPublicSubmit,
}: AnamnesisFormProps) {
  const upsert = useUpsertAnamnesis()
  const queryClient = useQueryClient()

  const [template, setTemplate] = useState<AnamnesisTemplate>(() =>
    record ? { version: record.templateVersion, sections: record.templateSnapshot } : currentTemplate,
  )
  const [responses, setResponses] = useState<FormResponses>(() => record?.responses ?? {})
  const [rowExists, setRowExists] = useState(!!record)
  const [errorScrollRequest, setErrorScrollRequest] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)
  const [lastSaved, setLastSaved] = useState<Date | null>(record ? new Date(record.updatedAt) : null)
  const [lastSavedBy, setLastSavedBy] = useState<string | null>(updatedByName ?? null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [isPublicSubmitting, setIsPublicSubmitting] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  const templateRef = useRef(template)
  const responsesRef = useRef(responses)
  const rowExistsRef = useRef(!!record)
  const expectedUpdatedAtRef = useRef<string | undefined>(
    record ? new Date(record.updatedAt).toISOString() : undefined,
  )
  const currentTemplateRef = useRef(currentTemplate)
  currentTemplateRef.current = currentTemplate
  const wizardOverridesRef = useRef(wizardOverrides)
  wizardOverridesRef.current = wizardOverrides

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  const queuedRef = useRef<QueuedSave | null>(null)
  const dirtyRef = useRef(false)
  // Bumped on every edit: a save only clears the dirty flag if no edit landed while it ran.
  const dirtyEpochRef = useRef(0)
  const mutateRef = useRef(upsert.mutateAsync)
  mutateRef.current = upsert.mutateAsync

  const isPending = publicMode ? isPublicSubmitting : isSaving

  function adoptTemplate(next: AnamnesisTemplate) {
    templateRef.current = next
    setTemplate(next)
  }

  function adoptResponses(next: FormResponses) {
    responsesRef.current = next
    setResponses(next)
  }

  function adoptRow(updatedAt: string | undefined) {
    rowExistsRef.current = updatedAt !== undefined
    setRowExists(updatedAt !== undefined)
    expectedUpdatedAtRef.current = updatedAt
  }

  function setDirty(value: boolean) {
    dirtyRef.current = value
    setHasUnsavedChanges(value)
  }

  function clearDebounce() {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
  }

  function markDirtyAndSchedule() {
    dirtyEpochRef.current += 1
    setDirty(true)
    clearDebounce()
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void enqueueSave(false)
    }, AUTOSAVE_DELAY_MS)
  }

  async function reloadFromServer() {
    try {
      const [serverRecord, serverTemplate] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: queryKeys.anamnesis(patientId),
          queryFn: () => fetchAnamnesis(patientId),
          staleTime: 0,
        }),
        queryClient.fetchQuery({
          queryKey: queryKeys.anamnesisTemplate,
          queryFn: fetchAnamnesisTemplate,
          staleTime: 0,
        }),
      ])
      if (serverRecord) {
        clearDebounce()
        adoptTemplate({ version: serverRecord.templateVersion, sections: serverRecord.templateSnapshot })
        adoptResponses(serverRecord.responses)
        adoptRow(new Date(serverRecord.updatedAt).toISOString())
        setLastSaved(new Date(serverRecord.updatedAt))
        setLastSavedBy(null)
        setDirty(false)
      } else {
        const carried = carryResponses(responsesRef.current, serverTemplate.sections)
        adoptTemplate(serverTemplate)
        adoptResponses(carried)
        adoptRow(undefined)
        if (dirtyRef.current && Object.keys(carried).length > 0) markDirtyAndSchedule()
        else setDirty(false)
      }
    } catch {
      // The conflict toast already told the user.
    }
  }

  async function performSave(applyCurrentTemplate: boolean): Promise<SaveOutcome> {
    const epochAtStart = dirtyEpochRef.current
    const current = currentTemplateRef.current
    const sent = applyCurrentTemplate
      ? carryResponses(responsesRef.current, current.sections)
      : responsesRef.current
    try {
      const result = await mutateRef.current({
        patientId,
        templateVersion: applyCurrentTemplate ? current.version : templateRef.current.version,
        responses: sent,
        expectedUpdatedAt: expectedUpdatedAtRef.current,
        ...(rowExistsRef.current ? {} : { expectNoRow: true }),
        ...(applyCurrentTemplate ? { applyCurrentTemplate: true } : {}),
      })
      const { updatedAt, templateVersion, templateSnapshot } = result.data
      const savedAt = new Date(updatedAt)
      adoptRow(updatedAt)
      adoptTemplate({ version: templateVersion, sections: templateSnapshot })
      setLastSaved(savedAt)
      setLastSavedBy(null)
      if (applyCurrentTemplate) {
        const carried = carryResponses(responsesRef.current, templateSnapshot)
        adoptResponses(carried)
        if (!isEqual(carried, sent)) {
          markDirtyAndSchedule()
        } else if (dirtyEpochRef.current === epochAtStart) {
          setDirty(false)
        }
      } else if (dirtyEpochRef.current === epochAtStart) {
        setDirty(false)
      }
      wizardOverridesRef.current?.onAutoSaved?.(savedAt)
      return 'ok'
    } catch (err) {
      if (err instanceof AnamnesisSaveError && err.status === 409) {
        toast.error(err.code === 'stale' ? STALE_RELOADED_MESSAGE : err.message)
        await reloadFromServer()
        return 'conflict'
      }
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar anamnese')
      return 'error'
    }
  }

  async function drainQueue() {
    inFlightRef.current = true
    setIsSaving(true)
    try {
      while (queuedRef.current) {
        const job = queuedRef.current
        queuedRef.current = null
        const outcome = await performSave(job.applyCurrentTemplate)
        job.waiters.forEach((resolve) => resolve(outcome === 'ok'))
        if (outcome === 'conflict' && queuedRef.current) {
          const dropped: QueuedSave = queuedRef.current
          queuedRef.current = null
          dropped.waiters.forEach((resolve) => resolve(false))
        }
      }
    } finally {
      inFlightRef.current = false
      setIsSaving(false)
    }
  }

  function enqueueSave(applyCurrentTemplate: boolean): Promise<boolean> {
    return new Promise((resolve) => {
      const job = queuedRef.current ?? (queuedRef.current = { applyCurrentTemplate: false, waiters: [] })
      job.applyCurrentTemplate = job.applyCurrentTemplate || applyCurrentTemplate
      job.waiters.push(resolve)
      if (!inFlightRef.current) void drainQueue()
    })
  }

  function handleChange(next: Record<string, unknown>) {
    adoptResponses(next as FormResponses)
    if (publicMode || readOnly) return
    wizardOverridesRef.current?.onUserEdit?.()
    markDirtyAndSchedule()
  }

  async function handleApplyCurrent() {
    setIsApplying(true)
    try {
      clearDebounce()
      await enqueueSave(true)
    } finally {
      setIsApplying(false)
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (readOnly) return
    if (publicMode) {
      const parsed = buildFormResponseSchema(template.sections, { enforceRequired: true }).safeParse(responses)
      if (!parsed.success) {
        setShowErrors(true)
        setErrorScrollRequest((n) => n + 1)
        toast.error('Preencha os campos obrigatórios.')
        return
      }
      if (!onPublicSubmit) return
      setIsPublicSubmitting(true)
      try {
        await onPublicSubmit({ templateVersion: template.version, responses: parsed.data as FormResponses })
      } finally {
        setIsPublicSubmitting(false)
      }
      return
    }
    clearDebounce()
    await enqueueSave(false)
  }

  useEffect(() => {
    if (errorScrollRequest === 0) return
    formRef.current?.querySelector('[aria-invalid="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [errorScrollRequest])

  useEffect(() => {
    wizardOverridesRef.current?.onDirtyChange?.(hasUnsavedChanges)
  }, [hasUnsavedChanges])

  const triggerSave = wizardOverrides?.triggerSave ?? 0
  const prevTriggerSaveRef = useRef(triggerSave)
  useEffect(() => {
    if (publicMode) return
    // The wizard resets triggerSave to 0 after SAVE_COMPLETE, so the next press (also 1) is not a duplicate.
    if (triggerSave === 0) {
      prevTriggerSaveRef.current = 0
      return
    }
    if (triggerSave === prevTriggerSaveRef.current) return
    prevTriggerSaveRef.current = triggerSave
    if (readOnly) {
      wizardOverridesRef.current?.onSaveComplete?.({ success: true })
      return
    }
    clearDebounce()
    void enqueueSave(false).then((ok) => {
      wizardOverridesRef.current?.onSaveComplete?.(
        ok ? { success: true } : { success: false, error: 'Erro ao salvar anamnese', errorType: 'server' },
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerSave])

  useEffect(() => clearDebounce, [])

  const showBanner =
    !publicMode && !readOnly && rowExists && !isEqual(template.sections, currentTemplate.sections)

  return (
    <div className="space-y-5">
      {!wizardOverrides?.hideTitle && (
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-charcoal">Anamnese</h2>
          {!publicMode && (
            <div className="flex items-center gap-3">
              {isPending && (
                <div className="flex items-center gap-1.5 text-xs text-sage">
                  <Loader2 className="size-3 animate-spin" />
                  Salvando...
                </div>
              )}
              {lastSaved && !isPending && (
                <span className="text-xs text-mid/60">Salvo {formatDateTime(lastSaved)}</span>
              )}
            </div>
          )}
        </div>
      )}

      {showBanner && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-mid bg-amber-light px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-amber-dark">O modelo de anamnese mudou. Usar o modelo atual?</p>
            <p className="text-xs text-amber-dark">Respostas de perguntas removidas serão descartadas.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isApplying}
            onClick={handleApplyCurrent}
          >
            {isApplying ? 'Aplicando...' : 'Usar modelo atual'}
          </Button>
        </div>
      )}

      <form ref={formRef} onSubmit={handleSubmit}>
        <FormRenderer
          sections={template.sections}
          responses={responses}
          onChange={handleChange}
          readOnly={readOnly}
          showErrors={showErrors}
        />

        {publicMode ? (
          <div className="mt-4 flex justify-center border-t border-petal pt-6">
            <Button
              type="submit"
              disabled={isPending}
              className="bg-forest px-8 py-2.5 text-base text-cream transition-colors hover:bg-sage"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                'Enviar'
              )}
            </Button>
          </div>
        ) : readOnly ? null : (
          <div className="mt-4 flex items-center justify-between border-t border-petal pt-4">
            <div className="flex items-center gap-2">
              {isPending ? (
                <div className="flex items-center gap-1.5 text-sm text-sage">
                  <Loader2 className="size-3.5 animate-spin" />
                  Salvando...
                </div>
              ) : lastSaved ? (
                <span className="text-sm text-mid">
                  Última atualização: {formatDateTime(lastSaved)}
                  {lastSavedBy && <> por {lastSavedBy}</>}
                </span>
              ) : null}
            </div>
            <Button
              type="submit"
              disabled={isPending}
              className="bg-forest text-cream transition-colors hover:bg-sage"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Salvar'
              )}
            </Button>
          </div>
        )}
      </form>
    </div>
  )
}
