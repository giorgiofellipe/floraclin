import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { PatientSectionNav } from '../patient-section-nav'

describe('PatientSectionNav', () => {
  it('hides Evoluções from receptionist', () => {
    render(<PatientSectionNav active="resumo" role="receptionist" onChange={vi.fn()} />)
    expect(screen.queryByText('Evoluções')).toBeNull()
  })

  it('desktop menu item calls onChange with its key', () => {
    const onChange = vi.fn()
    render(<PatientSectionNav active="resumo" role="owner" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Diagramas faciais' }))
    expect(onChange).toHaveBeenCalledWith('diagramas')
  })

  it('phone Outros opens a sheet with one button per section and selects one', () => {
    const onChange = vi.fn()
    render(<PatientSectionNav active="resumo" role="owner" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Outros' }))
    const sheet = screen.getByRole('dialog')
    for (const label of ['Termos', 'Documentos', 'Dados', 'Histórico']) {
      expect(within(sheet).getByRole('button', { name: label })).toBeTruthy()
    }
    fireEvent.click(within(sheet).getByRole('button', { name: 'Histórico' }))
    expect(onChange).toHaveBeenCalledWith('historico')
  })

  it('phone Resumo calls onChange resumo', () => {
    const onChange = vi.fn()
    render(<PatientSectionNav active="dados" role="owner" onChange={onChange} />)
    const buttons = screen.getAllByRole('button', { name: 'Resumo' })
    fireEvent.click(buttons[buttons.length - 1])
    expect(onChange).toHaveBeenCalledWith('resumo')
  })
})
