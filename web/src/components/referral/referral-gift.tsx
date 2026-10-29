import { Gift, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

const SIZES = {
  xs: { box: 'size-6 rounded-md', icon: 'size-3.5' },
  sm: { box: 'size-8 rounded-lg', icon: 'size-4' },
  lg: { box: 'size-12 rounded-2xl', icon: 'size-6' },
} as const

export function ReferralGift({ size = 'sm', locked = false }: { size?: keyof typeof SIZES; locked?: boolean }) {
  const Icon = locked ? Lock : Gift
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center text-white shadow-md animate-gift-wiggle',
        locked ? 'bg-gradient-to-br from-blush to-[#C9A58D] shadow-blush/40' : 'bg-gradient-to-br from-mint to-sage shadow-sage/30',
        SIZES[size].box,
      )}
    >
      <Icon className={SIZES[size].icon} />
    </span>
  )
}
