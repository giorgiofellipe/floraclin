import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormRenderer } from '../form-renderer'
import type { FormSection } from '@/lib/forms/types'

const sections: FormSection[] = [
  {
    id: 's1',
    title: 'Medicamentos',
    order: 0,
    questions: [
      {
        id: 'meds',
        label: 'Medicamentos em uso',
        type: 'list',
        required: false,
        order: 0,
        columns: [
          { id: 'name', label: 'Nome', kind: 'text' },
          { id: 'freq', label: 'Frequência', kind: 'select', options: ['Diária', 'Semanal'] },
        ],
      },
    ],
  },
]

describe('FormRenderer list question', () => {
  it('adds a row and reports the typed cell keyed by column id (regression: list answers lost or keyed by label)', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<FormRenderer sections={sections} responses={{}} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Adicionar item' }))
    expect(onChange).toHaveBeenLastCalledWith({ meds: [{}] })

    rerender(<FormRenderer sections={sections} responses={{ meds: [{}] }} onChange={onChange} />)
    await user.type(screen.getByLabelText('Nome'), 'L')
    expect(onChange).toHaveBeenLastCalledWith({ meds: [{ name: 'L' }] })
  })

  it('removes only the chosen row (previously the remove button dropped the wrong row)', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <FormRenderer
        sections={sections}
        responses={{ meds: [{ name: 'Losartana' }, { name: 'Metformina' }] }}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Remover item 1' }))
    expect(onChange).toHaveBeenLastCalledWith({ meds: [{ name: 'Metformina' }] })
  })

  it('hides add and remove controls when readOnly (regression: approved records stayed editable)', () => {
    render(
      <FormRenderer
        sections={sections}
        responses={{ meds: [{ name: 'Losartana' }] }}
        onChange={vi.fn()}
        readOnly
      />,
    )

    expect(screen.queryByRole('button', { name: 'Adicionar item' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Remover item/ })).toBeNull()
    expect(screen.getByLabelText('Nome')).toBeDisabled()
  })

  it('renderQuestion replaces only the questions it handles (previously evaluation forms would render only the face diagram)', () => {
    render(
      <FormRenderer
        sections={sections}
        responses={{}}
        onChange={vi.fn()}
        renderQuestion={(q) => (q.id === 'meds' ? <div>custom meds</div> : undefined)}
      />,
    )

    expect(screen.getByText('custom meds')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Adicionar item' })).toBeNull()
  })

  it('flags an empty required cell in a started row when showErrors (previously the patient got no hint which cell blocked the submit)', () => {
    const required: FormSection[] = [
      {
        ...sections[0],
        questions: [
          {
            ...sections[0].questions[0],
            columns: [
              { id: 'name', label: 'Nome', kind: 'text', required: true },
              { id: 'dose', label: 'Dose', kind: 'text' },
            ],
          },
        ],
      },
    ]
    const responses = { meds: [{ dose: '50mg' }, {}] }
    const { rerender } = render(<FormRenderer sections={required} responses={responses} onChange={vi.fn()} />)
    expect(screen.queryByText('Preencha este campo')).toBeNull()

    rerender(<FormRenderer sections={required} responses={responses} onChange={vi.fn()} showErrors />)

    expect(screen.getAllByText('Preencha este campo')).toHaveLength(1)
    const [startedRowName, blankRowName] = screen.getAllByLabelText('Nome')
    expect(startedRowName).toHaveAttribute('aria-invalid', 'true')
    expect(blankRowName).not.toHaveAttribute('aria-invalid')
  })

  it('labels every cell in each row for the stacked phone layout (previously phone users saw cells with no column name)', () => {
    render(
      <FormRenderer
        sections={sections}
        responses={{ meds: [{ name: 'Losartana' }, { name: 'Metformina' }] }}
        onChange={vi.fn()}
      />,
    )

    // One header label for sm and up, plus one per row for the stacked layout.
    expect(screen.getAllByText('Nome')).toHaveLength(3)
    expect(screen.getAllByText('Frequência')).toHaveLength(3)
    expect(screen.getByText('Item 2')).toBeInTheDocument()
  })
})
