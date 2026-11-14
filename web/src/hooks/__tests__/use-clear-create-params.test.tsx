import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useClearCreateParams } from '../use-clear-create-params'

const route = vi.hoisted(() => ({ pathname: '/agenda', search: '', replace: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ replace: route.replace }),
  useSearchParams: () => new URLSearchParams(route.search),
}))

describe('useClearCreateParams', () => {
  beforeEach(() => {
    route.replace.mockClear()
  })

  // Left in the URL, Back or a refresh would open the create form again.
  it('drops the create and prefill params and keeps the page state', () => {
    route.search = 'date=2026-11-20&view=week&open=new&patient=p1&patientName=Ana&qc=123'
    renderHook(() => useClearCreateParams()).result.current()
    expect(route.replace).toHaveBeenCalledWith('/agenda?date=2026-11-20&view=week', { scroll: false })
  })

  it('leaves the URL alone when no create param is there', () => {
    route.search = 'date=2026-11-20'
    renderHook(() => useClearCreateParams()).result.current()
    expect(route.replace).not.toHaveBeenCalled()
  })
})
