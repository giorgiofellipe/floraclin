import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderWithProviders, screen, waitFor, createTestQueryClient } from '@/tests/test-utils'
import userEvent from '@testing-library/user-event'
import type { FormSection } from '@/lib/forms/types'
import type { AnamnesisRecord, AnamnesisTemplate } from '@/lib/anamnesis/types'

const mutateAsync = vi.fn()
const fetchAnamnesis = vi.fn()
const fetchAnamnesisTemplate = vi.fn()

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

vi.mock('@/hooks/mutations/use-anamnesis-mutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/mutations/use-anamnesis-mutations')>()
  return { ...actual, useUpsertAnamnesis: () => ({ mutateAsync, isPending: false }) }
})

vi.mock('@/hooks/queries/use-anamnesis', () => ({
  fetchAnamnesis: (...args: unknown[]) => fetchAnamnesis(...args),
  fetchAnamnesisTemplate: (...args: unknown[]) => fetchAnamnesisTemplate(...args),
}))

import { AnamnesisForm } from '../anamnesis-form'
import { AnamnesisSaveError } from '@/hooks/mutations/use-anamnesis-mutations'
import { STALE_ANAMNESIS_MESSAGE } from '@/lib/anamnesis/prepare-save'
import { toast } from 'sonner'

function sections(label = 'Fuma?'): FormSection[] {
  return [
    {
      id: 's1',
      title: 'Geral',
      order: 0,
      questions: [
        { id: 'q1', label, type: 'radio', required: false, order: 0, options: ['Sim', 'Não'] },
        { id: 'q2', label: 'Observações', type: 'text', required: true, order: 1 },
      ],
    },
  ]
}

function record(overrides: Partial<AnamnesisRecord> = {}): AnamnesisRecord {
  return {
    id: 'a1',
    patientId: 'p1',
    templateVersion: 1,
    templateSnapshot: sections(),
    responses: {},
    updatedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T09:00:00.000Z',
    ...overrides,
  }
}

function saved(updatedAt: string, template: AnamnesisTemplate = { version: 1, sections: sections() }) {
  return {
    success: true,
    data: {
      id: 'a1',
      updatedAt,
      updatedBy: null,
      templateVersion: template.version,
      templateSnapshot: template.sections,
    },
  }
}

const current: AnamnesisTemplate = { version: 1, sections: sections() }
const changed: AnamnesisTemplate = { version: 2, sections: sections('Fuma atualmente?') }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(ui: React.ReactElement, queryClient = createTestQueryClient()) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const view = renderWithProviders(ui, { queryClient })
  return { user, ...view }
}

