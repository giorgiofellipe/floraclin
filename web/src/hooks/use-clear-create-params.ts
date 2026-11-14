import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

// Params that open or prefill a create form on arrival (lib/deep-links.ts,
// quick-create's `qc` nonce). Cleared when the form closes so Back or a
// refresh does not open it again.
const CREATE_PARAMS = ['open', 'novo', 'nome', 'telefone', 'patient', 'patientName', 'qc']

export function useClearCreateParams() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  return useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (!CREATE_PARAMS.some((key) => params.has(key))) return
    CREATE_PARAMS.forEach((key) => params.delete(key))
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname, searchParams])
}
