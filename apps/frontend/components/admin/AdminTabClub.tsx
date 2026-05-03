import { useEffect, useState, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { ClubService, Club, type BookingConfirmationMode } from '../../services/ClubService';
import { getCourts } from '../../services/CourtService';
import { ClubAdminService, ClubActivityType, type ActivityScheduleException, type DiscountApplyMode, type DiscountAmountType, type DiscountPolicyScope, type AuditLogEntry, type ClubReviewAdminItem, type ClubReviewAdminStatus } from '../../services/ClubAdminService';
import { searchClients } from '../../services/BookingService';
import AdminAppModal from './ui/AdminAppModal';
import { Globe, Instagram, Facebook, Phone, Mail, Image as ImageIcon, AlertTriangle, Check, X, Search, CalendarDays, Trash2 } from 'lucide-react';
import { AdminDateInput, AdminDrawer, AdminDrawerSection, AdminSegmentedControl } from './ui';
import { normalizeSessionUser } from '../../utils/session';
import { useRouter } from 'next/router';
import { lockBodyScroll } from '../../utils/bodyScrollLock';

type AdminTabClubSection = 'identity' | 'operation' | 'agenda' | 'discounts' | 'audit';

type AdminTabClubProps = {
  forcedTab?: AdminTabClubSection;
  title?: string;
  subtitle?: string;
};

type ClubOperationalStatus = 'OPEN' | 'TEMPORARY_CLOSED' | 'PERMANENTLY_CLOSED';

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

const LIGHTS_FROM_HOUR_OPTIONS = ["18:00", "19:00", "20:00", "21:00", "22:00"];

const CLUB_OPERATIONAL_STATUS_OPTIONS: Array<{ value: ClubOperationalStatus; label: string; helper: string }> = [
  {
    value: 'OPEN',
    label: 'Abierto',
    helper: 'El club opera normalmente y solo aplican cierres puntuales por fecha.'
  },
  {
    value: 'TEMPORARY_CLOSED',
    label: 'Cierre temporal',
    helper: 'Bloquea un rango continuo de fechas (días, semanas o meses).'
  },
  {
    value: 'PERMANENTLY_CLOSED',
    label: 'Cierre permanente',
    helper: 'El club queda no operable para nuevas reservas en cualquier fecha.'
  }
];

type ActivityScheduleFormValue = {
  scheduleMode: 'FIXED' | 'RANGE';
  scheduleOpenTime: string;
  scheduleCloseTime: string;
  scheduleIntervalMinutes: string;
  scheduleWindows: string;
  scheduleDurations: string;
  scheduleFixedSlots: string;
};

type ActivityScheduleExceptionFormValue = {
  localDate: string;
  isClosed: boolean;
  scheduleMode: 'FIXED' | 'RANGE';
  scheduleOpenTime: string;
  scheduleCloseTime: string;
  scheduleIntervalMinutes: string;
  scheduleWindows: string;
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
  name?: string;
  email?: string;
  phone?: string;
  dni?: string;
};

type ClubConfigSnapshot = {
  clubForm: any;
  openingDaysSet: number[];
  closureDatesSet: string[];
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

type PendingScheduleExceptionMutation = {
  activityId: number;
  localDate: string;
  action: 'UPSERT' | 'DELETE';
  payload?: {
    isClosed: boolean;
    scheduleMode?: 'FIXED' | 'RANGE' | null;
    scheduleOpenTime?: string | null;
    scheduleCloseTime?: string | null;
    scheduleIntervalMinutes?: number | null;
    scheduleWindows?: Array<{ start: string; end: string }> | null;
    scheduleDurations?: number[] | null;
    scheduleFixedSlots?: Array<{ start: string; duration: number }> | null;
  };
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

const parseRangeWindowsInput = (raw: string): Array<{ start: string; end: string }> => {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const windows: Array<{ start: string; end: string }> = [];

  for (const line of lines) {
    const normalized = line.replace(' - ', '-').replace('|', '-').replace(',', '-');
    const [startRaw, endRaw] = normalized.split('-').map((part) => part.trim());
    if (!startRaw || !endRaw) {
      throw new Error(`Formato de franja inválido: "${line}". Usá HH:mm-HH:mm`);
    }
    if (!/^\d{2}:\d{2}$/.test(startRaw) || !/^\d{2}:\d{2}$/.test(endRaw)) {
      throw new Error(`Hora inválida en franja: "${line}"`);
    }
    if (startRaw >= endRaw) {
      throw new Error(`La franja debe tener fin mayor al inicio: "${line}"`);
    }
    windows.push({ start: startRaw, end: endRaw });
  }

  windows.sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < windows.length; i += 1) {
    if (windows[i].start < windows[i - 1].end) {
      throw new Error(`Franja superpuesta: ${windows[i - 1].start}-${windows[i - 1].end} y ${windows[i].start}-${windows[i].end}`);
    }
  }

  return windows;
};

const parseLocalDate = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getTodayDateKey = () => formatLocalDate(new Date());
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const buildScheduleFormFromActivities = (activities: ClubActivityType[]): Record<number, ActivityScheduleFormValue> => {
  return activities.reduce((acc, activity) => {
    const safeDefault = Number(activity.defaultDurationMinutes) > 0 ? Number(activity.defaultDurationMinutes) : 60;
    const durations = normalizeDurations(activity.scheduleDurations, safeDefault);
    const fixedSlots = Array.isArray(activity.scheduleFixedSlots) ? activity.scheduleFixedSlots : [];
    const rangeWindows = Array.isArray((activity as any).scheduleWindows) ? (activity as any).scheduleWindows : [];

    acc[activity.id] = {
      scheduleMode: activity.scheduleMode === 'RANGE' ? 'RANGE' : 'FIXED',
      scheduleOpenTime: activity.scheduleOpenTime || '08:00',
      scheduleCloseTime: activity.scheduleCloseTime || '22:00',
      scheduleIntervalMinutes: activity.scheduleIntervalMinutes != null ? String(activity.scheduleIntervalMinutes) : '30',
      scheduleWindows: rangeWindows.map((window: any) => `${String(window?.start || '').trim()}-${String(window?.end || '').trim()}`).filter((line: string) => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(line)).join('\n'),
      scheduleDurations: durations.join(', '),
      scheduleFixedSlots: fixedSlots.map((slot) => `${slot.start}-${slot.duration}`).join('\n')
    };

    return acc;
  }, {} as Record<number, ActivityScheduleFormValue>);
};

const buildScheduleExceptionFormFromSchedule = (
  scheduleForm: Record<number, ActivityScheduleFormValue>
): Record<number, ActivityScheduleExceptionFormValue> => {
  const todayKey = getTodayDateKey();
  return Object.entries(scheduleForm).reduce((acc, [activityId, value]) => {
    const id = Number(activityId);
    acc[id] = {
      localDate: todayKey,
      isClosed: false,
      scheduleMode: value.scheduleMode,
      scheduleOpenTime: value.scheduleOpenTime,
      scheduleCloseTime: value.scheduleCloseTime,
      scheduleIntervalMinutes: value.scheduleIntervalMinutes,
      scheduleWindows: value.scheduleWindows,
      scheduleDurations: value.scheduleDurations,
      scheduleFixedSlots: value.scheduleFixedSlots
    };
    return acc;
  }, {} as Record<number, ActivityScheduleExceptionFormValue>);
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

export default function AdminTabClub({
  forcedTab,
  title = 'Configuración del club',
  subtitle = 'Identidad, operación y agenda de tu establecimiento',
}: AdminTabClubProps = {}) {
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
    clubOperationalStatus: 'OPEN' as ClubOperationalStatus,
    temporaryClosureStartDate: '',
    temporaryClosureEndDate: '',
    fixedBookingSettingsByActivity: {} as FixedBookingSettingsForm
  });
      const [activitySettings, setActivitySettings] = useState<FixedBookingActivitySetting[]>([]);
     const [openingDaysSet, setOpeningDaysSet] = useState<number[]>([]);
  const [closureDatesSet, setClosureDatesSet] = useState<string[]>([]);
  const [closureDateInput, setClosureDateInput] = useState('');
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
  const [activityExceptionForm, setActivityExceptionForm] = useState<Record<number, ActivityScheduleExceptionFormValue>>({});
  const [activityExceptionBusy, setActivityExceptionBusy] = useState<Record<number, boolean>>({});
  const [activityExceptionExists, setActivityExceptionExists] = useState<Record<number, boolean>>({});
  const [activityExceptionSummary, setActivityExceptionSummary] = useState<Record<number, { count: number; nextDate: string | null }>>({});
  const [pendingScheduleExceptionMutations, setPendingScheduleExceptionMutations] = useState<PendingScheduleExceptionMutation[]>([]);
  const [exceptionModalActivityId, setExceptionModalActivityId] = useState<number | null>(null);
  const [exceptionModalItems, setExceptionModalItems] = useState<ActivityScheduleException[]>([]);
  const [exceptionModalLoading, setExceptionModalLoading] = useState(false);
  const [exceptionModalSelectedDate, setExceptionModalSelectedDate] = useState<string>('');
  const [exceptionModalSelectedId, setExceptionModalSelectedId] = useState<number | null>(null);
  const [exceptionModalNewDate, setExceptionModalNewDate] = useState<string>('');
  const [exceptionModalDraft, setExceptionModalDraft] = useState<ActivityScheduleExceptionFormValue | null>(null);
  const [changeHistory, setChangeHistory] = useState<ConfigHistoryEntry[]>([]);
  const [discountPolicies, setDiscountPolicies] = useState<DiscountPolicyView[]>([]);
  const [loadingDiscountPolicies, setLoadingDiscountPolicies] = useState(false);
  const [clubReviews, setClubReviews] = useState<ClubReviewAdminItem[]>([]);
  const [loadingClubReviews, setLoadingClubReviews] = useState(false);
  const [reviewStatusFilter, setReviewStatusFilter] = useState<'ALL' | ClubReviewAdminStatus>('ALL');
  const [reviewStatusUpdatingId, setReviewStatusUpdatingId] = useState<string | null>(null);
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
  const [showDiscountsConfigModal, setShowDiscountsConfigModal] = useState(false);
  const [discountDrawerOpen, setDiscountDrawerOpen] = useState(false);
  const [discountDrawerMode, setDiscountDrawerMode] = useState<'create' | 'edit'>('create');
  const clientSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientSearchWrapperRef = useRef<HTMLDivElement | null>(null);

  const [activeTab, setActiveTab] = useState<AdminTabClubSection>('identity');
  const effectiveTab: AdminTabClubSection = forcedTab ?? activeTab;

  const closeModal = () => setModalState((prev) => ({ ...prev, show: false, onConfirm: undefined, onCancel: undefined, holdToConfirm: false, holdDuration: undefined }));
  const showInfo = (message: ReactNode, title = 'Información') => setModalState({ show: true, title, message, cancelText: '', confirmText: 'OK' });
  const showError = (message: ReactNode) => setModalState({ show: true, title: 'Error', message, isWarning: true, cancelText: '', confirmText: 'Aceptar' });

  const cloneSnapshot = (snapshot: ClubConfigSnapshot): ClubConfigSnapshot => ({
    clubForm: JSON.parse(JSON.stringify(snapshot.clubForm)),
    openingDaysSet: [...snapshot.openingDaysSet],
    closureDatesSet: [...snapshot.closureDatesSet],
    activityScheduleForm: JSON.parse(JSON.stringify(snapshot.activityScheduleForm))
  });

  const normalizeDays = (days: number[]) => [...days].sort((a, b) => a - b);
  const normalizeValue = (value: unknown) => {
    if (value == null) return '';
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    // Objects (e.g. fixedBookingSettingsByActivity) must be deep-compared;
    // String(obj) always returns "[object Object]" regardless of content.
    if (typeof value === 'object') return JSON.stringify(value);
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

  const loadClubReviews = useCallback(async (
    clubSlug: string,
    statusFilter: 'ALL' | ClubReviewAdminStatus = 'ALL'
  ) => {
    try {
      setLoadingClubReviews(true);
      const page = await ClubAdminService.listClubReviews(clubSlug, {
        take: 50,
        status: statusFilter === 'ALL' ? undefined : statusFilter
      });
      setClubReviews(Array.isArray(page?.items) ? page.items : []);
    } catch (error: any) {
      showError(`Error al cargar reseñas: ${error.message}`);
      setClubReviews([]);
    } finally {
      setLoadingClubReviews(false);
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

  const openExceptionModalForActivity = useCallback(async (activity: ClubActivityType) => {
    if (!club) return;
    try {
      setExceptionModalActivityId(activity.id);
      setExceptionModalSelectedDate('');
      setExceptionModalSelectedId(null);
      setExceptionModalLoading(true);
      const fromDate = formatLocalDate(addDays(new Date(), -180));
      const toDate = formatLocalDate(addDays(new Date(), 730));
      const rows = await ClubAdminService.listActivityTypeScheduleExceptions(club.slug, activity.id, { fromDate, toDate });
      const normalizedRows = Array.isArray(rows) ? rows : [];
      setExceptionModalItems(normalizedRows);
      setExceptionModalSelectedDate('');
      setExceptionModalSelectedId(null);
      setExceptionModalNewDate(getTodayDateKey());
    } catch (error: any) {
      showError(`No se pudo cargar excepciones: ${error.message}`);
      setExceptionModalItems([]);
      setExceptionModalSelectedDate('');
      setExceptionModalSelectedId(null);
    } finally {
      setExceptionModalLoading(false);
    }
  }, [club]);

  const closeExceptionModal = useCallback(() => {
    setExceptionModalActivityId(null);
    setExceptionModalItems([]);
    setExceptionModalSelectedDate('');
    setExceptionModalSelectedId(null);
    setExceptionModalNewDate('');
    setExceptionModalDraft(null);
    setExceptionModalLoading(false);
  }, []);

  const closeDiscountsConfigModal = useCallback(() => {
    setShowDiscountsConfigModal(false);
  }, []);

  // Lock body scroll when the exceptions drawer is open.
  // AdminDrawer handles Escape natively.
  useEffect(() => {
    if (!exceptionModalActivityId) return;
    const releaseBodyScrollLock = lockBodyScroll();
    return () => {
      releaseBodyScrollLock();
    };
  }, [exceptionModalActivityId]);

  const loadActivityExceptionSummary = useCallback(async (clubSlug: string, activities: ClubActivityType[]) => {
    try {
      if (!Array.isArray(activities) || activities.length === 0) {
        setActivityExceptionSummary({});
        return;
      }
      const fromDate = getTodayDateKey();
      const toDate = formatLocalDate(addDays(new Date(), 365));
      const entries = await Promise.all(
        activities.map(async (activity) => {
          const rows = await ClubAdminService.listActivityTypeScheduleExceptions(clubSlug, activity.id, { fromDate, toDate });
          const normalizedRows = Array.isArray(rows) ? rows : [];
          const nextDate = normalizedRows.length > 0
            ? String(normalizedRows[0]?.localDate || '').trim() || null
            : null;
          return [activity.id, { count: normalizedRows.length, nextDate }] as const;
        })
      );
      setActivityExceptionSummary(Object.fromEntries(entries));
    } catch {
      setActivityExceptionSummary({});
    }
  }, []);

  const upsertPendingScheduleExceptionMutation = useCallback((mutation: PendingScheduleExceptionMutation) => {
    setPendingScheduleExceptionMutations((prev) => {
      const filtered = prev.filter((item) => !(item.activityId === mutation.activityId && item.localDate === mutation.localDate));
      return [...filtered, mutation];
    });
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
        const nextClosureDates = Array.isArray(clubData.closureDates)
          ? Array.from(new Set(clubData.closureDates.map((date) => String(date || '').trim()).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))).sort()
          : [];
        const nextClubForm = {
          slug: clubData.slug || '', name: clubData.name || '',
          addressLine: clubData.addressLine || '', city: clubData.city || '', province: clubData.province || '', country: clubData.country || '',
          contactInfo: clubData.contactInfo || '', phone: clubData.phone || '', logoUrl: clubData.logoUrl || '', clubImageUrl: clubData.clubImageUrl || '',
          instagramUrl: clubData.instagramUrl || '', facebookUrl: clubData.facebookUrl || '',
          websiteUrl: clubData.websiteUrl || '', description: clubData.description || '',
          lightsEnabled: clubData.lightsEnabled ?? false,
          lightsExtraAmount: clubData.lightsExtraAmount != null ? String(clubData.lightsExtraAmount) : '',
          lightsFromHour: LIGHTS_FROM_HOUR_OPTIONS.includes(String(clubData.lightsFromHour || ''))
            ? String(clubData.lightsFromHour)
            : '',
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
          clubOperationalStatus: ((clubData.clubOperationalStatus || 'OPEN') as ClubOperationalStatus),
          temporaryClosureStartDate: clubData.temporaryClosureStartDate || '',
          temporaryClosureEndDate: clubData.temporaryClosureEndDate || '',
          fixedBookingSettingsByActivity: buildFixedBookingSettingsForm(nextActivitySettings, clubData.fixedBookingSettingsByActivity)
        };
        setClub(clubData);
        setActivitySettings(nextActivitySettings);
        setActivityTypes(nextActivityTypes);
        setActivityScheduleForm(nextActivityScheduleForm);
        setActivityExceptionForm(buildScheduleExceptionFormFromSchedule(nextActivityScheduleForm));
        setActivityExceptionBusy({});
        setActivityExceptionExists({});
        setActivityExceptionSummary({});
        setPendingScheduleExceptionMutations([]);
        await loadDiscountPolicies(clubData.slug);
        setClubReviews([]);
        setClientSearch('');
        setClientSearchResults([]);
        setSelectedDiscountClient(null);
        setClientAssignments([]);
        setSelectedPolicyIdForAssignment('');
        setAssignmentNotes('');
        setClubForm(nextClubForm);
        setOpeningDaysSet(nextOpeningDays);
        setClosureDatesSet(nextClosureDates);
        setClosureDateInput('');
        setLogoPreview(clubData.logoUrl || null);
        setClubImagePreview(clubData.clubImageUrl || null);
        initialConfigRef.current = cloneSnapshot({
          clubForm: nextClubForm,
          openingDaysSet: nextOpeningDays,
          closureDatesSet: nextClosureDates,
          activityScheduleForm: nextActivityScheduleForm
        });
        await loadActivityExceptionSummary(clubData.slug, nextActivityTypes);
        await loadPersistentConfigHistory(clubData.id);
      }
    } catch (error: any) {
      showError('Error al cargar información del club: ' + error.message);
    } finally {
      setLoadingClub(false);
    }
  }, [loadActivityExceptionSummary, loadDiscountPolicies, loadPersistentConfigHistory]);

  useEffect(() => { loadClub(); }, [loadClub]);

  useEffect(() => {
    if (!club?.slug) return;
    void loadClubReviews(club.slug, reviewStatusFilter);
  }, [club?.slug, loadClubReviews, reviewStatusFilter]);

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
      'allowAdminSkipSimpleAdvanceLimit',
      'clubOperationalStatus',
      'temporaryClosureStartDate',
      'temporaryClosureEndDate'
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
      clubOperationalStatus: 'Estado operativo del club',
      temporaryClosureStartDate: 'Inicio de cierre temporal',
      temporaryClosureEndDate: 'Fin de cierre temporal',
      openingDaysSet: 'Dias de apertura',
      closureDatesSet: 'Fechas de cierre',
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

    const beforeClosureDates = [...(base.closureDatesSet || [])].sort();
    const afterClosureDates = [...(closureDatesSet || [])].sort();
    if (JSON.stringify(beforeClosureDates) !== JSON.stringify(afterClosureDates)) {
      changes.push({
        label: labels.closureDatesSet,
        before: beforeClosureDates.join(', ') || 'Sin cierres',
        after: afterClosureDates.join(', ') || 'Sin cierres',
        critical: true
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

    if (pendingScheduleExceptionMutations.length > 0) {
      changes.push({
        label: 'Excepciones de agenda',
        before: 'Sin cambios pendientes',
        after: `${pendingScheduleExceptionMutations.length} cambio(s) pendiente(s)`,
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
    setClosureDatesSet(clone.closureDatesSet);
    setClosureDateInput('');
      setActivityScheduleForm(clone.activityScheduleForm);
    setActivityExceptionSummary({});
    setPendingScheduleExceptionMutations([]);
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
      // Sólo campos de la sección "Confirmación de reservas"
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
      // enforceCashShiftCloseWithOpenAccounts pertenece al tab Descuentos — no resetear acá
    }));
  };

  const handleLoadScheduleException = async (activity: ClubActivityType, options?: { silent?: boolean; forceLocalDate?: string }) => {
    if (!club) return;
    const silent = Boolean(options?.silent);
    const form = activityExceptionForm[activity.id];
    const localDate = String((options?.forceLocalDate ?? form?.localDate) || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      if (!silent) showError('Seleccioná una fecha válida para cargar la excepción.');
      return;
    }

    try {
      setActivityExceptionBusy((prev) => ({ ...prev, [activity.id]: true }));
      const rows = await ClubAdminService.listActivityTypeScheduleExceptions(club.slug, activity.id, {
        fromDate: localDate,
        toDate: localDate
      });
      const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

      if (!row) {
        const base = activityScheduleForm[activity.id];
        if (!base) return;
        setActivityExceptionExists((prev) => ({ ...prev, [activity.id]: false }));
        setActivityExceptionForm((prev) => ({
          ...prev,
          [activity.id]: {
            localDate,
            isClosed: false,
            scheduleMode: base.scheduleMode,
            scheduleOpenTime: base.scheduleOpenTime,
            scheduleCloseTime: base.scheduleCloseTime,
            scheduleIntervalMinutes: base.scheduleIntervalMinutes,
            scheduleWindows: base.scheduleWindows,
            scheduleDurations: base.scheduleDurations,
            scheduleFixedSlots: base.scheduleFixedSlots
          }
        }));
        if (!silent) {
          showInfo('No había excepción para esa fecha. Se cargó la configuración base como punto de partida.', 'Sin excepción');
        }
        return;
      }

      const rowWindows = Array.isArray(row.scheduleWindows)
        ? row.scheduleWindows.map((window: any) => `${String(window?.start || '').trim()}-${String(window?.end || '').trim()}`).filter((line) => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(line)).join('\n')
        : '';
      const rowFixedSlots = Array.isArray(row.scheduleFixedSlots)
        ? row.scheduleFixedSlots.map((slot: any) => `${String(slot?.start || '').trim()}-${Number(slot?.duration || 0)}`).join('\n')
        : '';
      const rowDurations = Array.isArray(row.scheduleDurations) ? row.scheduleDurations.join(', ') : '';

      setActivityExceptionForm((prev) => ({
        ...prev,
        [activity.id]: {
          localDate,
          isClosed: Boolean(row.isClosed),
          scheduleMode: row.scheduleMode === 'RANGE' ? 'RANGE' : 'FIXED',
          scheduleOpenTime: row.scheduleOpenTime || '08:00',
          scheduleCloseTime: row.scheduleCloseTime || '22:00',
          scheduleIntervalMinutes: row.scheduleIntervalMinutes != null ? String(row.scheduleIntervalMinutes) : '30',
          scheduleWindows: rowWindows,
          scheduleDurations: rowDurations || '60',
          scheduleFixedSlots: rowFixedSlots
        }
      }));
      setActivityExceptionExists((prev) => ({ ...prev, [activity.id]: true }));
      if (!silent) showInfo('Excepción cargada para la fecha seleccionada.', 'Excepción cargada');
    } catch (error: any) {
      if (!silent) showError(`No se pudo cargar la excepción: ${error.message}`);
    } finally {
      setActivityExceptionBusy((prev) => ({ ...prev, [activity.id]: false }));
    }
  };

  const handleExceptionDateChange = async (activity: ClubActivityType, localDate: string) => {
    setActivityExceptionForm((prev) => ({
      ...prev,
      [activity.id]: {
        ...prev[activity.id],
        localDate
      }
    }));

    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return;

    void handleLoadScheduleException(activity, { silent: true, forceLocalDate: localDate });
  };

  const queueScheduleExceptionDraft = async (activity: ClubActivityType, form: ActivityScheduleExceptionFormValue) => {
    const localDate = String(form.localDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      throw new Error('La fecha de excepcion debe tener formato YYYY-MM-DD.');
    }
    const todayDateKey = getTodayDateKey();
    if (localDate < todayDateKey) {
      throw new Error(`La fecha de excepcion no puede ser pasada (minimo permitido: ${todayDateKey}).`);
    }
    if (form.isClosed) {
      upsertPendingScheduleExceptionMutation({
        activityId: activity.id,
        localDate,
        action: 'UPSERT',
        payload: { isClosed: true }
      });
      setActivityExceptionExists((prev) => ({ ...prev, [activity.id]: true }));
      return;
    }

    const durations = parseDurationsInput(form.scheduleDurations, activity.defaultDurationMinutes);
    const fixedSlots = form.scheduleMode === 'FIXED' ? parseFixedSlotsInput(form.scheduleFixedSlots) : [];
    const scheduleWindows = form.scheduleMode === 'RANGE' ? parseRangeWindowsInput(form.scheduleWindows) : [];

    upsertPendingScheduleExceptionMutation({
      activityId: activity.id,
      localDate,
      action: 'UPSERT',
      payload: {
        isClosed: false,
        scheduleMode: form.scheduleMode,
        scheduleOpenTime: form.scheduleMode === 'RANGE' ? form.scheduleOpenTime : null,
        scheduleCloseTime: form.scheduleMode === 'RANGE' ? form.scheduleCloseTime : null,
        scheduleIntervalMinutes: form.scheduleMode === 'RANGE' ? Number(form.scheduleIntervalMinutes || 0) : null,
        scheduleWindows: form.scheduleMode === 'RANGE' ? scheduleWindows : null,
        scheduleDurations: durations,
        scheduleFixedSlots: fixedSlots
      }
    });
    setActivityExceptionExists((prev) => ({ ...prev, [activity.id]: true }));
  };

  const queueScheduleExceptionDelete = async (activity: ClubActivityType, localDateRaw: string) => {
    const localDate = String(localDateRaw || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      throw new Error('Seleccioná una fecha válida para eliminar la excepción.');
    }
    upsertPendingScheduleExceptionMutation({
      activityId: activity.id,
      localDate,
      action: 'DELETE'
    });
    setActivityExceptionExists((prev) => ({ ...prev, [activity.id]: false }));
  };

  const handleSaveScheduleException = async (activity: ClubActivityType) => {
    const form = activityExceptionForm[activity.id];
    if (!form) return;

    try {
      setActivityExceptionBusy((prev) => ({ ...prev, [activity.id]: true }));
      await queueScheduleExceptionDraft(activity, form);
      showInfo('Excepción preparada. Se aplicará cuando guardes los cambios generales.', 'Pendiente de guardar');
    } catch (error: any) {
      showError(`No se pudo guardar la excepción: ${error.message}`);
    } finally {
      setActivityExceptionBusy((prev) => ({ ...prev, [activity.id]: false }));
    }
  };

  const handleDeleteScheduleException = async (activity: ClubActivityType) => {
    const form = activityExceptionForm[activity.id];
    if (!form) return;
    const localDate = String(form.localDate || '').trim();

    try {
      setActivityExceptionBusy((prev) => ({ ...prev, [activity.id]: true }));
      await queueScheduleExceptionDelete(activity, localDate);
      const base = activityScheduleForm[activity.id];
      if (base) {
        setActivityExceptionForm((prev) => ({
          ...prev,
          [activity.id]: {
            localDate,
            isClosed: false,
            scheduleMode: base.scheduleMode,
            scheduleOpenTime: base.scheduleOpenTime,
            scheduleCloseTime: base.scheduleCloseTime,
            scheduleIntervalMinutes: base.scheduleIntervalMinutes,
            scheduleWindows: base.scheduleWindows,
            scheduleDurations: base.scheduleDurations,
            scheduleFixedSlots: base.scheduleFixedSlots
          }
        }));
      }
      showInfo('Eliminación preparada. Se aplicará cuando guardes los cambios generales.', 'Pendiente de guardar');
    } catch (error: any) {
      showError(`No se pudo eliminar la excepción: ${error.message}`);
    } finally {
      setActivityExceptionBusy((prev) => ({ ...prev, [activity.id]: false }));
    }
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
            <div className="max-h-56 overflow-auto rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
              <ul className="space-y-1 text-[12px] text-[#4e5870]">
                {topChanges.map((change) => (
                  <li key={`${change.label}-${change.after}`}>
                    {change.critical ? '• [CRÍTICO] ' : '• '}
                    {change.label}: {change.before} → {change.after}
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-[12px] text-[#6f7890]">
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
      const lightsExtraAmountRaw = Number(clubForm.lightsExtraAmount);
      const simpleAdvanceUserRaw = Number(clubForm.bookingSimpleAdvanceDaysUser);
      const simpleAdvanceAdminRaw = Number(clubForm.bookingSimpleAdvanceDaysAdmin);
      if (clubForm.lightsEnabled) {
        if (!Number.isFinite(lightsExtraAmountRaw) || lightsExtraAmountRaw <= 0) {
          showError('Si activás recargo nocturno, el monto extra debe ser mayor a 0.');
          return;
        }
        if (!/^\d{2}:\d{2}$/.test(String(clubForm.lightsFromHour || ''))) {
          showError('Si activás recargo nocturno, debés seleccionar desde qué hora aplica.');
          return;
        }
        if (!LIGHTS_FROM_HOUR_OPTIONS.includes(String(clubForm.lightsFromHour || ''))) {
          showError('La hora de inicio del recargo nocturno debe ser una de las opciones permitidas.');
          return;
        }
      }
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

      const normalizedClosureStartDate = String(clubForm.temporaryClosureStartDate || '').trim();
      const normalizedClosureEndDate = String(clubForm.temporaryClosureEndDate || '').trim();
      if (clubForm.clubOperationalStatus === 'TEMPORARY_CLOSED') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedClosureStartDate) || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedClosureEndDate)) {
          showError('En cierre temporal debés completar fecha de inicio y fin con formato válido.');
          return;
        }
        if (normalizedClosureStartDate > normalizedClosureEndDate) {
          showError('La fecha de inicio del cierre temporal no puede ser mayor a la fecha de fin.');
          return;
        }
        const todayDateKey = getTodayDateKey();
        const previousTemporaryClosureStartDate = String(club.temporaryClosureStartDate || '').trim();
        const previousTemporaryClosureEndDate = String(club.temporaryClosureEndDate || '').trim();
        if (normalizedClosureStartDate < todayDateKey && normalizedClosureStartDate !== previousTemporaryClosureStartDate) {
          showError(`La fecha de inicio del cierre temporal no puede ser pasada (minimo permitido: ${todayDateKey}).`);
          return;
        }
        if (normalizedClosureEndDate < todayDateKey && normalizedClosureEndDate !== previousTemporaryClosureEndDate) {
          showError(`La fecha de fin del cierre temporal no puede ser pasada (minimo permitido: ${todayDateKey}).`);
          return;
        }
        const overlapsExceptionalDates = closureDatesSet.some((date) => date >= normalizedClosureStartDate && date <= normalizedClosureEndDate);
        if (overlapsExceptionalDates) {
          showError('Hay fechas de cierre puntual que se superponen con el cierre temporal. Eliminá las superpuestas para continuar.');
          return;
        }
      }
      const todayDateKeyForClosureDates = getTodayDateKey();
      const previousClosureDatesSet = new Set(
        Array.isArray(club.closureDates)
          ? club.closureDates.map((raw) => String(raw || '').trim()).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
          : []
      );
      const newlyAddedPastClosureDate = closureDatesSet.find((date) => date < todayDateKeyForClosureDates && !previousClosureDatesSet.has(date));
      if (newlyAddedPastClosureDate) {
        showError(`No podes agregar cierres puntuales en fechas pasadas (${newlyAddedPastClosureDate}). Minimo permitido: ${todayDateKeyForClosureDates}.`);
        return;
      }
      if (clubForm.clubOperationalStatus === 'PERMANENTLY_CLOSED' && closureDatesSet.length > 0) {
        showError('No podés guardar fechas de cierre puntual cuando el club está en cierre permanente.');
        return;
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
        closureDates: clubForm.clubOperationalStatus === 'PERMANENTLY_CLOSED' ? [] : closureDatesSet,
        clubOperationalStatus: clubForm.clubOperationalStatus,
        temporaryClosureStartDate: clubForm.clubOperationalStatus === 'TEMPORARY_CLOSED' ? normalizedClosureStartDate : null,
        temporaryClosureEndDate: clubForm.clubOperationalStatus === 'TEMPORARY_CLOSED' ? normalizedClosureEndDate : null,
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
        const scheduleWindows = formConfig.scheduleMode === 'RANGE'
          ? parseRangeWindowsInput(formConfig.scheduleWindows)
          : [];

        await ClubAdminService.updateActivityTypeSchedule(updatedClub.slug, activity.id, {
          scheduleMode: formConfig.scheduleMode,
          scheduleOpenTime: formConfig.scheduleMode === 'RANGE' ? formConfig.scheduleOpenTime : null,
          scheduleCloseTime: formConfig.scheduleMode === 'RANGE' ? formConfig.scheduleCloseTime : null,
          scheduleIntervalMinutes: formConfig.scheduleMode === 'RANGE' ? Number(formConfig.scheduleIntervalMinutes || 0) : null,
          scheduleWindows: formConfig.scheduleMode === 'RANGE' ? scheduleWindows : null,
          scheduleDurations: durations,
          scheduleFixedSlots: fixedSlots
        });
      }

      for (const mutation of pendingScheduleExceptionMutations) {
        if (mutation.action === 'DELETE') {
          await ClubAdminService.deleteActivityTypeScheduleException(updatedClub.slug, mutation.activityId, mutation.localDate);
          continue;
        }
        if (!mutation.payload) {
          throw new Error(`Excepción inválida para actividad ${mutation.activityId} (${mutation.localDate})`);
        }
        await ClubAdminService.upsertActivityTypeScheduleException(
          updatedClub.slug,
          mutation.activityId,
          mutation.localDate,
          mutation.payload
        );
      }

      setClub(updatedClub);
      setPendingScheduleExceptionMutations([]);
      await loadActivityExceptionSummary(updatedClub.slug, activityTypes);
      initialConfigRef.current = cloneSnapshot({
        clubForm,
        openingDaysSet,
        closureDatesSet,
        activityScheduleForm
      });
      await loadPersistentConfigHistory(updatedClub.id);
      showInfo('Información del club actualizada correctamente', 'Éxito');
    } catch (error: any) {
      showError('Error al actualizar el club: ' + error.message);
    }
  };

  const handleJumpToNextException = async (activity: ClubActivityType) => {
    const summary = activityExceptionSummary[activity.id];
    const nextDate = String(summary?.nextDate || '').trim();
    if (!nextDate || !/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) return;
    await handleExceptionDateChange(activity, nextDate);
    await handleLoadScheduleException(activity, { forceLocalDate: nextDate });
  };

  const exceptionModalActivity = exceptionModalActivityId
    ? activityTypes.find((item) => item.id === exceptionModalActivityId) || null
    : null;
  const exceptionModalSelected = exceptionModalSelectedId != null
    ? exceptionModalItems.find((item) => Number(item.id) === exceptionModalSelectedId) || null
    : exceptionModalItems.find((item) => item.localDate === exceptionModalSelectedDate) || null;
  const exceptionModalSelectedIsPendingDraft = Boolean(exceptionModalSelected && Number(exceptionModalSelected.id) <= 0);
  const canDeleteExceptionModalDraft = Boolean(exceptionModalDraft && exceptionModalSelected);

  useEffect(() => {
    if (!exceptionModalSelected) {
      setExceptionModalDraft(null);
      return;
    }
    const rowWindows = Array.isArray(exceptionModalSelected.scheduleWindows)
      ? exceptionModalSelected.scheduleWindows.map((window: any) => `${String(window?.start || '').trim()}-${String(window?.end || '').trim()}`).filter((line) => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(line)).join('\n')
      : '';
    const rowFixedSlots = Array.isArray(exceptionModalSelected.scheduleFixedSlots)
      ? exceptionModalSelected.scheduleFixedSlots.map((slot: any) => `${String(slot?.start || '').trim()}-${Number(slot?.duration || 0)}`).join('\n')
      : '';
    const rowDurations = Array.isArray(exceptionModalSelected.scheduleDurations) ? exceptionModalSelected.scheduleDurations.join(', ') : '';
    setExceptionModalDraft({
      localDate: exceptionModalSelected.localDate,
      isClosed: Boolean(exceptionModalSelected.isClosed),
      scheduleMode: exceptionModalSelected.scheduleMode === 'RANGE' ? 'RANGE' : 'FIXED',
      scheduleOpenTime: exceptionModalSelected.scheduleOpenTime || '08:00',
      scheduleCloseTime: exceptionModalSelected.scheduleCloseTime || '22:00',
      scheduleIntervalMinutes: exceptionModalSelected.scheduleIntervalMinutes != null ? String(exceptionModalSelected.scheduleIntervalMinutes) : '30',
      scheduleWindows: rowWindows,
      scheduleDurations: rowDurations || '60',
      scheduleFixedSlots: rowFixedSlots
    });
  }, [exceptionModalSelected]);

  const handleSaveExceptionFromModal = async () => {
    if (!exceptionModalActivity || !exceptionModalDraft) return;
    try {
      await queueScheduleExceptionDraft(exceptionModalActivity, exceptionModalDraft);
      setExceptionModalItems((prev) => {
        const selectedPersistedId = exceptionModalSelected && Number(exceptionModalSelected.id) > 0
          ? Number(exceptionModalSelected.id)
          : 0;
        const nextItem: ActivityScheduleException = {
          id: selectedPersistedId,
          activityTypeId: exceptionModalActivity.id,
          localDate: exceptionModalDraft.localDate,
          isClosed: exceptionModalDraft.isClosed,
          scheduleMode: exceptionModalDraft.isClosed ? null : exceptionModalDraft.scheduleMode,
          scheduleOpenTime: exceptionModalDraft.isClosed ? null : exceptionModalDraft.scheduleOpenTime,
          scheduleCloseTime: exceptionModalDraft.isClosed ? null : exceptionModalDraft.scheduleCloseTime,
          scheduleIntervalMinutes: exceptionModalDraft.isClosed ? null : Number(exceptionModalDraft.scheduleIntervalMinutes || 0),
          scheduleWindows: exceptionModalDraft.isClosed || exceptionModalDraft.scheduleMode !== 'RANGE'
            ? null
            : parseRangeWindowsInput(exceptionModalDraft.scheduleWindows),
          scheduleDurations: exceptionModalDraft.isClosed
            ? []
            : parseDurationsInput(exceptionModalDraft.scheduleDurations, exceptionModalActivity.defaultDurationMinutes),
          scheduleFixedSlots: exceptionModalDraft.isClosed || exceptionModalDraft.scheduleMode !== 'FIXED'
            ? []
            : parseFixedSlotsInput(exceptionModalDraft.scheduleFixedSlots),
          createdAt: '',
          updatedAt: ''
        };
        const filtered = exceptionModalSelected && Number(exceptionModalSelected.id) > 0
          ? prev.filter((item) => Number(item.id) !== Number(exceptionModalSelected.id))
          : prev.filter((item) => item.localDate !== nextItem.localDate);
        return [nextItem, ...filtered].sort((a, b) => String(a.localDate).localeCompare(String(b.localDate)));
      });
      setActivityExceptionForm((prev) => ({
        ...prev,
        [exceptionModalActivity.id]: { ...exceptionModalDraft }
      }));
      // Volver al listado — los cambios quedan pendientes hasta el Guardar cambios global
      setExceptionModalSelectedDate('');
      setExceptionModalSelectedId(null);
      showInfo('Excepción en borrador guardada. Se aplica al guardar los cambios generales.');
    } catch (error: any) {
      showError(`No se pudo preparar la excepción: ${error.message}`);
    }
  };

  const handleDeleteExceptionFromModal = async () => {
    if (!exceptionModalActivity || !exceptionModalDraft || !exceptionModalSelected) return;
    try {
      if (exceptionModalSelectedIsPendingDraft) {
        setPendingScheduleExceptionMutations((prev) => (
          prev.filter((item) => !(
            item.activityId === exceptionModalActivity.id &&
            item.localDate === exceptionModalDraft.localDate
          ))
        ));
      } else {
        await queueScheduleExceptionDelete(exceptionModalActivity, exceptionModalDraft.localDate);
      }
      setExceptionModalItems((prev) => (
        exceptionModalSelected && Number(exceptionModalSelected.id) > 0
          ? prev.filter((item) => Number(item.id) !== Number(exceptionModalSelected.id))
          : prev.filter((item) => item.localDate !== exceptionModalDraft.localDate)
      ));
      setExceptionModalSelectedDate('');
      setExceptionModalSelectedId(null);
      showInfo(
        exceptionModalSelectedIsPendingDraft
          ? 'Borrador de excepción descartado.'
          : 'Excepción marcada para eliminar. Se aplica al guardar los cambios generales.'
      );
    } catch (error: any) {
      showError(`No se pudo preparar la eliminación: ${error.message}`);
    }
  };

  const handleDeleteExceptionWithConfirmation = () => {
    if (!canDeleteExceptionModalDraft || !exceptionModalDraft) return;
    setModalState({
      show: true,
      title: exceptionModalSelectedIsPendingDraft ? 'Descartar borrador' : 'Eliminar excepción',
      message: exceptionModalSelectedIsPendingDraft
        ? `¿Confirmás descartar el borrador del ${formatExceptionDate(exceptionModalDraft.localDate)}?`
        : `¿Confirmás eliminar la excepción del ${formatExceptionDate(exceptionModalDraft.localDate)}? Esta acción se aplicará al guardar los cambios generales.`,
      confirmText: exceptionModalSelectedIsPendingDraft ? 'Descartar' : 'Eliminar',
      cancelText: 'Cancelar',
      isWarning: true,
      onConfirm: () => { void handleDeleteExceptionFromModal(); },
    });
  };

  const handleCreateExceptionInModal = () => {
    if (!exceptionModalActivity) return;
    const localDate = String(exceptionModalNewDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      showError('La fecha nueva debe tener formato YYYY-MM-DD.');
      return;
    }
    const todayDateKey = getTodayDateKey();
    if (localDate < todayDateKey) {
      showError(`La fecha nueva no puede ser pasada (minimo permitido: ${todayDateKey}).`);
      return;
    }
    const base = activityScheduleForm[exceptionModalActivity.id];
    if (!base) {
      showError('No se encontró configuración base para la actividad.');
      return;
    }
    const existingSameDate = exceptionModalItems.find((item) => item.localDate === localDate) || null;
    if (existingSameDate) {
      setExceptionModalSelectedDate(existingSameDate.localDate);
      setExceptionModalSelectedId(Number(existingSameDate.id) > 0 ? Number(existingSameDate.id) : null);
      showInfo('Ya existe una excepción para esa fecha. Abrimos esa excepción para editarla.');
      return;
    }
    setExceptionModalSelectedDate(localDate);
    setExceptionModalSelectedId(null);
    setExceptionModalDraft({
      localDate,
      isClosed: false,
      scheduleMode: base.scheduleMode,
      scheduleOpenTime: base.scheduleOpenTime,
      scheduleCloseTime: base.scheduleCloseTime,
      scheduleIntervalMinutes: base.scheduleIntervalMinutes,
      scheduleWindows: base.scheduleWindows,
      scheduleDurations: base.scheduleDurations,
      scheduleFixedSlots: base.scheduleFixedSlots
    });
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
      setDiscountDrawerOpen(false);
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
    setDiscountDrawerMode('edit');
    setDiscountDrawerOpen(true);
  };

  const handleCancelEditDiscountPolicy = () => {
    setEditingDiscountPolicyId(null);
    setDiscountDrawerOpen(false);
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
      setDiscountDrawerOpen(false);
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

  const handleUpdateReviewStatus = async (reviewId: string, status: ClubReviewAdminStatus) => {
    if (!club) return;
    try {
      setReviewStatusUpdatingId(reviewId);
      await ClubAdminService.setClubReviewStatus(club.slug, reviewId, status);
      await loadClubReviews(club.slug, reviewStatusFilter);
    } catch (error: any) {
      showError(`No se pudo actualizar la reseña: ${error.message}`);
    } finally {
      setReviewStatusUpdatingId(null);
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
    setClientSearch(String(client.name || '').trim() || String(client.id));
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

  const addClosureDate = () => {
    if (clubForm.clubOperationalStatus === 'PERMANENTLY_CLOSED') {
      showError('No podés agregar cierres puntuales cuando el club está en cierre permanente.');
      return;
    }
    const value = String(closureDateInput || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      showError('La fecha de cierre debe tener formato YYYY-MM-DD.');
      return;
    }
    const todayDateKey = getTodayDateKey();
    if (value < todayDateKey) {
      showError(`No podes agregar una fecha de cierre pasada. Minimo permitido: ${todayDateKey}.`);
      return;
    }
    if (
      clubForm.clubOperationalStatus === 'TEMPORARY_CLOSED' &&
      /^\d{4}-\d{2}-\d{2}$/.test(clubForm.temporaryClosureStartDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(clubForm.temporaryClosureEndDate) &&
      value >= clubForm.temporaryClosureStartDate &&
      value <= clubForm.temporaryClosureEndDate
    ) {
      showError('Esa fecha ya está cubierta por el cierre temporal.');
      return;
    }
    setClosureDatesSet((prev) => Array.from(new Set([...prev, value])).sort());
    setClosureDateInput('');
  };

  const removeClosureDate = (date: string) => {
    setClosureDatesSet((prev) => prev.filter((item) => item !== date));
  };

  const isDepositMode = clubForm.bookingConfirmationMode === 'DEPOSIT_REQUIRED';
  const hasTemporaryClosureRange =
    clubForm.clubOperationalStatus === 'TEMPORARY_CLOSED' &&
    /^\d{4}-\d{2}-\d{2}$/.test(clubForm.temporaryClosureStartDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(clubForm.temporaryClosureEndDate) &&
    clubForm.temporaryClosureStartDate <= clubForm.temporaryClosureEndDate;
  const temporaryClosureOverlappingDates = hasTemporaryClosureRange
    ? closureDatesSet.filter((date) => date >= clubForm.temporaryClosureStartDate && date <= clubForm.temporaryClosureEndDate)
    : [];



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

  const inputCls = "h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] text-[#1f2638] outline-none focus:border-[#3053e2] transition placeholder:text-[#b0b8c9]";
  const labelCls = "mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#6f7890]";
  const cardCls = "rounded-xl border border-[#dce2ee] bg-white p-4";
  const cardTitleCls = "mb-4 text-[13px] font-semibold text-[#1f2638]";
  const checkboxCls = (active: boolean) => `flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition cursor-pointer ${active ? 'border-[#3053e2] bg-[#3053e2]' : 'border-[#dce2ee] bg-white'}`;

  // Format "2026-05-01" → "Vie 1 de mayo" (no timezone shift)
  const formatExceptionDate = (dateStr: string): string => {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return dateStr;
    const date = new Date(y, m - 1, d);
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const monthNames = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${dayNames[date.getDay()]} ${d} de ${monthNames[m - 1]} de ${y}`;
  };

  return (
    <>
      {/* ── Fixed unsaved-changes bar ── Oculta mientras el drawer de excepciones está abierto para evitar confusión con el footer del drawer */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-[2000] transition-transform duration-200 ease-out lg:left-[var(--admin-playground-sidebar-left,168px)] ${
          hasUnsavedChanges && !Boolean(exceptionModalActivity) ? 'translate-y-0' : 'translate-y-full'
        }`}
        aria-hidden={!hasUnsavedChanges || Boolean(exceptionModalActivity)}
      >
        <div className="flex items-center gap-3 border-t border-[#dce2ee] bg-[#ffffff] px-5 py-3 shadow-[0_-4px_16px_rgba(31,38,56,0.08)]">
          <span className="h-2 w-2 shrink-0 rounded-full bg-[#f59e0b]" />
          <span className="text-[12px] font-medium text-[#1f2638]">
            {configChanges.length} cambio{configChanges.length !== 1 ? 's' : ''} sin guardar
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleDiscardChanges}
              className="h-8 rounded-lg border border-[#dce2ee] bg-white px-3 text-[12px] font-medium text-[#6f7890] transition hover:bg-[#f4f6fb]"
            >
              Descartar
            </button>
            <button
              type="button"
              onClick={() => void handleUpdateClub()}
              className="h-8 rounded-lg bg-[#3053e2] px-4 text-[12px] font-semibold text-white transition hover:bg-[#2748cc]"
            >
              Guardar cambios
            </button>
          </div>
        </div>
      </div>

      <div className={`flex w-full flex-col gap-4 transition-[padding-bottom] duration-200 ${hasUnsavedChanges && !Boolean(exceptionModalActivity) ? 'pb-16' : ''}`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[15px] font-semibold text-[#1f2638]">{title}</h1>
            {subtitle && <p className="text-[12px] text-[#6f7890] mt-0.5">{subtitle}</p>}
          </div>
          {effectiveTab === 'operation' && (
            <button
              type="button"
              onClick={restoreBookingPolicyDefaults}
              className="shrink-0 h-8 rounded-xl border border-[#dce2ee] bg-white px-3 text-[11px] font-medium text-[#6f7890] hover:bg-[#f4f6fb] transition"
            >
              Restaurar recomendados
            </button>
          )}
        </div>

        {!forcedTab && (
          <AdminSegmentedControl
            options={[
              { value: 'identity', label: 'Identidad' },
              { value: 'operation', label: 'Operación' },
              { value: 'agenda', label: 'Agenda' },
              { value: 'discounts', label: 'Descuentos' },
              { value: 'audit', label: 'Auditoría' },
            ]}
            value={activeTab}
            onChange={(v) => setActiveTab(v as typeof activeTab)}
            ariaLabel="Secciones de configuración"
          />
        )}

        {loadingClub ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-[#f4f6fb]" />
            ))}
          </div>
        ) : !club ? (
          <div className={cardCls}>
            <p className="text-[13px] text-[#6f7890]">No se pudo cargar la información del club.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* ----- TAB: IDENTIDAD ----- */}
            {effectiveTab === 'identity' && (
              <div className="space-y-4">
                {/* Datos básicos */}
                <div className={cardCls}>
                  <p className={cardTitleCls}>Datos básicos</p>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className={labelCls}>Slug (URL)</label>
                      <input
                        type="text"
                        value={clubForm.slug}
                        onChange={(e) => setClubForm({ ...clubForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                        className={inputCls}
                        placeholder="ej: las-tejas-padel"
                      />
                      <p className="mt-1 text-[11px] text-[#6f7890]">tucancha.com/club/<span className="text-[#3053e2]">{clubForm.slug || '...'}</span></p>
                    </div>
                    <div>
                      <label className={labelCls}>Nombre comercial</label>
                      <input
                        type="text"
                        value={clubForm.name}
                        onChange={(e) => setClubForm({ ...clubForm, name: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className={labelCls}>Descripción</label>
                      <textarea
                        rows={3}
                        value={clubForm.description || ''}
                        onChange={(e) => setClubForm({ ...clubForm, description: e.target.value } as typeof clubForm)}
                        className={`${inputCls} h-auto py-2.5 resize-none`}
                        placeholder="Breve descripción del club..."
                      />
                    </div>
                    <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="md:col-span-2">
                        <label className={labelCls}>Dirección</label>
                        <input
                          type="text"
                          value={clubForm.addressLine}
                          onChange={(e) => setClubForm({ ...clubForm, addressLine: e.target.value })}
                          className={inputCls}
                          placeholder="Calle y número"
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Ciudad</label>
                        <input
                          type="text"
                          value={clubForm.city}
                          onChange={(e) => setClubForm({ ...clubForm, city: e.target.value })}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Provincia</label>
                        <input
                          type="text"
                          value={clubForm.province}
                          onChange={(e) => setClubForm({ ...clubForm, province: e.target.value })}
                          className={inputCls}
                        />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>Email administrativo</label>
                      <div className="relative">
                        <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6f7890]" />
                        <input
                          type="email"
                          value={clubForm.contactInfo}
                          onChange={(e) => setClubForm({ ...clubForm, contactInfo: e.target.value })}
                          className={`${inputCls} pl-9`}
                        />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>Teléfono público</label>
                      <div className="relative">
                        <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6f7890]" />
                        <input
                          type="text"
                          value={clubForm.phone}
                          maxLength={18}
                          onChange={(e) => setClubForm({ ...clubForm, phone: formatPhoneInput(e.target.value) })}
                          className={`${inputCls} pl-9`}
                          placeholder="+54 9 351..."
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Redes sociales */}
                <div className={cardCls}>
                  <p className={cardTitleCls}>Redes sociales</p>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <label className={labelCls}>Instagram</label>
                      <div className="relative">
                        <Instagram size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6f7890]" />
                        <input
                          type="url"
                          value={clubForm.instagramUrl || ''}
                          onChange={(e) => setClubForm({ ...clubForm, instagramUrl: e.target.value } as typeof clubForm)}
                          className={`${inputCls} pl-9`}
                          placeholder="https://instagram.com/..."
                        />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>Facebook</label>
                      <div className="relative">
                        <Facebook size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6f7890]" />
                        <input
                          type="url"
                          value={clubForm.facebookUrl || ''}
                          onChange={(e) => setClubForm({ ...clubForm, facebookUrl: e.target.value } as typeof clubForm)}
                          className={`${inputCls} pl-9`}
                          placeholder="https://facebook.com/..."
                        />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>Sitio web</label>
                      <div className="relative">
                        <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6f7890]" />
                        <input
                          type="url"
                          value={clubForm.websiteUrl || ''}
                          onChange={(e) => setClubForm({ ...clubForm, websiteUrl: e.target.value } as typeof clubForm)}
                          className={`${inputCls} pl-9`}
                          placeholder="https://..."
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Logo */}
                <div className={cardCls}>
                  <p className={cardTitleCls}>Logo del club</p>
                  <div className="flex items-center gap-4">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#dce2ee] bg-[#f8f9fd]">
                      {logoPreview
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={logoPreview} alt="Logo" className="h-full w-full object-contain p-1" />
                        : <ImageIcon size={24} className="text-[#b0b8c9]" />
                      }
                    </div>
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="h-9 rounded-xl border border-[#dce2ee] bg-white px-3 text-[12px] font-medium text-[#1f2638] hover:bg-[#f4f6fb] transition"
                        >
                          Subir imagen
                        </button>
                        {logoPreview && (
                          <button
                            type="button"
                            onClick={handleRemoveLogo}
                            className="h-9 rounded-xl border border-red-100 bg-red-50 px-3 text-[12px] font-medium text-red-600 hover:bg-red-100 transition"
                          >
                            Eliminar
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-[#6f7890]">Recomendado: 512×512px, máx 2MB (PNG/JPG)</p>
                      {logoError && (
                        <p className="flex items-center gap-1 text-[11px] text-red-500">
                          <AlertTriangle size={11} /> {logoError}
                        </p>
                      )}
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFileChange} />
                  </div>
                </div>

                {/* Imagen del club */}
                <div className={cardCls}>
                  <p className={cardTitleCls}>Imagen de portada</p>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                    <div className="flex h-36 w-full shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#dce2ee] bg-[#f8f9fd] lg:w-64">
                      {clubImagePreview
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={clubImagePreview} alt="Portada" className="h-full w-full object-cover" />
                        : (
                          <div className="flex flex-col items-center gap-1 text-[#b0b8c9]">
                            <ImageIcon size={28} />
                            <span className="text-[11px]">Sin imagen</span>
                          </div>
                        )
                      }
                    </div>
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => clubImageInputRef.current?.click()}
                          className="h-9 rounded-xl border border-[#dce2ee] bg-white px-3 text-[12px] font-medium text-[#1f2638] hover:bg-[#f4f6fb] transition"
                        >
                          Subir imagen
                        </button>
                        {clubImagePreview && (
                          <button
                            type="button"
                            onClick={handleRemoveClubImage}
                            className="h-9 rounded-xl border border-red-100 bg-red-50 px-3 text-[12px] font-medium text-red-600 hover:bg-red-100 transition"
                          >
                            Eliminar
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-[#6f7890]">Recomendado: 1600×900px, máx 4MB (PNG/JPG)</p>
                      {clubImageError && (
                        <p className="flex items-center gap-1 text-[11px] text-red-500">
                          <AlertTriangle size={11} /> {clubImageError}
                        </p>
                      )}
                    </div>
                    <input ref={clubImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleClubImageFileChange} />
                  </div>
                </div>
              </div>
            )}

            {/* ----- TAB: OPERACIÓN ----- */}
            {effectiveTab === 'operation' && (
              <div className="space-y-4">

                {/* Confirmación de reservas */}
                <div className={cardCls}>
                  <p className={cardTitleCls}>Confirmación de reservas</p>
                  <div className="space-y-4">
                    <div>
                      <label className={labelCls}>Modo de confirmación</label>
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
                        className={`${inputCls} w-full md:w-80`}
                      >
                        {BOOKING_CONFIRMATION_MODES.map((mode) => (
                          <option key={mode.value} value={mode.value}>{mode.label}</option>
                        ))}
                      </select>
                      <p className="mt-1.5 text-[11px] text-[#6f7890]">
                        {BOOKING_CONFIRMATION_MODES.find((m) => m.value === clubForm.bookingConfirmationMode)?.helper}
                      </p>
                    </div>

                    {isDepositMode && (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <label className={labelCls}>Seña mínima (%)</label>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={clubForm.bookingDepositPercent}
                            onChange={(e) => setClubForm({ ...clubForm, bookingDepositPercent: e.target.value })}
                            className={inputCls}
                            placeholder="30"
                          />
                        </div>
                        <div className="flex items-end pb-1">
                          <label className="flex cursor-pointer items-center gap-2.5">
                            <div
                              className={checkboxCls(clubForm.allowManualConfirmationOverride)}
                              onClick={() => setClubForm({ ...clubForm, allowManualConfirmationOverride: !clubForm.allowManualConfirmationOverride })}
                            >
                              {clubForm.allowManualConfirmationOverride && <Check size={12} strokeWidth={3} className="text-white" />}
                            </div>
                            <span className="text-[12px] text-[#1f2638]">Permitir confirmación manual sin seña</span>
                          </label>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label className={labelCls}>Anticipación máx. usuario (días)</label>
                        <input
                          type="number"
                          min={1}
                          value={clubForm.bookingSimpleAdvanceDaysUser}
                          onChange={(e) => setClubForm({ ...clubForm, bookingSimpleAdvanceDaysUser: e.target.value })}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Anticipación máx. admin (días)</label>
                        <input
                          type="number"
                          min={1}
                          value={clubForm.bookingSimpleAdvanceDaysAdmin}
                          onChange={(e) => setClubForm({ ...clubForm, bookingSimpleAdvanceDaysAdmin: e.target.value })}
                          className={inputCls}
                        />
                      </div>
                    </div>

                    <label className="flex cursor-pointer items-center gap-2.5">
                      <div
                        className={checkboxCls(clubForm.allowAdminSkipSimpleAdvanceLimit)}
                        onClick={() => setClubForm({ ...clubForm, allowAdminSkipSimpleAdvanceLimit: !clubForm.allowAdminSkipSimpleAdvanceLimit })}
                      >
                        {clubForm.allowAdminSkipSimpleAdvanceLimit && <Check size={12} strokeWidth={3} className="text-white" />}
                      </div>
                      <span className="text-[12px] text-[#1f2638]">Permitir que admin omita límite de anticipación</span>
                    </label>
                  </div>
                </div>

                {/* Auto-cancelación */}
                <div className={cardCls}>
                  <p className={cardTitleCls}>Auto-cancelación</p>
                  <div className="space-y-4">
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <div
                        className={checkboxCls(clubForm.autoCancelPendingBookingsEnabled)}
                        onClick={() => setClubForm({ ...clubForm, autoCancelPendingBookingsEnabled: !clubForm.autoCancelPendingBookingsEnabled })}
                      >
                        {clubForm.autoCancelPendingBookingsEnabled && <Check size={12} strokeWidth={3} className="text-white" />}
                      </div>
                      <span className="text-[12px] text-[#1f2638]">Cancelar reservas pendientes automáticamente</span>
                    </label>
                    {clubForm.autoCancelPendingBookingsEnabled && (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 pl-7">
                        <div>
                          <label className={labelCls}>Minutos antes del turno</label>
                          <input
                            type="number"
                            min={1}
                            value={clubForm.autoCancelPendingBookingsMinutesBefore}
                            onChange={(e) => setClubForm({ ...clubForm, autoCancelPendingBookingsMinutesBefore: e.target.value })}
                            className={inputCls}
                            placeholder="60"
                          />
                        </div>
                        <div className="flex items-end pb-1">
                          <label className="flex cursor-pointer items-center gap-2.5">
                            <div
                              className={checkboxCls(clubForm.autoCancelPendingBookingsOnlyIfUnpaid)}
                              onClick={() => setClubForm({ ...clubForm, autoCancelPendingBookingsOnlyIfUnpaid: !clubForm.autoCancelPendingBookingsOnlyIfUnpaid })}
                            >
                              {clubForm.autoCancelPendingBookingsOnlyIfUnpaid && <Check size={12} strokeWidth={3} className="text-white" />}
                            </div>
                            <span className="text-[12px] text-[#1f2638]">Solo si no tiene pago registrado</span>
                          </label>
                        </div>
                      </div>
                    )}
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <div
                        className={checkboxCls(clubForm.autoCancelPendingWarningEnabled)}
                        onClick={() => setClubForm({ ...clubForm, autoCancelPendingWarningEnabled: !clubForm.autoCancelPendingWarningEnabled })}
                      >
                        {clubForm.autoCancelPendingWarningEnabled && <Check size={12} strokeWidth={3} className="text-white" />}
                      </div>
                      <span className="text-[12px] text-[#1f2638]">Enviar aviso previo a la cancelación</span>
                    </label>
                    {clubForm.autoCancelPendingWarningEnabled && (
                      <div className="pl-7">
                        <label className={labelCls}>Minutos antes del aviso</label>
                        <input
                          type="number"
                          min={1}
                          value={clubForm.autoCancelPendingWarningMinutesBefore}
                          onChange={(e) => setClubForm({ ...clubForm, autoCancelPendingWarningMinutesBefore: e.target.value })}
                          className={`${inputCls} w-48`}
                          placeholder="120"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Iluminación */}
                <div className={cardCls}>
                  <p className={cardTitleCls}>Iluminación</p>
                  <div className="space-y-4">
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <div
                        className={checkboxCls(clubForm.lightsEnabled)}
                        onClick={() => setClubForm({ ...clubForm, lightsEnabled: !clubForm.lightsEnabled })}
                      >
                        {clubForm.lightsEnabled && <Check size={12} strokeWidth={3} className="text-white" />}
                      </div>
                      <span className="text-[12px] text-[#1f2638]">Activar recargo nocturno</span>
                    </label>
                    {clubForm.lightsEnabled && (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 pl-7">
                        <div>
                          <label className={labelCls}>Monto extra ($)</label>
                          <input
                            type="number"
                            min={0}
                            step={100}
                            value={clubForm.lightsExtraAmount}
                            onChange={(e) => setClubForm({ ...clubForm, lightsExtraAmount: e.target.value })}
                            className={inputCls}
                            placeholder="5000"
                          />
                        </div>
                        <div>
                          <label className={labelCls}>Desde la hora</label>
                          <select
                            value={clubForm.lightsFromHour || ''}
                            onChange={(e) => setClubForm({ ...clubForm, lightsFromHour: e.target.value })}
                            className={inputCls}
                          >
                            <option value="">Seleccionar...</option>
                            {LIGHTS_FROM_HOUR_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Profesor */}
                <div className={cardCls}>
                  <p className={cardTitleCls}>Profesor (operativo)</p>
                  <p className="mb-4 text-[12px] text-[#6f7890]">Los descuentos económicos se configuran en la pestaña Descuentos. Esta sección solo define el ajuste operativo.</p>
                  <div className="space-y-4">
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <div
                        className={checkboxCls(clubForm.professorDurationOverrideEnabled)}
                        onClick={() => setClubForm({ ...clubForm, professorDurationOverrideEnabled: !clubForm.professorDurationOverrideEnabled })}
                      >
                        {clubForm.professorDurationOverrideEnabled && <Check size={12} strokeWidth={3} className="text-white" />}
                      </div>
                      <span className="text-[12px] text-[#1f2638]">Permitir ajuste de duración para profesor</span>
                    </label>
                    {clubForm.professorDurationOverrideEnabled && (
                      <div className="pl-7">
                        <label className={labelCls}>Duración especial (min)</label>
                        <input
                          type="number"
                          min={1}
                          value={clubForm.professorDurationOverrideMinutes}
                          onChange={(e) => setClubForm({ ...clubForm, professorDurationOverrideMinutes: e.target.value })}
                          className={`${inputCls} w-48`}
                          placeholder="60"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ----- TAB: AGENDA ----- */}
            {effectiveTab === 'agenda' && (
              <div className="space-y-4">
                {/* Días de apertura */}
                <div className={cardCls}>
                  <p className={cardTitleCls}>Días de apertura</p>
                  <p className="mb-3 text-[12px] text-[#6f7890]">Seleccioná los días en los que el club está abierto. Sin selección = abre todos los días.</p>
                  <div className="flex flex-wrap gap-2">
                    {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((label, idx) => {
                      const day = idx % 7;
                      const active = openingDaysSet.includes(day);
                      return (
                        <button
                          key={label}
                          type="button"
                          onClick={() => toggleOpeningDay(day)}
                          className={`h-9 w-12 rounded-xl text-[12px] font-medium transition ${active ? 'bg-[#edf1ff] text-[#3053e2] border border-[#c7d3f9]' : 'border border-[#dce2ee] bg-white text-[#6f7890] hover:bg-[#f4f6fb]'}`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Estado operativo */}
                <div className={cardCls}>
                  <p className={cardTitleCls}>Estado operativo</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {CLUB_OPERATIONAL_STATUS_OPTIONS.map((option) => {
                      const active = clubForm.clubOperationalStatus === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setClubForm((prev) => ({
                            ...prev,
                            clubOperationalStatus: option.value,
                            ...(option.value !== 'TEMPORARY_CLOSED' ? { temporaryClosureStartDate: '', temporaryClosureEndDate: '' } : {})
                          }))}
                          className={`rounded-xl border px-4 py-3 text-left transition ${active ? 'border-[#3053e2] bg-[#edf1ff]' : 'border-[#dce2ee] bg-white hover:bg-[#f4f6fb]'}`}
                        >
                          <p className={`text-[12px] font-semibold ${active ? 'text-[#3053e2]' : 'text-[#1f2638]'}`}>{option.label}</p>
                          <p className="mt-1 text-[11px] text-[#6f7890] leading-relaxed">{option.helper}</p>
                        </button>
                      );
                    })}
                  </div>

                  {clubForm.clubOperationalStatus === 'TEMPORARY_CLOSED' && (
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label className={labelCls}>Inicio del cierre temporal</label>
                        <AdminDateInput
                          value={clubForm.temporaryClosureStartDate}
                          onChange={(v) => setClubForm((prev) => ({ ...prev, temporaryClosureStartDate: v }))}
                          min={getTodayDateKey()}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Fin del cierre temporal</label>
                        <AdminDateInput
                          value={clubForm.temporaryClosureEndDate}
                          onChange={(v) => setClubForm((prev) => ({ ...prev, temporaryClosureEndDate: v }))}
                          min={clubForm.temporaryClosureStartDate || getTodayDateKey()}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Fechas de cierre */}
                <div className={cardCls}>
                  <p className={cardTitleCls}>Fechas de cierre puntual</p>
                  <p className="mb-3 text-[12px] text-[#6f7890]">Bloqueá días específicos (feriados, mantenimiento). Formato: YYYY-MM-DD.</p>
                  {clubForm.clubOperationalStatus === 'PERMANENTLY_CLOSED' && (
                    <p className="mb-3 text-[12px] text-red-500">En cierre permanente no se permiten fechas de cierre puntual.</p>
                  )}
                  <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <div className="w-full md:w-64">
                      <AdminDateInput
                        value={closureDateInput}
                        onChange={setClosureDateInput}
                        min={getTodayDateKey()}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={addClosureDate}
                      disabled={clubForm.clubOperationalStatus === 'PERMANENTLY_CLOSED' || !closureDateInput}
                      className="h-9 rounded-xl bg-[#3053e2] px-4 text-[12px] font-semibold text-white hover:bg-[#2748cc] transition disabled:opacity-40"
                    >
                      Agregar cierre
                    </button>
                  </div>
                  {closureDatesSet.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {closureDatesSet.map((date) => (
                        <span key={date} className="inline-flex items-center gap-1.5 rounded-lg border border-[#dce2ee] bg-[#f4f6fb] px-2.5 py-1.5 text-[12px] text-[#1f2638]">
                          {date}
                          <button
                            type="button"
                            onClick={() => removeClosureDate(date)}
                            className="text-[#6f7890] hover:text-red-500 transition"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Horarios por actividad */}
                <div className={cardCls}>
                  <p className={cardTitleCls}>Horarios por actividad</p>
                  {activityTypes.length === 0 ? (
                    <p className="text-[12px] text-[#6f7890]">No hay actividades configuradas.</p>
                  ) : (
                    <div className="space-y-4">
                      {activityTypes.map((activity) => {
                        const cfg = activityScheduleForm[activity.id];
                        if (!cfg) return null;
                        return (
                          <div key={activity.id} className="rounded-xl border border-[#dce2ee] p-4">
                            <div className="mb-3 flex items-center justify-between">
                              <p className="text-[13px] font-semibold text-[#1f2638]">{activity.name}</p>
                              <div className="flex items-center gap-2">
                                {pendingScheduleExceptionMutations.some((item) => item.activityId === activity.id) && (
                                  <span className="rounded-full bg-[#edf1ff] px-2 py-0.5 text-[10px] font-semibold text-[#3053e2]">Cambios pendientes</span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openExceptionModalForActivity(activity)}
                                  className="h-8 rounded-xl border border-[#dce2ee] bg-white px-3 text-[11px] text-[#6f7890] hover:bg-[#f4f6fb] transition"
                                >
                                  Excepciones
                                  {Number(activityExceptionSummary[activity.id]?.count || 0) > 0 && (
                                    <span className="ml-1.5 rounded-full bg-[#edf1ff] px-1.5 py-0.5 text-[10px] text-[#3053e2]">
                                      {activityExceptionSummary[activity.id].count}
                                    </span>
                                  )}
                                </button>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                              <div>
                                <label className={labelCls}>Modo</label>
                                <select
                                  value={cfg.scheduleMode}
                                  onChange={(e) => setActivityScheduleForm((prev) => ({
                                    ...prev,
                                    [activity.id]: { ...prev[activity.id], scheduleMode: e.target.value as 'FIXED' | 'RANGE' }
                                  }))}
                                  className={inputCls}
                                >
                                  <option value="FIXED">Turnos fijos</option>
                                  <option value="RANGE">Rango horario</option>
                                </select>
                              </div>
                              <div className="md:col-span-3">
                                <label className={labelCls}>Duraciones (min, separadas por coma)</label>
                                <input
                                  type="text"
                                  value={cfg.scheduleDurations}
                                  onChange={(e) => setActivityScheduleForm((prev) => ({
                                    ...prev,
                                    [activity.id]: { ...prev[activity.id], scheduleDurations: e.target.value }
                                  }))}
                                  className={inputCls}
                                  placeholder="60, 90"
                                />
                              </div>
                              {cfg.scheduleMode === 'RANGE' ? (
                                <>
                                  <div>
                                    <label className={labelCls}>Apertura</label>
                                    <input
                                      type="time"
                                      value={cfg.scheduleOpenTime}
                                      onChange={(e) => setActivityScheduleForm((prev) => ({
                                        ...prev,
                                        [activity.id]: { ...prev[activity.id], scheduleOpenTime: e.target.value }
                                      }))}
                                      className={inputCls}
                                    />
                                  </div>
                                  <div>
                                    <label className={labelCls}>Cierre</label>
                                    <input
                                      type="time"
                                      value={cfg.scheduleCloseTime}
                                      onChange={(e) => setActivityScheduleForm((prev) => ({
                                        ...prev,
                                        [activity.id]: { ...prev[activity.id], scheduleCloseTime: e.target.value }
                                      }))}
                                      className={inputCls}
                                    />
                                  </div>
                                  <div>
                                    <label className={labelCls}>Intervalo (min)</label>
                                    <input
                                      type="number"
                                      min={1}
                                      value={cfg.scheduleIntervalMinutes}
                                      onChange={(e) => setActivityScheduleForm((prev) => ({
                                        ...prev,
                                        [activity.id]: { ...prev[activity.id], scheduleIntervalMinutes: e.target.value }
                                      }))}
                                      className={inputCls}
                                    />
                                  </div>
                                  <div className="md:col-span-4">
                                    <label className={labelCls}>Franjas cortadas (opcional, una por línea: HH:mm-HH:mm)</label>
                                    <textarea
                                      rows={3}
                                      value={cfg.scheduleWindows}
                                      onChange={(e) => setActivityScheduleForm((prev) => ({
                                        ...prev,
                                        [activity.id]: { ...prev[activity.id], scheduleWindows: e.target.value }
                                      }))}
                                      className={`${inputCls} h-auto py-2.5 resize-none`}
                                      placeholder={'08:00-12:00\n16:00-23:00'}
                                    />
                                  </div>
                                </>
                              ) : (
                                <div className="md:col-span-4">
                                  <label className={labelCls}>Turnos fijos (uno por línea: HH:mm-60)</label>
                                  <textarea
                                    rows={4}
                                    value={cfg.scheduleFixedSlots}
                                    onChange={(e) => setActivityScheduleForm((prev) => ({
                                      ...prev,
                                      [activity.id]: { ...prev[activity.id], scheduleFixedSlots: e.target.value }
                                    }))}
                                    className={`${inputCls} h-auto py-2.5 resize-none`}
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

                {/* Turnos fijos por actividad */}
                {activitySettings.length > 0 && (
                  <div className={cardCls}>
                    <p className={cardTitleCls}>Configuración de turnos fijos por actividad</p>
                    <div className="space-y-3">
                      {activitySettings.map((activity) => (
                        <div key={activity.key} className="grid grid-cols-1 gap-3 md:grid-cols-3 rounded-xl border border-[#dce2ee] p-3">
                          <div>
                            <label className={labelCls}>Actividad</label>
                            <input
                              type="text"
                              value={activity.label}
                              readOnly
                              className={`${inputCls} bg-[#f8f9fd]`}
                            />
                          </div>
                          <div>
                            <label className={labelCls}>Días hacia adelante</label>
                            <input
                              type="number"
                              min={1}
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
                              className={inputCls}
                            />
                          </div>
                          <div>
                            <label className={labelCls}>Frecuencia generación (días)</label>
                            <input
                              type="number"
                              min={1}
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
                              className={inputCls}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ----- TAB: DESCUENTOS ----- */}
            {effectiveTab === 'discounts' && (
              <div className="space-y-4">
                <div className={cardCls}>
                  <p className={cardTitleCls}>Política de cierre de caja</p>
                  <p className="mb-3 text-[12px] text-[#6f7890]">
                    Define si el sistema permite cerrar caja cuando todavía hay cuentas corrientes abiertas.
                  </p>
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <div
                      className={checkboxCls(clubForm.enforceCashShiftCloseWithOpenAccounts)}
                      onClick={() => setClubForm({ ...clubForm, enforceCashShiftCloseWithOpenAccounts: !clubForm.enforceCashShiftCloseWithOpenAccounts })}
                    >
                      {clubForm.enforceCashShiftCloseWithOpenAccounts && <Check size={12} strokeWidth={3} className="text-white" />}
                    </div>
                    <span className="text-[12px] text-[#1f2638]">Bloquear cierre de caja con cuentas corrientes abiertas</span>
                  </label>
                </div>

                {/* Lista de políticas */}
                <div className={cardCls}>
                  <div className="mb-4 flex items-center justify-between">
                    <p className={cardTitleCls} style={{ marginBottom: 0 }}>Políticas de descuento</p>
                    <button
                      type="button"
                      onClick={() => {
                        setDiscountPolicyForm({ name: '', scope: 'BOOKING', amountType: 'PERCENT', amountValue: '', applyMode: 'INCLUDE_ONLY', isStackable: false, priority: '100' });
                        setDiscountDrawerMode('create');
                        setDiscountDrawerOpen(true);
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#3053e2] px-3 text-[11px] font-semibold text-white transition hover:bg-[#2748cc]"
                    >
                      + Nueva política
                    </button>
                  </div>
                  {loadingDiscountPolicies ? (
                    <p className="text-[12px] text-[#6f7890]">Cargando...</p>
                  ) : discountPolicies.length === 0 ? (
                    <p className="text-[12px] text-[#6f7890]">No hay políticas configuradas. Creá la primera con el botón de arriba.</p>
                  ) : (
                    <div className="space-y-2">
                      {discountPolicies.map((policy) => (
                        <div key={policy.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#dce2ee] p-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-[13px] font-medium text-[#1f2638]">{policy.name}</p>
                              {!policy.isActive && (
                                <span className="rounded-full bg-[#f4f6fb] px-2 py-0.5 text-[10px] text-[#6f7890]">Inactiva</span>
                              )}
                            </div>
                            <p className="mt-0.5 text-[11px] text-[#6f7890]">
                              {policy.scope} · {policy.amountType === 'PERCENT' ? `${policy.amountValue}%` : `$${policy.amountValue}`} · prio {policy.priority}
                              {policy.isStackable ? ' · acumulable' : ''}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleStartEditDiscountPolicy(policy)}
                            className="h-8 shrink-0 rounded-xl border border-[#dce2ee] bg-white px-3 text-[11px] text-[#6f7890] transition hover:bg-[#f4f6fb]"
                          >
                            Editar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Asignación a clientes */}
                <div className={cardCls}>
                  <p className={cardTitleCls}>Asignar política a cliente</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <label className={labelCls}>Buscar cliente</label>
                      <div className="relative" ref={clientSearchWrapperRef}>
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6f7890]" />
                        <input
                          type="text"
                          value={clientSearch}
                          onChange={(e) => {
                            setClientSearch(e.target.value);
                            setShowClientSearchDropdown(true);
                            if (clientSearchTimeoutRef.current) clearTimeout(clientSearchTimeoutRef.current);
                            clientSearchTimeoutRef.current = setTimeout(async () => {
                              if (e.target.value.trim().length >= 2) {
                                try {
                                  const results = await searchClients(club?.slug ?? '', e.target.value.trim());
                                  setClientSearchResults(results);
                                } catch {
                                  setClientSearchResults([]);
                                }
                              } else {
                                setClientSearchResults([]);
                              }
                            }, 300);
                          }}
                          onFocus={() => setShowClientSearchDropdown(true)}
                          className={`${inputCls} pl-9`}
                          placeholder="Nombre o email..."
                        />
                        {showClientSearchDropdown && clientSearchResults.length > 0 && (
                          <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-[#dce2ee] bg-white shadow-lg">
                            {clientSearchResults.map((client) => (
                              <button
                                key={client.id}
                                type="button"
                                onClick={() => {
                                  setSelectedDiscountClient(client);
                                  setClientSearch(client.name);
                                  setShowClientSearchDropdown(false);
                                }}
                                className="flex w-full flex-col px-3 py-2.5 text-left hover:bg-[#f4f6fb] transition first:rounded-t-xl last:rounded-b-xl"
                              >
                                <span className="text-[12px] font-medium text-[#1f2638]">{client.name}</span>
                                <span className="text-[11px] text-[#6f7890]">{client.email}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>Política</label>
                      <select
                        value={selectedPolicyIdForAssignment}
                        onChange={(e) => setSelectedPolicyIdForAssignment(e.target.value)}
                        className={inputCls}
                      >
                        <option value="">Seleccionar política...</option>
                        {discountPolicies.filter((p) => p.isActive).map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Notas (opcional)</label>
                      <input
                        type="text"
                        value={assignmentNotes}
                        onChange={(e) => setAssignmentNotes(e.target.value)}
                        className={inputCls}
                        placeholder="Motivo de la asignación..."
                      />
                    </div>
                    <div className="md:col-span-2">
                      <button
                        type="button"
                        disabled={!selectedDiscountClient || !selectedPolicyIdForAssignment}
                        onClick={() => void handleAssignPolicyToClient()}
                        className="h-9 rounded-xl bg-[#3053e2] px-4 text-[12px] font-semibold text-white hover:bg-[#2748cc] transition disabled:opacity-40"
                      >
                        Asignar
                      </button>
                    </div>
                  </div>

                  {/* Asignaciones existentes */}
                  {selectedDiscountClient && (
                    <div className="mt-4">
                      <p className="mb-2 text-[12px] font-medium text-[#1f2638]">Asignaciones de {selectedDiscountClient.name}</p>
                      {loadingClientAssignments ? (
                        <p className="text-[12px] text-[#6f7890]">Cargando...</p>
                      ) : clientAssignments.length === 0 ? (
                        <p className="text-[12px] text-[#6f7890]">Sin asignaciones.</p>
                      ) : (
                        <div className="space-y-2">
                          {clientAssignments.map((assignment: { id: string; policy?: { name: string }; notes?: string }) => (
                            <div key={assignment.id} className="flex items-center justify-between rounded-xl border border-[#dce2ee] p-3">
                              <div>
                                <p className="text-[12px] font-medium text-[#1f2638]">{assignment.policy?.name || assignment.id}</p>
                                {assignment.notes && <p className="text-[11px] text-[#6f7890]">{assignment.notes}</p>}
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleToggleAssignment(assignment.id, false)}
                                className="h-8 rounded-xl border border-red-100 bg-red-50 px-3 text-[11px] text-red-600 hover:bg-red-100 transition"
                              >
                                Desactivar
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ----- TAB: AUDITORÍA ----- */}
            {effectiveTab === 'audit' && (
              <div className="space-y-4">
                {/* Historial de cambios */}
                <div className={cardCls}>
                  <p className={cardTitleCls}>Historial de cambios</p>
                  {changeHistory.length === 0 ? (
                    <p className="text-[12px] text-[#6f7890]">Aún no hay cambios auditados para este club.</p>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-auto pr-1">
                      {changeHistory.map((entry) => (
                        <div key={entry.id} className="rounded-xl border border-[#dce2ee] p-3">
                          <p className="text-[12px] font-medium text-[#1f2638]">
                            {entry.actor} · {new Date(entry.changedAt).toLocaleString('es-AR')}
                          </p>
                          <p className="mt-0.5 text-[11px] text-[#6f7890]">{entry.changes.length} cambio(s) aplicado(s)</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Moderación de reseñas */}
                <div className={cardCls}>
                  <div className="mb-4 flex items-center justify-between">
                    <p className={cardTitleCls} style={{ marginBottom: 0 }}>Moderación de reseñas</p>
                    <div className="flex items-center gap-2">
                      <select
                        value={reviewStatusFilter}
                        onChange={(e) => setReviewStatusFilter(e.target.value as 'ALL' | ClubReviewAdminStatus)}
                        className="h-9 rounded-xl border border-[#dce2ee] bg-white px-3 text-[12px] text-[#1f2638] outline-none focus:border-[#3053e2] transition"
                      >
                        <option value="ALL">Todas</option>
                        <option value="PUBLISHED">Publicadas</option>
                        <option value="HIDDEN">Ocultas</option>
                        <option value="REPORTED">Reportadas</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => { if (club?.slug) void loadClubReviews(club.slug, reviewStatusFilter); }}
                        className="h-9 rounded-xl border border-[#dce2ee] bg-white px-3 text-[12px] text-[#6f7890] hover:bg-[#f4f6fb] transition"
                      >
                        Recargar
                      </button>
                    </div>
                  </div>
                  {loadingClubReviews ? (
                    <p className="text-[12px] text-[#6f7890]">Cargando reseñas...</p>
                  ) : clubReviews.length === 0 ? (
                    <p className="text-[12px] text-[#6f7890]">No hay reseñas para el filtro seleccionado.</p>
                  ) : (
                    <div className="space-y-2 max-h-96 overflow-auto pr-1">
                      {clubReviews.map((review) => (
                        <div key={review.id} className="rounded-xl border border-[#dce2ee] p-3">
                          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div>
                              <p className="text-[13px] font-medium text-[#1f2638]">
                                {review.user?.name || 'Usuario'} · {Number(review.rating).toFixed(1)} / 5
                              </p>
                              <p className="mt-0.5 text-[11px] text-[#6f7890]">
                                Reserva #{review.bookingId} · {new Date(review.createdAt).toLocaleDateString('es-AR')} · <span className="font-medium">{review.status}</span>
                              </p>
                              {review.comment ? (
                                <p className="mt-2 text-[12px] text-[#1f2638] leading-relaxed">{review.comment}</p>
                              ) : (
                                <p className="mt-2 text-[11px] italic text-[#6f7890]">Sin comentario.</p>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2 shrink-0">
                              <button
                                type="button"
                                disabled={reviewStatusUpdatingId === review.id || review.status === 'PUBLISHED'}
                                onClick={() => void handleUpdateReviewStatus(review.id, 'PUBLISHED')}
                                className="h-8 rounded-xl bg-[#3053e2] px-3 text-[11px] font-semibold text-white hover:bg-[#2748cc] transition disabled:opacity-40"
                              >
                                Publicar
                              </button>
                              <button
                                type="button"
                                disabled={reviewStatusUpdatingId === review.id || review.status === 'HIDDEN'}
                                onClick={() => void handleUpdateReviewStatus(review.id, 'HIDDEN')}
                                className="h-8 rounded-xl border border-red-100 bg-red-50 px-3 text-[11px] font-semibold text-red-600 hover:bg-red-100 transition disabled:opacity-40"
                              >
                                Ocultar
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Discount policy drawer (create / edit) ── */}
      <AdminDrawer
        open={discountDrawerOpen}
        onClose={handleCancelEditDiscountPolicy}
        title={discountDrawerMode === 'create' ? 'Nueva política de descuento' : 'Editar política'}
        subtitle={discountDrawerMode === 'edit' ? discountPolicyEditForm.name : undefined}
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleCancelEditDiscountPolicy}
              className="h-10 rounded-xl border border-[#dce2ee] bg-white px-4 text-[13px] font-semibold text-[#6f7890] transition hover:bg-[#f4f6fb]"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => discountDrawerMode === 'create' ? void handleCreateDiscountPolicy() : void handleSaveDiscountPolicy()}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#3053e2] px-5 text-[13px] font-semibold text-white transition hover:bg-[#2748cc]"
            >
              <Check size={14} />
              {discountDrawerMode === 'create' ? 'Crear política' : 'Guardar cambios'}
            </button>
          </div>
        }
      >
        {discountDrawerMode === 'create' ? (
          <AdminDrawerSection title="Datos de la politica">
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Nombre</label>
                <input
                  type="text"
                  value={discountPolicyForm.name}
                  onChange={(e) => setDiscountPolicyForm((prev) => ({ ...prev, name: e.target.value }))}
                  className={inputCls}
                  placeholder="Ej: Amigo 20% turnos"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Alcance</label>
                  <select
                    value={discountPolicyForm.scope}
                    onChange={(e) => setDiscountPolicyForm((prev) => ({ ...prev, scope: e.target.value as DiscountPolicyScope }))}
                    className={inputCls}
                  >
                    <option value="BOOKING">Reserva</option>
                    <option value="PRODUCT">Producto</option>
                    <option value="SERVICE">Servicio</option>
                    <option value="ALL">Todo</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Tipo</label>
                  <select
                    value={discountPolicyForm.amountType}
                    onChange={(e) => setDiscountPolicyForm((prev) => ({ ...prev, amountType: e.target.value as DiscountAmountType }))}
                    className={inputCls}
                  >
                    <option value="PERCENT">Porcentaje</option>
                    <option value="FIXED">Monto fijo</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Valor</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={discountPolicyForm.amountValue}
                    onChange={(e) => setDiscountPolicyForm((prev) => ({ ...prev, amountValue: e.target.value }))}
                    className={inputCls}
                    placeholder={discountPolicyForm.amountType === 'PERCENT' ? '20' : '1000'}
                  />
                </div>
                <div>
                  <label className={labelCls}>Prioridad</label>
                  <input
                    type="number"
                    min={0}
                    value={discountPolicyForm.priority}
                    onChange={(e) => setDiscountPolicyForm((prev) => ({ ...prev, priority: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Modo de aplicación</label>
                <select
                  value={discountPolicyForm.applyMode}
                  onChange={(e) => setDiscountPolicyForm((prev) => ({ ...prev, applyMode: e.target.value as DiscountApplyMode }))}
                  className={inputCls}
                >
                  <option value="INCLUDE_ONLY">Solo incluidos</option>
                  <option value="EXCLUDE_LIST">Excluir lista</option>
                </select>
              </div>
              <label className="flex cursor-pointer items-center gap-2.5">
                <div
                  className={checkboxCls(discountPolicyForm.isStackable)}
                  onClick={() => setDiscountPolicyForm((prev) => ({ ...prev, isStackable: !prev.isStackable }))}
                >
                  {discountPolicyForm.isStackable && <Check size={12} strokeWidth={3} className="text-white" />}
                </div>
                <span className="text-[12px] text-[#1f2638]">Acumulable con otras políticas</span>
              </label>
            </div>
          </AdminDrawerSection>
        ) : (
          <AdminDrawerSection title="Datos de la politica">
            <div className="space-y-4">
            <div>
              <label className={labelCls}>Nombre</label>
              <input
                type="text"
                value={discountPolicyEditForm.name}
                onChange={(e) => setDiscountPolicyEditForm((prev) => ({ ...prev, name: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Alcance</label>
                <select
                  value={discountPolicyEditForm.scope}
                  onChange={(e) => setDiscountPolicyEditForm((prev) => ({ ...prev, scope: e.target.value as DiscountPolicyScope }))}
                  className={inputCls}
                >
                  <option value="BOOKING">Reserva</option>
                  <option value="PRODUCT">Producto</option>
                  <option value="SERVICE">Servicio</option>
                  <option value="ALL">Todo</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Tipo</label>
                <select
                  value={discountPolicyEditForm.amountType}
                  onChange={(e) => setDiscountPolicyEditForm((prev) => ({ ...prev, amountType: e.target.value as DiscountAmountType }))}
                  className={inputCls}
                >
                  <option value="PERCENT">Porcentaje</option>
                  <option value="FIXED">Monto fijo</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Valor</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={discountPolicyEditForm.amountValue}
                  onChange={(e) => setDiscountPolicyEditForm((prev) => ({ ...prev, amountValue: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Prioridad</label>
                <input
                  type="number"
                  min={0}
                  value={discountPolicyEditForm.priority}
                  onChange={(e) => setDiscountPolicyEditForm((prev) => ({ ...prev, priority: e.target.value }))}
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Modo de aplicación</label>
              <select
                value={discountPolicyEditForm.applyMode}
                onChange={(e) => setDiscountPolicyEditForm((prev) => ({ ...prev, applyMode: e.target.value as DiscountApplyMode }))}
                className={inputCls}
              >
                <option value="INCLUDE_ONLY">Solo incluidos</option>
                <option value="EXCLUDE_LIST">Excluir lista</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex cursor-pointer items-center gap-2.5">
                <div
                  className={checkboxCls(discountPolicyEditForm.isStackable)}
                  onClick={() => setDiscountPolicyEditForm((prev) => ({ ...prev, isStackable: !prev.isStackable }))}
                >
                  {discountPolicyEditForm.isStackable && <Check size={12} strokeWidth={3} className="text-white" />}
                </div>
                <span className="text-[12px] text-[#1f2638]">Acumulable con otras políticas</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2.5">
                <div
                  className={checkboxCls(discountPolicyEditForm.isActive)}
                  onClick={() => setDiscountPolicyEditForm((prev) => ({ ...prev, isActive: !prev.isActive }))}
                >
                  {discountPolicyEditForm.isActive && <Check size={12} strokeWidth={3} className="text-white" />}
                </div>
                <span className="text-[12px] text-[#1f2638]">Política activa</span>
              </label>
            </div>
            </div>
          </AdminDrawerSection>
        )}
      </AdminDrawer>

      {/* Exception sidebar */}
      <AdminDrawer
        open={Boolean(exceptionModalActivity)}
        title="Excepciones de agenda"
        subtitle={exceptionModalActivity?.name}
        onClose={closeExceptionModal}
        size="md"
        footer={
          exceptionModalSelectedDate && exceptionModalDraft ? (
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setExceptionModalSelectedDate('');
                  setExceptionModalSelectedId(null);
                }}
                className="h-10 rounded-xl border border-[#dce2ee] bg-white px-4 text-[13px] font-medium text-[#6f7890] transition hover:bg-[#f4f6fb]"
              >
                ← Volver
              </button>
              <div className="flex-1" />
              {canDeleteExceptionModalDraft && (
                <button
                  type="button"
                  onClick={handleDeleteExceptionWithConfirmation}
                  disabled={activityExceptionBusy[exceptionModalActivityId ?? -1]}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#ffd6d6] bg-[#fff5f5] px-4 text-[13px] font-semibold text-[#b42318] transition hover:bg-[#b42318] hover:text-white disabled:opacity-40"
                >
                  <Trash2 size={14} />
                  {exceptionModalSelectedIsPendingDraft ? 'Descartar' : 'Eliminar'}
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSaveExceptionFromModal()}
                disabled={activityExceptionBusy[exceptionModalActivityId ?? -1]}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#3053e2] px-5 text-[13px] font-semibold text-white transition hover:bg-[#2748cc] disabled:opacity-40"
              >
                <Check size={14} />
                Guardar borrador
              </button>
            </div>
          ) : undefined
        }
      >
        {/* ── Vista: Listado de excepciones ── */}
        {!exceptionModalSelectedDate && (
          <div className="space-y-5">
            <AdminDrawerSection title="Nueva excepción">
              <p className="text-[12px] text-[#6f7890]">Seleccioná una fecha para crear o editar una excepción de horario.</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <AdminDateInput
                    value={exceptionModalNewDate}
                    onChange={setExceptionModalNewDate}
                    min={getTodayDateKey()}
                    placeholder="Seleccionar fecha"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCreateExceptionInModal}
                  className="h-10 rounded-xl bg-[#3053e2] px-4 text-[13px] font-semibold text-white transition hover:bg-[#2748cc]"
                >
                  Crear borrador
                </button>
              </div>
            </AdminDrawerSection>

            <AdminDrawerSection title="Excepciones cargadas">
              {exceptionModalLoading ? (
                <div className="flex items-center gap-2 py-4 text-[12px] text-[#6f7890]">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#d9dfeb] border-t-[#3053e2]" />
                  Cargando excepciones...
                </div>
              ) : exceptionModalItems.length === 0 ? (
                <p className="rounded-xl border border-[#dce2ee] bg-[#fbfcff] px-3 py-4 text-center text-[12px] text-[#98a1b3]">
                  No hay excepciones para esta actividad.
                </p>
              ) : (
                <div className="divide-y divide-[#e8edf5] rounded-xl border border-[#dce2ee] bg-[#fbfcff] px-3">
                  {exceptionModalItems.map((item) => {
                    const hasPending = pendingScheduleExceptionMutations.some(
                      (m) => m.activityId === exceptionModalActivityId && m.localDate === item.localDate
                    );
                    return (
                      <button
                        key={`${item.activityTypeId}-${item.localDate}-${item.id}`}
                        type="button"
                        onClick={() => {
                          setExceptionModalSelectedDate(item.localDate);
                          setExceptionModalSelectedId(Number(item.id) > 0 ? Number(item.id) : null);
                        }}
                        className="w-full py-2.5 text-left transition hover:bg-white/70"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[13px] font-semibold text-[#1f2638]">
                            {formatExceptionDate(item.localDate)}
                          </p>
                          {hasPending && (
                            <span className="shrink-0 rounded-full bg-[#fef3c7] px-2 py-0.5 text-[10px] font-semibold text-[#b45309]">
                              Pendiente
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-[#6f7890]">
                          {item.isClosed
                            ? 'Cerrado todo el día'
                            : item.scheduleMode === 'RANGE'
                              ? `Rango ${item.scheduleOpenTime || '--'} - ${item.scheduleCloseTime || '--'}`
                              : `Turnos fijos (${Array.isArray(item.scheduleFixedSlots) ? item.scheduleFixedSlots.length : 0})`}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </AdminDrawerSection>
          </div>
        )}

        {/* ── Vista: Editar excepción ── */}
        {exceptionModalSelectedDate && (
          <>
            {exceptionModalDraft ? (
              <div className="space-y-5">
                {/* Fecha seleccionada */}
                <AdminDrawerSection title="Fecha">
                  <div className="rounded-xl border border-[#dce2ee] bg-[#fbfcff] px-3 py-2.5">
                    <p className="text-[13px] font-semibold text-[#1f2638]">
                      {formatExceptionDate(exceptionModalDraft.localDate)}
                    </p>
                  </div>
                </AdminDrawerSection>

                {/* Cierre total */}
                <AdminDrawerSection title="Disponibilidad">
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-[#dce2ee] bg-white px-3 py-2.5">
                    <div
                      className={checkboxCls(exceptionModalDraft.isClosed)}
                      onClick={() =>
                        setExceptionModalDraft((prev) =>
                          prev ? { ...prev, isClosed: !prev.isClosed } : prev
                        )
                      }
                    >
                      {exceptionModalDraft.isClosed && (
                        <Check size={12} strokeWidth={3} className="text-white" />
                      )}
                    </div>
                    <span className="text-[12px] text-[#1f2638]">
                      Cerrar toda la actividad en esta fecha
                    </span>
                  </label>
                </AdminDrawerSection>

                {/* Config de horario */}
                {!exceptionModalDraft.isClosed && (
                  <AdminDrawerSection
                    title="Horario especial"
                    className="rounded-2xl border border-[#dce2ee] bg-[#f8f9fd] p-4"
                  >
                    <div className="space-y-3">
                      <div>
                        <label className={labelCls}>Modo</label>
                        <select
                          value={exceptionModalDraft.scheduleMode}
                          onChange={(e) =>
                            setExceptionModalDraft((prev) =>
                              prev
                                ? { ...prev, scheduleMode: e.target.value as 'FIXED' | 'RANGE' }
                                : prev
                            )
                          }
                          className={inputCls}
                        >
                          <option value="FIXED">Turnos fijos</option>
                          <option value="RANGE">Rango horario</option>
                        </select>
                      </div>

                      <div>
                        <label className={labelCls}>Duraciones (min)</label>
                        <input
                          type="text"
                          value={exceptionModalDraft.scheduleDurations}
                          onChange={(e) =>
                            setExceptionModalDraft((prev) =>
                              prev ? { ...prev, scheduleDurations: e.target.value } : prev
                            )
                          }
                          className={inputCls}
                          placeholder="60, 90"
                        />
                      </div>

                      {exceptionModalDraft.scheduleMode === 'RANGE' ? (
                        <>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className={labelCls}>Apertura</label>
                              <input
                                type="time"
                                value={exceptionModalDraft.scheduleOpenTime}
                                onChange={(e) =>
                                  setExceptionModalDraft((prev) =>
                                    prev ? { ...prev, scheduleOpenTime: e.target.value } : prev
                                  )
                                }
                                className={inputCls}
                              />
                            </div>
                            <div>
                              <label className={labelCls}>Cierre</label>
                              <input
                                type="time"
                                value={exceptionModalDraft.scheduleCloseTime}
                                onChange={(e) =>
                                  setExceptionModalDraft((prev) =>
                                    prev ? { ...prev, scheduleCloseTime: e.target.value } : prev
                                  )
                                }
                                className={inputCls}
                              />
                            </div>
                            <div>
                              <label className={labelCls}>Intervalo</label>
                              <input
                                type="number"
                                min={1}
                                value={exceptionModalDraft.scheduleIntervalMinutes}
                                onChange={(e) =>
                                  setExceptionModalDraft((prev) =>
                                    prev
                                      ? { ...prev, scheduleIntervalMinutes: e.target.value }
                                      : prev
                                  )
                                }
                                className={inputCls}
                              />
                            </div>
                          </div>
                          <div>
                            <label className={labelCls}>
                              Franjas cortadas (HH:mm-HH:mm, una por línea)
                            </label>
                            <textarea
                              rows={3}
                              value={exceptionModalDraft.scheduleWindows}
                              onChange={(e) =>
                                setExceptionModalDraft((prev) =>
                                  prev ? { ...prev, scheduleWindows: e.target.value } : prev
                                )
                              }
                              className={`${inputCls} h-auto resize-none py-2.5`}
                              placeholder={'08:00-12:00\n16:00-23:00'}
                            />
                          </div>
                        </>
                      ) : (
                        <div>
                          <label className={labelCls}>
                            Turnos fijos (HH:mm-60, uno por línea)
                          </label>
                          <textarea
                            rows={4}
                            value={exceptionModalDraft.scheduleFixedSlots}
                            onChange={(e) =>
                              setExceptionModalDraft((prev) =>
                                prev ? { ...prev, scheduleFixedSlots: e.target.value } : prev
                              )
                            }
                            className={`${inputCls} h-auto resize-none py-2.5`}
                            placeholder={'08:00-60\n09:00-60'}
                          />
                        </div>
                      )}
                    </div>
                  </AdminDrawerSection>
                )}
              </div>
            ) : (
              <div className="py-8 text-center">
                <p className="text-[13px] font-semibold text-[#98a1b3]">Cargando excepción...</p>
              </div>
            )}
          </>
        )}
      </AdminDrawer>

      <AdminAppModal
        show={modalState.show}
        onClose={closeModal}
        onCancel={modalState.onCancel}
        title={modalState.title}
        message={modalState.message}
        cancelText={modalState.cancelText}
        confirmText={modalState.confirmText}
        isWarning={modalState.isWarning}
        onConfirm={modalState.onConfirm}
        closeOnBackdrop={modalState.closeOnBackdrop}
        closeOnEscape={modalState.closeOnEscape}
        holdToConfirm={modalState.holdToConfirm}
        holdDuration={modalState.holdDuration}
      />
    </>
  );
}
