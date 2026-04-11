import {
  CircleIcon,
  HomeIcon,
  ZapIcon,
  DropletIcon,
  WrenchIcon,
  ShoppingCartIcon,
  TruckIcon,
  UsersIcon,
  BookOpenIcon,
  CreditCardIcon,
  BuildingIcon,
  PhoneIcon,
  PrinterIcon,
  ShieldIcon,
  HeartIcon,
  PackageIcon,
  ScissorsIcon,
  SparklesIcon,
  type LucideIcon,
} from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  circle: CircleIcon,
  home: HomeIcon,
  zap: ZapIcon,
  droplet: DropletIcon,
  wrench: WrenchIcon,
  shopping_cart: ShoppingCartIcon,
  'shopping-cart': ShoppingCartIcon,
  truck: TruckIcon,
  users: UsersIcon,
  book_open: BookOpenIcon,
  'book-open': BookOpenIcon,
  credit_card: CreditCardIcon,
  'credit-card': CreditCardIcon,
  building: BuildingIcon,
  phone: PhoneIcon,
  printer: PrinterIcon,
  shield: ShieldIcon,
  heart: HeartIcon,
  package: PackageIcon,
  scissors: ScissorsIcon,
  sparkles: SparklesIcon,
}

/**
 * Returns a lucide-react icon component for the given icon name string.
 * Falls back to CircleIcon if the name is not recognized.
 */
export function getCategoryIcon(iconName: string | null | undefined): LucideIcon {
  if (!iconName) return CircleIcon
  return ICON_MAP[iconName.toLowerCase()] ?? CircleIcon
}
