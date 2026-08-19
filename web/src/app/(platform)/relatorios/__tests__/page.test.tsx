import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { REPORTS, REPORT_GROUPS } from '@/lib/reports/registry'
import RelatoriosPage from '../page'

describe('RelatoriosPage', () => {
  it('renders a heading for every group in REPORT_GROUPS', () => {
    render(<RelatoriosPage />)

    for (const group of REPORT_GROUPS) {
      expect(screen.getByRole('heading', { name: group.title })).toBeInTheDocument()
      expect(screen.getByText(group.subtitle)).toBeInTheDocument()
    }
  })

  it('renders every report card under the section matching its declared group', () => {
    render(<RelatoriosPage />)

    for (const group of REPORT_GROUPS) {
      const heading = screen.getByRole('heading', { name: group.title })
      // The group section is the heading's grandparent: heading -> its own
      // wrapper div -> the `space-y-4` section div that also holds the card
      // grid. Walking up two levels keeps this test tied to "which section
      // is this card in" rather than to exact DOM nesting.
      const section = heading.parentElement?.parentElement as HTMLElement
      const reportsInGroup = REPORTS.filter((report) => report.group === group.key)

      for (const report of reportsInGroup) {
        expect(
          within(section).getByTestId(`report-card-${report.slug}`),
          `${report.slug} should render under the "${group.title}" section`,
        ).toBeInTheDocument()
      }
    }
  })

  it('renders exactly one card per report in the registry, no more no less', () => {
    render(<RelatoriosPage />)

    for (const report of REPORTS) {
      expect(screen.getAllByTestId(`report-card-${report.slug}`)).toHaveLength(1)
    }
    expect(screen.getAllByTestId(/^report-card-/)).toHaveLength(REPORTS.length)
  })

  // In real data every registered group has at least one report (enforced by
  // registry.test.ts), so this case can't happen through REPORT_GROUPS as
  // shipped. Mock the registry to inject an empty group and prove the page
  // itself skips it, rather than only relying on the registry invariant.
  it('never renders a heading for a group with no reports', async () => {
    vi.resetModules()
    vi.doMock('@/lib/reports/registry', () => ({
      REPORTS,
      REPORT_GROUPS: [
        ...REPORT_GROUPS,
        { key: 'empty-test-group', title: 'Grupo vazio de teste', subtitle: 'não deveria aparecer' },
      ],
    }))

    const { default: PageWithEmptyGroup } = await import('../page')
    render(<PageWithEmptyGroup />)

    expect(
      screen.queryByRole('heading', { name: 'Grupo vazio de teste' }),
    ).not.toBeInTheDocument()

    vi.doUnmock('@/lib/reports/registry')
    vi.resetModules()
  })
})
