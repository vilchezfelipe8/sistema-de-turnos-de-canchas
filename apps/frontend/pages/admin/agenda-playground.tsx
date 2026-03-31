import Head from 'next/head';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, MoreVertical, Plus, Repeat, Search, User, Users, CreditCard, Settings, X, Receipt, BarChart3, Trophy, MessageSquare, ShoppingBag, FileText, GraduationCap, Lock, Trash2 } from 'lucide-react';
import NotFound from '../../components/NotFound';
import RouteTransitionScreen from '../../components/RouteTransitionScreen';
import { getPendingLogoutRedirect } from '../../services/AuthService';
import { ClubAdminService } from '../../services/ClubAdminService';
import { cancelBooking, createBooking, getAdminSchedule, getBookingFinancialSummary, getBookingQuote, registerBookingPartialPayment } from '../../services/BookingService';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { reportUiError } from '../../utils/uiError';
import { getActiveClubSlug, hasAdminAccess, normalizeSessionUser } from '../../utils/session';

type SportFilter = string;

type Court = {
  id: string;
  name: string;
  sport: string;
  activityTypeId?: number;
  defaultDurationMinutes?: number;
};

type Booking = {
  id: string;
  courtId: string;
  startSlot: number;
  endSlot: number;
  title: string;
  state: 'pending' | 'confirmed' | 'completed' | 'blocked';
  paymentState: 'paid' | 'unpaid';
};

type DraftSelection = {
  courtId: string;
  startSlot: number;
  endSlot: number;
};

type BookingDropPreview = {
  courtId: string;
  startSlot: number;
  endSlot: number;
};

type DraggingBookingMeta = {
  bookingId: string;
  durationSlots: number;
  title: string;
  state: Booking['state'];
  paymentState: Booking['paymentState'];
  courtId: string;
  startSlot: number;
};

type PendingBookingPointer = {
  booking: Booking;
  startX: number;
  startY: number;
};

type EditingBaseline = {
  id: string;
  courtId: string;
  startSlot: number;
  endSlot: number;
  title: string;
};

type Participant = {
  id: string;
  name: string;
  contact: string;
  paid: boolean;
  isOwner: boolean;
  sourceType: 'clubClient' | 'systemUser' | 'guest';
  paymentMethod: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER';
  customPrice: number | null;
};

type ParticipantSuggestion = {
  id: string;
  label: string;
  secondary?: string;
  sourceType: Participant['sourceType'];
  name: string;
  contact?: string;
};

type BookingKind = 'regular' | 'recurring' | 'privateClass' | 'courseClass' | 'block';


const sidebarItems = [
  { label: 'Calendario', icon: CalendarDays, active: true },
  { label: 'Clientes', icon: Users },
  { label: 'Pagos', icon: CreditCard },
  { label: 'Reservas', icon: Receipt },
  { label: 'Partidos', icon: Trophy },
  { label: 'Tienda', icon: ShoppingBag },
  { label: 'Chats', icon: MessageSquare },
  { label: 'Facturación', icon: FileText },
  { label: 'Informes', icon: BarChart3 },
  { label: 'Ajustes', icon: Settings },
];

const rowHeight = 120; // visual height per hour (zoom vertical para diferenciar mejor 15m vs 30m)
const startHour = 8;
const endHour = 23;
const slotMinutes = 15;
const slotsPerHour = 60 / slotMinutes;
const totalSlots = (endHour - startHour) * slotsPerHour;
const slotHeight = rowHeight / slotsPerHour; // selectable 15-min blocks
const gridHeight = totalSlots * slotHeight;


const initialParticipants: Participant[] = [
  { id: 'owner', name: '', contact: '', paid: false, isOwner: true, sourceType: 'guest', paymentMethod: 'CASH', customPrice: null },
];

const BOOKING_PARTICIPANTS_STORAGE_KEY = 'agenda_playground_booking_participants_v1';
const MAX_MANUAL_PARTICIPANT_PRICE = 100000;

const bookingKindOptions: Array<{
  value: BookingKind;
  label: string;
  description: string;
  icon: typeof CalendarDays;
}> = [
  {
    value: 'regular',
    label: 'Reserva normal',
    description: 'Para reservas individuales de un solo día y pista',
    icon: CalendarDays,
  },
  {
    value: 'recurring',
    label: 'Serie recurrente',
    description: 'Para reservas que se repiten con una frecuencia. Reservas en múltiples pistas permitidas.',
    icon: Repeat,
  },
  {
    value: 'privateClass',
    label: 'Clase privada',
    description: 'Para reservas de clases puntuales con un entrenador',
    icon: User,
  },
  {
    value: 'courseClass',
    label: 'Clase de curso',
    description: 'Para crear las clases de un curso',
    icon: GraduationCap,
  },
  {
    value: 'block',
    label: 'Bloqueo',
    description: 'Para bloquear una pista y evitar nuevas reservas en ese rango.',
    icon: Lock,
  },
];

