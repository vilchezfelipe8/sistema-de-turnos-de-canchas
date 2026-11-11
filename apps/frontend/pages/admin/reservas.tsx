import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Repeat, Search, X } from 'lucide-react';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import { AdminFeedbackBanner } from '../../components/admin/ui/AdminFeedback';
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';
import { showAdminToast } from '../../utils/adminToast';
import { ClubAdminService } from '../../services/ClubAdminService';
import {
  listAdminBookings,
  listAdminFixedBookings,
  type FixedBookingListItem,
  type BookingListItem,
  type BookingListResult,
  type BookingListView,
} from '../../services/AdminBookingListService';

// Reservas: todas las reservas de varios días, para buscar sin saber la fecha.

// 'FIXED' es la pestaña de turnos fijos (no es una vista de reservas sueltas).
type PageView = BookingListView | 'FIXED';

const VIEWS: Array<{ value: PageView; label: string; countKey?: keyof BookingListResult['counts']; empty: string }> = [
  { value: 'UPCOMING', label: 'Próximas', countKey: 'upcoming', empty: 'No hay reservas próximas' },
  { value: 'PENDING', label: 'Sin confirmar', countKey: 'pending', empty: 'No hay reservas sin confirmar' },
  { value: 'FIXED', label: 'Turnos fijos', empty: 'No hay turnos fijos' },
  { value: 'CANCELLED', label: 'Canceladas', countKey: 'cancelled', empty: 'No hay reservas canceladas' },
  { value: 'PAST', label: 'Pasadas', countKey: 'past', empty: 'No hay reservas pasadas' },
];

const parseView = (value: unknown): PageView => {
  const raw = String(value || '').toUpperCase();
  if (raw === 'FIJOS') return 'FIXED';
  return raw === 'PENDING' || raw === 'CANCELLED' || raw === 'PAST' ? raw : 'UPCOMING';
};

