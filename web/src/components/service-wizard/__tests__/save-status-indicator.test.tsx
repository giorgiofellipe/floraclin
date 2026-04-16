import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SaveStatusIndicator } from '../save-status-indicator'

describe('SaveStatusIndicator', () => {
  const now = new Date('2026-04-14T12:00:00Z')

  it('renders nothing when empty', () => {
    const { container } = render(
      <SaveStatusIndicator isSaving={false} isDirty={false} lastSavedAt={null} errorType={null} now={now} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows "Salvando..." when saving (highest priority)', () => {
    render(<SaveStatusIndicator isSaving={true} isDirty={true} lastSavedAt={new Date('2026-04-14T11:58:00Z')} errorType="server" now={now} />)
    expect(screen.getByTestId('save-status-indicator')).toHaveTextContent('Salvando...')
  })

  it('shows "Erro ao salvar" for errorType server', () => {
    render(<SaveStatusIndicator isSaving={false} isDirty={true} lastSavedAt={null} errorType="server" now={now} />)
    expect(screen.getByTestId('save-status-indicator')).toHaveTextContent('Erro ao salvar')
  })

  it('shows "Alterações não salvas" when dirty', () => {
    render(<SaveStatusIndicator isSaving={false} isDirty={true} lastSavedAt={null} errorType={null} now={now} />)
    expect(screen.getByTestId('save-status-indicator')).toHaveTextContent('Alterações não salvas')
  })

  it('shows "Salvo há 2min" for saved 2 min ago', () => {
    render(<SaveStatusIndicator isSaving={false} isDirty={false} lastSavedAt={new Date('2026-04-14T11:58:00Z')} errorType={null} now={now} />)
    expect(screen.getByTestId('save-status-indicator')).toHaveTextContent('Salvo há 2min')
  })

  it('shows "Salvo agora" for saved <1 min ago', () => {
    render(<SaveStatusIndicator isSaving={false} isDirty={false} lastSavedAt={new Date('2026-04-14T11:59:40Z')} errorType={null} now={now} />)
    expect(screen.getByTestId('save-status-indicator')).toHaveTextContent('Salvo agora')
  })

  it('dirty wins over saved', () => {
    render(<SaveStatusIndicator isSaving={false} isDirty={true} lastSavedAt={new Date('2026-04-14T11:58:00Z')} errorType={null} now={now} />)
    const el = screen.getByTestId('save-status-indicator')
    expect(el).toHaveTextContent('Alterações não salvas')
    expect(el).not.toHaveTextContent('Salvo há')
  })
})
