import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SignaturePad } from '../signature-pad'

const { padSpies } = vi.hoisted(() => {
  const canvas = { width: 400, height: 176 }
  const padSpies = {
    canvas,
    lastProps: {} as Record<string, unknown>,
    clear: vi.fn(),
    isEmpty: vi.fn(() => true),
    toDataURL: vi.fn(() => 'data:image/png;base64,mock'),
    fromDataURL: vi.fn(),
    getCanvas: vi.fn(() => canvas),
    getSignaturePad: vi.fn(() => ({
      _data: [[]] as unknown[],
      _strokeBegin: vi.fn(),
      _strokeMoveUpdate: vi.fn(),
    })),
  }
  return { padSpies }
})

vi.mock('react-signature-canvas', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: React.forwardRef(function MockSignatureCanvas(
      props: Record<string, unknown>,
      ref: React.Ref<unknown>
    ) {
      /* eslint-disable react-hooks/immutability -- test mock records latest props */
      padSpies.lastProps = props
      /* eslint-enable react-hooks/immutability */
      React.useImperativeHandle(ref, () => padSpies)
      const { canvasProps = {} } = props as { canvasProps?: Record<string, unknown> }
      return <canvas data-testid="signature-canvas" {...canvasProps} />
    }),
  }
})

describe('SignaturePad', () => {
  beforeEach(() => {
    padSpies.canvas.width = 400
    padSpies.canvas.height = 176
    padSpies.lastProps = {}
    padSpies.clear.mockReset()
    padSpies.fromDataURL.mockReset()
    padSpies.toDataURL.mockReset()
    padSpies.toDataURL.mockReturnValue('data:image/png;base64,mock')
    padSpies.isEmpty.mockReset()
    padSpies.isEmpty.mockReturnValue(true)
    padSpies.getCanvas.mockClear()
    padSpies.getSignaturePad.mockClear()
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

  it('disables clearing the pad on window resize', () => {
    render(<SignaturePad onSignatureChange={vi.fn()} />)

    expect(padSpies.lastProps.clearOnResize).toBe(false)
  })

  it('does not reset canvas data if the window resizes mid-stroke', () => {
    render(
      <SignaturePad
        onSignatureChange={vi.fn()}
        initialData="data:image/png;base64,existing"
      />
    )
    const canvas = screen.getByTestId('signature-canvas')
    vi.spyOn(canvas.parentElement!, 'getBoundingClientRect').mockReturnValue({
      width: 520,
      height: 176,
      top: 0,
      left: 0,
      bottom: 176,
      right: 520,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    padSpies.fromDataURL.mockClear()

    const onBegin = padSpies.lastProps.onBegin as (() => void) | undefined
    onBegin?.()
    window.dispatchEvent(new Event('resize'))

    expect(padSpies.fromDataURL).not.toHaveBeenCalled()
    expect(padSpies.clear).not.toHaveBeenCalled()
    expect(padSpies.canvas.width).toBe(400)
  })

  it('applies a deferred resize after the stroke ends and still reports the signature', () => {
    const onSignatureChange = vi.fn()
    render(<SignaturePad onSignatureChange={onSignatureChange} />)
    const canvas = screen.getByTestId('signature-canvas')
    vi.spyOn(canvas.parentElement!, 'getBoundingClientRect').mockReturnValue({
      width: 520,
      height: 176,
      top: 0,
      left: 0,
      bottom: 176,
      right: 520,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    const onBegin = padSpies.lastProps.onBegin as (() => void) | undefined
    const onEnd = padSpies.lastProps.onEnd as (() => void) | undefined
    onBegin?.()
    window.dispatchEvent(new Event('resize'))
    padSpies.isEmpty.mockReturnValue(false)
    onEnd?.()

    expect(onSignatureChange).toHaveBeenCalledWith('data:image/png;base64,mock')
    expect(padSpies.canvas.width).toBe(520)
    expect(padSpies.fromDataURL).toHaveBeenCalledWith('data:image/png;base64,mock')
  })
})
