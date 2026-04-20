import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CreditCard,
  DollarSign,
  X,
  FileText,
  MessageSquare,
  Pencil,
  Plus,
  Receipt,
  Search,
  Settings,
  ShoppingBag,
  Trash2,
  Trophy,
  Users,
} from 'lucide-react';
import NotFound from '../../components/NotFound';
import RouteTransitionScreen from '../../components/RouteTransitionScreen';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { getPendingLogoutRedirect } from '../../services/AuthService';
import { ClientService } from '../../services/ClientService';
import { ClubAdminService } from '../../services/ClubAdminService';
import { type PaymentChannel, type PaymentMethod, getAccountById, registerPayment } from '../../services/AccountService';
import { formatDateTime24 } from '../../utils/dateTime';
import { getActiveClubSlug, hasAdminAccess, normalizeSessionUser } from '../../utils/session';
import { reportUiError } from '../../utils/uiError';
import {
  buildCanonicalPhone,
  DEFAULT_PHONE_COUNTRY_ISO2,
  normalizePhoneCountryIso2,
  PHONE_COUNTRY_OPTIONS,
  splitCanonicalPhone,
} from '../../utils/phone';

type ClientsView = 'directory' | 'debt' | 'history';
type ClientScope = 'all' | 'debt_open';
type ClientActionSidebarView = 'none' | 'client_create' | 'client_edit' | 'client_profile' | 'client_delete' | 'debt_detail' | 'debt_pay';

type PendingAccountItem = {
  id: string;
  type: string;
  description: string;
  quantity: number;
  total: number;
  paid: number;
  remaining: number;
};

type PendingAccountBreakdown = {
  total: number;
  paid: number;
  remaining: number;
  items: PendingAccountItem[];
  bookingPendingItems: PendingAccountItem[];
  consumptionPendingItems: PendingAccountItem[];
  courtPending: number;
  consumptionPending: number;
  totalPending: number;
};

type ItemSplit = {
  paying: number;
  total: number;
};

type PaymentTransferChannel = Extract<PaymentChannel, 'BANK_ACCOUNT' | 'VIRTUAL_WALLET'>;
type PayConceptView = 'all' | 'booking' | 'consumption' | 'selected';

const EPSILON = 0.009;

const sidebarItems = [
  { label: 'Calendario', icon: CalendarDays },
  { label: 'Clientes', icon: Users, active: true },
  { label: 'Pagos', icon: CreditCard },
  { label: 'Reservas', icon: Receipt },
  { label: 'Partidos', icon: Trophy },
  { label: 'Tienda', icon: ShoppingBag },
  { label: 'Chats', icon: MessageSquare },
  { label: 'Facturacion', icon: FileText },
  { label: 'Ajustes', icon: Settings },
];

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

const buildPendingBreakdown = (detail: any): PendingAccountBreakdown => {
  const items = Array.isArray(detail?.items) ? detail.items : [];
  const payments = Array.isArray(detail?.payments) ? detail.payments : [];

  const allocatedByItem = new Map<string, number>();
  for (const paymentEntry of payments) {
    const allocations = Array.isArray(paymentEntry?.allocations) ? paymentEntry.allocations : [];
    for (const allocation of allocations) {
      const itemId = String(allocation?.accountItemId || '').trim();
      if (!itemId) continue;
      const prev = Number(allocatedByItem.get(itemId) || 0);
      allocatedByItem.set(itemId, Number((prev + Number(allocation?.amount || 0)).toFixed(2)));
    }
  }

  const normalizedItems: PendingAccountItem[] = items.map((item: any) => {
    const id = String(item?.id || '');
    const total = Number(item?.total || 0);
    const paid = Math.max(0, Number(allocatedByItem.get(id) || 0));
    const remaining = Math.max(0, Number((total - paid).toFixed(2)));
    return {
      id,
      type: String(item?.type || 'OTHER'),
      description: String(item?.description || 'Concepto'),
      quantity: Math.max(1, Number(item?.quantity || 1)),
      total,
      paid: Number(paid.toFixed(2)),
      remaining,
    };
  });

  const bookingPendingItems = normalizedItems.filter((item) => item.type === 'BOOKING' && item.remaining > EPSILON);
  const consumptionPendingItems = normalizedItems.filter((item) => item.type !== 'BOOKING' && item.remaining > EPSILON);
  const courtPending = Number(bookingPendingItems.reduce((sum, item) => sum + item.remaining, 0).toFixed(2));
  const consumptionPending = Number(consumptionPendingItems.reduce((sum, item) => sum + item.remaining, 0).toFixed(2));
  const totalPending = Number((courtPending + consumptionPending).toFixed(2));

  return {
    total: Number(detail?.total || 0),
    paid: Number(detail?.paid || 0),
    remaining: Number(detail?.remaining || 0),
    items: normalizedItems,
    bookingPendingItems,
    consumptionPendingItems,
    courtPending,
    consumptionPending,
    totalPending,
  };
};

const buildAutoPaymentAllocations = (targetAmount: number, breakdown: PendingAccountBreakdown | null | undefined) => {
  const result: Record<string, number> = {};
  if (!breakdown) return result;

  let remaining = roundMoney(targetAmount);
  const orderedItems = [...(breakdown.bookingPendingItems || []), ...(breakdown.consumptionPendingItems || [])];

  for (const item of orderedItems) {
    if (remaining <= EPSILON) break;
    const allocation = roundMoney(Math.min(Number(item.remaining || 0), remaining));
    result[String(item.id)] = allocation;
    remaining = roundMoney(remaining - allocation);
  }

  return result;
};

const getClientName = (client: any) => String(client?.name || '').trim() || 'Sin nombre';

const buildConsumptionQuickUnits = (quantity: number) => {
  const normalized = Math.max(1, Math.trunc(Number(quantity) || 1));
  if (normalized === 1) return [1];
  if (normalized === 2) return [1, 2];
  return [1, 2, normalized];
};

export default function AdminClientesPlaygroundPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });

  const [activeView, setActiveView] = useState<ClientsView>('directory');
  const [scope, setScope] = useState<ClientScope>('all');
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
  const [clientForm, setClientForm] = useState({
    name: '',
    phoneCountryIso2: DEFAULT_PHONE_COUNTRY_ISO2,
    phone: '',
    dni: '',
    email: '',
    isProfessor: false,
  });

  const [deletingClient, setDeletingClient] = useState(false);

  const [paying, setPaying] = useState(false);
  const [debtTargetAccountId, setDebtTargetAccountId] = useState('');
  const [payAmount, setPayAmount] = useState('0');
  const [splitTotalParticipants, setSplitTotalParticipants] = useState(4);
  const [itemSplitById, setItemSplitById] = useState<Record<string, ItemSplit>>({});
  const [payItemAllocations, setPayItemAllocations] = useState<Record<string, number>>({});
  const [payConceptView, setPayConceptView] = useState<PayConceptView>('all');
  const [consumptionSearchTerm, setConsumptionSearchTerm] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('CASH');
  const [transferChannel, setTransferChannel] = useState<PaymentTransferChannel>('BANK_ACCOUNT');
  const [accountBreakdownById, setAccountBreakdownById] = useState<Record<string, PendingAccountBreakdown>>({});
  const [loadingAccountById, setLoadingAccountById] = useState<Record<string, boolean>>({});

  const [selectedClientDiscountAssignments, setSelectedClientDiscountAssignments] = useState<any[]>([]);
  const [loadingDiscountAssignments, setLoadingDiscountAssignments] = useState(false);

  const resolveClubSlug = useCallback(() => {
    try {
      if (typeof window === 'undefined') return '';
      const raw = localStorage.getItem('user');
      if (!raw) return '';
      const normalized = normalizeSessionUser(JSON.parse(raw));
      return getActiveClubSlug(normalized) || '';
    } catch {
      return '';
    }
  }, []);

  useEffect(() => {
    if (!authChecked || user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/admin/clientes-playground')}`);
  }, [authChecked, user, router]);

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

  useEffect(() => {
    if (activeView === 'debt') setScope('debt_open');
    else setScope('all');
  }, [activeView]);

  const loadClients = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage('');
      const slug = resolveClubSlug() || undefined;
      const rows = await ClientService.listDebtors(slug, { scope });
      const normalized = Array.isArray(rows) ? rows : [];
      setClients(normalized);

      if (normalized.length > 0) {
        setSelectedClientId((prev) => {
          if (prev && normalized.some((client) => String(client.id) === prev)) return prev;
          return String(normalized[0].id);
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
  }, [resolveClubSlug, scope]);

  useEffect(() => {
    if (!authChecked || !user || !hasAdminAccess(user)) return;
    void loadClients();
  }, [authChecked, user, loadClients]);

  const clientsWithOpenDebt = useMemo(
    () => clients.filter((client) => Number(client?.totalDebt || 0) > EPSILON),
    [clients]
  );

  const filteredClients = useMemo(() => {
    const source = activeView === 'debt' ? clientsWithOpenDebt : clients;
    const q = searchTerm.trim().toLowerCase();
    if (!q) return source;
    return source.filter((client) => {
      const name = getClientName(client).toLowerCase();
      const phone = String(client?.phone || '').toLowerCase();
      const dni = String(client?.dni || '').toLowerCase();
      const email = String(client?.email || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || dni.includes(q) || email.includes(q);
    });
  }, [activeView, clients, clientsWithOpenDebt, searchTerm]);

  useEffect(() => {
    if (activeView !== 'debt') return;
    if (filteredClients.length === 0) {
      setSelectedClientId('');
      return;
    }
    const selectedStillValid = filteredClients.some((client) => String(client.id) === String(selectedClientId));
    if (!selectedStillValid) {
      setSelectedClientId(String(filteredClients[0].id));
    }
  }, [activeView, filteredClients, selectedClientId]);

  const selectedClient = useMemo(
    () => clients.find((client) => String(client.id) === String(selectedClientId)) || null,
    [clients, selectedClientId]
  );

  const totalClients = clients.length;
  const totalDebt = clients.reduce((sum, client) => sum + Number(client?.totalDebt || 0), 0);
  const topClient = clients.reduce(
    (best, current) => (Number(best?.totalBookings || 0) > Number(current?.totalBookings || 0) ? best : current),
    { name: '-', totalBookings: 0 }
  );

  const openCreateClient = () => {
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

  const submitClient = async () => {
    const slug = resolveClubSlug();
    if (!slug) {
      setErrorMessage('No se pudo resolver el club activo.');
      return;
    }

    const name = String(clientForm.name || '').trim();
    const phoneLocal = String(clientForm.phone || '').trim();
    const canonicalPhone = buildCanonicalPhone({
      countryIso2: clientForm.phoneCountryIso2 || clubPhoneCountryIso2,
      localNumber: phoneLocal,
    });
    const dni = String(clientForm.dni || '').trim();
    const email = String(clientForm.email || '').trim();

    if (name.length < 2) {
      setErrorMessage('Ingresa un nombre valido.');
      return;
    }
    if (phoneLocal.length > 0 && !canonicalPhone) {
      setErrorMessage('Si cargas telefono, debe ser valido.');
      return;
    }
    if (dni.length > 0 && dni.length < 6) {
      setErrorMessage('Si cargas DNI, debe tener al menos 6 digitos.');
      return;
    }

    try {
      setSubmittingClient(true);
      setErrorMessage('');
      const payload = {
        name,
        phone: canonicalPhone || undefined,
        phoneCountryCode: clientForm.phoneCountryIso2 || undefined,
        phoneNumberLocal: phoneLocal || undefined,
        dni: dni || undefined,
        email: email || undefined,
        isProfessor: Boolean(clientForm.isProfessor),
      };

      if (editingClientId) {
        await ClientService.updateByClubSlug(slug, editingClientId, payload);
        setSuccessMessage('Cliente actualizado correctamente.');
      } else {
        await ClientService.createByClubSlug(slug, payload);
        setSuccessMessage('Cliente creado correctamente.');
      }

      setSidebarView('none');
      const updated = await loadClients();
      if (editingClientId) {
        const found = updated.find((client: any) => String(client.id) === editingClientId);
        if (found) setSelectedClientId(String(found.id));
      }
    } catch (error: any) {
      reportUiError({ area: 'ClientesPlayground', action: 'submitClient' }, error);
      setErrorMessage(String(error?.message || 'No se pudo guardar el cliente.'));
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

  const ensureAccountBreakdown = useCallback(
    async (accountId: string, forceRefresh = false) => {
      const key = String(accountId || '').trim();
      if (!key) return null;
      if (!forceRefresh && accountBreakdownById[key]) return accountBreakdownById[key];
      if (loadingAccountById[key]) return null;

      try {
        setLoadingAccountById((prev) => ({ ...prev, [key]: true }));
        const detail = await getAccountById(key);
        const breakdown = buildPendingBreakdown(detail);
        setAccountBreakdownById((prev) => ({ ...prev, [key]: breakdown }));
        return breakdown;
      } catch (error) {
        reportUiError({ area: 'ClientesPlayground', action: 'ensureAccountBreakdown' }, error);
        return null;
      } finally {
        setLoadingAccountById((prev) => ({ ...prev, [key]: false }));
      }
    },
    [accountBreakdownById, loadingAccountById]
  );

  const selectedDebtorPendingEntries = useMemo(() => {
    if (!selectedClient) return [];
    return (Array.isArray(selectedClient.history) ? selectedClient.history : [])
      .slice()
      .sort(sortByCreationDesc)
      .filter((entry: any) => Number(entry?.amount || 0) > EPSILON);
  }, [selectedClient]);

  const selectedDebtEntry = useMemo(
    () => selectedDebtorPendingEntries.find((entry: any) => String(entry?.id) === String(debtTargetAccountId)) || null,
    [selectedDebtorPendingEntries, debtTargetAccountId]
  );

  const selectedDebtBreakdown = selectedDebtEntry ? accountBreakdownById[String(selectedDebtEntry.id)] : null;

  const selectedDebtTotalPending = useMemo(() => {
    if (selectedDebtBreakdown) return Number(selectedDebtBreakdown.totalPending || 0);
    return Number(selectedDebtEntry?.amount || 0);
  }, [selectedDebtBreakdown, selectedDebtEntry]);

  const openDebtDetail = async (accountId: string) => {
    setDebtTargetAccountId(accountId);
    await ensureAccountBreakdown(accountId, true);
    setSidebarView('debt_detail');
  };

  const openPaySidebar = async (accountId: string) => {
    setDebtTargetAccountId(accountId);
    const breakdown = await ensureAccountBreakdown(accountId, true);
    const fallbackEntry = selectedDebtorPendingEntries.find((entry: any) => String(entry?.id) === String(accountId));
    const total = breakdown ? Number(breakdown.totalPending || 0) : Number(fallbackEntry?.amount || 0);
    const normalizedTotal = roundMoney(Math.max(0, total));
    setPayAmount(String(normalizedTotal.toFixed(2)));
    setSplitTotalParticipants(4);
    setItemSplitById({});
    setPayItemAllocations(buildAutoPaymentAllocations(normalizedTotal, breakdown));
    setPayConceptView('all');
    setConsumptionSearchTerm('');
    setPayMethod('CASH');
    setTransferChannel('BANK_ACCOUNT');
    setSidebarView('debt_pay');
  };

  const recalculatePayAmountFromAllocations = (allocations: Record<string, number>) => {
    const total = roundMoney(Object.values(allocations).reduce((sum, value) => sum + Number(value || 0), 0));
    setPayAmount(String(total.toFixed(2)));
  };

  const applyItemSplitAmount = (
    itemId: string,
    itemTotal: number,
    itemRemaining: number,
    payingCount: number,
    totalCount: number = splitTotalParticipants
  ) => {
    const normalizedTotal = Math.max(1, Math.trunc(Number(totalCount) || 1));
    const normalizedPaying = Math.max(1, Math.min(normalizedTotal, Math.trunc(Number(payingCount) || 1)));
    const splitFromOriginalTotal = roundMoney(Math.max(0, Number(itemTotal || 0)) * (normalizedPaying / normalizedTotal));
    const target = roundMoney(Math.min(Math.max(0, Number(itemRemaining || 0)), splitFromOriginalTotal));

    setItemSplitById((prev) => ({
      ...prev,
      [String(itemId)]: {
        paying: normalizedPaying,
        total: normalizedTotal,
      },
    }));

    setPayItemAllocations((prev) => {
      const next = { ...prev, [String(itemId)]: target };
      recalculatePayAmountFromAllocations(next);
      return next;
    });
  };

  const applyConsumptionUnitsAmount = (
    itemId: string,
    itemRemaining: number,
    itemQuantity: number,
    unitsToCharge: number
  ) => {
    const normalizedQuantity = Math.max(1, Math.trunc(Number(itemQuantity) || 1));
    const normalizedUnits = Math.max(0, Math.min(normalizedQuantity, Math.trunc(Number(unitsToCharge) || 0)));
    const unitAmount = Number(itemRemaining || 0) / normalizedQuantity;
    const target = roundMoney(Math.max(0, unitAmount * normalizedUnits));

    setPayItemAllocations((prev) => {
      const next = { ...prev, [String(itemId)]: target };
      recalculatePayAmountFromAllocations(next);
      return next;
    });
  };

  const skipItemForNow = (itemId: string) => {
    const totalParticipants = Math.max(1, Math.trunc(Number(splitTotalParticipants) || 1));
    setItemSplitById((prev) => ({
      ...prev,
      [String(itemId)]: {
        paying: 0,
        total: totalParticipants,
      },
    }));
    setPayItemAllocations((prev) => {
      const next = { ...prev, [String(itemId)]: 0 };
      recalculatePayAmountFromAllocations(next);
      return next;
    });
  };

  const updateItemAllocation = (itemId: string, maxRemaining: number, rawAmount: string) => {
    const parsed = Number(rawAmount || 0);
    const bounded = Number.isFinite(parsed)
      ? roundMoney(Math.min(Math.max(0, parsed), Math.max(0, Number(maxRemaining || 0))))
      : 0;

    setPayItemAllocations((prev) => {
      const next = { ...prev, [String(itemId)]: bounded };
      recalculatePayAmountFromAllocations(next);
      return next;
    });
  };

  const applyAllConsumptionAllocations = (mode: 'skip' | 'full') => {
    if (!selectedDebtBreakdown) return;
    const q = consumptionSearchTerm.trim().toLowerCase();
    const targetItems = selectedDebtBreakdown.consumptionPendingItems.filter((item) => {
      if (!q) return true;
      return String(item.description || '').toLowerCase().includes(q);
    });

    setPayItemAllocations((prev) => {
      const next = { ...prev };
      for (const item of targetItems) {
        next[String(item.id)] = mode === 'skip' ? 0 : roundMoney(Number(item.remaining || 0));
      }
      recalculatePayAmountFromAllocations(next);
      return next;
    });
  };

  const toggleConsumptionSelection = (item: PendingAccountItem, checked: boolean) => {
    const target = checked ? roundMoney(Number(item.remaining || 0)) : 0;
    updateItemAllocation(String(item.id), Number(item.remaining || 0), String(target));
  };

  const isItemSkipped = (itemId: string) => roundMoney(Number(payItemAllocations[String(itemId)] || 0)) <= EPSILON;

  const isBookingPresetActive = (itemId: string, payingCount: number) => {
    const split = itemSplitById[String(itemId)];
    if (!split) return false;
    if (payingCount === splitTotalParticipants) {
      return split.total === splitTotalParticipants && split.paying === splitTotalParticipants;
    }
    return split.total === splitTotalParticipants && split.paying === payingCount;
  };

  const isBookingFullActive = (item: PendingAccountItem) => {
    const allocated = roundMoney(Number(payItemAllocations[String(item.id)] || 0));
    return Math.abs(allocated - roundMoney(Number(item.remaining || 0))) <= EPSILON;
  };

  const isConsumptionUnitsPresetActive = (item: PendingAccountItem, units: number) => {
    const allocated = roundMoney(Number(payItemAllocations[String(item.id)] || 0));
    const normalizedQuantity = Math.max(1, Math.trunc(Number(item.quantity) || 1));
    const normalizedUnits = Math.max(0, Math.min(normalizedQuantity, Math.trunc(Number(units) || 0)));
    const expected = roundMoney(Number(item.remaining || 0) * (normalizedUnits / normalizedQuantity));
    return Math.abs(allocated - expected) <= EPSILON;
  };

  const processDebtPayment = async () => {
    if (!selectedDebtEntry) return;

    try {
      const amount = Number(payAmount || 0);
      if (!Number.isFinite(amount) || amount <= EPSILON) {
        setErrorMessage('Ingresa un monto de cobro valido.');
        return;
      }

      const debtTotal = Math.max(0, Number(selectedDebtTotalPending || 0));
      if (amount - debtTotal > EPSILON) {
        setErrorMessage('El monto no puede superar el saldo pendiente.');
        return;
      }

      if (payMethod === 'TRANSFER' && !transferChannel) {
        setErrorMessage('Selecciona el canal para la transferencia.');
        return;
      }

      setPaying(true);
      setErrorMessage('');
      const breakdown = accountBreakdownById[String(selectedDebtEntry.id)];
      const allocations: Array<{ accountItemId: string; amount: number }> = [];
      if (breakdown) {
        const allPendingItems = [...breakdown.bookingPendingItems, ...breakdown.consumptionPendingItems];
        const zeroAllocationItems = allPendingItems.filter(
          (item) => Number(item.remaining || 0) > EPSILON && roundMoney(Number(payItemAllocations[String(item.id)] || 0)) <= EPSILON
        );

        if (zeroAllocationItems.length > 0) {
          const confirmSkip = window.confirm(
            `Hay ${zeroAllocationItems.length} concepto(s) pendiente(s) marcado(s) en $0 para esta operacion. ¿Confirmas continuar?`
          );
          if (!confirmSkip) {
            return;
          }
        }

        for (const item of allPendingItems) {
          const requested = roundMoney(Number(payItemAllocations[String(item.id)] || 0));
          const allocationAmount = roundMoney(Math.min(Number(item.remaining || 0), requested));
          if (allocationAmount > EPSILON) {
            allocations.push({
              accountItemId: String(item.id),
              amount: allocationAmount,
            });
          }
        }

        const allocatedTotal = roundMoney(allocations.reduce((sum, entry) => sum + Number(entry.amount || 0), 0));
        if (Math.abs(allocatedTotal - Number(amount.toFixed(2))) > EPSILON) {
          setErrorMessage('La suma por concepto debe coincidir con el monto final a cobrar.');
          setPaying(false);
          return;
        }
      } else {
        let remainingToAllocate = Number(amount.toFixed(2));
        for (const item of breakdown?.bookingPendingItems || []) {
          if (remainingToAllocate <= EPSILON) break;
          const allocationAmount = Math.min(item.remaining, remainingToAllocate);
          if (allocationAmount > EPSILON) {
            allocations.push({
              accountItemId: String(item.id),
              amount: Number(allocationAmount.toFixed(2)),
            });
            remainingToAllocate = Number((remainingToAllocate - allocationAmount).toFixed(2));
          }
        }

        for (const item of breakdown?.consumptionPendingItems || []) {
          if (remainingToAllocate <= EPSILON) break;
          const allocationAmount = Math.min(item.remaining, remainingToAllocate);
          if (allocationAmount > EPSILON) {
            allocations.push({
              accountItemId: String(item.id),
              amount: Number(allocationAmount.toFixed(2)),
            });
            remainingToAllocate = Number((remainingToAllocate - allocationAmount).toFixed(2));
          }
        }
      }

      await registerPayment({
        accountId: String(selectedDebtEntry.id),
        amount: Number(amount.toFixed(2)),
        method: payMethod,
        channel: payMethod === 'TRANSFER' ? transferChannel : undefined,
        allocations: allocations.length > 0 ? allocations : undefined,
      });

      setSidebarView('none');
      setDebtTargetAccountId('');
      setPayAmount('0');
      setItemSplitById({});
      setPayItemAllocations({});
      setSuccessMessage('Pago registrado correctamente.');
      const updated = await loadClients();
      const stillExists = updated.find((client: any) => String(client.id) === String(selectedClientId));
      if (!stillExists && updated.length > 0) setSelectedClientId(String(updated[0].id));

      setAccountBreakdownById((prev) => {
        const next = { ...prev };
        delete next[String(selectedDebtEntry.id)];
        return next;
      });
    } catch (error: any) {
      reportUiError({ area: 'ClientesPlayground', action: 'processDebtPayment' }, error);
      setErrorMessage(String(error?.message || 'No se pudo registrar el pago.'));
    } finally {
      setPaying(false);
    }
  };

  const payAllocationsPreview = useMemo(() => {
    if (!selectedDebtBreakdown) {
      return { booking: 0, consumption: 0, unallocated: 0 };
    }
    const booking = roundMoney(
      selectedDebtBreakdown.bookingPendingItems.reduce(
        (sum, item) => sum + Number(payItemAllocations[String(item.id)] || 0),
        0
      )
    );
    const consumption = roundMoney(
      selectedDebtBreakdown.consumptionPendingItems.reduce(
        (sum, item) => sum + Number(payItemAllocations[String(item.id)] || 0),
        0
      )
    );
    const selectedTotal = roundMoney(booking + consumption);
    const unallocated = roundMoney(Math.max(0, Number(selectedDebtTotalPending || 0) - selectedTotal));
    return { booking, consumption, unallocated };
  }, [payItemAllocations, selectedDebtBreakdown, selectedDebtTotalPending]);

  const currentPayAmount = roundMoney(Number(payAmount || 0));

  const filteredConsumptionItems = useMemo(() => {
    const base = selectedDebtBreakdown?.consumptionPendingItems || [];
    const q = consumptionSearchTerm.trim().toLowerCase();
    if (!q) return base;
    return base.filter((item) => String(item.description || '').toLowerCase().includes(q));
  }, [selectedDebtBreakdown, consumptionSearchTerm]);

  const payItemsForList = useMemo(() => {
    if (!selectedDebtBreakdown) return [] as PendingAccountItem[];
    const bookingItems = selectedDebtBreakdown.bookingPendingItems;
    const consumptionItems = filteredConsumptionItems;
    if (payConceptView === 'booking') return bookingItems;
    if (payConceptView === 'consumption') return consumptionItems;
    if (payConceptView === 'selected') {
      return [...bookingItems, ...consumptionItems].filter(
        (item) => roundMoney(Number(payItemAllocations[String(item.id)] || 0)) > EPSILON
      );
    }
    return [...bookingItems, ...consumptionItems];
  }, [selectedDebtBreakdown, filteredConsumptionItems, payConceptView, payItemAllocations]);

  const bookingItemsForList = useMemo(
    () => payItemsForList.filter((item) => item.type === 'BOOKING'),
    [payItemsForList]
  );

  const consumptionItemsForList = useMemo(
    () => payItemsForList.filter((item) => item.type !== 'BOOKING'),
    [payItemsForList]
  );

  const sidebarOpen = sidebarView !== 'none';
  const isClientFormView = sidebarView === 'client_create' || sidebarView === 'client_edit';
  const isDebtDetailView = sidebarView === 'debt_detail';
  const isDebtPayView = sidebarView === 'debt_pay';
  const isDebtView = isDebtDetailView || isDebtPayView;
  const debtLoading = Boolean(debtTargetAccountId && loadingAccountById[String(debtTargetAccountId)]);

  const closeActionSidebar = useCallback(() => {
    if (deletingClient || paying || submittingClient) return;
    setSidebarView('none');
    setDebtTargetAccountId('');
    setPayItemAllocations({});
  }, [deletingClient, paying, submittingClient]);

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

  if (!authChecked || !user) {
    return <RouteTransitionScreen message={authChecked ? 'Redirigiendo...' : 'Validando acceso...'} />;
  }

  if (!hasAdminAccess(user)) {
    return <NotFound message="No tenes permiso para acceder al panel de administracion." />;
  }

  return (
    <>
      <Head>
        <title>Clientes Playground | TuCancha Admin</title>
      </Head>

      <div className="h-screen w-full overflow-hidden bg-[radial-gradient(circle_at_top_left,#edf6ff_0%,#f6f8fb_48%,#f2f4f8_100%)] text-[#1a1a1a]">
        <div className="flex h-full w-full">
          <aside className="hidden h-full w-[110px] flex-col items-center border-r border-[#e5e7eb] bg-white py-6 lg:flex">
            <div className="mb-8 text-[11px] font-bold tracking-[0.22em] text-[#2a2f5b]">TUCANCHA</div>
            <nav className="w-full space-y-1 px-2">
              {sidebarItems.map(({ label, icon: Icon, active }) => (
                <button
                  key={label}
                  type="button"
                  className={`w-full rounded-xl px-3 py-2 text-left text-[11px] transition ${
                    active ? 'bg-[#eef1ff] text-[#2b3fa8]' : 'text-[#8b92a0] hover:bg-[#f4f5f7]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon size={14} />
                    <span className="truncate">{label}</span>
                  </span>
                </button>
              ))}
            </nav>
          </aside>

          <section className={`min-w-0 flex-1 transition ${sidebarOpen ? 'pointer-events-none select-none opacity-80' : 'opacity-100'}`}>
            <div className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6">
              <header className="rounded-2xl border border-[#dce3ef] bg-white/90 px-4 py-3 shadow-[0_8px_28px_rgba(27,39,94,0.06)] backdrop-blur">
                <div className="flex flex-wrap items-center gap-3 md:gap-4">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#1f4ed8] text-white shadow-[0_10px_24px_rgba(31,78,216,0.35)]">
                    <Users size={18} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <h1 className="truncate text-base font-semibold text-[#1f2937]">Clientes Playground</h1>
                    <p className="text-xs text-[#64748b]">Estructura nueva sin dependencia de la UI legacy, con funcionalidades existentes.</p>
                  </div>

                  <div className="flex items-center gap-1 rounded-xl border border-[#dbe2ee] bg-white p-1">
                    <button
                      type="button"
                      onClick={() => setActiveView('directory')}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        activeView === 'directory' ? 'bg-[#eef2ff] text-[#1f4ed8]' : 'text-[#64748b] hover:bg-[#f8fafc]'
                      }`}
                    >
                      Directorio
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveView('debt')}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        activeView === 'debt' ? 'bg-[#eef2ff] text-[#1f4ed8]' : 'text-[#64748b] hover:bg-[#f8fafc]'
                      }`}
                    >
                      Cuentas y deuda
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveView('history')}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        activeView === 'history' ? 'bg-[#eef2ff] text-[#1f4ed8]' : 'text-[#64748b] hover:bg-[#f8fafc]'
                      }`}
                    >
                      Perfil e historial
                    </button>
                  </div>
                </div>
              </header>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                <article className="rounded-2xl border border-[#dbe2ee] bg-white p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Total clientes</p>
                  <p className="mt-2 text-lg font-semibold text-[#0f172a]">{totalClients}</p>
                </article>
                <article className="rounded-2xl border border-[#dbe2ee] bg-white p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Cliente mas fiel</p>
                  <p className="mt-2 truncate text-lg font-semibold text-[#0f172a]">{getClientName(topClient)}</p>
                </article>
                <article className="rounded-2xl border border-[#dbe2ee] bg-white p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Deuda total</p>
                  <p className={`mt-2 text-lg font-semibold ${totalDebt > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatMoney(totalDebt)}</p>
                </article>
                <article className="rounded-2xl border border-[#dbe2ee] bg-white p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Alcance</p>
                  <div className="mt-2 inline-flex rounded-xl border border-[#dbe2ee] bg-white p-1">
                    <button
                      type="button"
                      onClick={() => setScope('all')}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                        scope === 'all' ? 'bg-[#eef2ff] text-[#1f4ed8]' : 'text-[#64748b] hover:bg-[#f8fafc]'
                      }`}
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => setScope('debt_open')}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                        scope === 'debt_open' ? 'bg-[#eef2ff] text-[#1f4ed8]' : 'text-[#64748b] hover:bg-[#f8fafc]'
                      }`}
                    >
                      Con deuda
                    </button>
                  </div>
                </article>
              </div>

              {(errorMessage || successMessage) && (
                <div className="space-y-2">
                  {successMessage && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{successMessage}</div>}
                  {errorMessage && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{errorMessage}</div>}
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-auto">
                {activeView === 'directory' && (
                  <div className="grid min-h-full grid-cols-1 gap-4">
                    <article className="rounded-2xl border border-[#dbe2ee] bg-white p-4">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <label className="relative w-full max-w-[320px]">
                          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
                          <input
                            type="text"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            placeholder="Buscar por nombre, dni, email o telefono"
                            className="h-10 w-full rounded-xl border border-[#dbe2ee] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#1f4ed8]"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={openCreateClient}
                          className="h-10 rounded-xl bg-[#1f4ed8] px-3 text-sm font-semibold text-white transition hover:bg-[#1e40af]"
                        >
                          <span className="inline-flex items-center gap-1"><Plus size={14} /> Nuevo cliente</span>
                        </button>
                      </div>

                      <div className="max-h-[66vh] overflow-auto rounded-xl border border-[#e6ebf2]">
                        {loading ? (
                          <div className="p-8 text-center text-sm text-[#64748b]">Cargando clientes...</div>
                        ) : filteredClients.length === 0 ? (
                          <div className="p-8 text-center text-sm text-[#64748b]">No hay clientes para mostrar.</div>
                        ) : (
                          <table className="w-full min-w-[760px] text-sm">
                            <thead className="sticky top-0 bg-[#f8fafc] text-xs uppercase tracking-wide text-[#64748b]">
                              <tr>
                                <th className="px-3 py-2 text-left">Cliente</th>
                                <th className="px-3 py-2 text-left">DNI</th>
                                <th className="px-3 py-2 text-left">Contacto</th>
                                <th className="px-3 py-2 text-left">Reservas</th>
                                <th className="px-3 py-2 text-left">Deuda</th>
                                <th className="px-3 py-2 text-right">Acciones</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredClients.map((client) => (
                                <tr key={String(client.id)} className="border-t border-[#eef2f7] hover:bg-[#f8fbff]">
                                  <td className="px-3 py-2 font-semibold text-[#0f172a]">{getClientName(client)}</td>
                                  <td className="px-3 py-2 text-[#475569]">{String(client.dni || '-')}</td>
                                  <td className="px-3 py-2 text-[#475569]">{String(client.phone || client.email || '-')}</td>
                                  <td className="px-3 py-2 text-[#475569]">{Number(client.totalBookings || 0)}</td>
                                  <td className={`px-3 py-2 font-semibold ${Number(client.totalDebt || 0) > EPSILON ? 'text-red-700' : 'text-[#64748b]'}`}>
                                    {Number(client.totalDebt || 0) > EPSILON ? formatMoney(Number(client.totalDebt || 0)) : 'Sin deuda'}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => openClientProfile(client)}
                                        className="h-8 rounded-lg border border-[#dbe2ee] bg-white px-2 text-[11px] font-semibold text-[#334155] hover:bg-[#f8fafc]"
                                      >
                                        Perfil
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openEditClient(client)}
                                        className="grid h-8 w-8 place-items-center rounded-lg border border-[#dbe2ee] bg-white text-[#334155] hover:bg-[#f8fafc]"
                                        title="Editar"
                                      >
                                        <Pencil size={13} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openDeleteClient(client)}
                                        className="grid h-8 w-8 place-items-center rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50"
                                        title="Eliminar"
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </article>
                  </div>
                )}

                {activeView === 'debt' && (
                  <div className="grid min-h-full grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
                    <article className="rounded-2xl border border-[#dbe2ee] bg-white p-4">
                      <h2 className="text-sm font-semibold text-[#1e293b]">Clientes con deuda</h2>
                      <p className="mt-1 text-xs text-[#64748b]">Selecciona un cliente para revisar cuentas pendientes.</p>

                      <div className="mt-3 max-h-[66vh] overflow-auto rounded-xl border border-[#e6ebf2]">
                        {loading ? (
                          <div className="p-6 text-center text-sm text-[#64748b]">Cargando...</div>
                        ) : filteredClients.length === 0 ? (
                          <div className="p-6 text-center text-sm text-[#64748b]">No hay clientes con deuda.</div>
                        ) : (
                          <ul className="divide-y divide-[#eef2f7]">
                            {filteredClients.map((client) => (
                              <li key={String(client.id)}>
                                <button
                                  type="button"
                                  onClick={() => setSelectedClientId(String(client.id))}
                                  className={`w-full px-3 py-3 text-left transition ${
                                    String(selectedClientId) === String(client.id) ? 'bg-[#eef2ff]' : 'hover:bg-[#f8fafc]'
                                  }`}
                                >
                                  <p className="text-sm font-semibold text-[#0f172a]">{getClientName(client)}</p>
                                  <p className="text-xs text-red-700">Pendiente: {formatMoney(Number(client.totalDebt || 0))}</p>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </article>

                    <article className="rounded-2xl border border-[#dbe2ee] bg-white p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-[#1e293b]">Cuentas pendientes</h2>
                        <span className="text-xs text-[#64748b]">{selectedClient ? getClientName(selectedClient) : 'Sin seleccion'}</span>
                      </div>

                      {!selectedClient ? (
                        <div className="rounded-xl border border-[#e6ebf2] p-8 text-center text-sm text-[#64748b]">Selecciona un cliente para ver su deuda.</div>
                      ) : selectedDebtorPendingEntries.length === 0 ? (
                        <div className="rounded-xl border border-[#e6ebf2] p-8 text-center text-sm text-[#64748b]">Este cliente no tiene cuentas pendientes.</div>
                      ) : (
                        <div className="space-y-3 max-h-[66vh] overflow-auto">
                          {selectedDebtorPendingEntries.map((account: any) => (
                            <div key={String(account.id)} className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-sm font-semibold text-[#0f172a]">Cuenta {formatAccountSourceType(account.sourceType)} #{String(account.id)}</p>
                                  <p className="text-xs text-[#64748b]">{formatDate(account.date)} {account.time ? `· ${account.time}` : ''}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-xs text-[#64748b]">Pendiente</p>
                                  <p className="text-sm font-semibold text-red-700">{formatMoney(Number(account.amount || 0))}</p>
                                </div>
                              </div>
                              <div className="mt-2 flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => void openDebtDetail(String(account.id))}
                                  className="h-8 rounded-lg border border-[#dbe2ee] bg-white px-2.5 text-xs font-semibold text-[#334155] hover:bg-[#f8fafc]"
                                >
                                  Ver detalle
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void openPaySidebar(String(account.id))}
                                  className="h-8 rounded-lg bg-[#1f4ed8] px-2.5 text-xs font-semibold text-white hover:bg-[#1e40af]"
                                >
                                  <span className="inline-flex items-center gap-1"><DollarSign size={13} /> Cobrar</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                  </div>
                )}

                {activeView === 'history' && (
                  <div className="grid min-h-full grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
                    <article className="rounded-2xl border border-[#dbe2ee] bg-white p-4">
                      <h2 className="text-sm font-semibold text-[#1e293b]">Clientes</h2>
                      <div className="mt-2 max-h-[66vh] overflow-auto rounded-xl border border-[#e6ebf2]">
                        {loading ? (
                          <div className="p-6 text-center text-sm text-[#64748b]">Cargando...</div>
                        ) : filteredClients.length === 0 ? (
                          <div className="p-6 text-center text-sm text-[#64748b]">Sin clientes.</div>
                        ) : (
                          <ul className="divide-y divide-[#eef2f7]">
                            {filteredClients.map((client) => (
                              <li key={String(client.id)}>
                                <button
                                  type="button"
                                  onClick={() => setSelectedClientId(String(client.id))}
                                  className={`w-full px-3 py-3 text-left transition ${
                                    String(selectedClientId) === String(client.id) ? 'bg-[#eef2ff]' : 'hover:bg-[#f8fafc]'
                                  }`}
                                >
                                  <p className="text-sm font-semibold text-[#0f172a]">{getClientName(client)}</p>
                                  <p className="text-xs text-[#64748b]">{String(client.phone || client.email || '-')}</p>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </article>

                    <article className="rounded-2xl border border-[#dbe2ee] bg-white p-4">
                      {!selectedClient ? (
                        <div className="rounded-xl border border-[#e6ebf2] p-8 text-center text-sm text-[#64748b]">Selecciona un cliente para ver su perfil.</div>
                      ) : (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] p-3">
                              <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Cliente</p>
                              <p className="mt-1 text-sm font-semibold text-[#0f172a]">{getClientName(selectedClient)}</p>
                            </div>
                            <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] p-3">
                              <p className="text-[10px] uppercase tracking-wide text-[#64748b]">DNI</p>
                              <p className="mt-1 text-sm font-semibold text-[#0f172a]">{String(selectedClient.dni || '-')}</p>
                            </div>
                            <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] p-3">
                              <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Telefono</p>
                              <p className="mt-1 text-sm font-semibold text-[#0f172a]">{String(selectedClient.phone || '-')}</p>
                            </div>
                            <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] p-3">
                              <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Email</p>
                              <p className="mt-1 text-sm font-semibold text-[#0f172a] break-all">{String(selectedClient.email || '-')}</p>
                            </div>
                            <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] p-3">
                              <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Total reservas</p>
                              <p className="mt-1 text-sm font-semibold text-[#0f172a]">{Number(selectedClient.totalBookings || 0)}</p>
                            </div>
                            <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] p-3">
                              <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Saldo actual</p>
                              <p className={`mt-1 text-sm font-semibold ${Number(selectedClient.totalDebt || 0) > EPSILON ? 'text-red-700' : 'text-[#64748b]'}`}>
                                {Number(selectedClient.totalDebt || 0) > EPSILON ? formatMoney(Number(selectedClient.totalDebt || 0)) : 'Sin deuda'}
                              </p>
                            </div>
                          </div>

                          <div className="rounded-xl border border-[#e6ebf2] p-3">
                            <h3 className="text-sm font-semibold text-[#1e293b]">Asignaciones de descuentos</h3>
                            {loadingDiscountAssignments ? (
                              <p className="mt-2 text-xs text-[#64748b]">Cargando asignaciones...</p>
                            ) : selectedClientDiscountAssignments.length === 0 ? (
                              <p className="mt-2 text-xs text-[#64748b]">Sin asignaciones registradas.</p>
                            ) : (
                              <ul className="mt-2 space-y-1">
                                {selectedClientDiscountAssignments.map((assignment: any, index: number) => (
                                  <li key={String(assignment?.id || `${index}`)} className="rounded-lg border border-[#e6ebf2] bg-[#f8fafc] px-2 py-1.5 text-xs text-[#334155]">
                                    {String(assignment?.policy?.name || assignment?.policyName || assignment?.policyId || 'Politica')}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                            <div className="rounded-xl border border-[#e6ebf2] p-3">
                              <h3 className="text-sm font-semibold text-[#1e293b]">Historial de reservas</h3>
                              <div className="mt-2 max-h-[280px] overflow-auto">
                                {historyBookings.length === 0 ? (
                                  <p className="text-xs text-[#64748b]">Sin reservas registradas.</p>
                                ) : (
                                  <ul className="space-y-2">
                                    {historyBookings.map((booking: any) => (
                                      <li key={String(booking.bookingId)} className="rounded-lg border border-[#e6ebf2] bg-[#f8fafc] px-3 py-2">
                                        <p className="text-xs font-semibold text-[#0f172a]">Reserva #{booking.bookingId}</p>
                                        <p className="text-xs text-[#64748b]">{formatDate(booking.date)}{booking.time ? ` · ${booking.time}` : ''} · {booking.courtName || '-'}</p>
                                        <p className="text-xs text-[#475569]">{bookingStatusLabel[booking.status] || booking.status || 'Sin estado'} · {formatMoney(Number(booking.amount || 0))}</p>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>

                            <div className="rounded-xl border border-[#e6ebf2] p-3">
                              <h3 className="text-sm font-semibold text-[#1e293b]">Historial de cuentas</h3>
                              <div className="mt-2 max-h-[280px] overflow-auto">
                                {historyAccounts.length === 0 ? (
                                  <p className="text-xs text-[#64748b]">Sin cuentas registradas.</p>
                                ) : (
                                  <ul className="space-y-2">
                                    {historyAccounts.map((account: any) => (
                                      <li key={String(account.id)} className="rounded-lg border border-[#e6ebf2] bg-[#f8fafc] px-3 py-2">
                                        <p className="text-xs font-semibold text-[#0f172a]">Cuenta {formatAccountSourceType(account.sourceType)} #{String(account.id)}</p>
                                        <p className="text-xs text-[#64748b]">{formatDate(account.date)}{account.time ? ` · ${account.time}` : ''}</p>
                                        <p className="text-xs text-[#475569]">Total {formatMoney(Number(account.totalAmount || 0))} · Pendiente {formatMoney(Number(account.amount || 0))}</p>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </article>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      {sidebarOpen && (
        <button
          type="button"
          aria-label="Cerrar panel"
          className="fixed inset-0 z-[2147483200] bg-[#0f172a]/35 backdrop-blur-[2px]"
          onClick={closeActionSidebar}
        />
      )}

      <aside
        className={`fixed inset-y-0 right-0 z-[2147483300] w-full max-w-[560px] border-l border-[#dbe2ee] bg-white shadow-[-16px_0_48px_rgba(15,23,42,0.2)] transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-full min-h-0 flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-[#e6ebf2] px-5 py-4">
            <div>
              <h2 className="text-lg font-black tracking-[-0.01em] text-[#0f172a]">
                {sidebarView === 'client_create' && 'Nuevo cliente'}
                {sidebarView === 'client_edit' && 'Editar cliente'}
                {sidebarView === 'client_profile' && 'Perfil del cliente'}
                {sidebarView === 'client_delete' && 'Eliminar cliente'}
                {sidebarView === 'debt_detail' && 'Detalle de cuenta'}
                {sidebarView === 'debt_pay' && 'Cobrar cuenta pendiente'}
              </h2>
              <p className="mt-1 text-sm text-[#475569]">
                {isClientFormView && 'Gestion de datos basicos del cliente.'}
                {sidebarView === 'client_profile' && (selectedClient ? getClientName(selectedClient) : 'Sin cliente seleccionado')}
                {sidebarView === 'client_delete' && 'Esta accion es permanente.'}
                {isDebtView && `${selectedClient ? getClientName(selectedClient) : 'Cliente'}${selectedDebtEntry ? ` · Cuenta #${String(selectedDebtEntry.id)}` : ''}`}
              </p>
            </div>
            <button
              type="button"
              onClick={closeActionSidebar}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#dbe2ee] text-[#64748b] hover:bg-[#f8fafc]"
              aria-label="Cerrar"
            >
              <X size={15} />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {isClientFormView && (
              <div className="space-y-2">
                <input
                  type="text"
                  value={clientForm.name}
                  onChange={(event) => setClientForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="h-10 w-full rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm outline-none focus:border-[#1f4ed8]"
                  placeholder="Nombre y apellido"
                />

                <div className="grid grid-cols-[110px_1fr] gap-2">
                  <select
                    value={clientForm.phoneCountryIso2}
                    onChange={(event) => setClientForm((prev) => ({ ...prev, phoneCountryIso2: normalizePhoneCountryIso2(event.target.value) }))}
                    className="h-10 w-full rounded-xl border border-[#dbe2ee] bg-white px-2 text-xs font-semibold outline-none focus:border-[#1f4ed8]"
                  >
                    {PHONE_COUNTRY_OPTIONS.map((option) => (
                      <option key={option.iso2} value={option.iso2}>
                        {option.callingCode} {option.iso2}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={clientForm.phone}
                    onChange={(event) =>
                      setClientForm((prev) => ({ ...prev, phone: event.target.value.replace(/[^\d]/g, '') }))
                    }
                    className="h-10 w-full rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm outline-none focus:border-[#1f4ed8]"
                    placeholder="Telefono"
                  />
                </div>

                <input
                  type="text"
                  value={clientForm.dni}
                  onChange={(event) => setClientForm((prev) => ({ ...prev, dni: event.target.value }))}
                  className="h-10 w-full rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm outline-none focus:border-[#1f4ed8]"
                  placeholder="DNI"
                />

                <input
                  type="email"
                  value={clientForm.email}
                  onChange={(event) => setClientForm((prev) => ({ ...prev, email: event.target.value }))}
                  className="h-10 w-full rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm outline-none focus:border-[#1f4ed8]"
                  placeholder="Email"
                />

                <label className="inline-flex items-center gap-2 pt-1 text-xs font-semibold text-[#334155]">
                  <input
                    type="checkbox"
                    checked={Boolean(clientForm.isProfessor)}
                    onChange={(event) => setClientForm((prev) => ({ ...prev, isProfessor: event.target.checked }))}
                  />
                  Es profesor
                </label>
              </div>
            )}

            {sidebarView === 'client_profile' && (
              <div className="space-y-4">
                {!selectedClient ? (
                  <div className="rounded-xl border border-[#e6ebf2] p-8 text-center text-sm text-[#64748b]">Selecciona un cliente.</div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] p-3">
                        <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Cliente</p>
                        <p className="mt-1 text-sm font-semibold text-[#0f172a]">{getClientName(selectedClient)}</p>
                      </div>
                      <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] p-3">
                        <p className="text-[10px] uppercase tracking-wide text-[#64748b]">DNI</p>
                        <p className="mt-1 text-sm font-semibold text-[#0f172a]">{String(selectedClient.dni || '-')}</p>
                      </div>
                      <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] p-3">
                        <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Telefono</p>
                        <p className="mt-1 text-sm font-semibold text-[#0f172a]">{String(selectedClient.phone || '-')}</p>
                      </div>
                      <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] p-3">
                        <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Email</p>
                        <p className="mt-1 break-all text-sm font-semibold text-[#0f172a]">{String(selectedClient.email || '-')}</p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] p-3">
                      <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Estado comercial</p>
                      <p className="mt-1 text-sm text-[#334155]">
                        Total reservas: <span className="font-semibold text-[#0f172a]">{Number(selectedClient.totalBookings || 0)}</span>
                      </p>
                      {Number(selectedClient.totalDebt || 0) > EPSILON ? (
                        <p className="mt-1 text-sm text-red-700">
                          Deuda vigente: <span className="font-semibold">{formatMoney(Number(selectedClient.totalDebt || 0))}</span>
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-[#64748b]">
                          Sin deuda vigente
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {sidebarView === 'client_delete' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-[#fecaca] bg-[#fff1f2] p-3 text-sm text-[#7f1d1d]">
                  Vas a eliminar a {selectedClient ? getClientName(selectedClient) : 'este cliente'}. Esta accion no se puede deshacer.
                </div>
                <div className="rounded-xl border border-[#e6ebf2] bg-white p-3">
                  <p className="text-xs uppercase tracking-wide text-[#64748b]">Cliente seleccionado</p>
                  <p className="mt-1 text-sm font-semibold text-[#0f172a]">{selectedClient ? getClientName(selectedClient) : '-'}</p>
                </div>
              </div>
            )}

            {isDebtView && (
              <div className="space-y-4">
                {debtLoading ? (
                  <div className="rounded-xl border border-[#e6ebf2] p-8 text-center text-sm text-[#64748b]">Cargando detalle de cuenta...</div>
                ) : !selectedDebtEntry ? (
                  <div className="rounded-xl border border-[#e6ebf2] p-8 text-center text-sm text-[#64748b]">Selecciona una cuenta para ver su detalle.</div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-[#dbe2ee] bg-[#f8fafc] p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Saldo total</p>
                        <p className="mt-1 text-lg font-semibold text-[#0f172a]">{formatMoney(selectedDebtTotalPending)}</p>
                      </div>
                      <div className="rounded-xl border border-[#dbe2ee] bg-[#f8fafc] p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Pendiente cancha</p>
                        <p className="mt-1 text-lg font-semibold text-[#0f172a]">{formatMoney(selectedDebtBreakdown ? Number(selectedDebtBreakdown.courtPending || 0) : selectedDebtTotalPending)}</p>
                      </div>
                      <div className="rounded-xl border border-[#dbe2ee] bg-[#f8fafc] p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Pendiente consumos</p>
                        <p className="mt-1 text-lg font-semibold text-[#0f172a]">{formatMoney(selectedDebtBreakdown ? Number(selectedDebtBreakdown.consumptionPending || 0) : 0)}</p>
                      </div>
                    </div>

                    {isDebtDetailView && (
                      <>
                        <div className="rounded-xl border border-[#e6ebf2] bg-white p-3">
                          <h3 className="text-sm font-semibold text-[#1e293b]">Detalle de deuda de cancha</h3>
                          {selectedDebtBreakdown?.bookingPendingItems?.length ? (
                            <ul className="mt-2 space-y-1">
                              {selectedDebtBreakdown.bookingPendingItems.map((item) => (
                                <li key={item.id} className="rounded-lg border border-[#e6ebf2] bg-[#f8fafc] px-2 py-1.5 text-xs text-[#334155]">
                                  {item.description} · Pendiente {formatMoney(item.remaining)}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-xs text-[#64748b]">Sin conceptos pendientes de cancha.</p>
                          )}
                        </div>

                        <div className="rounded-xl border border-[#e6ebf2] bg-white p-3">
                          <h3 className="text-sm font-semibold text-[#1e293b]">Detalle de productos y consumos</h3>
                          {selectedDebtBreakdown?.consumptionPendingItems?.length ? (
                            <ul className="mt-2 space-y-1">
                              {selectedDebtBreakdown.consumptionPendingItems.map((item) => (
                                <li key={item.id} className="rounded-lg border border-[#e6ebf2] bg-[#f8fafc] px-2 py-1.5 text-xs text-[#334155]">
                                  {item.description} · Cant. {item.quantity} · Pendiente {formatMoney(item.remaining)}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-xs text-[#64748b]">Sin consumos pendientes.</p>
                          )}
                        </div>
                      </>
                    )}

                    {isDebtPayView && (
                      <div className="space-y-3 rounded-xl border border-[#e6ebf2] bg-[#fbfdff] p-3">
                        <div className="rounded-xl border border-[#dbe2ee] bg-white p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold text-[#334155]">Cobro por conceptos</p>
                              <p className="text-[10px] text-[#64748b]">Configura por item lo que paga ahora este jugador.</p>
                            </div>
                            {Boolean(selectedDebtBreakdown?.bookingPendingItems?.length) && (
                              <label className="text-[10px] text-[#64748b]">
                                Participantes
                                <input
                                  type="number"
                                  min={1}
                                  max={12}
                                  step={1}
                                  value={splitTotalParticipants}
                                  onChange={(event) => {
                                    const parsed = Math.trunc(Number(event.target.value || 1));
                                    const normalized = Math.max(1, Math.min(12, Number.isFinite(parsed) ? parsed : 1));
                                    setSplitTotalParticipants(normalized);
                                  }}
                                  className="mt-1 h-8 w-20 rounded-lg border border-[#dbe2ee] bg-white px-2 text-xs font-semibold outline-none focus:border-[#1f4ed8]"
                                />
                              </label>
                            )}
                          </div>

                          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[200px_1fr]">
                            <select
                              value={payConceptView}
                              onChange={(event) => setPayConceptView(event.target.value as PayConceptView)}
                              className="h-8 rounded-lg border border-[#dbe2ee] bg-white px-2 text-xs font-semibold text-[#334155] outline-none focus:border-[#1f4ed8]"
                            >
                              <option value="all">Ver: Todos los conceptos</option>
                              <option value="booking">Ver: Solo cancha</option>
                              <option value="consumption">Ver: Solo consumos</option>
                              <option value="selected">Ver: Solo seleccionados</option>
                            </select>
                            {payConceptView === 'consumption' && (
                              <input
                                type="text"
                                value={consumptionSearchTerm}
                                onChange={(event) => setConsumptionSearchTerm(event.target.value)}
                                placeholder="Buscar consumo"
                                className="h-8 w-full rounded-lg border border-[#dbe2ee] bg-white px-2 text-xs outline-none focus:border-[#1f4ed8]"
                              />
                            )}
                          </div>

                          {selectedDebtBreakdown ? (
                            <div className="mt-2 space-y-2 max-h-[220px] overflow-auto pr-1">
                              {payItemsForList.length === 0 && (
                                <div className="rounded-lg border border-[#e6ebf2] bg-white px-3 py-4 text-center text-xs text-[#64748b]">
                                  No hay conceptos para esta vista/filtro.
                                </div>
                              )}

                              {bookingItemsForList.length > 0 && (
                                <div className="rounded-lg border border-[#e6ebf2] bg-white p-2">
                                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Cancha</p>
                                  <div className="space-y-2">
                                    {bookingItemsForList.map((item) => (
                                      <div key={item.id} className="grid grid-cols-[1fr_120px] items-center gap-2 rounded-lg border border-[#e6ebf2] bg-[#f8fafc] px-2 py-1.5">
                                        <div>
                                          <p className="text-xs font-semibold text-[#0f172a]">{item.description}</p>
                                          <p className="text-[11px] text-[#64748b]">Pendiente {formatMoney(item.remaining)}</p>
                                          <div className="mt-1 flex flex-wrap items-center gap-1">
                                            <button
                                              type="button"
                                              onClick={() => skipItemForNow(String(item.id))}
                                              className={`h-6 rounded-md border px-2 text-[10px] font-semibold transition ${
                                                isItemSkipped(String(item.id))
                                                  ? 'border-[#be123c] bg-[#ffe4e6] text-[#9f1239]'
                                                  : 'border-[#fbcfe8] bg-[#fff1f2] text-[#9f1239] hover:bg-[#ffe4e6]'
                                              }`}
                                            >
                                              No cobrar ahora
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                applyItemSplitAmount(
                                                  String(item.id),
                                                  Number(item.total || 0),
                                                  Number(item.remaining || 0),
                                                  1
                                                )
                                              }
                                              className={`h-6 rounded-md border px-2 text-[10px] font-semibold transition ${
                                                isBookingPresetActive(String(item.id), 1)
                                                  ? 'border-[#1f4ed8] bg-[#eef2ff] text-[#1f4ed8]'
                                                  : 'border-[#dbe2ee] bg-white text-[#334155] hover:bg-[#f8fafc]'
                                              }`}
                                            >
                                              Cobrar cuota (1 jugador)
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                applyItemSplitAmount(
                                                  String(item.id),
                                                  Number(item.total || 0),
                                                  Number(item.remaining || 0),
                                                  splitTotalParticipants,
                                                  splitTotalParticipants
                                                )
                                              }
                                              className={`h-6 rounded-md border px-2 text-[10px] font-semibold transition ${
                                                isBookingFullActive(item)
                                                  ? 'border-[#1f4ed8] bg-[#eef2ff] text-[#1f4ed8]'
                                                  : 'border-[#dbe2ee] bg-white text-[#334155] hover:bg-[#f8fafc]'
                                              }`}
                                            >
                                              Cobrar total de cancha
                                            </button>
                                          </div>
                                        </div>
                                        <input
                                          type="number"
                                          min={0}
                                          max={Math.max(0, Number(item.remaining || 0))}
                                          step="0.01"
                                          value={Number(payItemAllocations[String(item.id)] || 0).toFixed(2)}
                                          onChange={(event) => updateItemAllocation(String(item.id), Number(item.remaining || 0), event.target.value)}
                                          className="h-9 w-full rounded-lg border border-[#dbe2ee] bg-white px-2 text-xs font-semibold text-[#0f172a] outline-none placeholder:text-[#94a3b8] focus:border-[#1f4ed8]"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {consumptionItemsForList.length > 0 && (
                                <div className="rounded-lg border border-[#e6ebf2] bg-white p-2">
                                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Consumos</p>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => applyAllConsumptionAllocations('full')}
                                        className="h-6 rounded-md border border-[#dbe2ee] bg-white px-2 text-[10px] font-semibold text-[#334155] hover:bg-[#f8fafc]"
                                      >
                                        Seleccionar visibles
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => applyAllConsumptionAllocations('skip')}
                                        className="h-6 rounded-md border border-[#fbcfe8] bg-[#fff1f2] px-2 text-[10px] font-semibold text-[#9f1239] hover:bg-[#ffe4e6]"
                                      >
                                        Limpiar visibles
                                      </button>
                                    </div>
                                  </div>

                                  <div className="space-y-2">
                                    {consumptionItemsForList.map((item) => {
                                      const checked = !isItemSkipped(String(item.id));
                                      return (
                                        <div key={item.id} className="grid grid-cols-[auto_1fr_120px] items-center gap-2 rounded-lg border border-[#e6ebf2] bg-[#f8fafc] px-2 py-1.5">
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={(event) => toggleConsumptionSelection(item, event.target.checked)}
                                            className="h-4 w-4 rounded border-[#cbd5e1]"
                                            aria-label={`Seleccionar ${item.description}`}
                                          />
                                          <div>
                                            <p className="text-xs font-semibold text-[#0f172a]">{item.description}</p>
                                            <p className="text-[11px] text-[#64748b]">
                                              Cant. {item.quantity} · Pendiente {formatMoney(item.remaining)}
                                            </p>
                                          </div>
                                          <input
                                            type="number"
                                            min={0}
                                            max={Math.max(0, Number(item.remaining || 0))}
                                            step="0.01"
                                            value={Number(payItemAllocations[String(item.id)] || 0).toFixed(2)}
                                            onChange={(event) => updateItemAllocation(String(item.id), Number(item.remaining || 0), event.target.value)}
                                            className="h-9 w-full rounded-lg border border-[#dbe2ee] bg-white px-2 text-xs font-semibold text-[#0f172a] outline-none placeholder:text-[#94a3b8] focus:border-[#1f4ed8]"
                                          />
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : null}

                          <div className="mt-3 rounded-xl border border-[#dbe2ee] bg-[#f8fafc] p-3">
                            <p className="text-xs font-semibold text-[#334155]">Resumen</p>
                            <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-[#475569] sm:grid-cols-2">
                              <div className="rounded-lg border border-[#e6ebf2] bg-white px-2 py-1.5">
                                Total a cobrar ahora: <span className="font-semibold text-[#0f172a]">{formatMoney(Number(payAmount || 0))}</span>
                              </div>
                              <div className="rounded-lg border border-[#e6ebf2] bg-white px-2 py-1.5">
                                Saldo que queda: <span className="font-semibold text-[#0f172a]">{formatMoney(payAllocationsPreview.unallocated)}</span>
                              </div>
                              <div className="rounded-lg border border-[#e6ebf2] bg-white px-2 py-1.5">
                                Cancha cobrada: <span className="font-semibold text-[#0f172a]">{formatMoney(payAllocationsPreview.booking)}</span>
                              </div>
                              <div className="rounded-lg border border-[#e6ebf2] bg-white px-2 py-1.5">
                                Consumos cobrados: <span className="font-semibold text-[#0f172a]">{formatMoney(payAllocationsPreview.consumption)}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-[#334155]">Metodo</label>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {(['CASH', 'TRANSFER', 'CARD'] as PaymentMethod[]).map((method) => (
                              <button
                                key={method}
                                type="button"
                                onClick={() => setPayMethod(method)}
                                className={`h-9 rounded-lg px-3 text-xs font-semibold transition ${
                                  payMethod === method ? 'bg-[#1f4ed8] text-white' : 'border border-[#dbe2ee] bg-white text-[#334155] hover:bg-[#f8fafc]'
                                }`}
                              >
                                {method === 'CASH' ? 'Efectivo' : method === 'TRANSFER' ? 'Transferencia' : 'Tarjeta'}
                              </button>
                            ))}
                          </div>
                        </div>

                        {payMethod === 'TRANSFER' && (
                          <div>
                            <label className="text-xs font-semibold text-[#334155]">Canal de transferencia</label>
                            <select
                              value={transferChannel}
                              onChange={(event) => setTransferChannel(event.target.value as PaymentTransferChannel)}
                              className="mt-1 h-10 w-full rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm outline-none focus:border-[#1f4ed8]"
                            >
                              <option value="BANK_ACCOUNT">Cuenta bancaria</option>
                              <option value="VIRTUAL_WALLET">Billetera virtual</option>
                            </select>
                          </div>
                        )}

                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-[#e6ebf2] px-5 py-4">
            <button
              type="button"
              onClick={closeActionSidebar}
              className="h-10 rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]"
            >
              Cancelar
            </button>

            {isClientFormView && (
              <>
                <button
                  type="button"
                  onClick={() => {
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
                  className="h-10 rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]"
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  onClick={() => void submitClient()}
                  disabled={submittingClient}
                  className="h-10 rounded-xl bg-[#1f4ed8] px-3 text-sm font-semibold text-white transition hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submittingClient ? 'Guardando...' : sidebarView === 'client_edit' ? 'Guardar cambios' : 'Crear cliente'}
                </button>
              </>
            )}

            {sidebarView === 'client_profile' && selectedClient && (
              <button
                type="button"
                onClick={() => openEditClient(selectedClient)}
                className="h-10 rounded-xl bg-[#1f4ed8] px-3 text-sm font-semibold text-white hover:bg-[#1e40af]"
              >
                Editar cliente
              </button>
            )}

            {sidebarView === 'client_delete' && (
              <button
                type="button"
                onClick={() => {
                  if (deletingClient) return;
                  void deleteSelectedClient();
                }}
                className="h-10 rounded-xl bg-[#b91c1c] px-3 text-sm font-semibold text-white hover:bg-[#991b1b] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={deletingClient}
              >
                {deletingClient ? 'Eliminando...' : 'Si, eliminar'}
              </button>
            )}

            {sidebarView === 'debt_detail' && selectedDebtEntry && (
              <button
                type="button"
                onClick={() => void openPaySidebar(String(selectedDebtEntry.id))}
                className="h-10 rounded-xl bg-[#1f4ed8] px-3 text-sm font-semibold text-white hover:bg-[#1e40af]"
              >
                Cobrar esta cuenta
              </button>
            )}

            {sidebarView === 'debt_pay' && (
              <button
                type="button"
                onClick={() => void processDebtPayment()}
                disabled={paying || !selectedDebtEntry || currentPayAmount <= EPSILON}
                className="h-10 rounded-xl bg-[#1f4ed8] px-3 text-sm font-semibold text-white hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {paying ? 'Registrando...' : currentPayAmount > EPSILON ? `Confirmar cobro ${formatMoney(currentPayAmount)}` : 'Seleccionar monto a cobrar'}
              </button>
            )}
          </footer>
        </div>
      </aside>
    </>
  );
}
