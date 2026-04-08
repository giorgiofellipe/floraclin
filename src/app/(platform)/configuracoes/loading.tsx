import { Skeleton } from '@/components/ui/skeleton'

export default function SettingsLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-1 h-4 w-64" />
      </div>

      {/* Mobile tabs */}
      <div className="md:hidden -mx-4 px-4">
        <div className="flex gap-1 bg-[#E8ECEF] rounded-[3px] p-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-28 rounded-[3px]" />
          ))}
        </div>
      </div>

      {/* Desktop: sidebar + content */}
      <div className="flex gap-6">
        {/* Sidebar nav */}
        <nav className="hidden md:block w-56 shrink-0">
          <div className="space-y-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-[3px]" />
            ))}
          </div>
        </nav>

        {/* Content area */}
        <div className="flex-1">
          <div className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6 space-y-6">
            <div className="flex items-center gap-2 mb-2">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-5 w-32" />
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-9 w-full rounded-lg" />
              </div>
            ))}
            <Skeleton className="h-9 w-32 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}