const WEEKDAYS = ['Domingos', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábados'];
// Orden de la semana empezando el lunes.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const formatMinutes = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

// Fecha local del club (YYYY-MM-DD) de un instante.
const dayKey = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

const formatTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('es-AR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

const dayTitle = (key: string, timeZone: string) => {
  const today = dayKey(new Date().toISOString(), timeZone);
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000).toISOString(), timeZone);
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString(), timeZone);
  const [y, m, d] = key.split('-').map(Number);
  const label = new Date(y, m - 1, d)
    .toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    })
    .replace(',', '');
  if (key === today) return `Hoy · ${label}`;
  if (key === tomorrow) return `Mañana · ${label}`;
  if (key === yesterday) return `Ayer · ${label}`;
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const formatShortDate = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('es-AR', { timeZone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(iso))
    .replace(/\./g, '')
    .replace(',', '');

const statusChip = (b: BookingListItem): { label: string; className: string } => {
  if (b.status === 'CANCELLED') return { label: 'Cancelada', className: 'bg-p-surface-2 text-p-text-muted' };
  if (b.status === 'PENDING') return { label: 'Sin confirmar', className: 'bg-p-warning-bg text-p-warning' };
  if (b.status === 'COMPLETED' || new Date(b.endDateTime).getTime() < Date.now())
    return { label: 'Jugada', className: 'bg-p-surface-2 text-p-text-secondary' };
  return { label: 'Confirmada', className: 'bg-p-positive-bg text-p-positive' };
};

const cancelText = (b: BookingListItem, timeZone: string) => {
  const when = b.cancelledAt ? ` · ${formatShortDate(b.cancelledAt, timeZone)}` : '';
  if (b.autoCancelled) return `Se canceló sola: no se pagó la seña a tiempo${when}`;
  if (b.cancelledByName) return `La canceló ${b.cancelledByName}${when}`;
  return `Cancelada${when}`;
};

// ---------- fila ----------

const formatDayShort = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('es-AR', { timeZone, weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(iso))
    .replace(/\./g, '')
    .replace(',', '');

type RowAction = 'confirm' | 'cancel';

function BookingRow({
  booking,
  timeZone,
  showDay,
  busy,
  onAction,
}: {
  booking: BookingListItem;
  timeZone: string;
  showDay?: boolean;
  busy?: boolean;
  onAction?: (booking: BookingListItem, action: RowAction) => Promise<boolean>;
}) {
  const chip = statusChip(booking);
  const cancelled = booking.status === 'CANCELLED';
  const href = `/admin/agenda?fecha=${dayKey(booking.startDateTime, timeZone)}${cancelled ? '' : `&reserva=${booking.id}`}`;
  // Pendientes que todavía no pasaron: se confirman o cancelan desde acá.
  const actionable = Boolean(onAction) && booking.status === 'PENDING' && new Date(booking.endDateTime).getTime() >= Date.now();
  const hasPayments = booking.paidAmount > 0.009;
  const [askCancel, setAskCancel] = useState(false);

  const body = (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 gap-3">
        <div className={`${showDay ? 'w-[72px]' : 'w-[52px]'} shrink-0 pt-0.5`}>
          {showDay && <p className="text-[11px] font-semibold text-p-text-secondary">{formatDayShort(booking.startDateTime, timeZone)}</p>}
          <p className={`text-[14px] font-semibold tabular-nums ${cancelled ? 'text-p-text-muted line-through' : 'text-p-text'}`}>
            {formatTime(booking.startDateTime, timeZone)}
          </p>
          <p className="text-[11px] tabular-nums text-p-text-muted">{formatTime(booking.endDateTime, timeZone)}</p>
        </div>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-p-text">{booking.client.name}</p>
          <p className="truncate text-[12px] text-p-text-muted">
            {booking.court.name} · {booking.activity.name}
            {booking.client.phone ? ` · ${booking.client.phone}` : ''}
          </p>
          {booking.isFixed && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-p-surface-2 px-2 py-0.5 text-[11px] font-medium text-p-text-secondary">
              <Repeat size={11} />
              Turno fijo
            </span>
          )}
          {cancelled && <p className="mt-1 text-[12px] text-p-text-secondary">{cancelText(booking, timeZone)}</p>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip.className}`}>{chip.label}</span>
        {!cancelled && booking.totalAmount > 0 && (
          <p
            className={`mt-1 text-[12px] font-semibold tabular-nums ${
              booking.remainingAmount > 0 ? 'text-[var(--error-fg)]' : 'text-p-positive'
            }`}
          >
            {booking.remainingAmount > 0 ? `Debe ${formatMoney(booking.remainingAmount)}` : 'Pagada'}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <li>
      <Link
        href={href}
        className="block px-4 py-3 transition hover:bg-p-surface-2 focus-visible:bg-p-surface-2 focus-visible:outline-none"
        title={cancelled ? 'Ver ese día en el calendario' : 'Abrir en el calendario'}
      >
        {body}
      </Link>
      {actionable && (
        <div className="px-4 pb-3">
          {askCancel ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-p-surface-2 px-3 py-2">
              <p className="mr-auto text-[12px] text-p-text">¿Cancelar la reserva de {booking.client.name}? El horario queda libre.</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => setAskCancel(false)}
                className="h-8 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text hover:bg-p-surface-2 disabled:opacity-50"
              >
                No
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const ok = await onAction!(booking, 'cancel');
                  if (!ok) setAskCancel(false);
                }}
                className="h-8 rounded-lg bg-[var(--error-fg)] px-3 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Cancelando…' : 'Sí, cancelar'}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 pl-[64px]">
              <button
                type="button"
                disabled={busy}
                onClick={() => void onAction!(booking, 'confirm')}
                className="h-8 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold !text-ink-50 hover:bg-ink-800 disabled:opacity-50"
              >
                {busy ? 'Confirmando…' : 'Confirmar'}
              </button>
              {hasPayments ? (
                <Link
                  href={href}
                  className="inline-flex h-8 items-center rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text hover:bg-p-surface-2"
                  title="Ya pagó algo: cancelala desde el calendario para decidir la devolución"
                >
                  Cancelar en el calendario
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setAskCancel(true)}
                  className="h-8 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text hover:bg-p-surface-2 disabled:opacity-50"
                >
                  Cancelar
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ---------- turnos fijos ----------

function FixedBookingRow({
  fixed,
  timeZone,
  busy,
  onCancel,
}: {
  fixed: FixedBookingListItem;
  timeZone: string;
  busy: boolean;
  onCancel: (fixed: FixedBookingListItem) => Promise<boolean>;
}) {
  const [askCancel, setAskCancel] = useState(false);
  const next = fixed.nextBooking;
  const nextHref = next ? `/admin/agenda?fecha=${dayKey(next.startDateTime, timeZone)}&reserva=${next.id}` : null;
  const hasPayments = fixed.upcomingPaidAmount > 0.009;
  const left =
    fixed.upcomingCount === 0
      ? 'No tiene turnos por delante'
      : fixed.upcomingCount === 1
        ? 'Queda 1 turno reservado'
        : `Quedan ${fixed.upcomingCount} turnos reservados`;

  const body = (
    <div className="flex min-w-0 gap-3">
      <div className="w-[52px] shrink-0 pt-0.5">
        <p className="text-[14px] font-semibold tabular-nums text-p-text">{formatMinutes(fixed.startTimeMinutes)}</p>
        <p className="text-[11px] tabular-nums text-p-text-muted">{formatMinutes(fixed.endTimeMinutes)}</p>
      </div>
      <div className="min-w-0">
        <p className="truncate text-[14px] font-semibold text-p-text">{fixed.client.name}</p>
        <p className="truncate text-[12px] text-p-text-muted">
          {fixed.court.name} · {fixed.activity.name}
          {fixed.client.phone ? ` · ${fixed.client.phone}` : ''}
        </p>
        <p className="mt-1 text-[12px] text-p-text-secondary">
          {next ? `Próximo: ${formatDayShort(next.startDateTime, timeZone)} · ` : ''}
          {left}
        </p>
      </div>
    </div>
  );

  return (
    <li>
      {nextHref ? (
        <Link
          href={nextHref}
          className="block px-4 py-3 transition hover:bg-p-surface-2 focus-visible:bg-p-surface-2 focus-visible:outline-none"
          title="Abrir el próximo turno en el calendario"
        >
          {body}
        </Link>
      ) : (
        <div className="px-4 py-3">{body}</div>
      )}
      <div className="px-4 pb-3">
        {askCancel ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-p-surface-2 px-3 py-2">
            <p className="mr-auto text-[12px] text-p-text">
              ¿Cancelar el turno fijo de {fixed.client.name}?{' '}
              {fixed.upcomingCount > 0
                ? `Se cancelan ${fixed.upcomingCount === 1 ? 'el turno que queda' : `los ${fixed.upcomingCount} turnos que quedan`} y no se reserva más.`
                : 'No se reserva más.'}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => setAskCancel(false)}
              className="h-8 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text hover:bg-p-surface-2 disabled:opacity-50"
            >
              No
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const ok = await onCancel(fixed);
                if (!ok) setAskCancel(false);
              }}
              className="h-8 rounded-lg bg-[var(--error-fg)] px-3 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Cancelando…' : 'Sí, cancelar'}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 pl-[64px]">
            {hasPayments && nextHref ? (
              <Link
                href={nextHref}
                className="inline-flex h-8 items-center rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text hover:bg-p-surface-2"
                title="Algún turno ya tiene pagos: cancelalo desde el calendario para decidir la devolución"
              >
                Cancelar en el calendario
              </Link>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setAskCancel(true)}
                className="h-8 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text hover:bg-p-surface-2 disabled:opacity-50"
              >
                Cancelar turno fijo
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function FixedBookingList({
  items,
  timeZone,
  loading,
  searching,
  busyId,
  onCancel,
  onClearSearch,
}: {
  items: FixedBookingListItem[];
  timeZone: string;
  loading: boolean;
  searching: boolean;
  busyId: number | null;
  onCancel: (fixed: FixedBookingListItem) => Promise<boolean>;
  onClearSearch: () => void;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-p-border bg-p-surface px-4 py-10 text-center">
        <p className="text-[14px] font-semibold text-p-text">
          {searching ? 'No encontramos turnos fijos con esa búsqueda' : 'No hay turnos fijos'}
        </p>
        {searching ? (
          <button type="button" onClick={onClearSearch} className="mt-2 text-[13px] font-semibold text-p-text-secondary hover:underline">
            Limpiar búsqueda
          </button>
        ) : (
          <p className="mt-1 text-[13px] text-p-text-muted">Se crean desde el calendario, al hacer una reserva que se repite cada semana.</p>
        )}
      </div>
    );
  }

  const groups = WEEK_ORDER.map((day) => ({ day, items: items.filter((f) => f.dayOfWeek === day) })).filter((g) => g.items.length > 0);

  return (
    <div className={`flex flex-col gap-4 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      {groups.map((group) => (
        <div key={group.day}>
          <p className="mb-1.5 px-1 text-[12px] font-semibold text-p-text-secondary">
            {WEEKDAYS[group.day]}
            <span className="ml-1.5 font-normal text-p-text-muted">· {group.items.length}</span>
          </p>
          <ul className="divide-y divide-p-border overflow-hidden rounded-xl border border-p-border bg-p-surface">
            {group.items.map((fixed) => (
              <FixedBookingRow key={fixed.id} fixed={fixed} timeZone={timeZone} busy={busyId === fixed.id} onCancel={onCancel} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------- contenido ----------

function BookingsContent({ slug }: { slug: string }) {
  const router = useRouter();
  const view = parseView(router.query.ver);
  const dateFilter = DATE_RE.test(String(router.query.dia || '')) ? String(router.query.dia) : '';
  const queryText = String(router.query.buscar || '');

  const [searchDraft, setSearchDraft] = useState(queryText);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<BookingListResult | null>(null);
  // De qué pestaña es la lista cargada: al cambiar de pestaña no se muestra la anterior.
  const [resultView, setResultView] = useState<PageView | null>(null);
  const [fixedItems, setFixedItems] = useState<FixedBookingListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const setQuery = useCallback(
    (next: { ver?: PageView; dia?: string; buscar?: string }) => {
      const merged = { ver: view, dia: dateFilter, buscar: queryText, ...next };
      const query: Record<string, string> = {};
      if (merged.ver === 'FIXED') query.ver = 'fijos';
      else if (merged.ver && merged.ver !== 'UPCOMING') query.ver = merged.ver.toLowerCase();
      if (merged.dia) query.dia = merged.dia;
      if (merged.buscar) query.buscar = merged.buscar;
      setPage(1);
      void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
    },
    [router, view, dateFilter, queryText]
  );

  // El buscador espera a que dejes de escribir.
  useEffect(() => {
    const trimmed = searchDraft.trim();
    if (trimmed === queryText) return;
    const timer = window.setTimeout(() => setQuery({ buscar: trimmed }), 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft, queryText, setQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // En turnos fijos igual se piden las reservas, para los conteos de las otras pestañas.
      const [bookings, fixed] = await Promise.all([
        view === 'FIXED'
          ? listAdminBookings(slug, { view: 'UPCOMING', q: queryText || undefined })
          : listAdminBookings(slug, { view, q: queryText || undefined, date: dateFilter || undefined, page }),
        listAdminFixedBookings(slug, { q: queryText || undefined }),
      ]);
      setResult(bookings);
      setResultView(view);
      setFixedItems(fixed.items);
    } catch (err) {
      reportUiError({ area: 'AdminBookingsPage', action: 'load' }, err);
      setError(extractErrorMessage(err, 'No se pudieron cargar las reservas.'));
    } finally {
      setLoading(false);
    }
  }, [slug, view, queryText, dateFilter, page]);

  useEffect(() => {
    if (!router.isReady) return;
    void load();
  }, [router.isReady, load]);

  const [busyId, setBusyId] = useState<number | null>(null);
  const runAction = useCallback(
    async (booking: BookingListItem, action: RowAction) => {
      setBusyId(booking.id);
      try {
        if (action === 'confirm') {
          await ClubAdminService.confirmBooking(slug, booking.id);
          showAdminToast(`Reserva de ${booking.client.name} confirmada.`);
        } else {
          await ClubAdminService.cancelBooking(slug, booking.id);
          showAdminToast(`Reserva de ${booking.client.name} cancelada.`);
        }
        await load();
        return true;
      } catch (err) {
        reportUiError({ area: 'AdminBookingsPage', action }, err);
        showAdminToast(
          extractErrorMessage(err, action === 'confirm' ? 'No se pudo confirmar la reserva.' : 'No se pudo cancelar la reserva.'),
          'error'
        );
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [slug, load]
  );

  const [busyFixedId, setBusyFixedId] = useState<number | null>(null);
  const cancelFixed = useCallback(
    async (fixed: FixedBookingListItem) => {
      setBusyFixedId(fixed.id);
      try {
        const result = (await ClubAdminService.cancelFixedBooking(slug, fixed.id, { scope: 'ALL_OCCURRENCES' })) as {
          cancelledCount?: number;
          skippedCount?: number;
          skipped?: Array<{ reason?: string }>;
        };
        const cancelledCount = Number(result?.cancelledCount || 0);
        const skippedCount = Number(result?.skippedCount || 0);
        const firstReason = result?.skipped?.[0]?.reason;
        // El backend responde 200 aunque no haya podido cancelar algún turno: avisarlo.
        if (skippedCount > 0 && cancelledCount === 0) {
          showAdminToast(`No se pudo cancelar el turno fijo.${firstReason ? ` ${firstReason}` : ''}`, 'error');
        } else if (skippedCount > 0) {
          showAdminToast(
            `Se cancelaron ${cancelledCount} turnos, pero ${skippedCount === 1 ? '1 no se pudo cancelar' : `${skippedCount} no se pudieron cancelar`}. Revisalos en el calendario.`,
            'warning'
          );
        } else {
          showAdminToast(`Turno fijo de ${fixed.client.name} cancelado.`);
        }
        await load();
        return skippedCount === 0 || cancelledCount > 0;
      } catch (err) {
        reportUiError({ area: 'AdminBookingsPage', action: 'cancelFixed' }, err);
        showAdminToast(extractErrorMessage(err, 'No se pudo cancelar el turno fijo.'), 'error');
        return false;
      } finally {
        setBusyFixedId(null);
      }
    },
    [slug, load]
  );

  const timeZone = result?.timeZone || 'America/Argentina/Buenos_Aires';
  const items = useMemo(() => (resultView === view ? result?.items ?? [] : []), [result, resultView, view]);
  const showingOtherView = resultView !== view;
  const groups = useMemo(() => {
    const byDay: Array<{ key: string; items: BookingListItem[] }> = [];
    for (const item of items) {
      const key = dayKey(item.startDateTime, timeZone);
      const last = byDay[byDay.length - 1];
      if (last && last.key === key) last.items.push(item);
      else byDay.push({ key, items: [item] });
    }
    return byDay;
  }, [items, timeZone]);

  const activeView = VIEWS.find((v) => v.value === view)!;
  const filtered = Boolean(queryText || dateFilter);

  return (
    <section className="h-full min-h-0 overflow-y-auto p-4 pb-20 lg:p-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-[22px] font-bold text-p-text">Reservas</h1>
            <p className="text-[13px] text-p-text-muted">Buscá cualquier reserva sin tener que saber el día.</p>
          </div>
          <Link
            href="/admin/agenda"
            className="inline-flex h-9 items-center rounded-lg bg-ink-900 px-3.5 text-[13px] font-semibold !text-ink-50 hover:bg-ink-800"
          >
            Ir al calendario
          </Link>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-p-text-muted" />
            <input
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Nombre, teléfono o código"
              aria-label="Buscar reservas"
              className="h-10 w-full rounded-xl border border-p-border bg-p-surface pl-9 pr-3 text-[13px] text-p-text placeholder:text-p-text-muted focus:border-p-accent focus:outline-none"
            />
          </label>
          <div className={`flex items-center gap-2 ${view === 'FIXED' ? 'hidden' : ''}`}>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setQuery({ dia: e.target.value })}
              aria-label="Ver un día"
              className="h-10 min-w-0 flex-1 rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text focus:border-p-accent focus:outline-none sm:w-[160px] sm:flex-none"
            />
            {dateFilter && (
              <button
                type="button"
                onClick={() => setQuery({ dia: '' })}
                aria-label="Quitar el día"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-p-border bg-p-surface text-p-text-muted hover:bg-p-surface-2"
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>

        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="flex w-max gap-1.5">
            {VIEWS.map((option) => {
              const count = option.countKey
                ? result
                  ? result.counts[option.countKey]
                  : null
                : fixedItems
                  ? fixedItems.length
                  : null;
              const selected = view === option.value;
              const alert = option.value === 'PENDING' && (count ?? 0) > 0;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setQuery(option.value === 'FIXED' ? { ver: option.value, dia: '' } : { ver: option.value })}
                  className={`h-8 whitespace-nowrap rounded-full border px-3 text-[12px] font-semibold transition ${
                    selected ? 'border-ink-900 bg-ink-900 text-ink-50' : 'border-p-border bg-p-surface text-p-text-secondary hover:bg-p-surface-2'
                  }`}
                >
                  {option.label}
                  {count !== null && count > 0 && (
                    <span className={`ml-1.5 tabular-nums ${alert && !selected ? 'text-p-warning' : ''}`}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <AdminFeedbackBanner tone="error">
            {error}{' '}
            <button type="button" className="font-semibold underline" onClick={() => void load()}>
              Reintentar
            </button>
          </AdminFeedbackBanner>
        )}

        {view === 'FIXED' ? (
          fixedItems === null ? (
            <p className="py-10 text-center text-[13px] text-p-text-muted">Cargando…</p>
          ) : (
            <FixedBookingList
              items={fixedItems}
              timeZone={timeZone}
              loading={loading}
              searching={Boolean(queryText)}
              busyId={busyFixedId}
              onCancel={cancelFixed}
              onClearSearch={() => {
                setSearchDraft('');
                setQuery({ buscar: '' });
              }}
            />
          )
        ) : (loading && !result) || (showingOtherView && !error) ? (
          <p className="py-10 text-center text-[13px] text-p-text-muted">Cargando…</p>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-p-border bg-p-surface px-4 py-10 text-center">
            <p className="text-[14px] font-semibold text-p-text">
              {filtered ? 'No encontramos reservas con esos filtros' : activeView.empty}
            </p>
            {filtered && (
              <button
                type="button"
                onClick={() => {
                  setSearchDraft('');
                  setQuery({ buscar: '', dia: '' });
                }}
                className="mt-2 text-[13px] font-semibold text-p-text-secondary hover:underline"
              >
                Limpiar búsqueda
              </button>
            )}
          </div>
        ) : (
          <div className={`flex flex-col gap-4 transition-opacity ${loading ? 'opacity-60' : ''}`}>
            {view === 'CANCELLED' ? (
              <div>
                <p className="mb-1.5 px-1 text-[12px] font-semibold text-p-text-secondary">Las últimas canceladas primero</p>
                <ul className="divide-y divide-p-border overflow-hidden rounded-xl border border-p-border bg-p-surface">
                  {items.map((booking) => (
                    <BookingRow key={booking.id} booking={booking} timeZone={timeZone} showDay />
                  ))}
                </ul>
              </div>
            ) : (
              groups.map((group) => (
                <div key={`${group.key}-${group.items[0].id}`}>
                  <p className="mb-1.5 px-1 text-[12px] font-semibold text-p-text-secondary">
                    {dayTitle(group.key, timeZone)}
                    <span className="ml-1.5 font-normal text-p-text-muted">· {group.items.length}</span>
                  </p>
                  <ul className="divide-y divide-p-border overflow-hidden rounded-xl border border-p-border bg-p-surface">
                    {group.items.map((booking) => (
                      <BookingRow key={booking.id} booking={booking} timeZone={timeZone} busy={busyId === booking.id} onAction={runAction} />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        )}

        {result && view !== 'FIXED' && result.pages > 1 && (
          <div className="flex items-center justify-between text-[12px]">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => p - 1)}
              className="font-semibold text-p-text hover:underline disabled:opacity-40"
            >
              Anteriores
            </button>
            <span className="text-p-text-muted">
              Página {result.page} de {result.pages}
            </span>
            <button
              type="button"
              disabled={page >= result.pages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="font-semibold text-p-text hover:underline disabled:opacity-40"
            >
              Siguientes
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------- página ----------

export default function AdminBookingsPage() {
  return (
    <AdminRouteShell title="Reservas | Pique Admin" activeItem="Reservas" fromPath="/admin/reservas" requiredAccess="operator">
      {(user) => {
        const slug = getActiveClubSlug(normalizeSessionUser(user as any));
        if (!slug) return <div className="p-4 text-[13px] text-p-text-muted">No se encontró el club activo.</div>;
        return <BookingsContent slug={slug} />;
      }}
    </AdminRouteShell>
  );
}
