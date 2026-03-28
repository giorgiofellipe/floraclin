import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SignaturePad } from '../signature-pad'

// Mock react-signature-canvas
vi.mock('react-signature-canvas', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: React.forwardRef(function MockSignatureCanvas(
      props: Record<string, unknown>,
      ref: React.Ref<unknown>
    ) {
      React.useImperativeHandle(ref, () => ({
        clear: vi.fn(),
        isEmpty: () => true,
        toDataURL: () => 'data:image/png;base64,mock',
        fromDataURL: vi.fn(),
        getCanvas: () => ({ width: 400, height: 200 }),
      }))
      const { canvasProps = {} } = props as { canvasProps?: Record<string, unknown> }
      return <canvas data-testid="signature-canvas" {...canvasProps} />
    }),
  }
})

describe('SignaturePad', () => {
  it('renders canvas area', () => {
    render(<SignaturePad onSignatureChange={vi.fn()} />)

    expect(screen.getByTestId('signature-canvas')).toBeInTheDocument()
  })

  it('shows "Assinar aqui" placeholder text', () => {
    render(<SignaturePad onSignatureChange={vi.fn()} />)

    expect(screen.getByText('Assinar aqui')).toBeInTheDocument()
  })

  it('clear button exists', () => {
    render(<SignaturePad onSignatureChange={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: /limpar assinatura/i })
    ).toBeInTheDocument()
  })
})
