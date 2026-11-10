import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarPlus,
  ChevronLeft,
  Link2,
  MessageCircle,
  Phone,
  MoreHorizontal,
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
import ClientMemberPanel from '../../components/admin/members/ClientMemberPanel';
import ClientSubscriptionsPanel from '../../components/admin/subscriptions/ClientSubscriptionsPanel';
import MemberBadge from '../../components/admin/members/MemberBadge';
import MembersRosterPanel from '../../components/admin/members/MembersRosterPanel';
import { AdminDrawer, AdminDrawerSection, AdminFeedbackBanner, AdminFilterToolbar, AdminInlineError, AdminSegmentedControl } from '../../components/admin/ui';
import NotFound from '../../components/NotFound';
import RouteTransitionScreen from '../../components/RouteTransitionScreen';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { getPendingLogoutRedirect } from '../../services/AuthService';
import { ClientService, type ClientIdentityAuditEntry } from '../../services/ClientService';
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

type ClientsView = 'directory' | 'debt' | 'history' | 'members' | 'incidents';

/** "sáb 7 nov · 10:30". */
const formatClientSlot = (iso: string | null | undefined, fallbackDate?: string | null, fallbackTime?: string | null): string => {
  const date = iso ? new Date(iso) : fallbackDate ? new Date(`${String(fallbackDate).slice(0, 10)}T12:00:00`) : null;
  if (!date || Number.isNaN(date.getTime())) return fallbackDate ? String(fallbackDate) : '-';
  const day = date
    .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/,/g, '')
    .replace(/\./g, '');
  const time = iso
    ? date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : fallbackTime || '';
  return time ? `${day} · ${time}` : day;
};

/** Número para wa.me: con código de país. Un celular argentino de 10 dígitos se completa con 549. */
const toWhatsAppNumber = (raw: unknown): string => {
  const text = String(raw || '').trim();
  const digits = text.replace(/\D/g, '');
  if (!digits) return '';
  if (text.startsWith('+') || digits.length >= 11) return digits;
  if (digits.length === 10) return `549${digits}`;
  return '';
};

const toTelHref = (raw: unknown): string => {
  const text = String(raw || '').trim().replace(/[^\d+]/g, '');
  return text.replace(/\D/g, '').length >= 6 ? `tel:${text}` : '';
};

const accountSortKey = (account: any): string =>
  `${String(account?.date || '').slice(0, 10)} ${String(account?.time || '').padStart(5, '0')}`;

const CLIENT_BOOKING_STATUS: Record<string, { label: string; tone: string }> = {
  CONFIRMED: { label: 'Confirmada', tone: 'text-p-text-muted' },
  PENDING: { label: 'Sin confirmar', tone: 'text-p-warning' },
  COMPLETED: { label: 'Jugada', tone: 'text-p-text-muted' },
  CANCELLED: { label: 'Cancelada', tone: 'text-p-text-muted line-through' },
  NO_SHOW: { label: 'No vino', tone: 'text-p-warning' },
};

/** "hoy", "ayer", "hace 3 días", "12 oct". */
const formatClientLastBooking = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(date)) / 86_400_000);
  if (days === 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days === -1) return 'mañana';
  if (days > 1 && days < 7) return `hace ${days} días`;
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace(/\./g, '');
};
type ClientActionSidebarView = 'none' | 'client_create' | 'client_edit' | 'client_profile' | 'client_delete';
type ClientSearchRow = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  dni?: string;
  isProfessor?: boolean;
};

