import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiUrl } from '../utils/apiUrl';
import { extractErrorMessage, reportUiError } from '../utils/uiError';

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
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const apiBase = `${getApiUrl()}/api`;

  const fetchSlots = useCallback(async () => {
    if (!date) {
      setSlotsWithCourts([]);
      setLoading(false);
      setError(null);
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestId = ++requestIdRef.current;

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
      const headers: Record<string, string> = {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      };

      const res = await fetch(
        `${apiBase}/bookings/availability-with-courts?activityId=${Number(activityId)}&date=${dateString}&t=${timestamp}${clubParam}${durationParam}`,
        {
            cache: 'no-store',
            headers,
            signal: controller.signal
        }
      );

      if (!res.ok) {
        let backendMessage = 'Error al cargar turnos';
        try {
          const errorPayload = await res.json();
          const parsedError =
            typeof errorPayload?.error === 'string'
              ? errorPayload.error
              : typeof errorPayload?.message === 'string'
                ? errorPayload.message
                : null;
          if (parsedError) {
            backendMessage = parsedError;
          }
        } catch {
          // noop: fallback to generic message
        }
        throw new Error(backendMessage);
      }

      const data: AvailabilityResponse = await res.json();
      if (requestId !== requestIdRef.current || controller.signal.aborted) {
        return;
      }
      setSlotsWithCourts(data.slotsWithCourts);
      setError(null);

    } catch (err) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) {
        return;
      }
      const message = extractErrorMessage(err, 'Error al cargar turnos');
      reportUiError({ area: 'useAvailability', action: 'fetchSlots' }, err);
      setSlotsWithCourts([]);
      setError(message);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [date, activityId, apiBase, clubSlug, durationMinutes]);

  useEffect(() => {
    fetchSlots();
  }, [fetchSlots]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  return {
    slotsWithCourts,
    loading,
    error,
    refresh: fetchSlots
  };
}
