import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleSlash, MessageCircle, Phone } from 'lucide-react';
import { AdminFeedbackBanner } from '../ui/AdminFeedback';
import { fetchWithAuth } from '../../../utils/apiClient';
import { getApiUrl } from '../../../utils/apiUrl';
import { throwApiErrorFromResponse } from '../../../utils/apiError';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';

export type ClubMessagingStatus = {
  clubPhone: string | null;
  clubPhoneValid: boolean;
  customerReady: boolean;
  staffReady: boolean;
  senderMode: string | null;
  pendingWarning: { enabled: boolean; minutesBefore: number | null };
  autoCancel: { enabled: boolean; minutesBefore: number | null };
  last7Days: { sent: number; failed: number };
};

type RowState = { tone: 'on' | 'off' | 'missing'; text: string; fix?: { href: string; label: string } };

const PIQUE_HELP_URL = 'https://wa.me/5493513436163';

const formatMinutes = (minutes: number | null): string => {
  if (!minutes || minutes <= 0) return '';
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hora' : `${hours} horas`;
  }
  return `${minutes} minutos`;
};

function StateChip({ state }: { state: RowState }) {
  const tone =
    state.tone === 'on'
      ? 'bg-p-positive-bg text-p-positive'
      : state.tone === 'missing'
        ? 'bg-p-warning-bg text-p-warning'
        : 'bg-p-surface-2 text-p-text-muted';
  const Icon = state.tone === 'on' ? CheckCircle2 : CircleSlash;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      <Icon size={12} />
      {state.text}
    </span>
  );
}

function NoticeRow({ title, detail, state }: { title: string; detail: string; state: RowState }) {
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-[14px] font-semibold text-p-text">{title}</p>
        <p className="text-[12px] text-p-text-muted">{detail}</p>
      </div>
      <div className="flex flex-none flex-col items-start gap-1 sm:items-end">
        <StateChip state={state} />
        {state.fix && (
          <Link href={state.fix.href} className="text-[12px] font-semibold text-p-accent hover:underline">
            {state.fix.label} →
          </Link>
        )}
      </div>
    </li>
  );
}

