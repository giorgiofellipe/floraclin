import { Skeleton } from '@/components/ui/skeleton'

export default function PatientDetailLoading() {
  return (
    <div className="space-y-5">
      {/* Back link */}
      <Skeleton className="h-4 w-32" />

      {/* Patient header card */}
      <div className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="h-[2px] bg-gradient-to-r from-forest via-sage to-mint" />
        <div className="p-6 sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-5">
              <Skeleton className="size-16 rounded-full shrink-0" />
              <div className="space-y-2.5">
                <Skeleton className="h-7 w-48" />
                <div className="flex gap-4">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-36" />
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-9 rounded-md" />
              <Skeleton className="h-9 w-9 rounded-md" />
              <Skeleton className="h-9 w-36 rounded-md" />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-5 md:grid md:grid-cols-[200px_1fr] md:items-start md:gap-5 md:space-y-0">
        {/* Section menu (desktop) */}
        <div className="hidden md:block rounded-[3px] bg-white p-2 shadow-[0_1px_4px_rgba(0,0,0,0.06)] space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-[3px]" />
          ))}
        </div>

        {/* Section content */}
        <div className="min-h-[400px] rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
          ))}
        </div>

        {/* Section list (phone) */}
        <div className="md:hidden overflow-hidden rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] divide-y divide-[#E8ECEF]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex min-h-11 items-center gap-3 px-4 py-3">
              <Skeleton className="size-4 rounded-[3px]" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
