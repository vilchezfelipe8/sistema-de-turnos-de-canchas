import { getToken } from './AuthService';
import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

const apiBase = () => `${getApiUrl()}/api`;

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
  openingDays?: number[] | null;
  closureDates?: string[] | null;
  clubOperationalStatus?: ClubOperationalStatus;
  temporaryClosureStartDate?: string | null;
  temporaryClosureEndDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type FavoriteLinkingStatus =
  | 'already_linked'
  | 'linked_existing_client'
  | 'created_client'
  | 'duplicate_detected_no_link'
  | 'insufficient_data_no_link';

export type ClubFavorite = {
  id: string;
  clubId: number;
  userId: number;
  createdAt: string;
  club: Club;
};

export class ClubService {
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
    if (!getToken()) throw new Error('No autenticado');

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
    if (!getToken()) throw new Error('No autenticado');

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
    if (!getToken()) return [];
    const response = await fetchWithAuth(`${apiBase()}/clubs/favorites/me`, {
      method: 'GET'
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Error al obtener favoritos');
    }
    const payload = await response.json();
    return Array.isArray(payload?.favorites) ? payload.favorites : [];
  }

  static async markFavorite(clubId: number): Promise<{
    favorite: {
      id: string;
      clubId: number;
      userId: number;
      createdAt: string;
    };
    linking: {
      status: FavoriteLinkingStatus;
      clientId: string | null;
    };
  }> {
    if (!getToken()) throw new Error('No autenticado');
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
    if (!getToken()) throw new Error('No autenticado');
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