/** Mensajes para el club: qué avisos por WhatsApp salen solos y si están prendidos. Solo lectura. */
export default function ClubMessagesPanel() {
  const [status, setStatus] = useState<ClubMessagingStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await fetchWithAuth(`${getApiUrl()}/api/club-messages/status`);
      if (!response.ok) await throwApiErrorFromResponse(response, 'No se pudo cargar el estado de los avisos.');
      setStatus((await response.json()) as ClubMessagingStatus);
    } catch (loadError) {
      reportUiError({ area: 'ClubMessagesPanel', action: 'load' }, loadError);
      setError(extractErrorMessage(loadError, 'No se pudo cargar el estado de los avisos.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !status) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-p-surface-2" />
        ))}
      </div>
    );
  }

  if (error && !status) {
    return <AdminFeedbackBanner tone="error">{error}</AdminFeedbackBanner>;
  }
  if (!status) return null;

  const off: RowState = { tone: 'off', text: 'Todavía no está prendido' };
  const customerState: RowState = status.customerReady ? { tone: 'on', text: 'Activo' } : off;
  const clubState: RowState = !status.staffReady
    ? off
    : status.clubPhoneValid
      ? { tone: 'on', text: 'Activo' }
      : status.clubPhone
        ? { tone: 'missing', text: 'Revisá el teléfono del club', fix: { href: '/admin/ajustes?tab=club', label: 'Corregirlo en Ajustes' } }
        : { tone: 'missing', text: 'Falta el teléfono del club', fix: { href: '/admin/ajustes?tab=club', label: 'Cargarlo en Ajustes' } };
  const warningState: RowState = !status.pendingWarning.enabled
    ? { tone: 'off', text: 'Apagado', fix: { href: '/admin/ajustes?tab=reservas', label: 'Prenderlo en Ajustes' } }
    : customerState;
  const anyReady = status.customerReady || status.staffReady;
  const warningWhen = formatMinutes(status.pendingWarning.minutesBefore);

  return (
    <div className="space-y-4">
      {!anyReady ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-p-border bg-p-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <MessageCircle size={20} className="mt-0.5 flex-none text-p-text-muted" />
            <div>
              <p className="text-[15px] font-bold text-p-text">Los avisos por WhatsApp todavía no están prendidos</p>
              <p className="text-[13px] text-p-text-muted">
                Cuando estén activos, tus clientes reciben un WhatsApp cuando reservan o se les cancela un turno. Lo prende el equipo de Pique.
              </p>
            </div>
          </div>
          <a
            href={PIQUE_HELP_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 flex-none items-center justify-center rounded-lg bg-ink-900 px-3 text-[13px] font-semibold !text-ink-50 hover:bg-ink-800"
          >
            Pedírselo a Pique
          </a>
        </div>
      ) : (
        <div className="rounded-2xl border border-p-border bg-p-surface p-4">
          <p className="text-[15px] font-bold text-p-text">Los avisos por WhatsApp están prendidos</p>
          <p className="text-[13px] text-p-text-muted">
            En los últimos 7 días salieron {status.last7Days.sent} {status.last7Days.sent === 1 ? 'aviso' : 'avisos'}
            {status.last7Days.failed > 0 ? ` y ${status.last7Days.failed} no ${status.last7Days.failed === 1 ? 'llegó' : 'llegaron'}` : ''}.
          </p>
        </div>
      )}

      <section>
        <p className="mb-1.5 px-1 text-[13px] font-semibold text-p-text">Lo que le llega a tus clientes</p>
        <ul className="divide-y divide-p-border rounded-2xl border border-p-border bg-p-surface">
          <NoticeRow
            title="Reserva hecha"
            detail="Día, hora, cancha y precio, con un link para escribirle al club."
            state={customerState}
          />
          <NoticeRow
            title="Reserva cancelada"
            detail="Qué turno se canceló y por qué (la cancelaste vos, no se confirmó a tiempo o no pagó la seña)."
            state={customerState}
          />
          <NoticeRow
            title="Aviso antes de que se cancele sola"
            detail={
              status.pendingWarning.enabled && warningWhen
                ? `Si la reserva sigue sin confirmar, le avisamos ${warningWhen} antes de cancelarla.`
                : 'Si la reserva sigue sin confirmar, le avisamos antes de cancelarla. Sirve si usás la cancelación automática.'
            }
            state={warningState}
          />
        </ul>
        <p className="mt-1.5 px-1 text-[12px] text-p-text-muted">Solo les llega a los clientes que tienen el celular cargado.</p>
      </section>

      <section>
        <p className="mb-1.5 px-1 text-[13px] font-semibold text-p-text">Lo que te llega a vos</p>
        <ul className="divide-y divide-p-border rounded-2xl border border-p-border bg-p-surface">
          <NoticeRow title="Nueva reserva" detail="Quién reservó, qué cancha y a qué hora." state={clubState} />
          <NoticeRow title="Reserva cancelada" detail="Qué turno quedó libre." state={clubState} />
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[12px] text-p-text-muted">
          <Phone size={13} />
          {status.clubPhone ? (
            <span>
              Llegan al teléfono del club: <span className="font-semibold text-p-text">{status.clubPhone}</span>
              {!status.clubPhoneValid && <span className="text-p-warning"> (no parece un celular válido)</span>}
            </span>
          ) : (
            <span>El club no tiene teléfono cargado.</span>
          )}
          <Link href="/admin/ajustes?tab=club" className="font-semibold text-p-accent hover:underline">
            {status.clubPhone ? 'Cambiarlo' : 'Cargarlo'} en Ajustes →
          </Link>
        </div>
      </section>

      <p className="px-1 text-[12px] text-p-text-muted">Los avisos salen solos. Desde acá no se manda ningún mensaje.</p>
    </div>
  );
}
