import {
  BarChart3,
  CalendarDays,
  CreditCard,
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
  /**
   * Fase 1.3: si `disabled` es true, el ítem es visible en el sidebar pero NO clickeable.
   * No navega, no tiene estado activo, y la URL directa redirige a /admin/agenda.
   * Tooltip: "Disponible más adelante".
   */
  disabled?: boolean;
};

export const PLAYGROUND_SIDEBAR_ITEMS: PlaygroundSidebarItem[] = [
  { label: 'Calendario', icon: CalendarDays, href: '/admin/agenda' },
  { label: 'Clientes', icon: Users, href: '/admin/clientes' },
  { label: 'Caja', icon: CreditCard, href: '/admin/caja' },
  { label: 'Reservas', icon: Receipt, href: '/admin/reservas', disabled: true },
  { label: 'Tienda', icon: ShoppingBag, href: '/admin/tienda' },
  { label: 'Mensajes', icon: MessageSquare, href: '/admin/mensajes', disabled: true },
  { label: 'Facturacion', icon: ScrollText, href: '/admin/facturacion', disabled: true },
  { label: 'Informes', icon: BarChart3, href: '/admin/informes' },
  { label: 'Ajustes', icon: Settings, href: '/admin/ajustes' },
];
