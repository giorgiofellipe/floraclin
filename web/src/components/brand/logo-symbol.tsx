import { cn } from '@/lib/utils'

interface LogoSymbolProps {
  className?: string
}

export function LogoSymbol({ className }: LogoSymbolProps) {
  return (
    <svg
      viewBox="0 0 52 52"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('size-5', className)}
    >
      <ellipse cx="26" cy="16" rx="6" ry="12" stroke="currentColor" strokeWidth="1.2" transform="rotate(0 26 26)" />
      <ellipse cx="26" cy="16" rx="6" ry="12" stroke="currentColor" strokeWidth="1.2" transform="rotate(60 26 26)" />
      <ellipse cx="26" cy="16" rx="6" ry="12" stroke="currentColor" strokeWidth="1.2" transform="rotate(120 26 26)" />
      <ellipse cx="26" cy="16" rx="6" ry="12" stroke="currentColor" strokeWidth="1.2" transform="rotate(180 26 26)" />
      <ellipse cx="26" cy="16" rx="6" ry="12" stroke="currentColor" strokeWidth="1.2" transform="rotate(240 26 26)" />
      <ellipse cx="26" cy="16" rx="6" ry="12" stroke="currentColor" strokeWidth="1.2" transform="rotate(300 26 26)" />
      <circle cx="26" cy="26" r="3" fill="currentColor" />
    </svg>
  )
}
