import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IconPicker } from '../icon-picker'

describe('IconPicker', () => {
  it('renders 28 icon buttons', () => {
    render(<IconPicker value="circle" onChange={vi.fn()} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(28)
  })

  it('marks the selected icon', () => {
    render(<IconPicker value="home" onChange={vi.fn()} />)
    const selected = screen.getByRole('button', { name: 'Aluguel' })
    expect(selected).toHaveAttribute('data-selected', 'true')
  })

  it('calls onChange when an icon is clicked', async () => {
    const onChange = vi.fn()
    render(<IconPicker value="circle" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Injetáveis' }))
    expect(onChange).toHaveBeenCalledWith('syringe')
  })

  it('shows tooltip labels via title attribute', () => {
    render(<IconPicker value="circle" onChange={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Aluguel' })
    expect(button).toHaveAttribute('title', 'Aluguel')
  })
})