function slotToTime(slot: number) {
  const totalMinutes = startHour * 60 + slot * slotMinutes;
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (totalMinutes % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function timeToSlot(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  const total = hours * 60 + minutes;
  const start = startHour * 60;
  return Math.max(0, Math.min(totalSlots, Math.round((total - start) / slotMinutes)));
}

function toSelectionRange(selection: DraftSelection) {
  return {
    start: Math.min(selection.startSlot, selection.endSlot),
    end: Math.max(selection.startSlot, selection.endSlot) + 1,
  };
}

function bookingColor(state: Booking['state']) {
  if (state === 'completed') return 'bg-[#1d2248] text-[#f7f7fb]';
  if (state === 'confirmed') return 'bg-[#dce7ff] text-[#1d3b8f] border border-[#c7d8ff]';
  if (state === 'blocked') return 'bg-[#ff5d7a] text-white bg-[linear-gradient(135deg,rgba(255,255,255,0.18)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.18)_50%,rgba(255,255,255,0.18)_75%,transparent_75%,transparent)] bg-[length:14px_14px]';
  return 'bg-[#d7f2d7] text-[#123525] border border-[#c3e9c3]';
}

function bookingStatusLabel(state: Booking['state']) {
  if (state === 'completed') return 'COMPLETADA';
  if (state === 'confirmed') return 'CONFIRMADA';
  if (state === 'blocked') return 'BLOQUEADO';
  return 'PENDIENTE';
}

function bookingBadgeColor(state: Booking['state']) {
  if (state === 'completed') return 'bg-[#1d2248] text-white';
  if (state === 'confirmed') return 'bg-[#2d4fc9] text-white';
  if (state === 'blocked') return 'bg-[#9f1635] text-white';
  return 'bg-[#2f6b45] text-white';
}

function bookingPaymentLabel(state: Booking['paymentState']) {
  return state === 'paid' ? 'PAGADA' : 'SIN PAGO';
}

function bookingPaymentBadgeColor(state: Booking['paymentState']) {
  return state === 'paid' ? 'bg-[#166534] text-white' : 'bg-[#6b7280] text-white';
}

function distributePaidByParticipants(
  participants: Participant[],
  paymentMode: 'Único' | 'Dividido',
  totalAmount: number,
  paidAmount: number
) {
  const safeTotal = Number(Math.max(0, totalAmount || 0).toFixed(2));
  let remainingPaid = Number(Math.max(0, paidAmount || 0).toFixed(2));

  if (paymentMode === 'Único') {
    return participants.map((participant) => {
      if (!participant.isOwner) return { ...participant, paid: false };
      const covered = remainingPaid + 0.009 >= safeTotal;
      if (covered) remainingPaid = Number(Math.max(0, remainingPaid - safeTotal).toFixed(2));
      return { ...participant, paid: covered };
    });
  }

  const active = participants.filter((participant) => participant.name.trim().length > 0);
  const target = active.length > 0 ? active : participants.filter((participant) => participant.isOwner);
  const paidTargetIds = new Set<string>();
  const share = target.length > 0 ? Number((safeTotal / target.length).toFixed(2)) : safeTotal;

  for (const participant of target) {
    if (remainingPaid + 0.009 >= share) {
      paidTargetIds.add(participant.id);
      remainingPaid = Number(Math.max(0, remainingPaid - share).toFixed(2));
    }
  }

  return participants.map((participant) => ({ ...participant, paid: paidTargetIds.has(participant.id) }));
}

function blockContentVisibility(height: number) {
  return {
    showDurationOnly: height < 20,
    showBadge: height >= 46,
    showTitle: height >= 22,
    showTimeRange: height >= 30,
  };
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeParticipantText(value: string) {
  return String(value || '').trim().toLowerCase();
}

function participantIdentityTokens(input: Pick<Participant, 'sourceType' | 'name' | 'contact'>) {
  const name = normalizeParticipantText(input.name);
  const contact = normalizeParticipantText(input.contact);
  const email = contact.includes('@') ? contact : '';
  const phone = contact.replace(/\D/g, '');
  const tokens: string[] = [];
  if (email) tokens.push(`${input.sourceType}:email:${email}`);
  if (phone.length >= 6) tokens.push(`${input.sourceType}:phone:${phone}`);
  if (contact) tokens.push(`${input.sourceType}:contact:${contact}`);
  if (name) tokens.push(`${input.sourceType}:name:${name}`);
  return Array.from(new Set(tokens));
}

function buildStartDateTimeFromSlot(baseDate: Date, slot: number) {
  const [hh, mm] = slotToTime(slot).split(':').map(Number);
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    Number.isFinite(hh) ? hh : 0,
    Number.isFinite(mm) ? mm : 0,
    0,
    0
  );
}

function parseScheduleSlotToBooking(slot: any): Booking | null {
  const booking = slot?.booking;
  if (!booking) return null;

  const start = booking?.startDateTime ? new Date(booking.startDateTime) : null;
  if (!start || Number.isNaN(start.getTime())) return null;

  let end: Date | null = booking?.endDateTime ? new Date(booking.endDateTime) : null;
  if (!end || Number.isNaN(end.getTime())) {
    const duration = Number(booking?.durationMinutes || booking?.activity?.defaultDurationMinutes || 60);
    end = new Date(start.getTime() + Math.max(30, duration) * 60000);
  }

  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const baseMinutes = startHour * 60;
  const startSlotRaw = Math.floor((startMinutes - baseMinutes) / slotMinutes);
  const endSlotRaw = Math.ceil((endMinutes - baseMinutes) / slotMinutes);
  const startSlot = Math.max(0, Math.min(totalSlots - 1, startSlotRaw));
  const endSlot = Math.max(startSlot + 1, Math.min(totalSlots, endSlotRaw));

  const status = String(booking?.status || '').toUpperCase();
  const state: Booking['state'] =
    status === 'CANCELLED'
      ? 'blocked'
      : status === 'COMPLETED'
        ? 'completed'
        : status === 'CONFIRMED'
          ? 'confirmed'
          : 'pending';

  const paidAmount = Number(
    booking?.confirmationContext?.paidAmount ??
      booking?.paidAmount ??
      booking?.financialSummary?.paid ??
      0
  );
  const bookingPrice = Number(booking?.price ?? 0);
  const paymentState: Booking['paymentState'] =
    bookingPrice <= 0 || paidAmount + 0.009 >= bookingPrice ? 'paid' : 'unpaid';

  return {
    id: String(booking?.id || slot?.id || `${slot?.courtId}-${slot?.slotTime || start.toISOString()}`),
    courtId: String(slot?.courtId || booking?.courtId || booking?.court?.id || ''),
    startSlot,
    endSlot,
    title: String(booking?.client?.name || booking?.clientName || booking?.activity?.name || 'Reserva'),
    state,
    paymentState,
  };
}

function loadStoredParticipantsByBooking(): Record<string, Participant[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(BOOKING_PARTICIPANTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveStoredParticipantsByBooking(map: Record<string, Participant[]>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(BOOKING_PARTICIPANTS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // noop
  }
}

function roundMoney(value: number) {
  return Number((Math.max(0, value) || 0).toFixed(2));
}

function clampParticipantPrice(value: number) {
  if (!Number.isFinite(value)) return 0;
  return roundMoney(Math.min(Math.max(0, value), MAX_MANUAL_PARTICIPANT_PRICE));
}

function hashText(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function resolvePlaygroundClientPhone(owner?: Participant | null) {
  const fromContact = String(owner?.contact || '').replace(/\D/g, '');
  if (fromContact.length >= 8) {
    return fromContact.startsWith('54') ? `+${fromContact}` : `+54${fromContact}`;
  }

  const seed = String(owner?.name || 'cliente').trim().toLowerCase();
  const suffix = String((hashText(seed) % 90_000_000) + 10_000_000);
  return `+54911${suffix}`;
}

function normalizeText(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function inferCourtSport(courtLike: any): string {
  const candidates = [
    courtLike?.sport,
    courtLike?.surface,
    courtLike?.surfaceType,
    courtLike?.activityType?.name,
    courtLike?.activity?.name,
    courtLike?.name,
  ]
    .map(normalizeText)
    .filter((value) => value.length > 0);

  const full = candidates.join(' ');

  if (full.includes('tenis') || full.includes('tennis')) return 'Tenis';
  if (full.includes('pickle')) return 'Pickleball';
  if (full.includes('squash')) return 'Squash';
  if (full.includes('voley') || full.includes('beach volley') || full.includes('volley playa')) return 'Voley playa';
  if (full.includes('futbol') || full.includes('futbol 5')) return 'Fútbol';
  if (full.includes('padel') || full.includes('paddle')) return 'Pádel';

  return String(courtLike?.activityType?.name || courtLike?.sport || courtLike?.surface || 'Pádel');
}

export default function AdminAgendaPlaygroundPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });

  const [sportFilter, setSportFilter] = useState<SportFilter>('Todos');
  const [searchTerm, setSearchTerm] = useState('');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [courtsData, setCourtsData] = useState<Court[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  const [dragSelection, setDragSelection] = useState<DraftSelection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingBookingId, setDraggingBookingId] = useState<string | null>(null);
  const [draggingBookingMeta, setDraggingBookingMeta] = useState<DraggingBookingMeta | null>(null);
  const [bookingDropPreview, setBookingDropPreview] = useState<BookingDropPreview | null>(null);
  const draggingBookingMetaRef = useRef<DraggingBookingMeta | null>(null);
  const pendingBookingPointerRef = useRef<PendingBookingPointer | null>(null);
  const lastValidDropPreviewRef = useRef<BookingDropPreview | null>(null);
  const dragGrabOffsetSlotsRef = useRef<number>(0);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedCourtId, setSelectedCourtId] = useState<string>('');
  const [selectedStartSlot, setSelectedStartSlot] = useState(2);
  const [selectedEndSlot, setSelectedEndSlot] = useState(4);
  const [paymentMode, setPaymentMode] = useState<'Único' | 'Dividido'>('Único');
  const [defaultPricePerParticipant, setDefaultPricePerParticipant] = useState(0);
  const [participants, setParticipants] = useState<Participant[]>(initialParticipants);
  const [notes, setNotes] = useState('');
  const [blockingTitle, setBlockingTitle] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmittingBooking, setIsSubmittingBooking] = useState(false);
  const [isDeletingBooking, setIsDeletingBooking] = useState(false);
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null);
  const [editingBaseline, setEditingBaseline] = useState<EditingBaseline | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [quotedListPrice, setQuotedListPrice] = useState<number | null>(null);
  const [quotedFinalPrice, setQuotedFinalPrice] = useState<number | null>(null);
  const [quotedDiscountAmount, setQuotedDiscountAmount] = useState<number>(0);
  const [bookingFinancial, setBookingFinancial] = useState<{ total: number; paid: number; remaining: number } | null>(null);
  const [bookingKind, setBookingKind] = useState<BookingKind>('regular');
  const [bookingKindMenuOpen, setBookingKindMenuOpen] = useState(false);
  const [paymentInFlightId, setPaymentInFlightId] = useState<string | null>(null);
  const [markingAllPaid, setMarkingAllPaid] = useState(false);
  const [participantMenuId, setParticipantMenuId] = useState<string | null>(null);
  const [expandedParticipantId, setExpandedParticipantId] = useState<string | null>(null);
  const [participantSearchOpenId, setParticipantSearchOpenId] = useState<string | null>(null);
  const [participantSearchLoadingId, setParticipantSearchLoadingId] = useState<string | null>(null);
  const [participantSuggestionsById, setParticipantSuggestionsById] = useState<Record<string, ParticipantSuggestion[]>>({});
  const participantSearchSeqRef = useRef(0);
  const persistedEditingBookingId = useMemo(() => {
    const numeric = Number(editingBookingId);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return numeric;
  }, [editingBookingId]);
  const resolveParticipantsForBooking = useCallback((booking: Booking): Participant[] => {
    const storedByBooking = loadStoredParticipantsByBooking();
    const stored = storedByBooking[String(booking.id)];
    if (Array.isArray(stored) && stored.length > 0) {
      return stored.map((participant) => ({
        id: String(participant?.id || `player-${Date.now()}`),
        name: String(participant?.name || ''),
        contact: String(participant?.contact || ''),
        paid: Boolean(participant?.paid),
        isOwner: Boolean(participant?.isOwner),
        sourceType:
          participant?.sourceType === 'clubClient' ||
          participant?.sourceType === 'systemUser'
            ? participant.sourceType
            : 'guest',
        customPrice:
          participant?.customPrice == null || Number.isNaN(Number(participant?.customPrice))
            ? null
            : Number(participant.customPrice),
        paymentMethod:
          participant?.paymentMethod === 'TRANSFER' ||
          participant?.paymentMethod === 'CARD' ||
          participant?.paymentMethod === 'OTHER'
            ? participant.paymentMethod
            : 'CASH',
      }));
    }
    return initialParticipants.map((participant) =>
      participant.isOwner
        ? { ...participant, name: booking.title, paid: false }
        : { ...participant, paid: false }
    );
  }, []);

  const effectiveCourts = courtsData;
  const availableSports = useMemo(() => {
    const uniques = Array.from(
      new Set(
        effectiveCourts
          .map((court) => String(court.sport || '').trim())
          .filter((sport) => sport.length > 0)
      )
    );
    return ['Todos', ...uniques] as SportFilter[];
  }, [effectiveCourts]);

  const reloadSchedule = useCallback(async () => {
    try {
      const raw = await getAdminSchedule(formatLocalDate(selectedDate));
      const mapped = (Array.isArray(raw) ? raw : [])
        .map(parseScheduleSlotToBooking)
        .filter((booking): booking is Booking => Boolean(booking));
      setBookings(mapped);
    } catch (error) {
      reportUiError({ area: 'AgendaPlayground', action: 'loadSchedule' }, error);
    }
  }, [selectedDate]);

  const getClubSlug = useCallback(() => {
    try {
      const raw = localStorage.getItem('user');
      if (!raw) return '';
      const normalized = normalizeSessionUser(JSON.parse(raw));
      return getActiveClubSlug(normalized) || '';
    } catch {
      return '';
    }
  }, []);

  const persistBookingMove = useCallback(
    async (bookingId: string, courtId: string, startSlot: number, endSlot: number) => {
      const numericBookingId = Number(bookingId);
      const numericCourtId = Number(courtId);
      if (!Number.isFinite(numericBookingId) || numericBookingId <= 0) return;
      if (!Number.isFinite(numericCourtId) || numericCourtId <= 0) return;
      const slug = getClubSlug();
      if (!slug) return;

      const durationMinutes = Math.max(15, (endSlot - startSlot) * slotMinutes);
      const startDateTime = buildStartDateTimeFromSlot(selectedDate, startSlot);
      await ClubAdminService.rescheduleBooking(slug, numericBookingId, {
        courtId: numericCourtId,
        startDateTime: startDateTime.toISOString(),
        durationMinutes,
      });
    },
    [getClubSlug, selectedDate]
  );

  const refreshBookingFinancial = useCallback(async (bookingId: number) => {
    const summary = await getBookingFinancialSummary(bookingId);
    setBookingFinancial({
      total: Number(summary?.total || 0),
      paid: Number(summary?.paid || 0),
      remaining: Number(summary?.remaining || 0),
    });
    return summary;
  }, []);

  useEffect(() => {
    if (!authChecked || user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/admin/agenda-playground')}`);
  }, [authChecked, user, router]);

  useEffect(() => {
    if (!authChecked || !user) return;
    const loadCourts = async () => {
      try {
        const userStored = localStorage.getItem('user');
        if (!userStored) return;
        const normalized = normalizeSessionUser(JSON.parse(userStored));
        const slug = getActiveClubSlug(normalized);
        if (!slug) return;
        const data = await ClubAdminService.getCourts(slug);
        const mapped = (Array.isArray(data) ? data : []).map((court: any) => {
          return {
            id: String(court.id),
            name: String(court.name || `Cancha ${court.id}`),
            sport: inferCourtSport(court),
            activityTypeId: Number(court?.activityTypeId || court?.activityType?.id || 0) || undefined,
            defaultDurationMinutes:
              Number(court?.activityType?.defaultDurationMinutes || 0) || undefined,
          } as Court;
        });
        if (mapped.length > 0) {
          setCourtsData(mapped);
          setSelectedCourtId((previous) =>
            mapped.some((court) => court.id === previous) ? previous : mapped[0].id
          );
        }
      } catch (error) {
        reportUiError({ area: 'AgendaPlayground', action: 'loadCourts' }, error);
      }
    };

    void loadCourts();
  }, [authChecked, user]);

  useEffect(() => {
    if (!authChecked || !user) return;
    void reloadSchedule();
  }, [authChecked, user, reloadSchedule]);

  useEffect(() => {
    if (drawerOpen) return;
    setParticipantMenuId(null);
    setExpandedParticipantId(null);
    setParticipantSearchOpenId(null);
    setParticipantSearchLoadingId(null);
    setParticipantSuggestionsById({});
    setBookingFinancial(null);
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    if (!persistedEditingBookingId) return;
    const map = loadStoredParticipantsByBooking();
    map[String(persistedEditingBookingId)] = participants.map((participant) => ({ ...participant }));
    saveStoredParticipantsByBooking(map);
  }, [drawerOpen, participants, persistedEditingBookingId]);

  useEffect(() => {
    if (!drawerOpen || bookingKind === 'block') return;
    if (!persistedEditingBookingId) return;

    let cancelled = false;
    const run = async () => {
      try {
        const summary = await refreshBookingFinancial(persistedEditingBookingId);
        if (cancelled) return;
        setParticipants((previous) =>
          distributePaidByParticipants(
            previous,
            paymentMode,
            Number(summary?.total || 0),
            Number(summary?.paid || 0)
          )
        );
      } catch {
        // Si falla la lectura financiera, mantenemos el estado actual local.
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [bookingKind, drawerOpen, paymentMode, persistedEditingBookingId, refreshBookingFinancial]);

  const beginBookingDrag = useCallback((booking: Booking) => {
    const durationSlots = booking.endSlot - booking.startSlot;
    const meta = {
      bookingId: booking.id,
      durationSlots,
      title: booking.title,
      state: booking.state,
      paymentState: booking.paymentState,
      courtId: booking.courtId,
      startSlot: booking.startSlot,
    };
    setDraggingBookingId(booking.id);
    draggingBookingMetaRef.current = meta;
    setDraggingBookingMeta(meta);
    const initialPreview = {
      courtId: booking.courtId,
      startSlot: booking.startSlot,
      endSlot: booking.endSlot,
    };
    setBookingDropPreview(initialPreview);
    lastValidDropPreviewRef.current = initialPreview;
  }, []);

  useEffect(() => {
    const onWindowMouseMove = (event: MouseEvent) => {
      const pending = pendingBookingPointerRef.current;
      if (!pending) return;
      if (draggingBookingMetaRef.current) return;

      const dx = Math.abs(event.clientX - pending.startX);
      const dy = Math.abs(event.clientY - pending.startY);
      if (dx + dy < 4) return;

      beginBookingDrag(pending.booking);
    };

    const onWindowMouseUp = () => {
      if (draggingBookingMetaRef.current && bookingDropPreview) {
        const meta = draggingBookingMetaRef.current;
        const safeStart = bookingDropPreview.startSlot;
        const safeEnd = bookingDropPreview.endSlot;
        const targetCourtId = bookingDropPreview.courtId;
        const dropHasConflict = bookings.some((booking) => {
          if (String(booking.id) === String(meta.bookingId)) return false;
          if (booking.courtId !== targetCourtId) return false;
          return safeStart < booking.endSlot && safeEnd > booking.startSlot;
        });
        if (dropHasConflict) {
          setFormError('Ya existe una reserva en ese rango horario para la cancha seleccionada.');
          setDraggingBookingId(null);
          setDraggingBookingMeta(null);
          draggingBookingMetaRef.current = null;
          dragGrabOffsetSlotsRef.current = 0;
          lastValidDropPreviewRef.current = null;
          setBookingDropPreview(null);
          pendingBookingPointerRef.current = null;
          return;
        }
        setBookings((previous) =>
          previous.map((booking) =>
            booking.id === meta.bookingId
              ? { ...booking, courtId: targetCourtId, startSlot: safeStart, endSlot: safeEnd }
              : booking
          )
        );
        void persistBookingMove(meta.bookingId, targetCourtId, safeStart, safeEnd)
          .then(() => reloadSchedule())
          .catch(async (error) => {
            reportUiError({ area: 'AgendaPlayground', action: 'persistBookingMove' }, error);
            setFormError(String((error as any)?.message || 'No se pudo guardar el movimiento del turno.'));
            await reloadSchedule();
          });
        setDraggingBookingId(null);
        setDraggingBookingMeta(null);
        draggingBookingMetaRef.current = null;
        dragGrabOffsetSlotsRef.current = 0;
        lastValidDropPreviewRef.current = null;
        setBookingDropPreview(null);
        pendingBookingPointerRef.current = null;
        return;
      }

      if (pendingBookingPointerRef.current && !draggingBookingMetaRef.current) {
        const clickedBooking = pendingBookingPointerRef.current.booking;
        setEditingBookingId(clickedBooking.id);
        setEditingBaseline({
          id: String(clickedBooking.id),
          courtId: clickedBooking.courtId,
          startSlot: clickedBooking.startSlot,
          endSlot: clickedBooking.endSlot,
          title: clickedBooking.title,
        });
        setSelectedCourtId(clickedBooking.courtId);
        setSelectedStartSlot(clickedBooking.startSlot);
        setSelectedEndSlot(clickedBooking.endSlot);
        const resolvedParticipants = resolveParticipantsForBooking(clickedBooking);
        setParticipants(resolvedParticipants);
        const activeParticipants = resolvedParticipants.filter((participant) => participant.name.trim().length > 0);
        setPaymentMode(activeParticipants.length > 1 ? 'Dividido' : 'Único');
        if (clickedBooking.state === 'blocked') {
          setBookingKind('block');
          setBlockingTitle(clickedBooking.title === 'Bloqueado' ? '' : clickedBooking.title);
        } else {
          setBookingKind('regular');
        }
        setDrawerOpen(true);
        setFormError('');
        pendingBookingPointerRef.current = null;
        return;
      }

      if (!isDragging || !dragSelection) return;
      const range = toSelectionRange(dragSelection);
      setEditingBookingId(null);
      setEditingBaseline(null);
      setSelectedCourtId(dragSelection.courtId);
      setSelectedStartSlot(range.start);
      setSelectedEndSlot(range.end);
      setParticipants(initialParticipants.map((participant) => ({ ...participant })));
      setPaymentMode('Único');
      setBookingFinancial(null);
      setDrawerOpen(true);
      setIsDragging(false);
      setDragSelection(null);
      setFormError('');
    };

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [beginBookingDrag, bookingDropPreview, bookings, dragSelection, isDragging, persistBookingMove, reloadSchedule, resolveParticipantsForBooking]);

  const visibleCourts = useMemo(() => {
    return effectiveCourts.filter((court) => {
      const bySport = sportFilter === 'Todos' || court.sport === sportFilter;
      const bySearch = searchTerm.trim().length === 0 || court.name.toLowerCase().includes(searchTerm.toLowerCase());
      return bySport && bySearch;
    });
  }, [effectiveCourts, sportFilter, searchTerm]);

  const visibleCourtIds = useMemo(() => new Set(visibleCourts.map((court) => court.id)), [visibleCourts]);

  const visibleBookings = useMemo(() => bookings.filter((booking) => visibleCourtIds.has(booking.courtId)), [bookings, visibleCourtIds]);

  const selectedCourt = effectiveCourts.find((court) => court.id === selectedCourtId) ?? null;
  const selectedBookingKind = bookingKindOptions.find((option) => option.value === bookingKind) ?? bookingKindOptions[0];

  const selectionMinutes = Math.max((selectedEndSlot - selectedStartSlot) * slotMinutes, slotMinutes);
  const chargedParticipantsCount = paymentMode === 'Único' ? 1 : Math.max(participants.length, 1);
  const fallbackTotalPrice = defaultPricePerParticipant * chargedParticipantsCount;
  const quotedBaseTotalPrice = quotedFinalPrice ?? quotedListPrice ?? fallbackTotalPrice;
  const autoParticipantPrice = Number((quotedBaseTotalPrice / chargedParticipantsCount).toFixed(2));
  const resolveParticipantPrice = useCallback((participant: Participant) => {
    if (paymentMode === 'Único') {
      if (!participant.isOwner) return 0;
      if (participant.customPrice != null) return Number(Math.max(0, participant.customPrice).toFixed(2));
      return Number(quotedBaseTotalPrice.toFixed(2));
    }
    if (participant.customPrice != null) return Number(Math.max(0, participant.customPrice).toFixed(2));
    if (defaultPricePerParticipant > 0) return Number(defaultPricePerParticipant.toFixed(2));
    return autoParticipantPrice;
  }, [autoParticipantPrice, defaultPricePerParticipant, paymentMode, quotedBaseTotalPrice]);
  const totalPrice = Number(
    (
      paymentMode === 'Único'
        ? resolveParticipantPrice(participants.find((participant) => participant.isOwner) || initialParticipants[0])
        : participants.reduce((sum, participant) => sum + resolveParticipantPrice(participant), 0)
    ).toFixed(2)
  );
  const participantPrice = paymentMode === 'Único'
    ? totalPrice
    : Number((totalPrice / Math.max(participants.length, 1)).toFixed(2));
  const pricePerParticipantDisplay = participantPrice;
  const isClassBooking = bookingKind === 'privateClass' || bookingKind === 'courseClass';
  const priceFieldLabel = isClassBooking
    ? 'Precio por participante'
    : paymentMode === 'Único'
      ? 'Precio total'
      : 'Precio por participante (reparto)';
  const priceFieldHint = isClassBooking
    ? 'En clases, este valor representa el cobro por alumno.'
    : paymentMode === 'Único'
      ? 'En reserva normal, paga una sola persona.'
      : 'En reserva normal, se reparte automáticamente entre participantes.';
  const exceedsRemainingWarning = useMemo(() => {
    if (!bookingFinancial || bookingFinancial.remaining <= 0.009) return false;
    return participants.some((participant) => {
      if (paymentMode === 'Único' && !participant.isOwner) return false;
      return resolveParticipantPrice(participant) > bookingFinancial.remaining + 0.009;
    });
  }, [bookingFinancial, participants, paymentMode, resolveParticipantPrice]);

  const duplicateParticipantIds = useMemo(() => {
    const firstByToken = new Map<string, string>();
    const duplicates = new Set<string>();

    for (const participant of participants) {
      if (!participant.name.trim()) continue;
      const tokens = participantIdentityTokens(participant);
      if (tokens.length === 0) continue;

      for (const token of tokens) {
        const firstId = firstByToken.get(token);
        if (!firstId) {
          firstByToken.set(token, participant.id);
          continue;
        }
        if (firstId !== participant.id) {
          duplicates.add(firstId);
          duplicates.add(participant.id);
        }
      }
    }

    return duplicates;
  }, [participants]);

  const hasDuplicateParticipants = duplicateParticipantIds.size > 0;

  useEffect(() => {
    if (hasDuplicateParticipants) return;
    if (
      formError === 'No podés guardar con participantes duplicados.' ||
      formError === 'Ese participante ya está agregado en esta reserva.'
    ) {
      setFormError('');
    }
  }, [formError, hasDuplicateParticipants]);

  const rebalanceSplitPrices = useCallback(
    (previous: Participant[], editedId: string, editedPrice: number) => {
      const targetTotal = roundMoney(quotedBaseTotalPrice || totalPrice);
      const nextEdited = roundMoney(editedPrice);
      const others = previous.filter((participant) => participant.id !== editedId);
      if (others.length === 0) {
        return previous.map((participant) =>
          participant.id === editedId ? { ...participant, customPrice: nextEdited } : participant
        );
      }

      const remaining = roundMoney(targetTotal - nextEdited);
      const baseShare = roundMoney(remaining / others.length);
      let remainder = roundMoney(remaining - baseShare * others.length);

      return previous.map((participant) => {
        if (participant.id === editedId) {
          return { ...participant, customPrice: nextEdited };
        }
        let allocated = baseShare;
        if (remainder > 0.009) {
          const increment = Math.min(0.01, remainder);
          allocated = roundMoney(baseShare + increment);
          remainder = roundMoney(remainder - increment);
        }
        return { ...participant, customPrice: allocated };
      });
    },
    [quotedBaseTotalPrice, totalPrice]
  );

  const handleSlotMouseDown = (courtId: string, slot: number) => {
    if (draggingBookingMetaRef.current) return;
    setIsDragging(true);
    setDragSelection({ courtId, startSlot: slot, endSlot: slot });
  };

  const handleSlotMouseEnter = (courtId: string, slot: number) => {
    if (draggingBookingMetaRef.current) {
      const durationSlots = Math.max(1, Number(draggingBookingMetaRef.current.durationSlots || 1));
      const offsetSlots = Math.max(0, Math.min(durationSlots - 1, Number(dragGrabOffsetSlotsRef.current || 0)));
      const desiredStart = slot - offsetSlots;
      const safeStart = Math.max(0, Math.min(totalSlots - durationSlots, desiredStart));
      const candidate = {
        courtId,
        startSlot: safeStart,
        endSlot: safeStart + durationSlots,
      };
      const isConflicted = hasOverlapForRange({
        courtId: candidate.courtId,
        startSlot: candidate.startSlot,
        endSlot: candidate.endSlot,
        ignoreBookingId: draggingBookingMetaRef.current.bookingId,
      });
      if (isConflicted) {
        if (lastValidDropPreviewRef.current) {
          setBookingDropPreview(lastValidDropPreviewRef.current);
        }
        return;
      }
      lastValidDropPreviewRef.current = candidate;
      setBookingDropPreview(candidate);
      return;
    }
    if (!isDragging) return;
    setDragSelection((previous) => {
      if (!previous || previous.courtId !== courtId) return previous;
      return { ...previous, endSlot: slot };
    });
  };

  const handleBookingMouseDown = (event: React.MouseEvent<HTMLDivElement>, booking: Booking) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const localY = Math.max(0, event.clientY - rect.top);
    const offsetSlots = Math.floor(localY / slotHeight);
    const durationSlots = Math.max(1, booking.endSlot - booking.startSlot);
    dragGrabOffsetSlotsRef.current = Math.max(0, Math.min(durationSlots - 1, offsetSlots));
    pendingBookingPointerRef.current = {
      booking,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const timeOptions = useMemo(
    () =>
      Array.from({ length: totalSlots + 1 }).map((_, slot) => ({
        value: slotToTime(slot),
        slot,
      })),
    []
  );

  const updateParticipant = useCallback((
    id: string,
    patch: Partial<Pick<Participant, 'name' | 'contact' | 'sourceType' | 'paymentMethod' | 'customPrice'>>
  ) => {
    setParticipants((previous) =>
      previous.map((participant) =>
        participant.id === id ? { ...participant, ...patch } : participant
      )
    );
  }, []);

  const runParticipantSearch = useCallback(async (participantId: string, rawValue: string) => {
    updateParticipant(participantId, { name: rawValue, sourceType: 'guest' });
    const query = String(rawValue || '').trim();
    if (!query) {
      setParticipantSearchOpenId(null);
      setParticipantSuggestionsById((previous) => ({ ...previous, [participantId]: [] }));
      return;
    }

    setParticipantSearchOpenId(participantId);
    const seq = ++participantSearchSeqRef.current;
    setParticipantSearchLoadingId(participantId);
    const guestSuggestion: ParticipantSuggestion = {
      id: `guest-${participantId}-${query}`,
      label: query,
      secondary: 'Invitado',
      sourceType: 'guest',
      name: query,
    };

    try {
      const slug = getClubSlug();
      if (!slug || query.length < 2) {
        if (seq !== participantSearchSeqRef.current) return;
        setParticipantSuggestionsById((previous) => ({ ...previous, [participantId]: [guestSuggestion] }));
        return;
      }

      const clients = await ClubAdminService.getClients(slug, query);
      if (seq !== participantSearchSeqRef.current) return;

      const clientSuggestions: ParticipantSuggestion[] = (Array.isArray(clients) ? clients : [])
        .slice(0, 6)
        .map((client: any, index: number) => {
          const phone = String(client?.phone || '').trim();
          const email = String(client?.email || '').trim();
          const sourceType: Participant['sourceType'] =
            client?.sourceType === 'systemUser' ? 'systemUser' : 'clubClient';
          return {
            id: `club-${participantId}-${client?.id || index}`,
            label: String(client?.name || query),
            secondary:
              phone ||
              email ||
              (sourceType === 'systemUser' ? 'Usuario del sistema' : 'Cliente del club'),
            sourceType,
            name: String(client?.name || query),
            contact: phone || email || '',
          } satisfies ParticipantSuggestion;
        });

      setParticipantSuggestionsById((previous) => ({
        ...previous,
        [participantId]: [...clientSuggestions, guestSuggestion],
      }));
    } catch {
      if (seq !== participantSearchSeqRef.current) return;
      setParticipantSuggestionsById((previous) => ({ ...previous, [participantId]: [guestSuggestion] }));
    } finally {
      if (seq === participantSearchSeqRef.current) {
        setParticipantSearchLoadingId((previous) => (previous === participantId ? null : previous));
      }
    }
  }, [getClubSlug, updateParticipant]);

  const applyParticipantSuggestion = useCallback((participantId: string, suggestion: ParticipantSuggestion) => {
    const incomingTokens = participantIdentityTokens({
      sourceType: suggestion.sourceType,
      name: suggestion.name,
      contact: suggestion.contact || '',
    });
    const duplicateExists = participants.some((participant) => {
      if (participant.id === participantId) return false;
      if (!participant.name.trim()) return false;
      const currentTokens = participantIdentityTokens(participant);
      return incomingTokens.some((token) => currentTokens.includes(token));
    });
    if (duplicateExists) {
      setFormError('Ese participante ya está agregado en esta reserva.');
      setParticipantSearchOpenId(null);
      return;
    }

    updateParticipant(participantId, {
      name: suggestion.name,
      contact: suggestion.contact || '',
      sourceType: suggestion.sourceType,
    });
    setFormError('');
    setParticipantSearchOpenId(null);
    setParticipantSuggestionsById((previous) => ({ ...previous, [participantId]: [] }));
  }, [participants, updateParticipant]);

  const resolveParticipantCharge = useCallback((participant: Participant) => {
    return resolveParticipantPrice(participant);
  }, [resolveParticipantPrice]);

  const toggleParticipantPaid = useCallback(async (id: string) => {
    const participant = participants.find((entry) => entry.id === id);
    if (!participant) return;

    if (!persistedEditingBookingId || bookingKind === 'block') {
      setParticipants((previous) =>
        previous.map((entry) =>
          entry.id === id ? { ...entry, paid: !entry.paid } : entry
        )
      );
      return;
    }

    if (participant.paid) return;

    const charge = Number(resolveParticipantCharge(participant) || 0);
    try {
      setPaymentInFlightId(id);
      setFormError('');
      const summary = await refreshBookingFinancial(persistedEditingBookingId);
      const remaining = Number(summary?.remaining || 0);
      if (remaining <= 0.009 || charge <= 0.009) {
        setParticipants((previous) =>
          previous.map((entry) =>
            entry.id === id ? { ...entry, paid: true } : entry
          )
        );
        return;
      }

      const amountToPay = Number(Math.min(remaining, charge).toFixed(2));
      if (amountToPay <= 0) return;

      const paymentChannel = participant.paymentMethod === 'TRANSFER' ? 'BANK_ACCOUNT' : undefined;
      await registerBookingPartialPayment(persistedEditingBookingId, amountToPay, participant.paymentMethod, paymentChannel);
      await refreshBookingFinancial(persistedEditingBookingId);
      setParticipants((previous) =>
        previous.map((entry) =>
          entry.id === id ? { ...entry, paid: true } : entry
        )
      );
    } catch (error: any) {
      setFormError(String(error?.message || 'No se pudo registrar el pago.'));
    } finally {
      setPaymentInFlightId(null);
    }
  }, [bookingKind, participants, persistedEditingBookingId, refreshBookingFinancial, resolveParticipantCharge]);

  const addParticipantRow = () => {
    setParticipants((previous) => [
      ...previous,
      {
        id: `player-${Date.now()}`,
        name: '',
        contact: '',
        paid: false,
        isOwner: false,
        sourceType: 'guest',
        paymentMethod: 'CASH',
        customPrice: null,
      },
    ]);
  };

  const removeParticipant = (id: string) => {
    setParticipants((previous) => previous.filter((participant) => participant.id !== id));
  };

  const markParticipantAsPending = useCallback((id: string) => {
    if (persistedEditingBookingId) {
      setFormError('Para volver a pendiente una reserva cobrada hay que gestionar una devolución.');
      return;
    }
    setParticipants((previous) =>
      previous.map((participant) =>
        participant.id === id ? { ...participant, paid: false } : participant
      )
    );
  }, [persistedEditingBookingId]);

  const markAllAsPaid = useCallback(async () => {
    if (!persistedEditingBookingId || bookingKind === 'block') {
      setParticipants((previous) =>
        previous.map((participant) => ({ ...participant, paid: true }))
      );
      return;
    }

    try {
      setMarkingAllPaid(true);
      setFormError('');
      const summary = await refreshBookingFinancial(persistedEditingBookingId);
      const remaining = Number(summary?.remaining || 0);
      if (remaining > 0.009) {
        await registerBookingPartialPayment(
          persistedEditingBookingId,
          Number(remaining.toFixed(2)),
          'CASH'
        );
        await refreshBookingFinancial(persistedEditingBookingId);
      }
      setParticipants((previous) =>
        previous.map((participant) => ({ ...participant, paid: true }))
      );
    } catch (error: any) {
      setFormError(String(error?.message || 'No se pudo registrar el pago total.'));
    } finally {
      setMarkingAllPaid(false);
    }
  }, [bookingKind, persistedEditingBookingId, refreshBookingFinancial]);

  const handleDeleteBooking = useCallback(async () => {
    if (!editingBookingId) return;
    const confirmed = window.confirm('¿Seguro que querés eliminar/cancelar esta reserva?');
    if (!confirmed) return;

    const numericBookingId = Number(editingBookingId);
    if (!Number.isFinite(numericBookingId) || numericBookingId <= 0) {
      setBookings((previous) => previous.filter((booking) => String(booking.id) !== String(editingBookingId)));
      setDrawerOpen(false);
      setEditingBookingId(null);
      setEditingBaseline(null);
      setFormError('');
      return;
    }

    try {
      setIsDeletingBooking(true);
      setFormError('');
      await cancelBooking(numericBookingId);
      await reloadSchedule();
      setDrawerOpen(false);
      setEditingBookingId(null);
      setEditingBaseline(null);
    } catch (error: any) {
      setFormError(String(error?.message || 'No se pudo eliminar/cancelar la reserva.'));
    } finally {
      setIsDeletingBooking(false);
    }
  }, [editingBookingId, reloadSchedule]);

  const hasOverlapForRange = useCallback((params: {
    courtId: string;
    startSlot: number;
    endSlot: number;
    ignoreBookingId?: string | number | null;
  }) => {
    const { courtId, startSlot, endSlot, ignoreBookingId } = params;
    if (endSlot <= startSlot) return false;

    return bookings.some((booking) => {
      if (ignoreBookingId != null && String(booking.id) === String(ignoreBookingId)) return false;
      if (booking.courtId !== courtId) return false;
      return startSlot < booking.endSlot && endSlot > booking.startSlot;
    });
  }, [bookings]);

  const hasConflict = useMemo(() => {
    if (
      editingBaseline &&
      selectedCourtId === editingBaseline.courtId &&
      selectedStartSlot === editingBaseline.startSlot &&
      selectedEndSlot === editingBaseline.endSlot
    ) {
      return false;
    }
    return hasOverlapForRange({
      courtId: selectedCourtId,
      startSlot: selectedStartSlot,
      endSlot: selectedEndSlot,
      ignoreBookingId: editingBookingId,
    });
  }, [editingBaseline, editingBookingId, hasOverlapForRange, selectedCourtId, selectedStartSlot, selectedEndSlot]);

  const bookingDropHasConflict = useMemo(() => {
    if (!bookingDropPreview || !draggingBookingMeta) return false;
    return hasOverlapForRange({
      courtId: bookingDropPreview.courtId,
      startSlot: bookingDropPreview.startSlot,
      endSlot: bookingDropPreview.endSlot,
      ignoreBookingId: draggingBookingMeta.bookingId,
    });
  }, [bookingDropPreview, draggingBookingMeta, hasOverlapForRange]);

  const hasScheduleChanges = useMemo(() => {
    if (!editingBaseline) return true;
    return !(
      selectedCourtId === editingBaseline.courtId &&
      selectedStartSlot === editingBaseline.startSlot &&
      selectedEndSlot === editingBaseline.endSlot
    );
  }, [editingBaseline, selectedCourtId, selectedStartSlot, selectedEndSlot]);

  const shouldShowScheduleConflict = hasConflict && (!editingBookingId || hasScheduleChanges);

  const nowLineTop = useMemo(() => {
    const now = new Date(nowTick);
    const sameDay =
      now.getFullYear() === selectedDate.getFullYear() &&
      now.getMonth() === selectedDate.getMonth() &&
      now.getDate() === selectedDate.getDate();
    if (!sameDay) return null;

    const minutesFromGridStart =
      now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60 - startHour * 60;
    const totalMinutes = (endHour - startHour) * 60;
    if (minutesFromGridStart < 0 || minutesFromGridStart > totalMinutes) return null;

    return Math.max(0, Math.min(gridHeight, (minutesFromGridStart / slotMinutes) * slotHeight));
  }, [nowTick, selectedDate]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNowTick(Date.now());
    }, 30000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (bookingKind === 'block') {
      setQuotedListPrice(null);
      setQuotedFinalPrice(null);
      setQuotedDiscountAmount(0);
      setQuoteError('');
      return;
    }

    const activityId = Number(selectedCourt?.activityTypeId || 0);
    if (!Number.isFinite(activityId) || activityId <= 0) {
      setQuotedListPrice(null);
      setQuotedFinalPrice(null);
      setQuotedDiscountAmount(0);
      setQuoteError('No se pudo resolver la actividad para cotizar.');
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      try {
        setQuoteLoading(true);
        setQuoteError('');
        const bookingDate = new Date(selectedDate);
        const quote = await getBookingQuote({
          courtId: Number(selectedCourtId),
          activityId,
          date: bookingDate,
          slotTime: slotToTime(selectedStartSlot),
          durationMinutes: selectionMinutes,
          clientPhone: resolvePlaygroundClientPhone(null),
        });
        if (cancelled) return;
        setQuotedListPrice(Number(quote?.listPrice || 0));
        setQuotedFinalPrice(Number(quote?.finalPrice || 0));
        setQuotedDiscountAmount(Number(quote?.discountAmount || 0));
      } catch (error: any) {
        if (cancelled) return;
        setQuotedListPrice(null);
        setQuotedFinalPrice(null);
        setQuotedDiscountAmount(0);
        setQuoteError(String(error?.message || 'No se pudo cotizar.'));
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    };

    timeoutId = setTimeout(() => {
      void run();
    }, 250);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [
    bookingKind,
    selectedCourt,
    selectedCourtId,
    selectedDate,
    selectedStartSlot,
    selectionMinutes,
  ]);

  const moveDate = (days: number) => {
    setSelectedDate((previous) => {
      const next = new Date(previous);
      next.setDate(previous.getDate() + days);
      return next;
    });
  };

  const handleCreateBooking = async () => {
    const owner = participants.find((participant) => participant.isOwner);

    if (!owner || owner.name.trim().length === 0) {
      setFormError('El propietario es obligatorio para crear la reserva.');
      return;
    }

    if (hasDuplicateParticipants) {
      setFormError('No podés guardar con participantes duplicados.');
      return;
    }

    if (selectedEndSlot <= selectedStartSlot) {
      setFormError('La hora de fin debe ser mayor a la de inicio.');
      return;
    }

    if (hasConflict && (!editingBookingId || hasScheduleChanges)) {
      setFormError('Ya existe una reserva en ese rango horario para la cancha seleccionada.');
      return;
    }

    if (bookingKind === 'block') {
      if (editingBookingId) {
        if (!hasScheduleChanges) {
          setDrawerOpen(false);
          setFormError('');
          setEditingBookingId(null);
          setEditingBaseline(null);
          return;
        }
        try {
          setIsSubmittingBooking(true);
          await persistBookingMove(editingBookingId, selectedCourtId, selectedStartSlot, selectedEndSlot);
          await reloadSchedule();
          setDrawerOpen(false);
          setFormError('');
          setEditingBookingId(null);
          setEditingBaseline(null);
          return;
        } catch (error: any) {
          setFormError(String(error?.message || 'No se pudo actualizar el bloqueo.'));
          return;
        } finally {
          setIsSubmittingBooking(false);
        }
      }
      const newBooking: Booking = {
        id: `manual-${Date.now()}`,
        courtId: selectedCourtId,
        startSlot: selectedStartSlot,
        endSlot: selectedEndSlot,
        title: blockingTitle.trim() || 'Bloqueado',
        state: 'blocked',
        paymentState: 'unpaid',
      };
      setBookings((previous) => [...previous, newBooking]);
      setDrawerOpen(false);
      setFormError('');
      setBlockingTitle('');
      return;
    }

    if (editingBookingId) {
      if (!hasScheduleChanges) {
        setDrawerOpen(false);
        setFormError('');
        setEditingBookingId(null);
        setEditingBaseline(null);
        return;
      }
      try {
        setIsSubmittingBooking(true);
        await persistBookingMove(editingBookingId, selectedCourtId, selectedStartSlot, selectedEndSlot);
        await reloadSchedule();
        setDrawerOpen(false);
        setFormError('');
        setEditingBookingId(null);
        setEditingBaseline(null);
        return;
      } catch (error: any) {
        setFormError(String(error?.message || 'No se pudo actualizar la reserva.'));
        return;
      } finally {
        setIsSubmittingBooking(false);
      }
    }

    const selectedActivityId = Number(selectedCourt?.activityTypeId || 0);
    if (!Number.isFinite(selectedActivityId) || selectedActivityId <= 0) {
      setFormError('No se pudo resolver la actividad de la cancha. Revisá la configuración del club.');
      return;
    }

    try {
      setIsSubmittingBooking(true);
      const bookingDate = new Date(selectedDate);
      const slotTime = slotToTime(selectedStartSlot);
      const ownerPhone = resolvePlaygroundClientPhone(owner);
      await createBooking(Number(selectedCourtId), selectedActivityId, bookingDate, slotTime, {
        durationMinutes: selectionMinutes,
        client: {
          name: owner.name.trim(),
          phone: ownerPhone,
        },
      });
      await reloadSchedule();
      setDrawerOpen(false);
      setFormError('');
      setNotes('');
      setParticipants(initialParticipants.map((participant) => ({ ...participant })));
      setEditingBookingId(null);
      setEditingBaseline(null);
    } catch (error: any) {
      setFormError(String(error?.message || 'No se pudo crear la reserva.'));
      reportUiError({ area: 'AgendaPlayground', action: 'createBooking' }, error);
    } finally {
      setIsSubmittingBooking(false);
    }
  };

  if (!authChecked || !user) return <RouteTransitionScreen message={authChecked ? 'Redirigiendo...' : 'Validando acceso...'} />;
  if (!hasAdminAccess(user)) return <NotFound message="No tenés permiso para acceder al panel de administración." />;

  return (
    <>
      <Head>
        <title>Agenda Playground | TuCancha Admin</title>
      </Head>

      <div className="h-screen w-full bg-[#f5f6f8] text-[#1a1a1a] overflow-hidden">
        <div className="h-full w-full flex">
          <aside
            className={`hidden lg:flex h-full w-[110px] border-r border-[#e5e7eb] bg-white flex-col items-center py-6 transition ${
              drawerOpen ? 'opacity-40 pointer-events-none select-none' : 'opacity-100'
            }`}
          >
            <div className="mb-8 text-[11px] font-bold tracking-[0.22em] text-[#2a2f5b]">TUCANCHA</div>
            <nav className="w-full px-2 space-y-1">
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

          <section className="relative flex-1 h-full min-w-0">
            <div className="h-full min-w-0">
              <div className="h-full flex flex-col p-4 lg:p-6 gap-4">
                <div className="rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3 flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {availableSports.map((sport) => (
                      <button
                        key={sport}
                        type="button"
                        onClick={() => setSportFilter(sport)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                          sportFilter === sport
                            ? 'bg-[#1d2248] text-white shadow-sm'
                            : 'bg-[#f5f6f8] text-[#6b7280] hover:bg-[#edf0f4]'
                        }`}
                      >
                        {sport}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-full max-w-[320px]">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#98a1b2]" />
                      <input
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        placeholder="Buscar en calendario"
                        className="h-9 w-full rounded-lg border border-[#e5e7eb] bg-[#fafbfc] pl-9 pr-3 text-sm outline-none focus:border-[#2f4fd8]"
                      />
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveDate(-1)}
                        className="h-9 w-9 rounded-lg border border-[#e5e7eb] grid place-items-center text-[#727b8d] hover:bg-[#f7f8fb]"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <label className="h-9 px-3 rounded-lg border border-[#e5e7eb] text-sm font-medium text-[#232a3a] inline-flex items-center gap-2 bg-white">
                        <span>{selectedDate.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' })}</span>
                        <input
                          type="date"
                          value={formatLocalDate(selectedDate)}
                          onChange={(event) => {
                            const next = new Date(`${event.target.value}T12:00:00`);
                            if (!Number.isNaN(next.getTime())) {
                              setSelectedDate(next);
                              setFormError('');
                            }
                          }}
                          className="h-7 rounded-md border border-[#e5e7eb] px-1 text-xs text-[#4b5563] bg-white"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => moveDate(1)}
                        className="h-9 w-9 rounded-lg border border-[#e5e7eb] grid place-items-center text-[#727b8d] hover:bg-[#f7f8fb]"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex-1 rounded-2xl border border-[#e5e7eb] bg-white overflow-hidden">
                  <div className="h-full overflow-auto">
                    <div className="min-w-max p-4">
                      <div className="flex min-w-full">
                        <div className="w-[78px] shrink-0">
                          <div className="h-10 border-b border-[#eef1f3]" />
                          <div className="relative" style={{ height: gridHeight }}>
                            {Array.from({ length: totalSlots }).map((_, slot) => {
                              const showHourLabel = slot % slotsPerHour === 0;
                              return (
                                <div
                                  key={`time-${slot}`}
                                  className={`absolute left-0 right-0 ${
                                    (slot + 1) % slotsPerHour === 0 ? 'border-b border-[#edf0f2]' : ''
                                  }`}
                                  style={{ top: slot * slotHeight, height: slotHeight }}
                                >
                                  {showHourLabel && (
                                    <span className="absolute top-[4px] left-0 text-[11px] font-medium text-[#8b93a2]">
                                      {slotToTime(slot)}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                            {nowLineTop != null && (
                              <div
                                className="pointer-events-none absolute right-[2px] -translate-y-1/2 h-2.5 w-2.5 rounded-full bg-[#3a66e0] shadow-[0_0_0_2px_#ffffff]"
                                style={{ top: nowLineTop, zIndex: 25 }}
                              />
                            )}
                          </div>
                        </div>

                        <div className="flex min-w-0 flex-1">
                          {visibleCourts.map((court) => {
                            const courtBookings = visibleBookings.filter((booking) => booking.courtId === court.id);
                            return (
                              <div key={court.id} className="min-w-[132px] flex-1 border-l border-[#eef1f3] last:border-r">
                                <div className="h-10 border-b border-[#eef1f3] grid place-items-center text-xs font-semibold text-[#4b5563]">
                                  {court.name}
                                </div>
                                <div className="relative" style={{ height: gridHeight }}>
                                  {Array.from({ length: totalSlots }).map((_, slot) => (
                                    <div
                                      key={`${court.id}-slot-${slot}`}
                                      role="button"
                                      tabIndex={-1}
                                      onMouseDown={() => handleSlotMouseDown(court.id, slot)}
                                      onMouseEnter={() => handleSlotMouseEnter(court.id, slot)}
                                      className={`transition ${
                                        draggingBookingId
                                          ? 'bg-white'
                                          : isDragging
                                            ? 'bg-white'
                                            : 'bg-white hover:bg-[#f8faff]'
                                      }`}
                                      style={{
                                        height: slotHeight,
                                        borderBottom: (slot + 1) % slotsPerHour === 0 ? '1px solid #eef1f3' : 'none',
                                      }}
                                    />
                                  ))}
                                  {nowLineTop != null && (
                                    <div
                                      className="pointer-events-none absolute left-0 right-0 border-t border-[#3a66e0]"
                                      style={{ top: nowLineTop, zIndex: 24 }}
                                    />
                                  )}

                                  {(() => {
                                    const hasDragSelection = dragSelection && dragSelection.courtId === court.id;
                                    const hasDrawerSelection =
                                      drawerOpen &&
                                      !editingBookingId &&
                                      selectedCourtId === court.id &&
                                      selectedEndSlot > selectedStartSlot;
                                    if (!hasDragSelection && !hasDrawerSelection) return null;

                                    const range = hasDragSelection
                                      ? toSelectionRange(dragSelection as DraftSelection)
                                      : { start: selectedStartSlot, end: selectedEndSlot };
                                    const top = range.start * slotHeight + 2;
                                    const height = (range.end - range.start) * slotHeight - 4;
                                    const durationMinutes = (range.end - range.start) * slotMinutes;
                                    const visibility = blockContentVisibility(height);
                                    return (
                                      <div
                                        className={`pointer-events-none absolute left-1 right-1 rounded-lg border border-[#2f4fd8] bg-[#2f4fd81a] overflow-hidden ${
                                          visibility.showDurationOnly
                                            ? 'px-1 py-0.5 flex items-center'
                                            : 'p-2'
                                        }`}
                                        style={{ top, height }}
                                      >
                                        <p className="text-[10px] font-bold leading-none text-[#1d2a66]">{durationMinutes} min</p>
                                        {!visibility.showDurationOnly && visibility.showTimeRange && (
                                          <p className="text-[10px] text-[#1d2a66]/80">
                                            {slotToTime(range.start)} - {slotToTime(range.end)}
                                          </p>
                                        )}
                                      </div>
                                    );
                                  })()}

                                  {bookingDropPreview && draggingBookingMeta && bookingDropPreview.courtId === court.id && (
                                    (() => {
                                      const top = bookingDropPreview.startSlot * slotHeight + 2;
                                      const height = (bookingDropPreview.endSlot - bookingDropPreview.startSlot) * slotHeight - 4;
                                      const durationMinutes = (bookingDropPreview.endSlot - bookingDropPreview.startSlot) * slotMinutes;
                                      const visibility = blockContentVisibility(height);
                                      const isDropConflicted = bookingDropHasConflict;
                                      return (
                                        <div
                                          className={`pointer-events-none absolute z-20 left-1 right-1 rounded-lg text-[10px] shadow-sm overflow-hidden ${
                                            visibility.showDurationOnly
                                              ? 'px-1 py-0.5 flex items-center leading-none'
                                              : 'p-2 leading-tight'
                                          } ${isDropConflicted ? 'border border-[#d13d57] bg-[#ffe8ee] text-[#8b1f3a]' : bookingColor(draggingBookingMeta.state)}`}
                                          style={{ top, height, opacity: isDropConflicted ? 0.9 : 1 }}
                                        >
                                          {visibility.showDurationOnly ? (
                                            <p className="font-bold leading-none">{durationMinutes} min</p>
                                          ) : (
                                            <>
                                              {visibility.showBadge && (
                                                <div className="mb-1 flex flex-wrap gap-1">
                                                  <div className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold ${bookingBadgeColor(draggingBookingMeta.state)}`}>
                                                    {bookingStatusLabel(draggingBookingMeta.state)}
                                                  </div>
                                                  <div className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold ${bookingPaymentBadgeColor(draggingBookingMeta.paymentState)}`}>
                                                    {bookingPaymentLabel(draggingBookingMeta.paymentState)}
                                                  </div>
                                                </div>
                                              )}
                                              {visibility.showTitle && (
                                                <p className="font-semibold truncate">{draggingBookingMeta.title}</p>
                                              )}
                                              {isDropConflicted && visibility.showTimeRange && (
                                                <p className="font-semibold text-[#b42346]">Superposición</p>
                                              )}
                                              {visibility.showTimeRange && (
                                                <p className="opacity-70">
                                                  {slotToTime(bookingDropPreview.startSlot)} - {slotToTime(bookingDropPreview.endSlot)}
                                                </p>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      );
                                    })()
                                  )}

                                  {courtBookings.map((booking) => {
                                    if (draggingBookingId === booking.id) return null;
                                    const top = booking.startSlot * slotHeight + 2;
                                    const height = (booking.endSlot - booking.startSlot) * slotHeight - 4;
                                    const durationMinutes = (booking.endSlot - booking.startSlot) * slotMinutes;
                                    const visibility = blockContentVisibility(height);
                                    return (
                                      <div
                                        key={booking.id}
                                        onMouseDown={(event) => handleBookingMouseDown(event, booking)}
                                        className={`absolute left-1 right-1 rounded-lg text-[10px] shadow-sm overflow-hidden ${
                                          visibility.showDurationOnly
                                            ? 'px-1 py-0.5 flex items-center leading-none'
                                            : 'p-2 leading-tight'
                                        } ${bookingColor(booking.state)}`}
                                        style={{ top, height, cursor: draggingBookingId ? 'grabbing' : 'grab' }}
                                      >
                                        {visibility.showDurationOnly ? (
                                          <p className="font-bold leading-none">{durationMinutes} min</p>
                                        ) : (
                                          <>
                                            {visibility.showBadge && (
                                              <div className="mb-1 flex flex-wrap gap-1">
                                                <div className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold ${bookingBadgeColor(booking.state)}`}>
                                                  {bookingStatusLabel(booking.state)}
                                                </div>
                                                <div className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold ${bookingPaymentBadgeColor(booking.paymentState)}`}>
                                                  {bookingPaymentLabel(booking.paymentState)}
                                                </div>
                                              </div>
                                            )}
                                            {visibility.showTitle && <p className="font-semibold truncate">{booking.title}</p>}
                                            {visibility.showTimeRange && (
                                              <p className="opacity-70">{slotToTime(booking.startSlot)} - {slotToTime(booking.endSlot)}</p>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {drawerOpen && (
              <button
                type="button"
                aria-label="Cerrar panel"
                className="absolute inset-0 z-20 bg-[#101326]/20"
                onClick={() => setDrawerOpen(false)}
              />
            )}

            <aside
              className={`absolute inset-y-0 right-0 z-30 w-full max-w-[620px] border-l border-[#e6e8ee] bg-white transition-transform duration-300 ${
                drawerOpen ? 'translate-x-0' : 'translate-x-full'
              }`}
            >
              <div className="relative h-full w-full flex flex-col">
                <header className="border-b border-[#eef0f5] px-6 py-5 flex items-start justify-between">
                  <div>
                    <h2 className="text-[25px] leading-none font-black text-[#181d2f] tracking-[-0.02em]">
                      {editingBookingId
                        ? bookingKind === 'block'
                          ? 'Edit blocking'
                          : 'Edit booking'
                        : bookingKind === 'block'
                          ? 'Create blocking'
                          : 'Create booking'}
                    </h2>
                    <div className="mt-4 flex flex-wrap items-center gap-2 relative">
                      <button
                        type="button"
                        onClick={() => setBookingKindMenuOpen((previous) => !previous)}
                        className="h-8 rounded-full border border-[#dbe2ff] bg-[#eef2ff] px-3 text-[13px] font-medium text-[#3155df] inline-flex items-center gap-1.5"
                      >
                        <selectedBookingKind.icon size={13} />
                        {selectedBookingKind.label}
                        <ChevronDown size={14} />
                      </button>
                      {bookingKindMenuOpen && (
                        <div className="absolute top-10 left-0 z-40 w-[420px] rounded-2xl border border-[#dfe4f1] bg-white p-2 shadow-xl">
                          {bookingKindOptions.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                setBookingKind(option.value);
                                setBookingKindMenuOpen(false);
                              }}
                              className={`w-full text-left rounded-xl px-3 py-3 transition ${
                                option.value === bookingKind ? 'bg-[#eef0ff]' : 'hover:bg-[#f6f7fb]'
                              }`}
                            >
                              <span className="flex items-start gap-2">
                                <option.icon size={17} className="mt-[1px] text-[#44527b]" />
                                <span>
                                  <span className="block text-[19px] font-bold leading-none text-[#2a3245]">{option.label}</span>
                                  <span className="block mt-1 text-[12px] leading-snug text-[#7d879d]">{option.description}</span>
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                      <label className="h-8 rounded-full border border-[#e2e6ef] bg-[#f8f9fc] px-3 text-[13px] font-medium text-[#3e4555] inline-flex items-center gap-1.5">
                        <input
                          type="date"
                          value={formatLocalDate(selectedDate)}
                          onChange={(event) => {
                            const next = new Date(`${event.target.value}T12:00:00`);
                            if (!Number.isNaN(next.getTime())) {
                              setSelectedDate(next);
                              setFormError('');
                            }
                          }}
                          className="bg-transparent outline-none"
                        />
                        <ChevronDown size={14} />
                      </label>
                      {bookingKind !== 'block' && (
                        <>
                          <select
                            value={selectedCourtId}
                            onChange={(event) => {
                              setSelectedCourtId(event.target.value);
                              setFormError('');
                            }}
                            className="h-8 rounded-full border border-[#e2e6ef] bg-[#f8f9fc] px-3 text-[13px] font-medium text-[#3e4555]"
                          >
                            {effectiveCourts.map((court) => (
                              <option key={court.id} value={court.id}>
                                {court.name}
                              </option>
                            ))}
                          </select>
                          <select
                            value={slotToTime(selectedStartSlot)}
                            onChange={(event) => {
                              const nextStart = timeToSlot(event.target.value);
                              setSelectedStartSlot(nextStart);
                              if (nextStart >= selectedEndSlot) {
                                setSelectedEndSlot(nextStart + 1);
                              }
                              setFormError('');
                            }}
                            className="h-8 rounded-full border border-[#e2e6ef] bg-[#f8f9fc] px-3 text-[13px] font-medium text-[#3e4555]"
                          >
                            {timeOptions.slice(0, -1).map((option) => (
                              <option key={`start-${option.value}`} value={option.value}>
                                {option.value}
                              </option>
                            ))}
                          </select>
                          <select
                            value={slotToTime(selectedEndSlot)}
                            onChange={(event) => {
                              const nextEnd = Math.max(timeToSlot(event.target.value), selectedStartSlot + 1);
                              setSelectedEndSlot(nextEnd);
                              setFormError('');
                            }}
                            className="h-8 rounded-full border border-[#e2e6ef] bg-[#f8f9fc] px-3 text-[13px] font-medium text-[#3e4555]"
                          >
                            {timeOptions.slice(1).map((option) => (
                              <option key={`end-${option.value}`} value={option.value}>
                                {option.value}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false);
                      setEditingBookingId(null);
                      setEditingBaseline(null);
                    }}
                    className="h-9 w-9 rounded-full border border-[#e4e7ee] text-[#798194] grid place-items-center hover:bg-[#f7f8fb] shrink-0"
                  >
                    <X size={16} />
                  </button>
                </header>

                <div className="flex-1 overflow-y-auto px-6 py-6">
                  {bookingKind === 'block' ? (
                    <>
                      <section className="pb-6 border-b border-[#edf0f5]">
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="text-[13px] text-[#727b90]">Title (optional)</span>
                            <input
                              value={blockingTitle}
                              onChange={(event) => setBlockingTitle(event.target.value)}
                              placeholder="Maintenance"
                              className="mt-2 h-11 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[15px] outline-none"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[13px] text-[#727b90]">Court</span>
                            <select
                              value={selectedCourtId}
                              onChange={(event) => setSelectedCourtId(event.target.value)}
                              className="mt-2 h-11 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[15px]"
                            >
                              {effectiveCourts.map((court) => (
                                <option key={court.id} value={court.id}>
                                  {court.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-3">
                          <label className="block">
                            <span className="text-[13px] text-[#727b90]">Date</span>
                            <input
                              type="date"
                              value={formatLocalDate(selectedDate)}
                              onChange={(event) => {
                                const next = new Date(`${event.target.value}T12:00:00`);
                                if (!Number.isNaN(next.getTime())) {
                                  setSelectedDate(next);
                                }
                              }}
                              className="mt-2 h-11 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[15px]"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[13px] text-[#727b90]">Start time</span>
                            <select
                              value={slotToTime(selectedStartSlot)}
                              onChange={(event) => {
                                const nextStart = timeToSlot(event.target.value);
                                setSelectedStartSlot(nextStart);
                                if (nextStart >= selectedEndSlot) {
                                  setSelectedEndSlot(nextStart + 1);
                                }
                              }}
                              className="mt-2 h-11 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[15px]"
                            >
                              {timeOptions.slice(0, -1).map((option) => (
                                <option key={`start-block-${option.value}`} value={option.value}>
                                  {option.value}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-[13px] text-[#727b90]">End time</span>
                            <select
                              value={slotToTime(selectedEndSlot)}
                              onChange={(event) => {
                                const nextEnd = Math.max(timeToSlot(event.target.value), selectedStartSlot + 1);
                                setSelectedEndSlot(nextEnd);
                              }}
                              className="mt-2 h-11 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[15px]"
                            >
                              {timeOptions.slice(1).map((option) => (
                                <option key={`end-block-${option.value}`} value={option.value}>
                                  {option.value}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </section>

                      <section className="pt-6">
                        <p className="text-[20px] font-black tracking-[-0.01em] text-[#1c2234]">Notes</p>
                        <label className="block mt-2">
                          <span className="text-[13px] text-[#7c8598]">Private notes (optional)</span>
                          <textarea
                            value={notes}
                            onChange={(event) => setNotes(event.target.value)}
                            placeholder="Private notes are only visible to club admins"
                            rows={4}
                            className="mt-2 w-full rounded-xl border border-[#dbe2ef] bg-white px-3 py-2 text-sm resize-none"
                          />
                        </label>
                      </section>
                    </>
                  ) : (
                    <>
                  <section className="pb-6 border-b border-[#edf0f5]">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[20px] font-black tracking-[-0.01em] text-[#1c2234]">Payment</p>
                      {bookingFinancial && (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${
                            bookingFinancial.remaining <= 0.009
                              ? 'bg-[#e8f8ec] text-[#16733f]'
                              : 'bg-[#fff4e5] text-[#9a5a00]'
                          }`}
                        >
                          {bookingFinancial.remaining <= 0.009 ? 'Reserva pagada' : 'Pago pendiente'}
                        </span>
                      )}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[13px] text-[#727b90] inline-flex items-center gap-1">Payment type <CircleAlert size={13} /></p>
                        <div className="mt-2 grid grid-cols-2 rounded-xl border border-[#dce2ee] bg-[#f7f8fc] p-1">
                          {(['Único', 'Dividido'] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setPaymentMode(mode)}
                              className={`h-9 rounded-lg text-[15px] font-semibold transition ${
                                paymentMode === mode ? 'bg-[#dfe4f4] text-[#2e58e5]' : 'text-[#616b81]'
                              }`}
                            >
                              {mode === 'Único' ? 'Single' : 'Split'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[13px] text-[#727b90]">{priceFieldLabel}</p>
                        <div className="mt-2 h-11 rounded-xl border border-[#dce2ee] bg-white px-3 flex items-center justify-between text-[16px] text-[#2c3448]">
                          <input
                            type="number"
                            min={0}
                            max={MAX_MANUAL_PARTICIPANT_PRICE}
                            value={Number(pricePerParticipantDisplay.toFixed(2))}
                            onChange={(event) => {
                              const next = clampParticipantPrice(Number(event.target.value || 0));
                              if (paymentMode === 'Único') {
                                setParticipants((previous) =>
                                  previous.map((participant) =>
                                    participant.isOwner
                                      ? { ...participant, customPrice: next }
                                      : participant
                                  )
                                );
                                return;
                              }
                              setDefaultPricePerParticipant(next);
                              setParticipants((previous) =>
                                previous.map((participant) => ({ ...participant, customPrice: null }))
                              );
                            }}
                            className="w-full bg-transparent outline-none"
                          />
                          <span className="text-[#8b93a5]">$</span>
                        </div>
                        <p className="mt-1 text-[11px] text-[#6f7890]">
                          Precio turno ({selectionMinutes} min): <strong>{totalPrice.toFixed(2)} $</strong>
                        </p>
                        <p className="mt-1 text-[11px] text-[#6f7890]">{priceFieldHint}</p>
                        {quoteLoading && <p className="mt-1 text-[11px] text-[#7b8396]">Cotizando...</p>}
                        {quoteError && <p className="mt-1 text-[11px] text-[#d13d57]">{quoteError}</p>}
                        {bookingFinancial && (
                          <p className="mt-1 text-[11px] text-[#6f7890]">
                            Pagado: <strong>{bookingFinancial.paid.toFixed(2)} $</strong> · Restante:{' '}
                            <strong>{bookingFinancial.remaining.toFixed(2)} $</strong>
                          </p>
                        )}
                        {exceedsRemainingWarning && (
                          <p className="mt-1 text-[11px] text-[#d13d57]">
                            El precio configurado supera el saldo pendiente. Al cobrar se ajustará al restante.
                          </p>
                        )}
                      </div>
                    </div>
                  </section>

                  <section className="py-6 border-b border-[#edf0f5]">
                    <div className="flex items-end justify-between">
                      <p className="text-[20pxpx] font-black tracking-[-0.01em] text-[#1c2234]">Participants</p>
                      <div className="grid grid-cols-[1fr_86px_132px_20px] gap-2 text-[12px] text-[#7b8396]">
                        <span />
                        <span>Price</span>
                        <span>Payment</span>
                        <span />
                      </div>
                    </div>

                    <div className="mt-3 space-y-3">
                      {participants.map((participant) => {
                        const displayPrice =
                          paymentMode === 'Único' && !participant.isOwner
                            ? 0
                            : resolveParticipantPrice(participant);
                        const isDuplicateParticipant = duplicateParticipantIds.has(participant.id);
                        return (
                          <div
                            key={participant.id}
                            className={`rounded-xl border bg-white p-2 ${
                              isDuplicateParticipant ? 'border-[#f2b7c3] bg-[#fff8fa]' : 'border-[#e3e8f2]'
                            }`}
                          >
                            <p className="text-[13px] text-[#7c8598] mb-2">
                              {participant.isOwner ? 'Owner' : 'Player (optional)'}
                            </p>
                            <div className="grid grid-cols-[1fr_86px_132px_20px] gap-2 items-center">
                              <div className="relative">
                                <div className="h-11 rounded-xl border border-[#dbe2ef] px-3 flex items-center gap-2 text-[#8b93a5]">
                                  <Search size={14} />
                                  <input
                                    value={participant.name}
                                    onChange={(event) => void runParticipantSearch(participant.id, event.target.value)}
                                    onFocus={() => {
                                      const suggestions = participantSuggestionsById[participant.id];
                                      if (Array.isArray(suggestions) && suggestions.length > 0) {
                                        setParticipantSearchOpenId(participant.id);
                                      }
                                    }}
                                    placeholder="Buscar nombre, email o teléfono"
                                    className="w-full bg-transparent outline-none text-[13px] text-[#273048]"
                                  />
                                </div>
                                {participantSearchOpenId === participant.id && (
                                  <div className="absolute left-0 right-0 top-12 z-30 rounded-xl border border-[#dde3ef] bg-white shadow-lg p-1">
                                    {participantSearchLoadingId === participant.id && (
                                      <p className="px-2 py-1 text-[11px] text-[#7b8396]">Buscando...</p>
                                    )}
                                    {(participantSuggestionsById[participant.id] || []).slice(0, 8).map((suggestion) => (
                                      <button
                                        key={suggestion.id}
                                        type="button"
                                        onClick={() => applyParticipantSuggestion(participant.id, suggestion)}
                                        className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-[#f4f6fb]"
                                      >
                                        <span className="block text-[12px] font-semibold text-[#273048]">{suggestion.label}</span>
                                        {suggestion.secondary && (
                                          <span className="block text-[11px] text-[#7b8396]">{suggestion.secondary}</span>
                                        )}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="h-11 rounded-xl border border-[#dbe2ef] px-3 flex items-center justify-between text-[15px]">
                                {paymentMode === 'Único' && !participant.isOwner ? (
                                  <span>-</span>
                                ) : (
                                  <input
                                    type="number"
                                    min={0}
                                    max={MAX_MANUAL_PARTICIPANT_PRICE}
                                    step="0.01"
                                    value={Number(displayPrice.toFixed(2))}
                                    onChange={(event) => {
                                      const next = clampParticipantPrice(Number(event.target.value || 0));
                                      if (paymentMode === 'Dividido') {
                                        setParticipants((previous) =>
                                          rebalanceSplitPrices(previous, participant.id, next)
                                        );
                                        return;
                                      }
                                      updateParticipant(participant.id, { customPrice: next });
                                    }}
                                    className="w-full bg-transparent outline-none"
                                  />
                                )}
                                <span className="text-[#8b93a5]">$</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => void toggleParticipantPaid(participant.id)}
                                disabled={paymentInFlightId === participant.id || markingAllPaid}
                                className={`h-11 rounded-xl border text-[15px] font-semibold ${
                                  participant.paid
                                    ? 'border-[#cbe6d0] bg-[#e9f8ec] text-[#16733f]'
                                    : 'border-[#dfe5f8] bg-[#edf1ff] text-[#3155df]'
                                } disabled:opacity-60`}
                              >
                                {paymentInFlightId === participant.id
                                  ? 'Paying...'
                                  : participant.paid
                                    ? 'Paid'
                                    : 'Mark as paid'}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setParticipantMenuId((previous) =>
                                    previous === participant.id ? null : participant.id
                                  );
                                }}
                                className="h-11 w-5 text-[#727b90] grid place-items-center"
                              >
                                <MoreVertical size={16} />
                              </button>
                            </div>
                            {(expandedParticipantId === participant.id || participant.contact.trim().length > 0) && (
                              <div className="mt-2">
                                <div className="h-10 rounded-xl border border-[#dbe2ef] px-3 flex items-center gap-2 text-[#8b93a5]">
                                  <input
                                    value={participant.contact}
                                    onChange={(event) => updateParticipant(participant.id, { contact: event.target.value })}
                                    placeholder="Contacto (email o teléfono)"
                                    className="w-full bg-transparent outline-none text-[13px] text-[#273048]"
                                  />
                                </div>
                              </div>
                            )}
                            {isDuplicateParticipant && (
                              <p className="mt-2 text-[11px] font-semibold text-[#c0354f]">
                                Participante duplicado en esta reserva.
                              </p>
                            )}
                            {participantMenuId === participant.id && (
                              <div className="mt-2 rounded-xl border border-[#dce2ef] bg-white shadow-sm p-2 text-[12px] text-[#30384d]">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedParticipantId(participant.id);
                                    setParticipantMenuId(null);
                                  }}
                                  className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-[#f4f6fb]"
                                >
                                  Editar participante (nombre/contacto)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (participant.paid) {
                                      markParticipantAsPending(participant.id);
                                    } else {
                                      void toggleParticipantPaid(participant.id);
                                    }
                                    setParticipantMenuId(null);
                                  }}
                                  className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-[#f4f6fb]"
                                >
                                  {participant.paid ? 'Marcar como pendiente' : 'Marcar como pagado'}
                                </button>
                                <div className="mt-1 border-t border-[#edf0f6] pt-1">
                                  <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-[#7a8398]">
                                    Método de pago
                                  </p>
                                  {([
                                    { value: 'CASH', label: 'Efectivo' },
                                    { value: 'TRANSFER', label: 'Transferencia' },
                                    { value: 'CARD', label: 'Tarjeta' },
                                  ] as const).map((option) => (
                                    <button
                                      key={option.value}
                                      type="button"
                                      onClick={() => {
                                        updateParticipant(participant.id, { paymentMethod: option.value });
                                        setParticipantMenuId(null);
                                      }}
                                      className={`w-full text-left rounded-lg px-2 py-1.5 hover:bg-[#f4f6fb] ${
                                        participant.paymentMethod === option.value ? 'text-[#2f53df] font-semibold' : ''
                                      }`}
                                    >
                                      {option.label}
                                    </button>
                                  ))}
                                </div>
                                <div className="mt-1 border-t border-[#edf0f6] pt-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (participant.isOwner) return;
                                      const confirmed = window.confirm('¿Eliminar este participante de la reserva?');
                                      if (confirmed) {
                                        removeParticipant(participant.id);
                                      }
                                      setParticipantMenuId(null);
                                    }}
                                    disabled={participant.isOwner}
                                    className="w-full text-left rounded-lg px-2 py-1.5 text-[#c0354f] hover:bg-[#fff2f4] disabled:opacity-40"
                                  >
                                    Eliminar participante
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDefaultPricePerParticipant(0);
                          setParticipants((previous) =>
                            previous.map((participant) => ({ ...participant, customPrice: null }))
                          );
                        }}
                        className="h-7 rounded-full px-3 border border-[#dbe2ef] text-[#4e5870] text-[12px] font-semibold"
                      >
                        Recalcular precios
                      </button>
                      <button
                        type="button"
                        onClick={() => void markAllAsPaid()}
                        disabled={markingAllPaid || (bookingFinancial != null && bookingFinancial.remaining <= 0.009)}
                        className="h-7 rounded-full px-3 bg-[#edf1ff] text-[#3155df] text-[12px] font-semibold"
                      >
                        {markingAllPaid
                          ? 'Procesando pago...'
                          : bookingFinancial != null && bookingFinancial.remaining <= 0.009
                            ? 'Ya está pagada'
                            : '✓ Mark all as paid'}
                      </button>
                      <button
                        type="button"
                        onClick={addParticipantRow}
                        className="h-7 rounded-full px-3 border border-[#dbe2ef] text-[#4e5870] text-[12px] font-semibold inline-flex items-center gap-1"
                      >
                        <Plus size={12} />
                        Add player
                      </button>
                    </div>
                  </section>

                  <section className="pt-6">
                    <p className="text-[27px] font-black tracking-[-0.01em] text-[#1c2234]">Notes</p>
                    <label className="block mt-2">
                      <span className="text-[13px] text-[#7c8598]">Private notes (optional)</span>
                      <textarea
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        placeholder="Add private notes"
                        rows={4}
                        className="mt-2 w-full rounded-xl border border-[#dbe2ef] bg-white px-3 py-2 text-sm resize-none"
                      />
                    </label>
                  </section>
                    </>
                  )}
                </div>

                <footer className="border-t border-[#eef0f5] p-4 space-y-3">
                  {quotedListPrice != null && bookingKind !== 'block' && (
                    <div className="rounded-lg bg-[#f7f8fc] px-3 py-2 text-xs text-[#5c6478] flex justify-between">
                      <span>Precio lista</span>
                      <strong>{quotedListPrice.toFixed(2)} $</strong>
                    </div>
                  )}
                  {quotedDiscountAmount > 0 && bookingKind !== 'block' && (
                    <div className="rounded-lg bg-[#edf8ef] px-3 py-2 text-xs text-[#2f7a47] flex justify-between">
                      <span>Descuento aplicado</span>
                      <strong>-{quotedDiscountAmount.toFixed(2)} $</strong>
                    </div>
                  )}
                  <div className="rounded-lg bg-[#f7f8fc] px-3 py-2 text-xs text-[#5c6478] flex justify-between">
                    <span>Total estimado</span>
                    <strong>{totalPrice.toFixed(2)} $</strong>
                  </div>
                  {formError && <p className="text-xs text-[#d13d57] font-semibold">{formError}</p>}
                  {shouldShowScheduleConflict && !formError && (
                    <p className="text-xs text-[#d13d57] font-semibold">
                      Hay un turno que se superpone en esa cancha.
                    </p>
                  )}
                  {hasDuplicateParticipants && !formError && (
                    <p className="text-xs text-[#d13d57] font-semibold">
                      Hay participantes duplicados. Corregilo para poder guardar.
                    </p>
                  )}
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleCreateBooking}
                      disabled={
                        isSubmittingBooking ||
                        isDeletingBooking ||
                        hasDuplicateParticipants ||
                        shouldShowScheduleConflict
                      }
                      className="h-10 min-w-[180px] rounded-xl bg-[#3053e2] px-4 text-white text-sm font-bold hover:bg-[#2748cc] disabled:opacity-50"
                    >
                      {isSubmittingBooking
                        ? editingBookingId
                          ? 'Guardando cambios...'
                          : 'Creando reserva...'
                        : `${editingBookingId ? 'Guardar cambios' : 'Create booking'} • ${selectionMinutes} min`}
                    </button>
                    {editingBookingId && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteBooking()}
                        aria-label="Eliminar reserva"
                        title="Eliminar reserva"
                        disabled={isSubmittingBooking || isDeletingBooking}
                        className="h-10 w-10 rounded-xl border border-[#dfe4ec] bg-white text-[#7f889b] grid place-items-center shadow-sm hover:bg-[#f7f9fc] disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </footer>
              </div>
            </aside>
          </section>
        </div>
      </div>

      <style jsx global>{`
        body {
          background: #f5f6f8;
        }
      `}</style>
    </>
  );
}
