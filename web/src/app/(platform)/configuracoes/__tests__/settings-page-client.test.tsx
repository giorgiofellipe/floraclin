/**
 * Mobile settings is a drill-down: no `tab` param shows the section list,
 * `?tab=<key>` shows that section. Links sent to users (e.g. over WhatsApp)
 * deep-link straight into a section, and the back arrow must not leave the
 * app when there is no list entry behind it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SettingsPageClient } from '../settings-page-client'

const mockReplace = vi.fn()
const mockBack = vi.fn()
let searchParamsValue = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, push: vi.fn() }),
  usePathname: () => '/configuracoes',
  useSearchParams: () => searchParamsValue,
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('@/hooks/queries/use-calendar', () => ({ useCalendarConnections: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/use-profile', () => ({ useProfile: () => ({ data: null, isLoading: true }) }))
vi.mock('@/hooks/queries/use-packages', () => ({ usePackageTemplates: () => ({ data: [], isLoading: false }) }))

const { stub } = vi.hoisted(() => ({ stub: () => null }))
vi.mock('@/components/settings/clinic-settings-form', () => ({ ClinicSettingsForm: stub }))
vi.mock('@/components/settings/procedure-type-list', () => ({ ProcedureTypeList: stub }))
vi.mock('@/components/settings/product-list', () => ({ ProductList: stub }))
vi.mock('@/components/settings/team-list', () => ({ TeamList: stub }))
vi.mock('@/components/settings/consent-template-list', () => ({ ConsentTemplateList: stub }))
vi.mock('@/components/settings/booking-settings', () => ({ BookingSettings: stub }))
vi.mock('@/components/settings/calendar-connection-card', () => ({ CalendarConnectionCard: stub }))
vi.mock('@/components/settings/meta-connection-card', () => ({ MetaConnectionCard: stub }))
vi.mock('@/components/audit/audit-log-viewer', () => ({ AuditLogViewer: stub }))
vi.mock('@/components/financial/settings/financial-settings-form', () => ({ FinancialSettingsForm: stub }))
vi.mock('@/components/financial/settings/expense-categories-manager', () => ({ ExpenseCategoriesManager: stub }))
vi.mock('@/components/settings/whatsapp-settings-form', () => ({ WhatsAppSettingsForm: stub }))
vi.mock('@/components/settings/billing-settings', () => ({ BillingSettings: stub }))
vi.mock('@/components/packages/package-template-list', () => ({ PackageTemplateList: stub }))
vi.mock('@/components/settings/document-template-list', () => ({ DocumentTemplateList: stub }))
vi.mock('@/components/settings/account-info-form', () => ({ AccountInfoForm: stub }))
vi.mock('@/components/settings/password-form', () => ({ PasswordForm: stub }))
vi.mock('@/components/settings/professional-signature-form', () => ({ ProfessionalSignatureForm: stub }))

const TENANT = {
  id: 't1',
  name: 'Clínica',
  slug: 'clinica',
  phone: null,
  email: null,
  address: null,
  workingHours: null,
  settings: {},
  logoUrl: null,
}

function renderSettings(userRole: 'owner' | 'practitioner') {
  const props = {
    tenant: TENANT,
    procedureTypes: [],
    products: [],
    members: [],
    consentTemplates: [],
    currentUserId: 'u1',
    userRole,
    initialTab: searchParamsValue.get('tab') ?? undefined,
  }
  const view = render(<SettingsPageClient {...props} />)
  return { ...view, rerender: () => view.rerender(<SettingsPageClient {...props} />) }
}

const sectionLinks = () =>
  screen.queryAllByRole('link').map((a) => a.getAttribute('href')).filter((href) => href?.includes('?tab='))
const backButton = () => screen.queryByRole('button', { name: 'Voltar para configurações' })

beforeEach(() => {
  vi.clearAllMocks()
  searchParamsValue = new URLSearchParams()
})

describe('SettingsPageClient mobile drill-down', () => {
  it('lists only the sections the role can see when no tab is selected', () => {
    renderSettings('practitioner')

    expect(sectionLinks()).toEqual(['/configuracoes?tab=perfil', '/configuracoes?tab=documentos'])
    expect(backButton()).toBeNull()
  })

  it('opens a deep-linked section and returns to the list without leaving the app', () => {
    searchParamsValue = new URLSearchParams('tab=agendamento')
    renderSettings('owner')

    expect(sectionLinks()).toEqual([])
    fireEvent.click(backButton()!)

    expect(mockReplace).toHaveBeenCalledWith('/configuracoes')
    expect(mockBack).not.toHaveBeenCalled()
  })

  it('pops history when the section was opened from the list', () => {
    const { rerender } = renderSettings('owner')
    fireEvent.click(screen.getByRole('link', { name: /Agendamento/ }))
    searchParamsValue = new URLSearchParams('tab=agendamento')
    rerender()

    fireEvent.click(backButton()!)

    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
