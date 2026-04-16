import {
  SyringeIcon, PillIcon, HeartIcon, ScissorsIcon, SparklesIcon, DropletsIcon, ShieldIcon,
  HomeIcon, BuildingIcon, WrenchIcon, LightbulbIcon, WifiIcon, SprayCanIcon, PrinterIcon,
  UsersIcon, BriefcaseIcon, GraduationCapIcon, ScaleIcon,
  CreditCardIcon, ReceiptIcon, WalletIcon, PackageIcon, TruckIcon,
  MegaphoneIcon, PhoneIcon, MonitorIcon,
  CoffeeIcon, CircleIcon,
  ZapIcon, DropletIcon, ShoppingCartIcon, BookOpenIcon, CarIcon, GlobeIcon,
  type LucideIcon,
} from 'lucide-react'

export interface ExpenseIconOption {
  value: string
  label: string
  icon: LucideIcon
}

export const EXPENSE_ICON_OPTIONS: ExpenseIconOption[] = [
  { value: 'syringe', label: 'Injetáveis', icon: SyringeIcon },
  { value: 'pill', label: 'Farmácia', icon: PillIcon },
  { value: 'heart', label: 'Bem-estar', icon: HeartIcon },
  { value: 'scissors', label: 'Estética', icon: ScissorsIcon },
  { value: 'sparkles', label: 'Cosmético', icon: SparklesIcon },
  { value: 'droplets', label: 'Skincare', icon: DropletsIcon },
  { value: 'shield', label: 'Seguro', icon: ShieldIcon },
  { value: 'home', label: 'Aluguel', icon: HomeIcon },
  { value: 'building', label: 'Estrutura', icon: BuildingIcon },
  { value: 'wrench', label: 'Manutenção', icon: WrenchIcon },
  { value: 'lightbulb', label: 'Utilidades', icon: LightbulbIcon },
  { value: 'wifi', label: 'Internet', icon: WifiIcon },
  { value: 'spray-can', label: 'Limpeza', icon: SprayCanIcon },
  { value: 'printer', label: 'Escritório', icon: PrinterIcon },
  { value: 'users', label: 'Pessoal', icon: UsersIcon },
  { value: 'briefcase', label: 'Serviços', icon: BriefcaseIcon },
  { value: 'graduation-cap', label: 'Cursos', icon: GraduationCapIcon },
  { value: 'scale', label: 'Jurídico', icon: ScaleIcon },
  { value: 'credit-card', label: 'Pagamentos', icon: CreditCardIcon },
  { value: 'receipt', label: 'Impostos', icon: ReceiptIcon },
  { value: 'wallet', label: 'Finanças', icon: WalletIcon },
  { value: 'package', label: 'Insumos', icon: PackageIcon },
  { value: 'truck', label: 'Frete', icon: TruckIcon },
  { value: 'megaphone', label: 'Marketing', icon: MegaphoneIcon },
  { value: 'phone', label: 'Telecom', icon: PhoneIcon },
  { value: 'monitor', label: 'Equipamento', icon: MonitorIcon },
  { value: 'coffee', label: 'Copa', icon: CoffeeIcon },
  { value: 'circle', label: 'Outros', icon: CircleIcon },
]

const ICON_MAP = new Map<string, LucideIcon>(
  EXPENSE_ICON_OPTIONS.map((o) => [o.value, o.icon]),
)

// Legacy aliases for backward compatibility with existing DB records
const LEGACY_ALIASES: [string, LucideIcon][] = [
  ['zap', ZapIcon],
  ['droplet', DropletIcon],
  ['shopping_cart', ShoppingCartIcon],
  ['shopping-cart', ShoppingCartIcon],
  ['book_open', BookOpenIcon],
  ['book-open', BookOpenIcon],
  ['credit_card', CreditCardIcon],
  ['car', CarIcon],
  ['globe', GlobeIcon],
]

for (const [key, icon] of LEGACY_ALIASES) {
  if (!ICON_MAP.has(key)) ICON_MAP.set(key, icon)
}

export function getExpenseIcon(iconName: string | null | undefined): LucideIcon {
  if (!iconName) return CircleIcon
  return ICON_MAP.get(iconName.toLowerCase()) ?? CircleIcon
}
