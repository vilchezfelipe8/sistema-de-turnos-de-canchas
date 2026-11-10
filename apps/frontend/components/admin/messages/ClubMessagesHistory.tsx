import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { fetchWithAuth } from '../../../utils/apiClient';
import { getApiUrl } from '../../../utils/apiUrl';
import { throwApiErrorFromResponse } from '../../../utils/apiError';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';

export type ClubMessageItem = {
  id: string;
  createdAt: string;
  status: 'QUEUED' | 'ACCEPTED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'SKIPPED';
  eventType: 'BOOKING_CREATED' | 'BOOKING_CANCELLED' | 'BOOKING_PENDING_WARNING' | 'ACCOUNT_VERIFICATION_CODE';
  recipientRole: 'CUSTOMER' | 'CLUB_STAFF';
  recipientPhone: string;
  failReason: string | null;
  booking: {
    id: number;
    startDateTime: string;
    courtName: string | null;
    clientId: string | null;
    clientName: string | null;
  } | null;
};

type Filter = 'all' | 'failed';

const STATUS: Record<ClubMessageItem['status'], { label: string; tone: string }> = {
  QUEUED: { label: 'Por salir', tone: 'text-p-text-muted' },
  ACCEPTED: { label: 'Enviado', tone: 'text-p-text-secondary' },
  SENT: { label: 'Enviado', tone: 'text-p-text-secondary' },
  DELIVERED: { label: 'Le llegó', tone: 'text-p-positive' },
  READ: { label: 'Lo leyó', tone: 'text-p-positive' },
  FAILED: { label: 'No llegó', tone: 'text-p-error' },
  SKIPPED: { label: 'No se mandó', tone: 'text-p-text-muted' },
};

const formatSlot = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d
    .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/,/g, '')
    .replace(/\./g, '');
  return `${day} ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;
};

const formatWhen = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return sameDay ? `hoy ${time}` : `${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace(/\./g, '')} ${time}`;
};

/** "Le avisamos a Messi que su reserva del sáb 10:00 en Cancha 1 quedó hecha." */
export const describeClubMessage = (item: ClubMessageItem): string => {
  const slot = item.booking ? formatSlot(item.booking.startDateTime) : '';
  const court = item.booking?.courtName ? ` en ${item.booking.courtName}` : '';
  const turno = slot ? `la reserva del ${slot}${court}` : 'una reserva';
  if (item.recipientRole === 'CLUB_STAFF') {
    if (item.eventType === 'BOOKING_CREATED') return `Te avisamos que entró ${turno}${item.booking?.clientName ? ` de ${item.booking.clientName}` : ''}.`;
    if (item.eventType === 'BOOKING_CANCELLED') return `Te avisamos que se canceló ${turno}.`;
    if (item.eventType === 'BOOKING_PENDING_WARNING') return `Te avisamos que ${turno} sigue sin confirmar.`;
    return 'Aviso al club.';
  }
  const who = item.booking?.clientName || 'al cliente';
  const a = item.booking?.clientName ? `a ${who}` : who;
  if (item.eventType === 'BOOKING_CREATED') return `Le avisamos ${a} que ${turno} quedó hecha.`;
  if (item.eventType === 'BOOKING_CANCELLED') return `Le avisamos ${a} que se canceló ${turno}.`;
  if (item.eventType === 'BOOKING_PENDING_WARNING') return `Le avisamos ${a} que ${turno} se cancela si no la confirma.`;
  if (item.eventType === 'ACCOUNT_VERIFICATION_CODE') return `Le mandamos ${a} el código para entrar a la app.`;
  return `Aviso ${a}.`;
};

/** "Qué se mandó": historial de avisos del club. Solo lectura, sin reenviar. */
export default function ClubMessagesHistory() {
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<ClubMessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (nextFilter: Filter) => {
    try {
      setLoading(true);
      setError('');
      const response = await fetchWithAuth(`${getApiUrl()}/api/club-messages/history?filter=${nextFilter}&limit=30`);
      if (!response.ok) await throwApiErrorFromResponse(response, 'No se pudo cargar lo que se mandó.');
      const data = (await response.json()) as { items?: ClubMessageItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (loadError) {
      reportUiError({ area: 'ClubMessagesHistory', action: 'load' }, loadError);
      setError(extractErrorMessage(loadError, 'No se pudo cargar lo que se mandó.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  return (
    <section>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-[13px] font-semibold text-p-text">Qué se mandó</p>
        <div className="flex gap-1">
          {([
            { id: 'all', label: 'Todos' },
            { id: 'failed', label: 'No llegaron' },
          ] as Array<{ id: Filter; label: string }>).map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              onClick={() => setFilter(option.id)}
              className={`h-7 rounded-lg px-2.5 text-[12px] font-semibold ${
                filter === option.id ? 'bg-ink-900 text-ink-50' : 'text-p-text-secondary hover:bg-p-surface-2'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-2xl border border-p-error bg-p-error-bg px-4 py-3 text-[13px] text-p-error">{error}</p>
      ) : loading && items.length === 0 ? (
        <div className="h-20 animate-pulse rounded-2xl bg-p-surface-2" />
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-p-border px-4 py-6 text-center text-[13px] text-p-text-muted">
          {filter === 'failed' ? 'Todos los avisos llegaron.' : 'Todavía no salió ningún aviso.'}
        </p>
      ) : (
        <ul className="divide-y divide-p-border rounded-2xl border border-p-border bg-p-surface">
          {items.map((item) => {
            const status = STATUS[item.status] || STATUS.SENT;
            return (
              <li key={item.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] text-p-text">{describeClubMessage(item)}</p>
                  <p className="text-[12px] text-p-text-muted">
                    {formatWhen(item.createdAt)} · {/^\d+$/.test(item.recipientPhone) ? `+${item.recipientPhone}` : item.recipientPhone}
                    {item.failReason ? <span className="text-p-error"> · {item.failReason}</span> : null}
                  </p>
                  {item.booking?.clientId && item.recipientRole === 'CUSTOMER' && (
                    <Link
                      href={{ pathname: '/admin/clientes', query: { cliente: item.booking.clientId } }}
                      className="text-[12px] font-semibold text-p-accent hover:underline"
                    >
                      Ver cliente →
                    </Link>
                  )}
                </div>
                <span className={`flex-none text-[12px] font-semibold ${status.tone}`}>{status.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
