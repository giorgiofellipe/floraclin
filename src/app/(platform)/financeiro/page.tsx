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
        <h1 className="text-2xl font-semibold text-[#2A2A2A] tracking-tight">Financeiro</h1>
        <p className="text-sm text-mid mt-0.5">
          Gerencie cobranças, parcelas e visualize o desempenho financeiro.
        </p>
      </div>

      <Tabs defaultValue="receivables">
        <TabsList className="bg-transparent border-b border-sage/10 rounded-none p-0 h-auto gap-0">
          <TabsTrigger value="receivables" className="rounded-none border-b-2 border-transparent data-[state=active]:border-sage data-[state=active]:bg-transparent data-[state=active]:text-forest data-[state=active]:shadow-none text-mid px-5 py-2.5 font-medium transition-colors hover:text-forest">A Receber</TabsTrigger>
          <TabsTrigger value="overview" className="rounded-none border-b-2 border-transparent data-[state=active]:border-sage data-[state=active]:bg-transparent data-[state=active]:text-forest data-[state=active]:shadow-none text-mid px-5 py-2.5 font-medium transition-colors hover:text-forest">Visao Geral</TabsTrigger>
        </TabsList>

        <TabsContent value="receivables" className="mt-6">
          <FinancialList patients={patients} />
        </TabsContent>

        <TabsContent value="overview" className="mt-6">
          <RevenueChart />
        </TabsContent>
      </Tabs>
    </div>
  )
}
