/**
 * The public booking page is the page a clinic sends to its own patients, so
 * the clinic's brand must be the hero, not FloraClin's. These tests guard
 * against the old hierarchy (FloraClin wordmark as hero, clinic name as a
 * subtitle) creeping back in.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BookingPage } from '../booking-page'

const CLINIC = {
  name: 'Clínica Bela Pele',
  phone: '11987654321',
  email: 'contato@belapele.com.br',
}

describe('BookingPage', () => {
  it('renders the clinic logo as the hero when logoUrl is present', () => {
    render(
      <BookingPage
        clinic={{ ...CLINIC, logoUrl: 'https://xyz.supabase.co/storage/v1/object/sign/floraclin/logo.png?token=abc' }}
        practitioners={[]}
        slug="bela-pele"
      />
    )

    const logo = screen.getByTestId('clinic-logo')
    expect(logo).toBeInTheDocument()
    expect(logo).toHaveAttribute(
      'src',
      'https://xyz.supabase.co/storage/v1/object/sign/floraclin/logo.png?token=abc'
    )
    expect(logo).toHaveAttribute('alt', CLINIC.name)
    expect(screen.queryByTestId('clinic-name-fallback')).not.toBeInTheDocument()
  })

  it('falls back to the clinic name when there is no logo', () => {
    render(
      <BookingPage
        clinic={{ ...CLINIC, logoUrl: null }}
        practitioners={[]}
        slug="bela-pele"
      />
    )

    expect(screen.queryByTestId('clinic-logo')).not.toBeInTheDocument()
    const fallback = screen.getByTestId('clinic-name-fallback')
    expect(fallback).toBeInTheDocument()
    expect(fallback).toHaveTextContent(CLINIC.name)
  })

  it('never shows the FloraClin wordmark as the hero, only a quiet powered-by note', () => {
    render(
      <BookingPage
        clinic={{ ...CLINIC, logoUrl: null }}
        practitioners={[]}
        slug="bela-pele"
      />
    )

    // The hero is the clinic name, not a "Flora" / "Clin" two-tone wordmark.
    expect(screen.queryByText('Flora')).not.toBeInTheDocument()
    expect(screen.queryByText('Clin')).not.toBeInTheDocument()

    // The only FloraClin mention left is the discreet powered-by note.
    const poweredBy = screen.getByTestId('booking-powered-by')
    expect(poweredBy).toHaveTextContent('Agendamento por FloraClin')
  })
})
