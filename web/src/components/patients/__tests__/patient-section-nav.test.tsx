import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
})
