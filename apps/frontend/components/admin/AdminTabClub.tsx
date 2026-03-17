import { useEffect, useState, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { ClubService, Club, type BookingConfirmationMode } from '../../services/ClubService';
import { getCourts } from '../../services/CourtService';
import { ClubAdminService, ClubActivityType, type DiscountApplyMode, type DiscountAmountType, type DiscountPolicyScope, type AuditLogEntry } from '../../services/ClubAdminService';
import { searchClients } from '../../services/BookingService';
import AppModal from '../AppModal';
import { Settings, Globe, Instagram, Facebook, MapPin, Phone, Mail, Lightbulb, Image as ImageIcon, Trash2, Save, AlertTriangle, Check } from 'lucide-react';
import { normalizeSessionUser } from '../../utils/session';
import { useRouter } from 'next/router';

type FixedBookingActivitySetting = {
  key: string;
  label: string;
};

type FixedBookingSettingsForm = Record<string, {
  fixedBookingDaysAhead: string;
  fixedBookingGenerationFrequencyDays: string;
}>;

const DEFAULT_FIXED_BOOKING_DAYS_AHEAD = '90';
const DEFAULT_FIXED_BOOKING_GENERATION_FREQUENCY_DAYS = '7';
const UNSAVED_NAVIGATION_ABORT_TOKEN = '__UNSAVED_NAVIGATION_ABORT__';
const BOOKING_CONFIRMATION_MODES: Array<{ value: BookingConfirmationMode; label: string; helper: string }> = [
  {
    value: 'AUTOMATIC',
    label: 'Automática',
    helper: 'Toda reserva nueva queda confirmada al crearse.'
  },
  {
    value: 'MANUAL',
    label: 'Manual',
    helper: 'Las reservas nacen pendientes y un admin las confirma manualmente.'
  },
  {
    value: 'DEPOSIT_REQUIRED',
    label: 'Con seña',
    helper: 'Las reservas nacen pendientes y se confirman cuando cubren la seña mínima.'
  }
];

type ActivityScheduleFormValue = {
  scheduleMode: 'FIXED' | 'RANGE';
  scheduleOpenTime: string;
  scheduleCloseTime: string;
  scheduleIntervalMinutes: string;
  scheduleDurations: string;
  scheduleFixedSlots: string;
};

type DiscountPolicyView = {
  id: string;
  name: string;
  scope: DiscountPolicyScope;
  amountType: DiscountAmountType;
  amountValue: number;
  applyMode: DiscountApplyMode;
  isStackable: boolean;
  priority: number;
  isActive: boolean;
};

type ClientSearchResult = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  dni?: string;
};

type ClubConfigSnapshot = {
  clubForm: any;
  openingDaysSet: number[];
  activityScheduleForm: Record<number, ActivityScheduleFormValue>;
};

type ConfigChange = {
  label: string;
  before: string;
  after: string;
  critical?: boolean;
};

type ConfigHistoryEntry = {
  id: string;
  changedAt: string;
  actor: string;
  changes: ConfigChange[];
};

const formatDiscountScopeLabel = (scope: DiscountPolicyScope) => {
  if (scope === 'BOOKING') return 'Reserva';
  if (scope === 'PRODUCT') return 'Producto';
  if (scope === 'SERVICE') return 'Servicio';
  return 'Todo';
};

const formatDiscountAmountTypeLabel = (amountType: DiscountAmountType) => {
  if (amountType === 'PERCENT') return 'Porcentaje';
  return 'Monto fijo';
};

const formatDiscountApplyModeLabel = (applyMode: DiscountApplyMode) => {
  if (applyMode === 'INCLUDE_ONLY') return 'Solo incluidos';
  return 'Excluir lista';
};

const normalizeDurations = (value: unknown, fallback: number): number[] => {
  const parsed = Array.isArray(value)
    ? value.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0).map((item) => Math.floor(item))
    : [];
  if (parsed.length > 0) return Array.from(new Set(parsed));
  return [Math.max(1, Math.floor(fallback || 60))];
};

const parseDurationsInput = (raw: string, fallback: number): number[] => {
  const parsed = raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.floor(item));

  if (parsed.length > 0) return Array.from(new Set(parsed));
  return [Math.max(1, Math.floor(fallback || 60))];
};

const parseFixedSlotsInput = (raw: string): Array<{ start: string; duration: number }> => {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const slots: Array<{ start: string; duration: number }> = [];

  for (const line of lines) {
    const normalized = line.replace(' - ', '-').replace('|', '-').replace(',', '-');
    const [startRaw, durationRaw] = normalized.split('-').map((part) => part.trim());
    if (!startRaw || !durationRaw) {
      throw new Error(`Formato de turno fijo inválido: "${line}". Usá HH:mm-60`);
    }
    if (!/^\d{2}:\d{2}$/.test(startRaw)) {
      throw new Error(`Hora inválida en turno fijo: "${line}"`);
    }
    const duration = Number(durationRaw);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`Duración inválida en turno fijo: "${line}"`);
    }
    slots.push({ start: startRaw, duration: Math.floor(duration) });
  }

  return slots;
};

const buildScheduleFormFromActivities = (activities: ClubActivityType[]): Record<number, ActivityScheduleFormValue> => {
  return activities.reduce((acc, activity) => {
    const safeDefault = Number(activity.defaultDurationMinutes) > 0 ? Number(activity.defaultDurationMinutes) : 60;
    const durations = normalizeDurations(activity.scheduleDurations, safeDefault);
    const fixedSlots = Array.isArray(activity.scheduleFixedSlots) ? activity.scheduleFixedSlots : [];

    acc[activity.id] = {
      scheduleMode: activity.scheduleMode === 'RANGE' ? 'RANGE' : 'FIXED',
      scheduleOpenTime: activity.scheduleOpenTime || '08:00',
      scheduleCloseTime: activity.scheduleCloseTime || '22:00',
      scheduleIntervalMinutes: activity.scheduleIntervalMinutes != null ? String(activity.scheduleIntervalMinutes) : '30',
      scheduleDurations: durations.join(', '),
      scheduleFixedSlots: fixedSlots.map((slot) => `${slot.start}-${slot.duration}`).join('\n')
    };

    return acc;
  }, {} as Record<number, ActivityScheduleFormValue>);
};

const normalizeActivityKey = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();

const formatActivityLabelFromKey = (key: string) => {
  if (!key) return '';
  return key.charAt(0) + key.slice(1).toLowerCase();
};

const buildFixedBookingSettingsForm = (
  activitySettings: FixedBookingActivitySetting[],
  raw: unknown
): FixedBookingSettingsForm => {
  const base = activitySettings.reduce((acc, activity) => {
    acc[activity.key] = {
      fixedBookingDaysAhead: DEFAULT_FIXED_BOOKING_DAYS_AHEAD,
      fixedBookingGenerationFrequencyDays: DEFAULT_FIXED_BOOKING_GENERATION_FREQUENCY_DAYS
    };
    return acc;
  }, {} as FixedBookingSettingsForm);

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const source = raw as Record<string, any>;

  for (const activity of activitySettings) {
    const config = source[activity.key];
    if (!config || typeof config !== 'object') continue;
    const daysAhead = Number(config.fixedBookingDaysAhead);
    const generationFrequencyDays = Number(config.fixedBookingGenerationFrequencyDays);

    if (Number.isFinite(daysAhead) && daysAhead > 0) {
      base[activity.key].fixedBookingDaysAhead = String(Math.floor(daysAhead));
    }
    if (Number.isFinite(generationFrequencyDays) && generationFrequencyDays > 0) {
      base[activity.key].fixedBookingGenerationFrequencyDays = String(Math.floor(generationFrequencyDays));
    }
  }

  return base;
};

const buildActivitySettingsFromCourts = (courts: any[], existingRaw?: unknown): FixedBookingActivitySetting[] => {
  const byKey = new Map<string, string>();

  for (const court of Array.isArray(courts) ? courts : []) {
    const activities = court?.activityType ? [court.activityType] : [];

    for (const activity of activities) {
      const name = String(activity?.name || '').trim();
      if (!name) continue;
      const key = normalizeActivityKey(name);
      if (!key) continue;
      if (!byKey.has(key)) {
        byKey.set(key, name);
      }
    }
  }

  if (byKey.size === 0 && existingRaw && typeof existingRaw === 'object' && !Array.isArray(existingRaw)) {
    for (const key of Object.keys(existingRaw as Record<string, unknown>)) {
      const normalizedKey = normalizeActivityKey(key);
      if (!normalizedKey) continue;
      if (!byKey.has(normalizedKey)) {
        byKey.set(normalizedKey, formatActivityLabelFromKey(normalizedKey));
      }
    }
  }

  return Array.from(byKey.entries())
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
};

