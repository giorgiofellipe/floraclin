'use client'

import { forwardRef, type ChangeEvent } from 'react'
import { Input } from '@/components/ui/input'

interface MaskedInputProps extends Omit<React.ComponentProps<typeof Input>, 'onChange'> {
  mask: (value: string) => string
  onValueChange?: (rawValue: string, maskedValue: string) => void
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void
}

// Wraps shadcn Input with a mask function applied on every keystroke
const MaskedInput = forwardRef<HTMLInputElement, MaskedInputProps>(
  ({ mask, onValueChange, onChange, value, defaultValue, ...props }, ref) => {
    function handleChange(e: ChangeEvent<HTMLInputElement>) {
      const raw = e.target.value
      const masked = mask(raw)

      // Mutate the event target value so React Hook Form sees the masked value
      e.target.value = masked

      onChange?.(e)
      onValueChange?.(raw.replace(/\D/g, ''), masked)
    }

    // If a controlled value is provided, apply the mask to it for display
    const displayValue = value !== undefined ? mask(String(value)) : undefined
    const displayDefaultValue =
      defaultValue !== undefined && value === undefined
        ? mask(String(defaultValue))
        : undefined

    return (
      <Input
        ref={ref}
        {...props}
        value={displayValue}
        defaultValue={displayDefaultValue}
        onChange={handleChange}
      />
    )
  }
)

MaskedInput.displayName = 'MaskedInput'

export { MaskedInput }
export type { MaskedInputProps }
