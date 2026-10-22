import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, renderWithProviders, screen, waitFor } from '@/tests/test-utils'
import { REFERRAL_FIELD_COPY, ReferralCodeField } from '../referral-code-field'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const LOOKUP_WAIT = { timeout: 2000 }

// A fresh Response per call: a body can only be read once.
const respond = (status: number, body: unknown) =>
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )

const hint = () => document.getElementById('referralCodeHint')!

describe('ReferralCodeField', () => {
  it('shows the offer hint while collapsed and when opened empty', () => {
    renderWithProviders(<ReferralCodeField defaultCode={null} />)
    expect(screen.getByText(REFERRAL_FIELD_COPY.collapsedHint)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tem um código de indicação?' }))
    expect(hint()).toHaveTextContent(REFERRAL_FIELD_COPY.hint)
    expect(screen.getByLabelText('Código de indicação')).toHaveFocus()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows what is typed in uppercase, looks up the normalised code once typing stops, and names the referrer', async () => {
    respond(200, { active: true, clinicName: 'Clínica Flora' })
    renderWithProviders(<ReferralCodeField defaultCode="" />)
    const input = screen.getByLabelText('Código de indicação') as HTMLInputElement
    expect(input).toHaveClass('uppercase')
    fireEvent.change(input, { target: { value: 'dram' } })
    fireEvent.change(input, { target: { value: 'dramicaela' } })
    await waitFor(() => expect(hint()).toHaveTextContent(REFERRAL_FIELD_COPY.valid('Clínica Flora')), LOOKUP_WAIT)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/referral/codes/DRAMICAELA', expect.anything())
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('says "not found" inline for an unknown code and marks the input invalid', async () => {
    respond(200, { active: false })
    renderWithProviders(<ReferralCodeField defaultCode="NAOEXISTE" />)
    await waitFor(() => expect(hint()).toHaveTextContent(REFERRAL_FIELD_COPY.notFound), LOOKUP_WAIT)
    expect(screen.getByLabelText('Código de indicação')).toHaveAttribute('aria-invalid', 'true')
  })

  it('flags a bad format without calling the server, but only once it is clearly wrong', async () => {
    renderWithProviders(<ReferralCodeField defaultCode="" />)
    const input = screen.getByLabelText('Código de indicação')
    fireEvent.change(input, { target: { value: 'ab' } })
    expect(hint()).toHaveTextContent(REFERRAL_FIELD_COPY.hint)
    fireEvent.blur(input)
    expect(hint()).toHaveTextContent(REFERRAL_FIELD_COPY.badFormat)
    fireEvent.change(input, { target: { value: 'ab-c' } })
    expect(hint()).toHaveTextContent(REFERRAL_FIELD_COPY.badFormat)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not call a code invalid when the lookup itself fails (rate limit, network)', async () => {
    respond(429, { active: false })
    renderWithProviders(<ReferralCodeField defaultCode="MECA7K" />)
    await waitFor(() => expect(hint()).toHaveTextContent(REFERRAL_FIELD_COPY.unavailable), LOOKUP_WAIT)
    expect(screen.getByLabelText('Código de indicação')).not.toHaveAttribute('aria-invalid')
  })
})
