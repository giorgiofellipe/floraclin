import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeatureShowcase } from '../feature-showcase'

function DemoA() { return <svg aria-hidden="true" data-testid="demo-a"><style>{'@keyframes x{} @media(prefers-reduced-motion:reduce){}'}</style></svg> }
function DemoB() { return <svg aria-hidden="true" data-testid="demo-b"><style>{'@keyframes x{} @media(prefers-reduced-motion:reduce){}'}</style></svg> }
function DemoC() { return <svg aria-hidden="true" data-testid="demo-c"><style>{'@keyframes x{} @media(prefers-reduced-motion:reduce){}'}</style></svg> }

const TEST_GROUPS = [
  {
    label: 'Test Group',
    features: [
      { title: 'Feature One', description: 'Description one', demo: DemoA },
      { title: 'Feature Two', description: 'Description two', demo: DemoB },
      { title: 'Feature Three', description: 'Description three', demo: DemoC },
    ],
  },
]

describe('FeatureShowcase', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders the section with id "recursos"', () => {
    render(<FeatureShowcase groups={TEST_GROUPS} />)
    expect(document.getElementById('recursos')).toBeInTheDocument()
  })

  it('renders the section heading', () => {
    render(<FeatureShowcase groups={TEST_GROUPS} />)
    expect(screen.getByText('Feito para HOF. Não adaptado de outro sistema.')).toBeInTheDocument()
  })

  it('renders group label pill', () => {
    render(<FeatureShowcase groups={TEST_GROUPS} />)
    expect(screen.getByText('Test Group')).toBeInTheDocument()
  })

  it('renders all feature titles (desktop + mobile)', () => {
    render(<FeatureShowcase groups={TEST_GROUPS} />)
    expect(screen.getAllByText('Feature One')).toHaveLength(2)
    expect(screen.getAllByText('Feature Two')).toHaveLength(2)
    expect(screen.getAllByText('Feature Three')).toHaveLength(2)
  })

  it('shows first feature as active by default (desktop tabs)', () => {
    render(<FeatureShowcase groups={TEST_GROUPS} />)
    const tablist = screen.getByRole('tablist')
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('uses proper tablist / tab / tabpanel ARIA roles (desktop)', () => {
    render(<FeatureShowcase groups={TEST_GROUPS} />)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    const tablist = screen.getByRole('tablist')
    expect(within(tablist).getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByRole('tabpanel')).toBeInTheDocument()
  })

  it('clicking a tab switches the active feature', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<FeatureShowcase groups={TEST_GROUPS} />)
    const tablist = screen.getByRole('tablist')
    const tabs = within(tablist).getAllByRole('tab')
    await user.click(tabs[1])
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
  })

  it('renders the active demo component in the tabpanel', () => {
    render(<FeatureShowcase groups={TEST_GROUPS} />)
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByTestId('demo-a')).toBeInTheDocument()
  })

  it('renders a timer bar element', () => {
    const { container } = render(<FeatureShowcase groups={TEST_GROUPS} />)
    const timerBars = container.querySelectorAll('[data-timer-bar]')
    expect(timerBars.length).toBeGreaterThanOrEqual(1)
  })
})
