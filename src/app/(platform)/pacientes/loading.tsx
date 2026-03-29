import { Skeleton } from '@/components/ui/skeleton'

export default function PacientesLoading() {
  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mt-1 h-4 w-32" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-full max-w-sm" />
        <Skeleton className="h-9 w-20" />
      </div>

      {/* Table skeleton */}
      <div className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="border-b p-3">
          <div className="flex gap-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="hidden md:block h-4 w-32" />
            <Skeleton className="hidden md:block h-4 w-28" />
            <Skeleton className="hidden lg:block h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border-b p-3 last:border-b-0">
            <div className="flex gap-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="hidden md:block h-4 w-36" />
              <Skeleton className="hidden md:block h-4 w-28" />
              <Skeleton className="hidden lg:block h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
