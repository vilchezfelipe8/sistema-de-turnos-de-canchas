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
  createdAt?: string;
  updatedAt?: string;
}

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
}
