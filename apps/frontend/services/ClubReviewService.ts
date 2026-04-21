import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

const apiBase = () => `${getApiUrl()}/api`;

export type ClubReviewSummary = {
  count: number;
  averageRating: number;
};

export type ClubReviewItem = {
  id: string;
  bookingId: number;
  rating: number;
  comment: string | null;
  status: 'PUBLISHED' | 'HIDDEN';
  createdAt: string;
  user: {
    id: number;
    name: string;
  };
};

export type ClubReviewPage = {
  items: ClubReviewItem[];
  nextCursor: string | null;
};

export type MyClubReview = {
  id: string;
  bookingId: number;
  rating: number;
  comment: string | null;
  status: 'PUBLISHED' | 'HIDDEN';
  createdAt: string;
  updatedAt: string;
} | null;

export const getClubReviewsSummary = async (slug: string): Promise<ClubReviewSummary> => {
  const response = await fetch(`${apiBase()}/clubs/${encodeURIComponent(slug)}/reviews/summary`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'No se pudo obtener el resumen de reseñas');
  }
  return response.json();
};

export const listClubReviews = async (
  slug: string,
  input?: { take?: number; cursor?: string }
): Promise<ClubReviewPage> => {
  const query = new URLSearchParams();
  if (input?.take) query.set('take', String(input.take));
  if (input?.cursor) query.set('cursor', input.cursor);
  const suffix = query.toString() ? `?${query.toString()}` : '';

  const response = await fetch(`${apiBase()}/clubs/${encodeURIComponent(slug)}/reviews${suffix}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'No se pudieron listar reseñas');
  }
  return response.json();
};

export const getMyReviewForBooking = async (slug: string, bookingId: number): Promise<MyClubReview> => {
  const response = await fetchWithAuth(
    `${apiBase()}/clubs/${encodeURIComponent(slug)}/reviews/mine?bookingId=${encodeURIComponent(String(bookingId))}`,
    { method: 'GET' }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'No se pudo obtener tu reseña');
  }
  return response.json();
};

export const upsertMyClubReview = async (
  slug: string,
  input: { bookingId: number; rating: number; comment?: string | null }
) => {
  const response = await fetchWithAuth(`${apiBase()}/clubs/${encodeURIComponent(slug)}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bookingId: input.bookingId,
      rating: input.rating,
      comment: input.comment ?? null
    })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'No se pudo guardar la reseña');
  }
  return response.json();
};

