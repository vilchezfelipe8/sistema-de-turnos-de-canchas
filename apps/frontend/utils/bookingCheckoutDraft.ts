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
    return {
      ...parsed,
      courtId: Number(parsed.courtId),
      activityId: Number(parsed.activityId),
      durationMinutes: Number(parsed.durationMinutes || 90),
      price: Number(parsed.price || 0),
      listPrice: Number(parsed.listPrice || parsed.price || 0),
      discountAmount: Number(parsed.discountAmount || 0),
      lightsExtraApplied: Number(parsed.lightsExtraApplied || 0),
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
