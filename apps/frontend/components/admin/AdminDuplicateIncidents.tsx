import { useEffect, useMemo, useState } from 'react';
import {
  ClubAdminService,
  type ClientDuplicateIncident,
  type ClientIdentityIncident,
} from '../../services/ClubAdminService';
import { ClientService, type ClientIdentityAuditEntry } from '../../services/ClientService';
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';
import { showAdminToast } from '../../utils/adminToast';
import { extractErrorMessage } from '../../utils/uiError';
import { AdminFeedbackBanner } from './ui/AdminFeedback';
import AdminAppModal from './ui/AdminAppModal';

const formatUserName = (user?: { firstName?: string | null; lastName?: string | null } | null) => {
  const first = String(user?.firstName || '').trim();
  const last = String(user?.lastName || '').trim();
  return `${first} ${last}`.trim() || 'Sin usuario';
};

const formatIdentitySignals = (signals: Array<string>) => {
  const labels = signals
    .map((signal) => {
      if (signal === 'EMAIL') return 'email';
      if (signal === 'PHONE') return 'teléfono';
      if (signal === 'DNI') return 'DNI';
      return String(signal || '').toLowerCase();
    })
    .filter(Boolean);
  return labels.length > 0 ? labels.join(', ') : 'sin señales fuertes';
};

const formatIdentityStatus = (status: string) => {
  if (status === 'REVIEW_REQUIRED') return 'Revisión requerida';
  if (status === 'SUGGESTED_LINK') return 'Sugerencia de vínculo';
  if (status === 'LINKED') return 'Vinculado';
  if (status === 'NO_MATCH') return 'Sin match';
  return status || 'Sin estado';
};

type IncidentMode = 'duplicates' | 'identity';
type IdentityStatusFilter = 'all' | 'REVIEW_REQUIRED' | 'SUGGESTED_LINK';
type IdentitySignalFilter = 'all' | 'EMAIL' | 'PHONE' | 'DNI';
type IdentityConflictFilter =
  | 'all'
  | 'with_duplicates'
  | 'user_already_linked'
  | 'multiple_users'
  | 'clean_suggestion';

