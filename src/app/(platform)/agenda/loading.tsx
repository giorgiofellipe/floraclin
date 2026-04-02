import { Skeleton } from '@/components/ui/skeleton'

export default function ScheduleLoading() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-3 p-4 lg:p-6">
      {/* Controls bar (no title — it's in the header) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-36 rounded-md" />
          <Skeleton className="h-9 w-36 rounded-md" />
        </div>
      </div>

      {/* Day view skeleton */}
      <div className="flex-1 rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        {/* Day header */}
        <div className="border-b border-[#E8ECEF] px-4 py-3 text-center">
          <Skeleton className="mx-auto h-4 w-48" />
        </div>

        {/* Time grid */}
        <div className="flex">
          {/* Time labels */}
          <div className="w-16 shrink-0">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-start" style={{ height: 96 }}>
                <Skeleton className="mt-1 ml-auto mr-3 h-3 w-10" />
              </div>
            ))}
          </div>

          {/* Grid slots */}
          <div className="flex-1 border-l border-sage/10">
            {Array.from({ length: 20 }).map((_, i) => (
              <div
                key={i}
                className={i % 2 === 0 ? 'border-b border-sage/8' : 'border-b border-dashed border-sage/5'}
                style={{ height: 48 }}
              >
                {i === 2 && <Skeleton className="mx-1 mt-1 h-[90px] rounded-[3px]" />}
                {i === 8 && <Skeleton className="mx-1 mt-1 h-[42px] rounded-[3px]" />}
                {i === 14 && <Skeleton className="mx-1 mt-1 h-[42px] rounded-[3px]" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
