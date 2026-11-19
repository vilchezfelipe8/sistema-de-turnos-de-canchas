import {
  CalendarCheck,
  CalendarClock,
  Dumbbell,
  Home,
  LayoutGrid,
  Plug,
  Receipt,
  Repeat,
  ScrollText,
  Tag,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type SettingsTab =
  | 'club'
  | 'canchas'
  | 'horarios'
  | 'reservas'
  | 'precios'
  | 'facturacion'
  | 'socios'
  | 'planes'
  | 'turnero'
  | 'usuarios'
  | 'integraciones'
  | 'auditoria';

export type SettingsTabMeta = {
  value: SettingsTab;
  label: string;
  /** Línea corta para el menú. */
  hint: string;
  /** Bajada del encabezado de la página. */
  description: string;
  icon: LucideIcon;
};

export const SETTINGS_GROUPS: Array<{ title: string; items: SettingsTabMeta[] }> = [
  {
    title: 'El club',
    items: [
      {
        value: 'club',
        label: 'Club',
        hint: 'Perfil, fotos, contacto y reseñas',
        description: 'Cómo te ven los jugadores en la app: nombre, fotos, dirección, contacto y opiniones.',
        icon: Home,
      },
      {
        value: 'canchas',
        label: 'Canchas',
        hint: 'Canchas, deportes y precio base',
        description: 'Las canchas del club, su deporte y el precio base del turno.',
        icon: LayoutGrid,
      },
      {
        value: 'horarios',
        label: 'Horarios',
        hint: 'Apertura, modalidades y feriados',
        description: 'Qué días abre el club, en qué horarios se reserva cada deporte y los días especiales.',
        icon: CalendarClock,
      },
    ],
  },
  {
    title: 'Reservas y cobros',
    items: [
      {
        value: 'reservas',
        label: 'Reservas',
        hint: 'Confirmación, seña y ventanas',
        description: 'Cómo se confirma una reserva, la seña online y desde qué hora reserva cada jugador.',
        icon: CalendarCheck,
      },
      {
        value: 'precios',
        label: 'Precios y caja',
        hint: 'Por cancha o jugador, descuentos y caja',
        description: 'Cómo se cobra el turno, descuentos por medio de pago, luces y reglas de la caja.',
        icon: Tag,
      },
      {
        value: 'facturacion',
        label: 'Facturación',
        hint: 'Factura electrónica con ARCA',
        description: 'Datos fiscales del club y factura electrónica con ARCA.',
        icon: Receipt,
      },
    ],
  },
  {
    title: 'Socios y gimnasio',
    items: [
      {
        value: 'socios',
        label: 'Socios',
        hint: 'Padrón y categorías',
        description: 'Activá el padrón de socios y sus categorías con precio diferencial.',
        icon: Users,
      },
      {
        value: 'planes',
        label: 'Planes',
        hint: 'Abonos, cuotas y vencimientos',
        description: 'Los planes que vende el club: qué incluyen, cuánto cuestan y cada cuánto se pagan.',
        icon: Repeat,
      },
      {
        value: 'turnero',
        label: 'Turnero',
        hint: 'Gimnasio y espacios con cupo',
        description: 'Actividades con cupo por franja horaria, como musculación, y el ingreso al club.',
        icon: Dumbbell,
      },
    ],
  },
  {
    title: 'Equipo y sistema',
    items: [
      {
        value: 'usuarios',
        label: 'Usuarios',
        hint: 'Quién entra al panel',
        description: 'Las personas que entran al panel del club y qué puede hacer cada una.',
        icon: UserCog,
      },
      {
        value: 'integraciones',
        label: 'Integraciones',
        hint: 'Mercado Pago y otros servicios',
        description: 'Servicios conectados al club, como Mercado Pago.',
        icon: Plug,
      },
      {
        value: 'auditoria',
        label: 'Auditoría',
        hint: 'Registro de cambios',
        description: 'Quién cambió los ajustes del club y qué cambió.',
        icon: ScrollText,
      },
    ],
  },
];

export const SETTINGS_TABS: SettingsTabMeta[] = SETTINGS_GROUPS.flatMap((group) => group.items);

export const getSettingsTabMeta = (tab: SettingsTab): SettingsTabMeta =>
  SETTINGS_TABS.find((item) => item.value === tab) ?? SETTINGS_TABS[0];

// Nombres viejos o en inglés que pueden venir en links guardados.
const LEGACY_TAB_ALIASES: Record<string, SettingsTab> = {
  identity: 'club',
  resenas: 'club',
  'reseñas': 'club',
  reviews: 'club',
  review: 'club',
  operation: 'reservas',
  agenda: 'horarios',
  actividades: 'horarios',
  excepciones: 'horarios',
  discounts: 'precios',
  caja: 'precios',
  audit: 'auditoria',
  members: 'socios',
  plans: 'planes',
  gimnasio: 'turnero',
};

export const parseSettingsTab = (value: unknown): SettingsTab => {
  const raw = String(value || '').trim().toLowerCase();
  if (SETTINGS_TABS.some((item) => item.value === raw)) return raw as SettingsTab;
  return LEGACY_TAB_ALIASES[raw] ?? 'club';
};