export default function AdminDuplicateIncidents(props: { preferredIdentityClientId?: string | null } = {}) {
  const [clubSlug, setClubSlug] = useState<string>('');
  const [incidentMode, setIncidentMode] = useState<IncidentMode>('duplicates');
  const [loading, setLoading] = useState<boolean>(true);
  const [identityLoading, setIdentityLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [incidents, setIncidents] = useState<ClientDuplicateIncident[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [detail, setDetail] = useState<ClientDuplicateIncident | null>(null);
  const [identityIncidents, setIdentityIncidents] = useState<ClientIdentityIncident[]>([]);
  const [identitySelectedId, setIdentitySelectedId] = useState<string>('');
  const [linkState, setLinkState] = useState<{
    clientId: string;
    clientName: string;
  } | null>(null);
  const [mergeState, setMergeState] = useState<{
    sourceClientId: string;
    sourceClientName: string;
    targetClientId: string;
  } | null>(null);
  const [mergeNotes, setMergeNotes] = useState('');
  const [dismissConfirmOpen, setDismissConfirmOpen] = useState(false);
  const [identityDismissConfirmOpen, setIdentityDismissConfirmOpen] = useState(false);
  const [identityMergeState, setIdentityMergeState] = useState<{
    sourceClientId: string;
    sourceClientName: string;
    targetClientId: string;
    targetClientName: string;
  } | null>(null);
  const [identityMergeNotes, setIdentityMergeNotes] = useState('');
  const [identityAuditEntries, setIdentityAuditEntries] = useState<ClientIdentityAuditEntry[]>([]);
  const [identityAuditLoading, setIdentityAuditLoading] = useState(false);
  const [identityAuditError, setIdentityAuditError] = useState('');
  const [identityStatusFilter, setIdentityStatusFilter] = useState<IdentityStatusFilter>('all');
  const [identitySignalFilter, setIdentitySignalFilter] = useState<IdentitySignalFilter>('all');
  const [identityConflictFilter, setIdentityConflictFilter] = useState<IdentityConflictFilter>('all');

  useEffect(() => {
    const resolvedSlug = getActiveClubSlug(normalizeSessionUser(null));
    setClubSlug(resolvedSlug || '');
  }, []);

  useEffect(() => {
    const preferredClientId = String(props.preferredIdentityClientId || '').trim();
    if (!preferredClientId) return;
    setIncidentMode('identity');
    setIdentitySelectedId(preferredClientId);
  }, [props.preferredIdentityClientId]);

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
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'No se pudo cargar la bandeja de duplicados'));
    } finally {
      setLoading(false);
    }
  };

  const loadIdentityIncidents = async (slug: string) => {
    setIdentityLoading(true);
    setError('');
    try {
      const rows = await ClubAdminService.listClientIdentityIncidents(slug, {
        status: 'REVIEW_REQUIRED,SUGGESTED_LINK',
        limit: 80,
      });
      setIdentityIncidents(rows);
      if (rows.length === 0) {
        setIdentitySelectedId('');
      } else if (!rows.some((row) => row.clientId === identitySelectedId)) {
        setIdentitySelectedId(rows[0].clientId);
      }
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'No se pudo cargar la bandeja de identidad'));
    } finally {
      setIdentityLoading(false);
    }
  };

  useEffect(() => {
    if (!clubSlug) return;
    void Promise.all([loadIncidents(clubSlug), loadIdentityIncidents(clubSlug)]);
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
      .catch((err: unknown) => {
        if (!cancelled) setError(extractErrorMessage(err, 'No se pudo cargar el detalle'));
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

  const identityCount = useMemo(() => identityIncidents.length, [identityIncidents]);

  const identityFilterCounts = useMemo(() => {
    return {
      status: {
        all: identityIncidents.length,
        REVIEW_REQUIRED: identityIncidents.filter((incident) => String(incident.status) === 'REVIEW_REQUIRED').length,
        SUGGESTED_LINK: identityIncidents.filter((incident) => String(incident.status) === 'SUGGESTED_LINK').length,
      },
      signal: {
        all: identityIncidents.length,
        EMAIL: identityIncidents.filter((incident) => incident.signals.includes('EMAIL')).length,
        PHONE: identityIncidents.filter((incident) => incident.signals.includes('PHONE')).length,
        DNI: identityIncidents.filter((incident) => incident.signals.includes('DNI')).length,
      },
      conflict: {
        all: identityIncidents.length,
        with_duplicates: identityIncidents.filter((incident) => incident.duplicateClients.length > 0).length,
        user_already_linked: identityIncidents.filter((incident) => String(incident.reasonCode) === 'USER_ALREADY_LINKED_ELSEWHERE').length,
        multiple_users: identityIncidents.filter((incident) => String(incident.reasonCode) === 'MULTIPLE_USER_CANDIDATES').length,
        clean_suggestion: identityIncidents.filter(
          (incident) => String(incident.status) === 'SUGGESTED_LINK' && incident.duplicateClients.length === 0
        ).length,
      },
    };
  }, [identityIncidents]);

  const filteredIdentityIncidents = useMemo(() => {
    return identityIncidents.filter((incident) => {
      if (identityStatusFilter !== 'all' && String(incident.status) !== identityStatusFilter) return false;
      if (identitySignalFilter !== 'all' && !incident.signals.includes(identitySignalFilter)) return false;
      if (identityConflictFilter === 'with_duplicates' && incident.duplicateClients.length === 0) return false;
      if (identityConflictFilter === 'user_already_linked' && String(incident.reasonCode) !== 'USER_ALREADY_LINKED_ELSEWHERE') {
        return false;
      }
      if (identityConflictFilter === 'multiple_users' && String(incident.reasonCode) !== 'MULTIPLE_USER_CANDIDATES') {
        return false;
      }
      if (
        identityConflictFilter === 'clean_suggestion' &&
        !(String(incident.status) === 'SUGGESTED_LINK' && incident.duplicateClients.length === 0)
      ) {
        return false;
      }
      return true;
    });
  }, [identityConflictFilter, identityIncidents, identitySignalFilter, identityStatusFilter]);

  const identityDetail = useMemo(
    () => filteredIdentityIncidents.find((incident) => String(incident.clientId) === String(identitySelectedId)) || null,
    [filteredIdentityIncidents, identitySelectedId]
  );

  useEffect(() => {
    if (filteredIdentityIncidents.length === 0) {
      setIdentitySelectedId('');
      return;
    }
    if (!filteredIdentityIncidents.some((incident) => String(incident.clientId) === String(identitySelectedId))) {
      setIdentitySelectedId(filteredIdentityIncidents[0].clientId);
    }
  }, [filteredIdentityIncidents, identitySelectedId]);

  useEffect(() => {
    if (!clubSlug || !identityDetail?.clientId) {
      setIdentityAuditEntries([]);
      setIdentityAuditError('');
      setIdentityAuditLoading(false);
      return;
    }
    let cancelled = false;
    setIdentityAuditLoading(true);
    setIdentityAuditError('');
    ClientService.getIdentityAuditByClubSlug(clubSlug, String(identityDetail.clientId), 8)
      .then((entries) => {
        if (!cancelled) setIdentityAuditEntries(entries);
      })
      .catch((err: unknown) => {
        if (!cancelled) setIdentityAuditError(extractErrorMessage(err, 'No se pudo cargar la auditoría de identidad'));
      })
      .finally(() => {
        if (!cancelled) setIdentityAuditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clubSlug, identityDetail?.clientId]);

  const handleResolve = async () => {
    if (!clubSlug || !detail?.id || !linkState?.clientId) return;
    setBusy(true);
    setError('');
    try {
      await ClubAdminService.resolveClientDuplicateIncidentLink(clubSlug, detail.id, linkState.clientId);
      setLinkState(null);
      showAdminToast('Incidente resuelto y vínculo aplicado.');
      await loadIncidents(clubSlug);
    } catch (err: unknown) {
      const message = extractErrorMessage(err, 'No se pudo resolver el incidente');
      setError(message);
      showAdminToast(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async () => {
    if (!clubSlug || !detail?.id) return;
    setBusy(true);
    setError('');
    try {
      await ClubAdminService.dismissClientDuplicateIncident(clubSlug, detail.id);
      showAdminToast('Incidente descartado.');
      await loadIncidents(clubSlug);
      setDismissConfirmOpen(false);
    } catch (err: unknown) {
      const message = extractErrorMessage(err, 'No se pudo descartar el incidente');
      setError(message);
      showAdminToast(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleIdentityDismiss = async () => {
    if (!clubSlug || !identityDetail?.incidentId) return;
    setBusy(true);
    setError('');
    try {
      await ClubAdminService.dismissClientDuplicateIncident(clubSlug, identityDetail.incidentId);
      showAdminToast('Caso de identidad descartado.');
      await loadIdentityIncidents(clubSlug);
      setIdentityDismissConfirmOpen(false);
    } catch (err: unknown) {
      const message = extractErrorMessage(err, 'No se pudo descartar el caso de identidad');
      setError(message);
      showAdminToast(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const openResolveLink = (clientId: string, clientName: string) => {
    setLinkState({
      clientId: String(clientId),
      clientName: String(clientName || 'Cliente seleccionado'),
    });
  };

  const openMerge = (sourceClientId: string) => {
    const candidates = detail?.candidateClients || [];
    const source = candidates.find((client) => String(client.id) === String(sourceClientId));
    if (!source) return;
    const preferredTargetId =
      String(detail?.primaryClientId || '').trim() ||
      String(candidates.find((client) => String(client.id) !== String(source.id))?.id || '').trim();
    if (!preferredTargetId || preferredTargetId === String(source.id)) return;
    setMergeNotes('');
    setMergeState({
      sourceClientId: String(source.id),
      sourceClientName: String(source.name || 'Cliente origen'),
      targetClientId: preferredTargetId,
    });
  };

  const handleMerge = async () => {
    if (!clubSlug || !detail?.id || !mergeState?.sourceClientId || !mergeState?.targetClientId) return;
    setBusy(true);
    setError('');
    try {
      await ClientService.mergeByClubSlug(clubSlug, mergeState.sourceClientId, mergeState.targetClientId, {
        incidentId: detail.id,
        resolutionNotes: mergeNotes.trim() || undefined,
      });
      setMergeState(null);
      setMergeNotes('');
      showAdminToast('Incidente resuelto mediante fusión manual.');
      await Promise.all([loadIncidents(clubSlug), loadIdentityIncidents(clubSlug)]);
    } catch (err: unknown) {
      const message = extractErrorMessage(err, 'No se pudo fusionar el cliente');
      setError(message);
      showAdminToast(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleIdentityLink = async (clientId: string, userId: number) => {
    if (!clubSlug || !clientId || !Number.isInteger(Number(userId)) || Number(userId) <= 0) return;
    setBusy(true);
    setError('');
    try {
      await ClientService.linkUserByClubSlug(clubSlug, String(clientId), Number(userId));
      showAdminToast('Cliente vinculado al usuario.');
      await loadIdentityIncidents(clubSlug);
    } catch (err: unknown) {
      const message = extractErrorMessage(err, 'No se pudo vincular el usuario');
      setError(message);
      showAdminToast(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const openIdentityMerge = (targetClientId: string, targetClientName: string) => {
    if (!identityDetail?.clientId) return;
    setIdentityMergeNotes('');
    setIdentityMergeState({
      sourceClientId: String(identityDetail.clientId),
      sourceClientName: String(identityDetail.clientName || 'Cliente origen'),
      targetClientId: String(targetClientId),
      targetClientName: String(targetClientName || 'Cliente destino'),
    });
  };

  const handleIdentityMerge = async () => {
    if (!clubSlug || !identityMergeState?.sourceClientId || !identityMergeState?.targetClientId) return;
    setBusy(true);
    setError('');
    try {
      await ClientService.mergeByClubSlug(
        clubSlug,
        identityMergeState.sourceClientId,
        identityMergeState.targetClientId,
        { resolutionNotes: identityMergeNotes.trim() || undefined }
      );
      setIdentityMergeState(null);
      setIdentityMergeNotes('');
      showAdminToast('Clientes fusionados desde la bandeja de identidad.');
      await loadIdentityIncidents(clubSlug);
    } catch (err: unknown) {
      const message = extractErrorMessage(err, 'No se pudo fusionar el cliente');
      setError(message);
      showAdminToast(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!clubSlug) {
    return (
      <AdminFeedbackBanner tone="error">
        No se pudo resolver el club activo para mostrar la bandeja.
      </AdminFeedbackBanner>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-p-border bg-p-surface p-5 shadow-p-card">
        <h1 className="text-[18px] font-semibold tracking-tight text-p-text">Bandeja operativa de identidad</h1>
        <p className="mt-1 text-[13px] text-p-text-muted">
          Duplicados abiertos: <span className="font-bold">{openCount}</span>
          {' · '}
          Conflictos de identidad: <span className="font-bold">{identityCount}</span>
        </p>
        <div className="mt-4 inline-flex rounded-xl border border-p-border bg-p-surface-2 p-1">
          <button
            type="button"
            onClick={() => setIncidentMode('duplicates')}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
              incidentMode === 'duplicates' ? 'bg-p-surface text-p-text shadow-sm' : 'text-p-text-muted hover:text-p-text'
            }`}
          >
            Duplicados
          </button>
          <button
            type="button"
            onClick={() => setIncidentMode('identity')}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
              incidentMode === 'identity' ? 'bg-p-surface text-p-text shadow-sm' : 'text-p-text-muted hover:text-p-text'
            }`}
          >
            Identidad
          </button>
        </div>
      </div>

      {error ? <AdminFeedbackBanner tone="error">{error}</AdminFeedbackBanner> : null}

      {incidentMode === 'duplicates' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-p-border bg-p-surface p-4 shadow-p-card lg:col-span-1">
            <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-widest text-p-text-muted">Bandeja</h2>
            {loading ? <p className="text-[13px] text-p-text-muted">Cargando...</p> : null}
            {!loading && incidents.length === 0 ? <p className="text-[13px] text-p-text-muted">No hay incidentes abiertos.</p> : null}
            <div className="space-y-2">
              {incidents.map((incident) => (
                <button
                  key={incident.id}
                  type="button"
                  onClick={() => setSelectedId(incident.id)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    selectedId === incident.id ? 'border-p-accent bg-p-positive-bg' : 'border-p-border bg-p-surface-2 hover:bg-p-surface'
                  }`}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-p-text-muted">
                    {incident.sourceType} · {incident.reasonType}
                  </div>
                  <div className="mt-1 text-[13px] font-semibold text-p-text">
                    Usuario: {formatUserName(incident.user)}
                  </div>
                  <div className="text-[12px] text-p-text-muted">
                    {Array.isArray(incident.candidateClientIds) ? incident.candidateClientIds.length : 0} candidatos
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-p-border bg-p-surface p-4 shadow-p-card lg:col-span-2">
            <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-widest text-p-text-muted">Detalle</h2>
            {!selectedId ? <p className="text-[13px] text-p-text-muted">Seleccioná un incidente.</p> : null}
            {selectedId && busy && !detail ? <p className="text-[13px] text-p-text-muted">Cargando detalle...</p> : null}
            {detail ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-[13px] text-p-text-secondary">
                  <p><span className="font-bold">Origen:</span> {detail.sourceType}</p>
                  <p><span className="font-bold">Motivo:</span> {detail.reasonType}</p>
                  <p><span className="font-bold">Usuario:</span> {formatUserName(detail.user)}</p>
                </div>

                <div className="space-y-2">
                  {(detail.candidateClients || []).map((client) => (
                    <div key={client.id} className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-[13px] text-p-text-secondary">
                      <p className="font-semibold text-p-text">{client.name || 'Sin nombre'}</p>
                      <p>Tel: {client.phone || '—'}</p>
                      <p>Email: {client.email || '—'}</p>
                      <p>DNI: {client.dni || '—'}</p>
                      <p>UserId: {client.userId || '—'}</p>
                      {detail.userId ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => openResolveLink(client.id, client.name || 'Sin nombre')}
                          className="mt-2 h-9 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold text-ink-50 disabled:opacity-50"
                        >
                          Vincular usuario a este cliente
                        </button>
                      ) : null}
                      {(detail.candidateClients || []).length > 1 ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => openMerge(client.id)}
                          className="mt-2 ml-2 h-9 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary disabled:opacity-50"
                        >
                          Fusionar manualmente
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>

                <div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDismissConfirmOpen(true)}
                    className="h-9 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary hover:bg-p-surface-2 disabled:opacity-50"
                  >
                    Descartar incidente
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-p-border bg-p-surface p-4 shadow-p-card lg:col-span-1">
            <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-widest text-p-text-muted">Bandeja</h2>
            <div className="mb-3 space-y-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-p-text-muted">
                  Estado
                </span>
                <select
                  value={identityStatusFilter}
                  onChange={(event) => setIdentityStatusFilter(event.target.value as IdentityStatusFilter)}
                  className="h-9 w-full rounded-xl border border-p-border bg-p-surface-2 px-3 text-[12px] text-p-text outline-none focus:border-p-accent"
                >
                  <option value="all">Todos ({identityFilterCounts.status.all})</option>
                  <option value="REVIEW_REQUIRED">Revisión requerida ({identityFilterCounts.status.REVIEW_REQUIRED})</option>
                  <option value="SUGGESTED_LINK">Sugerencia de vínculo ({identityFilterCounts.status.SUGGESTED_LINK})</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-p-text-muted">
                  Señal
                </span>
                <select
                  value={identitySignalFilter}
                  onChange={(event) => setIdentitySignalFilter(event.target.value as IdentitySignalFilter)}
                  className="h-9 w-full rounded-xl border border-p-border bg-p-surface-2 px-3 text-[12px] text-p-text outline-none focus:border-p-accent"
                >
                  <option value="all">Todas ({identityFilterCounts.signal.all})</option>
                  <option value="EMAIL">Email ({identityFilterCounts.signal.EMAIL})</option>
                  <option value="PHONE">Teléfono ({identityFilterCounts.signal.PHONE})</option>
                  <option value="DNI">DNI ({identityFilterCounts.signal.DNI})</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-p-text-muted">
                  Tipo de caso
                </span>
                <select
                  value={identityConflictFilter}
                  onChange={(event) => setIdentityConflictFilter(event.target.value as IdentityConflictFilter)}
                  className="h-9 w-full rounded-xl border border-p-border bg-p-surface-2 px-3 text-[12px] text-p-text outline-none focus:border-p-accent"
                >
                  <option value="all">Todos ({identityFilterCounts.conflict.all})</option>
                  <option value="with_duplicates">Con cliente duplicado ({identityFilterCounts.conflict.with_duplicates})</option>
                  <option value="user_already_linked">Usuario ya vinculado ({identityFilterCounts.conflict.user_already_linked})</option>
                  <option value="multiple_users">Múltiples usuarios ({identityFilterCounts.conflict.multiple_users})</option>
                  <option value="clean_suggestion">Sugerencia limpia ({identityFilterCounts.conflict.clean_suggestion})</option>
                </select>
              </label>

              <button
                type="button"
                onClick={() => {
                  setIdentityStatusFilter('all');
                  setIdentitySignalFilter('all');
                  setIdentityConflictFilter('all');
                }}
                className="h-8 rounded-lg border border-p-border bg-p-surface px-3 text-[11px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
              >
                Limpiar filtros
              </button>
            </div>
            {identityLoading ? <p className="text-[13px] text-p-text-muted">Cargando...</p> : null}
            {!identityLoading && identityIncidents.length === 0 ? (
              <div className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-[13px] text-p-text-muted">
                <p>No hay conflictos de identidad pendientes.</p>
                <p className="mt-2">
                  El historial igual se ve en la ficha del cliente, dentro de
                  {' '}
                  <span className="font-semibold text-p-text">Vinculación con usuario</span>
                  {' '}
                  y
                  {' '}
                  <span className="font-semibold text-p-text">Auditoría de identidad</span>.
                </p>
              </div>
            ) : null}
            {!identityLoading && identityIncidents.length > 0 && filteredIdentityIncidents.length === 0 ? (
              <div className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-[13px] text-p-text-muted">
                Ningún caso coincide con los filtros actuales.
              </div>
            ) : null}
            <div className="space-y-2">
              {filteredIdentityIncidents.map((incident) => (
                <button
                  key={incident.clientId}
                  type="button"
                  onClick={() => setIdentitySelectedId(incident.clientId)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    identitySelectedId === incident.clientId ? 'border-p-accent bg-p-positive-bg' : 'border-p-border bg-p-surface-2 hover:bg-p-surface'
                  }`}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-p-text-muted">
                    {formatIdentityStatus(incident.status)} · {formatIdentitySignals(incident.signals)}
                  </div>
                  {incident.isManualReview ? (
                    <div className="mt-1">
                      <span className="rounded-full border border-p-border bg-p-surface px-2 py-0.5 text-[10px] font-semibold text-p-text-secondary">
                        Marcado manualmente
                      </span>
                    </div>
                  ) : null}
                  <div className="mt-1 text-[13px] font-semibold text-p-text">{incident.clientName}</div>
                  <div className="mt-1 text-[12px] text-p-text-muted">{incident.summary}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-p-border bg-p-surface p-4 shadow-p-card lg:col-span-2">
            <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-widest text-p-text-muted">Detalle</h2>
            {!identitySelectedId && filteredIdentityIncidents.length > 0 ? (
              <p className="text-[13px] text-p-text-muted">Seleccioná un caso.</p>
            ) : null}
            {!identitySelectedId && filteredIdentityIncidents.length === 0 && identityIncidents.length === 0 ? (
              <div className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-[13px] text-p-text-muted">
                Cuando se abra un caso de identidad, acá vas a ver también su auditoría.
                Si querés revisar historial ahora mismo, abrí cualquier cliente y bajá a
                {' '}
                <span className="font-semibold text-p-text">Auditoría de identidad</span>.
              </div>
            ) : null}
            {!identitySelectedId && filteredIdentityIncidents.length === 0 && identityIncidents.length > 0 ? (
              <div className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-[13px] text-p-text-muted">
                Ajustá o limpiá los filtros para volver a ver casos en esta bandeja.
              </div>
            ) : null}
            {identitySelectedId && identityLoading && !identityDetail ? <p className="text-[13px] text-p-text-muted">Cargando detalle...</p> : null}
            {identityDetail ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-[13px] text-p-text-secondary">
                  <p><span className="font-bold text-p-text">Cliente:</span> {identityDetail.clientName}</p>
                  <p><span className="font-bold text-p-text">Contacto:</span> {identityDetail.email || identityDetail.phone || identityDetail.dni || '—'}</p>
                  <p><span className="font-bold text-p-text">Estado:</span> {formatIdentityStatus(identityDetail.status)}</p>
                  <p><span className="font-bold text-p-text">Señales:</span> {formatIdentitySignals(identityDetail.signals)}</p>
                  <p className="mt-2">{identityDetail.summary}</p>
                  {identityDetail.isManualReview && identityDetail.manualReviewNote ? (
                    <p className="mt-2 rounded-lg border border-p-border bg-p-surface px-3 py-2 text-[12px] text-p-text-secondary">
                      <span className="font-semibold text-p-text">Nota manual:</span> {identityDetail.manualReviewNote}
                    </p>
                  ) : null}
                </div>

                {identityDetail.status === 'SUGGESTED_LINK' && identityDetail.recommendedUserId ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void handleIdentityLink(identityDetail.clientId, identityDetail.recommendedUserId || 0);
                    }}
                    className="h-9 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold text-ink-50 disabled:opacity-50"
                  >
                    {busy ? 'Vinculando...' : 'Vincular usuario sugerido'}
                  </button>
                ) : null}

                {identityDetail.incidentId ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setIdentityDismissConfirmOpen(true)}
                    className="h-9 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary hover:bg-p-surface-2 disabled:opacity-50"
                  >
                    Descartar caso
                  </button>
                ) : null}

                {identityDetail.userCandidates.length > 0 ? (
                  <div className="space-y-2">
                    <h3 className="text-[12px] font-semibold uppercase tracking-widest text-p-text-muted">
                      Usuarios compatibles
                    </h3>
                    {identityDetail.userCandidates.map((candidate) => (
                      <div key={candidate.userId} className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-[13px] text-p-text-secondary">
                        <p className="font-semibold text-p-text">{candidate.displayName}</p>
                        <p>{candidate.email || candidate.phoneNumber || `Usuario #${candidate.userId}`}</p>
                        <p>Match por {formatIdentitySignals(candidate.matchedBy)}</p>
                        {candidate.linkedClientId ? (
                          <p className="mt-1 text-p-error">
                            Ya está vinculado a {candidate.linkedClientName || `cliente ${candidate.linkedClientId}`}.
                          </p>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              void handleIdentityLink(identityDetail.clientId, candidate.userId);
                            }}
                            className="mt-2 h-9 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold text-ink-50 disabled:opacity-50"
                          >
                            {busy ? 'Vinculando...' : 'Vincular este usuario'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}

                {identityDetail.duplicateClients.length > 0 ? (
                  <div className="space-y-2">
                    <h3 className="text-[12px] font-semibold uppercase tracking-widest text-p-text-muted">
                      Clientes duplicados
                    </h3>
                    {identityDetail.duplicateClients.map((client) => (
                      <div key={client.clientId} className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-[13px] text-p-text-secondary">
                        <p className="font-semibold text-p-text">{client.name}</p>
                        <p>{client.email || client.phone || client.dni || `Cliente ${client.clientId}`}</p>
                        <p>Match por {formatIdentitySignals(client.matchedBy)}</p>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => openIdentityMerge(client.clientId, client.name)}
                          className="mt-2 h-9 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary disabled:opacity-50"
                        >
                          Fusionar con este cliente
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="space-y-2">
                  <h3 className="text-[12px] font-semibold uppercase tracking-widest text-p-text-muted">
                    Auditoría de identidad
                  </h3>
                  {identityAuditLoading ? (
                    <p className="text-[13px] text-p-text-muted">Cargando historial...</p>
                  ) : identityAuditError ? (
                    <AdminFeedbackBanner tone="error" compact>{identityAuditError}</AdminFeedbackBanner>
                  ) : identityAuditEntries.length > 0 ? (
                    identityAuditEntries.map((entry) => (
                      <div key={entry.id} className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-[13px] text-p-text-secondary">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-p-border bg-p-surface px-2 py-0.5 text-[10px] font-semibold text-p-text-secondary">
                            {entry.kindLabel}
                          </span>
                          {entry.sourceLabel ? (
                            <span className="rounded-full border border-p-border bg-p-surface px-2 py-0.5 text-[10px] font-semibold text-p-text-muted">
                              {entry.sourceLabel}
                            </span>
                          ) : null}
                        </div>
                        <p className="font-semibold text-p-text">{entry.summary}</p>
                        <p className="mt-1 text-[11px] text-p-text-muted">
                          {entry.actorUser?.displayName || 'Sistema'} · {new Date(entry.createdAt).toLocaleString('es-AR')}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-[13px] text-p-text-muted">Todavía no hay acciones auditadas para este caso.</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <AdminAppModal
        show={dismissConfirmOpen}
        onClose={() => {
          if (busy) return;
          setDismissConfirmOpen(false);
        }}
        title="Descartar incidente"
        isWarning
        confirmText={busy ? 'Descartando...' : 'Descartar incidente'}
        confirmDisabled={busy}
        onConfirm={() => {
          void handleDismiss();
        }}
        message="Vas a cerrar este incidente sin vincular ni fusionar clientes. Esta acción queda como decisión manual del equipo."
      />

      <AdminAppModal
        show={Boolean(linkState)}
        onClose={() => {
          if (busy) return;
          setLinkState(null);
        }}
        title="Confirmar vínculo manual"
        confirmText={busy ? 'Vinculando...' : 'Confirmar vínculo'}
        confirmDisabled={busy || !linkState?.clientId}
        onConfirm={() => {
          void handleResolve();
        }}
        message={
          <div className="space-y-4">
            <p>Vas a vincular manualmente el usuario del incidente con este cliente. Esta acción no se resuelve nunca de forma automática.</p>
            <div className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-[13px] text-p-text-secondary">
              <p><span className="font-semibold text-p-text">Cliente destino:</span> {linkState?.clientName || '-'}</p>
              <p className="mt-1"><span className="font-semibold text-p-text">Usuario del incidente:</span> {formatUserName(detail?.user)}</p>
            </div>
          </div>
        }
      />

      <AdminAppModal
        show={Boolean(mergeState)}
        onClose={() => {
          if (busy) return;
          setMergeState(null);
          setMergeNotes('');
        }}
        title="Fusionar cliente desde incidente"
        isWarning
        confirmText={busy ? 'Fusionando...' : 'Confirmar fusión'}
        confirmDisabled={busy || !mergeState?.sourceClientId || !mergeState?.targetClientId}
        onConfirm={() => {
          void handleMerge();
        }}
        message={
          <div className="space-y-4">
            <p>Esta acción mueve reservas, cuentas y referencias del cliente origen al cliente destino. No hay merge automático.</p>
            <div className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-[13px] text-p-text-secondary">
              <p><span className="font-semibold text-p-text">Origen:</span> {mergeState?.sourceClientName || '-'}</p>
              <label className="mt-3 block">
                <span className="mb-1 block text-[12px] font-medium text-p-text-secondary">Cliente destino</span>
                <select
                  value={mergeState?.targetClientId || ''}
                  onChange={(event) =>
                    setMergeState((prev) => prev ? { ...prev, targetClientId: event.target.value } : prev)
                  }
                  className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-accent"
                >
                  {(detail?.candidateClients || [])
                    .filter((client) => String(client.id) !== String(mergeState?.sourceClientId || ''))
                    .map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name || 'Sin nombre'} · {client.phone || client.email || client.id}
                      </option>
                    ))}
                </select>
              </label>
              <label className="mt-3 block">
                <span className="mb-1 block text-[12px] font-medium text-p-text-secondary">Nota interna (opcional)</span>
                <textarea
                  value={mergeNotes}
                  onChange={(event) => setMergeNotes(event.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-p-border bg-p-surface px-3 py-2 text-[13px] text-p-text outline-none focus:border-p-accent"
                  placeholder="Qué revisaste antes de fusionar"
                />
              </label>
            </div>
          </div>
        }
      />

      <AdminAppModal
        show={Boolean(identityMergeState)}
        onClose={() => {
          if (busy) return;
          setIdentityMergeState(null);
          setIdentityMergeNotes('');
        }}
        title="Fusionar desde conflicto de identidad"
        isWarning
        confirmText={busy ? 'Fusionando...' : 'Confirmar fusión'}
        confirmDisabled={busy || !identityMergeState?.sourceClientId || !identityMergeState?.targetClientId}
        onConfirm={() => {
          void handleIdentityMerge();
        }}
        message={
          <div className="space-y-4">
            <p>Esta acción mueve reservas, cuentas y referencias del cliente origen al cliente destino. Úsala solo cuando ya revisaste que son la misma persona.</p>
            <div className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-[13px] text-p-text-secondary">
              <p><span className="font-semibold text-p-text">Origen:</span> {identityMergeState?.sourceClientName || '-'}</p>
              <p className="mt-1"><span className="font-semibold text-p-text">Destino:</span> {identityMergeState?.targetClientName || '-'}</p>
              <label className="mt-3 block">
                <span className="mb-1 block text-[12px] font-medium text-p-text-secondary">Nota interna (opcional)</span>
                <textarea
                  value={identityMergeNotes}
                  onChange={(event) => setIdentityMergeNotes(event.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-p-border bg-p-surface px-3 py-2 text-[13px] text-p-text outline-none focus:border-p-accent"
                  placeholder="Qué revisaste antes de fusionar"
                />
              </label>
            </div>
          </div>
        }
      />
      <AdminAppModal
        show={identityDismissConfirmOpen}
        onClose={() => {
          if (busy) return;
          setIdentityDismissConfirmOpen(false);
        }}
        title="Descartar caso de identidad"
        isWarning
        confirmText={busy ? 'Descartando...' : 'Descartar caso'}
        confirmDisabled={busy || !identityDetail?.incidentId}
        onConfirm={() => {
          void handleIdentityDismiss();
        }}
        message={
          <div className="space-y-3">
            <p>Vas a cerrar este caso manual de identidad sin vincular ni fusionar el cliente.</p>
            <div className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-[13px] text-p-text-secondary">
              <p><span className="font-semibold text-p-text">Cliente:</span> {identityDetail?.clientName || '-'}</p>
              <p className="mt-1"><span className="font-semibold text-p-text">Resumen:</span> {identityDetail?.summary || '-'}</p>
            </div>
          </div>
        }
      />
    </div>
  );
}
