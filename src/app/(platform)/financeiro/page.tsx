import type { Metadata } from 'next'
import { getAuthContext } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'Financeiro | FloraClin',
}
import { listPatients } from '@/db/queries/patients'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FinancialList } from '@/components/financial/financial-list'
import { RevenueChart } from '@/components/financial/revenue-chart'

export default async function FinanceiroPage() {
  const context = await getAuthContext()

  // Load patients for the payment form select
  const patientsResult = await listPatients(context.tenantId, { limit: 500 })
  const patients = patientsResult.data.map((p) => ({
    id: p.id,
    fullName: p.fullName,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-forest">Financeiro</h1>
        <p className="text-mid mt-1">
          Gerencie cobranças, parcelas e visualize o desempenho financeiro.
        </p>
      </div>

      <Tabs defaultValue="receivables">
        <TabsList>
          <TabsTrigger value="receivables">A Receber</TabsTrigger>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
        </TabsList>

        <TabsContent value="receivables">
          <FinancialList patients={patients} />
        </TabsContent>

        <TabsContent value="overview">
          <RevenueChart />
        </TabsContent>
      </Tabs>
    </div>
  )
}
