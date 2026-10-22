export type BookingCheckoutParticipantDraft = {
  id: string;
  identifier: string;
  name?: string | null;
  // Resultado de la búsqueda previa: con cuenta o invitado por email sin cuenta todavía.
  lookupStatus?: 'FOUND' | 'EMAIL_WITHOUT_ACCOUNT' | null;
};

export type BookingCheckoutDraft = {
  id: string;
  clubSlug?: string | null;
  courtId: number;
  courtName: string;
  activityId: number;
  activityName: string;
  date: string;
  slotTime: string;
  durationMinutes: number;
  price: number;
  listPrice: number;
  discountAmount: number;
  lightsExtraApplied: number;
  lightsFromHour?: string | null;
  // Precio por jugador: modalidad elegida y parte del titular (el resto se completa en el club).
  activityFormatId?: string | null;
  formatName?: string | null;
  playerCount?: number | null;
  pricePerPlayer?: number | null;
  // Parte de cada lugar sin asignar o no socio (con luces), para mostrar el detalle por jugador.
  generalPricePerPlayer?: number | null;
  memberCategoryName?: string | null;
  // false = el club cobra solo en el mostrador
  onlineCheckoutEnabled?: boolean;
  participants?: BookingCheckoutParticipantDraft[];
  createdAt: string;
};

const STORAGE_PREFIX = 'bookingCheckoutDraft:';

export const createBookingCheckoutDraftId = () =>
  `checkout_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const saveBookingCheckoutDraft = (draft: BookingCheckoutDraft) => {
  if (typeof window === 'undefined') return false;
  try {
    window.sessionStorage.setItem(`${STORAGE_PREFIX}${draft.id}`, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
};

export const readBookingCheckoutDraft = (id: string): BookingCheckoutDraft | null => {
  if (typeof window === 'undefined') return null;
  const safeId = String(id || '').trim();
  if (!safeId) return null;
  try {
    const raw = window.sessionStorage.getItem(`${STORAGE_PREFIX}${safeId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BookingCheckoutDraft;
    if (!parsed || String(parsed.id || '') !== safeId) return null;
    if (!Number.isFinite(Number(parsed.courtId)) || !Number.isFinite(Number(parsed.activityId))) return null;
    if (!parsed.date || !parsed.slotTime) return null;
    const participants = Array.isArray(parsed.participants)
      ? parsed.participants
          .map((participant) => ({
            id: String(participant?.id || '').trim(),
            identifier: String(participant?.identifier || '').trim(),
            name: String(participant?.name || '').trim() || null,
            lookupStatus:
              participant?.lookupStatus === 'FOUND' || participant?.lookupStatus === 'EMAIL_WITHOUT_ACCOUNT'
                ? participant.lookupStatus
                : null,
          }))
          .filter((participant) => participant.id && participant.identifier)
          .slice(0, 20)
      : [];
    return {
      ...parsed,
      courtId: Number(parsed.courtId),
      activityId: Number(parsed.activityId),
      durationMinutes: Number(parsed.durationMinutes || 90),
      price: Number(parsed.price || 0),
      listPrice: Number(parsed.listPrice || parsed.price || 0),
      discountAmount: Number(parsed.discountAmount || 0),
      lightsExtraApplied: Number(parsed.lightsExtraApplied || 0),
      participants,
    };
  } catch {
    return null;
  }
};

export const removeBookingCheckoutDraft = (id: string) => {
  if (typeof window === 'undefined') return;
  const safeId = String(id || '').trim();
  if (!safeId) return;
  try {
    window.sessionStorage.removeItem(`${STORAGE_PREFIX}${safeId}`);
  } catch {
    // noop
  }
};

// De dónde se abrió el checkout (la grilla con la selección en la dirección): "Volver" regresa ahí
// con el historial del navegador en lugar de abrir la página del club como si fuera nueva.
const CHECKOUT_RETURN_KEY = 'bookingCheckoutReturn';

export const rememberCheckoutReturn = (path: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(CHECKOUT_RETURN_KEY, path);
  } catch {
    // noop
  }
};

export const readCheckoutReturn = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(CHECKOUT_RETURN_KEY);
  } catch {
    return null;
  }
};
