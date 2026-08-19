/**
 * `tenants.address` is free-form JSONB, so `ClinicHeader` gets whatever a
 * clinic's row happens to hold. These tests cover the narrowing, not layout.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  ClinicHeader,
  toClinicHeaderAddress,
  toClinicHeaderTenant,
} from '@/components/print/clinic-header'

describe('toClinicHeaderAddress', () => {
  it('passes an object shape through', () => {
    expect(toClinicHeaderAddress({ city: 'São Paulo', state: 'SP' })).toEqual({
      city: 'São Paulo',
      state: 'SP',
    })
  })

  it('rejects an array, which would otherwise render an empty address line', () => {
    // `typeof [] === 'object'`, so an array used to pass the narrowing and
    // produce an address whose every field is undefined.
    expect(toClinicHeaderAddress([])).toBeNull()
    expect(toClinicHeaderAddress([{ city: 'São Paulo' }])).toBeNull()
  })

  it('rejects null and non-objects', () => {
    expect(toClinicHeaderAddress(null)).toBeNull()
    expect(toClinicHeaderAddress(undefined)).toBeNull()
    expect(toClinicHeaderAddress('Rua A, 100')).toBeNull()
    expect(toClinicHeaderAddress(42)).toBeNull()
  })
})

describe('toClinicHeaderTenant', () => {
  it('keeps the identity fields and narrows the address', () => {
    expect(
      toClinicHeaderTenant({
        name: 'Clínica Bela Pele',
        phone: '11987654321',
        email: 'contato@bela.com.br',
        logoUrl: 'data:image/png;base64,AAAA',
        address: { city: 'São Paulo' },
      }),
    ).toEqual({
      name: 'Clínica Bela Pele',
      phone: '11987654321',
      email: 'contato@bela.com.br',
      logoUrl: 'data:image/png;base64,AAAA',
      address: { city: 'São Paulo' },
    })
  })

  it('nulls out an array address', () => {
    const header = toClinicHeaderTenant({
      name: 'Clínica Bela Pele',
      phone: null,
      email: null,
      logoUrl: null,
      address: [] as unknown as Record<string, unknown>,
    })

    expect(header.address).toBeNull()
  })
})

describe('ClinicHeader', () => {
  const TENANT = {
    name: 'Clínica Bela Pele',
    phone: '11987654321',
    email: null,
    logoUrl: null,
    address: null,
  }

  it('renders no img when there is no logo', () => {
    const { container } = render(<ClinicHeader tenant={TENANT} />)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('Clínica Bela Pele')).toBeInTheDocument()
  })

  it('renders a data URI logo inline, as the PDF path supplies it', () => {
    const { container } = render(
      <ClinicHeader tenant={{ ...TENANT, logoUrl: 'data:image/png;base64,AAAA' }} />,
    )

    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAAA')
    expect(img).toHaveAttribute('alt', 'Clínica Bela Pele')
  })

  it('renders no address line when the address narrowed to null', () => {
    const { container } = render(
      <ClinicHeader tenant={toClinicHeaderTenant({ ...TENANT, address: [] as unknown as Record<string, unknown> })} />,
    )

    const metaLines = container.querySelectorAll('.clinic-meta')
    // Only the phone/email line, never an empty address line.
    expect(metaLines).toHaveLength(1)
    expect(metaLines[0]).toHaveTextContent('11987654321')
  })
})
