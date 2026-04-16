'use client'

import { EXPENSE_ICON_OPTIONS } from './expense-icon-options'
import { cn } from '@/lib/utils'

interface IconPickerProps {
  value: string
  onChange: (value: string) => void
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {EXPENSE_ICON_OPTIONS.map((opt) => {
        const Icon = opt.icon
        const isSelected = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.label}
            aria-label={opt.label}
            data-selected={isSelected}
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex items-center justify-center w-10 h-10 rounded-md border transition-colors',
              isSelected
                ? 'border-forest bg-[#F0F7F1] ring-2 ring-forest'
                : 'border-[#E8ECEF] bg-white hover:bg-[#F4F6F8]',
            )}
          >
            <Icon
              className={cn(
                'h-5 w-5',
                isSelected ? 'text-forest' : 'text-charcoal',
              )}
            />
          </button>
        )
      })}
    </div>
  )
}
