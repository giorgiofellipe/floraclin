import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Table, TableBody, TableCell, TableRow } from '../table'

// A 500px-wide scroller showing x 0–500, with the action at x 480–560.
function renderClippedAction({ keyboard }: { keyboard: boolean }) {
  render(
    <Table>
      <TableBody>
        <TableRow>
          <TableCell>
            <button type="button">Conciliar</button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  )
  const button = screen.getByRole('button', { name: 'Conciliar' })
  const container = button.closest('[data-slot="table-container"]') as HTMLDivElement
  Object.defineProperty(container, 'scrollWidth', { value: 700 })
  Object.defineProperty(container, 'clientWidth', { value: 500 })
  container.getBoundingClientRect = () => ({ left: 0, right: 500, top: 0, bottom: 100, width: 500, height: 100, x: 0, y: 0, toJSON: () => ({}) })
  button.getBoundingClientRect = () => ({ left: 480, right: 560, top: 10, bottom: 40, width: 80, height: 30, x: 480, y: 10, toJSON: () => ({}) })
  const matches = button.matches.bind(button)
  vi.spyOn(button, 'matches').mockImplementation((selector) => (selector === ':focus-visible' ? keyboard : matches(selector)))
  return { button, container }
}

describe('Table', () => {
  it('scrolls a keyboard-focused control fully into view inside the table', () => {
    const { button, container } = renderClippedAction({ keyboard: true })
    button.focus()
    // Right edge 560 must sit at 500 - 16.
    expect(container.scrollLeft).toBe(76)
  })

  it('leaves the scroll alone when focus comes from a click', () => {
    const { button, container } = renderClippedAction({ keyboard: false })
    button.focus()
    expect(container.scrollLeft).toBe(0)
  })
})
