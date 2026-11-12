import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  CreditCard,
  GraduationCap,
  MessageSquare,
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

/**
 * Ítems bloqueados por club: visibles en el sidebar pero no clickeables, y la URL
 * directa redirige a /admin/agenda. Solo aplica a admins/owners del club indicado
 * (clave = slug del club), el resto de los clubes no se ve afectado.
 */
export const CLUB_LOCKED_SIDEBAR_ITEMS: Record<string, Set<string>> = {};

/**
 * Secciones que todavía no existen: no se muestran en el menú (un ítem gris sin uso parece roto).
 * Para mostrarlas deshabilitadas, sumarlas a PLAYGROUND_SIDEBAR_ITEMS con disabled: true.
 */
export const UPCOMING_SIDEBAR_ITEMS: PlaygroundSidebarItem[] = [];

export const PLAYGROUND_SIDEBAR_ITEMS: PlaygroundSidebarItem[] = [
  { label: 'Calendario', icon: CalendarDays, href: '/admin/agenda', minAccess: 'operator' },
  { label: 'Reservas', icon: ClipboardList, href: '/admin/reservas', minAccess: 'operator' },
  { label: 'Clientes', icon: Users, href: '/admin/clientes', minAccess: 'admin' },
  { label: 'Academia', icon: GraduationCap, href: '/admin/academia?tab=clases', minAccess: 'admin' },
  { label: 'Caja', icon: CreditCard, href: '/admin/caja', minAccess: 'operator' },
  { label: 'Facturación', icon: ScrollText, href: '/admin/facturacion', minAccess: 'admin' },
  { label: 'Tienda', icon: ShoppingBag, href: '/admin/tienda', minAccess: 'admin' },
  { label: 'Mensajes', icon: MessageSquare, href: '/admin/mensajes', minAccess: 'admin' },
  { label: 'Informes', icon: BarChart3, href: '/admin/informes', minAccess: 'operator' },
  { label: 'Ajustes', icon: Settings, href: '/admin/ajustes', minAccess: 'admin' },
];
