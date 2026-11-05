import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SignaturePad } from '../signature-pad'

// Stands in for signature_pad's own touchmove handler, which the mock attaches
// to the canvas the way the library does, and for its stroke data.
const libraryTouchMove = vi.fn()
let padData: unknown[][] = []

// Mock react-signature-canvas
vi.mock('react-signature-canvas', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: React.forwardRef(function MockSignatureCanvas(
      props: Record<string, unknown>,
      ref: React.Ref<unknown>
    ) {
      const canvasRef = React.useRef(null)
      React.useImperativeHandle(ref, () => ({
        clear: vi.fn(),
        isEmpty: () => true,
        toDataURL: () => 'data:image/png;base64,mock',
        fromDataURL: vi.fn(),
        getCanvas: () => canvasRef.current,
        getSignaturePad: () => ({ toData: () => padData }),
      }))
      React.useEffect(() => {
        const canvas = canvasRef.current
        canvas.addEventListener('touchmove', libraryTouchMove)
        return () => canvas.removeEventListener('touchmove', libraryTouchMove)
      }, [])
      const { canvasProps = {} } = props as { canvasProps?: Record<string, unknown> }
      return <canvas ref={canvasRef} data-testid="signature-canvas" {...canvasProps} />
    }),
  }
})

describe('SignaturePad', () => {
  beforeEach(() => {
    libraryTouchMove.mockClear()
    padData = []
  })

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

  it('keeps a touchmove with no open stroke away from the library', () => {
    render(<SignaturePad onSignatureChange={vi.fn()} />)

    fireEvent.touchMove(screen.getByTestId('signature-canvas'))

    expect(libraryTouchMove).not.toHaveBeenCalled()
  })

  it('passes touchmove through once a stroke has started', () => {
    padData = [[{ x: 1, y: 1, time: 0 }]]
    render(<SignaturePad onSignatureChange={vi.fn()} />)

    fireEvent.touchMove(screen.getByTestId('signature-canvas'))

    expect(libraryTouchMove).toHaveBeenCalledTimes(1)
  })
})
