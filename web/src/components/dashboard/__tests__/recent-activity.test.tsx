import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RecentActivity } from '../recent-activity'
import type { RecentActivityEntry } from '@/db/queries/dashboard'

function entry(action: string, entityType: string, id = action + entityType): RecentActivityEntry {
  return { id, userId: 'u1', userName: 'Dra. Ana', action, entityType, entityId: null, createdAt: new Date() }
}

describe('RecentActivity', () => {
  // Regression: rows read "atualizou um(a) parcela" and raw table names such as "expense".
  it('writes each action as a phrase with the right article', () => {
    render(<RecentActivity activity={[entry('update', 'installments'), entry('create', 'patient'), entry('login', 'user')]} />)

    expect(screen.getByText('atualizou uma parcela')).toBeInTheDocument()
    expect(screen.getByText('criou um paciente')).toBeInTheDocument()
    expect(screen.getByText('entrou no sistema')).toBeInTheDocument()
  })

  it('leaves out entries it cannot describe, and renders nothing when none are left', () => {
    const { container } = render(<RecentActivity activity={[entry('update', 'whatsapp_template'), entry('archive', 'patient')]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
