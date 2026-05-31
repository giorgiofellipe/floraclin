import '@testing-library/jest-dom/vitest'

const noop = () => {}

global.IntersectionObserver = class IntersectionObserver {
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds: ReadonlyArray<number> = []
  constructor(private cb: IntersectionObserverCallback) {}
  observe = noop
  unobserve = noop
  disconnect = noop
  takeRecords = () => [] as IntersectionObserverEntry[]
} as unknown as typeof IntersectionObserver
