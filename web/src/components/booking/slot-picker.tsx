'use client'

import { cn } from '@/lib/utils'

interface Slot {
  startTime: string
  endTime: string
}

interface SlotPickerProps {
  slots: Slot[]
  selectedSlot: string | null
  onSelectSlot: (startTime: string) => void
  loading?: boolean
}

function groupSlotsByPeriod(slots: Slot[]) {
  const morning: Slot[] = []
  const afternoon: Slot[] = []

  for (const slot of slots) {
    const hour = parseInt(slot.startTime.split(':')[0], 10)
    if (hour < 12) {
      morning.push(slot)
    } else {
      afternoon.push(slot)
    }
  }

  return { morning, afternoon }
}

function SlotGroup({
  label,
  slots,
  selectedSlot,
  onSelectSlot,
}: {
  label: string
  slots: Slot[]
  selectedSlot: string | null
  onSelectSlot: (startTime: string) => void
}) {
  if (slots.length === 0) return null

  return (
    <div>
      <p className="uppercase tracking-wider text-xs text-mid mb-2.5 font-medium">
        {label}
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {slots.map((slot) => (
          <button
            key={slot.startTime}
            type="button"
            onClick={() => onSelectSlot(slot.startTime)}
            className={cn(
              'rounded-full border px-3 py-2 text-sm font-medium transition-all duration-200',
              'focus:outline-none focus:ring-2 focus:ring-sage/40 focus:ring-offset-1',
              selectedSlot === slot.startTime
                ? 'bg-forest text-cream border-forest shadow-md shadow-forest/15 scale-105'
                : 'bg-white border-forest/25 text-forest hover:border-forest hover:bg-petal/60 hover:shadow-sm'
            )}
          >
            {slot.startTime}
          </button>
        ))}
      </div>
    </div>
  )
}

export function SlotPicker({
  slots,
  selectedSlot,
  onSelectSlot,
  loading,
}: SlotPickerProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse space-y-2">
          <div className="h-4 w-20 bg-blush rounded" />
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 bg-blush rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (slots.length === 0) {
    return (
      <div className="text-center py-8 text-mid">
        <p className="text-sm">Nenhum horário disponível para esta data.</p>
        <p className="text-xs mt-1">Tente selecionar outro dia.</p>
      </div>
    )
  }

  const { morning, afternoon } = groupSlotsByPeriod(slots)

  return (
    <div className="space-y-5">
      <SlotGroup
        label="Manhã"
        slots={morning}
        selectedSlot={selectedSlot}
        onSelectSlot={onSelectSlot}
      />
      <SlotGroup
        label="Tarde"
        slots={afternoon}
        selectedSlot={selectedSlot}
        onSelectSlot={onSelectSlot}
      />
    </div>
  )
}
