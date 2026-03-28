'use client'

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ClinicSettingsForm } from '@/components/settings/clinic-settings-form'
import { ProcedureTypeList } from '@/components/settings/procedure-type-list'
import { TeamList } from '@/components/settings/team-list'
import { ConsentTemplateList } from '@/components/settings/consent-template-list'
import { BookingSettings } from '@/components/settings/booking-settings'
import { AuditLogViewer } from '@/components/audit/audit-log-viewer'
import {
  BuildingIcon,
  SyringeIcon,
  UsersIcon,
  FileTextIcon,
  CalendarIcon,
  ShieldCheckIcon,
} from 'lucide-react'

interface Tenant {
  id: string
  name: string
  slug: string
  phone: string | null
  email: string | null
  address: unknown
  workingHours: unknown
  settings: unknown
}

interface ProcedureType {
  id: string
  name: string
  category: string
  description: string | null
  defaultPrice: string | null
  estimatedDurationMin: number | null
  isActive: boolean
}

interface TeamMember {
  id: string
  tenantId: string
  userId: string
  role: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  user: {
    id: string
    email: string
    fullName: string
    phone: string | null
    avatarUrl: string | null
  }
}

interface ConsentTemplate {
  id: string
  type: string
  title: string
  content: string
  version: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

interface SettingsPageClientProps {
  tenant: Tenant
  procedureTypes: ProcedureType[]
  members: TeamMember[]
  consentTemplates: ConsentTemplate[]
  currentUserId: string
}

export function SettingsPageClient({
  tenant,
  procedureTypes,
  members,
  consentTemplates,
  currentUserId,
}: SettingsPageClientProps) {
  const settings = (tenant.settings || {}) as Record<string, unknown>
  const publicBookingEnabled = (settings.online_booking_enabled as boolean) ?? false

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-forest">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie as configurações da sua clínica.
        </p>
      </div>

      <Tabs defaultValue="clinica">
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="clinica">
            <BuildingIcon data-icon="inline-start" />
            Clínica
          </TabsTrigger>
          <TabsTrigger value="procedimentos">
            <SyringeIcon data-icon="inline-start" />
            Procedimentos
          </TabsTrigger>
          <TabsTrigger value="equipe">
            <UsersIcon data-icon="inline-start" />
            Equipe
          </TabsTrigger>
          <TabsTrigger value="termos">
            <FileTextIcon data-icon="inline-start" />
            Termos
          </TabsTrigger>
          <TabsTrigger value="agendamento">
            <CalendarIcon data-icon="inline-start" />
            Agendamento
          </TabsTrigger>
          <TabsTrigger value="auditoria">
            <ShieldCheckIcon data-icon="inline-start" />
            Auditoria
          </TabsTrigger>
        </TabsList>

        <TabsContent value="clinica" className="pt-6">
          <ClinicSettingsForm
            initialData={{
              name: tenant.name,
              phone: tenant.phone,
              email: tenant.email,
              address: tenant.address as Record<string, string> | null,
              workingHours: tenant.workingHours as import('@/validations/tenant').WorkingHours | null,
            }}
          />
        </TabsContent>

        <TabsContent value="procedimentos" className="pt-6">
          <ProcedureTypeList procedureTypes={procedureTypes} />
        </TabsContent>

        <TabsContent value="equipe" className="pt-6">
          <TeamList members={members} currentUserId={currentUserId} />
        </TabsContent>

        <TabsContent value="termos" className="pt-6">
          <ConsentTemplateList templates={consentTemplates} />
        </TabsContent>

        <TabsContent value="agendamento" className="pt-6">
          <BookingSettings
            slug={tenant.slug}
            publicBookingEnabled={publicBookingEnabled}
          />
        </TabsContent>

        <TabsContent value="auditoria" className="pt-6">
          <AuditLogViewer />
        </TabsContent>
      </Tabs>
    </div>
  )
}
