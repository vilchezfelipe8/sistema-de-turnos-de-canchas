import { useEffect, useState } from 'react';
import { fetchWithAuth } from '../../../utils/apiClient';
import { getApiUrl } from '../../../utils/apiUrl';
import { reportUiError } from '../../../utils/uiError';
import { CLUB_MESSAGE_STATUS, formatClubMessageSlot, formatClubMessageWhen, type ClubMessageItem } from './ClubMessagesHistory';

const WHAT: Record<ClubMessageItem['eventType'], string> = {
  BOOKING_CREATED: 'quedó hecha',
  BOOKING_CANCELLED: 'se canceló',
  BOOKING_PENDING_WARNING: 'se cancela si no la confirma',
  ACCOUNT_VERIFICATION_CODE: 'código para entrar a la app',
};

/** Ficha del cliente: los avisos por WhatsApp que le mandamos. Si no recibió ninguno, no se muestra. */
export default function ClientMessagesSection({ clientId }: { clientId: string }) {
  const [items, setItems] = useState<ClubMessageItem[]>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setShowAll(false);
    if (!clientId) return;
    (async () => {
      try {
        const response = await fetchWithAuth(
          `${getApiUrl()}/api/club-messages/history?clientId=${encodeURIComponent(clientId)}&limit=20`
        );
        if (!response.ok) return;
        const data = (await response.json()) as { items?: ClubMessageItem[] };
        if (!cancelled) setItems(Array.isArray(data.items) ? data.items : []);
      } catch (error) {
        reportUiError({ area: 'ClientMessagesSection', action: 'load' }, error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (items.length === 0) return null;
  const visible = showAll ? items : items.slice(0, 3);
  // Solo alarma si el último aviso no llegó (uno viejo fallido y después llegaron: está bien).
  const lastFailed = items[0]?.status === 'FAILED' ? items[0] : null;

  return (
    <div className="border-t border-p-border pt-5">
      <p className="text-[13px] font-semibold text-p-text">Avisos que recibió</p>
      {lastFailed && (
        <p className="mt-0.5 text-[12px] text-p-error">
          {lastFailed.failReason === 'Ese número no tiene WhatsApp'
            ? 'Su número no tiene WhatsApp: revisalo en Datos.'
            : 'El último aviso no le llegó.'}
        </p>
      )}
      <ul className="mt-1 divide-y divide-p-border">
        {visible.map((item) => {
          const status = CLUB_MESSAGE_STATUS[item.status] || CLUB_MESSAGE_STATUS.SENT;
          const slot = item.booking ? formatClubMessageSlot(item.booking.startDateTime) : '';
          const court = item.booking?.courtName ? ` en ${item.booking.courtName}` : '';
          return (
            <li key={item.id} className="flex items-start justify-between gap-3 py-2 text-[12px]">
              <div className="min-w-0">
                <p className="text-p-text">
                  {slot ? `Reserva del ${slot}${court}` : 'Reserva'}: {WHAT[item.eventType] || ''}
                </p>
                <p className="text-p-text-muted">{formatClubMessageWhen(item.createdAt)}</p>
              </div>
              <span className={`flex-none font-semibold ${status.tone}`}>{status.label}</span>
            </li>
          );
        })}
      </ul>
      {items.length > 3 && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="mt-1 text-[12px] font-semibold text-p-accent hover:underline"
        >
          {showAll ? 'Ver menos' : `Ver los ${items.length}`}
        </button>
      )}
    </div>
  );
}
