import { Skeleton } from '@/components/ui/skeleton'

export default function AgendaLoading() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 p-4 lg:p-6">
      {/* Header */}
      <div>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-1 h-4 w-56" />
      </div>

      {/* Controls bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>

      {/* Calendar grid skeleton */}
      <div className="flex-1 rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="border-r p-2 last:border-r-0">
              <Skeleton className="mx-auto h-4 w-12" />
            </div>
          ))}
        </div>
        {/* Time slots */}
        <div className="space-y-0">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex border-b last:border-b-0">
              <Skeleton className="h-10 w-14 shrink-0" />
              <div className="flex flex-1">
                {Array.from({ length: 7 }).map((_, j) => (
                  <div key={j} className="flex-1 border-r p-1 last:border-r-0">
                    {i % 3 === 0 && j % 2 === 0 && (
                      <Skeleton className="h-8 w-full rounded" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
