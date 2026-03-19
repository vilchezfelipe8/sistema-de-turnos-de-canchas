import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '../utils/apiUrl';
import { extractErrorMessage, reportUiError } from '../utils/uiError';
import { getToken } from '../services/AuthService';

interface Court {
  id: number;
  name: string;
  price?: number | null;
  basePrice?: number | null;
  lightsExtraApplied?: number | null;
}

interface SlotWithCourts {
  slotTime: string;
  availableCourts: Court[];
}

interface AvailabilityResponse {
  date: string;
  slotsWithCourts: SlotWithCourts[];
}

export function useAvailability(
  date: Date | null,
  activityId?: number | null,
  clubSlug?: string,
  durationMinutes?: number
) {
  const [slotsWithCourts, setSlotsWithCourts] = useState<SlotWithCourts[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = `${getApiUrl()}/api`;

  const fetchSlots = useCallback(async () => {
    if (!date) return;
    setLoading(true);
    setError(null);

    try {
      if (!Number.isFinite(activityId) || Number(activityId) <= 0) {
        setSlotsWithCourts([]);
        return;
      }

      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;

      const timestamp = new Date().getTime();
      const clubParam = clubSlug ? `&clubSlug=${encodeURIComponent(clubSlug)}` : '';
      const durationParam = Number.isFinite(durationMinutes)
        ? `&durationMinutes=${durationMinutes}`
        : '';
      const token = getToken();
      const headers: Record<string, string> = {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch(
        `${apiBase}/bookings/availability-with-courts?activityId=${Number(activityId)}&date=${dateString}&t=${timestamp}${clubParam}${durationParam}`,
        {
            cache: 'no-store',
            headers
        }
      );

      if (!res.ok) throw new Error('Error al cargar turnos');

      const data: AvailabilityResponse = await res.json();
      setSlotsWithCourts(data.slotsWithCourts);

    } catch (err) {
      const message = extractErrorMessage(err, 'Error al cargar turnos');
      reportUiError({ area: 'useAvailability', action: 'fetchSlots' }, err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [date, activityId, apiBase, clubSlug, durationMinutes]);

  useEffect(() => {
    fetchSlots();
  }, [fetchSlots]);

  return {
    slotsWithCourts,
    loading,
    error,
    refresh: fetchSlots
  };
}
