import {
  ArrowUpRight,
  BarChart3,
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  CreditCard,
  Download,
  Edit3,
  Filter,
  LayoutDashboard,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Package,
  PanelRightOpen,
  Plus,
  Receipt,
  Save,
  Search,
  Settings,
  ShoppingBag,
  SlidersHorizontal,
  Tag,
  UserPlus,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import styles from './AdminV2DesignSystemPreview.module.css';

type PreviewSection =
  | 'system'
  | 'components'
  | 'agenda'
  | 'caja'
  | 'clientes'
  | 'reservas'
  | 'tienda'
  | 'informes'
  | 'ajustes';

type BadgeTone = 'neutral' | 'blue' | 'green' | 'red' | 'yellow';
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type MetricTone = 'neutral' | 'positive' | 'negative' | 'warning';
type TimelineTone = 'income' | 'expense' | 'warning' | 'neutral';

type NavItem = {
  id: PreviewSection;
  label: string;
  icon: ReactNode;
  benchmark: string;
};

type TableColumn = {
  key: string;
  label: string;
  align?: 'left' | 'right';
};

type TableRow = {
  id: string;
  cells: Record<string, ReactNode>;
};

type TimelineItem = {
  id: string;
  time: string;
  label: string;
  detail: string;
  amount?: string;
  tone?: TimelineTone;
};

type Metric = {
  label: string;
  value: string;
  detail: string;
  tone?: MetricTone;
};

type ReservationBlock = {
  id: string;
  court: number;
  row: number;
  span: number;
  client: string;
  meta: string;
  status: string;
  tone: 'paid' | 'debt' | 'pending' | 'free';
};

const navItems: NavItem[] = [
  {
    id: 'system',
    label: 'Sistema',
    icon: <LayoutDashboard size={18} />,
    benchmark: 'Documento maestro + tokens base',
  },
  {
    id: 'components',
    label: 'Componentes',
    icon: <PanelRightOpen size={18} />,
    benchmark: 'Stripe, Linear, Supabase',
  },
  {
    id: 'agenda',
    label: 'Agenda',
    icon: <CalendarDays size={18} />,
    benchmark: 'Google Calendar + Playtomic',
  },
  {
    id: 'caja',
    label: 'Caja',
    icon: <WalletCards size={18} />,
    benchmark: 'Stripe + POS',
  },
  {
    id: 'clientes',
    label: 'Clientes',
    icon: <Users size={18} />,
    benchmark: 'Linear + Stripe Customer',
  },
  {
    id: 'reservas',
    label: 'Reservas',
    icon: <ClipboardList size={18} />,
    benchmark: 'Linear + Supabase + Airtable',
  },
  {
    id: 'tienda',
    label: 'Tienda',
    icon: <ShoppingBag size={18} />,
    benchmark: 'Shopify + Supabase Products',
  },
  {
    id: 'informes',
    label: 'Informes',
    icon: <BarChart3 size={18} />,
    benchmark: 'Vercel + Stripe Analytics',
  },
  {
    id: 'ajustes',
    label: 'Ajustes',
    icon: <Settings size={18} />,
    benchmark: 'Notion + Stripe Settings',
  },
];

const tokenColors = [
  { name: 'accent', value: '#3053e2' },
  { name: 'accentBg', value: '#eef1fd' },
  { name: 'text-1', value: '#1a2035' },
  { name: 'text-3', value: '#4e5870' },
  { name: 'text-5', value: '#98a1b3' },
  { name: 'border', value: '#dce2ee' },
  { name: 'bg-1', value: '#ffffff' },
  { name: 'bg-2', value: '#f8f9fc' },
  { name: 'green', value: '#167647' },
  { name: 'red', value: '#b42318' },
  { name: 'yellow', value: '#92400e' },
  { name: 'blue', value: '#1d4ed8' },
];

const metrics: Metric[] = [
  { label: 'Ingresos del turno', value: '$184.000', detail: '+12% vs semana anterior', tone: 'positive' },
  { label: 'Reservas de hoy', value: '47', detail: '+5 vs ayer', tone: 'positive' },
  { label: 'Ocupacion', value: '68%', detail: '+4 puntos', tone: 'positive' },
  { label: 'Deuda pendiente', value: '$12.400', detail: '-$2.100 vs ayer', tone: 'negative' },
];

const cashMetrics: Metric[] = [
  { label: 'Total cobrado', value: '$96.500', detail: 'Caja abierta desde 09:00', tone: 'positive' },
  { label: 'Pendiente', value: '$18.200', detail: '6 cuentas con deuda', tone: 'warning' },
  { label: 'Cuentas abiertas', value: '12', detail: '3 requieren accion', tone: 'neutral' },
  { label: 'Ticket promedio', value: '$4.850', detail: '+8% vs turno anterior', tone: 'positive' },
];

const agendaBlocks: ReservationBlock[] = [
  {
    id: 'b1',
    court: 1,
    row: 2,
    span: 2,
    client: 'Juan Perez',
    meta: '08:30 - 10:00 · 90m',
    status: '$3.000 pendiente',
    tone: 'debt',
  },
  {
    id: 'b2',
    court: 2,
    row: 3,
    span: 1,
    client: 'Maria Garcia',
    meta: '09:00 - 10:00 · 60m',
    status: 'Pagada',
    tone: 'paid',
  },
  {
    id: 'b3',
    court: 3,
    row: 4,
    span: 2,
    client: 'Lucas Diaz',
    meta: '10:00 - 11:30 · 90m',
    status: 'Confirmada',
    tone: 'pending',
  },
  {
    id: 'b4',
    court: 1,
    row: 6,
    span: 1,
    client: 'Slot libre',
    meta: '12:00 - 13:00',
    status: 'Crear reserva',
    tone: 'free',
  },
  {
    id: 'b5',
    court: 2,
    row: 7,
    span: 2,
    client: 'Federico Ruiz',
    meta: '13:00 - 14:30 · 90m',
    status: 'Sena pagada',
    tone: 'paid',
  },
];

const timelineItems: TimelineItem[] = [
  {
    id: 'm1',
    time: '10:32',
    label: 'Juan Perez · Efectivo',
    detail: 'Reserva Cancha 1 · 19:00',
    amount: '+$3.000',
    tone: 'income',
  },
  {
    id: 'm2',
    time: '10:15',
    label: 'Maria Garcia · Transferencia',
    detail: 'Reserva Cancha 2 · 20:30',
    amount: '+$2.500',
    tone: 'income',
  },
  {
    id: 'm3',
    time: '09:45',
    label: 'Descuento aplicado',
    detail: 'Ajuste manual · Cliente frecuente',
    amount: '-$500',
    tone: 'expense',
  },
  {
    id: 'm4',
    time: '09:12',
    label: 'Venta mostrador',
    detail: 'Agua x2 · Gatorade x1',
    amount: '+$3.800',
    tone: 'income',
  },
];

const clientTimeline: TimelineItem[] = [
  {
    id: 'c1',
    time: 'Hoy',
    label: 'Reserva creada',
    detail: 'Cancha 1 · 19:00 · pendiente de cobro',
    amount: '$3.000',
    tone: 'warning',
  },
  {
    id: 'c2',
    time: 'Ayer',
    label: 'Pago registrado',
    detail: 'Transferencia · Cuenta #TC-1021',
    amount: '+$2.500',
    tone: 'income',
  },
  {
    id: 'c3',
    time: 'Lun',
    label: 'Consumo agregado',
    detail: 'Alquiler de paleta · Mostrador',
    amount: '$1.200',
    tone: 'neutral',
  },
];

const reservationRows: TableRow[] = [
  {
    id: 'r1',
    cells: {
      cliente: <Identity name="Juan Perez" detail="351 555 0121" initials="JP" />,
      cancha: 'Cancha 1',
      fecha: 'Hoy',
      horario: '19:00 · 90m',
      estado: <Badge tone="yellow">Con deuda</Badge>,
      total: '$3.000',
      acciones: <RowActions />,
    },
  },
  {
    id: 'r2',
    cells: {
      cliente: <Identity name="Maria Garcia" detail="351 555 0188" initials="MG" />,
      cancha: 'Cancha 2',
      fecha: 'Hoy',
      horario: '20:30 · 60m',
      estado: <Badge tone="green">Pagada</Badge>,
      total: '$2.500',
      acciones: <RowActions />,
    },
  },
  {
    id: 'r3',
    cells: {
      cliente: <Identity name="Lucas Diaz" detail="351 555 0199" initials="LD" />,
      cancha: 'Cancha 3',
      fecha: 'Manana',
      horario: '18:00 · 90m',
      estado: <Badge tone="blue">Confirmada</Badge>,
      total: '$3.200',
      acciones: <RowActions />,
    },
  },
  {
    id: 'r4',
    cells: {
      cliente: <Identity name="Sofia Molina" detail="351 555 0144" initials="SM" />,
      cancha: 'Cancha 1',
      fecha: 'Vie 03',
      horario: '21:00 · 60m',
      estado: <Badge tone="red">Cancelada</Badge>,
      total: '$0',
      acciones: <RowActions />,
    },
  },
];

const productRows: TableRow[] = [
  {
    id: 'p1',
    cells: {
      producto: <ProductCell name="Agua mineral" detail="Bebidas" tone="blue" />,
      stock: <StockLabel amount="34 unidades" />,
      precio: '$1.200',
      estado: <Badge tone="green">Publicado</Badge>,
      acciones: <RowActions />,
    },
  },
  {
    id: 'p2',
    cells: {
      producto: <ProductCell name="Gatorade" detail="Bebidas" tone="yellow" />,
      stock: <StockLabel amount="5 unidades" warning />,
      precio: '$2.100',
      estado: <Badge tone="yellow">Bajo stock</Badge>,
      acciones: <RowActions />,
    },
  },
  {
    id: 'p3',
    cells: {
      producto: <ProductCell name="Pelotas tubo x3" detail="Insumos" tone="green" />,
      stock: <StockLabel amount="0 unidades" danger />,
      precio: '$8.500',
      estado: <Badge tone="red">Sin stock</Badge>,
      acciones: <RowActions />,
    },
  },
  {
    id: 'p4',
    cells: {
      producto: <ProductCell name="Alquiler de paleta" detail="Servicios" tone="neutral" />,
      stock: <StockLabel amount="Servicio" />,
      precio: '$1.500',
      estado: <Badge tone="blue">Activo</Badge>,
      acciones: <RowActions />,
    },
  },
];

const tableColumns: TableColumn[] = [
  { key: 'cliente', label: 'Cliente' },
  { key: 'cancha', label: 'Cancha' },
  { key: 'fecha', label: 'Fecha' },
  { key: 'horario', label: 'Horario' },
  { key: 'estado', label: 'Estado' },
  { key: 'total', label: 'Total', align: 'right' },
  { key: 'acciones', label: '', align: 'right' },
];

const productColumns: TableColumn[] = [
  { key: 'producto', label: 'Producto' },
  { key: 'stock', label: 'Stock' },
  { key: 'precio', label: 'Precio', align: 'right' },
  { key: 'estado', label: 'Estado' },
  { key: 'acciones', label: '', align: 'right' },
];

const customers = [
  { name: 'Juan Perez', phone: '351 555 0121', tag: 'Con deuda', tone: 'yellow' as BadgeTone, balance: '$3.000' },
  { name: 'Maria Garcia', phone: '351 555 0188', tag: 'Al dia', tone: 'green' as BadgeTone, balance: '$0' },
  { name: 'Lucas Diaz', phone: '351 555 0199', tag: 'Frecuente', tone: 'blue' as BadgeTone, balance: '$1.200' },
  { name: 'Sofia Molina', phone: '351 555 0144', tag: 'Nueva', tone: 'neutral' as BadgeTone, balance: '$0' },
];

const accountCards = [
  {
    owner: 'Juan Perez',
    meta: 'Reserva · Hoy 19:00 · Cancha 1',
    total: '$3.000',
    paid: '$0',
    debt: '$3.000',
    tone: 'debt',
  },
  {
    owner: 'Maria Garcia',
    meta: 'Reserva · Hoy 20:30 · Cancha 2',
    total: '$2.500',
    paid: '$2.500',
    debt: '$0',
    tone: 'paid',
  },
  {
    owner: 'Club / Venta manual',
    meta: 'Consumo · Mostrador',
    total: '$4.200',
    paid: '$2.800',
    debt: '$1.400',
    tone: 'debt',
  },
];

const chartBars = [44, 62, 58, 75, 68, 86, 72];
const ranking = [
  ['Cancha 1', '31 reservas', '82%'],
  ['Cancha 2', '24 reservas', '68%'],
  ['Cancha 3', '19 reservas', '54%'],
];

export default function AdminV2DesignSystemPreview() {
  const [section, setSection] = useState<PreviewSection>('system');
  const current = navItems.find((item) => item.id === section) ?? navItems[0];

  const content = useMemo(() => {
    switch (section) {
      case 'system':
        return <DesignSystemBase />;
      case 'components':
        return <ComponentsPreview />;
      case 'agenda':
        return <AgendaPreview />;
      case 'caja':
        return <CajaPreview />;
      case 'clientes':
        return <ClientesPreview />;
      case 'reservas':
        return <ReservasPreview />;
      case 'tienda':
        return <TiendaPreview />;
      case 'informes':
        return <InformesPreview />;
      case 'ajustes':
        return <AjustesPreview />;
      default:
        return null;
    }
  }, [section]);

  return (
    <div className={styles.previewRoot}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.logoMark}>TC</div>
          <div>
            <strong>TuCancha</strong>
            <span>Admin v2 preview</span>
          </div>
        </div>
        <nav className={styles.sidebarNav} aria-label="Preview sections">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.navItem} ${section === item.id ? styles.navItemActive : ''}`}
              onClick={() => setSection(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <div className={styles.avatar}>FR</div>
          <div>
            <strong>Club Demo Norte</strong>
            <span>Operador</span>
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}>
          <div>
            <span className={styles.eyebrow}>Visual Preview</span>
            <h1>{current.label}</h1>
            <p>{current.benchmark}</p>
          </div>
          <div className={styles.topbarActions}>
            <div className={styles.searchBox}>
              <Search size={16} />
              <span>Buscar modulo, cliente o reserva...</span>
            </div>
            <IconButton label="Notificaciones">
              <Bell size={17} />
            </IconButton>
            <Button icon={<Plus size={16} />}>Nueva reserva</Button>
          </div>
        </header>
        <div className={styles.content}>{content}</div>
      </main>

      <nav className={styles.mobileBar} aria-label="Mobile preview navigation">
        {navItems.slice(2, 6).map((item) => (
          <button
            key={item.id}
            type="button"
            className={section === item.id ? styles.mobileActive : ''}
            onClick={() => setSection(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
        <button type="button" onClick={() => setSection('system')}>
          <Menu size={18} />
          <span>Mas</span>
        </button>
      </nav>
    </div>
  );
}

function DesignSystemBase() {
  return (
    <div className={styles.stack}>
      <ModuleHeader
        label="Design System base"
        title="Tokens sobrios para operacion diaria"
        description="Fondo gris, paneles blancos, bordes visibles, radio de 8px y una unica familia tipografica de sistema."
        actions={<Button icon={<Download size={16} />} variant="secondary">Exportar tokens</Button>}
      />

      <section className={styles.tokenGrid}>
        {tokenColors.map((token) => (
          <div className={styles.tokenCard} key={token.name}>
            <span className={styles.swatch} style={{ backgroundColor: token.value }} />
            <strong>{token.name}</strong>
            <code>{token.value}</code>
          </div>
        ))}
      </section>

      <section className={styles.twoColumn}>
        <div className={styles.panel}>
          <PanelTitle title="Tipografia" meta="Inter / System UI" />
          <div className={styles.typeScale}>
            {[
              ['11px', 'Metadata, badges, labels de seccion'],
              ['12px', 'Labels, ayuda, textos secundarios'],
              ['13px', 'Tablas, inputs, subtextos'],
              ['14px', 'Texto principal y navegacion'],
              ['20px', 'Titulos de pagina'],
              ['28px', 'KPIs y valores principales'],
            ].map(([size, use]) => (
              <div key={size}>
                <span>{size}</span>
                <p>{use}</p>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.panel}>
          <PanelTitle title="Estructura" meta="Bordes, radios, estados" />
          <div className={styles.specList}>
            <Spec label="Fondo app" value="#f5f6f8" />
            <Spec label="Panel" value="#ffffff + border #dce2ee" />
            <Spec label="Radius base" value="8px en cards y tablas" />
            <Spec label="Sombras" value="Sin sombra en paneles operativos" />
            <Spec label="Acciones" value="Primaria azul, secundaria white border" />
            <Spec label="Estados" value="Green, red, yellow, blue con fondos suaves" />
          </div>
        </div>
      </section>
    </div>
  );
}

function ComponentsPreview() {
  const compactRows: TableRow[] = reservationRows.slice(0, 3);

  return (
    <div className={styles.stack}>
      <ModuleHeader
        label="Componentes base"
        title="Primitivos mock, hardcodeados y descartables"
        description="Los componentes estan aca solo para validar lenguaje visual y patrones de interaccion."
        actions={<Button icon={<UserPlus size={16} />}>Nuevo cliente</Button>}
      />

      <section className={styles.componentGrid}>
        <div className={styles.panel}>
          <PanelTitle title="Button, Input, Badge, Tabs" />
          <div className={styles.componentStack}>
            <div className={styles.inlineWrap}>
              <Button>Primario</Button>
              <Button variant="secondary">Secundario</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Cancelar</Button>
            </div>
            <InputMock placeholder="Buscar por nombre o telefono" />
            <div className={styles.inlineWrap}>
              <Badge tone="green">Pagado</Badge>
              <Badge tone="yellow">Con deuda</Badge>
              <Badge tone="blue">Confirmada</Badge>
              <Badge tone="red">Cancelada</Badge>
            </div>
            <Tabs tabs={['Todas', 'Hoy', 'Pendientes', 'Con deuda']} active="Hoy" />
          </div>
        </div>

        <div className={styles.panel}>
          <PanelTitle title="MetricCard" meta="KPIs estilo Stripe/Vercel" />
          <div className={styles.metricGridCompact}>
            {metrics.slice(0, 2).map((metric) => (
              <MetricCard key={metric.label} {...metric} />
            ))}
          </div>
        </div>

        <div className={styles.panel}>
          <PanelTitle title="FilterChip + EmptyState + Skeleton" />
          <div className={styles.inlineWrap}>
            <FilterChip>Hoy</FilterChip>
            <FilterChip>Cancha 1</FilterChip>
            <FilterChip>Con deuda</FilterChip>
          </div>
          <EmptyState />
          <SkeletonPreview />
        </div>

        <div className={styles.panel}>
          <PanelTitle title="Timeline" meta="Movimientos de caja" />
          <Timeline items={timelineItems.slice(0, 3)} />
        </div>
      </section>

      <section className={styles.previewBand}>
        <div className={styles.bandHeader}>
          <PanelTitle title="DataTable + Drawer + ModuleHeader" meta="Supabase, Stripe detail panel" />
          <Button variant="secondary" icon={<SlidersHorizontal size={16} />}>Columnas</Button>
        </div>
        <div className={styles.tableAndDrawer}>
          <DataTable columns={tableColumns} rows={compactRows} />
          <DrawerMock title="Detalle de reserva" />
        </div>
      </section>
    </div>
  );
}

function AgendaPreview() {
  const hours = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00'];
  const courts = ['Cancha 1', 'Cancha 2', 'Cancha 3'];

  return (
    <div className={styles.stack}>
      <ModuleHeader
        label="Agenda"
        title="Miercoles 29 de abril"
        description="Grilla desktop cancha por horario; lista del dia como experiencia principal en mobile."
        actions={
          <>
            <Button variant="secondary" icon={<ChevronLeft size={16} />}>Anterior</Button>
            <Button variant="secondary" icon={<ChevronRight size={16} />}>Siguiente</Button>
            <Button icon={<Plus size={16} />}>Nueva reserva</Button>
          </>
        }
      />

      <div className={styles.agendaLayout}>
        <aside className={styles.agendaFilters}>
          <InputMock placeholder="Buscar cliente..." />
          <Tabs tabs={['Dia', 'Semana']} active="Dia" />
          <div className={styles.filterList}>
            {courts.map((court, index) => (
              <label key={court} className={styles.checkRow}>
                <span className={`${styles.statusDot} ${index === 0 ? styles.dotBlue : index === 1 ? styles.dotGreen : styles.dotYellow}`} />
                <span>{court}</span>
                <input type="checkbox" checked readOnly />
              </label>
            ))}
          </div>
          <div className={styles.miniSummary}>
            <strong>68%</strong>
            <span>ocupacion proyectada</span>
          </div>
        </aside>

        <section className={styles.calendarPanel}>
          <div className={styles.calendarToolbar}>
            <div className={styles.inlineWrap}>
              <FilterChip>Hoy</FilterChip>
              <FilterChip>Padel</FilterChip>
              <FilterChip>Con deuda</FilterChip>
            </div>
            <Button variant="secondary" icon={<Filter size={16} />}>Filtros</Button>
          </div>
          <div className={styles.calendarGrid}>
            <div className={styles.cornerCell}>GMT-3</div>
            {courts.map((court) => (
              <div className={styles.courtHeader} key={court}>
                <strong>{court}</strong>
                <span>4 reservas</span>
              </div>
            ))}
            {hours.map((hour, hourIndex) => (
              <div className={styles.timeCell} style={{ gridRow: hourIndex + 2 }} key={hour}>
                {hour}
              </div>
            ))}
            {hours.map((hour, hourIndex) =>
              courts.map((court, courtIndex) => (
                <div
                  key={`${hour}-${court}`}
                  className={styles.slotCell}
                  style={{ gridColumn: courtIndex + 2, gridRow: hourIndex + 2 }}
                />
              ))
            )}
            {agendaBlocks.map((block) => (
              <button
                key={block.id}
                type="button"
                className={`${styles.bookingBlock} ${styles[`booking${capitalize(block.tone)}`]}`}
                style={{ gridColumn: block.court + 1, gridRow: `${block.row} / span ${block.span}` }}
              >
                <strong>{block.client}</strong>
                <span>{block.meta}</span>
                <small>{block.status}</small>
              </button>
            ))}
          </div>
        </section>

        <DrawerMock title="Reserva · Juan Perez" wide>
          <div className={styles.drawerSection}>
            <Identity name="Juan Perez" detail="351 555 0121 · Cliente frecuente" initials="JP" />
            <div className={styles.accountSummary}>
              <Spec label="Cancha" value="Cancha 1" />
              <Spec label="Horario" value="19:00 - 20:30" />
              <Spec label="Total" value="$3.000" />
              <Spec label="Pendiente" value="$3.000" danger />
            </div>
            <Timeline items={clientTimeline.slice(0, 2)} />
          </div>
        </DrawerMock>
      </div>

      <MobileAgenda />
    </div>
  );
}

function CajaPreview() {
  return (
    <div className={styles.stack}>
      <ModuleHeader
        label="Caja"
        title="Turno activo"
        description="Cards operativas para resolver cobros; cuentas abiertas sin convertirlas en tabla generica."
        actions={<Button variant="secondary" icon={<Clock3 size={16} />}>Cerrar caja</Button>}
      />

      <section className={styles.metricGrid}>
        {cashMetrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </section>

      <section className={styles.cajaGrid}>
        <div className={styles.panel}>
          <div className={styles.bandHeader}>
            <PanelTitle title="Cuentas abiertas" meta="Abiertas · Con deuda · Cerradas hoy" />
            <InputMock placeholder="Buscar cuenta..." compact />
          </div>
          <div className={styles.accountCards}>
            {accountCards.map((account) => (
              <article key={account.owner} className={styles.accountCard}>
                <div>
                  <strong>{account.owner}</strong>
                  <span>{account.meta}</span>
                </div>
                <div className={styles.accountNumbers}>
                  <Spec label="Total" value={account.total} />
                  <Spec label="Pagado" value={account.paid} />
                  <Spec label="Pendiente" value={account.debt} danger={account.tone === 'debt'} />
                </div>
                <div className={styles.inlineWrap}>
                  {account.tone === 'debt' && <Button icon={<CreditCard size={16} />}>Cobrar</Button>}
                  <Button variant="secondary" icon={<Receipt size={16} />}>Ver cuenta</Button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className={styles.panel}>
          <PanelTitle title="Movimientos del turno" meta="Timeline estilo Stripe" />
          <Timeline items={timelineItems} />
        </div>

        <DrawerMock title="Cuenta · Juan Perez">
          <div className={styles.drawerSection}>
            <Badge tone="yellow">Saldo pendiente</Badge>
            <div className={styles.totalDue}>$3.000</div>
            <div className={styles.lineItems}>
              <Spec label="Reserva Cancha 1" value="$2.500" />
              <Spec label="Gatorade" value="$500" />
              <Spec label="Pagado" value="$0" />
            </div>
            <Button icon={<CreditCard size={16} />}>Cobrar saldo</Button>
          </div>
        </DrawerMock>
      </section>
    </div>
  );
}

function ClientesPreview() {
  return (
    <div className={styles.stack}>
      <ModuleHeader
        label="Clientes"
        title="Directorio y perfil"
        description="Split view para buscar, revisar cuenta corriente y actuar sin abandonar el contexto."
        actions={<Button icon={<UserPlus size={16} />}>Nuevo cliente</Button>}
      />

      <section className={styles.splitView}>
        <aside className={styles.clientList}>
          <InputMock placeholder="Buscar por nombre o telefono" />
          <div className={styles.inlineWrap}>
            <FilterChip>Todos</FilterChip>
            <FilterChip>Con deuda</FilterChip>
          </div>
          {customers.map((customer, index) => (
            <button
              type="button"
              key={customer.name}
              className={`${styles.clientRow} ${index === 0 ? styles.clientRowActive : ''}`}
            >
              <Identity name={customer.name} detail={customer.phone} initials={initials(customer.name)} />
              <div>
                <Badge tone={customer.tone}>{customer.tag}</Badge>
                <span>{customer.balance}</span>
              </div>
            </button>
          ))}
        </aside>

        <article className={styles.clientProfile}>
          <div className={styles.profileHeader}>
            <Identity name="Juan Perez" detail="351 555 0121 · juanp@mail.com" initials="JP" large />
            <div className={styles.inlineWrap}>
              <Button icon={<CreditCard size={16} />}>Cobrar</Button>
              <Button variant="secondary" icon={<MessageCircle size={16} />}>WhatsApp</Button>
              <IconButton label="Editar">
                <Edit3 size={16} />
              </IconButton>
            </div>
          </div>
          <div className={styles.metricGridCompact}>
            <MetricCard label="Deuda total" value="$3.000" detail="1 cuenta abierta" tone="warning" />
            <MetricCard label="Ultima reserva" value="Ayer" detail="Cancha 2 · 60m" />
            <MetricCard label="Frecuencia" value="8" detail="reservas este mes" tone="positive" />
          </div>
          <Tabs tabs={['Cuenta corriente', 'Reservas', 'Pagos', 'Notas']} active="Cuenta corriente" />
          <div className={styles.profileBody}>
            <div className={styles.panelSoft}>
              <PanelTitle title="Cuenta corriente" meta="Mismo concepto de Account, visto desde cliente" />
              <Spec label="Cuenta #TC-1042" value="$3.000 pendiente" danger />
              <Spec label="Cuenta #TC-1021" value="$2.500 pagada" />
              <Spec label="Consumos mostrador" value="$1.200 pagado" />
            </div>
            <div className={styles.panelSoft}>
              <PanelTitle title="Actividad" meta="Timeline financiero" />
              <Timeline items={clientTimeline} />
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}

function ReservasPreview() {
  return (
    <div className={styles.stack}>
      <ModuleHeader
        label="Reservas"
        title="Busqueda e historial"
        description="No reemplaza a Agenda: es una vista de auditoria con filtros, chips activos y detalle lateral."
        actions={<Button icon={<Plus size={16} />}>Nueva reserva</Button>}
      />

      <section className={styles.previewBand}>
        <div className={styles.filterToolbar}>
          <InputMock placeholder="Buscar cliente..." compact />
          <Button variant="secondary" icon={<CalendarDays size={16} />}>Hoy</Button>
          <Button variant="secondary" icon={<ChevronDown size={16} />}>Cancha</Button>
          <Button variant="secondary" icon={<Filter size={16} />}>Estado</Button>
        </div>
        <div className={styles.inlineWrap}>
          <FilterChip>Hoy</FilterChip>
          <FilterChip>Cancha 1</FilterChip>
          <FilterChip>Con deuda</FilterChip>
          <span className={styles.resultCount}>Mostrando 12 resultados</span>
        </div>
        <div className={styles.tableAndDrawer}>
          <DataTable columns={tableColumns} rows={reservationRows} />
          <DrawerMock title="Reserva · Juan Perez">
            <div className={styles.drawerSection}>
              <Badge tone="yellow">Con deuda</Badge>
              <Spec label="Cliente" value="Juan Perez" />
              <Spec label="Cancha" value="Cancha 1" />
              <Spec label="Horario" value="Hoy 19:00 · 90m" />
              <Spec label="Total" value="$3.000" />
              <Button icon={<CreditCard size={16} />}>Cobrar</Button>
            </div>
          </DrawerMock>
        </div>
      </section>
    </div>
  );
}

function TiendaPreview() {
  return (
    <div className={styles.stack}>
      <ModuleHeader
        label="Tienda"
        title="Productos y servicios"
        description="Tabla de catalogo con stock visible, acciones por fila y edicion en drawer."
        actions={<Button icon={<Plus size={16} />}>Agregar producto</Button>}
      />

      <section className={styles.metricGridCompact}>
        <MetricCard label="Bajo stock" value="3" detail="requieren reposicion" tone="warning" />
        <MetricCard label="Valor total" value="$48.500" detail="inventario publicado" tone="positive" />
        <MetricCard label="Servicios activos" value="4" detail="alquileres y extras" />
      </section>

      <section className={styles.previewBand}>
        <div className={styles.filterToolbar}>
          <InputMock placeholder="Buscar producto..." compact />
          <Button variant="secondary" icon={<ChevronDown size={16} />}>Estado</Button>
          <Button variant="secondary" icon={<ChevronDown size={16} />}>Categoria</Button>
          <Button variant="secondary" icon={<Download size={16} />}>Exportar</Button>
        </div>
        <div className={styles.tableAndDrawer}>
          <DataTable columns={productColumns} rows={productRows} />
          <DrawerMock title="Editar producto">
            <div className={styles.productPreview}>
              <div className={styles.productImage}>
                <Package size={30} />
              </div>
              <InputMock placeholder="Gatorade" />
              <InputMock placeholder="$2.100" />
              <InputMock placeholder="5 unidades" />
              <Button icon={<Save size={16} />}>Guardar seccion</Button>
            </div>
          </DrawerMock>
        </div>
      </section>
    </div>
  );
}

function InformesPreview() {
  return (
    <div className={styles.stack}>
      <ModuleHeader
        label="Informes"
        title="Resumen semanal"
        description="Analisis, no operacion: KPIs con delta, grafico placeholder y comparacion contra periodo anterior."
        actions={
          <>
            <Button variant="secondary" icon={<CalendarDays size={16} />}>Esta semana</Button>
            <Button variant="secondary" icon={<ArrowUpRight size={16} />}>Comparar</Button>
          </>
        }
      />

      <section className={styles.metricGrid}>
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </section>

      <section className={styles.analyticsGrid}>
        <div className={styles.chartPanel}>
          <PanelTitle title="Ingresos por dia" meta="Comparado con semana anterior" />
          <div className={styles.chartArea}>
            {chartBars.map((height, index) => (
              <span
                key={`${height}-${index}`}
                className={styles.chartBar}
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
          <div className={styles.chartLabels}>
            {['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
        </div>

        <div className={styles.panel}>
          <PanelTitle title="Ranking de canchas" meta="Ocupacion simple" />
          <div className={styles.rankingList}>
            {ranking.map(([name, count, pct], index) => (
              <div key={name} className={styles.rankingRow}>
                <span>{index + 1}</span>
                <strong>{name}</strong>
                <small>{count}</small>
                <b>{pct}</b>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.panel}>
          <PanelTitle title="Comparacion" meta="Semana anterior" />
          <div className={styles.comparisonGrid}>
            <Spec label="Ingresos" value="+$21.400" />
            <Spec label="Reservas" value="+5" />
            <Spec label="Deuda" value="-$2.100" />
            <Spec label="Ocupacion" value="+4%" />
          </div>
        </div>
      </section>
    </div>
  );
}

function AjustesPreview() {
  return (
    <div className={styles.stack}>
      <ModuleHeader
        label="Ajustes"
        title="Configuracion del club"
        description="Pagina vertical con indice interno; cada seccion se guarda por separado."
        actions={<Button variant="secondary" icon={<Save size={16} />}>Guardar club</Button>}
      />

      <section className={styles.settingsLayout}>
        <aside className={styles.settingsIndex}>
          {['Club', 'Canchas', 'Horarios', 'Precios', 'Actividades', 'Descuentos', 'Usuarios'].map((item, index) => (
            <button key={item} type="button" className={index === 0 ? styles.settingsActive : ''}>
              {item}
            </button>
          ))}
        </aside>

        <div className={styles.settingsContent}>
          <SettingsSection title="Club" description="Datos principales y estado operativo">
            <div className={styles.formGrid}>
              <InputMock placeholder="Club Demo Norte" />
              <InputMock placeholder="Av. Recta Martinolli 1234" />
              <InputMock placeholder="Cordoba" />
              <InputMock placeholder="admin@clubdemo.com" />
            </div>
            <ToggleRow label="Club visible para reservas online" enabled />
            <ToggleRow label="Permitir reservas con deuda previa" />
          </SettingsSection>

          <SettingsSection title="Canchas" description="Recursos disponibles para la agenda">
            <div className={styles.courtChips}>
              <FilterChip>Cancha 1</FilterChip>
              <FilterChip>Cancha 2</FilterChip>
              <FilterChip>Cancha 3</FilterChip>
              <Button variant="secondary" icon={<Plus size={16} />}>Agregar</Button>
            </div>
          </SettingsSection>

          <SettingsSection title="Precios" description="Reglas simples por horario">
            <div className={styles.formGrid}>
              <InputMock placeholder="$2.500 hora valle" />
              <InputMock placeholder="$3.200 hora pico" />
            </div>
            <ToggleRow label="Aplicar precio diferencial fin de semana" enabled />
          </SettingsSection>
        </div>
      </section>
    </div>
  );
}

function ModuleHeader({
  label,
  title,
  description,
  actions,
}: {
  label: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <section className={styles.moduleHeader}>
      <div>
        <span className={styles.eyebrow}>{label}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {actions && <div className={styles.headerActions}>{actions}</div>}
    </section>
  );
}

function PanelTitle({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className={styles.panelTitle}>
      <h3>{title}</h3>
      {meta && <span>{meta}</span>}
    </div>
  );
}

function Button({
  children,
  variant = 'primary',
  icon,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  icon?: ReactNode;
}) {
  return (
    <button type="button" className={`${styles.button} ${styles[`button${capitalize(variant)}`]}`}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

function IconButton({ children, label }: { children: ReactNode; label: string }) {
  return (
    <button type="button" className={styles.iconButton} aria-label={label} title={label}>
      {children}
    </button>
  );
}

function InputMock({ placeholder, compact = false }: { placeholder: string; compact?: boolean }) {
  return (
    <label className={`${styles.inputMock} ${compact ? styles.inputCompact : ''}`}>
      <Search size={16} />
      <input value="" onChange={() => undefined} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={`${styles.badge} ${styles[`badge${capitalize(tone)}`]}`}>{children}</span>;
}

function MetricCard({ label, value, detail, tone = 'neutral' }: Metric) {
  return (
    <article className={styles.metricCard}>
      <div>
        <span>{label}</span>
        <CircleDollarSign size={17} />
      </div>
      <strong>{value}</strong>
      <p className={styles[`metric${capitalize(tone)}`]}>{detail}</p>
    </article>
  );
}

function DataTable({ columns, rows }: { columns: TableColumn[]; rows: TableRow[] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.dataTable}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.align === 'right' ? styles.alignRight : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td key={column.key} className={column.align === 'right' ? styles.alignRight : undefined}>
                  {row.cells[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FilterChip({ children }: { children: ReactNode }) {
  return (
    <button type="button" className={styles.filterChip}>
      <span>{children}</span>
      <X size={13} />
    </button>
  );
}

function Tabs({ tabs, active }: { tabs: string[]; active: string }) {
  return (
    <div className={styles.tabs}>
      {tabs.map((tab) => (
        <button key={tab} type="button" className={tab === active ? styles.tabActive : ''}>
          {tab}
        </button>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className={styles.emptyState}>
      <Tag size={20} />
      <strong>Sin resultados</strong>
      <span>Probá quitando un filtro activo.</span>
    </div>
  );
}

function SkeletonPreview() {
  return (
    <div className={styles.skeletonList} aria-label="Skeleton preview">
      <span />
      <span />
      <span />
    </div>
  );
}

function DrawerMock({ title, children, wide = false }: { title: string; children?: ReactNode; wide?: boolean }) {
  return (
    <aside className={`${styles.drawerMock} ${wide ? styles.drawerWide : ''}`}>
      <header>
        <div>
          <span>Detalle</span>
          <strong>{title}</strong>
        </div>
        <IconButton label="Cerrar">
          <X size={16} />
        </IconButton>
      </header>
      <div className={styles.drawerBody}>
        {children ?? (
          <>
            <Spec label="Estado" value="Confirmada" />
            <Spec label="Total" value="$3.000" />
            <Spec label="Pagado" value="$0" />
            <Spec label="Pendiente" value="$3.000" danger />
            <Timeline items={clientTimeline.slice(0, 2)} />
          </>
        )}
      </div>
      <footer>
        <Button variant="secondary">Editar</Button>
        <Button>Cobrar</Button>
      </footer>
    </aside>
  );
}

function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <div className={styles.timeline}>
      {items.map((item) => (
        <div key={item.id} className={styles.timelineItem}>
          <time>{item.time}</time>
          <span className={`${styles.timelineDot} ${styles[`timeline${capitalize(item.tone ?? 'neutral')}`]}`} />
          <div>
            <strong>{item.label}</strong>
            <small>{item.detail}</small>
          </div>
          {item.amount && <b className={styles[`amount${capitalize(item.tone ?? 'neutral')}`]}>{item.amount}</b>}
        </div>
      ))}
    </div>
  );
}

function Spec({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className={styles.spec}>
      <span>{label}</span>
      <strong className={danger ? styles.dangerText : ''}>{value}</strong>
    </div>
  );
}

function Identity({
  name,
  detail,
  initials: short,
  large = false,
}: {
  name: string;
  detail: string;
  initials: string;
  large?: boolean;
}) {
  return (
    <div className={`${styles.identity} ${large ? styles.identityLarge : ''}`}>
      <span>{short}</span>
      <div>
        <strong>{name}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function ProductCell({ name, detail, tone }: { name: string; detail: string; tone: BadgeTone }) {
  return (
    <div className={styles.productCell}>
      <span className={`${styles.productIcon} ${styles[`product${capitalize(tone)}`]}`}>
        <Package size={17} />
      </span>
      <div>
        <strong>{name}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function StockLabel({ amount, warning = false, danger = false }: { amount: string; warning?: boolean; danger?: boolean }) {
  return <span className={danger ? styles.stockDanger : warning ? styles.stockWarning : ''}>{amount}</span>;
}

function RowActions() {
  return (
    <div className={styles.rowActions}>
      <IconButton label="Editar">
        <Edit3 size={15} />
      </IconButton>
      <IconButton label="Mas acciones">
        <MoreHorizontal size={15} />
      </IconButton>
    </div>
  );
}

function MobileAgenda() {
  return (
    <section className={styles.mobileAgenda}>
      <div className={styles.phoneFrame}>
        <header>
          <IconButton label="Anterior">
            <ChevronLeft size={16} />
          </IconButton>
          <div>
            <strong>Mie 29 Abr</strong>
            <span>Lista del dia</span>
          </div>
          <IconButton label="Nueva reserva">
            <Plus size={16} />
          </IconButton>
        </header>
        <div className={styles.weekStrip}>
          {['Lun', 'Mar', 'Mie', 'Jue', 'Vie'].map((day) => (
            <button key={day} type="button" className={day === 'Mie' ? styles.dayActive : ''}>
              <span>{day}</span>
              <strong>{day === 'Mie' ? '29' : day === 'Jue' ? '30' : '28'}</strong>
            </button>
          ))}
        </div>
        <div className={styles.mobileReservations}>
          {agendaBlocks.slice(0, 4).map((block) => (
            <article key={block.id}>
              <time>{block.meta.split(' ')[0]}</time>
              <div>
                <strong>{block.client}</strong>
                <span>{block.meta} · Cancha {block.court}</span>
                <Badge tone={block.tone === 'debt' ? 'yellow' : block.tone === 'paid' ? 'green' : 'blue'}>{block.status}</Badge>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.settingsSection}>
      <div className={styles.settingsSectionHead}>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <Button variant="secondary" icon={<Save size={16} />}>Guardar</Button>
      </div>
      {children}
    </section>
  );
}

function ToggleRow({ label, enabled = false }: { label: string; enabled?: boolean }) {
  return (
    <div className={styles.toggleRow}>
      <span>{label}</span>
      <button type="button" className={enabled ? styles.toggleOn : ''} aria-pressed={enabled}>
        <span />
      </button>
    </div>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
