import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SignaturePad } from '../signature-pad'

const mocks = vi.hoisted(() => ({
  fromDataURL: vi.fn(),
  clear: vi.fn(),
  canvas: { width: 400, height: 176 },
}))

vi.mock('react-signature-canvas', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: React.forwardRef(function MockSignatureCanvas(
      props: Record<string, unknown>,
      ref: React.Ref<unknown>
    ) {
      React.useImperativeHandle(ref, () => ({
        clear: mocks.clear,
        isEmpty: () => true,
        toDataURL: () => 'data:image/png;base64,mock',
        fromDataURL: mocks.fromDataURL,
        getCanvas: () => mocks.canvas,
      }))
      const { canvasProps = {}, clearOnResize } = props as {
        canvasProps?: Record<string, unknown>
        clearOnResize?: boolean
      }
      return (
        <canvas
          data-testid="signature-canvas"
          data-clear-on-resize={String(clearOnResize)}
          {...canvasProps}
        />
      )
    }),
  }
})

beforeEach(() => {
  mocks.fromDataURL.mockClear()
  mocks.clear.mockClear()
  mocks.canvas.width = 400
  mocks.canvas.height = 176
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

  it('disables the library clear-on-window-resize that empties _data mid-stroke', () => {
    render(<SignaturePad onSignatureChange={vi.fn()} />)

    expect(screen.getByTestId('signature-canvas')).toHaveAttribute(
      'data-clear-on-resize',
      'false'
    )
  })

  it('does not clobber the canvas bitmap when the container has no layout yet', () => {
    render(<SignaturePad onSignatureChange={vi.fn()} />)

    expect(mocks.canvas.width).toBe(400)
    expect(mocks.canvas.height).toBe(176)
  })

  it('seeds from initialData once and ignores later parent echoes', () => {
    const { rerender } = render(
      <SignaturePad
        onSignatureChange={vi.fn()}
        initialData="data:image/png;base64,aaa"
      />
    )

    expect(mocks.fromDataURL).toHaveBeenCalledTimes(1)
    expect(mocks.fromDataURL).toHaveBeenCalledWith('data:image/png;base64,aaa')

    rerender(
      <SignaturePad
        onSignatureChange={vi.fn()}
        initialData="data:image/png;base64,bbb"
      />
    )

    expect(mocks.fromDataURL).toHaveBeenCalledTimes(1)
    expect(mocks.canvas.width).toBe(400)
  })
})
