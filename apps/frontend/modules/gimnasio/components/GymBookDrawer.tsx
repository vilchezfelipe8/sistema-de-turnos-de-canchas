import { useEffect, useRef, useState } from 'react';
import AdminDrawer from '../../../components/admin/ui/AdminDrawer';
import { AdminPersonList, AdminPersonOption, AdminSearchInput } from '../../../components/admin/ui/AdminPersonPicker';
import { AdminInlineError } from '../../../components/admin/ui/AdminFeedback';
import { adminButton } from '../../../components/admin/ui/adminButton';
import { ActivityTurnService } from '../../../services/ActivityTurnService';
import { searchClients } from '../../../services/BookingService';
import { showAdminToast } from '../../../utils/adminToast';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';

type ClientHit = { id: string; name: string; detail: string };

const toHit = (raw: any): ClientHit | null => {
  const id = String(raw?.id || '').trim();
  // Los usuarios del sistema que no son clientes del club no se pueden anotar.
  if (!id || id.startsWith('user-')) return null;
  return {
    id: id.startsWith('client-') ? id.slice('client-'.length) : id,
    name: String(raw?.name || '').trim() || 'Sin nombre',
    detail: String(raw?.phone || raw?.email || raw?.dni || '').trim(),
  };
};

type Props = {
  open: boolean;
  onClose: () => void;
  clubSlug: string;
  slot: { activityTypeId: number; activityName: string; startsAt: string; time: string } | null;
  /** Ya anotados en esa franja (no se ofrecen). */
  takenClientIds: string[];
  onBooked: () => void;
};

/** Anotar a alguien en una franja desde el mostrador (llegó sin reservar, o pidió por teléfono). */
export default function GymBookDrawer({ open, onClose, clubSlug, slot, takenClientIds, onBooked }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ClientHit | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHits([]);
    setSelected(null);
    setError('');
  }, [open, slot?.startsAt]);

  useEffect(() => {
    const term = query.trim();
    if (!open || term.length < 2 || !clubSlug) {
      setHits([]);
      setLoading(false);
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const results = await searchClients(clubSlug, term);
        if (requestId !== requestRef.current) return;
        setHits(
          (Array.isArray(results) ? results : [])
            .map(toHit)
            .filter((hit): hit is ClientHit => Boolean(hit))
            .slice(0, 12)
        );
      } catch (err) {
        if (requestId !== requestRef.current) return;
        reportUiError({ area: 'GymBookDrawer', action: 'search' }, err);
        setHits([]);
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, open, clubSlug]);

  const submit = async () => {
    if (!slot || !selected) return;
    try {
      setSubmitting(true);
      setError('');
      await ActivityTurnService.adminBook(clubSlug, slot.activityTypeId, slot.startsAt, selected.id);
      showAdminToast(`${selected.name} anotado a las ${slot.time}.`);
      onBooked();
      onClose();
    } catch (err) {
      reportUiError({ area: 'GymBookDrawer', action: 'book' }, err);
      setError(extractErrorMessage(err, 'No se pudo anotar el turno.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminDrawer
      open={open}
      onClose={onClose}
      title={slot ? `Anotar a las ${slot.time}` : 'Anotar'}
      subtitle={slot?.activityName}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={adminButton('secondary', 'lg')} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className={adminButton('primary', 'lg')} disabled={!selected || submitting} onClick={() => void submit()}>
            {submitting ? 'Anotando...' : 'Anotar'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <AdminSearchInput
          size="lg"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setError('');
          }}
          placeholder="Buscá por nombre, teléfono o DNI"
          autoFocus
        />
        <AdminPersonList loading={loading} query={query} minChars={2} count={hits.length} empty="No hay clientes con ese dato.">
          {hits.map((hit) => {
            const taken = takenClientIds.includes(hit.id);
            return (
              <AdminPersonOption
                key={hit.id}
                name={hit.name}
                detail={taken ? 'Ya tiene turno a esta hora' : hit.detail}
                selected={selected?.id === hit.id}
                disabled={taken || submitting}
                onClick={() => {
                  setSelected(hit);
                  setError('');
                }}
              />
            );
          })}
        </AdminPersonList>
        {error ? <AdminInlineError>{error}</AdminInlineError> : null}
        <p className="text-[12px] text-p-text-muted">Necesita un plan que incluya esta actividad y lugar en la franja, igual que si reservara desde la app.</p>
      </div>
    </AdminDrawer>
  );
}
