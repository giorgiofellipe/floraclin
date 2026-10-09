import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import type { CalendarBlockRow } from '@/db/queries/calendar'
import { CalendarBlockMenu } from '../calendar-block-menu'
import { canDeleteBlock } from '@/lib/calendar-blocks'

const USER_ID = 'user-1'

function makeBlock(overrides: Partial<CalendarBlockRow> = {}): CalendarBlockRow {
  return {
    id: 'b1',
    tenantId: 't1',
    practitionerId: USER_ID,
    practitionerName: 'Dra. Ana',
    source: 'manual',
    title: null,
    date: '2026-10-12',
    startTime: '08:00:00',
    endTime: '09:00:00',
    allDay: false,
    status: 'confirmed',
    ...overrides,
  }
}

describe('canDeleteBlock', () => {
  // Google blocks come back on the next sync, so the UI must never offer delete.
  it('never allows deleting a Google block', () => {
    const block = makeBlock({ source: 'google' })
    expect(canDeleteBlock(block, 'owner', USER_ID)).toBe(false)
    expect(canDeleteBlock(block, 'practitioner', USER_ID)).toBe(false)
  })

  // Clinic-wide blocks are owner only, matching the route.
  it('allows only the owner to delete a clinic-wide block', () => {
    const block = makeBlock({ practitionerId: null, practitionerName: null })
    expect(canDeleteBlock(block, 'owner', USER_ID)).toBe(true)
    expect(canDeleteBlock(block, 'practitioner', USER_ID)).toBe(false)
  })

  // A practitioner may only remove blocks on their own agenda.
  it('limits a practitioner to their own blocks', () => {
    expect(canDeleteBlock(makeBlock(), 'practitioner', USER_ID)).toBe(true)
    expect(canDeleteBlock(makeBlock({ practitionerId: 'user-2' }), 'practitioner', USER_ID)).toBe(false)
    expect(canDeleteBlock(makeBlock({ practitionerId: 'user-2' }), 'owner', USER_ID)).toBe(true)
  })

  it('never allows receptionist or financial', () => {
    expect(canDeleteBlock(makeBlock(), 'receptionist', USER_ID)).toBe(false)
    expect(canDeleteBlock(makeBlock(), 'financial', USER_ID)).toBe(false)
  })
})

function renderMenu(block: CalendarBlockRow, canDelete: boolean) {
  return render(
    <CalendarBlockMenu
      block={block}
      position={{ x: 10, y: 10 }}
      canDelete={canDelete}
      onDelete={vi.fn()}
      menuRef={createRef<HTMLDivElement>()}
    />,
  )
}

describe('CalendarBlockMenu', () => {
  it('shows the sync notice and no button for a Google block', () => {
    renderMenu(makeBlock({ source: 'google', title: 'Segredo' }), false)
    expect(screen.getByText('Sincronizado do Google Agenda')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    // Privacy: the Google event title is never exposed.
    expect(screen.queryByText('Segredo')).not.toBeInTheDocument()
    expect(screen.getByText('Indisponível')).toBeInTheDocument()
  })

  it('hides the remove button when the user cannot delete', () => {
    renderMenu(makeBlock(), false)
    expect(screen.queryByRole('button', { name: /remover bloqueio/i })).not.toBeInTheDocument()
  })

  it('shows the remove button when the user can delete', () => {
    renderMenu(makeBlock(), true)
    expect(screen.getByRole('button', { name: /remover bloqueio/i })).toBeInTheDocument()
  })

  it('shows the manual title and the clinic label for a clinic-wide block', () => {
    renderMenu(makeBlock({ title: 'Feriado', practitionerId: null, practitionerName: null }), true)
    expect(screen.getByText('Feriado')).toBeInTheDocument()
    expect(screen.getByText(/Toda a clínica/)).toBeInTheDocument()
  })
})
