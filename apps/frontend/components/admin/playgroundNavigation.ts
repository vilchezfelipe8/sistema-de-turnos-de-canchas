import {
  BarChart3,
  CalendarDays,
  CreditCard,
  GraduationCap,
  MessageSquare,
  Receipt,
  ScrollText,
  Settings,
  ShoppingBag,
  Users,
} from 'lucide-react';

export type PlaygroundSidebarItem = {
  label: string;
  icon: typeof CalendarDays;
  href: string;
  minAccess?: 'operator' | 'admin';
  /**
   * Fase 1.3: si `disabled` es true, el ítem es visible en el sidebar pero NO clickeable.
   * No navega, no tiene estado activo, y la URL directa redirige a /admin/agenda.
   * Tooltip: "Disponible más adelante".
   */
  disabled?: boolean;
};

export const PLAYGROUND_SIDEBAR_ITEMS: PlaygroundSidebarItem[] = [
  { label: 'Calendario', icon: CalendarDays, href: '/admin/agenda', minAccess: 'operator' },
  { label: 'Clientes', icon: Users, href: '/admin/clientes', minAccess: 'admin' },
  { label: 'Academia', icon: GraduationCap, href: '/admin/academia?tab=clases', minAccess: 'admin' },
  { label: 'Caja', icon: CreditCard, href: '/admin/caja', minAccess: 'operator' },
  { label: 'Reservas', icon: Receipt, href: '/admin/reservas', disabled: true, minAccess: 'admin' },
  { label: 'Tienda', icon: ShoppingBag, href: '/admin/tienda', minAccess: 'admin' },
  { label: 'Mensajes', icon: MessageSquare, href: '/admin/mensajes', disabled: true, minAccess: 'admin' },
  { label: 'Facturacion', icon: ScrollText, href: '/admin/facturacion', minAccess: 'admin' },
  { label: 'Informes', icon: BarChart3, href: '/admin/informes', minAccess: 'operator' },
  { label: 'Ajustes', icon: Settings, href: '/admin/ajustes', minAccess: 'admin' },
];