type ClientIdentityOverview = {
  clientId: string;
  clubId: number;
  status: 'LINKED' | 'SUGGESTED_LINK' | 'REVIEW_REQUIRED' | 'NO_MATCH' | string;
  reasonCode:
    | 'ALREADY_LINKED'
    | 'SINGLE_USER_CANDIDATE'
    | 'MULTIPLE_USER_CANDIDATES'
    | 'USER_ALREADY_LINKED_ELSEWHERE'
    | 'DUPLICATE_CLIENTS_FOUND'
    | 'DUPLICATE_CLIENT_AND_USER_CONFLICT'
    | 'NO_STRONG_MATCH'
    | string;
  summary: string;
  linkedUser: {
    id: number;
    displayName: string;
    email: string | null;
  } | null;
  recommendedUserId: number | null;
  signals: Array<'EMAIL' | 'PHONE' | 'DNI' | string>;
  userCandidates: Array<{
    userId: number;
    displayName: string;
    email: string | null;
    phoneNumber: string | null;
    matchedBy: Array<'EMAIL' | 'PHONE' | 'DNI' | string>;
    linkedClientId: string | null;
    linkedClientName: string | null;
  }>;
  duplicateClients: Array<{
    clientId: string;
    name: string;
    email: string | null;
    phone: string | null;
    dni: string | null;
    userId: number | null;
    matchedBy: Array<'EMAIL' | 'PHONE' | 'DNI' | string>;
  }>;
  incidentId?: string | null;
  isManualReview?: boolean;
  manualReviewNote?: string | null;
  manualReviewCreatedAt?: string | null;
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
  if (key === 'SUBSCRIPTION_INSTALLMENT') return 'Cuota de plan';
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

const formatIdentitySignals = (signals: Array<string>) => {
  const labels = signals.map((signal) => {
    if (signal === 'EMAIL') return 'email';
    if (signal === 'PHONE') return 'teléfono';
    if (signal === 'DNI') return 'DNI';
    return signal.toLowerCase();
  }).filter(Boolean);
  return labels.length > 0 ? labels.join(', ') : 'sin señales fuertes';
};

export default function AdminClientesPlayground2Page() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });

  const [activeView, setActiveView] = useState<ClientsView>('directory');
  /** Lista de clientes: Todos, los que deben o los socios. */
  const [clientsListFilter, setClientsListFilter] = useState<'ALL' | 'DEBT' | 'MEMBERS'>('ALL');
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
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
  // Al cambiar un plan del cliente puede cambiar su "al día hasta": recargamos el panel de socio.
  const [memberPanelVersion, setMemberPanelVersion] = useState(0);
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
  const [identityOverview, setIdentityOverview] = useState<ClientIdentityOverview | null>(null);
  const [identityOverviewLoading, setIdentityOverviewLoading] = useState(false);
  const [identityOverviewError, setIdentityOverviewError] = useState('');
  const [identityQuickLinkBusy, setIdentityQuickLinkBusy] = useState(false);
  const [identityIncidentModalOpen, setIdentityIncidentModalOpen] = useState(false);
  const [identityIncidentBusy, setIdentityIncidentBusy] = useState(false);
  const [identityIncidentNote, setIdentityIncidentNote] = useState('');
  const [identityIncidentError, setIdentityIncidentError] = useState('');
  const [identityAuditEntries, setIdentityAuditEntries] = useState<ClientIdentityAuditEntry[]>([]);
  const [identityAuditLoading, setIdentityAuditLoading] = useState(false);
  const [identityAuditError, setIdentityAuditError] = useState('');
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

  const openMergeModalWithTarget = useCallback((target: ClientSearchRow) => {
    resetMergeModal();
    setMergeSelectedTarget(target);
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
    const currentSelectedClient = clients.find((client) => String(client.id) === String(selectedClientId)) || null;
    if (sidebarView !== 'client_profile' || !currentSelectedClient?.id) {
      setIdentityOverview(null);
      setIdentityOverviewError('');
      setIdentityOverviewLoading(false);
      return;
    }
    const slug = resolveClubSlug();
    if (!slug) return;
    let cancelled = false;
    setIdentityOverviewLoading(true);
    setIdentityOverviewError('');
    ClientService.getIdentityOverviewByClubSlug(slug, String(currentSelectedClient.id))
      .then((overview) => {
        if (!cancelled) setIdentityOverview(overview as ClientIdentityOverview);
      })
      .catch((error) => {
        if (!cancelled) {
          setIdentityOverviewError(extractErrorMessage(error, 'No se pudo cargar el estado de identidad.'));
        }
      })
      .finally(() => {
        if (!cancelled) setIdentityOverviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clients, resolveClubSlug, selectedClientId, sidebarView]);

  useEffect(() => {
    const currentSelectedClient = clients.find((client) => String(client.id) === String(selectedClientId)) || null;
    if (sidebarView !== 'client_profile' || !currentSelectedClient?.id) {
      setIdentityAuditEntries([]);
      setIdentityAuditError('');
      setIdentityAuditLoading(false);
      return;
    }
    const slug = resolveClubSlug();
    if (!slug) return;
    let cancelled = false;
    setIdentityAuditLoading(true);
    setIdentityAuditError('');
    ClientService.getIdentityAuditByClubSlug(slug, String(currentSelectedClient.id), 10)
      .then((entries) => {
        if (!cancelled) setIdentityAuditEntries(entries);
      })
      .catch((error) => {
        if (!cancelled) {
          setIdentityAuditError(extractErrorMessage(error, 'No se pudo cargar la auditoría de identidad.'));
        }
      })
      .finally(() => {
        if (!cancelled) setIdentityAuditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clients, resolveClubSlug, selectedClientId, sidebarView]);

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

  useEffect(() => {
    if (!authChecked || !user || !hasAdminAccess(user)) return;
    if (activeView === 'incidents') return;
    const slug = resolveClubSlug();
    if (!slug) return;
    let cancelled = false;
    Promise.all([
      ClubAdminService.listClientDuplicateIncidents(slug, { status: 'OPEN' }).catch(() => []),
      ClubAdminService.listClientIdentityIncidents(slug, { status: 'REVIEW_REQUIRED,SUGGESTED_LINK', limit: 80 }).catch(() => []),
    ]).then(([duplicates, identity]) => {
      if (cancelled) return;
      setReviewCount((Array.isArray(duplicates) ? duplicates.length : 0) + (Array.isArray(identity) ? identity.length : 0));
    });
    return () => {
      cancelled = true;
    };
  }, [activeView, authChecked, user, resolveClubSlug]);

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

  const listedClients = useMemo(() => {
    if (clientsListFilter === 'DEBT') return filteredClients.filter((client) => Number(client?.totalDebt || 0) > EPSILON);
    if (clientsListFilter === 'MEMBERS') return filteredClients.filter((client) => Boolean(client?.member));
    return filteredClients;
  }, [clientsListFilter, filteredClients]);

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

  const linkClientToSpecificUser = async (userId: number) => {
    const slug = resolveClubSlug();
    const safeUserId = Number(userId || 0);
    if (!slug || !selectedClient?.id || !Number.isInteger(safeUserId) || safeUserId <= 0) {
      setIdentityOverviewError('No encontramos un usuario válido para vincular.');
      return;
    }
    try {
      setIdentityQuickLinkBusy(true);
      setIdentityOverviewError('');
      await ClientService.linkUserByClubSlug(slug, String(selectedClient.id), safeUserId);
      setSuccessMessage('Cliente vinculado al usuario seleccionado.');
      await loadClients();
    } catch (error: any) {
      setIdentityOverviewError(resolveClientIdentityError(error, 'No se pudo vincular el usuario seleccionado.'));
    } finally {
      setIdentityQuickLinkBusy(false);
    }
  };

  const applySuggestedIdentityLink = async () => {
    const recommendedUserId = Number(identityOverview?.recommendedUserId || 0);
    if (!Number.isInteger(recommendedUserId) || recommendedUserId <= 0) {
      setIdentityOverviewError('No encontramos un usuario sugerido para vincular.');
      return;
    }
    await linkClientToSpecificUser(recommendedUserId);
  };

  const createIdentityIncident = async () => {
    const slug = resolveClubSlug();
    if (!slug || !selectedClient?.id) {
      setIdentityIncidentError('No encontramos el cliente para marcar el caso.');
      return;
    }
    try {
      setIdentityIncidentBusy(true);
      setIdentityIncidentError('');
      await ClientService.createIdentityIncidentByClubSlug(slug, String(selectedClient.id), {
        note: identityIncidentNote.trim() || undefined,
      });
      setIdentityIncidentModalOpen(false);
      setIdentityIncidentNote('');
      setSuccessMessage('Caso marcado para revisión en Incidentes > Identidad.');
      const [auditEntries, overview] = await Promise.all([
        ClientService.getIdentityAuditByClubSlug(slug, String(selectedClient.id), 10),
        ClientService.getIdentityOverviewByClubSlug(slug, String(selectedClient.id)),
      ]);
      setIdentityAuditEntries(auditEntries);
      setIdentityOverview(overview as ClientIdentityOverview);
    } catch (error: any) {
      setIdentityIncidentError(resolveClientIdentityError(error, 'No se pudo marcar el caso para revisión.'));
    } finally {
      setIdentityIncidentBusy(false);
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
    // La ficha abierta sigue abierta al cerrar un formulario.
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
      if (activeView !== 'directory') return;
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
  // Ficha: reservas que vienen, las últimas y lo que debe por cuenta.
  const clientBookingRows = useMemo(() => {
    const rows = Array.isArray(selectedClient?.bookings) ? selectedClient.bookings : [];
    const seen = new Set<string>();
    return rows
      .map((entry: any) => {
        const iso = entry?.startDateTime || null;
        const fallback = entry?.date ? new Date(`${String(entry.date).slice(0, 10)}T${entry?.time || '00:00'}:00`) : null;
        const start = iso ? new Date(iso) : fallback;
        return {
          id: String(entry?.bookingId ?? entry?.id ?? ''),
          start: start && !Number.isNaN(start.getTime()) ? start : null,
          iso,
          date: entry?.date || null,
          time: entry?.time || null,
          courtName: entry?.courtName || '',
          status: String(entry?.bookingStatus || entry?.status || '').toUpperCase(),
        };
      })
      .filter((row: any) => {
        if (!row.id || seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
      });
  }, [selectedClient]);
  const clientUpcomingBookings = useMemo(() => {
    const now = Date.now();
    return clientBookingRows
      .filter((row: any) => row.start && row.start.getTime() >= now && row.status !== 'CANCELLED')
      .sort((a: any, b: any) => a.start.getTime() - b.start.getTime())
      .slice(0, 5);
  }, [clientBookingRows]);
  const clientRecentBookings = useMemo(() => {
    const now = Date.now();
    return clientBookingRows
      .filter((row: any) => row.start && row.start.getTime() < now)
      .sort((a: any, b: any) => b.start.getTime() - a.start.getTime())
      .slice(0, 5);
  }, [clientBookingRows]);
  const clientPendingAccounts = useMemo(
    () =>
      historyAccounts
        .filter(
          (account: any) =>
            String(account?.accountStatus || account?.status || 'OPEN').toUpperCase() !== 'CLOSED' &&
            Number(account?.amount || 0) > EPSILON
        )
        // La deuda más vieja primero: es la que hay que cobrar antes.
        .sort((a: any, b: any) => accountSortKey(a).localeCompare(accountSortKey(b))),
    [historyAccounts]
  );

  useEffect(() => {
    setClientMenuOpen(false);
  }, [selectedClientId]);

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
        <div className="flex h-full min-h-0 flex-col gap-3 p-3.5 lg:gap-4 lg:p-6">
              <h1 className="text-[22px] font-extrabold tracking-[-0.03em] text-p-text lg:hidden">Clientes</h1>
              <AdminSegmentedControl
                ariaLabel="Vistas de clientes"
                value={activeView}
                onChange={(nextView) => setActiveView(nextView as ClientsView)}
                options={[
                  { value: 'directory', label: 'Clientes' },
                  { value: 'members', label: 'Socios' },
                ]}
                className="w-fit"
              />

              {activeView === 'directory' && reviewCount > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveView('incidents')}
                  className="w-full rounded-xl bg-p-warning-bg px-4 py-3 text-left text-[14px] text-p-warning"
                >
                  <span className="font-semibold">
                    {reviewCount === 1 ? 'Hay 1 cliente para revisar' : `Hay ${reviewCount} clientes para revisar`}
                  </span>{' '}
                  (posibles repetidos o cuentas de la app sin unir). Revisar →
                </button>
              )}

              <div className="min-h-0 flex-1 overflow-hidden">
                {activeView === 'directory' && (
                  <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
                    {/* Left: client list with search + debt badge */}
                    <article className={`flex min-h-0 flex-col rounded-xl border border-p-border bg-p-surface ${selectedClient ? 'max-lg:hidden' : ''}`}>
                      <div className="space-y-3 p-4 pb-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[14px] text-p-text-secondary">
                            <span className="font-semibold text-p-text">
                              {totalClients === 1 ? '1 cliente' : `${totalClients} clientes`}
                            </span>
                            {totalDebt > EPSILON && (
                              <>
                                {' · te deben '}
                                <span className="font-semibold tabular-nums text-p-warning">{formatMoney(totalDebt)}</span>
                              </>
                            )}
                          </p>
                          <button
                            type="button"
                            onClick={openCreateClient}
                            className="inline-flex h-9 flex-none items-center gap-1.5 rounded-xl bg-ink-900 px-3 text-[13px] font-semibold text-ink-50 transition hover:bg-ink-800"
                          >
                            <Plus size={15} strokeWidth={2.5} />
                            Nuevo cliente
                          </button>
                        </div>
                        <div className="relative">
                          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-p-text-muted" />
                          <input
                            type="text"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            placeholder="Buscar por nombre, teléfono o DNI"
                            className="h-10 w-full rounded-xl border border-p-border bg-p-surface pl-9 pr-3 text-[13px] text-p-text outline-none focus:border-p-border-strong"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          {([
                            { id: 'ALL', label: 'Todos' },
                            { id: 'DEBT', label: clientsWithOpenDebt.length > 0 ? `Deben (${clientsWithOpenDebt.length})` : 'Deben' },
                            { id: 'MEMBERS', label: 'Socios' },
                          ] as Array<{ id: 'ALL' | 'DEBT' | 'MEMBERS'; label: string }>).map((option) => (
                            <button
                              key={`clients-filter-${option.id}`}
                              type="button"
                              aria-pressed={clientsListFilter === option.id}
                              onClick={() => setClientsListFilter(option.id)}
                              className={`h-8 rounded-lg px-3 text-[13px] font-semibold transition ${
                                clientsListFilter === option.id ? 'bg-ink-900 text-ink-50' : 'text-p-text-secondary hover:bg-p-surface-2'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="min-h-0 flex-1 overflow-auto border-t border-p-border">
                        {loading ? (
                          <div className="p-6 text-center text-[13px] text-p-text-muted">Cargando...</div>
                        ) : listedClients.length === 0 ? (
                          <div className="p-6 text-center text-[13px] text-p-text-muted">
                            {searchTerm.trim()
                              ? 'Nadie coincide con esa búsqueda.'
                              : clientsListFilter === 'DEBT'
                                ? 'Nadie debe nada.'
                                : clientsListFilter === 'MEMBERS'
                                  ? 'No hay socios cargados.'
                                  : 'Todavía no hay clientes.'}
                          </div>
                        ) : (
                          <ul className="divide-y divide-p-border">
                            {listedClients.map((client) => {
                              const debt = Number(client?.totalDebt || 0);
                              const isSelected = String(selectedClientId) === String(client.id);
                              const lastBooking = formatClientLastBooking(client?.lastBookingAt);
                              const contact = String(client.phone || client.email || '').trim();
                              return (
                                <li key={String(client.id)}>
                                  <button
                                    type="button"
                                    onClick={() => openClientProfile(client)}
                                    aria-pressed={isSelected}
                                    className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition ${
                                      isSelected ? 'bg-p-surface-2' : 'hover:bg-p-surface-2'
                                    }`}
                                  >
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        <p className="truncate text-[14px] font-semibold text-p-text">{getClientName(client)}</p>
                                        <MemberBadge member={client.member} />
                                      </div>
                                      <p className="truncate text-[12px] text-p-text-muted">
                                        {[contact, lastBooking ? `última reserva ${lastBooking}` : 'sin reservas'].filter(Boolean).join(' · ')}
                                      </p>
                                    </div>
                                    {debt > EPSILON && (
                                      <span className="flex-none text-[13px] font-bold tabular-nums text-p-warning">
                                        Debe {formatMoney(debt)}
                                      </span>
                                    )}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </article>

                    {/* Right: Perfil panel */}
                    <article className={`flex min-h-0 flex-col overflow-auto rounded-xl border border-p-border bg-p-surface ${selectedClient ? '' : 'max-lg:hidden'}`}>
                      {selectedClient && (
                        <div className="px-4 pt-3 lg:hidden">
                          <button
                          type="button"
                          onClick={() => setSelectedClientId('')}
                          className="mb-1 inline-flex items-center gap-1 text-[12px] font-bold text-p-accent lg:hidden"
                        >
                          <ChevronLeft size={15} />
                          Volver a la lista
                        </button>
                        </div>
                      )}
                      {!selectedClient ? (
                        <div className="p-8 text-center text-[13px] text-p-text-muted">
                          Elegí un cliente para ver su ficha.
                        </div>
                      ) : (
                        <>
                          {/* Quién es */}
                          <div className="border-b border-p-border p-4 lg:p-5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h2 className="text-[22px] font-bold leading-tight tracking-tight text-p-text">{getClientName(selectedClient)}</h2>
                                  <MemberBadge member={selectedClient.member} />
                                  {selectedClient.isProfessor && (
                                    <span className="rounded-full bg-p-surface-3 px-2 py-0.5 text-[11px] font-semibold text-p-text-secondary">
                                      Profesor
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-[14px] text-p-text-secondary">
                                  {[String(selectedClient.phone || '').trim(), String(selectedClient.email || '').trim()]
                                    .filter(Boolean)
                                    .join(' · ') || 'Sin teléfono ni email'}
                                </p>
                              </div>
                              <div className="relative flex flex-none items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => openEditClient(selectedClient)}
                                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-3 text-[13px] font-semibold text-p-text hover:bg-p-surface-2"
                                >
                                  <Pencil size={13} />
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  aria-label="Más opciones del cliente"
                                  aria-expanded={clientMenuOpen}
                                  onClick={() => setClientMenuOpen((open) => !open)}
                                  className="grid h-9 w-9 place-items-center rounded-xl border border-p-border text-p-text-secondary hover:bg-p-surface-2"
                                >
                                  <MoreHorizontal size={16} />
                                </button>
                                {clientMenuOpen && (
                                  <>
                                    <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-30 cursor-default" onClick={() => setClientMenuOpen(false)} />
                                    <div className="absolute right-0 top-11 z-40 w-60 rounded-xl border border-p-border bg-p-surface p-1 shadow-xl">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setClientMenuOpen(false);
                                          openMergeModal();
                                        }}
                                        className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-p-text hover:bg-p-surface-2"
                                      >
                                        Unir con otro cliente repetido
                                      </button>
                                      {selectedClient.linkedUser ? (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setClientMenuOpen(false);
                                            setUnlinkConfirmOpen(true);
                                          }}
                                          className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-p-text hover:bg-p-surface-2"
                                        >
                                          Desvincular de su cuenta de la app
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setClientMenuOpen(false);
                                            openLinkModal();
                                          }}
                                          className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-p-text hover:bg-p-surface-2"
                                        >
                                          Vincular con una cuenta de la app
                                        </button>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                              {(() => {
                                const telHref = toTelHref(selectedClient.phone);
                                const waNumber = toWhatsAppNumber(selectedClient.phone);
                                const actionClass =
                                  'inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-3 text-[13px] font-semibold text-p-text hover:bg-p-surface-2';
                                return (
                                  <div
                                    className="mt-3 grid gap-2 sm:flex sm:flex-wrap"
                                    style={{ gridTemplateColumns: `repeat(${1 + (telHref ? 1 : 0) + (waNumber ? 1 : 0)}, minmax(0, 1fr))` }}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const query: Record<string, string> = {
                                          cliente: String(selectedClient.id),
                                          nombre: getClientName(selectedClient),
                                        };
                                        const phone = String(selectedClient.phone || '').trim();
                                        if (phone) query.tel = phone;
                                        void router.push({ pathname: '/admin/agenda', query });
                                      }}
                                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-ink-900 px-3.5 text-[13px] font-semibold text-ink-50 hover:bg-ink-800"
                                    >
                                      <CalendarPlus size={14} />
                                      Reservar
                                    </button>
                                    {telHref && (
                                      <a href={telHref} className={actionClass}>
                                        <Phone size={14} />
                                        Llamar
                                      </a>
                                    )}
                                    {waNumber && (
                                      <a
                                        href={`https://wa.me/${waNumber}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={actionClass}
                                        title="Abre WhatsApp con este número. No se manda nada solo."
                                      >
                                        <MessageCircle size={14} />
                                        WhatsApp
                                      </a>
                                    )}
                                  </div>
                                );
                              })()}
                          </div>

                          <div className="space-y-6 p-4 lg:p-5">
                            {/* Cuánto debe */}
                            {Number(selectedClient.totalDebt || 0) > EPSILON ? (
                              <div>
                                <div className="flex flex-wrap items-end justify-between gap-3">
                                  <div>
                                    <p className="text-[13px] text-p-text-muted">Debe</p>
                                    <p className="text-[30px] font-bold leading-tight tabular-nums text-p-warning">
                                      {formatMoney(Number(selectedClient.totalDebt || 0))}
                                    </p>
                                    {clientPendingAccounts.length > 1 && (
                                      <p className="text-[12px] text-p-text-muted">En {clientPendingAccounts.length} cuentas</p>
                                    )}
                                  </div>
                                  {clientPendingAccounts.length === 1 && (
                                    <button
                                      type="button"
                                      onClick={() => openAccountDrawer(String(clientPendingAccounts[0].id), 'payment')}
                                      className="h-11 rounded-xl bg-ink-900 px-5 text-[14px] font-semibold text-ink-50 hover:bg-ink-800"
                                    >
                                      Cobrar {formatMoney(Number(clientPendingAccounts[0].amount || 0))}
                                    </button>
                                  )}
                                </div>
                                {clientPendingAccounts.length > 1 && (
                                  <ul className="mt-3 divide-y divide-p-border rounded-xl border border-p-border">
                                    {clientPendingAccounts.map((account: any) => (
                                      <li key={String(account.id)} className="flex items-center justify-between gap-3 px-3 py-2.5">
                                        <button
                                          type="button"
                                          onClick={() => openAccountDrawer(String(account.id), 'overview')}
                                          className="min-w-0 text-left"
                                        >
                                          <p className="truncate text-[13px] text-p-text">
                                            {formatClientSlot(null, account.date, account.time)}
                                          </p>
                                          <p className="truncate text-[12px] text-p-text-muted">
                                            {account.courtName ? `Reserva · ${account.courtName}` : formatAccountSourceType(account.sourceType)}
                                          </p>
                                        </button>
                                        <div className="flex flex-none items-center gap-3">
                                          <span className="text-[13px] font-bold tabular-nums text-p-warning">
                                            {formatMoney(Number(account.amount || 0))}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => openAccountDrawer(String(account.id), 'payment')}
                                            className="h-8 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold text-ink-50 hover:bg-ink-800"
                                          >
                                            Cobrar
                                          </button>
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            ) : (
                              <p className="text-[14px] font-semibold text-p-positive">No debe nada.</p>
                            )}

                            {/* Reservas */}
                            <div className="border-t border-p-border pt-5">
                              <div className="flex items-baseline justify-between gap-3">
                                <p className="text-[13px] font-semibold text-p-text">Próximas reservas</p>
                                {Number(selectedClient.totalBookings || 0) > 0 && (
                                  <p className="text-[12px] text-p-text-muted">
                                    {Number(selectedClient.totalBookings) === 1 ? 'Reservó 1 vez' : `Reservó ${selectedClient.totalBookings} veces`}
                                  </p>
                                )}
                              </div>
                              {clientUpcomingBookings.length === 0 ? (
                                <p className="mt-1 text-[13px] text-p-text-muted">No tiene reservas próximas.</p>
                              ) : (
                                <ul className="mt-1 divide-y divide-p-border">
                                  {clientUpcomingBookings.map((row: any) => (
                                    <li key={`up-${row.id}`} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                                      <span className="text-p-text">{formatClientSlot(row.iso, row.date, row.time)}</span>
                                      <span className="text-right text-p-text-secondary">
                                        {row.courtName}
                                        {row.status === 'PENDING' ? <span className="text-p-warning"> · sin confirmar</span> : null}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {clientRecentBookings.length > 0 && (
                                <>
                                  <p className="mt-4 text-[13px] font-semibold text-p-text">Últimas</p>
                                  <ul className="mt-1 divide-y divide-p-border">
                                    {clientRecentBookings.map((row: any) => {
                                      const status = CLIENT_BOOKING_STATUS[row.status];
                                      return (
                                        <li key={`past-${row.id}`} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                                          <span className={row.status === 'CANCELLED' ? 'text-p-text-muted' : 'text-p-text'}>
                                            {formatClientSlot(row.iso, row.date, row.time)}
                                          </span>
                                          <span className="text-right text-p-text-muted">
                                            {row.courtName}
                                            {status ? <span className={status.tone === 'text-p-warning' ? 'text-p-warning' : ''}> · {status.label.toLowerCase()}</span> : null}
                                          </span>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </>
                              )}
                            </div>

                            {/* Socio */}
                            <div className="border-t border-p-border pt-5">
                              <ClientMemberPanel
                                key={`member-${String(selectedClient.id)}-${memberPanelVersion}`}
                                clubSlug={resolveClubSlug() || ''}
                                clientId={String(selectedClient.id)}
                                clientHasDni={Boolean(String(selectedClient.dni || '').replace(/\D/g, ''))}
                                canManage={hasAdminAccess(user)}
                                onChanged={() => void loadClients()}
                              />
                            </div>

                            {/* Planes y cuotas */}
                            <div className="border-t border-p-border pt-5">
                              <ClientSubscriptionsPanel
                                clubSlug={resolveClubSlug() || ''}
                                clientId={String(selectedClient.id)}
                                clientName={getClientName(selectedClient)}
                                canManage={hasAdminAccess(user)}
                                onChanged={() => {
                                  setMemberPanelVersion((value) => value + 1);
                                  void loadClients();
                                }}
                              />
                            </div>

                            {/* Descuentos — solo si tiene */}
                            {!loadingDiscountAssignments && selectedClientDiscountAssignments.length > 0 && (
                              <div className="border-t border-p-border pt-5">
                                <p className="mb-2 text-[13px] font-semibold text-p-text">Descuentos</p>
                                <div className="flex flex-wrap gap-2">
                                  {selectedClientDiscountAssignments.map((assignment: any, index: number) => (
                                    <span
                                      key={String(assignment?.id || index)}
                                      className="rounded-full border border-p-border bg-p-surface-2 px-3 py-1 text-[12px] font-semibold text-p-text-secondary"
                                    >
                                      {String(assignment?.policy?.name || assignment?.policyName || 'Descuento')}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Datos */}
                            <div className="border-t border-p-border pt-5">
                              <p className="mb-1 text-[13px] font-semibold text-p-text">Datos</p>
                              <dl className="divide-y divide-p-border text-[13px]">
                                {[
                                  ['Teléfono', String(selectedClient.phone || '').trim()],
                                  ['Email', String(selectedClient.email || '').trim()],
                                  ['DNI', String(selectedClient.dni && selectedClient.dni !== '-' ? selectedClient.dni : '').trim()],
                                  [
                                    'App',
                                    selectedClient.linkedUser
                                      ? `Tiene cuenta${selectedClient.linkedUser.email ? ` (${selectedClient.linkedUser.email})` : ''}`
                                      : 'No tiene cuenta',
                                  ],
                                ].map(([label, value]) => (
                                  <div key={label} className="grid grid-cols-[90px_minmax(0,1fr)] gap-2 py-2">
                                    <dt className="text-p-text-muted">{label}</dt>
                                    <dd className="break-all text-p-text">{value || '—'}</dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          </div>
                        </>
                      )}
                    </article>
                  </div>
                )}

                {activeView === 'members' && (
                  <div className="h-full overflow-auto">
                    <MembersRosterPanel
                      clubSlug={resolveClubSlug() || ''}
                      onSelectClient={(clientId) => {
                        setSelectedClientId(clientId);
                        setActiveView('directory');
                      }}
                    />
                  </div>
                )}

                {activeView === 'incidents' && (
                  <div className="h-full overflow-auto">
                    <button
                      type="button"
                      onClick={() => setActiveView('directory')}
                      className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-p-accent hover:underline underline-offset-2"
                    >
                      <ChevronLeft size={15} />
                      Volver a clientes
                    </button>
                    <AdminDuplicateIncidents preferredIdentityClientId={selectedClientId || null} />
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
            ? sidebarView === 'client_create'
              ? 'Con nombre y teléfono alcanza para reservar y cobrarle.'
              : undefined
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
              className="inline-flex h-10 items-center rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
            >
              Cancelar
            </button>

            {isClientFormView && (
              <>
                <button
                  type="button"
                  onClick={() => void submitClient()}
                  disabled={submittingClient}
                  className="h-10 rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submittingClient ? 'Guardando...' : sidebarView === 'client_edit' ? 'Guardar cambios' : 'Crear cliente'}
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
          <div className="space-y-4">
            {errorMessage && (
              <AdminFeedbackBanner tone="error" compact>
                {errorMessage}
              </AdminFeedbackBanner>
            )}

            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-p-text">Nombre y apellido</span>
              <input
                type="text"
                autoFocus
                value={clientForm.name}
                onChange={(event) => {
                  setClientFieldErrors((prev) => ({ ...prev, name: '' }));
                  setClientForm((prev) => ({ ...prev, name: event.target.value }));
                }}
                className="h-11 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[14px] text-p-text outline-none transition focus:border-p-border-strong"
                placeholder="Juan Pérez"
              />
              <AdminInlineError>{clientFieldErrors.name}</AdminInlineError>
            </label>

            <div>
              <span className="mb-1 block text-[13px] font-medium text-p-text">Teléfono</span>
              <div className="flex gap-2">
                <select
                  aria-label="País"
                  value={clientForm.phoneCountryIso2}
                  onChange={(event) => {
                    setClientFieldErrors((prev) => ({ ...prev, phone: '' }));
                    setClientForm((prev) => ({ ...prev, phoneCountryIso2: normalizePhoneCountryIso2(event.target.value) }));
                  }}
                  className="h-11 w-[104px] flex-none rounded-xl border border-p-border bg-p-surface px-2 text-[13px] font-semibold text-p-text outline-none focus:border-p-border-strong"
                >
                  {PHONE_COUNTRY_OPTIONS.map((option) => (
                    <option key={option.iso2} value={option.iso2}>
                      {option.callingCode} {option.iso2}
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={clientForm.phone}
                  onChange={(event) => {
                    setClientFieldErrors((prev) => ({ ...prev, phone: '' }));
                    setClientForm((prev) => ({ ...prev, phone: event.target.value.replace(/[^\d]/g, '') }));
                  }}
                  className="h-11 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[14px] text-p-text outline-none transition focus:border-p-border-strong"
                  placeholder="351 555 1234"
                />
              </div>
              <AdminInlineError>{clientFieldErrors.phone}</AdminInlineError>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-p-text">
                  DNI <span className="font-normal text-p-text-muted">(opcional)</span>
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={clientForm.dni}
                  onChange={(event) => {
                    setClientFieldErrors((prev) => ({ ...prev, dni: '' }));
                    setClientForm((prev) => ({ ...prev, dni: event.target.value }));
                  }}
                  className="h-11 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[14px] text-p-text outline-none transition focus:border-p-border-strong"
                  placeholder="30123123"
                />
                <AdminInlineError>{clientFieldErrors.dni}</AdminInlineError>
              </label>

              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-p-text">
                  Email <span className="font-normal text-p-text-muted">(opcional)</span>
                </span>
                <input
                  type="email"
                  value={clientForm.email}
                  onChange={(event) => {
                    setClientFieldErrors((prev) => ({ ...prev, email: '' }));
                    setClientForm((prev) => ({ ...prev, email: event.target.value }));
                  }}
                  className="h-11 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[14px] text-p-text outline-none transition focus:border-p-border-strong"
                  placeholder="juan@email.com"
                />
                <AdminInlineError>{clientFieldErrors.email}</AdminInlineError>
              </label>
            </div>
            <p className="-mt-2 text-[12px] text-p-text-muted">El DNI sirve para validar si es socio.</p>

            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={Boolean(clientForm.isProfessor)}
                onChange={(event) => setClientForm((prev) => ({ ...prev, isProfessor: event.target.checked }))}
                className="mt-0.5 h-4 w-4 accent-p-brand"
              />
              <span>
                <span className="block text-[14px] font-medium text-p-text">Es profesor</span>
                <span className="block text-[12px] text-p-text-muted">Da clases en el club.</span>
              </span>
            </label>
          </div>
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
                <div className="space-y-4">
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

                  <div className="rounded-xl border border-p-border bg-p-surface-2 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[12px] font-semibold uppercase tracking-wide text-p-text-muted">
                        Estado de identidad
                      </p>
                      {identityOverview?.signals?.length ? (
                        <span className="rounded-full border border-p-border bg-p-surface px-2 py-0.5 text-[10px] font-semibold text-p-text-secondary">
                          Señales: {formatIdentitySignals(identityOverview.signals)}
                        </span>
                      ) : null}
                    </div>

                    {identityOverviewLoading ? (
                      <p className="mt-2 text-[12px] text-p-text-muted">Cargando diagnóstico de identidad...</p>
                    ) : identityOverviewError ? (
                      <AdminFeedbackBanner tone="error" compact className="mt-3">
                        {identityOverviewError}
                      </AdminFeedbackBanner>
                    ) : identityOverview ? (
                      <div className="mt-3 space-y-3">
                        <div className="rounded-xl border border-p-border bg-p-surface px-3 py-2.5">
                          <p className="text-[13px] font-semibold text-p-text">{identityOverview.summary}</p>
                          <p className="mt-1 text-[12px] text-p-text-muted">
                            Estado: {identityOverview.status === 'SUGGESTED_LINK'
                              ? 'Sugerencia de vínculo'
                              : identityOverview.status === 'REVIEW_REQUIRED'
                              ? 'Revisión requerida'
                              : identityOverview.status === 'LINKED'
                              ? 'Vinculado'
                              : 'Sin match'}
                          </p>
                          {identityOverview.incidentId ? (
                            <p className="mt-1 text-[12px] text-p-text-secondary">
                              Ya existe un caso abierto en Incidentes &gt; Identidad
                              {identityOverview.manualReviewNote ? ` · ${identityOverview.manualReviewNote}` : ''}.
                            </p>
                          ) : null}
                        </div>

                        {identityOverview.userCandidates.length > 0 ? (
                          <div className="space-y-2">
                            <p className="text-[12px] font-semibold uppercase tracking-wide text-p-text-muted">
                              Usuarios compatibles ({identityOverview.userCandidates.length})
                            </p>
                            {identityOverview.userCandidates.map((candidate) => (
                              <div
                                key={candidate.userId}
                                className="rounded-xl border border-p-border bg-p-surface px-3 py-2.5"
                              >
                                <p className="text-[13px] font-semibold text-p-text">{candidate.displayName}</p>
                                <p className="mt-0.5 text-[12px] text-p-text-muted">
                                  {candidate.email || candidate.phoneNumber || `ID usuario #${candidate.userId}`}
                                </p>
                                <p className="mt-1 text-[11px] text-p-text-muted">
                                  Match por {formatIdentitySignals(candidate.matchedBy)}
                                </p>
                                {candidate.linkedClientId ? (
                                  <p className="mt-1 text-[11px] text-p-error">
                                    Ya vinculado a {candidate.linkedClientName || `cliente ${candidate.linkedClientId}`}.
                                  </p>
                                ) : (
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void linkClientToSpecificUser(candidate.userId);
                                      }}
                                      disabled={identityQuickLinkBusy}
                                      className="inline-flex h-7 items-center gap-1 rounded-lg bg-ink-900 px-2.5 text-[11px] font-semibold text-ink-50 hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      <Link2 size={11} />
                                      {identityQuickLinkBusy ? 'Vinculando...' : 'Vincular este usuario'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {identityOverview.duplicateClients.length > 0 ? (
                          <div className="space-y-2">
                            <p className="text-[12px] font-semibold uppercase tracking-wide text-p-text-muted">
                              Clientes duplicados ({identityOverview.duplicateClients.length})
                            </p>
                            {identityOverview.duplicateClients.map((duplicate) => (
                              <div
                                key={duplicate.clientId}
                                className="rounded-xl border border-p-border bg-p-surface px-3 py-2.5"
                              >
                                <p className="text-[13px] font-semibold text-p-text">{duplicate.name}</p>
                                <p className="mt-0.5 text-[12px] text-p-text-muted">
                                  {duplicate.email || duplicate.phone || duplicate.dni || `ID ${duplicate.clientId}`}
                                </p>
                                <p className="mt-1 text-[11px] text-p-text-muted">
                                  Match por {formatIdentitySignals(duplicate.matchedBy)}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      openMergeModalWithTarget({
                                        id: duplicate.clientId,
                                        name: duplicate.name,
                                        phone: duplicate.phone || undefined,
                                        email: duplicate.email || undefined,
                                        dni: duplicate.dni || undefined,
                                      });
                                    }}
                                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-p-border bg-p-surface-2 px-2.5 text-[11px] font-semibold text-p-text-secondary hover:bg-p-surface"
                                  >
                                    <RotateCcw size={11} />
                                    Fusionar con este cliente
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        <div className="flex flex-wrap gap-2">
                          {identityOverview.incidentId ? (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveView('incidents');
                                setSidebarView('none');
                              }}
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                            >
                              <Search size={12} />
                              Ver caso abierto
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              setIdentityIncidentError('');
                              setIdentityIncidentNote('');
                              setIdentityIncidentModalOpen(true);
                            }}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                          >
                            <Save size={12} />
                            {identityOverview.incidentId ? 'Actualizar revisión' : 'Marcar para revisión'}
                          </button>
                          {identityOverview.status === 'SUGGESTED_LINK' && identityOverview.recommendedUserId ? (
                            <button
                              type="button"
                              onClick={() => {
                                void applySuggestedIdentityLink();
                              }}
                              disabled={identityQuickLinkBusy}
                              className="inline-flex h-8 items-center gap-1 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold text-ink-50 hover:bg-ink-900"
                            >
                              <Link2 size={12} />
                              {identityQuickLinkBusy ? 'Vinculando...' : 'Vincular usuario sugerido'}
                            </button>
                          ) : null}

                          {identityOverview.status === 'REVIEW_REQUIRED' || identityOverview.userCandidates.length > 0 ? (
                            <button
                              type="button"
                              onClick={openLinkModal}
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                            >
                              <UserPlus size={12} />
                              Buscar usuario manualmente
                            </button>
                          ) : null}

                          {identityOverview.duplicateClients.length > 0 ? (
                            <button
                              type="button"
                              onClick={openMergeModal}
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                            >
                              <RotateCcw size={12} />
                              Fusionar cliente
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-[12px] text-p-text-muted">
                        Todavía no hay diagnóstico de identidad para este cliente.
                      </p>
                    )}
                  </div>

                  <div className="rounded-xl border border-p-border bg-p-surface-2 p-3">
                    <p className="text-[12px] font-semibold uppercase tracking-wide text-p-text-muted">
                      Auditoría de identidad
                    </p>
                    {identityAuditLoading ? (
                      <p className="mt-2 text-[12px] text-p-text-muted">Cargando historial...</p>
                    ) : identityAuditError ? (
                      <AdminFeedbackBanner tone="error" compact className="mt-3">
                        {identityAuditError}
                      </AdminFeedbackBanner>
                    ) : identityAuditEntries.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {identityAuditEntries.map((entry) => (
                          <div
                            key={entry.id}
                            className="rounded-xl border border-p-border bg-p-surface px-3 py-2.5"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-p-border bg-p-surface-2 px-2 py-0.5 text-[10px] font-semibold text-p-text-secondary">
                                {entry.kindLabel}
                              </span>
                              {entry.sourceLabel ? (
                                <span className="rounded-full border border-p-border bg-p-surface-2 px-2 py-0.5 text-[10px] font-semibold text-p-text-muted">
                                  {entry.sourceLabel}
                                </span>
                              ) : null}
                            </div>
                            <p className="text-[13px] font-semibold text-p-text">{entry.summary}</p>
                            <p className="mt-1 text-[11px] text-p-text-muted">
                              {entry.actorUser?.displayName || 'Sistema'} · {formatDateTime24(entry.createdAt)}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-[12px] text-p-text-muted">
                        Todavía no hay acciones auditadas para este cliente.
                      </p>
                    )}
                  </div>
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
              {linkSearchResults.length > 0 ? (
                <p className="pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-p-text-muted">Usuarios encontrados</p>
              ) : null}
              {linkSearchResults.map((row) => {
                const selected = Number(linkSelectedUser?.userId || 0) === Number(row?.userId || 0);
                return (
                  <button
                    key={String(row?.personKey || row?.userId)}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setLinkSelectedUser(row)}
                    className={`w-full cursor-pointer rounded-xl border p-3 text-left text-[13px] transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lima-300/50 active:bg-[var(--accent-bg-strong)] active:shadow-none ${
                      selected
                        ? 'border-lima-400 bg-p-positive-bg shadow-p-card'
                        : 'border-p-border-strong bg-p-surface hover:border-lima-300 hover:bg-p-positive-bg hover:shadow-p-card'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-p-text">{String(row?.displayName || `Usuario ${row?.userId || ''}`)}</span>
                        <span className="mt-0.5 block truncate text-p-text-muted">{String(row?.email || row?.phone || '-')}</span>
                        {Array.isArray(row?.badges) && row.badges.length > 0 ? (
                          <span className="mt-1 block text-[11px] text-p-text-muted">{row.badges.join(' · ')}</span>
                        ) : null}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 bg-p-surface transition-colors ${
                          selected ? 'border-p-accent' : 'border-p-border-strong'
                        }`}
                      >
                        <span className={`h-2 w-2 rounded-full transition-colors ${selected ? 'bg-p-accent' : 'bg-transparent'}`} />
                      </span>
                    </span>
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
        title="Unir clientes repetidos"
        message={
          <div className="space-y-4">
            {mergeError ? <AdminFeedbackBanner tone="error" compact>{mergeError}</AdminFeedbackBanner> : null}
            <p className="text-[14px] text-p-text-secondary">
              Las reservas, cuentas y pagos de{' '}
              <span className="font-semibold text-p-text">{selectedClient ? getClientName(selectedClient) : 'este cliente'}</span>{' '}
              pasan al cliente que elijas, y este deja de aparecer. No se puede deshacer.
            </p>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-p-text">¿Con quién lo unís?</span>
              <input
                type="text"
                value={mergeSearchTerm}
                onChange={(event) => {
                  setMergeSearchTerm(event.target.value);
                  setMergeError('');
                }}
                className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-accent"
                placeholder="Buscá por nombre, teléfono o DNI"
              />
            </label>
            <div className="max-h-64 space-y-2 overflow-auto">
              {mergeSearchLoading ? <p className="text-[12px] text-p-text-muted">Buscando...</p> : null}
              {!mergeSearchLoading && mergeSearchTerm.trim().length >= 2 && mergeSearchResults.length === 0 ? (
                <p className="text-[12px] text-p-text-muted">No encontramos a nadie con ese dato.</p>
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
              <span className="mb-1.5 block text-[13px] font-medium text-p-text">
                Nota <span className="font-normal text-p-text-muted">(opcional)</span>
              </span>
              <textarea
                value={mergeNotes}
                onChange={(event) => setMergeNotes(event.target.value)}
                rows={2}
                className="w-full rounded-xl border border-p-border bg-p-surface px-3 py-2 text-[13px] text-p-text outline-none focus:border-p-border-strong"
                placeholder="Ej: mismo DNI, se cargó dos veces"
              />
            </label>
          </div>
        }
        confirmText={
          mergeBusy
            ? 'Uniendo...'
            : mergeSelectedTarget?.id
              ? `Unir con ${String(mergeSelectedTarget?.name || 'este cliente')}`
              : 'Elegí con quién'
        }
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
      <AdminAppModal
        show={identityIncidentModalOpen}
        onClose={() => {
          if (identityIncidentBusy) return;
          setIdentityIncidentModalOpen(false);
          setIdentityIncidentError('');
        }}
        title="Marcar caso para revisión"
        confirmText={identityIncidentBusy ? 'Guardando...' : 'Enviar a Incidentes'}
        confirmDisabled={identityIncidentBusy}
        onConfirm={() => {
          void createIdentityIncident();
        }}
        message={
          <div className="space-y-4">
            {identityIncidentError ? <AdminFeedbackBanner tone="error" compact>{identityIncidentError}</AdminFeedbackBanner> : null}
            <div className="rounded-xl border border-p-border bg-p-surface-2 p-3 text-[13px] text-p-text-secondary">
              <p><span className="font-semibold text-p-text">Cliente:</span> {selectedClient ? getClientName(selectedClient) : '-'}</p>
              <p className="mt-1"><span className="font-semibold text-p-text">Resumen:</span> {identityOverview?.summary || 'Sin diagnóstico actual'}</p>
            </div>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-p-text-secondary">Nota interna (opcional)</span>
              <textarea
                value={identityIncidentNote}
                onChange={(event) => setIdentityIncidentNote(event.target.value)}
                rows={3}
                className="w-full rounded-xl border border-p-border bg-p-surface px-3 py-2 text-[13px] text-p-text outline-none focus:border-p-accent"
                placeholder="Qué te llamó la atención o por qué querés dejarlo en bandeja"
              />
            </label>
          </div>
        }
      />
    </>
  );
}
