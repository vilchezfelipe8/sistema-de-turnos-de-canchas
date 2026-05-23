import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Link2,
  DollarSign,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Unlink2,
  UserPlus,
} from 'lucide-react';
import AdminPlaygroundShell from '../../components/admin/AdminPlaygroundShell';
import AdminAppModal from '../../components/admin/ui/AdminAppModal';
import AdminDuplicateIncidents from '../../components/admin/AdminDuplicateIncidents';
import DuplicateClientDecisionModal, {
  type DuplicateClientDecisionCandidate,
} from '../../components/admin/agenda/DuplicateClientDecisionModal';
import ClientsTable from '../../modules/clientes/components/ClientsTable';
import { AdminDrawer, AdminDrawerSection, AdminFeedbackBanner, AdminFilterToolbar, AdminInlineError, AdminSegmentedControl } from '../../components/admin/ui';
import NotFound from '../../components/NotFound';
import RouteTransitionScreen from '../../components/RouteTransitionScreen';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { getPendingLogoutRedirect } from '../../services/AuthService';
import { ClientService } from '../../services/ClientService';
import { ClubAdminService, type PersonSearchResult } from '../../services/ClubAdminService';
import { formatDateTime24 } from '../../utils/dateTime';
import { getApiErrorMeta, getApiFieldErrors, normalizeApiError } from '../../utils/apiError';
import { showAdminToast } from '../../utils/adminToast';
import { getActiveClubSlug, hasAdminAccess, normalizeSessionUser } from '../../utils/session';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';
import AccountDrawer, {
  type AccountDrawerContext,
  type AccountDrawerInitialView,
  type AccountDrawerSuccessMeta,
} from '../../modules/cuentas/components/AccountDrawer';
import {
  buildCanonicalPhone,
  DEFAULT_PHONE_COUNTRY_ISO2,
  normalizePhoneCountryIso2,
  PHONE_COUNTRY_OPTIONS,
  splitCanonicalPhone,
} from '../../utils/phone';

type ClientsView = 'directory' | 'debt' | 'history' | 'incidents';
type ClientActionSidebarView = 'none' | 'client_create' | 'client_edit' | 'client_profile' | 'client_delete';
type ClientSearchRow = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  dni?: string;
  isProfessor?: boolean;
};


const EPSILON = 0.009;
const drawerSectionCardClass = 'rounded-2xl border border-p-border bg-p-surface-2 p-4';
const drawerListClass = 'divide-y divide-p-border rounded-xl border border-p-border bg-p-surface px-3 text-[13px]';

const normalizeClientFormError = (error: unknown) => {
  const raw = extractErrorMessage(error, '');
  const message = raw.trim();
  if (/ya existe un cliente/i.test(message)) {
    return 'Ya existe un cliente con ese DNI, teléfono o email. Buscalo en la lista y seleccioná el cliente existente.';
  }
  return message || 'No se pudo guardar el cliente.';
};

const isExpectedClientFormError = (message: string) =>
  /ya existe un cliente/i.test(message) ||
  /datos similares/i.test(message) ||
  /obligatorio|inv[aá]lido|ingresa|dni/i.test(message);

const resolveClientIdentityError = (error: unknown, fallback: string) => {
  const meta = getApiErrorMeta(error);
  const base = extractErrorMessage(error, fallback);
  const conflictingPolicies = Array.isArray(meta?.conflictingPolicyIds) ? meta.conflictingPolicyIds : [];
  if (conflictingPolicies.length > 0) {
    return `${base} Políticas en conflicto: ${conflictingPolicies.join(', ')}.`;
  }
  const linkedClientName = String(meta?.linkedClientName || '').trim();
  if (linkedClientName) {
    return `${base} Cliente ya vinculado: ${linkedClientName}.`;
  }
  const linkedUserId = Number(meta?.linkedUserId || 0);
  if (Number.isInteger(linkedUserId) && linkedUserId > 0) {
    return `${base} Usuario vinculado actual: #${linkedUserId}.`;
  }
  return base;
};

const parseDuplicateClientCandidates = (error: unknown): DuplicateClientDecisionCandidate[] => {
  const meta = getApiErrorMeta(error);
  const rawCandidates = Array.isArray(meta?.candidates) ? meta?.candidates : [];
  return rawCandidates.reduce<DuplicateClientDecisionCandidate[]>((acc, candidate) => {
    const row = candidate && typeof candidate === 'object' ? (candidate as Record<string, unknown>) : null;
    const id = String(row?.id || '').trim();
    if (!id) return acc;
    acc.push({
      id,
      name: String(row?.name || '').trim() || 'Cliente sin nombre',
      phone: String(row?.phone || '').trim() || undefined,
      email: String(row?.email || '').trim() || undefined,
    });
    return acc;
  }, []);
};

const formatDate = (dateInput: any) => {
  if (!dateInput) return '-';
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const [y, m, d] = dateInput.split('-');
    return `${d}/${m}/${y}`;
  }
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-AR')}`;
const roundMoney = (value: number) => Number(Math.max(0, Number(value || 0)).toFixed(2));

const formatRawTypeFallback = (value: string) =>
  String(value || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const shortId = (id: unknown) => String(id || '').slice(-6).toUpperCase();

const formatAccountSourceType = (value: unknown) => {
  const key = String(value || '').trim().toUpperCase();
  if (!key) return '-';
  if (key === 'BOOKING') return 'Reserva';
  if (key === 'BAR') return 'Bar';
  if (key === 'TABLE') return 'Mesa';
  if (key === 'MANUAL') return 'Manual';
  return formatRawTypeFallback(key);
};

const bookingStatusLabel: Record<string, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmado',
  COMPLETED: 'Completado',
  CANCELLED: 'Cancelado',
};

const sortByCreationDesc = (a: any, b: any) => {
  const createdA = new Date(a?.createdAt || `${a?.date || ''}T${a?.time || '00:00'}:00`).getTime();
  const createdB = new Date(b?.createdAt || `${b?.date || ''}T${b?.time || '00:00'}:00`).getTime();
  if (Number.isFinite(createdA) && Number.isFinite(createdB) && createdA !== createdB) {
    return createdB - createdA;
  }
  return Number(b?.id || 0) - Number(a?.id || 0);
};

const buildClientBookingHistory = (client: any) => {
  const rows = Array.isArray(client?.bookings) ? client.bookings : [];
  const normalized = rows
    .map((entry: any) => ({
      bookingId: entry?.bookingId ?? entry?.id ?? null,
      status: String(entry?.bookingStatus || entry?.status || '').trim().toUpperCase(),
      date: entry?.date || entry?.startDateTime || null,
      time: entry?.time || null,
      courtName: entry?.courtName || '-',
      amount: Number(entry?.totalAmount || entry?.amount || entry?.price || 0),
    }))
    .filter((entry) => entry.bookingId != null);

  const dedup = new Map<string, (typeof normalized)[number]>();
  for (const entry of normalized) {
    const key = String(entry.bookingId);
    if (!dedup.has(key)) dedup.set(key, entry);
  }

  return Array.from(dedup.values()).sort((a, b) => {
    const ta = new Date(a.date || '').getTime();
    const tb = new Date(b.date || '').getTime();
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
    return Number(b.bookingId) - Number(a.bookingId);
  });
};


const getClientName = (client: any) => String(client?.name || '').trim() || 'Sin nombre';

const buildConsumptionQuickUnits = (quantity: number) => {
  const normalized = Math.max(1, Math.trunc(Number(quantity) || 1));
  if (normalized === 1) return [1];
  if (normalized === 2) return [1, 2];
  return [1, 2, normalized];
};

