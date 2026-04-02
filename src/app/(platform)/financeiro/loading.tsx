import { Skeleton } from '@/components/ui/skeleton'

export default function FinancialLoading() {
  return (
    <div className="space-y-4">
      {/* Pill-style tab bar */}
      <div className="flex items-center gap-1 rounded-lg bg-white p-1 shadow-sm border border-[#E8ECEF]">
        <Skeleton className="h-9 w-28 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
        <Skeleton className="h-9 w-32 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>

      {/* Top bar: filters + button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>

      {/* Card list skeleton */}
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-[#E8ECEF] bg-white px-4 py-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="flex items-baseline gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-1 w-12 rounded-full" />
                </div>
              </div>
              <div className="text-right space-y-1.5">
                <Skeleton className="h-4 w-20 ml-auto" />
                <Skeleton className="h-4 w-16 rounded-full ml-auto" />
              </div>
              <Skeleton className="h-4 w-4 shrink-0" />
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-center gap-3 pt-2">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>
    </div>
  )
}
