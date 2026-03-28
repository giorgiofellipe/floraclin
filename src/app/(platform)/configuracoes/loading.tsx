import { Skeleton } from '@/components/ui/skeleton'

export default function ConfiguracoesLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-1 h-4 w-64" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-32" />
        ))}
      </div>

      {/* Settings form skeleton */}
      <div className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6 space-y-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
        <Skeleton className="h-9 w-32" />
      </div>
    </div>
  )
}