export default function AdminTabClub() {
  const router = useRouter();
  const [club, setClub] = useState<Club | null>(null);
  const [loadingClub, setLoadingClub] = useState(false);
  const [clubForm, setClubForm] = useState({
    slug: '', name: '', addressLine: '', city: '', province: '', country: '', contactInfo: '', phone: '', logoUrl: '', clubImageUrl: '',
    instagramUrl: '', facebookUrl: '', websiteUrl: '', description: '',
    lightsEnabled: false,
    lightsExtraAmount: '',
    lightsFromHour: '',
    professorDurationOverrideEnabled: true,
    professorDurationOverrideMinutes: '60',
    bookingConfirmationMode: 'MANUAL' as BookingConfirmationMode,
    bookingDepositPercent: '',
    allowManualConfirmationOverride: true,
    autoCancelPendingBookingsEnabled: false,
    autoCancelPendingBookingsMinutesBefore: '',
    autoCancelPendingBookingsOnlyIfUnpaid: true,
    autoCancelPendingWarningEnabled: false,
    autoCancelPendingWarningMinutesBefore: '',
    enforceCashShiftCloseWithOpenAccounts: false,
    bookingSimpleAdvanceDaysUser: '30',
    bookingSimpleAdvanceDaysAdmin: '30',
    allowAdminSkipSimpleAdvanceLimit: false,
       openingDays: '',
        fixedBookingSettingsByActivity: {} as FixedBookingSettingsForm
  });
      const [activitySettings, setActivitySettings] = useState<FixedBookingActivitySetting[]>([]);
     const [openingDaysSet, setOpeningDaysSet] = useState<number[]>([]);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [clubImagePreview, setClubImagePreview] = useState<string | null>(null);
  const [clubImageError, setClubImageError] = useState<string | null>(null);
  const clubImageInputRef = useRef<HTMLInputElement | null>(null);
  const [modalState, setModalState] = useState<{
    show: boolean; title?: string; message?: ReactNode; cancelText?: string; confirmText?: string;
    isWarning?: boolean; onConfirm?: () => Promise<void> | void; onCancel?: () => Promise<void> | void;
    closeOnBackdrop?: boolean; closeOnEscape?: boolean;
    holdToConfirm?: boolean; holdDuration?: number;
  }>({ show: false });
  const initialConfigRef = useRef<ClubConfigSnapshot | null>(null);
  const allowNavigationRef = useRef(false);
  const pendingRouteRef = useRef<string | null>(null);
  const [activityTypes, setActivityTypes] = useState<ClubActivityType[]>([]);
  const [activityScheduleForm, setActivityScheduleForm] = useState<Record<number, ActivityScheduleFormValue>>({});
  const [changeHistory, setChangeHistory] = useState<ConfigHistoryEntry[]>([]);
  const [discountPolicies, setDiscountPolicies] = useState<DiscountPolicyView[]>([]);
  const [loadingDiscountPolicies, setLoadingDiscountPolicies] = useState(false);
  const [discountPolicyForm, setDiscountPolicyForm] = useState({
    name: '',
    scope: 'BOOKING' as DiscountPolicyScope,
    amountType: 'PERCENT' as DiscountAmountType,
    amountValue: '',
    applyMode: 'INCLUDE_ONLY' as DiscountApplyMode,
    isStackable: false,
    priority: '100'
  });
  const [editingDiscountPolicyId, setEditingDiscountPolicyId] = useState<string | null>(null);
  const [discountPolicyEditForm, setDiscountPolicyEditForm] = useState({
    name: '',
    scope: 'BOOKING' as DiscountPolicyScope,
    amountType: 'PERCENT' as DiscountAmountType,
    amountValue: '',
    applyMode: 'INCLUDE_ONLY' as DiscountApplyMode,
    isStackable: false,
    priority: '100',
    isActive: true
  });
  const [clientSearch, setClientSearch] = useState('');
  const [clientSearchResults, setClientSearchResults] = useState<ClientSearchResult[]>([]);
  const [showClientSearchDropdown, setShowClientSearchDropdown] = useState(false);
  const [selectedDiscountClient, setSelectedDiscountClient] = useState<ClientSearchResult | null>(null);
  const [clientAssignments, setClientAssignments] = useState<any[]>([]);
  const [loadingClientAssignments, setLoadingClientAssignments] = useState(false);
  const [selectedPolicyIdForAssignment, setSelectedPolicyIdForAssignment] = useState('');
  const [assignmentNotes, setAssignmentNotes] = useState('');
  const clientSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientSearchWrapperRef = useRef<HTMLDivElement | null>(null);

  const closeModal = () => setModalState((prev) => ({ ...prev, show: false, onConfirm: undefined, onCancel: undefined, holdToConfirm: false, holdDuration: undefined }));
  const showInfo = (message: ReactNode, title = 'Información') => setModalState({ show: true, title, message, cancelText: '', confirmText: 'OK' });
  const showError = (message: ReactNode) => setModalState({ show: true, title: 'Error', message, isWarning: true, cancelText: '', confirmText: 'Aceptar' });

  const cloneSnapshot = (snapshot: ClubConfigSnapshot): ClubConfigSnapshot => ({
    clubForm: JSON.parse(JSON.stringify(snapshot.clubForm)),
    openingDaysSet: [...snapshot.openingDaysSet],
    activityScheduleForm: JSON.parse(JSON.stringify(snapshot.activityScheduleForm))
  });

  const normalizeDays = (days: number[]) => [...days].sort((a, b) => a - b);
  const normalizeValue = (value: unknown) => {
    if (value == null) return '';
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    return String(value);
  };

  const mapAuditLogToHistoryEntry = (log: AuditLogEntry): ConfigHistoryEntry => {
    const fullName = `${String(log.user?.firstName || '').trim()} ${String(log.user?.lastName || '').trim()}`.trim();
    const actor = fullName || String(log.user?.email || 'Admin');
    const rawChanges = Array.isArray(log.payload?.changes) ? log.payload.changes : [];
    const changes: ConfigChange[] = rawChanges.slice(0, 20).map((item: any) => ({
      label: String(item?.field || 'Cambio'),
      before: item?.before == null ? '-' : String(item.before),
      after: item?.after == null ? '-' : String(item.after),
      critical: ['bookingConfirmationMode', 'bookingDepositPercent', 'autoCancelPendingBookingsEnabled', 'bookingSimpleAdvanceDaysUser', 'bookingSimpleAdvanceDaysAdmin'].includes(String(item?.field || ''))
    }));
    return { id: String(log.id), changedAt: String(log.createdAt), actor, changes };
  };

  const loadPersistentConfigHistory = useCallback(async (clubId: number) => {
    try {
      const logs = await ClubAdminService.listAuditLogs({
        action: 'CLUB_CONFIG_UPDATED',
        entity: 'CLUB',
        entityId: String(clubId),
        take: 20
      });
      setChangeHistory(logs.map(mapAuditLogToHistoryEntry));
    } catch {
      // si falla auditoria, no bloqueamos la pantalla
    }
  }, []);

  const loadDiscountPolicies = useCallback(async (clubSlug: string) => {
    try {
      setLoadingDiscountPolicies(true);
      const rows = await ClubAdminService.listDiscountPolicies(clubSlug);
      setDiscountPolicies(Array.isArray(rows) ? rows : []);
    } catch (error: any) {
      showError(`Error al cargar políticas de descuento: ${error.message}`);
    } finally {
      setLoadingDiscountPolicies(false);
    }
  }, []);

  const loadClientAssignments = useCallback(async (clubSlug: string, clientId: string) => {
    try {
      setLoadingClientAssignments(true);
      const rows = await ClubAdminService.listClientDiscountAssignments(clubSlug, clientId);
      setClientAssignments(Array.isArray(rows) ? rows : []);
    } catch (error: any) {
      showError(`Error al cargar asignaciones del cliente: ${error.message}`);
    } finally {
      setLoadingClientAssignments(false);
    }
  }, []);

  const loadClub = useCallback(async () => {
    try {
      setLoadingClub(true);
      const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
      let clubId: number | null = null;
      if (userStr) {
        try {
          const user = normalizeSessionUser(JSON.parse(userStr));
          if (user?.activeClubId) clubId = Number(user.activeClubId);
          else if (user?.clubId) clubId = Number(user.clubId);
        } catch { /* noop */ }
      }
      if (!clubId) {
        const clubs = await ClubService.getAllClubs();
        if (clubs.length > 0) clubId = clubs[0].id;
      }
      if (clubId) {
        const clubData = await ClubService.getClubById(clubId);
        const courtsData = await getCourts();
        const activityTypesData = await ClubAdminService.getActivityTypes(clubData.slug);
        const nextActivitySettings = buildActivitySettingsFromCourts(courtsData, clubData.fixedBookingSettingsByActivity);
        const nextActivityTypes = Array.isArray(activityTypesData) ? activityTypesData : [];
        const nextActivityScheduleForm = buildScheduleFormFromActivities(nextActivityTypes);
        const nextOpeningDays = Array.isArray(clubData.openingDays) ? clubData.openingDays : [];
        const nextClubForm = {
          slug: clubData.slug || '', name: clubData.name || '',
          addressLine: clubData.addressLine || '', city: clubData.city || '', province: clubData.province || '', country: clubData.country || '',
          contactInfo: clubData.contactInfo || '', phone: clubData.phone || '', logoUrl: clubData.logoUrl || '', clubImageUrl: clubData.clubImageUrl || '',
          instagramUrl: clubData.instagramUrl || '', facebookUrl: clubData.facebookUrl || '',
          websiteUrl: clubData.websiteUrl || '', description: clubData.description || '',
          lightsEnabled: clubData.lightsEnabled ?? false,
          lightsExtraAmount: clubData.lightsExtraAmount != null ? String(clubData.lightsExtraAmount) : '',
          lightsFromHour: clubData.lightsFromHour || '',
          professorDurationOverrideEnabled: clubData.professorDurationOverrideEnabled ?? true,
          professorDurationOverrideMinutes: clubData.professorDurationOverrideMinutes != null ? String(clubData.professorDurationOverrideMinutes) : '60',
          bookingConfirmationMode: (clubData.bookingConfirmationMode ?? 'MANUAL') as BookingConfirmationMode,
          bookingDepositPercent: clubData.bookingDepositPercent != null ? String(clubData.bookingDepositPercent) : '',
          allowManualConfirmationOverride: clubData.allowManualConfirmationOverride ?? true,
          autoCancelPendingBookingsEnabled: clubData.autoCancelPendingBookingsEnabled ?? false,
          autoCancelPendingBookingsMinutesBefore: clubData.autoCancelPendingBookingsMinutesBefore != null ? String(clubData.autoCancelPendingBookingsMinutesBefore) : '',
          autoCancelPendingBookingsOnlyIfUnpaid: clubData.autoCancelPendingBookingsOnlyIfUnpaid ?? true,
          autoCancelPendingWarningEnabled: clubData.autoCancelPendingWarningEnabled ?? false,
          autoCancelPendingWarningMinutesBefore: clubData.autoCancelPendingWarningMinutesBefore != null ? String(clubData.autoCancelPendingWarningMinutesBefore) : '',
          enforceCashShiftCloseWithOpenAccounts: clubData.enforceCashShiftCloseWithOpenAccounts ?? false,
          bookingSimpleAdvanceDaysUser: clubData.bookingSimpleAdvanceDaysUser != null ? String(clubData.bookingSimpleAdvanceDaysUser) : '30',
          bookingSimpleAdvanceDaysAdmin: clubData.bookingSimpleAdvanceDaysAdmin != null ? String(clubData.bookingSimpleAdvanceDaysAdmin) : '30',
          allowAdminSkipSimpleAdvanceLimit: clubData.allowAdminSkipSimpleAdvanceLimit ?? false,
          openingDays: Array.isArray(clubData.openingDays) ? clubData.openingDays.join(',') : '',
          fixedBookingSettingsByActivity: buildFixedBookingSettingsForm(nextActivitySettings, clubData.fixedBookingSettingsByActivity)
        };
        setClub(clubData);
        setActivitySettings(nextActivitySettings);
        setActivityTypes(nextActivityTypes);
        setActivityScheduleForm(nextActivityScheduleForm);
        await loadDiscountPolicies(clubData.slug);
        setClientSearch('');
        setClientSearchResults([]);
        setSelectedDiscountClient(null);
        setClientAssignments([]);
        setSelectedPolicyIdForAssignment('');
        setAssignmentNotes('');
        setClubForm(nextClubForm);
        setOpeningDaysSet(nextOpeningDays);
        setLogoPreview(clubData.logoUrl || null);
        setClubImagePreview(clubData.clubImageUrl || null);
        initialConfigRef.current = cloneSnapshot({
          clubForm: nextClubForm,
          openingDaysSet: nextOpeningDays,
          activityScheduleForm: nextActivityScheduleForm
        });
        await loadPersistentConfigHistory(clubData.id);
      }
    } catch (error: any) {
      showError('Error al cargar información del club: ' + error.message);
    } finally {
      setLoadingClub(false);
    }
  }, [loadDiscountPolicies, loadPersistentConfigHistory]);

  useEffect(() => { loadClub(); }, [loadClub]);

  const buildConfigChanges = (): ConfigChange[] => {
    const base = initialConfigRef.current;
    if (!base) return [];
    const changes: ConfigChange[] = [];
    const criticalFields = new Set([
      'bookingConfirmationMode',
      'bookingDepositPercent',
      'autoCancelPendingBookingsEnabled',
      'autoCancelPendingBookingsMinutesBefore',
      'bookingSimpleAdvanceDaysUser',
      'bookingSimpleAdvanceDaysAdmin',
      'enforceCashShiftCloseWithOpenAccounts',
      'allowAdminSkipSimpleAdvanceLimit'
    ]);
    const labels: Record<string, string> = {
      bookingConfirmationMode: 'Modo de confirmacion',
      bookingDepositPercent: 'Porcentaje de seña',
      autoCancelPendingBookingsEnabled: 'Auto-cancelacion pendientes',
      autoCancelPendingBookingsMinutesBefore: 'Minutos auto-cancelacion',
      bookingSimpleAdvanceDaysUser: 'Anticipacion usuarios',
      bookingSimpleAdvanceDaysAdmin: 'Anticipacion admins',
      enforceCashShiftCloseWithOpenAccounts: 'Bloqueo cierre de caja',
      allowAdminSkipSimpleAdvanceLimit: 'Bypass de anticipacion admin',
      openingDaysSet: 'Dias de apertura',
      activityScheduleForm: 'Horarios por actividad'
    };

    const keys = Array.from(new Set([...Object.keys(base.clubForm || {}), ...Object.keys(clubForm || {})]));
    for (const key of keys) {
      const before = normalizeValue((base.clubForm as any)?.[key]);
      const after = normalizeValue((clubForm as any)?.[key]);
      if (before !== after) {
        changes.push({
          label: labels[key] || key,
          before,
          after,
          critical: criticalFields.has(key)
        });
      }
    }

    const beforeDays = normalizeDays(base.openingDaysSet || []);
    const afterDays = normalizeDays(openingDaysSet || []);
    if (JSON.stringify(beforeDays) !== JSON.stringify(afterDays)) {
      changes.push({
        label: labels.openingDaysSet,
        before: beforeDays.join(', ') || 'Todos',
        after: afterDays.join(', ') || 'Todos',
        critical: false
      });
    }

    const beforeSchedule = JSON.stringify(base.activityScheduleForm || {});
    const afterSchedule = JSON.stringify(activityScheduleForm || {});
    if (beforeSchedule !== afterSchedule) {
      changes.push({
        label: labels.activityScheduleForm,
        before: 'Configuracion previa',
        after: 'Configuracion editada',
        critical: true
      });
    }

    return changes;
  };

  const configChanges = [...buildConfigChanges()].sort((a, b) => Number(Boolean(b.critical)) - Number(Boolean(a.critical)));
  const hasUnsavedChanges = configChanges.length > 0;

  const restoreFromSnapshot = () => {
    const base = initialConfigRef.current;
    if (!base) return;
    const clone = cloneSnapshot(base);
    setClubForm(clone.clubForm);
    setOpeningDaysSet(clone.openingDaysSet);
    setActivityScheduleForm(clone.activityScheduleForm);
    setLogoPreview(clone.clubForm.logoUrl || null);
    setClubImagePreview(clone.clubForm.clubImageUrl || null);
    setLogoError(null);
    setClubImageError(null);
  };

  const handleDiscardChanges = () => {
    if (!hasUnsavedChanges) return;
    setModalState({
      show: true,
      title: 'Descartar cambios',
      message: 'Se perderan los cambios no guardados de esta pantalla.',
      isWarning: true,
      cancelText: 'Volver',
      confirmText: 'Descartar',
      onConfirm: () => {
        closeModal();
        restoreFromSnapshot();
      }
    });
  };

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const onRouteChangeStart = (url: string) => {
      if (allowNavigationRef.current) return;
      if (!hasUnsavedChanges) return;
      if (url === router.asPath) return;

      pendingRouteRef.current = url;
      setModalState({
        show: true,
        title: 'Cambios sin guardar',
        message: 'Si salis ahora, vas a perder cambios no guardados.',
        isWarning: true,
        cancelText: 'Quedarme',
        confirmText: 'Salir igual',
        closeOnBackdrop: false,
        closeOnEscape: false,
        onConfirm: async () => {
          const nextUrl = pendingRouteRef.current;
          pendingRouteRef.current = null;
          closeModal();
          if (!nextUrl) return;
          allowNavigationRef.current = true;
          try {
            await router.push(nextUrl);
          } finally {
            allowNavigationRef.current = false;
          }
        },
        onCancel: () => {
          pendingRouteRef.current = null;
          closeModal();
        }
      });

      router.events.emit('routeChangeError');
      throw UNSAVED_NAVIGATION_ABORT_TOKEN;
    };

    router.events.on('routeChangeStart', onRouteChangeStart);
    return () => router.events.off('routeChangeStart', onRouteChangeStart);
  }, [hasUnsavedChanges, router]);

  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (event.reason === UNSAVED_NAVIGATION_ABORT_TOKEN) {
        event.preventDefault();
      }
    };
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => window.removeEventListener('unhandledrejection', onUnhandledRejection);
  }, []);

  const restoreBookingPolicyDefaults = () => {
    setClubForm((prev) => ({
      ...prev,
      bookingConfirmationMode: 'MANUAL',
      bookingDepositPercent: '',
      allowManualConfirmationOverride: true,
      autoCancelPendingBookingsEnabled: false,
      autoCancelPendingBookingsMinutesBefore: '',
      autoCancelPendingBookingsOnlyIfUnpaid: true,
      autoCancelPendingWarningEnabled: false,
      autoCancelPendingWarningMinutesBefore: '',
      bookingSimpleAdvanceDaysUser: '30',
      bookingSimpleAdvanceDaysAdmin: '30',
      allowAdminSkipSimpleAdvanceLimit: false,
      enforceCashShiftCloseWithOpenAccounts: false
    }));
  };

  const handleUpdateClub = async (e?: React.FormEvent, skipConfirm = false) => {
    e?.preventDefault();
    if (!club) { showError('No se pudo identificar el club'); return; }
    if (!skipConfirm) {
      if (!hasUnsavedChanges) {
        showInfo('No hay cambios pendientes para guardar.');
        return;
      }
      const criticalChanges = configChanges.filter((change) => change.critical);
      const topChanges = configChanges.slice(0, 12);
      setModalState({
        show: true,
        title: 'Revisar y confirmar cambios',
        message: (
          <div className="space-y-3">
            <p className="text-sm font-bold">
              Vas a aplicar <span className="font-black">{configChanges.length}</span> cambios de configuración.
            </p>
            {criticalChanges.length > 0 ? (
              <p className="text-xs font-black text-red-600 uppercase tracking-widest">
                Cambios críticos detectados: {criticalChanges.length}
              </p>
            ) : null}
            <div className="max-h-56 overflow-auto rounded-xl border border-[#347048]/15 bg-white/80 p-3">
              <ul className="space-y-1 text-xs text-[#347048]">
                {topChanges.map((change) => (
                  <li key={`${change.label}-${change.after}`}>
                    {change.critical ? '• [CRITICO] ' : '• '}
                    {change.label}: {change.before} → {change.after}
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs font-bold text-[#347048]/70">
              Confirmá solo si verificaste el impacto operativo de estos cambios.
            </p>
          </div>
        ),
        isWarning: criticalChanges.length > 0,
        cancelText: 'Cancelar',
        confirmText: 'Guardar cambios',
        holdToConfirm: criticalChanges.length > 0,
        holdDuration: criticalChanges.length > 0 ? 1400 : undefined,
        onConfirm: async () => {
          closeModal();
          await handleUpdateClub(undefined, true);
        }
      });
      return;
    }
    try {
      const fixedBookingSettingsByActivity = activitySettings.reduce((acc, activity) => {
        const config = clubForm.fixedBookingSettingsByActivity[activity.key];
        if (!config) return acc;
        const daysAhead = Number(config.fixedBookingDaysAhead);
        const generationFrequencyDays = Number(config.fixedBookingGenerationFrequencyDays);

        if (Number.isFinite(daysAhead) && daysAhead > 0 && Number.isFinite(generationFrequencyDays) && generationFrequencyDays > 0) {
          acc[activity.key] = {
            fixedBookingDaysAhead: Math.floor(daysAhead),
            fixedBookingGenerationFrequencyDays: Math.floor(generationFrequencyDays)
          };
        }

        return acc;
      }, {} as Record<string, { fixedBookingDaysAhead: number; fixedBookingGenerationFrequencyDays: number }>);

      const rawDepositPercent = Number(clubForm.bookingDepositPercent);
      const normalizedDepositPercent = Number.isFinite(rawDepositPercent) ? rawDepositPercent : NaN;
      if (clubForm.bookingConfirmationMode === 'DEPOSIT_REQUIRED') {
        if (!Number.isFinite(normalizedDepositPercent) || normalizedDepositPercent <= 0 || normalizedDepositPercent > 100) {
          showError('En modo "Con seña", el porcentaje de seña es obligatorio y debe ser mayor a 0 y menor o igual a 100.');
          return;
        }
      }

      const bookingDepositPercentPayload = clubForm.bookingConfirmationMode === 'DEPOSIT_REQUIRED'
        ? Number(normalizedDepositPercent.toFixed(2))
        : null;
      const cancelMinutesRaw = Number(clubForm.autoCancelPendingBookingsMinutesBefore);
      const warningMinutesRaw = Number(clubForm.autoCancelPendingWarningMinutesBefore);
      const simpleAdvanceUserRaw = Number(clubForm.bookingSimpleAdvanceDaysUser);
      const simpleAdvanceAdminRaw = Number(clubForm.bookingSimpleAdvanceDaysAdmin);
      if (clubForm.autoCancelPendingBookingsEnabled) {
        if (!Number.isFinite(cancelMinutesRaw) || cancelMinutesRaw <= 0) {
          showError('Si activás auto-cancelación, los minutos antes del turno deben ser mayores a 0.');
          return;
        }
      }
      if (!Number.isFinite(simpleAdvanceUserRaw) || simpleAdvanceUserRaw < 0) {
        showError('La anticipación máxima para usuarios debe ser 0 o mayor.');
        return;
      }
      if (!Number.isFinite(simpleAdvanceAdminRaw) || simpleAdvanceAdminRaw < 0) {
        showError('La anticipación máxima para admins debe ser 0 o mayor.');
        return;
      }
      if (clubForm.autoCancelPendingBookingsEnabled && clubForm.autoCancelPendingWarningEnabled) {
        if (!Number.isFinite(warningMinutesRaw) || warningMinutesRaw <= 0) {
          showError('Si activás aviso previo, los minutos de aviso deben ser mayores a 0.');
          return;
        }
        if (warningMinutesRaw <= cancelMinutesRaw) {
          showError('El aviso previo debe configurarse con más minutos que la cancelación automática.');
          return;
        }
      }

        const payload: any = {
        ...clubForm,
        lightsEnabled: !!clubForm.lightsEnabled,
        lightsExtraAmount: clubForm.lightsExtraAmount === '' ? null : Number(clubForm.lightsExtraAmount),
        lightsFromHour: clubForm.lightsFromHour || null,
        professorDurationOverrideEnabled: !!clubForm.professorDurationOverrideEnabled,
        professorDurationOverrideMinutes:
          clubForm.professorDurationOverrideMinutes === '' ? 60 : Number(clubForm.professorDurationOverrideMinutes),
        bookingConfirmationMode: clubForm.bookingConfirmationMode,
        bookingDepositPercent: bookingDepositPercentPayload,
        allowManualConfirmationOverride: !!clubForm.allowManualConfirmationOverride,
        autoCancelPendingBookingsEnabled: !!clubForm.autoCancelPendingBookingsEnabled,
        autoCancelPendingBookingsMinutesBefore: clubForm.autoCancelPendingBookingsEnabled ? Number(cancelMinutesRaw) : null,
        autoCancelPendingBookingsOnlyIfUnpaid: !!clubForm.autoCancelPendingBookingsOnlyIfUnpaid,
        autoCancelPendingWarningEnabled: !!clubForm.autoCancelPendingBookingsEnabled && !!clubForm.autoCancelPendingWarningEnabled,
        autoCancelPendingWarningMinutesBefore:
          clubForm.autoCancelPendingBookingsEnabled && clubForm.autoCancelPendingWarningEnabled
            ? Number(warningMinutesRaw)
            : null,
        enforceCashShiftCloseWithOpenAccounts: !!clubForm.enforceCashShiftCloseWithOpenAccounts,
        bookingSimpleAdvanceDaysUser: Math.floor(simpleAdvanceUserRaw),
        bookingSimpleAdvanceDaysAdmin: Math.floor(simpleAdvanceAdminRaw),
        allowAdminSkipSimpleAdvanceLimit: !!clubForm.allowAdminSkipSimpleAdvanceLimit,
        openingDays: openingDaysSet,
        fixedBookingSettingsByActivity
      };
      const updatedClub = await ClubService.updateClub(club.id, payload);

      for (const activity of activityTypes) {
        const formConfig = activityScheduleForm[activity.id];
        if (!formConfig) continue;

        const durations = parseDurationsInput(formConfig.scheduleDurations, activity.defaultDurationMinutes);
        const fixedSlots = formConfig.scheduleMode === 'FIXED'
          ? parseFixedSlotsInput(formConfig.scheduleFixedSlots)
          : [];

        await ClubAdminService.updateActivityTypeSchedule(updatedClub.slug, activity.id, {
          scheduleMode: formConfig.scheduleMode,
          scheduleOpenTime: formConfig.scheduleMode === 'RANGE' ? formConfig.scheduleOpenTime : null,
          scheduleCloseTime: formConfig.scheduleMode === 'RANGE' ? formConfig.scheduleCloseTime : null,
          scheduleIntervalMinutes: formConfig.scheduleMode === 'RANGE' ? Number(formConfig.scheduleIntervalMinutes || 0) : null,
          scheduleDurations: durations,
          scheduleFixedSlots: fixedSlots
        });
      }

      setClub(updatedClub);
      initialConfigRef.current = cloneSnapshot({
        clubForm,
        openingDaysSet,
        activityScheduleForm
      });
      await loadPersistentConfigHistory(updatedClub.id);
      showInfo('Información del club actualizada correctamente', 'Éxito');
    } catch (error: any) {
      showError('Error al actualizar el club: ' + error.message);
    }
  };

  const handleCreateDiscountPolicy = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    if (!club) return;

    const amountValue = Number(discountPolicyForm.amountValue);
    const priority = Number(discountPolicyForm.priority);
    if (!discountPolicyForm.name.trim()) {
      showError('El nombre de la política es obligatorio');
      return;
    }
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      showError('El valor del descuento debe ser mayor a 0');
      return;
    }
    if (discountPolicyForm.amountType === 'PERCENT' && amountValue > 100) {
      showError('El porcentaje no puede superar 100');
      return;
    }
    if (!Number.isFinite(priority)) {
      showError('La prioridad es inválida');
      return;
    }

    try {
      await ClubAdminService.createDiscountPolicy(club.slug, {
        name: discountPolicyForm.name.trim(),
        scope: discountPolicyForm.scope,
        amountType: discountPolicyForm.amountType,
        amountValue,
        applyMode: discountPolicyForm.applyMode,
        isStackable: discountPolicyForm.isStackable,
        priority: Math.floor(priority)
      });
      setDiscountPolicyForm((prev) => ({
        ...prev,
        name: '',
        amountValue: '',
        priority: '100'
      }));
      await loadDiscountPolicies(club.slug);
      showInfo('Política de descuento creada', 'Éxito');
    } catch (error: any) {
      showError(`No se pudo crear la política: ${error.message}`);
    }
  };

  const handleStartEditDiscountPolicy = (policy: DiscountPolicyView) => {
    setEditingDiscountPolicyId(policy.id);
    setDiscountPolicyEditForm({
      name: policy.name || '',
      scope: policy.scope,
      amountType: policy.amountType,
      amountValue: String(policy.amountValue ?? ''),
      applyMode: policy.applyMode,
      isStackable: Boolean(policy.isStackable),
      priority: String(policy.priority ?? 100),
      isActive: Boolean(policy.isActive)
    });
  };

  const handleCancelEditDiscountPolicy = () => {
    setEditingDiscountPolicyId(null);
  };

  const handleSaveDiscountPolicy = async () => {
    if (!club || !editingDiscountPolicyId) return;
    const amountValue = Number(discountPolicyEditForm.amountValue);
    const priority = Number(discountPolicyEditForm.priority);

    if (!discountPolicyEditForm.name.trim()) {
      showError('El nombre de la política es obligatorio');
      return;
    }
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      showError('El valor del descuento debe ser mayor a 0');
      return;
    }
    if (discountPolicyEditForm.amountType === 'PERCENT' && amountValue > 100) {
      showError('El porcentaje no puede superar 100');
      return;
    }
    if (!Number.isFinite(priority)) {
      showError('La prioridad es inválida');
      return;
    }

    try {
      await ClubAdminService.updateDiscountPolicy(club.slug, editingDiscountPolicyId, {
        name: discountPolicyEditForm.name.trim(),
        scope: discountPolicyEditForm.scope,
        amountType: discountPolicyEditForm.amountType,
        amountValue,
        applyMode: discountPolicyEditForm.applyMode,
        isStackable: discountPolicyEditForm.isStackable,
        priority: Math.floor(priority),
        isActive: discountPolicyEditForm.isActive
      });
      setEditingDiscountPolicyId(null);
      await loadDiscountPolicies(club.slug);
      showInfo('Política actualizada', 'Éxito');
    } catch (error: any) {
      showError(`No se pudo actualizar la política: ${error.message}`);
    }
  };

  const handleAssignPolicyToClient = async () => {
    if (!club || !selectedDiscountClient?.id) return;
    if (!selectedPolicyIdForAssignment) {
      showError('Seleccioná una política para asignar');
      return;
    }
    try {
      await ClubAdminService.assignDiscountToClient(club.slug, selectedDiscountClient.id, {
        policyId: selectedPolicyIdForAssignment,
        notes: assignmentNotes.trim() || undefined
      });
      setSelectedPolicyIdForAssignment('');
      setAssignmentNotes('');
      await loadClientAssignments(club.slug, selectedDiscountClient.id);
      showInfo('Política asignada al cliente', 'Éxito');
    } catch (error: any) {
      showError(`No se pudo asignar: ${error.message}`);
    }
  };

  const handleToggleAssignment = async (assignmentId: string, nextStatus: boolean) => {
    if (!club || !selectedDiscountClient?.id) return;
    try {
      await ClubAdminService.updateDiscountAssignment(club.slug, assignmentId, nextStatus);
      await loadClientAssignments(club.slug, selectedDiscountClient.id);
    } catch (error: any) {
      showError(`No se pudo actualizar la asignación: ${error.message}`);
    }
  };

  const handleDiscountClientSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setClientSearch(value);

    if (clientSearchTimeoutRef.current) {
      clearTimeout(clientSearchTimeoutRef.current);
      clientSearchTimeoutRef.current = null;
    }

    const term = value.trim();
    if (!club || term.length < 2) {
      setClientSearchResults([]);
      setShowClientSearchDropdown(false);
      return;
    }

    clientSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchClients(club.slug, term);
        const normalized = Array.isArray(results) ? results : [];
        setClientSearchResults(normalized.slice(0, 20));
        setShowClientSearchDropdown(true);
      } catch (error: any) {
        setClientSearchResults([]);
        setShowClientSearchDropdown(false);
        showError(`No se pudo buscar clientes: ${error?.message || 'Error de búsqueda'}`);
      }
    }, 300);
  };

  const handleSelectDiscountClient = async (client: ClientSearchResult) => {
    if (!club) return;
    setSelectedDiscountClient(client);
    setClientSearch(`${String(client.firstName || '').trim()} ${String(client.lastName || '').trim()}`.trim() || String(client.id));
    setShowClientSearchDropdown(false);
    await loadClientAssignments(club.slug, client.id);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (clientSearchWrapperRef.current && !clientSearchWrapperRef.current.contains(event.target as Node)) {
        setShowClientSearchDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setLogoError('El archivo debe ser una imagen (PNG, JPG, etc).');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoError('El logo no puede pesar más de 2MB.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      setClubForm((prev) => ({ ...prev, logoUrl: result }));
      setLogoPreview(result);
      setLogoError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleClubImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setClubImageError('El archivo debe ser una imagen (PNG, JPG, etc).');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setClubImageError('La imagen no puede pesar más de 4MB.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      setClubForm((prev) => ({ ...prev, clubImageUrl: result }));
      setClubImagePreview(result);
      setClubImageError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setClubForm((prev) => ({ ...prev, logoUrl: '' }));
    setLogoPreview(null);
    setLogoError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveClubImage = () => {
    setClubForm((prev) => ({ ...prev, clubImageUrl: '' }));
    setClubImagePreview(null);
    setClubImageError(null);
    if (clubImageInputRef.current) clubImageInputRef.current.value = '';
  };

  const toggleOpeningDay = (day: number) => {
    setOpeningDaysSet((prev) => {
      if (prev.includes(day)) return prev.filter((d) => d !== day);
      return [...prev, day].sort((a, b) => a - b);
    });
  };

  const isDepositMode = clubForm.bookingConfirmationMode === 'DEPOSIT_REQUIRED';

  const inputClass = "w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-bold placeholder-[#347048]/20 focus:outline-none shadow-sm transition-all";
  const labelClass = "block text-[10px] font-black text-[#347048]/60 mb-1.5 uppercase tracking-widest ml-1";


  const formatPhoneInput = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    let rest = digits;
    if (rest.startsWith('54')) rest = rest.slice(2);
    if (rest.startsWith('9')) rest = rest.slice(1);
    const area = rest.slice(0, 3);
    const mid = rest.slice(3, 6);
    const end = rest.slice(6, 10);
    const parts = [area, mid, end].filter(Boolean);
    return `+54 9${parts.length ? ' ' : ''}${parts.join(' ')}`.trim();
  };

  return (
    <>
      <div className="bg-[#EBE1D8] border-4 border-white rounded-[2rem] p-8 mb-8 shadow-2xl shadow-[#347048]/30 relative overflow-hidden transition-all">
        {/* ENCABEZADO */}
        <div className="mb-8 pb-6 border-b border-[#347048]/10">
          <h2 className="text-2xl font-black text-[#926699] flex items-center gap-3 uppercase italic tracking-tight">
            <div className="bg-[#926699] text-[#EBE1D8] p-2 rounded-xl text-xl shadow-lg shadow-[#926699]/20">
              <Settings size={24} strokeWidth={3} />
            </div>
            Configuración del Club
          </h2>
          <p className="text-[#347048] text-sm font-bold opacity-70 mt-2 ml-1">Personaliza la identidad y reglas de tu establecimiento.</p>
        </div>

        {loadingClub ? (
          <div className="space-y-6 py-10">
            <div className="h-12 bg-white/50 animate-pulse rounded-2xl w-full"></div>
            <div className="h-12 bg-white/50 animate-pulse rounded-2xl w-full"></div>
            <div className="h-12 bg-white/50 animate-pulse rounded-2xl w-full"></div>
          </div>
        ) : club ? (
          <form onSubmit={handleUpdateClub} className="space-y-8 relative z-10 pb-24">
            <div className="space-y-6 rounded-[1.75rem] border-2 border-[#347048]/20 bg-white/30 p-5">
              <div className="rounded-2xl border border-[#347048]/15 bg-white/40 p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#347048]/70">Bloque de bajo riesgo</p>
                <p className="text-[12px] font-bold text-[#347048]/70 mt-1">Identidad del club y datos visibles para clientes.</p>
              </div>
            {/* GRID DE DATOS BÁSICOS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className={labelClass}>Slug (Identificador URL)</label>
                <input type="text" value={clubForm.slug} onChange={(e) => setClubForm({ ...clubForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                  className={inputClass} placeholder="ej: las-tejas-padel" required />
                <p className="text-[10px] font-bold text-[#347048]/40 mt-1.5 ml-1">Tu link será: <span className="text-[#347048]">tucancha.com/club/{clubForm.slug || '...'}</span></p>
              </div>
              <div>
                <label className={labelClass}>Nombre Comercial</label>
                <input type="text" value={clubForm.name} onChange={(e) => setClubForm({ ...clubForm, name: e.target.value })} className={inputClass} required />
              </div>
              
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <label className={labelClass}>Dirección</label>
                  <input type="text" value={clubForm.addressLine} onChange={(e) => setClubForm({ ...clubForm, addressLine: e.target.value })} className={inputClass} placeholder="Calle y número" required />
                </div>
                <div>
                  <label className={labelClass}>Ciudad</label>
                  <input type="text" value={clubForm.city} onChange={(e) => setClubForm({ ...clubForm, city: e.target.value })} className={inputClass} required />
                </div>
                <div>
                  <label className={labelClass}>Provincia / Estado</label>
                  <input type="text" value={clubForm.province} onChange={(e) => setClubForm({ ...clubForm, province: e.target.value })} className={inputClass} required />
                </div>
              </div>

                {/* DIAS DE APERTURA */}
                <div className="bg-white/10 p-6 rounded-[1.5rem] border-2 border-white/10">
                  <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[#347048] mb-3">Días de apertura</h3>
                  <p className="text-[12px] text-[#347048]/70 mb-3">Seleccioná los días en los que el club está abierto (si no se selecciona ninguno, se entiende &quot;abre todos los días&quot;).</p>
                  <div className="flex gap-2 flex-wrap">
                    {['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map((label, idx) => {
                      const day = idx % 7; // 0..6
                      const active = openingDaysSet.includes(day);
                      return (
                        <button key={label} type="button" onClick={() => toggleOpeningDay(day)} className={`px-3 py-2 rounded-lg font-bold text-sm transition-all ${active ? 'bg-[#B9CF32] text-[#347048]' : 'bg-white text-[#347048]/90 border border-white/10'}`}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

              <div>
                <label className={labelClass}>Email Administrativo</label>
                <div className="relative">
                  <input type="email" value={clubForm.contactInfo} onChange={(e) => setClubForm({ ...clubForm, contactInfo: e.target.value })} className={`${inputClass} pl-11`} required />
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/30" size={16} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Teléfono Público</label>
                <div className="relative">
                  <input
                    type="text"
                    value={clubForm.phone}
                    maxLength={18}
                    onChange={(e) => setClubForm({ ...clubForm, phone: formatPhoneInput(e.target.value) })}
                    className={`${inputClass} pl-11`}
                    placeholder="+54 9 351..."
                  />
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/30" size={16} />
                </div>
              </div>
            </div>

            {/* SECCIÓN DE LOGO */}
            <div className="bg-white/40 p-6 rounded-[1.5rem] border-2 border-white shadow-sm">
              <label className={labelClass}>Identidad Visual (Logo)</label>
              <div className="flex flex-col sm:flex-row items-center gap-6 mt-2">
                <div className="w-24 h-24 rounded-2xl overflow-hidden border-4 border-white bg-white shadow-md flex items-center justify-center relative group">
                  {logoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoPreview} alt="Logo" className="w-full h-full object-contain p-1" />
                  ) : (
                    <ImageIcon size={32} className="text-[#347048]/20" />
                  )}
                </div>
                <div className="flex-1 space-y-3">
                  <div className="flex gap-3">
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="px-5 py-2.5 rounded-xl text-xs font-black bg-[#347048] text-[#EBE1D8] hover:bg-[#B9CF32] hover:text-[#347048] transition-all uppercase tracking-widest shadow-lg shadow-[#347048]/20">
                      Subir Imagen
                    </button>
                    {logoPreview && (
                      <button type="button" onClick={handleRemoveLogo} className="px-5 py-2.5 rounded-xl text-xs font-black bg-red-50 text-red-600 border border-red-100 hover:bg-red-600 hover:text-white transition-all uppercase tracking-widest">
                        Eliminar
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] font-bold text-[#347048]/40 uppercase tracking-wider italic">Recomendado: 512x512px, máx 2MB (PNG/JPG).</p>
                  {logoError && (
                    <p className="text-xs text-red-500 font-bold italic flex items-center gap-1">
                      <AlertTriangle size={12} /> {logoError}
                    </p>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFileChange} />
              </div>
            </div>

            {/* SECCIÓN DE IMAGEN DEL CLUB */}
            <div className="bg-white/40 p-6 rounded-[1.5rem] border-2 border-white shadow-sm">
              <label className={labelClass}>Imagen del Club (Portada)</label>
              <div className="flex flex-col lg:flex-row items-start lg:items-center gap-6 mt-2">
                <div className="w-full lg:w-64 h-36 rounded-2xl overflow-hidden border-4 border-white bg-white shadow-md flex items-center justify-center relative group">
                  {clubImagePreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={clubImagePreview} alt="Imagen del club" className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center text-[#347048]/30">
                      <ImageIcon size={32} />
                      <span className="text-[10px] font-bold uppercase mt-2">Sin imagen</span>
                    </div>
                  )}
                </div>
                <div className="flex-1 space-y-3">
                  <div className="flex gap-3 flex-wrap">
                    <button type="button" onClick={() => clubImageInputRef.current?.click()} className="px-5 py-2.5 rounded-xl text-xs font-black bg-[#347048] text-[#EBE1D8] hover:bg-[#B9CF32] hover:text-[#347048] transition-all uppercase tracking-widest shadow-lg shadow-[#347048]/20">
                      Subir Imagen
                    </button>
                    {clubImagePreview && (
                      <button type="button" onClick={handleRemoveClubImage} className="px-5 py-2.5 rounded-xl text-xs font-black bg-red-50 text-red-600 border border-red-100 hover:bg-red-600 hover:text-white transition-all uppercase tracking-widest">
                        Eliminar
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] font-bold text-[#347048]/40 uppercase tracking-wider italic">Recomendado: 1600x900px, máx 4MB (PNG/JPG).</p>
                  {clubImageError && (
                    <p className="text-xs text-red-500 font-bold italic flex items-center gap-1">
                      <AlertTriangle size={12} /> {clubImageError}
                    </p>
                  )}
                </div>
                <input ref={clubImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleClubImageFileChange} />
              </div>
            </div>

            {/* REDES SOCIALES */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-1.5">
                <label className={labelClass}>Instagram URL</label>
                <div className="relative group">
                  <input type="url" value={clubForm.instagramUrl} onChange={(e) => setClubForm({ ...clubForm, instagramUrl: e.target.value })} className={`${inputClass} pl-11`} placeholder="https://instagram.com/..." />
                  <Instagram className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/30 group-focus-within:text-[#926699]" size={16} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>Facebook URL</label>
                <div className="relative group">
                  <input type="url" value={clubForm.facebookUrl} onChange={(e) => setClubForm({ ...clubForm, facebookUrl: e.target.value })} className={`${inputClass} pl-11`} placeholder="https://facebook.com/..." />
                  <Facebook className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/30 group-focus-within:text-[#347048]" size={16} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>Sitio Web Propio</label>
                <div className="relative group">
                  <input type="url" value={clubForm.websiteUrl} onChange={(e) => setClubForm({ ...clubForm, websiteUrl: e.target.value })} className={`${inputClass} pl-11`} placeholder="https://mi-club.com" />
                  <Globe className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/30 group-focus-within:text-[#B9CF32]" size={16} />
                </div>
              </div>
            </div>

            {/* DESCRIPCIÃ“N */}
            <div className="space-y-2">
              <label className={labelClass}>DescripciÃ³n del Club / InformaciÃ³n Adicional</label>
              <textarea
                value={clubForm.description}
                onChange={(e) => setClubForm({ ...clubForm, description: e.target.value.slice(0, 100) })}
                maxLength={50}
                className="w-full bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-[1.5rem] p-5 text-[#347048] font-bold placeholder-[#347048]/20 focus:outline-none shadow-sm transition-all resize-none"
                rows={4}
                placeholder="Escribe aquÃ­ las reglas del club, servicios (duchas, buffet, etc) o historia..."
              />
            </div>

            </div>

            <div className="space-y-6 rounded-[1.75rem] border-2 border-[#926699]/35 bg-[#926699]/5 p-5">
              <div className="rounded-2xl border-2 border-[#926699]/30 bg-[#926699]/10 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#347048]">Bloque de alto riesgo</p>
                    <p className="text-[12px] font-bold text-[#347048]/80 mt-1">Reglas operativas que impactan reservas, cobros y disponibilidad.</p>
                  </div>
                  <button
                    type="button"
                    onClick={restoreBookingPolicyDefaults}
                    className="h-10 px-4 rounded-xl bg-white border border-[#347048]/20 text-[#347048] text-[11px] font-black uppercase tracking-widest hover:border-[#B9CF32]"
                  >
                    Restaurar recomendados
                  </button>
                </div>
              </div>

            {/* LUCES Y HORARIOS (LIMA ACCENT) */}
            <div className="bg-[#B9CF32]/10 p-6 rounded-[1.5rem] border-2 border-[#B9CF32]/20">
              <div className="flex items-center gap-2 mb-4 text-[#347048]">
                <Lightbulb size={18} strokeWidth={3} />
                <h3 className="text-xs font-black uppercase tracking-[0.2em]">Configuración de Iluminación</h3>
              </div>
              <div className="flex flex-col md:flex-row gap-8 items-start md:items-center">
                <label className="flex items-center gap-3 text-[#347048] font-black cursor-pointer group">
                  <div className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all ${clubForm.lightsEnabled ? 'bg-[#347048] border-[#347048] text-white shadow-sm' : 'border-[#347048]/25 bg-white text-transparent'}`}>
                    {clubForm.lightsEnabled && <Check size={15} strokeWidth={4} />}
                  </div>
                  <input type="checkbox" checked={clubForm.lightsEnabled} onChange={(e) => setClubForm({ ...clubForm, lightsEnabled: e.target.checked })} className="hidden" />
                  <span className="text-sm uppercase tracking-wide italic">Activar recargo nocturno</span>
                </label>
                <div className="flex flex-wrap gap-6">
                  <div>
                    <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Monto Extra ($)</label>
                    <input type="number" min={0} step={100} disabled={!clubForm.lightsEnabled} value={clubForm.lightsExtraAmount}
                      onChange={(e) => setClubForm({ ...clubForm, lightsExtraAmount: e.target.value })}
                      className="w-32 h-10 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-black text-sm disabled:opacity-30 transition-all" placeholder="5000" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Desde la hora</label>
                    <select disabled={!clubForm.lightsEnabled} value={clubForm.lightsFromHour || ''} onChange={(e) => setClubForm({ ...clubForm, lightsFromHour: e.target.value })}
                      className="h-10 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-black text-sm disabled:opacity-30 transition-all cursor-pointer">
                      <option value="">Seleccionar...</option>
                      {["18:00", "19:00", "20:00", "21:00", "22:00"].map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* PROFESOR (REGLA OPERATIVA) */}
            <div className="bg-[#926699]/10 p-6 rounded-[1.5rem] border-2 border-[#926699]/20">
              <div className="flex items-center gap-2 mb-4 text-[#347048]">
                <Save size={18} strokeWidth={3} />
                <h3 className="text-xs font-black uppercase tracking-[0.2em]">Profesor (operativo)</h3>
              </div>
              <p className="text-[11px] text-[#347048]/70 font-bold mt-3">
                Los descuentos económicos se configuran en &quot;Descuentos por cliente&quot;. Esta sección solo define el ajuste operativo.
              </p>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex items-center gap-3 text-[#347048] font-black cursor-pointer group">
                  <div className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all ${clubForm.professorDurationOverrideEnabled ? 'bg-[#347048] border-[#347048] text-white shadow-sm' : 'border-[#347048]/25 bg-white text-transparent'}`}>
                    {clubForm.professorDurationOverrideEnabled && <Check size={15} strokeWidth={4} />}
                  </div>
                  <input
                    type="checkbox"
                    checked={clubForm.professorDurationOverrideEnabled}
                    onChange={(e) => setClubForm({ ...clubForm, professorDurationOverrideEnabled: e.target.checked })}
                    className="hidden"
                  />
                  <span className="text-sm uppercase tracking-wide italic">Permitir ajuste operativo para profesor</span>
                </label>
                <div>
                  <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Duración especial (min)</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    disabled={!clubForm.professorDurationOverrideEnabled}
                    value={clubForm.professorDurationOverrideMinutes}
                    onChange={(e) => setClubForm({ ...clubForm, professorDurationOverrideMinutes: e.target.value })}
                    className="w-32 h-10 bg-white border-2 border-transparent focus:border-[#926699] rounded-xl px-3 text-[#347048] font-black text-sm disabled:opacity-30 transition-all"
                    placeholder="60"
                  />
                </div>
              </div>
            </div>

            <div className="bg-[#347048]/10 p-6 rounded-[1.5rem] border-2 border-[#347048]/20">
              <div className="flex items-center gap-2 mb-4 text-[#347048]">
                <Settings size={18} strokeWidth={3} />
                <h3 className="text-xs font-black uppercase tracking-[0.2em]">Confirmación de reservas</h3>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Modo de confirmación</label>
                  <select
                    value={clubForm.bookingConfirmationMode}
                    onChange={(e) => {
                      const nextMode = e.target.value as BookingConfirmationMode;
                      setClubForm((prev) => ({
                        ...prev,
                        bookingConfirmationMode: nextMode,
                        bookingDepositPercent: nextMode === 'DEPOSIT_REQUIRED' ? prev.bookingDepositPercent : ''
                      }));
                    }}
                    className="w-full md:w-[360px] h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-black text-sm"
                  >
                    {BOOKING_CONFIRMATION_MODES.map((mode) => (
                      <option key={mode.value} value={mode.value}>{mode.label}</option>
                    ))}
                  </select>
                  <p className="text-[11px] font-bold text-[#347048]/60 mt-2">
                    {BOOKING_CONFIRMATION_MODES.find((mode) => mode.value === clubForm.bookingConfirmationMode)?.helper}
                  </p>
                </div>

                {isDepositMode ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Seña mínima (%)</label>
                      <input
                        type="number"
                        min={0.01}
                        max={100}
                        step={0.01}
                        value={clubForm.bookingDepositPercent}
                        onChange={(e) => setClubForm((prev) => ({ ...prev, bookingDepositPercent: e.target.value }))}
                        className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-black text-sm transition-all"
                        placeholder="Ej: 30"
                        required={isDepositMode}
                      />
                      <p className="text-[10px] font-bold text-[#347048]/50 mt-1">
                        Obligatorio para confirmar automáticamente por pago en modo seña.
                      </p>
                    </div>

                    <div className="flex items-end">
                      <label className="flex items-center gap-3 text-[#347048] font-black cursor-pointer group">
                        <div className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all ${clubForm.allowManualConfirmationOverride ? 'bg-[#347048] border-[#347048] text-white shadow-sm' : 'border-[#347048]/25 bg-white text-transparent'}`}>
                          {clubForm.allowManualConfirmationOverride && <Check size={15} strokeWidth={4} />}
                        </div>
                        <input
                          type="checkbox"
                          checked={clubForm.allowManualConfirmationOverride}
                          onChange={(e) => setClubForm((prev) => ({ ...prev, allowManualConfirmationOverride: e.target.checked }))}
                          className="hidden"
                        />
                        <span className="text-sm tracking-wide">Permitir confirmación manual de excepción</span>
                      </label>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="bg-[#347048]/10 p-6 rounded-[1.5rem] border-2 border-[#347048]/20">
              <div className="flex items-center gap-2 mb-4 text-[#347048]">
                <Settings size={18} strokeWidth={3} />
                <h3 className="text-xs font-black uppercase tracking-[0.2em]">Anticipación reservas simples</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Usuarios (días)</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={clubForm.bookingSimpleAdvanceDaysUser}
                    onChange={(e) => setClubForm((prev) => ({ ...prev, bookingSimpleAdvanceDaysUser: e.target.value }))}
                    className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-black text-sm transition-all"
                    placeholder="Ej: 30"
                  />
                  <p className="text-[10px] font-bold text-[#347048]/50 mt-1">
                    0 significa solo el día actual.
                  </p>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Administradores (días)</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={clubForm.bookingSimpleAdvanceDaysAdmin}
                    onChange={(e) => setClubForm((prev) => ({ ...prev, bookingSimpleAdvanceDaysAdmin: e.target.value }))}
                    className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-black text-sm transition-all"
                    placeholder="Ej: 60"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="flex items-center gap-3 text-[#347048] font-black cursor-pointer group">
                    <div className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all ${clubForm.allowAdminSkipSimpleAdvanceLimit ? 'bg-[#347048] border-[#347048] text-white shadow-sm' : 'border-[#347048]/25 bg-white text-transparent'}`}>
                      {clubForm.allowAdminSkipSimpleAdvanceLimit && <Check size={15} strokeWidth={4} />}
                    </div>
                    <input
                      type="checkbox"
                      checked={clubForm.allowAdminSkipSimpleAdvanceLimit}
                      onChange={(e) => setClubForm((prev) => ({ ...prev, allowAdminSkipSimpleAdvanceLimit: e.target.checked }))}
                      className="hidden"
                    />
                    <span className="text-sm tracking-wide">Permitir que admin se saltee el límite</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="bg-[#926699]/10 p-6 rounded-[1.5rem] border-2 border-[#926699]/20">
              <div className="flex items-center gap-2 mb-4 text-[#347048]">
                <AlertTriangle size={18} strokeWidth={3} />
                <h3 className="text-xs font-black uppercase tracking-[0.2em]">Cancelación automática de pendientes</h3>
              </div>

              <div className="space-y-4">
                <label className="flex items-center gap-3 text-[#347048] font-black cursor-pointer group">
                  <div className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all ${clubForm.autoCancelPendingBookingsEnabled ? 'bg-[#347048] border-[#347048] text-white shadow-sm' : 'border-[#347048]/25 bg-white text-transparent'}`}>
                    {clubForm.autoCancelPendingBookingsEnabled && <Check size={15} strokeWidth={4} />}
                  </div>
                  <input
                    type="checkbox"
                    checked={clubForm.autoCancelPendingBookingsEnabled}
                    onChange={(e) => setClubForm((prev) => ({
                      ...prev,
                      autoCancelPendingBookingsEnabled: e.target.checked,
                      autoCancelPendingWarningEnabled: e.target.checked ? prev.autoCancelPendingWarningEnabled : false
                    }))}
                    className="hidden"
                  />
                  <span className="text-sm tracking-wide">Activar cancelación automática de reservas pendientes</span>
                </label>
                <p className="text-[11px] text-[#347048]/70 font-bold">
                  Solo aplica a reservas <span className="font-black">Pendiente</span>. Las confirmadas nunca se cancelan automáticamente.
                </p>

                {clubForm.autoCancelPendingBookingsEnabled ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Cancelar si faltan (min)</label>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={clubForm.autoCancelPendingBookingsMinutesBefore}
                        onChange={(e) => setClubForm((prev) => ({ ...prev, autoCancelPendingBookingsMinutesBefore: e.target.value }))}
                        className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-black text-sm transition-all"
                        placeholder="Ej: 60"
                      />
                    </div>

                    <div className="flex items-end">
                      <label className="flex items-center gap-3 text-[#347048] font-black cursor-pointer group">
                        <div className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all ${clubForm.autoCancelPendingBookingsOnlyIfUnpaid ? 'bg-[#347048] border-[#347048] text-white shadow-sm' : 'border-[#347048]/25 bg-white text-transparent'}`}>
                          {clubForm.autoCancelPendingBookingsOnlyIfUnpaid && <Check size={15} strokeWidth={4} />}
                        </div>
                        <input
                          type="checkbox"
                          checked={clubForm.autoCancelPendingBookingsOnlyIfUnpaid}
                          onChange={(e) => setClubForm((prev) => ({ ...prev, autoCancelPendingBookingsOnlyIfUnpaid: e.target.checked }))}
                          className="hidden"
                        />
                        <span className="text-sm tracking-wide">Solo cancelar si está impaga (neto 0)</span>
                      </label>
                    </div>

                    <div className="md:col-span-2 pt-1 border-t border-[#347048]/10">
                      <label className="flex items-center gap-3 text-[#347048] font-black cursor-pointer group">
                        <div className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all ${clubForm.autoCancelPendingWarningEnabled ? 'bg-[#347048] border-[#347048] text-white shadow-sm' : 'border-[#347048]/25 bg-white text-transparent'}`}>
                          {clubForm.autoCancelPendingWarningEnabled && <Check size={15} strokeWidth={4} />}
                        </div>
                        <input
                          type="checkbox"
                          checked={clubForm.autoCancelPendingWarningEnabled}
                          onChange={(e) => setClubForm((prev) => ({ ...prev, autoCancelPendingWarningEnabled: e.target.checked }))}
                          className="hidden"
                        />
                        <span className="text-sm tracking-wide">Enviar aviso previo al cliente</span>
                      </label>
                    </div>

                    {clubForm.autoCancelPendingWarningEnabled ? (
                      <div>
                        <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Avisar si faltan (min)</label>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={clubForm.autoCancelPendingWarningMinutesBefore}
                          onChange={(e) => setClubForm((prev) => ({ ...prev, autoCancelPendingWarningMinutesBefore: e.target.value }))}
                          className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-black text-sm transition-all"
                          placeholder="Ej: 180"
                        />
                        <p className="text-[10px] text-[#347048]/60 font-bold mt-1">
                          El aviso debe dispararse antes que la cancelación automática.
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="bg-[#347048]/10 p-6 rounded-[1.5rem] border-2 border-[#347048]/20">
              <div className="flex items-center gap-2 mb-4 text-[#347048]">
                <AlertTriangle size={18} strokeWidth={3} />
                <h3 className="text-xs font-black uppercase tracking-[0.2em]">Cierre de caja</h3>
              </div>
              <div className="space-y-3">
                <label className="flex items-center gap-3 text-[#347048] font-black cursor-pointer group">
                  <div className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all ${clubForm.enforceCashShiftCloseWithOpenAccounts ? 'bg-[#347048] border-[#347048] text-white shadow-sm' : 'border-[#347048]/25 bg-white text-transparent'}`}>
                    {clubForm.enforceCashShiftCloseWithOpenAccounts && <Check size={15} strokeWidth={4} />}
                  </div>
                  <input
                    type="checkbox"
                    checked={clubForm.enforceCashShiftCloseWithOpenAccounts}
                    onChange={(e) => setClubForm((prev) => ({ ...prev, enforceCashShiftCloseWithOpenAccounts: e.target.checked }))}
                    className="hidden"
                  />
                  <span className="text-sm tracking-wide">Modo estricto: bloquear cierre de caja si hay cuentas abiertas</span>
                </label>
                <p className="text-[11px] text-[#347048]/70 font-bold">
                  Recomendado desactivado. Si está activo, no se podrá cerrar la caja mientras exista al menos una cuenta abierta.
                </p>
              </div>
            </div>

            <div className="mt-3 bg-[#347048]/10 p-6 rounded-[1.5rem] border-2 border-[#347048]/20">
              <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#347048] mb-2">Configuración de horarios por actividad</h4>
              <p className="text-[11px] font-bold text-[#347048]/60 mb-4">
                Definí acá horario de entrada/salida, duración de turnos y turnos fijos por cada actividad.
              </p>

              {activityTypes.length === 0 ? (
                <p className="text-[11px] font-bold text-[#347048]/60">No hay actividades configuradas para este club.</p>
              ) : (
                <div className="space-y-4">
                  {activityTypes.map((activity) => {
                    const cfg = activityScheduleForm[activity.id];
                    if (!cfg) return null;
                    return (
                      <div key={activity.id} className="bg-white/40 p-4 rounded-2xl border border-white">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
                          <p className="text-sm font-black text-[#347048] uppercase tracking-wide">{activity.name}</p>
                          <p className="text-[10px] font-black text-[#347048]/50 uppercase tracking-widest">
                            Duración por defecto: {activity.defaultDurationMinutes} min
                          </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                          <div>
                            <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Modo</label>
                            <select
                              value={cfg.scheduleMode}
                              onChange={(e) => setActivityScheduleForm((prev) => ({
                                ...prev,
                                [activity.id]: { ...prev[activity.id], scheduleMode: e.target.value as 'FIXED' | 'RANGE' }
                              }))}
                              className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-black text-sm"
                            >
                              <option value="FIXED">Turnos fijos</option>
                              <option value="RANGE">Rango horario</option>
                            </select>
                          </div>

                          <div className="md:col-span-3">
                            <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Duraciones (min, separadas por coma)</label>
                            <input
                              type="text"
                              value={cfg.scheduleDurations}
                              onChange={(e) => setActivityScheduleForm((prev) => ({
                                ...prev,
                                [activity.id]: { ...prev[activity.id], scheduleDurations: e.target.value }
                              }))}
                              className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-black text-sm"
                              placeholder="60, 90"
                            />
                          </div>

                          {cfg.scheduleMode === 'RANGE' ? (
                            <>
                              <div>
                                <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Apertura</label>
                                <input
                                  type="time"
                                  value={cfg.scheduleOpenTime}
                                  onChange={(e) => setActivityScheduleForm((prev) => ({
                                    ...prev,
                                    [activity.id]: { ...prev[activity.id], scheduleOpenTime: e.target.value }
                                  }))}
                                  className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-black text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Cierre</label>
                                <input
                                  type="time"
                                  value={cfg.scheduleCloseTime}
                                  onChange={(e) => setActivityScheduleForm((prev) => ({
                                    ...prev,
                                    [activity.id]: { ...prev[activity.id], scheduleCloseTime: e.target.value }
                                  }))}
                                  className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-black text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Intervalo (min)</label>
                                <input
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={cfg.scheduleIntervalMinutes}
                                  onChange={(e) => setActivityScheduleForm((prev) => ({
                                    ...prev,
                                    [activity.id]: { ...prev[activity.id], scheduleIntervalMinutes: e.target.value }
                                  }))}
                                  className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-black text-sm"
                                />
                              </div>
                            </>
                          ) : (
                            <div className="md:col-span-4">
                              <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Turnos fijos (uno por línea: HH:mm-60)</label>
                              <textarea
                                rows={4}
                                value={cfg.scheduleFixedSlots}
                                onChange={(e) => setActivityScheduleForm((prev) => ({
                                  ...prev,
                                  [activity.id]: { ...prev[activity.id], scheduleFixedSlots: e.target.value }
                                }))}
                                className="w-full bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 py-3 text-[#347048] font-black text-sm resize-none"
                                placeholder={'08:00-60\n09:00-60\n10:30-90'}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-[#347048]/10 p-6 rounded-[1.5rem] border-2 border-[#347048]/20">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2 bg-white/40 p-4 rounded-2xl border border-white">
                  <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#347048] mb-3">Turnos fijos por actividad</h4>
                  {activitySettings.length === 0 ? (
                    <p className="text-[11px] font-bold text-[#347048]/60">
                      No hay actividades asociadas al club. Asigná actividades a las canchas para configurar turnos fijos por actividad.
                    </p>
                  ) : (
                  <div className="space-y-3">
                    {activitySettings.map((activity) => (
                      <div key={activity.key} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                        <div>
                          <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Actividad</label>
                          <input
                            type="text"
                            value={activity.label}
                            readOnly
                            className="w-full h-11 bg-[#EBE1D8] border-2 border-transparent rounded-xl px-4 text-[#347048] font-black text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Días hacia adelante</label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={clubForm.fixedBookingSettingsByActivity[activity.key]?.fixedBookingDaysAhead ?? DEFAULT_FIXED_BOOKING_DAYS_AHEAD}
                            onChange={(e) => setClubForm((prev) => ({
                              ...prev,
                              fixedBookingSettingsByActivity: {
                                ...prev.fixedBookingSettingsByActivity,
                                [activity.key]: {
                                  ...(prev.fixedBookingSettingsByActivity[activity.key] || {
                                    fixedBookingDaysAhead: DEFAULT_FIXED_BOOKING_DAYS_AHEAD,
                                    fixedBookingGenerationFrequencyDays: DEFAULT_FIXED_BOOKING_GENERATION_FREQUENCY_DAYS
                                  }),
                                  fixedBookingDaysAhead: e.target.value
                                }
                              }
                            }))}
                            className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-black text-sm transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Frecuencia generación (días)</label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={clubForm.fixedBookingSettingsByActivity[activity.key]?.fixedBookingGenerationFrequencyDays ?? DEFAULT_FIXED_BOOKING_GENERATION_FREQUENCY_DAYS}
                            onChange={(e) => setClubForm((prev) => ({
                              ...prev,
                              fixedBookingSettingsByActivity: {
                                ...prev.fixedBookingSettingsByActivity,
                                [activity.key]: {
                                  ...(prev.fixedBookingSettingsByActivity[activity.key] || {
                                    fixedBookingDaysAhead: DEFAULT_FIXED_BOOKING_DAYS_AHEAD,
                                    fixedBookingGenerationFrequencyDays: DEFAULT_FIXED_BOOKING_GENERATION_FREQUENCY_DAYS
                                  }),
                                  fixedBookingGenerationFrequencyDays: e.target.value
                                }
                              }
                            }))}
                            className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-black text-sm transition-all"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  )}
                </div>
              </div>
            </div>

            </div>


            <div className="bg-[#347048]/10 p-6 rounded-[1.5rem] border-2 border-[#347048]/20">
              <div className="rounded-2xl border-2 border-[#B9CF32]/30 bg-[#B9CF32]/10 p-4 mb-4">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#347048]">Bloque medio-alto riesgo</p>
                <p className="text-[12px] font-bold text-[#347048]/80 mt-1">Descuentos por cliente impactan ingresos y margenes.</p>
              </div>
              <div className="flex items-center gap-2 mb-4 text-[#347048]">
                <Settings size={18} strokeWidth={3} />
                <h3 className="text-xs font-black uppercase tracking-[0.2em]">Descuentos por cliente</h3>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="bg-white/40 p-4 rounded-2xl border border-white">
                  <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#347048] mb-3">Nueva política</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Nombre</label>
                      <input
                        type="text"
                        value={discountPolicyForm.name}
                        onChange={(e) => setDiscountPolicyForm((prev) => ({ ...prev, name: e.target.value }))}
                        className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-black text-sm"
                        placeholder="Ej: Amigo 20% turnos"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Alcance</label>
                      <select
                        value={discountPolicyForm.scope}
                        onChange={(e) => setDiscountPolicyForm((prev) => ({ ...prev, scope: e.target.value as DiscountPolicyScope }))}
                        className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-black text-sm"
                      >
                        <option value="BOOKING">Reserva</option>
                        <option value="PRODUCT">Producto</option>
                        <option value="SERVICE">Servicio</option>
                        <option value="ALL">Todo</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Tipo</label>
                      <select
                        value={discountPolicyForm.amountType}
                        onChange={(e) => setDiscountPolicyForm((prev) => ({ ...prev, amountType: e.target.value as DiscountAmountType }))}
                        className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-black text-sm"
                      >
                        <option value="PERCENT">Porcentaje</option>
                        <option value="FIXED">Monto fijo</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Valor</label>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={discountPolicyForm.amountValue}
                        onChange={(e) => setDiscountPolicyForm((prev) => ({ ...prev, amountValue: e.target.value }))}
                        className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-black text-sm"
                        placeholder={discountPolicyForm.amountType === 'PERCENT' ? '20' : '1000'}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Prioridad</label>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={discountPolicyForm.priority}
                        onChange={(e) => setDiscountPolicyForm((prev) => ({ ...prev, priority: e.target.value }))}
                        className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-black text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Modo de aplicación</label>
                      <select
                        value={discountPolicyForm.applyMode}
                        onChange={(e) => setDiscountPolicyForm((prev) => ({ ...prev, applyMode: e.target.value as DiscountApplyMode }))}
                        className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-black text-sm"
                      >
                        <option value="INCLUDE_ONLY">Solo incluidos</option>
                        <option value="EXCLUDE_LIST">Excluir lista</option>
                      </select>
                    </div>
                    <label className="md:col-span-2 flex items-center gap-3 text-[#347048] font-black cursor-pointer">
                      <input
                        type="checkbox"
                        checked={discountPolicyForm.isStackable}
                        onChange={(e) => setDiscountPolicyForm((prev) => ({ ...prev, isStackable: e.target.checked }))}
                      />
                      <span className="text-sm uppercase tracking-wide">Acumulable</span>
                    </label>
                    <div className="md:col-span-2">
                      <button
                        type="button"
                        onClick={handleCreateDiscountPolicy}
                        className="w-full h-11 bg-[#347048] hover:bg-[#B9CF32] text-[#EBE1D8] hover:text-[#347048] rounded-xl font-black text-sm uppercase tracking-widest transition-all"
                      >
                        Crear Política
                      </button>
                    </div>
                  </div>

                  <div className="mt-4">
                    <h5 className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50 mb-2">Políticas actuales</h5>
                    {loadingDiscountPolicies ? (
                      <p className="text-[11px] font-bold text-[#347048]/60">Cargando...</p>
                    ) : discountPolicies.length === 0 ? (
                      <p className="text-[11px] font-bold text-[#347048]/60">Sin políticas cargadas.</p>
                    ) : (
                      <div className="space-y-2 max-h-56 overflow-auto pr-1">
                        {discountPolicies.map((policy) => (
                          <div key={policy.id} className="bg-white rounded-xl border border-white/70 p-3 text-[#347048]">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-black text-sm">{policy.name}</p>
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${policy.isActive ? 'bg-[#B9CF32]/50' : 'bg-[#926699]/20'}`}>
                                  {policy.isActive ? 'ACTIVA' : 'INACTIVA'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleStartEditDiscountPolicy(policy)}
                                  className="px-2 py-1 rounded-lg bg-[#347048]/10 text-[#347048] text-[10px] font-black uppercase tracking-widest hover:bg-[#347048]/20"
                                >
                                  Editar
                                </button>
                              </div>
                            </div>
                            <p className="text-[11px] font-bold opacity-80 mt-1">
                              {formatDiscountScopeLabel(policy.scope)} · {formatDiscountAmountTypeLabel(policy.amountType)} {Number(policy.amountValue)} · prioridad {policy.priority} · {policy.isStackable ? 'acumulable' : 'no acumulable'}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white/40 p-4 rounded-2xl border border-white">
                  <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#347048] mb-3">Asignación a cliente</h4>
                  <div className="space-y-3">
                    <div className="relative z-20" ref={clientSearchWrapperRef}>
                      <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Buscar cliente</label>
                      <input
                        type="text"
                        value={clientSearch}
                        onChange={handleDiscountClientSearchChange}
                        className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-black text-sm"
                        placeholder="Nombre, teléfono, DNI, email"
                      />
                      {showClientSearchDropdown && clientSearchResults.length > 0 ? (
                        <div className="absolute z-[120] mt-2 w-full max-h-56 overflow-auto rounded-xl border border-white/70 bg-white shadow-xl">
                          {clientSearchResults.map((client) => {
                            const fullName = `${String(client.firstName || '').trim()} ${String(client.lastName || '').trim()}`.trim() || 'Sin nombre';
                            return (
                              <button
                                type="button"
                                key={client.id}
                                onClick={() => handleSelectDiscountClient(client)}
                                className="w-full text-left px-3 py-2 text-sm font-bold text-[#347048] hover:bg-[#B9CF32]/20 transition-all border-b last:border-b-0 border-white/60"
                              >
                                {fullName} {client.dni ? `· DNI ${client.dni}` : ''}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                    {showClientSearchDropdown && clientSearch.trim().length >= 2 && clientSearchResults.length === 0 ? (
                      <p className="text-[11px] font-bold text-[#347048]/60">Sin resultados para esa búsqueda.</p>
                    ) : null}

                    {selectedDiscountClient ? (
                      <div className="rounded-xl border border-white/70 bg-white p-3">
                        <p className="text-sm font-black text-[#347048]">
                          Cliente seleccionado: {`${selectedDiscountClient.firstName || ''} ${selectedDiscountClient.lastName || ''}`.trim() || selectedDiscountClient.id}
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                          <select
                            value={selectedPolicyIdForAssignment}
                            onChange={(e) => setSelectedPolicyIdForAssignment(e.target.value)}
                            className="h-11 bg-white border-2 border-[#347048]/20 focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-black text-sm"
                          >
                            <option value="">Seleccionar política...</option>
                            {discountPolicies.filter((p) => p.isActive).map((policy) => (
                              <option value={policy.id} key={policy.id}>
                                {policy.name}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={assignmentNotes}
                            onChange={(e) => setAssignmentNotes(e.target.value)}
                            className="h-11 bg-white border-2 border-[#347048]/20 focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-black text-sm"
                            placeholder="Motivo / nota"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleAssignPolicyToClient}
                          className="w-full mt-2 h-11 bg-[#347048] hover:bg-[#B9CF32] text-[#EBE1D8] hover:text-[#347048] rounded-xl font-black text-sm uppercase tracking-widest transition-all"
                        >
                          Asignar Política
                        </button>

                        <div className="mt-3">
                          <h5 className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50 mb-2">Asignaciones del cliente</h5>
                          {loadingClientAssignments ? (
                            <p className="text-[11px] font-bold text-[#347048]/60">Cargando...</p>
                          ) : clientAssignments.length === 0 ? (
                            <p className="text-[11px] font-bold text-[#347048]/60">Sin asignaciones.</p>
                          ) : (
                            <div className="space-y-2 max-h-44 overflow-auto pr-1">
                              {clientAssignments.map((assignment: any) => (
                                <div key={assignment.id} className="bg-[#EBE1D8] rounded-xl p-2 border border-white">
                                  <p className="text-sm font-black text-[#347048]">{assignment.policy?.name || assignment.policyId}</p>
                                  <p className="text-[11px] font-bold text-[#347048]/70">{assignment.notes || 'Sin nota'}</p>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleAssignment(assignment.id, !assignment.isActive)}
                                    className={`mt-1 px-2 py-1 rounded-lg text-[10px] font-black ${assignment.isActive ? 'bg-[#926699]/20 text-[#347048]' : 'bg-[#B9CF32]/40 text-[#347048]'}`}
                                  >
                                    {assignment.isActive ? 'Desactivar' : 'Activar'}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] font-bold text-[#347048]/60">Seleccioná un cliente para asignar descuentos.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>


            <div className="bg-white/40 p-4 rounded-2xl border border-white">
              <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#347048] mb-2">Historial de cambios recientes</h4>
              {changeHistory.length === 0 ? (
                <p className="text-[11px] font-bold text-[#347048]/60">Aun no hay cambios auditados para este club.</p>
              ) : (
                <div className="space-y-2 max-h-52 overflow-auto pr-1">
                  {changeHistory.map((entry) => (
                    <div key={entry.id} className="bg-[#EBE1D8] rounded-xl border border-white p-3">
                      <p className="text-[11px] font-black text-[#347048]">
                        {entry.actor} · {new Date(entry.changedAt).toLocaleString('es-AR')}
                      </p>
                      <p className="text-[11px] font-bold text-[#347048]/70 mt-1">
                        {entry.changes.length} cambios aplicados.
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* BOTÓN FINAL */}
            <div className="flex justify-end pt-6 border-t border-[#347048]/10">
              <button type="submit" className="w-full md:w-auto px-10 py-4 bg-[#347048] hover:bg-[#B9CF32] text-[#EBE1D8] hover:text-[#347048] font-black rounded-2xl shadow-xl shadow-[#347048]/20 transition-all uppercase tracking-[0.2em] text-sm italic flex items-center justify-center gap-3">
                <Save size={20} strokeWidth={3} />
                Guardar Configuración
              </button>
            </div>
          </form>
        ) : (
          <div className="py-20 text-center text-[#347048]/40 font-black uppercase italic tracking-widest">No se pudo cargar la información</div>
        )}
      </div>

      {club ? (
        <div className="fixed bottom-4 left-1/2 z-[80] w-[calc(100%-1.5rem)] max-w-5xl -translate-x-1/2">
          <div className="rounded-2xl border-2 border-white bg-[#347048] px-4 py-3 shadow-2xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3 text-[#EBE1D8]">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${hasUnsavedChanges ? 'bg-[#B9CF32]' : 'bg-white/60'}`} />
                <p className="text-xs font-black uppercase tracking-widest">
                  {hasUnsavedChanges ? `Cambios pendientes (${configChanges.length})` : 'Sin cambios pendientes'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDiscardChanges}
                  disabled={!hasUnsavedChanges}
                  className="h-10 rounded-xl bg-white px-4 text-[11px] font-black uppercase tracking-widest text-[#347048] disabled:opacity-40"
                >
                  Descartar
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateClub()}
                  disabled={!hasUnsavedChanges}
                  className="h-10 rounded-xl bg-[#B9CF32] px-4 text-[11px] font-black uppercase tracking-widest text-[#347048] disabled:opacity-40"
                >
                  Guardar cambios
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <AppModal
        show={Boolean(editingDiscountPolicyId)}
        onClose={handleCancelEditDiscountPolicy}
        onCancel={handleCancelEditDiscountPolicy}
        onConfirm={handleSaveDiscountPolicy}
        title="Editar política"
        confirmText="Guardar cambios"
        cancelText="Cancelar"
        confirmDisabled={
          !discountPolicyEditForm.name.trim() ||
          !Number.isFinite(Number(discountPolicyEditForm.amountValue)) ||
          Number(discountPolicyEditForm.amountValue) <= 0 ||
          !Number.isFinite(Number(discountPolicyEditForm.priority)) ||
          (discountPolicyEditForm.amountType === 'PERCENT' && Number(discountPolicyEditForm.amountValue) > 100)
        }
        message={(
          <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              type="text"
              value={discountPolicyEditForm.name}
              onChange={(e) => setDiscountPolicyEditForm((prev) => ({ ...prev, name: e.target.value }))}
              className="h-10 bg-white border-2 border-[#347048]/15 focus:border-[#B9CF32] rounded-lg px-3 text-[#347048] font-black text-sm"
              placeholder="Nombre"
            />
            <select
              value={discountPolicyEditForm.scope}
              onChange={(e) => setDiscountPolicyEditForm((prev) => ({ ...prev, scope: e.target.value as DiscountPolicyScope }))}
              className="h-10 bg-white border-2 border-[#347048]/15 focus:border-[#B9CF32] rounded-lg px-3 text-[#347048] font-black text-sm"
            >
              <option value="BOOKING">Reserva</option>
              <option value="PRODUCT">Producto</option>
              <option value="SERVICE">Servicio</option>
              <option value="ALL">Todo</option>
            </select>
            <select
              value={discountPolicyEditForm.amountType}
              onChange={(e) => setDiscountPolicyEditForm((prev) => ({ ...prev, amountType: e.target.value as DiscountAmountType }))}
              className="h-10 bg-white border-2 border-[#347048]/15 focus:border-[#B9CF32] rounded-lg px-3 text-[#347048] font-black text-sm"
            >
              <option value="PERCENT">Porcentaje</option>
              <option value="FIXED">Monto fijo</option>
            </select>
            <input
              type="number"
              min={0}
              step={0.01}
              value={discountPolicyEditForm.amountValue}
              onChange={(e) => setDiscountPolicyEditForm((prev) => ({ ...prev, amountValue: e.target.value }))}
              className="h-10 bg-white border-2 border-[#347048]/15 focus:border-[#B9CF32] rounded-lg px-3 text-[#347048] font-black text-sm"
              placeholder="Valor"
            />
            <input
              type="number"
              min={0}
              step={1}
              value={discountPolicyEditForm.priority}
              onChange={(e) => setDiscountPolicyEditForm((prev) => ({ ...prev, priority: e.target.value }))}
              className="h-10 bg-white border-2 border-[#347048]/15 focus:border-[#B9CF32] rounded-lg px-3 text-[#347048] font-black text-sm"
              placeholder="Prioridad"
            />
            <select
              value={discountPolicyEditForm.applyMode}
              onChange={(e) => setDiscountPolicyEditForm((prev) => ({ ...prev, applyMode: e.target.value as DiscountApplyMode }))}
              className="h-10 bg-white border-2 border-[#347048]/15 focus:border-[#B9CF32] rounded-lg px-3 text-[#347048] font-black text-sm"
            >
              <option value="INCLUDE_ONLY">Solo incluidos</option>
              <option value="EXCLUDE_LIST">Excluir lista</option>
            </select>
            <label className="md:col-span-2 flex items-center gap-2 text-xs font-black text-[#347048]">
              <input
                type="checkbox"
                checked={discountPolicyEditForm.isStackable}
                onChange={(e) => setDiscountPolicyEditForm((prev) => ({ ...prev, isStackable: e.target.checked }))}
              />
              Acumulable
            </label>
            <label className="md:col-span-2 flex items-center gap-2 text-xs font-black text-[#347048]">
              <input
                type="checkbox"
                checked={discountPolicyEditForm.isActive}
                onChange={(e) => setDiscountPolicyEditForm((prev) => ({ ...prev, isActive: e.target.checked }))}
              />
              Activa
            </label>
          </div>
        )}
      />

      <AppModal show={modalState.show} onClose={closeModal} onCancel={modalState.onCancel} title={modalState.title} message={modalState.message}
        cancelText={modalState.cancelText} confirmText={modalState.confirmText} isWarning={modalState.isWarning} onConfirm={modalState.onConfirm}
        closeOnBackdrop={modalState.closeOnBackdrop} closeOnEscape={modalState.closeOnEscape}
        holdToConfirm={modalState.holdToConfirm} holdDuration={modalState.holdDuration} />
    </>
  );
}
