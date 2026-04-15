import { Skeleton } from '@/components/ui/skeleton'

export default function AtendimentoLoading() {
  return (
    <div className="-m-6 flex min-h-screen flex-col bg-[#F4F6F8]">
      {/* Patient compact bar skeleton */}
      <header className="sticky top-0 z-30 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="h-8 w-16 rounded-[3px]" />
        </div>
      </header>

      {/* Context message skeleton */}
      <div className="mx-auto w-full px-4 pt-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-2 w-2 rounded-full" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>

      {/* Main content area */}
      <main className="mx-auto flex w-full flex-1 flex-col gap-4 px-6 py-4 pb-52 md:pb-24">
        {/* Stepper skeleton */}
        <div className="rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          {/* Desktop stepper */}
          <div className="hidden md:flex items-center divide-x divide-gray-100">
            {[1, 2, 3, 4].map((step) => (
              <div key={step} className="flex flex-1 items-center gap-3 px-4 py-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-36" />
                </div>
              </div>
            ))}
          </div>
          {/* Mobile stepper */}
          <div className="flex flex-col md:hidden divide-y divide-gray-100">
            {[1, 2, 3, 4].map((step) => (
              <div key={step} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-36" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Content area skeleton */}
        <div className="space-y-4 flex-1">
          {/* Step title */}
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-44" />
          </div>
          {/* Content card */}
          <div className="rounded-[3px] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="space-y-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-32 w-full rounded-[3px]" />
              <div className="grid grid-cols-2 gap-4">
                <Skeleton className="h-10 w-full rounded-[3px]" />
                <Skeleton className="h-10 w-full rounded-[3px]" />
              </div>
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-24 w-full rounded-[3px]" />
            </div>
          </div>
        </div>
      </main>

      {/* Navigation bar skeleton */}
      <nav className="fixed bottom-0 left-0 right-0 md:left-[200px] z-30 border-t border-gray-100 bg-white shadow-[0_-1px_4px_rgba(0,0,0,0.06)]">
        <div className="mx-auto flex items-center justify-between px-6 py-3">
          <Skeleton className="h-[48px] w-24 rounded-[3px]" />
          <Skeleton className="hidden md:block h-4 w-32 rounded-full" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-[48px] w-32 rounded-[3px]" />
            <Skeleton className="h-[48px] w-32 rounded-[3px]" />
          </div>
        </div>
      </nav>
    </div>
  )
}
