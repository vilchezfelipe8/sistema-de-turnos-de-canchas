import { useEffect, useMemo, useState } from 'react';
import {
  ClubAdminService,
  type ClientDuplicateIncident
} from '../../services/ClubAdminService';
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';

const formatUserName = (user?: { firstName?: string | null; lastName?: string | null } | null) => {
  const first = String(user?.firstName || '').trim();
  const last = String(user?.lastName || '').trim();
  return `${first} ${last}`.trim() || 'Sin usuario';
};

export default function AdminDuplicateIncidents() {
  const [clubSlug, setClubSlug] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [feedback, setFeedback] = useState<string>('');
  const [incidents, setIncidents] = useState<ClientDuplicateIncident[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [detail, setDetail] = useState<ClientDuplicateIncident | null>(null);

  useEffect(() => {
    const resolvedSlug = getActiveClubSlug(normalizeSessionUser(null));
    setClubSlug(resolvedSlug || '');
  }, []);

  const loadIncidents = async (slug: string) => {
    setLoading(true);
    setError('');
    try {
      const rows = await ClubAdminService.listClientDuplicateIncidents(slug, { status: 'OPEN' });
      setIncidents(rows);
      if (rows.length === 0) {
        setSelectedId('');
        setDetail(null);
      } else if (!rows.some((row) => row.id === selectedId)) {
        setSelectedId(rows[0].id);
      }
    } catch (err: any) {
      setError(err?.message || 'No se pudo cargar la bandeja');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!clubSlug) return;
    void loadIncidents(clubSlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubSlug]);

  useEffect(() => {
    if (!clubSlug || !selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError('');
    ClubAdminService.getClientDuplicateIncident(clubSlug, selectedId)
      .then((row) => {
        if (!cancelled) setDetail(row);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'No se pudo cargar el detalle');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clubSlug, selectedId]);

  const openCount = useMemo(
    () => incidents.filter((incident) => String(incident.status) === 'OPEN').length,
    [incidents]
  );

  const handleResolve = async (clientId: string) => {
    if (!clubSlug || !detail?.id || !clientId) return;
    setBusy(true);
    setFeedback('');
    setError('');
    try {
      await ClubAdminService.resolveClientDuplicateIncidentLink(clubSlug, detail.id, clientId);
      setFeedback('Incidente resuelto y vínculo aplicado.');
      await loadIncidents(clubSlug);
    } catch (err: any) {
      setError(err?.message || 'No se pudo resolver el incidente');
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async () => {
    if (!clubSlug || !detail?.id) return;
    setBusy(true);
    setFeedback('');
    setError('');
    try {
      await ClubAdminService.dismissClientDuplicateIncident(clubSlug, detail.id);
      setFeedback('Incidente descartado.');
      await loadIncidents(clubSlug);
    } catch (err: any) {
      setError(err?.message || 'No se pudo descartar el incidente');
    } finally {
      setBusy(false);
    }
  };

  if (!clubSlug) {
    return <div className="text-sm text-[#EBE1D8]/80">No se pudo resolver el club activo para mostrar la bandeja.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/20 bg-[#0f3f2e]/60 p-5">
        <h1 className="text-xl font-black tracking-wide uppercase">Posibles clientes duplicados</h1>
        <p className="mt-1 text-sm text-[#EBE1D8]/80">
          Incidentes abiertos: <span className="font-bold">{openCount}</span>
        </p>
      </div>

      {error ? <div className="rounded-xl border border-red-300/50 bg-red-900/30 p-3 text-sm">{error}</div> : null}
      {feedback ? <div className="rounded-xl border border-lime-300/50 bg-lime-900/30 p-3 text-sm">{feedback}</div> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/20 bg-[#174f3a]/60 p-4 lg:col-span-1">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide">Bandeja</h2>
          {loading ? <p className="text-sm text-[#EBE1D8]/80">Cargando...</p> : null}
          {!loading && incidents.length === 0 ? <p className="text-sm text-[#EBE1D8]/80">No hay incidentes abiertos.</p> : null}
          <div className="space-y-2">
            {incidents.map((incident) => (
              <button
                key={incident.id}
                type="button"
                onClick={() => setSelectedId(incident.id)}
                className={`w-full rounded-lg border p-3 text-left transition ${
                  selectedId === incident.id ? 'border-lime-300 bg-[#1f6b4f]' : 'border-white/20 bg-[#1b5a42]/70 hover:bg-[#1f6b4f]'
                }`}
              >
                <div className="text-xs font-bold uppercase tracking-wide opacity-80">
                  {incident.sourceType} · {incident.reasonType}
                </div>
                <div className="mt-1 text-sm">
                  Usuario: {formatUserName(incident.user)}
                </div>
                <div className="text-xs opacity-70">
                  {Array.isArray(incident.candidateClientIds) ? incident.candidateClientIds.length : 0} candidatos
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/20 bg-[#174f3a]/60 p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide">Detalle</h2>
          {!selectedId ? <p className="text-sm text-[#EBE1D8]/80">Seleccioná un incidente.</p> : null}
          {selectedId && busy && !detail ? <p className="text-sm text-[#EBE1D8]/80">Cargando detalle...</p> : null}
          {detail ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-white/20 bg-black/10 p-3 text-sm">
                <p><span className="font-bold">Origen:</span> {detail.sourceType}</p>
                <p><span className="font-bold">Motivo:</span> {detail.reasonType}</p>
                <p><span className="font-bold">Usuario:</span> {formatUserName(detail.user)}</p>
              </div>

              <div className="space-y-2">
                {(detail.candidateClients || []).map((client) => (
                  <div key={client.id} className="rounded-lg border border-white/20 bg-black/10 p-3 text-sm">
                    <p className="font-bold">{client.name || 'Sin nombre'}</p>
                    <p>Tel: {client.phone || '—'}</p>
                    <p>Email: {client.email || '—'}</p>
                    <p>DNI: {client.dni || '—'}</p>
                    <p>UserId: {client.userId || '—'}</p>
                    {detail.userId ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleResolve(client.id)}
                        className="mt-2 rounded bg-lime-500 px-3 py-1 text-xs font-black text-[#143b2d] disabled:opacity-50"
                      >
                        Vincular usuario a este cliente
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              <div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleDismiss}
                  className="rounded border border-white/30 px-3 py-2 text-xs font-bold uppercase tracking-wide disabled:opacity-50"
                >
                  Descartar incidente
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
