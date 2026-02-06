import { useState, useEffect } from 'react';
import { getApiUrl } from '../utils/apiUrl';

interface Court {
  id: number;
  name: string;
}

interface SlotWithCourts {
  slotTime: string;
  availableCourts: Court[];
}

interface AvailabilityResponse {
  date: string;
  slotsWithCourts: SlotWithCourts[];
}

export function useAvailability(date: Date | null, clubSlug?: string) {
  const [slotsWithCourts, setSlotsWithCourts] = useState<SlotWithCourts[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = getApiUrl();

  const fetchSlots = async () => {
    if (!date) return;
    setLoading(true);
    setError(null);
    setSlotsWithCourts([]);

    try {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;

      const timestamp = new Date().getTime();
      const clubParam = clubSlug ? `&clubSlug=${encodeURIComponent(clubSlug)}` : '';

      const res = await fetch(
        `${apiUrl}/api/bookings/availability-with-courts?activityId=1&date=${dateString}&t=${timestamp}${clubParam}`, 
        {
            cache: 'no-store',
            headers: {
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            }
        }
      );

      if (!res.ok) throw new Error('Error al cargar turnos');

      const data: AvailabilityResponse = await res.json();
      setSlotsWithCourts(data.slotsWithCourts);

    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSlots();
  }, [date, apiUrl, clubSlug]);

  return { slotsWithCourts, loading, error, refresh: fetchSlots };
}