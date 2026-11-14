import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useCreateParam } from '../use-create-param'

const route = vi.hoisted(() => ({ search: '', replace: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/pacientes',
  useRouter: () => ({ replace: route.replace }),
  useSearchParams: () => new URLSearchParams(route.search),
}))

describe('useCreateParam', () => {
  beforeEach(() => {
    route.replace.mockClear()
  })

  // Left in the URL, Back or a refresh would open the form again.
  it('drops the param and its prefill on clear and keeps the page state', () => {
    route.search = 'busca=ana&pagina=2&novo=1&nome=Ana&telefone=11999990000'
    const { result } = renderHook(() => useCreateParam('novo', '1', ['nome', 'telefone']))
    expect(result.current.active).toBe(true)

    act(() => result.current.clear())
    expect(route.replace).toHaveBeenCalledWith('/pacientes?busca=ana&pagina=2', { scroll: false })
    // Closed at once, before the URL update lands.
    expect(result.current.active).toBe(false)
  })

  it('opens again on the next link once the URL has lost the param', () => {
    route.search = 'novo=1'
    const { result, rerender } = renderHook(() => useCreateParam('novo', '1'))
    act(() => result.current.clear())

    route.search = ''
    rerender()
    route.search = 'novo=1'
    rerender()
    expect(result.current.active).toBe(true)
  })
})
