import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';
import { throwApiErrorFromResponse } from '../utils/apiError';

const apiBase = () => `${getApiUrl()}/api`;

export type AdminDashboardReport = {
  scope: {
    startDate: string;
    endDate: string;
    timeZone: string;
  };
  income: {
    totals: {
      collectedTotal: number;
      pendingTotal: number;
      refundedTotal: number;
      voidedTotal: number;
    };
    byMethod: Array<{
      method: string;
      label: string;
      count: number;
      total: number;
    }>;
    byAccountSource: Array<{
      sourceType: 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL' | 'CLASS_PASS' | 'CLASS_ENROLLMENT' | 'SUBSCRIPTION_INSTALLMENT';
      label: string;
      count: number;
      total: number;
    }>;
    /** Cobrado y devuelto por día del rango (días sin movimiento en 0). */
    byDay?: Array<{
      date: string;
      collected: number;
      refunded: number;
      count: number;
    }>;
  };
  bookings: {
    total: number;
    byStatus: Array<{
      status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
      count: number;
    }>;
  };
  pendingAccounts: {
    openCount: number;
    totalPending: number;
    accounts: Array<{
      id: string;
      label: string;
      sourceType: 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL' | 'CLASS_PASS' | 'CLASS_ENROLLMENT' | 'SUBSCRIPTION_INSTALLMENT';
      sourceLabel: string;
      status: 'OPEN' | 'CLOSED' | 'VOIDED';
      clientName: string;
      total: number;
      paid: number;
      pending: number;
      ageDays: number;
      /** Cancha de la reserva, si es una. */
      courtName?: string | null;
      /** Turno de la reserva o apertura de la cuenta. */
      when?: string;
      createdAt: string;
    }>;
  };
  /** Null si el rango es muy largo o no se pudo calcular. */
  occupancy?: ReportsOccupancy | null;
  pos: {
    totals: {
      salesTotal: number;
      paidTotal: number;
      pendingTotal: number;
      voidedTotal: number;
      productTotal: number;
      serviceTotal: number;
    };
    paymentsByMethod: Array<{
      method: string;
      count: number;
      total: number;
    }>;
    openAccountsCount: number;
    closedAccountsCount: number;
    byProduct: Array<{
      productId: number | null;
      name: string;
      quantity: number;
      total: number;
    }>;
    byService: Array<{
      name: string;
      quantity: number;
      total: number;
    }>;
  };
};

export type ReportsOccupancy = {
  totals: { openMinutes: number; bookedMinutes: number };
  courts: Array<{ courtId: number; name: string; openMinutes: number; bookedMinutes: number }>;
  /** weekday: 0 = domingo. Solo las horas en que el club abre. */
  heatmap: Array<{ weekday: number; hour: number; openMinutes: number; bookedMinutes: number }>;
};

export class ReportsService {
  static async getDashboardReport(
    slug: string,
    params?: { startDate?: string; endDate?: string }
  ): Promise<AdminDashboardReport> {
    const query = new URLSearchParams();
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);

    const response = await fetchWithAuth(
      `${apiBase()}/clubs/${slug}/admin/stats/dashboard${query.toString() ? `?${query}` : ''}`,
      { method: 'GET' }
    );

    if (!response.ok) {
      await throwApiErrorFromResponse(response, 'No se pudieron cargar los informes.');
    }

    return response.json();
  }
}