async function flushAutosave() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  // Testing Library only drives fake timers inside waitFor when it sees a `jest` global.
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) })
  // jsdom has no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn()
  mutateAsync.mockReset()
  fetchAnamnesis.mockReset()
  fetchAnamnesisTemplate.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('AnamnesisForm', () => {
  it('renders the record snapshot (previously old answers showed against the current template questions)', () => {
    setup(
      <AnamnesisForm
        patientId="p1"
        currentTemplate={changed}
        record={record()}
      />,
    )
    expect(screen.getByText('Fuma?')).toBeInTheDocument()
    expect(screen.queryByText('Fuma atualmente?')).not.toBeInTheDocument()
  })

  it('hides the banner when only jsonb key order differs (previously key order alone showed it), shows it when a question differs', () => {
    const reordered: FormSection[] = JSON.parse(JSON.stringify(sections())).map((s: FormSection) => ({
      questions: s.questions.map((q) => Object.fromEntries(Object.entries(q).reverse())),
      order: s.order,
      title: s.title,
      id: s.id,
    }))
    const { unmount } = setup(
      <AnamnesisForm
        patientId="p1"
        currentTemplate={{ version: 1, sections: reordered }}
        record={record()}
      />,
    )
    expect(screen.queryByText(/O modelo de anamnese mudou/)).not.toBeInTheDocument()
    unmount()

    setup(<AnamnesisForm patientId="p1" currentTemplate={changed} record={record()} />)
    expect(screen.getByText('O modelo de anamnese mudou. Usar o modelo atual?')).toBeInTheDocument()
  })

  it('second autosave sends the first save updatedAt as expectedUpdatedAt (previously every second autosave got a 409)', async () => {
    mutateAsync.mockResolvedValueOnce(saved('2026-01-01T10:00:00.000Z')).mockResolvedValueOnce(saved('2026-01-01T11:00:00.000Z'))
    const { user } = setup(<AnamnesisForm patientId="p1" currentTemplate={current} record={record()} />)

    await user.click(screen.getByRole('button', { name: 'Sim' }))
    await flushAutosave()
    await user.click(screen.getByRole('button', { name: 'Não' }))
    await flushAutosave()

    expect(mutateAsync).toHaveBeenCalledTimes(2)
    expect(mutateAsync.mock.calls[0][0].expectedUpdatedAt).toBe('2026-01-01T09:00:00.000Z')
    expect(mutateAsync.mock.calls[1][0].expectedUpdatedAt).toBe('2026-01-01T10:00:00.000Z')
    expect(mutateAsync.mock.calls[1][0].responses).toEqual({ q1: 'Não' })
  })

  it('new patient sends expectNoRow only on the first save (previously the next autosave conflicted with the row it had just created)', async () => {
    const adopted: AnamnesisTemplate = { version: 5, sections: sections('Fuma (v5)?') }
    mutateAsync.mockResolvedValueOnce(saved('2026-01-01T10:00:00.000Z', adopted)).mockResolvedValueOnce(saved('2026-01-01T11:00:00.000Z', adopted))
    const { user } = setup(<AnamnesisForm patientId="p1" currentTemplate={current} record={null} />)

    await user.click(screen.getByRole('button', { name: 'Sim' }))
    await flushAutosave()
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({ expectNoRow: true, templateVersion: 1 })
    expect(mutateAsync.mock.calls[0][0].expectedUpdatedAt).toBeUndefined()

    await user.click(screen.getByRole('button', { name: 'Não' }))
    await flushAutosave()
    expect(mutateAsync.mock.calls[1][0].expectNoRow).toBeUndefined()
    expect(mutateAsync.mock.calls[1][0].templateVersion).toBe(5)
    expect(screen.getByText('Fuma (v5)?')).toBeInTheDocument()
  })

  it('queues the banner action behind an in-flight autosave (previously both saves raced into a 409 loop)', async () => {
    const first = deferred<ReturnType<typeof saved>>()
    mutateAsync.mockReturnValueOnce(first.promise).mockResolvedValueOnce(saved('2026-01-01T11:00:00.000Z', changed))
    const { user } = setup(<AnamnesisForm patientId="p1" currentTemplate={changed} record={record()} />)

    await user.click(screen.getByRole('button', { name: 'Sim' }))
    await flushAutosave()
    expect(mutateAsync).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Usar modelo atual' }))
    expect(mutateAsync).toHaveBeenCalledTimes(1)

    await act(async () => {
      first.resolve(saved('2026-01-01T10:00:00.000Z'))
    })
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2))
    expect(mutateAsync.mock.calls[1][0]).toMatchObject({
      applyCurrentTemplate: true,
      templateVersion: 2,
      expectedUpdatedAt: '2026-01-01T10:00:00.000Z',
    })
    await waitFor(() => expect(screen.queryByText(/O modelo de anamnese mudou/)).not.toBeInTheDocument())
    expect(screen.getByText('Fuma atualmente?')).toBeInTheDocument()

    await flushAutosave()
    expect(mutateAsync).toHaveBeenCalledTimes(2)
  })

  it('a rejected banner save keeps the old questions while the reload runs (previously the new questions showed before the server accepted them)', async () => {
    mutateAsync.mockRejectedValueOnce(new AnamnesisSaveError('O modelo mudou', 409, 'template_changed'))
    fetchAnamnesis.mockReturnValue(new Promise(() => {}))
    fetchAnamnesisTemplate.mockReturnValue(new Promise(() => {}))
    const { user } = setup(<AnamnesisForm patientId="p1" currentTemplate={changed} record={record()} />)

    await user.click(screen.getByRole('button', { name: 'Usar modelo atual' }))

    await waitFor(() => expect(fetchAnamnesis).toHaveBeenCalledWith('p1'))
    expect(fetchAnamnesisTemplate).toHaveBeenCalled()
    expect(screen.getByText('Fuma?')).toBeInTheDocument()
    expect(screen.queryByText('Fuma atualmente?')).not.toBeInTheDocument()
  })

  it('new patient retries the autosave after a template_changed reload (previously the carried answers stayed unsaved)', async () => {
    mutateAsync
      .mockRejectedValueOnce(new AnamnesisSaveError('O modelo mudou', 409, 'template_changed'))
      .mockResolvedValueOnce(saved('2026-01-01T10:00:00.000Z', changed))
    fetchAnamnesis.mockResolvedValue(null)
    fetchAnamnesisTemplate.mockResolvedValue(changed)
    const { user } = setup(<AnamnesisForm patientId="p1" currentTemplate={current} record={null} />)

    await user.click(screen.getByRole('button', { name: 'Sim' }))
    await flushAutosave()
    await waitFor(() => expect(screen.getByText('Fuma atualmente?')).toBeInTheDocument())
    await flushAutosave()

    expect(mutateAsync).toHaveBeenCalledTimes(2)
    expect(mutateAsync.mock.calls[1][0]).toMatchObject({ templateVersion: 2, expectNoRow: true, responses: { q1: 'Sim' } })
  })

  it('new patient clears the unsaved flag when the reload carries no answers (previously the wizard stayed "unsaved" with nothing to save)', async () => {
    const replaced: AnamnesisTemplate = {
      version: 2,
      sections: [{ id: 's1', title: 'Geral', order: 0, questions: [{ id: 'q9', label: 'Alergias?', type: 'text', required: false, order: 0 }] }],
    }
    mutateAsync.mockRejectedValueOnce(new AnamnesisSaveError('O modelo mudou', 409, 'template_changed'))
    fetchAnamnesis.mockResolvedValue(null)
    fetchAnamnesisTemplate.mockResolvedValue(replaced)
    const onDirtyChange = vi.fn()
    const { user } = setup(
      <AnamnesisForm patientId="p1" currentTemplate={current} record={null} wizardOverrides={{ hideSaveButton: false, hideNavigation: false, hideTitle: false, onDirtyChange }} />,
    )

    await user.click(screen.getByRole('button', { name: 'Sim' }))
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    await flushAutosave()
    await waitFor(() => expect(screen.getByText('Alergias?')).toBeInTheDocument())

    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    await flushAutosave()
    expect(mutateAsync).toHaveBeenCalledTimes(1)
  })

  it('readOnly completes triggerSave without a request (previously a read-only step could send a save or leave the wizard waiting)', async () => {
    const onSaveComplete = vi.fn()
    const overrides = { hideSaveButton: true, hideNavigation: true, hideTitle: true, onSaveComplete }
    const { rerender } = setup(
      <AnamnesisForm patientId="p1" currentTemplate={changed} record={record()} readOnly wizardOverrides={overrides} />,
    )
    expect(screen.getByRole('button', { name: 'Sim' })).toBeDisabled()
    expect(screen.queryByText(/O modelo de anamnese mudou/)).not.toBeInTheDocument()

    rerender(
      <AnamnesisForm patientId="p1" currentTemplate={changed} record={record()} readOnly wizardOverrides={{ ...overrides, triggerSave: 1 }} />,
    )
    await waitFor(() => expect(onSaveComplete).toHaveBeenCalledWith({ success: true }))
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('public mode blocks an empty required question (previously the public link submitted without required answers)', async () => {
    const onPublicSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = setup(
      <AnamnesisForm patientId="p1" currentTemplate={current} publicMode onPublicSubmit={onPublicSubmit} />,
    )

    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(onPublicSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Campo obrigatório')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox'), 'Nada')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(onPublicSubmit).toHaveBeenCalledTimes(1))
    expect(onPublicSubmit).toHaveBeenCalledWith({ templateVersion: 1, responses: { q2: 'Nada' } })
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('public mode scrolls to the first missing required question (previously a phone user saw only the toast at the bottom)', async () => {
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    const { user } = setup(<AnamnesisForm patientId="p1" currentTemplate={current} publicMode onPublicSubmit={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect(scrollIntoView.mock.contexts[0]).toHaveTextContent('Observações')
  })

  it('a stale autosave says the data was refreshed (previously it told the user to reload a form that had already reloaded)', async () => {
    mutateAsync.mockRejectedValueOnce(new AnamnesisSaveError(STALE_ANAMNESIS_MESSAGE, 409, 'stale'))
    fetchAnamnesis.mockResolvedValue(record({ updatedAt: '2026-01-01T09:30:00.000Z' }))
    fetchAnamnesisTemplate.mockResolvedValue(current)
    const { user } = setup(<AnamnesisForm patientId="p1" currentTemplate={current} record={record()} />)

    await user.click(screen.getByRole('button', { name: 'Sim' }))
    await flushAutosave()

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Outro usuário alterou esta anamnese. Os dados foram atualizados.'))
  })

  it('triggerSave reports a failed save (previously the wizard got success and moved past an unsaved anamnesis)', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('boom'))
    const onSaveComplete = vi.fn()
    const overrides = { hideSaveButton: true, hideNavigation: true, hideTitle: true, onSaveComplete }
    const { rerender } = setup(
      <AnamnesisForm patientId="p1" currentTemplate={current} record={record()} wizardOverrides={overrides} />,
    )

    rerender(
      <AnamnesisForm patientId="p1" currentTemplate={current} record={record()} wizardOverrides={{ ...overrides, triggerSave: 1 }} />,
    )

    await waitFor(() =>
      expect(onSaveComplete).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao salvar anamnese',
        errorType: 'server',
      }),
    )
  })
})
