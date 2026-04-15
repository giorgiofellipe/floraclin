import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MaskedInput } from '../masked-input'
import { maskPhone, maskCPF, maskCurrency } from '@/lib/masks'

describe('MaskedInput', () => {
  it('applies phone mask on input', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()

    render(
      <MaskedInput
        mask={maskPhone}
        onValueChange={onValueChange}
        placeholder="Telefone"
      />
    )

    const input = screen.getByPlaceholderText('Telefone')
    await user.type(input, '11999990000')

    // The mask should format: (11) 99999-0000
    expect(input).toHaveValue('(11) 99999-0000')
  })

  it('applies CPF mask on input', async () => {
    const user = userEvent.setup()

    render(
      <MaskedInput mask={maskCPF} placeholder="CPF" />
    )

    const input = screen.getByPlaceholderText('CPF')
    await user.type(input, '12345678900')

    expect(input).toHaveValue('123.456.789-00')
  })

  it('applies currency mask (cents-to-int)', async () => {
    const user = userEvent.setup()

    render(
      <MaskedInput mask={maskCurrency} placeholder="Valor" />
    )

    const input = screen.getByPlaceholderText('Valor')
    await user.type(input, '12345')

    // 12345 cents = 123,45
    expect(input).toHaveValue('123,45')
  })

  it('handles empty input', () => {
    render(
      <MaskedInput mask={maskPhone} placeholder="Telefone" />
    )

    const input = screen.getByPlaceholderText('Telefone')
    expect(input).toHaveValue('')
  })

  it('works with initial value', () => {
    render(
      <MaskedInput
        mask={maskPhone}
        value="11999990000"
        placeholder="Telefone"
      />
    )

    const input = screen.getByPlaceholderText('Telefone')
    // The mask is applied to the controlled value for display
    expect(input).toHaveValue('(11) 99999-0000')
  })
})
