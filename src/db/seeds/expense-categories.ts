import { db } from '@/db/client'
import { expenseCategories } from '@/db/schema'

const defaults = [
  { name: 'Aluguel', icon: 'home', sortOrder: 0 },
  { name: 'Materiais/Insumos', icon: 'package', sortOrder: 1 },
  { name: 'Folha de Pagamento', icon: 'users', sortOrder: 2 },
  { name: 'Marketing', icon: 'megaphone', sortOrder: 3 },
  { name: 'Equipamentos', icon: 'monitor', sortOrder: 4 },
  { name: 'Impostos/Taxas', icon: 'receipt', sortOrder: 5 },
  { name: 'Serviços Terceirizados', icon: 'briefcase', sortOrder: 6 },
  { name: 'Manutenção', icon: 'wrench', sortOrder: 7 },
  { name: 'Outros', icon: 'circle', sortOrder: 8 },
]

export async function seedExpenseCategories() {
  for (const cat of defaults) {
    await db.insert(expenseCategories).values({
      ...cat,
      tenantId: null,
      isSystem: true,
    }).onConflictDoNothing()
  }
}
