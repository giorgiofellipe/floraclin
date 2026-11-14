import { useCallback, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

/**
 * A create form opened from the URL (lib/deep-links.ts, the quick-create
 * menu). `active` follows the URL, so a link to the page already on screen
 * opens the form too. `clear` drops the param and its prefill params, keeping
 * the rest, so Back or a refresh does not open the form again.
 */
export function useCreateParam(name: string, value: string, prefillParams: string[] = []) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const inUrl = searchParams.get(name) === value
  // Hides the form at once; the URL catches up after router.replace.
  const [dismissed, setDismissed] = useState(false)
  if (dismissed && !inUrl) setDismissed(false)

  const prefillKeys = prefillParams.join(',')
  const clear = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (params.get(name) !== value) return
    setDismissed(true)
    params.delete(name)
    for (const key of prefillKeys.split(',')) params.delete(key)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname, searchParams, name, value, prefillKeys])

  return { active: inUrl && !dismissed, clear }
}