export default function AdminClientesPlayground2Page() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });

  const [activeView, setActiveView] = useState<ClientsView>('directory');
  const [searchTerm, setSearchTerm] = useState('');

  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [selectedClientId, setSelectedClientId] = useState<string>('');

  const [sidebarView, setSidebarView] = useState<ClientActionSidebarView>('none');
  const [editingClientId, setEditingClientId] = useState<string>('');
  const [submittingClient, setSubmittingClient] = useState(false);
  const [clubPhoneCountryIso2, setClubPhoneCountryIso2] = useState(DEFAULT_PHONE_COUNTRY_ISO2);
  const [clientFieldErrors, setClientFieldErrors] = useState<Record<string, string>>({});
  const [clientForm, setClientForm] = useState({
    name: '',
    phoneCountryIso2: DEFAULT_PHONE_COUNTRY_ISO2,
    phone: '',
    dni: '',
    email: '',
    isProfessor: false,
  });

  const [deletingClient, setDeletingClient] = useState(false);

  const [accountDrawerOpen, setAccountDrawerOpen] = useState(false);
  const [accountDrawerAccountId, setAccountDrawerAccountId] = useState('');
  const [accountDrawerInitialView, setAccountDrawerInitialView] =
    useState<AccountDrawerInitialView>('overview');
  const [debtSearchTerm, setDebtSearchTerm] = useState('');

  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkSearchTerm, setLinkSearchTerm] = useState('');
  const [linkSearchResults, setLinkSearchResults] = useState<PersonSearchResult[]>([]);
  const [linkSearchLoading, setLinkSearchLoading] = useState(false);
  const [linkSelectedUser, setLinkSelectedUser] = useState<PersonSearchResult | null>(null);
  const [linkError, setLinkError] = useState('');
  const [unlinkConfirmOpen, setUnlinkConfirmOpen] = useState(false);
  const [unlinkBusy, setUnlinkBusy] = useState(false);
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeSearchTerm, setMergeSearchTerm] = useState('');
  const [mergeSearchResults, setMergeSearchResults] = useState<ClientSearchRow[]>([]);
  const [mergeSearchLoading, setMergeSearchLoading] = useState(false);
  const [mergeSelectedTarget, setMergeSelectedTarget] = useState<ClientSearchRow | null>(null);
  const [mergeNotes, setMergeNotes] = useState('');
  const [mergeError, setMergeError] = useState('');
  const [clientDuplicateModalOpen, setClientDuplicateModalOpen] = useState(false);
  const [clientDuplicateCandidates, setClientDuplicateCandidates] = useState<DuplicateClientDecisionCandidate[]>([]);
  const [clientDuplicateSelectedId, setClientDuplicateSelectedId] = useState('');
  const [clientDuplicateError, setClientDuplicateError] = useState('');

  const [selectedClientDiscountAssignments, setSelectedClientDiscountAssignments] = useState<any[]>([]);
  const [loadingDiscountAssignments, setLoadingDiscountAssignments] = useState(false);

  useEffect(() => {
    const text = String(successMessage || '').trim();
    if (!text) return;
    showAdminToast(text);
    setSuccessMessage('');
  }, [successMessage]);

  useEffect(() => {
    const text = String(errorMessage || '').trim();
    if (!text) return;
    if (sidebarView === 'client_create' || sidebarView === 'client_edit') return;
    showAdminToast(text, 'error');
    setErrorMessage('');
  }, [errorMessage, sidebarView]);

  const resolveClubSlug = useCallback(() => {
    try {
      return getActiveClubSlug(normalizeSessionUser(null)) || '';
    } catch {
      return '';
    }
  }, []);

  const resetLinkModal = useCallback(() => {
    setLinkSearchTerm('');
    setLinkSearchResults([]);
    setLinkSelectedUser(null);
    setLinkError('');
    setLinkBusy(false);
  }, []);

  const openLinkModal = useCallback(() => {
    resetLinkModal();
    setLinkModalOpen(true);
  }, [resetLinkModal]);

  const resetMergeModal = useCallback(() => {
    setMergeSearchTerm('');
    setMergeSearchResults([]);
    setMergeSelectedTarget(null);
    setMergeNotes('');
    setMergeError('');
    setMergeBusy(false);
  }, []);

  const openMergeModal = useCallback(() => {
    resetMergeModal();
    setMergeModalOpen(true);
  }, [resetMergeModal]);

  const resetClientDuplicateModal = useCallback(() => {
    setClientDuplicateModalOpen(false);
    setClientDuplicateCandidates([]);
    setClientDuplicateSelectedId('');
    setClientDuplicateError('');
  }, []);

  useEffect(() => {
    if (!authChecked || user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/admin/clientes-playground2')}`);
  }, [authChecked, user, router]);

  useEffect(() => {
    if (!linkModalOpen) {
      setLinkSearchResults([]);
      setLinkSelectedUser(null);
      return;
    }
    const slug = resolveClubSlug();
    const query = linkSearchTerm.trim();
    if (!slug || query.length < 2) {
      setLinkSearchResults([]);
      setLinkSelectedUser(null);
      return;
    }
    let cancelled = false;
    setLinkSearchLoading(true);
    const timeout = window.setTimeout(() => {
      ClubAdminService.searchPeople(slug, query)
        .then((rows) => {
          if (cancelled) return;
          const users = (Array.isArray(rows) ? rows : []).filter(
            (row: PersonSearchResult) =>
              Number(row?.userId || 0) > 0 &&
              row?.kind !== 'clubClient' &&
              row?.kind !== 'newClientSuggestion'
          );
          setLinkSearchResults(users);
          setLinkSelectedUser((prev) =>
            prev && users.some((row: PersonSearchResult) => Number(row.userId) === Number(prev.userId)) ? prev : null
          );
        })
        .catch((error) => {
          if (cancelled) return;
          setLinkError(extractErrorMessage(error, 'No se pudo buscar usuarios.'));
        })
        .finally(() => {
          if (!cancelled) setLinkSearchLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      setLinkSearchLoading(false);
    };
  }, [linkModalOpen, linkSearchTerm, resolveClubSlug]);

  useEffect(() => {
    if (!mergeModalOpen) {
      setMergeSearchResults([]);
      setMergeSelectedTarget(null);
      return;
    }
    const slug = resolveClubSlug();
    const query = mergeSearchTerm.trim();
    if (!slug || query.length < 2 || !selectedClientId) {
      setMergeSearchResults([]);
      setMergeSelectedTarget(null);
      return;
    }
    let cancelled = false;
    setMergeSearchLoading(true);
    const timeout = window.setTimeout(() => {
      ClubAdminService.getClients(slug, query)
        .then((rows) => {
          if (cancelled) return;
          const candidates = (Array.isArray(rows) ? rows : []).filter(
            (row: ClientSearchRow) =>
              String(row?.id || '') !== String(selectedClientId)
          );
          setMergeSearchResults(candidates);
          setMergeSelectedTarget((prev) =>
            prev && candidates.some((row: ClientSearchRow) => String(row.id) === String(prev.id)) ? prev : null
          );
        })
        .catch((error) => {
          if (cancelled) return;
          setMergeError(extractErrorMessage(error, 'No se pudo buscar clientes para fusionar.'));
        })
        .finally(() => {
          if (!cancelled) setMergeSearchLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      setMergeSearchLoading(false);
    };
  }, [mergeModalOpen, mergeSearchTerm, resolveClubSlug, selectedClientId]);

  useEffect(() => {
    const run = async () => {
      try {
        const slug = resolveClubSlug();
        if (!slug) return;
        const club = await ClubAdminService.getClubInfo(slug);
        const iso = normalizePhoneCountryIso2(club?.country);
        setClubPhoneCountryIso2(iso);
        setClientForm((prev) => ({ ...prev, phoneCountryIso2: prev.phoneCountryIso2 || iso }));
      } catch {
        setClubPhoneCountryIso2(DEFAULT_PHONE_COUNTRY_ISO2);
      }
    };
    void run();
  }, [resolveClubSlug]);

  const loadClients = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage('');
      const slug = resolveClubSlug() || undefined;
      const rows = await ClientService.listDebtors(slug, { scope: 'all' });
      const normalized = Array.isArray(rows) ? rows : [];
      setClients(normalized);

      if (normalized.length > 0) {
        setSelectedClientId((prev) => {
          if (prev && normalized.some((client) => String(client.id) === prev)) return prev;
          return '';
        });
      } else {
        setSelectedClientId('');
      }
      return normalized;
    } catch (error: any) {
      reportUiError({ area: 'ClientesPlayground', action: 'loadClients' }, error);
      setErrorMessage(String(error?.message || 'No se pudo cargar la lista de clientes.'));
      return [];
    } finally {
      setLoading(false);
    }
  }, [resolveClubSlug]);

  useEffect(() => {
    if (!authChecked || !user || !hasAdminAccess(user)) return;
    void loadClients();
  }, [authChecked, user, loadClients]);

  const clientsWithOpenDebt = useMemo(
    () => clients.filter((client) => Number(client?.totalDebt || 0) > EPSILON),
    [clients]
  );

  const filteredClients = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((client) => {
      const name = getClientName(client).toLowerCase();
      const phone = String(client?.phone || '').toLowerCase();
      const dni = String(client?.dni || '').toLowerCase();
      const email = String(client?.email || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || dni.includes(q) || email.includes(q);
    });
  }, [clients, searchTerm]);

  const debtFilteredClients = useMemo(() => {
    const q = debtSearchTerm.trim().toLowerCase();
    if (!q) return clientsWithOpenDebt;
    return clientsWithOpenDebt.filter((client) => {
      const name = getClientName(client).toLowerCase();
      const phone = String(client?.phone || '').toLowerCase();
      const dni = String(client?.dni || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || dni.includes(q);
    });
  }, [clientsWithOpenDebt, debtSearchTerm]);

  useEffect(() => {
    if (activeView !== 'debt') return;
    if (debtFilteredClients.length === 0) {
      setSelectedClientId('');
      return;
    }
    const selectedStillValid = debtFilteredClients.some((client) => String(client.id) === String(selectedClientId));
    if (!selectedStillValid) {
      setSelectedClientId('');
    }
  }, [activeView, debtFilteredClients, selectedClientId]);

  const selectedClient = useMemo(
    () => clients.find((client) => String(client.id) === String(selectedClientId)) || null,
    [clients, selectedClientId]
  );

  const totalClients = clients.length;
  const totalDebt = clients.reduce((sum, client) => sum + Number(client?.totalDebt || 0), 0);

  const openCreateClient = () => {
    setErrorMessage('');
    setClientFieldErrors({});
    resetClientDuplicateModal();
    setEditingClientId('');
    setClientForm({
      name: '',
      phoneCountryIso2: clubPhoneCountryIso2,
      phone: '',
      dni: '',
      email: '',
      isProfessor: false,
    });
    setSidebarView('client_create');
  };

  const openEditClient = (client: any) => {
    setErrorMessage('');
    setClientFieldErrors({});
    resetClientDuplicateModal();
    const splitPhone = splitCanonicalPhone(String(client?.phone || ''), clubPhoneCountryIso2);
    setEditingClientId(String(client?.id || ''));
    setClientForm({
      name: getClientName(client),
      phoneCountryIso2: splitPhone.countryIso2 || clubPhoneCountryIso2,
      phone: String(splitPhone.localNumber || ''),
      dni: String(client?.dni && client?.dni !== '-' ? client.dni : ''),
      email: String(client?.email || ''),
      isProfessor: Boolean(client?.isProfessor),
    });
    setSidebarView('client_edit');
  };

  const openClientProfile = (client: any) => {
    setSelectedClientId(String(client?.id || ''));
    setSidebarView('client_profile');
  };

  const openDeleteClient = (client: any) => {
    setSelectedClientId(String(client?.id || ''));
    setSidebarView('client_delete');
  };

  const submitClient = async (options?: { forceCreateNew?: boolean }) => {
    const slug = resolveClubSlug();
    if (!slug) {
      setErrorMessage('No se pudo resolver el club activo.');
      return;
    }
    if (submittingClient) return;

    const name = String(clientForm.name || '').trim();
    const phoneLocal = String(clientForm.phone || '').trim();
    const canonicalPhone = buildCanonicalPhone({
      countryIso2: clientForm.phoneCountryIso2 || clubPhoneCountryIso2,
      localNumber: phoneLocal,
    });
    const dni = String(clientForm.dni || '').trim();
    const email = String(clientForm.email || '').trim();

    const nextFieldErrors: Record<string, string> = {};
    if (name.length < 2) {
      nextFieldErrors.name = 'Ingresá un nombre válido.';
    }
    if (!phoneLocal || !canonicalPhone) {
      nextFieldErrors.phone = 'Ingresá un teléfono válido.';
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      nextFieldErrors.email = 'Ingresá un email válido o dejalo vacío.';
    }
    if (dni.length > 0 && dni.length < 6) {
      nextFieldErrors.dni = 'Si cargás DNI, debe tener al menos 6 dígitos.';
    }
    if (Object.keys(nextFieldErrors).length > 0) {
      setClientFieldErrors(nextFieldErrors);
      setErrorMessage('Revisá los campos marcados.');
      return;
    }

    try {
      setSubmittingClient(true);
      setErrorMessage('');
      setClientFieldErrors({});
      setClientDuplicateError('');
      const payload = {
        name,
        phone: canonicalPhone || undefined,
        phoneCountryCode: clientForm.phoneCountryIso2 || undefined,
        phoneNumberLocal: phoneLocal || undefined,
        dni: dni || undefined,
        email: email || undefined,
        isProfessor: Boolean(clientForm.isProfessor),
        ...(options?.forceCreateNew ? { forceCreateNew: true } : {}),
      };

      if (editingClientId) {
        await ClientService.updateByClubSlug(slug, editingClientId, payload);
        setSuccessMessage('Cliente actualizado correctamente.');
      } else {
        await ClientService.createByClubSlug(slug, payload);
        setSuccessMessage('Cliente creado correctamente.');
      }

      resetClientDuplicateModal();
      setSidebarView('none');
      const updated = await loadClients();
      if (editingClientId) {
        const found = updated.find((client: any) => String(client.id) === editingClientId);
        if (found) setSelectedClientId(String(found.id));
      }
    } catch (error: any) {
      const normalized = normalizeApiError(error);
      const apiFieldErrors = getApiFieldErrors(error);
      const apiMeta = getApiErrorMeta(error);
      const message = normalizeClientFormError(error);
      if (!isExpectedClientFormError(message)) {
        reportUiError({ area: 'ClientesPlayground', action: 'submitClient' }, error);
      }
      const rawCode = String(normalized.code || '').trim().toUpperCase();
      const hasDuplicateCandidates = Array.isArray(apiMeta?.candidateClientIds) && apiMeta.candidateClientIds.length > 0;
      if (!editingClientId && (rawCode === 'CLIENT_POSSIBLE_DUPLICATE' || hasDuplicateCandidates)) {
        const candidates = parseDuplicateClientCandidates(error);
        const meta = getApiErrorMeta(error);
        const suggestedId = String(meta?.primaryClientId || candidates[0]?.id || '').trim();
        setClientDuplicateCandidates(candidates);
        setClientDuplicateSelectedId(suggestedId);
        setClientDuplicateError('');
        setClientDuplicateModalOpen(true);
        return;
      }
      if (Object.keys(apiFieldErrors).length > 0) {
        setClientFieldErrors(apiFieldErrors);
      }
      if ((apiMeta?.phone as string | undefined)?.trim() && !apiFieldErrors.phone) {
        setClientFieldErrors((prev) => ({ ...prev, phone: String(apiMeta.phone) }));
      }
      setErrorMessage(message);
    } finally {
      setSubmittingClient(false);
    }
  };

  const deleteSelectedClient = async () => {
    const slug = resolveClubSlug();
    if (!slug || !selectedClient?.id) {
      setSidebarView('none');
      return;
    }
    try {
      setDeletingClient(true);
      await ClientService.deleteByClubSlug(slug, String(selectedClient.id));
      setSidebarView('none');
      setSuccessMessage('Cliente eliminado correctamente.');
      await loadClients();
    } catch (error: any) {
      reportUiError({ area: 'ClientesPlayground', action: 'deleteClient' }, error);
      setErrorMessage(String(error?.message || 'No se pudo eliminar el cliente.'));
    } finally {
      setDeletingClient(false);
    }
  };

  const applyExistingDuplicateClient = async () => {
    const targetClientId = String(clientDuplicateSelectedId || '').trim();
    if (!targetClientId) {
      setClientDuplicateError('Seleccioná un cliente existente para continuar.');
      return;
    }

    resetClientDuplicateModal();
    setSidebarView('client_profile');
    setSelectedClientId(targetClientId);
    setSuccessMessage('Se seleccionó el cliente existente para continuar.');
  };

  const forceCreateDuplicateClient = async () => {
    setClientDuplicateError('');
    await submitClient({ forceCreateNew: true });
  };

  const submitLinkUser = async () => {
    const slug = resolveClubSlug();
    if (!slug || !selectedClient?.id || !linkSelectedUser?.userId) {
      setLinkError('Seleccioná un usuario para vincular.');
      return;
    }
    try {
      setLinkBusy(true);
      setLinkError('');
      await ClientService.linkUserByClubSlug(slug, String(selectedClient.id), Number(linkSelectedUser.userId));
      setLinkModalOpen(false);
      resetLinkModal();
      setSuccessMessage('Cliente vinculado al usuario.');
      await loadClients();
    } catch (error: any) {
      setLinkError(resolveClientIdentityError(error, 'No se pudo vincular el cliente al usuario.'));
    } finally {
      setLinkBusy(false);
    }
  };

  const submitUnlinkUser = async () => {
    const slug = resolveClubSlug();
    if (!slug || !selectedClient?.id) return;
    try {
      setUnlinkBusy(true);
      await ClientService.unlinkUserByClubSlug(slug, String(selectedClient.id));
      setUnlinkConfirmOpen(false);
      setSuccessMessage('Cliente desvinculado del usuario.');
      await loadClients();
    } catch (error: any) {
      setErrorMessage(resolveClientIdentityError(error, 'No se pudo desvincular el cliente del usuario.'));
    } finally {
      setUnlinkBusy(false);
    }
  };

  const submitMergeClient = async () => {
    const slug = resolveClubSlug();
    const targetRawId = String(mergeSelectedTarget?.id || '').trim();
    const targetClientId = targetRawId.startsWith('client-') ? targetRawId.slice('client-'.length) : targetRawId;
    if (!slug || !selectedClient?.id || !targetClientId) {
      setMergeError('Seleccioná el cliente destino para continuar.');
      return;
    }
    try {
      setMergeBusy(true);
      setMergeError('');
      await ClientService.mergeByClubSlug(slug, String(selectedClient.id), targetClientId, {
        resolutionNotes: mergeNotes.trim() || undefined,
      });
      setMergeModalOpen(false);
      resetMergeModal();
      setSelectedClientId(String(targetClientId));
      setSuccessMessage('Clientes fusionados correctamente.');
      await loadClients();
    } catch (error: any) {
      setMergeError(resolveClientIdentityError(error, 'No se pudo fusionar el cliente.'));
    } finally {
      setMergeBusy(false);
    }
  };

  const selectedDebtorPendingEntries = useMemo(() => {
    if (!selectedClient) return [];
    return (Array.isArray(selectedClient.history) ? selectedClient.history : [])
      .slice()
      .sort(sortByCreationDesc)
      .filter((entry: any) => Number(entry?.amount || 0) > EPSILON);
  }, [selectedClient]);


  const openAccountDrawer = (accountId: string, initialView: AccountDrawerInitialView = 'overview') => {
    setAccountDrawerAccountId(accountId);
    setAccountDrawerInitialView(initialView);
    setAccountDrawerOpen(true);
  };


  const sidebarOpen = sidebarView !== 'none';
  const isClientFormView = sidebarView === 'client_create' || sidebarView === 'client_edit';

  const closeActionSidebar = useCallback(() => {
    if (deletingClient || submittingClient) return;
    setErrorMessage('');
    setSelectedClientId('');
    resetClientDuplicateModal();
    setSidebarView('none');
  }, [deletingClient, resetClientDuplicateModal, submittingClient]);


  useEffect(() => {
    if (!sidebarOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeActionSidebar();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [sidebarOpen, closeActionSidebar]);


  useEffect(() => {
    const run = async () => {
      if (!selectedClient?.id) {
        setSelectedClientDiscountAssignments([]);
        return;
      }
      if (activeView !== 'history') return;
      const slug = resolveClubSlug();
      if (!slug) return;
      try {
        setLoadingDiscountAssignments(true);
        const rows = await ClubAdminService.listClientDiscountAssignments(slug, String(selectedClient.id));
        setSelectedClientDiscountAssignments(Array.isArray(rows) ? rows : []);
      } catch {
        setSelectedClientDiscountAssignments([]);
      } finally {
        setLoadingDiscountAssignments(false);
      }
    };
    void run();
  }, [activeView, selectedClient?.id, resolveClubSlug]);

  const historyBookings = useMemo(() => (selectedClient ? buildClientBookingHistory(selectedClient) : []), [selectedClient]);
  const historyAccounts = useMemo(
    () => (selectedClient?.history || []).slice().sort(sortByCreationDesc),
    [selectedClient]
  );
  const accountDrawerEntry = useMemo(
    () =>
      historyAccounts.find((account: any) => String(account?.id) === String(accountDrawerAccountId)) ||
      null,
    [accountDrawerAccountId, historyAccounts]
  );
  const accountDrawerContext = useMemo<AccountDrawerContext | undefined>(() => {
    if (!accountDrawerAccountId) return undefined;
    const accountLabel = accountDrawerEntry?.sourceType
      ? `Cuenta ${formatAccountSourceType(accountDrawerEntry.sourceType)} #${shortId(accountDrawerAccountId)}`
      : `Cuenta #${shortId(accountDrawerAccountId)}`;
    const subtitleParts = [
      accountLabel,
      accountDrawerEntry?.date ? formatDate(accountDrawerEntry.date) : '',
      accountDrawerEntry?.time ? String(accountDrawerEntry.time) : '',
    ].filter(Boolean);
    return {
      title: selectedClient ? getClientName(selectedClient) : `Cuenta #${shortId(accountDrawerAccountId)}`,
      subtitle: subtitleParts.join(' · '),
      accountStatus: String(accountDrawerEntry?.status || '').toUpperCase() === 'CLOSED' ? 'CLOSED' : undefined,
    };
  }, [accountDrawerAccountId, accountDrawerEntry, selectedClient]);

  if (!authChecked || !user) {
    return <RouteTransitionScreen message={authChecked ? 'Redirigiendo...' : 'Validando acceso...'} />;
  }

  if (!hasAdminAccess(user)) {
    return <NotFound message="No tenes permiso para acceder al panel de administracion." />;
  }

  return (
    <>
      <Head>
        <title>Clientes | Pique Admin</title>
      </Head>

      <AdminPlaygroundShell activeItem="Clientes" user={user} contentMuted={sidebarOpen}>
        <div className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6">
              <AdminSegmentedControl
                ariaLabel="Vistas de clientes"
                value={activeView}
                onChange={(nextView) => setActiveView(nextView as ClientsView)}
                options={[
                  { value: 'directory', label: 'Directorio' },
                  { value: 'debt', label: 'Cuentas y deuda' },
                  { value: 'history', label: 'Perfil' },
                  { value: 'incidents', label: 'Incidentes' },
                ]}
                className="w-fit"
              />

              <div className="grid grid-cols-2 gap-3">
                <article className="rounded-xl border border-p-border bg-p-surface p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-p-text-muted">Total clientes</p>
                  <p className="mt-2 text-lg font-semibold text-p-text">{totalClients}</p>
                </article>
                <article className="rounded-xl border border-p-border bg-p-surface p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-p-text-muted">Deuda total</p>
                  <p className={`mt-2 text-lg font-semibold ${totalDebt > 0 ? 'text-p-error' : 'text-p-positive'}`}>{formatMoney(totalDebt)}</p>
                </article>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                {activeView === 'directory' && (
                  <div className="flex h-full flex-col">
                    <article className="flex min-h-0 flex-1 flex-col rounded-xl border border-p-border bg-p-surface">
                      <div className="border-b border-p-border pl-4 pr-2 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h2 className="text-[13px] font-semibold text-p-text">Directorio de clientes</h2>
                            <p className="mt-1 text-[12px] text-p-text-muted">
                              Listado operativo con acceso rápido a perfil, edición y baja.
                            </p>
                          </div>
                          <AdminFilterToolbar className="border-0 bg-transparent p-0 gap-1 sm:flex-nowrap sm:justify-end">
                            <label className="relative w-full sm:w-[300px] sm:flex-none">
                              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-p-text-muted" />
                              <input
                                type="text"
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                placeholder="Buscar por nombre, DNI, email o teléfono"
                                className="h-8 w-full rounded-xl border border-p-border bg-p-surface pl-9 pr-3 text-[12px] outline-none focus:border-p-accent"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={openCreateClient}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink-900 px-2.5 text-[11px] font-semibold text-ink-50 shadow-p-md transition hover:bg-ink-800"
                            >
                              <Plus size={14} strokeWidth={2.5} />
                              Nuevo cliente
                            </button>
                          </AdminFilterToolbar>
                        </div>
                      </div>

                      <ClientsTable
                        clients={filteredClients}
                        loading={loading}
                        onRowClick={openClientProfile}
                        onEdit={openEditClient}
                        onDelete={openDeleteClient}
                        selectedId={selectedClientId}
                        className="rounded-b-xl"
                      />
                    </article>
                  </div>
                )}

                {activeView === 'debt' && (
                  <div className="grid h-full grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
                    {/* Left: debtor list with search + count badge */}
                    <article className="flex min-h-0 flex-col rounded-xl border border-p-border bg-p-surface">
                      <div className="p-4 pb-3">
                        <div className="flex items-center justify-between">
                          <h2 className="text-[13px] font-semibold text-p-text">Clientes con deuda</h2>
                          <span className="rounded-full border border-p-error bg-p-error-bg px-2 py-0.5 text-[11px] font-semibold text-p-error">
                            {clientsWithOpenDebt.length}
                          </span>
                        </div>
                        <div className="relative mt-3">
                          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-p-text-muted" />
                          <input
                            type="text"
                            value={debtSearchTerm}
                            onChange={(event) => setDebtSearchTerm(event.target.value)}
                            placeholder="Buscar deudor..."
                            className="h-8 w-full rounded-xl border border-p-border bg-p-surface-2 pl-9 pr-3 text-[12px] outline-none focus:border-p-accent"
                          />
                        </div>
                      </div>

                      <div className="min-h-0 flex-1 overflow-auto border-t border-p-border">
                        {loading ? (
                          <div className="p-6 text-center text-[13px] text-p-text-muted">Cargando...</div>
                        ) : debtFilteredClients.length === 0 ? (
                          <div className="p-6 text-center text-[13px] text-p-text-muted">
                            {debtSearchTerm ? 'Sin resultados.' : 'No hay clientes con deuda.'}
                          </div>
                        ) : (
                          <ul className="divide-y divide-p-border">
                            {debtFilteredClients.map((client) => {
                              const pendingCount = (Array.isArray(client.history) ? client.history : []).filter(
                                (a: any) => Number(a?.amount || 0) > EPSILON
                              ).length;
                              return (
                                <li key={String(client.id)}>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedClientId(String(client.id))}
                                    className={`w-full min-h-[46px] px-3 py-3 text-left transition ${
                                      String(selectedClientId) === String(client.id) ? 'bg-p-positive-bg' : 'hover:bg-p-surface-2'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="truncate text-[13px] font-semibold text-p-text">{getClientName(client)}</p>
                                      {pendingCount > 0 && (
                                        <span className="flex-none rounded-full bg-p-error-bg px-1.5 py-0.5 text-[10px] font-bold text-p-error">
                                          {pendingCount}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[12px] font-semibold text-p-error">{formatMoney(Number(client.totalDebt || 0))}</p>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </article>

                    {/* Right: pending accounts for selected debtor */}
                    <article className="flex min-h-0 flex-col rounded-xl border border-p-border bg-p-surface">
                      <div className="flex items-center justify-between p-4 pb-3">
                        <h2 className="text-[13px] font-semibold text-p-text">Cuentas pendientes</h2>
                        {selectedClient && (
                          <span className="text-[12px] font-semibold text-p-text">{getClientName(selectedClient)}</span>
                        )}
                      </div>

                      <div className="min-h-0 flex-1 overflow-auto border-t border-p-border p-4">
                        {!selectedClient ? (
                          <div className="rounded-xl border border-p-border p-8 text-center text-[13px] text-p-text-muted">
                            Selecciona un cliente para ver su deuda.
                          </div>
                        ) : selectedDebtorPendingEntries.length === 0 ? (
                          <div className="rounded-xl border border-p-border p-8 text-center text-[13px] text-p-text-muted">
                            Este cliente no tiene cuentas pendientes.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {selectedDebtorPendingEntries.map((account: any) => (
                              <div key={String(account.id)} className="rounded-xl border border-p-border bg-p-surface p-4">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <p className="text-[13px] font-semibold text-p-text">
                                      {formatAccountSourceType(account.sourceType)}{' '}
                                      <span className="font-normal text-p-text-muted">#{shortId(account.id)}</span>
                                    </p>
                                    <p className="mt-0.5 text-[12px] text-p-text-muted">
                                      {formatDate(account.date)}{account.time ? ` · ${account.time}` : ''}
                                    </p>
                                  </div>
                                  <span className="rounded-full border border-p-error bg-p-error-bg px-2.5 py-1 text-[12px] font-bold text-p-error">
                                    {formatMoney(Number(account.amount || 0))}
                                  </span>
                                </div>
                                <div className="mt-3 flex items-center justify-end gap-2 border-t border-p-border pt-3">
                                  <button
                                    type="button"
                                    onClick={() => openAccountDrawer(String(account.id), 'overview')}
                                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                                  >
                                    <Search size={12} />
                                    Ver detalle
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openAccountDrawer(String(account.id), 'payment')}
                                    className="h-8 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold text-ink-50 hover:bg-ink-900"
                                  >
                                    <span className="inline-flex items-center gap-1"><DollarSign size={13} /> Cobrar</span>
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  </div>
                )}

                {activeView === 'history' && (
                  <div className="grid h-full grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
                    {/* Left: client list with search + debt badge */}
                    <article className="flex min-h-0 flex-col rounded-xl border border-p-border bg-p-surface">
                      <div className="p-4 pb-3">
                        <h2 className="text-[13px] font-semibold text-p-text">Clientes</h2>
                        <div className="relative mt-3">
                          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-p-text-muted" />
                          <input
                            type="text"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            placeholder="Buscar cliente..."
                            className="h-8 w-full rounded-xl border border-p-border bg-p-surface-2 pl-9 pr-3 text-[12px] outline-none focus:border-p-accent"
                          />
                        </div>
                      </div>
                      <div className="min-h-0 flex-1 overflow-auto border-t border-p-border">
                        {loading ? (
                          <div className="p-6 text-center text-[13px] text-p-text-muted">Cargando...</div>
                        ) : filteredClients.length === 0 ? (
                          <div className="p-6 text-center text-[13px] text-p-text-muted">Sin clientes.</div>
                        ) : (
                          <ul className="divide-y divide-p-border">
                            {filteredClients.map((client) => {
                              const hasDebt = Number(client?.totalDebt || 0) > EPSILON;
                              return (
                                <li key={String(client.id)}>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedClientId(String(client.id))}
                                    className={`w-full min-h-[46px] px-3 py-3 text-left transition ${
                                      String(selectedClientId) === String(client.id) ? 'bg-p-positive-bg' : 'hover:bg-p-surface-2'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="truncate text-[13px] font-semibold text-p-text">{getClientName(client)}</p>
                                      {hasDebt && (
                                        <span className="flex-none rounded-full border border-p-error bg-p-error-bg px-1.5 py-0.5 text-[10px] font-bold text-p-error">
                                          Deuda
                                        </span>
                                      )}
                                    </div>
                                    <p className="truncate text-[12px] text-p-text-muted">{String(client.phone || client.email || '-')}</p>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </article>

                    {/* Right: Perfil panel */}
                    <article className="flex min-h-0 flex-col overflow-auto rounded-xl border border-p-border bg-p-surface">
                      {!selectedClient ? (
                        <div className="p-8 text-center text-[13px] text-p-text-muted">
                          Selecciona un cliente para ver su perfil.
                        </div>
                      ) : (
                        <>
                          {/* Hero */}
                          <div className="flex items-start justify-between gap-4 border-b border-p-border p-5">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-[18px] font-bold text-p-text">{getClientName(selectedClient)}</h2>
                                {selectedClient.isProfessor && (
                                  <span className="rounded-full bg-p-positive-bg px-2 py-0.5 text-[11px] font-semibold text-p-accent">
                                    Profesor
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 text-[12px] text-p-text-muted">ID #{shortId(selectedClient.id)}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => openEditClient(selectedClient)}
                              className="h-8 flex-none rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                            >
                              <span className="inline-flex items-center gap-1.5"><Pencil size={13} /> Editar</span>
                            </button>
                            <button
                              type="button"
                              onClick={openMergeModal}
                              className="h-8 flex-none rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                            >
                              Fusionar
                            </button>
                          </div>

                          {/* Debt banner */}
                          {Number(selectedClient.totalDebt || 0) > EPSILON && (
                            <div className="flex items-center justify-between gap-3 bg-p-error px-5 py-3">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-50">Deuda pendiente</p>
                                <p className="text-[20px] font-bold leading-tight text-ink-50">
                                  {formatMoney(Number(selectedClient.totalDebt || 0))}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setActiveView('debt')}
                                className="h-8 flex-none rounded-lg bg-p-surface px-3 text-[12px] font-bold text-p-error hover:bg-p-error-bg"
                              >
                                <span className="inline-flex items-center gap-1"><DollarSign size={13} /> Cobrar</span>
                              </button>
                            </div>
                          )}

                          <div className="space-y-5 p-5">
                            {/* Quick stats */}
                            <div className="grid grid-cols-3 gap-3">
                              <div className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-center">
                                <p className="text-[18px] font-bold text-p-text">{Number(selectedClient.totalBookings || 0)}</p>
                                <p className="mt-0.5 text-[11px] text-p-text-muted">Reservas</p>
                              </div>
                              <div className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-center">
                                <p className="text-[18px] font-bold text-p-text">{historyAccounts.length}</p>
                                <p className="mt-0.5 text-[11px] text-p-text-muted">Cuentas</p>
                              </div>
                              <div className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-center">
                                <p className="text-[14px] font-bold text-p-text">
                                  {selectedClient.isProfessor ? 'Profesor' : 'Cliente'}
                                </p>
                                <p className="mt-0.5 text-[11px] text-p-text-muted">Rol</p>
                              </div>
                            </div>

                            {/* Contact */}
                            <div>
                              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-p-text-muted">
                                Contacto
                              </h3>
                              <div className="divide-y divide-p-border rounded-xl border border-p-border text-[13px]">
                                <div className="grid grid-cols-[90px_1fr] gap-2 px-3 py-2.5">
                                  <span className="text-p-text-muted">DNI</span>
                                  <span className="font-semibold text-p-text">{String(selectedClient.dni || '-')}</span>
                                </div>
                                <div className="grid grid-cols-[90px_1fr] gap-2 px-3 py-2.5">
                                  <span className="text-p-text-muted">Teléfono</span>
                                  <span className="font-semibold text-p-text">{String(selectedClient.phone || '-')}</span>
                                </div>
                                <div className="grid grid-cols-[90px_1fr] gap-2 px-3 py-2.5">
                                  <span className="text-p-text-muted">Email</span>
                                  <span className="break-all font-semibold text-p-text">{String(selectedClient.email || '-')}</span>
                                </div>
                              </div>
                            </div>

                            <div>
                              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-p-text-muted">
                                Vinculación con usuario
                              </h3>
                              <div className="rounded-xl border border-p-border bg-p-surface p-3">
                                {selectedClient.linkedUser ? (
                                  <>
                                    <p className="text-[13px] font-semibold text-p-text">
                                      {selectedClient.linkedUser.name || `Usuario ${selectedClient.linkedUser.id}`}
                                    </p>
                                    <p className="mt-0.5 text-[12px] text-p-text-muted">
                                      {selectedClient.linkedUser.email || `ID usuario #${selectedClient.linkedUser.id}`}
                                    </p>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={() => setUnlinkConfirmOpen(true)}
                                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                                      >
                                        <Unlink2 size={12} />
                                        Desvincular
                                      </button>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <p className="text-[13px] text-p-text-secondary">
                                      Este cliente todavía no está vinculado a un usuario del sistema.
                                    </p>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={openLinkModal}
                                        className="inline-flex h-8 items-center gap-1 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold text-ink-50 hover:bg-ink-900"
                                      >
                                        <Link2 size={12} />
                                        Vincular usuario
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Descuentos — only shown if assigned */}
                            {!loadingDiscountAssignments && selectedClientDiscountAssignments.length > 0 && (
                              <div>
                                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-p-text-muted">
                                  Descuentos
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                  {selectedClientDiscountAssignments.map((assignment: any, index: number) => (
                                    <span
                                      key={String(assignment?.id || index)}
                                      className="rounded-full border border-p-border bg-p-surface-2 px-3 py-1 text-[12px] font-semibold text-p-text-secondary"
                                    >
                                      {String(assignment?.policy?.name || assignment?.policyName || 'Política')}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Cuentas */}
                            {historyAccounts.length > 0 && (
                              <div>
                                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-p-text-muted">
                                  Cuentas ({historyAccounts.length})
                                </h3>
                                <div className="space-y-2">
                                  {historyAccounts.map((account: any) => {
                                    const isPending = Number(account?.amount || 0) > EPSILON;
                                    return (
                                      <div
                                        key={String(account.id)}
                                        className="flex items-center gap-3 rounded-xl border border-p-border bg-p-surface px-3 py-2.5"
                                      >
                                        <div className="min-w-0 flex-1">
                                          <p className="text-[13px] font-semibold text-p-text">
                                            {formatAccountSourceType(account.sourceType)}{' '}
                                            <span className="font-normal text-p-text-muted">#{shortId(account.id)}</span>
                                          </p>
                                          <p className="text-[12px] text-p-text-muted">
                                            {formatDate(account.date)}{account.time ? ` · ${account.time}` : ''}
                                          </p>
                                        </div>
                                        {isPending && (
                                          <span className="flex-none rounded-full border border-p-error bg-p-error-bg px-2 py-0.5 text-[11px] font-semibold text-p-error">
                                            {formatMoney(Number(account.amount || 0))}
                                          </span>
                                        )}
                                        <div className="flex gap-1.5">
                                          <button
                                            type="button"
                                            onClick={() => openAccountDrawer(String(account.id), 'overview')}
                                            className="inline-flex h-7 items-center gap-1 rounded-lg border border-p-border bg-p-surface px-2 text-[11px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                                          >
                                            <Search size={11} />
                                            Ver
                                          </button>
                                          {isPending && (
                                            <button
                                              type="button"
                                              onClick={() => openAccountDrawer(String(account.id), 'payment')}
                                              className="inline-flex h-7 items-center gap-1 rounded-lg bg-ink-900 px-2 text-[11px] font-semibold text-ink-50 hover:bg-ink-900"
                                            >
                                              <DollarSign size={11} />
                                              Cobrar
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Reservas */}
                            {historyBookings.length > 0 && (
                              <div>
                                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-p-text-muted">
                                  Reservas ({historyBookings.length})
                                </h3>
                                <div className="space-y-2">
                                  {historyBookings.map((booking: any) => (
                                    <div
                                      key={String(booking.bookingId)}
                                      className="flex items-center gap-3 rounded-xl border border-p-border bg-p-surface px-3 py-2.5"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <p className="text-[13px] font-semibold text-p-text">
                                          {formatDate(booking.date)}{booking.time ? ` · ${booking.time}` : ''}
                                        </p>
                                        <p className="text-[12px] text-p-text-muted">
                                          {booking.courtName || '-'} · {formatMoney(Number(booking.amount || 0))}
                                        </p>
                                      </div>
                                      <span
                                        className={`flex-none rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                                          booking.status === 'COMPLETED'
                                            ? 'border-p-positive bg-p-positive-bg text-p-positive'
                                            : booking.status === 'CANCELLED'
                                            ? 'border-p-border bg-p-surface-2 text-p-text-muted'
                                            : booking.status === 'CONFIRMED'
                                            ? 'border-p-info bg-p-info-bg text-p-info'
                                            : 'border-p-warning bg-p-warning-bg text-p-warning'
                                        }`}
                                      >
                                        {bookingStatusLabel[booking.status] || booking.status || '-'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {historyAccounts.length === 0 && historyBookings.length === 0 && (
                              <div className="rounded-xl border border-p-border p-8 text-center text-[13px] text-p-text-muted">
                                Este cliente no tiene actividad registrada.
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </article>
                  </div>
                )}

                {activeView === 'incidents' && (
                  <div className="h-full overflow-auto">
                    <AdminDuplicateIncidents />
                  </div>
                )}
              </div>
        </div>
      </AdminPlaygroundShell>

      <AdminDrawer
        open={sidebarOpen}
        onClose={closeActionSidebar}
        title={
          sidebarView === 'client_create'
            ? 'Nuevo cliente'
            : sidebarView === 'client_edit'
              ? 'Editar cliente'
              : sidebarView === 'client_profile'
                ? 'Perfil del cliente'
                : sidebarView === 'client_delete'
                  ? 'Eliminar cliente'
                  : 'Cliente'
        }
        subtitle={
          isClientFormView
            ? 'Gestión de datos básicos del cliente.'
            : sidebarView === 'client_profile'
              ? selectedClient
                ? getClientName(selectedClient)
                : 'Sin cliente seleccionado'
              : sidebarView === 'client_delete'
                ? 'Esta accion es permanente.'
                : undefined
        }
        statusChip={
          sidebarView === 'client_profile' && selectedClient
            ? Number(selectedClient.totalDebt || 0) > EPSILON
              ? 'Con deuda'
              : 'Sin deuda'
            : undefined
        }
        statusChipClassName={
          sidebarView === 'client_profile' && selectedClient && Number(selectedClient.totalDebt || 0) > EPSILON
            ? 'border-p-error bg-p-error-bg text-p-error'
            : 'border-p-positive bg-p-positive-bg text-p-positive'
        }
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeActionSidebar}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
            >
              <RotateCcw size={14} />
              Cancelar
            </button>

            {isClientFormView && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage('');
                    setClientFieldErrors({});
                    setEditingClientId('');
                    setClientForm({
                      name: '',
                      phoneCountryIso2: clubPhoneCountryIso2,
                      phone: '',
                      dni: '',
                      email: '',
                      isProfessor: false,
                    });
                  }}
                  disabled={submittingClient}
                  className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text-secondary hover:bg-p-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <RotateCcw size={14} />
                    Limpiar
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void submitClient()}
                  disabled={submittingClient}
                  className="h-10 rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 transition hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {sidebarView === 'client_edit' ? <Save size={14} /> : <UserPlus size={14} />}
                    {submittingClient ? 'Guardando...' : sidebarView === 'client_edit' ? 'Guardar cambios' : 'Crear cliente'}
                  </span>
                </button>
              </>
            )}

            {sidebarView === 'client_profile' && selectedClient && (
              <>
                <button
                  type="button"
                  onClick={openMergeModal}
                  className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                >
                  Fusionar
                </button>
                {selectedClient.linkedUser ? (
                  <button
                    type="button"
                    onClick={() => setUnlinkConfirmOpen(true)}
                    className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                  >
                    Desvincular usuario
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={openLinkModal}
                    className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                  >
                    Vincular usuario
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openEditClient(selectedClient)}
                  className="h-10 rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 hover:bg-ink-900"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Pencil size={14} />
                    Editar cliente
                  </span>
                </button>
              </>
            )}

            {sidebarView === 'client_delete' && (
              <button
                type="button"
                onClick={() => {
                  if (deletingClient) return;
                  void deleteSelectedClient();
                }}
                className="h-10 rounded-xl bg-[var(--error-fg)] px-5 text-[13px] font-semibold text-ink-50 hover:bg-p-error disabled:cursor-not-allowed disabled:opacity-60"
                disabled={deletingClient}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Trash2 size={14} />
                  {deletingClient ? 'Eliminando...' : 'Si, eliminar'}
                </span>
              </button>
            )}
          </div>
        }
      >
        {isClientFormView && (
          <AdminDrawerSection title="Datos basicos" className={drawerSectionCardClass}>
            <div className="space-y-3">
              {errorMessage && (
                <AdminFeedbackBanner tone="error" compact>
                  {errorMessage}
                </AdminFeedbackBanner>
              )}

              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-p-text-secondary">Nombre y apellido *</span>
                <input
                  type="text"
                  value={clientForm.name}
                  onChange={(event) => {
                    setClientFieldErrors((prev) => ({ ...prev, name: '' }));
                    setClientForm((prev) => ({ ...prev, name: event.target.value }));
                  }}
                  className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text shadow-p-card outline-none transition focus:border-p-accent focus:ring-2 focus:ring-lima-300/30"
                  placeholder="Ej: Juan Perez"
                />
                <AdminInlineError>{clientFieldErrors.name}</AdminInlineError>
              </label>

              <div className="grid grid-cols-[110px_1fr] gap-2">
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-p-text-secondary">Pais</span>
                  <select
                    value={clientForm.phoneCountryIso2}
                    onChange={(event) => {
                      setClientFieldErrors((prev) => ({ ...prev, phone: '' }));
                      setClientForm((prev) => ({ ...prev, phoneCountryIso2: normalizePhoneCountryIso2(event.target.value) }));
                    }}
                    className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-2 text-[12px] font-semibold text-p-text shadow-p-card outline-none transition focus:border-p-accent focus:ring-2 focus:ring-lima-300/30"
                  >
                    {PHONE_COUNTRY_OPTIONS.map((option) => (
                      <option key={option.iso2} value={option.iso2}>
                        {option.callingCode} {option.iso2}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-p-text-secondary">Teléfono *</span>
                  <input
                    type="text"
                    value={clientForm.phone}
                    onChange={(event) =>
                      {
                        setClientFieldErrors((prev) => ({ ...prev, phone: '' }));
                        setClientForm((prev) => ({ ...prev, phone: event.target.value.replace(/[^\d]/g, '') }));
                      }
                    }
                    className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text shadow-p-card outline-none transition focus:border-p-accent focus:ring-2 focus:ring-lima-300/30"
                    placeholder="351..."
                  />
                </label>
              </div>
              <AdminInlineError>{clientFieldErrors.phone}</AdminInlineError>

              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-p-text-secondary">DNI</span>
                <input
                  type="text"
                  value={clientForm.dni}
                  onChange={(event) => {
                    setClientFieldErrors((prev) => ({ ...prev, dni: '' }));
                    setClientForm((prev) => ({ ...prev, dni: event.target.value }));
                  }}
                  className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text shadow-p-card outline-none transition focus:border-p-accent focus:ring-2 focus:ring-lima-300/30"
                  placeholder="Documento"
                />
                <AdminInlineError>{clientFieldErrors.dni}</AdminInlineError>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-p-text-secondary">Email <span className="font-normal text-p-text-muted opacity-60">(opcional)</span></span>
                <input
                  type="email"
                  value={clientForm.email}
                  onChange={(event) => {
                    setClientFieldErrors((prev) => ({ ...prev, email: '' }));
                    setClientForm((prev) => ({ ...prev, email: event.target.value }));
                  }}
                  className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text shadow-p-card outline-none transition focus:border-p-accent focus:ring-2 focus:ring-lima-300/30"
                  placeholder="cliente@email.com"
                />
                <AdminInlineError>{clientFieldErrors.email}</AdminInlineError>
              </label>

              <label className="flex min-h-10 items-center gap-2 rounded-xl border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary">
                <input
                  type="checkbox"
                  checked={Boolean(clientForm.isProfessor)}
                  onChange={(event) => setClientForm((prev) => ({ ...prev, isProfessor: event.target.checked }))}
                />
                Es profesor
              </label>
            </div>
          </AdminDrawerSection>
        )}

        {sidebarView === 'client_profile' && (
          !selectedClient ? (
            <AdminDrawerSection className={drawerSectionCardClass}>
              <div className="rounded-xl border border-p-border bg-p-surface p-8 text-center text-[13px] text-p-text-muted">
                Selecciona un cliente.
              </div>
            </AdminDrawerSection>
          ) : (
            <>
              <AdminDrawerSection title="Datos del cliente" className={drawerSectionCardClass}>
                <div className={drawerListClass}>
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-2.5">
                    <span className="text-p-text-muted">Cliente</span>
                    <span className="font-semibold text-p-text">{getClientName(selectedClient)}</span>
                  </div>
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-2.5">
                    <span className="text-p-text-muted">DNI</span>
                    <span className="font-semibold text-p-text">{String(selectedClient.dni || '-')}</span>
                  </div>
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-2.5">
                    <span className="text-p-text-muted">Teléfono</span>
                    <span className="font-semibold text-p-text">{String(selectedClient.phone || '-')}</span>
                  </div>
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-2.5">
                    <span className="text-p-text-muted">Email</span>
                    <span className="break-all font-semibold text-p-text">{String(selectedClient.email || '-')}</span>
                  </div>
                </div>
              </AdminDrawerSection>

              <AdminDrawerSection title="Estado comercial" className={drawerSectionCardClass}>
                <div className={drawerListClass}>
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-2.5">
                    <span className="text-p-text-muted">Reservas</span>
                    <span className="font-semibold text-p-text">{Number(selectedClient.totalBookings || 0)}</span>
                  </div>
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-2.5">
                    <span className="text-p-text-muted">Deuda</span>
                    {Number(selectedClient.totalDebt || 0) > EPSILON ? (
                      <span className="font-semibold text-p-error">{formatMoney(Number(selectedClient.totalDebt || 0))}</span>
                    ) : (
                      <span className="font-semibold text-p-text-muted">Sin deuda vigente</span>
                    )}
                  </div>
                </div>
              </AdminDrawerSection>

              <AdminDrawerSection title="Vinculación con usuario" className={drawerSectionCardClass}>
                <div className="rounded-xl border border-p-border bg-p-surface p-3 text-[13px]">
                  {selectedClient.linkedUser ? (
                    <>
                      <p className="font-semibold text-p-text">
                        {selectedClient.linkedUser.name || `Usuario ${selectedClient.linkedUser.id}`}
                      </p>
                      <p className="mt-1 text-p-text-muted">
                        {selectedClient.linkedUser.email || `ID usuario #${selectedClient.linkedUser.id}`}
                      </p>
                    </>
                  ) : (
                    <p className="text-p-text-muted">No hay usuario vinculado manualmente.</p>
                  )}
                </div>
              </AdminDrawerSection>
            </>
          )
        )}

        {sidebarView === 'client_delete' && (
          <AdminDrawerSection title="Confirmacion" className={drawerSectionCardClass}>
            <AdminFeedbackBanner tone="error">
              Vas a eliminar a {selectedClient ? getClientName(selectedClient) : 'este cliente'}. Esta accion no se puede deshacer.
            </AdminFeedbackBanner>
            <div className="rounded-xl border border-p-border bg-p-surface p-3">
              <p className="text-[12px] uppercase tracking-wide text-p-text-muted">Cliente seleccionado</p>
              <p className="mt-1 text-[13px] font-semibold text-p-text">{selectedClient ? getClientName(selectedClient) : '-'}</p>
            </div>
          </AdminDrawerSection>
        )}
      </AdminDrawer>
      <AdminAppModal
        show={linkModalOpen}
        onClose={() => {
          if (linkBusy) return;
          setLinkModalOpen(false);
          resetLinkModal();
        }}
        title="Vincular cliente con usuario"
        confirmText={linkBusy ? 'Vinculando...' : 'Confirmar vínculo'}
        confirmDisabled={linkBusy || !linkSelectedUser?.userId}
        onConfirm={() => {
          void submitLinkUser();
        }}
        message={
          <div className="space-y-4">
            {linkError ? <AdminFeedbackBanner tone="error" compact>{linkError}</AdminFeedbackBanner> : null}
            <div className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-[13px] text-p-text-secondary">
              <p><span className="font-semibold text-p-text">Cliente:</span> {selectedClient ? getClientName(selectedClient) : '-'}</p>
              <p className="mt-1"><span className="font-semibold text-p-text">Política:</span> el vínculo es manual y no se reemplaza automáticamente.</p>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-p-text-secondary">Buscar usuario</span>
              <input
                type="text"
                value={linkSearchTerm}
                onChange={(event) => {
                  setLinkSearchTerm(event.target.value);
                  setLinkError('');
                }}
                className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-accent"
                placeholder="Nombre, email o teléfono"
              />
            </label>
            <div className="max-h-64 space-y-2 overflow-auto">
              {linkSearchLoading ? <p className="text-[12px] text-p-text-muted">Buscando usuarios...</p> : null}
              {!linkSearchLoading && linkSearchTerm.trim().length >= 2 && linkSearchResults.length === 0 ? (
                <p className="text-[12px] text-p-text-muted">No se encontraron usuarios permitidos para vincular con esa búsqueda.</p>
              ) : null}
              {linkSearchResults.map((row) => {
                const selected = Number(linkSelectedUser?.userId || 0) === Number(row?.userId || 0);
                return (
                  <button
                    key={String(row?.personKey || row?.userId)}
                    type="button"
                    onClick={() => setLinkSelectedUser(row)}
                    className={`w-full rounded-xl border p-3 text-left text-[13px] transition ${
                      selected ? 'border-p-accent bg-p-positive-bg' : 'border-p-border bg-p-surface-2 hover:bg-p-surface'
                    }`}
                  >
                    <p className="font-semibold text-p-text">{String(row?.displayName || `Usuario ${row?.userId || ''}`)}</p>
                    <p className="mt-0.5 text-p-text-muted">{String(row?.email || row?.phone || '-')}</p>
                    {Array.isArray(row?.badges) && row.badges.length > 0 ? (
                      <p className="mt-1 text-[11px] text-p-text-muted">{row.badges.join(' · ')}</p>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        }
      />
      <DuplicateClientDecisionModal
        open={clientDuplicateModalOpen}
        candidates={clientDuplicateCandidates}
        selectedClientId={clientDuplicateSelectedId}
        loading={submittingClient}
        error={clientDuplicateError}
        onSelectClient={setClientDuplicateSelectedId}
        onClose={resetClientDuplicateModal}
        onUseExisting={() => {
          void applyExistingDuplicateClient();
        }}
        onCreateNew={() => {
          void forceCreateDuplicateClient();
        }}
      />
      <AdminAppModal
        show={unlinkConfirmOpen}
        onClose={() => {
          if (unlinkBusy) return;
          setUnlinkConfirmOpen(false);
        }}
        title="¿Desvincular usuario?"
        message={
          <div className="space-y-3">
            <p>Vas a quitar la vinculación manual entre este cliente y el usuario asociado.</p>
            <div className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-[13px] text-p-text-secondary">
              <p><span className="font-semibold text-p-text">Cliente:</span> {selectedClient ? getClientName(selectedClient) : '-'}</p>
              <p className="mt-1"><span className="font-semibold text-p-text">Usuario:</span> {selectedClient?.linkedUser?.name || selectedClient?.linkedUser?.email || '-'}</p>
            </div>
          </div>
        }
        confirmText={unlinkBusy ? 'Desvinculando...' : 'Desvincular'}
        confirmDisabled={unlinkBusy}
        isWarning
        onConfirm={() => {
          void submitUnlinkUser();
        }}
      />
      <AdminAppModal
        show={mergeModalOpen}
        onClose={() => {
          if (mergeBusy) return;
          setMergeModalOpen(false);
          resetMergeModal();
        }}
        title="Fusionar cliente manualmente"
        message={
          <div className="space-y-4">
            {mergeError ? <AdminFeedbackBanner tone="error" compact>{mergeError}</AdminFeedbackBanner> : null}
            <div className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-[13px] text-p-text-secondary">
              <p><span className="font-semibold text-p-text">Origen:</span> {selectedClient ? getClientName(selectedClient) : '-'}</p>
              <p className="mt-1">Se van a mover reservas, cuentas y referencias operativas al cliente destino. No hay merge automático.</p>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-p-text-secondary">Buscar cliente destino</span>
              <input
                type="text"
                value={mergeSearchTerm}
                onChange={(event) => {
                  setMergeSearchTerm(event.target.value);
                  setMergeError('');
                }}
                className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-accent"
                placeholder="Nombre, DNI, email o teléfono"
              />
            </label>
            <div className="max-h-64 space-y-2 overflow-auto">
              {mergeSearchLoading ? <p className="text-[12px] text-p-text-muted">Buscando clientes...</p> : null}
              {!mergeSearchLoading && mergeSearchTerm.trim().length >= 2 && mergeSearchResults.length === 0 ? (
                <p className="text-[12px] text-p-text-muted">No se encontraron clientes destino.</p>
              ) : null}
              {mergeSearchResults.map((row: any) => {
                const selected = String(mergeSelectedTarget?.id || '') === String(row?.id || '');
                return (
                  <button
                    key={String(row?.id || '')}
                    type="button"
                    onClick={() => setMergeSelectedTarget(row)}
                    className={`w-full rounded-xl border p-3 text-left text-[13px] transition ${
                      selected ? 'border-p-accent bg-p-positive-bg' : 'border-p-border bg-p-surface-2 hover:bg-p-surface'
                    }`}
                  >
                    <p className="font-semibold text-p-text">{String(row?.name || 'Sin nombre')}</p>
                    <p className="mt-0.5 text-p-text-muted">{String(row?.phone || row?.email || '-')}</p>
                  </button>
                );
              })}
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-p-text-secondary">Nota interna (opcional)</span>
              <textarea
                value={mergeNotes}
                onChange={(event) => setMergeNotes(event.target.value)}
                rows={3}
                className="w-full rounded-xl border border-p-border bg-p-surface px-3 py-2 text-[13px] text-p-text outline-none focus:border-p-accent"
                placeholder="Qué revisaste antes de fusionar"
              />
            </label>
          </div>
        }
        confirmText={mergeBusy ? 'Fusionando...' : 'Confirmar fusión'}
        confirmDisabled={mergeBusy || !mergeSelectedTarget?.id}
        isWarning
        onConfirm={() => {
          void submitMergeClient();
        }}
      />
      <AccountDrawer
        accountId={accountDrawerAccountId || null}
        open={accountDrawerOpen}
        initialView={accountDrawerInitialView}
        context={accountDrawerContext}
        onClose={() => {
          setAccountDrawerOpen(false);
          setAccountDrawerInitialView('overview');
        }}
        onSuccess={(event, meta?: AccountDrawerSuccessMeta) => {
          if (event === 'closed') {
            showAdminToast(`${meta?.label || 'Cuenta'} cerrada correctamente.`);
          }
          void loadClients();
        }}
      />
    </>
  );
}
