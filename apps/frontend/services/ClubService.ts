import { fetchWithAuth, isAuthSessionInvalidatedError } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

const apiBase = () => `${getApiUrl()}/api`;
const GUEST_FAVORITES_STORAGE_KEY = 'guest:favorite-clubs';

export type FixedBookingActivityConfig = {
  fixedBookingDaysAhead: number;
  fixedBookingGenerationFrequencyDays: number;
};

export type FixedBookingSettingsByActivity = Record<string, FixedBookingActivityConfig>;
export type BookingConfirmationMode = 'AUTOMATIC' | 'MANUAL' | 'DEPOSIT_REQUIRED';
export type ClubOperationalStatus = 'OPEN' | 'TEMPORARY_CLOSED' | 'PERMANENTLY_CLOSED';

export interface Club {
  id: number;
  slug: string;
  name: string;
  addressLine: string;
  city: string;
  province: string;
  country: string;
  contactInfo: string;
  phone?: string;
  logoUrl?: string;
  clubImageUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  websiteUrl?: string;
  description?: string;
  timeZone?: string;
  lightsEnabled?: boolean;
  lightsExtraAmount?: number | null;
  lightsFromHour?: string | null;
  professorDurationOverrideEnabled?: boolean;
  professorDurationOverrideMinutes?: number;
  fixedBookingSettingsByActivity?: FixedBookingSettingsByActivity | null;
  bookingConfirmationMode?: BookingConfirmationMode;
  bookingDepositPercent?: number | null;
  allowManualConfirmationOverride?: boolean;
  autoCancelPendingBookingsEnabled?: boolean;
  autoCancelPendingBookingsMinutesBefore?: number | null;
  autoCancelPendingBookingsOnlyIfUnpaid?: boolean;
  autoCancelPendingWarningEnabled?: boolean;
  autoCancelPendingWarningMinutesBefore?: number | null;
  enforceCashShiftCloseWithOpenAccounts?: boolean;
  bookingSimpleAdvanceDaysUser?: number;
  bookingSimpleAdvanceDaysAdmin?: number;
  allowAdminSkipSimpleAdvanceLimit?: boolean;
  publicSports?: string[];
  openingDays?: number[] | null;
  closureDates?: string[] | null;
  clubOperationalStatus?: ClubOperationalStatus;
  temporaryClosureStartDate?: string | null;
  temporaryClosureEndDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type ClubFavorite = {
  id: string;
  clubId: number;
  userId: number;
  createdAt: string;
  club: Club;
};

export class ClubService {
  private static guestFavoritesSyncInFlight: Promise<{ syncedCount: number }> | null = null;

  private static canUseStorage() {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  }

  private static readGuestFavoriteIdsFromStorage(): number[] {
    if (!this.canUseStorage()) return [];
    try {
      const raw = window.localStorage.getItem(GUEST_FAVORITES_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return Array.from(
        new Set(
          parsed
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
        )
      );
    } catch {
      return [];
    }
  }

  private static writeGuestFavoriteIdsToStorage(ids: number[]) {
    if (!this.canUseStorage()) return;
    const safe = Array.from(
      new Set(
        ids
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0)
      )
    );
    if (safe.length === 0) {
      window.localStorage.removeItem(GUEST_FAVORITES_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(GUEST_FAVORITES_STORAGE_KEY, JSON.stringify(safe));
  }

  static getGuestFavoriteClubIds(): number[] {
    return this.readGuestFavoriteIdsFromStorage();
  }

  static setGuestFavorite(clubId: number, nextIsFavorite: boolean) {
    const safeClubId = Number(clubId);
    if (!Number.isInteger(safeClubId) || safeClubId <= 0) {
      return { isFavorite: false, ids: this.readGuestFavoriteIdsFromStorage() };
    }
    const current = new Set(this.readGuestFavoriteIdsFromStorage());
    if (nextIsFavorite) current.add(safeClubId);
    else current.delete(safeClubId);
    const ids = Array.from(current.values());
    this.writeGuestFavoriteIdsToStorage(ids);
    return { isFavorite: nextIsFavorite, ids };
  }

  static async syncGuestFavoritesToAccount() {
    if (this.guestFavoritesSyncInFlight) {
      return this.guestFavoritesSyncInFlight;
    }

    const task = (async () => {
    const ids = this.readGuestFavoriteIdsFromStorage();
    if (!ids.length) return { syncedCount: 0 };

    let syncedCount = 0;
    const failedIds: number[] = [];
    for (const clubId of ids) {
      try {
        await this.markFavorite(clubId);
        syncedCount += 1;
      } catch {
        failedIds.push(clubId);
      }
    }

    this.writeGuestFavoriteIdsToStorage(failedIds);

    return { syncedCount };
    })()
      .finally(() => {
        this.guestFavoritesSyncInFlight = null;
      });

    this.guestFavoritesSyncInFlight = task;
    return task;
  }

  static async getClubById(id: number): Promise<Club> {
    const response = await fetch(`${apiBase()}/clubs/${id}`);
    if (!response.ok) {
      throw new Error('Error al obtener el club');
    }
    return response.json();
  }

  static async getClubBySlug(slug: string): Promise<Club> {
    const response = await fetch(`${apiBase()}/clubs/slug/${slug}`);
    if (!response.ok) {
      throw new Error('Error al obtener el club');
    }
    return response.json();
  }

  static async getAllClubs(): Promise<Club[]> {
    const response = await fetch(`${apiBase()}/clubs`);
    if (!response.ok) {
      throw new Error('Error al obtener los clubes');
    }
    return response.json();
  }

  static async updateClub(id: number, data: Partial<Club>): Promise<Club> {
    const response = await fetchWithAuth(`${apiBase()}/clubs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Error al actualizar el club');
    }

    return response.json();
  }

  static async createClub(data: Partial<Club>): Promise<Club> {
    const response = await fetchWithAuth(`${apiBase()}/clubs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Error al crear el club');
    }

    return response.json();
  }

  static async getMyFavorites(): Promise<ClubFavorite[]> {
    try {
      const response = await fetchWithAuth(`${apiBase()}/clubs/favorites/me`, {
        method: 'GET'
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Error al obtener favoritos');
      }
      const payload = await response.json();
      return Array.isArray(payload?.favorites) ? payload.favorites : [];
    } catch (error: any) {
      if (isAuthSessionInvalidatedError(error)) {
        return [];
      }
      const message = String(error?.message || '').toLowerCase();
      if (
        message.includes('findmany') ||
        message.includes('clubfavorite') ||
        message.includes('error al obtener favoritos')
      ) {
        return [];
      }
      throw error;
    }
  }

  static async markFavorite(clubId: number): Promise<{
    favorite: {
      id: string;
      clubId: number;
      userId: number;
      createdAt: string;
    };
  }> {
    const response = await fetchWithAuth(`${apiBase()}/clubs/${clubId}/favorite`, {
      method: 'POST'
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo marcar favorito');
    }
    return response.json();
  }

  static async unmarkFavorite(clubId: number): Promise<{ removed: boolean }> {
    const response = await fetchWithAuth(`${apiBase()}/clubs/${clubId}/favorite`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo quitar favorito');
    }
    return response.json();
  }
}
