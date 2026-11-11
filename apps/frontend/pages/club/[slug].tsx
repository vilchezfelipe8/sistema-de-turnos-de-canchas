import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import BookingGrid from '../../components/BookingGrid';
import DarkPageLayout from '../../components/DarkPageLayout';
import UserLoadingState from '../../components/UserLoadingState';
import { ClubService, Club } from '../../services/ClubService';
import {
  ClubReviewItem,
  getClubReviewsSummary,
  getMyReviewForClub,
  listClubReviews,
  upsertMyClubReview
} from '../../services/ClubReviewService';
import { getMyBookings } from '../../services/BookingService';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';
import { isAuthSessionInvalidatedError } from '../../utils/apiClient';
import { MapPin, Clock, Phone, Instagram, Facebook, Globe, Share2, Trophy, Star, Heart, X, Navigation, SearchX } from 'lucide-react';
import ClubAppHome from '../../components/clubApp/ClubAppHome';
import ClubInstallButton from '../../components/clubApp/ClubInstallButton';
import { useClubApp } from '../../hooks/useClubApp';
import { clubIconHref, clubManifestHref, isValidClubSlug, updateClubAppIdentity } from '../../utils/clubApp';
import type { GetServerSideProps } from 'next';
import { fetchClubBasics, resolveRequestOrigin } from '../../utils/serverClubLookup';
import BusyLabel from '../../components/ui/BusyLabel';
import Skeleton, { SkeletonText } from '../../components/ui/Skeleton';
import Modal from '../../components/ui/Modal';

type ClubPageProps = { appSlug: string | null; appName: string | null };

// El manifest y el ícono del club tienen que venir en la primera carga: iPhone (Safari y Chrome)
// toma el manifest que trae la página y no el que se cambia después en el navegador.
export const getServerSideProps: GetServerSideProps<ClubPageProps> = async ({ params, req }) => {
  const slug = typeof params?.slug === 'string' && isValidClubSlug(params.slug) ? params.slug : null;
  // Navegaciones dentro de la app (/_next/data): no hace falta buscar el club en el servidor,
  // la página ya lo tiene o lo carga; así volver atrás o cambiar de pestaña es inmediato.
  const isClientNavigation = String(req.url || '').startsWith('/_next/data');
  const basics = slug && !isClientNavigation ? await fetchClubBasics(slug, resolveRequestOrigin(req)) : null;
  return { props: { appSlug: slug, appName: basics?.name ?? null } };
};

// Clubes ya cargados en esta visita (solo navegador): al volver a la página se muestran al instante
// y se actualizan por detrás, sin pasar por "Cargando club...".
const clubPageCache = new Map<string, Club>();
const readCachedClub = (slug: unknown) =>
  typeof window !== 'undefined' && typeof slug === 'string' ? clubPageCache.get(slug) ?? null : null;

const APP_NOTICE_EVENT = 'app:notice';
type AppNoticeTone = 'success' | 'error' | 'info' | 'warning';

const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // la semana arranca el lunes

// "Lun a Sáb · 08:00 a 22:00" / "Dom · Cerrado": agrupa días seguidos con el mismo estado.
function buildScheduleLines(openingDays: number[], hours: { openTime: string; closeTime: string } | null | undefined) {
  const lines: Array<{ label: string; value: string; closed: boolean }> = [];
  let group: number[] = [];
  let groupOpen = false;
  const flush = () => {
    if (group.length === 0) return;
    const first = DAY_LABELS[group[0]];
    const last = DAY_LABELS[group[group.length - 1]];
    const label = group.length === 1 ? first : group.length === 2 ? `${first} y ${last}` : `${first} a ${last}`;
    const value = groupOpen ? (hours ? `${hours.openTime} a ${hours.closeTime}` : 'Abierto') : 'Cerrado';
    lines.push({ label, value, closed: !groupOpen });
  };
  WEEK_ORDER.forEach((day) => {
    const open = openingDays.includes(day);
    if (group.length > 0 && open !== groupOpen) { flush(); group = []; }
    groupOpen = open;
    group.push(day);
  });
  flush();
  return lines;
}
const REVIEWS_SHOWN = 3;

const formatClubAddress = (club: Club) =>
  [club.addressLine, club.city, club.province, club.country].filter(Boolean).join(', ');

// En la portada alcanza con la zona; la dirección completa queda en "Información".
const formatClubArea = (club: Club) =>
  [club.city, club.province].filter(Boolean).join(', ') || club.addressLine || '';

const directionsUrl = (club: Club) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${club.name} ${formatClubAddress(club)}`)}`;

const formatRatingLabel = (value: number) => {
  const safe = Number(value || 0);
  if (!Number.isFinite(safe)) return '0';
  return Number.isInteger(safe) ? String(safe) : safe.toFixed(1);
};

const formatReviewCount = (count: number) => `${count} ${count === 1 ? 'reseña' : 'reseñas'}`;

// Acepta "https://instagram.com/club/?igsh=..", "instagram.com/club", "@club" o "club".
const instagramLink = (raw: string) => {
  const value = raw.trim();
  if (!/[/.]/.test(value)) {
    const handle = value.replace(/^@/, '');
    return { href: `https://instagram.com/${handle}`, label: `@${handle}` };
  }
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const handle = url.pathname.split('/').filter(Boolean)[0];
    return { href: url.toString(), label: handle ? `@${handle}` : 'Instagram' };
  } catch {
    return { href: value, label: 'Instagram' };
  }
};

const externalLink = (raw: string, fallbackLabel: string) => {
  const value = raw.trim();
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.replace(/^www\./, '');
    return { href: url.toString(), label: fallbackLabel === 'Facebook' ? 'Facebook' : host };
  } catch {
    return { href: value, label: fallbackLabel };
  }
};

// Imágenes servidas por la propia app (/clubs/...) pasan por la optimización de Next;
// las externas se muestran tal cual porque no hay dominios remotos configurados.
const isLocalAsset = (src: string) => src.startsWith('/') && !src.startsWith('//');

const PAGE_CSS = `
  .p-public-theme-light .cl-page { --accent-fg:var(--positive-fg); }
  .p-public-page.cl-page { padding-top:28px; }
  /* Hero */
  .cl-hero { position:relative; border-radius:24px; overflow:hidden; border:1px solid var(--border); margin-bottom:28px; }
  .cl-hero-bg { position:absolute; inset:0; background:linear-gradient(135deg,var(--brand-on) 0%,var(--ink-900) 50%,var(--positive-bg) 100%); }
  .cl-hero-img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .cl-hero-overlay { position:absolute; inset:0; background:var(--hero-image-overlay); }
  .cl-hero-body { position:relative; z-index:2; padding:36px 40px 32px; display:grid; grid-template-columns:auto minmax(0,1fr) auto; grid-template-areas:"logo info actions"; align-items:end; gap:28px; }
  .cl-logo { grid-area:logo; position:relative; width:100px; height:100px; border-radius:20px; background:var(--surface-1); border:2px solid var(--border); overflow:hidden; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .cl-hero-info { grid-area:info; min-width:0; }
  .cl-hero-rating { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:var(--text-muted); margin-bottom:10px; }
  .cl-hero-rating b { color:var(--accent-fg); font-weight:800; }
  .cl-hero-h { font-size:clamp(28px,4vw,52px); font-weight:800; color:var(--text-primary); letter-spacing:-.04em; line-height:1; margin:0 0 12px; overflow-wrap:anywhere; }
  .cl-hero-meta { display:flex; flex-wrap:wrap; gap:6px 16px; align-items:center; }
  .cl-hero-meta-item { display:inline-flex; align-items:center; gap:6px; font-size:13px; color:var(--text-secondary); font-weight:500; }
  .cl-hero-meta-item svg { color:var(--accent-fg); flex-shrink:0; }
  .cl-directions { display:inline-flex; align-items:center; gap:5px; min-height:32px; padding:0 2px; font-size:13px; font-weight:700; color:var(--accent-fg); text-decoration:none; }
  .cl-directions:hover { text-decoration:underline; text-underline-offset:3px; }
  .cl-hero-actions { grid-area:actions; display:flex; gap:10px; }
  .cl-icon-btn { width:44px; height:44px; border-radius:14px; border:1px solid var(--border); background:var(--surface-2); display:flex; align-items:center; justify-content:center; cursor:pointer; transition:background .15s,border-color .15s,transform .15s; color:var(--text-secondary); }
  .cl-icon-btn:hover:not(:disabled) { background:var(--surface-3); border-color:var(--border-strong); transform:translateY(-1px); }
  .cl-icon-btn.cl-fav-on { background:var(--positive-bg); border-color:var(--accent-border); color:var(--accent-fg); }
  .cl-icon-btn.cl-fav-on svg { fill:currentColor; }
  .cl-icon-btn:disabled { opacity:.5; cursor:not-allowed; }
  /* Grid */
  .cl-grid { display:grid; grid-template-columns:minmax(0,2fr) minmax(0,1fr); gap:24px; align-items:start; }
  .cl-grid > * { min-width:0; }
  .cl-sidebar { display:flex; flex-direction:column; gap:16px; min-width:0; }
  /* Paneles */
  .cl-panel { background:var(--surface-1); border:1px solid var(--border); border-radius:18px; padding:22px 24px; }
  .cl-panel-h { font-size:11px; font-weight:700; letter-spacing:.04em; color:var(--text-muted); margin:0 0 14px; }
  .cl-panel-description { font-size:13px; color:var(--text-secondary); line-height:1.6; margin:0 0 8px; padding-bottom:12px; border-bottom:1px solid var(--border-subtle); }
  .cl-panel-rows { display:flex; flex-direction:column; }
  .cl-panel-row { display:flex; align-items:flex-start; gap:10px; font-size:13px; color:var(--text-secondary); font-weight:500; line-height:1.5; padding:9px 0; border-bottom:1px solid var(--border-subtle); text-decoration:none; overflow-wrap:anywhere; }
  .cl-panel-row:last-child { border-bottom:none; padding-bottom:0; }
  a.cl-panel-row { transition:color .15s; }
  a.cl-panel-row:hover { color:var(--accent-fg); }
  .cl-panel-icon { color:var(--text-muted); flex-shrink:0; margin-top:2px; }
  .cl-hours { display:flex; flex-direction:column; gap:2px; flex:1; min-width:0; }
  .cl-hours-row { display:flex; justify-content:space-between; gap:12px; }
  .cl-hours-day { color:var(--text-primary); font-weight:600; }
  .cl-hours-time { font-variant-numeric:tabular-nums; }
  .cl-hours-row.is-closed .cl-hours-time { color:var(--text-muted); }
  /* Reseñas */
  .cl-rating-sum { display:flex; align-items:center; gap:12px; margin-bottom:14px; padding-bottom:14px; border-bottom:1px solid var(--border-subtle); }
  .cl-rating-big { font-size:28px; font-weight:800; color:var(--accent-fg); letter-spacing:-.03em; line-height:1; }
  .cl-rating-sub { font-size:11px; color:var(--text-muted); font-weight:700; margin-top:4px; }
  .cl-stars { display:flex; gap:3px; }
  .cl-reviews { display:flex; flex-direction:column; gap:8px; }
  .cl-review-card { background:var(--surface-2); border:1px solid var(--border-subtle); border-radius:14px; padding:14px 16px; }
  .cl-review-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:6px; }
  .cl-review-name { font-size:12px; font-weight:800; color:var(--text-primary); }
  .cl-review-score { display:flex; align-items:center; gap:4px; font-size:12px; font-weight:800; color:var(--accent-fg); }
  .cl-review-comment { margin:0; font-size:13px; color:var(--text-secondary); line-height:1.55; }
  .cl-review-comment.is-empty { font-style:italic; color:var(--text-muted); }
  .cl-review-empty { margin:0 0 14px; font-size:13px; color:var(--text-muted); line-height:1.5; }
  .cl-review-cta { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; min-height:44px; margin-top:14px; padding:0 16px; background:var(--positive-bg); border:1px solid var(--accent-border-subtle); border-radius:12px; color:var(--accent-fg); font-family:inherit; font-size:13px; font-weight:800; cursor:pointer; transition:border-color .15s; }
  .cl-review-cta:hover:not(:disabled) { border-color:var(--accent-border); }
  .cl-review-cta:disabled { opacity:.6; cursor:not-allowed; }
  .cl-feedback { padding:10px 16px; border-radius:12px; background:var(--positive-bg); border:1px solid var(--accent-border-subtle); font-size:12px; font-weight:700; color:var(--accent-fg); margin-top:12px; }
  /* Contenido del modal de reseña (el modal en sí: pique.css .p-modal-*) */
  .cl-review-stars { display:flex; gap:8px; }
  .cl-review-star { width:44px; height:44px; border-radius:12px; border:1px solid var(--border); background:var(--surface-2); color:var(--text-muted); display:flex; align-items:center; justify-content:center; cursor:pointer; transition:background .15s,border-color .15s,color .15s; }
  .cl-review-star.cl-star-on { background:var(--positive-bg); border-color:var(--accent-border); color:var(--accent-fg); }
  .cl-review-textarea { width:100%; box-sizing:border-box; background:var(--surface-2); border:1px solid var(--border); border-radius:14px; padding:14px 16px; color:var(--text-primary); font-family:var(--font-sans); font-size:14px; outline:none; resize:none; transition:border-color .2s; }
  .cl-review-textarea:focus { border-color:var(--accent-border); }
  .cl-review-count { margin-top:8px; text-align:right; font-size:11px; color:var(--text-muted); font-weight:700; }
  /* Error */
  .cl-state { min-height:56vh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; text-align:center; padding:24px 0; }
  .cl-state-icon { width:52px; height:52px; border-radius:16px; display:flex; align-items:center; justify-content:center; background:var(--surface-2); color:var(--text-muted); margin-bottom:6px; }
  .cl-state-title { margin:0; font-size:22px; font-weight:800; letter-spacing:-.03em; color:var(--text-primary); }
  .cl-state-copy { margin:0 0 14px; max-width:360px; font-size:14px; color:var(--text-muted); line-height:1.5; }
  .cl-state-btn { display:inline-flex; align-items:center; justify-content:center; min-height:44px; padding:0 22px; border-radius:999px; background:var(--brand); color:var(--brand-on); font-size:13px; font-weight:800; text-decoration:none; }
  /* Esqueleto */
  .cl-skel-hero { height:172px; border-radius:24px; margin-bottom:28px; }
  .cl-skel-panel { background:var(--surface-1); border:1px solid var(--border); border-radius:24px; padding:28px; display:flex; flex-direction:column; gap:18px; }
  .cl-skel-row { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
  .cl-skel-slots { display:grid; grid-template-columns:repeat(auto-fill,minmax(76px,1fr)); gap:8px; }
  @media(max-width:900px){
    .cl-grid { grid-template-columns:1fr; }
    .cl-hero-body { padding:24px 24px 20px; }
    .cl-hero-h { font-size:28px; }
  }
  @media(max-width:600px){
    .p-public-page.cl-page { padding:16px 20px var(--page-end-gap); }
    .cl-hero { margin-bottom:20px; border-radius:20px; }
    /* Logo y acciones en la misma fila; nombre y datos debajo */
    .cl-hero-body { grid-template-columns:auto 1fr; grid-template-areas:"logo actions" "info info"; align-items:center; gap:16px; padding:18px; }
    .cl-logo { width:64px; height:64px; border-radius:16px; }
    .cl-hero-actions { justify-self:end; gap:8px; }
    .cl-hero-h { font-size:26px; margin-bottom:8px; }
    .cl-grid { gap:20px; }
    .cl-sidebar { gap:14px; }
    .cl-panel { padding:20px; }
    .cl-skel-hero { height:190px; border-radius:20px; margin-bottom:20px; }
    .cl-skel-panel { padding:20px; }
    .cl-skel-row { grid-template-columns:1fr; }
  }
  /* Tema claro: solo lo que cambia respecto de la base */
  .p-public-root.p-public-theme-light .cl-hero { box-shadow:0 12px 28px var(--border); }
  .p-public-root.p-public-theme-light .cl-hero-bg { background:linear-gradient(135deg,var(--surface-1) 0%,var(--surface-2) 52%,var(--surface-3) 100%); }
  .p-public-root.p-public-theme-light .cl-hero-overlay { background:var(--hero-image-overlay-soft); }
  .p-public-root.p-public-theme-light .cl-logo { border-color:var(--border-strong); }
  .p-public-root.p-public-theme-light .cl-icon-btn { background:var(--surface-1); box-shadow:0 4px 12px var(--border-subtle); }
  .p-public-root.p-public-theme-light .cl-icon-btn:hover:not(:disabled) { background:var(--surface-2); }
  .p-public-root.p-public-theme-light .cl-panel,
  .p-public-root.p-public-theme-light .cl-skel-panel { box-shadow:0 10px 24px var(--border-subtle); }
  .p-public-root.p-public-theme-light .cl-feedback { color:var(--positive-fg); }
  .p-public-root.p-public-theme-light .cl-review-textarea { background:var(--surface-1); }
`;

export default function ClubPage({ appSlug, appName }: ClubPageProps) {
  const router = useRouter();
  const { slug } = router.query;
  const { authChecked, user } = useValidateAuth({ allowGuest: true });
  const [club, setClub] = useState<Club | null>(() => readCachedClub(slug));
  const [loadingClub, setLoadingClub] = useState(() => !readCachedClub(slug));
  const [error, setError] = useState<string | null>(null);
  const [reviewsSummary, setReviewsSummary] = useState<{ count: number; averageRating: number }>({ count: 0, averageRating: 0 });
  const [reviews, setReviews] = useState<ClubReviewItem[]>([]);
  const [canReviewClub, setCanReviewClub] = useState(false);
  const [hasExistingClubReview, setHasExistingClubReview] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);
  // App instalada de este club: inicio simplificado y reserva a pantalla completa.
  const clubApp = useClubApp();
  const isClubAppMode = Boolean(clubApp && clubApp.slug === slug);

  useEffect(() => {
    const loadClub = async () => {
      if (!slug || typeof slug !== 'string') { setLoadingClub(false); return; }
      const cached = clubPageCache.get(slug);
      try {
        if (cached) {
          setClub(cached);
          setLoadingClub(false);
        } else {
          setLoadingClub(true);
        }
        setError(null);
        const fresh = await ClubService.getClubBySlug(slug);
        clubPageCache.set(slug, fresh);
        setClub(fresh);
      } catch (err: any) {
        reportUiError({ area: 'ClubPage', action: 'loadClubBySlug' }, err);
        if (!cached) setError('Club no encontrado');
      } finally {
        setLoadingClub(false);
      }
    };
    loadClub();
  }, [slug]);

  useEffect(() => {
    if (!club || typeof slug !== 'string') return;
    updateClubAppIdentity({ slug, name: club.name, logoUrl: club.logoUrl || null });
  }, [club, slug]);

  const loadReviews = useCallback(async (clubSlug: string) => {
    try {
      const [summary, list] = await Promise.all([
        getClubReviewsSummary(clubSlug),
        listClubReviews(clubSlug, { take: REVIEWS_SHOWN })
      ]);
      setReviewsSummary({ count: Number(summary?.count || 0), averageRating: Number(summary?.averageRating || 0) });
      setReviews(Array.isArray(list?.items) ? list.items : []);
    } catch (err) {
      reportUiError({ area: 'ClubPage', action: 'loadClubReviews' }, err);
      setReviewsSummary({ count: 0, averageRating: 0 });
      setReviews([]);
    }
  }, []);

  useEffect(() => {
    if (!slug || typeof slug !== 'string') return;
    void loadReviews(slug);
  }, [loadReviews, slug]);

  useEffect(() => {
    const loadReviewEligibility = async () => {
      if (!authChecked || !slug || typeof slug !== 'string' || !user?.id) {
        setCanReviewClub(false); setHasExistingClubReview(false); return;
      }
      try {
        const [myBookings, existing] = await Promise.all([
          getMyBookings(user.id),
          getMyReviewForClub(slug).catch(() => null)
        ]);
        const now = Date.now();
        const eligibleInClub = Array.isArray(myBookings)
          ? myBookings.filter((b: any) => {
            const clubSlug = String(b?.club?.slug || '').trim();
            if (clubSlug !== slug) return false;
            const status = String(b?.status || '').toUpperCase();
            const endTime = new Date(b?.endDateTime || b?.startDateTime || '').getTime();
            if (!Number.isFinite(endTime) || endTime > now) return false;
            return status === 'COMPLETED';
          })
          : [];
        setCanReviewClub(eligibleInClub.length > 0);
        setHasExistingClubReview(Boolean(existing));
      } catch (err) {
        if (isAuthSessionInvalidatedError(err)) return;
        reportUiError({ area: 'ClubPage', action: 'loadReviewEligibility' }, err);
        setCanReviewClub(false); setHasExistingClubReview(false);
      }
    };
    void loadReviewEligibility();
  }, [authChecked, slug, user?.id]);

  useEffect(() => {
    const loadFavoriteState = async () => {
      if (!authChecked || !user?.id || !club?.id) { setIsFavorite(false); return; }
      try {
        const favorites = await ClubService.getMyFavorites();
        const clubId = Number(club.id);
        setIsFavorite(Array.isArray(favorites) && favorites.some((item: any) => Number(item?.clubId) === clubId));
      } catch (err) {
        if (isAuthSessionInvalidatedError(err)) return;
        setIsFavorite(false);
      }
    };
    void loadFavoriteState();
  }, [authChecked, user?.id, club?.id]);

  useEffect(() => {
    if (!reviewModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !reviewSaving) setReviewModalOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [reviewModalOpen, reviewSaving]);

  useEffect(() => {
    if (!reviewFeedback) return;
    const timer = window.setTimeout(() => setReviewFeedback(null), 3500);
    return () => window.clearTimeout(timer);
  }, [reviewFeedback]);

  const showAppNotice = useCallback((message: string, tone: AppNoticeTone = 'info') => {
    if (typeof window === 'undefined') return;
    const safe = String(message || '').trim();
    if (!safe) return;
    window.dispatchEvent(new CustomEvent(APP_NOTICE_EVENT, { detail: { message: safe, tone } }));
  }, []);

  // En el celular abre el menú nativo para compartir; si no está disponible, copia el enlace.
  const handleShare = async () => {
    if (typeof window === 'undefined') return;
    const url = window.location.href.split('?')[0];
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: club?.name || 'Pique', url });
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showAppNotice('Enlace copiado.', 'success');
    } catch (err) { reportUiError({ area: 'ClubPage', action: 'copyShareLink' }, err); }
  };

  const handleToggleFavorite = async () => {
    if (!club?.id || favoriteBusy) return;
    if (!user?.id) { showAppNotice('Iniciá sesión para guardar favoritos.', 'info'); return; }
    const clubId = Number(club.id);
    if (!Number.isFinite(clubId) || clubId <= 0) return;
    setFavoriteBusy(true);
    try {
      if (isFavorite) {
        await ClubService.unmarkFavorite(clubId);
        setIsFavorite(false);
        showAppNotice('Club eliminado de favoritos.', 'success');
      } else {
        await ClubService.markFavorite(clubId);
        setIsFavorite(true);
        showAppNotice('Club agregado a favoritos.', 'success');
      }
    } catch (err) {
      reportUiError({ area: 'ClubPage', action: 'toggleFavorite' }, err);
      showAppNotice('No pudimos actualizar tus favoritos. Intentá nuevamente.', 'error');
    } finally { setFavoriteBusy(false); }
  };

  const handleOpenReviewModal = async () => {
    if (!slug || typeof slug !== 'string') return;
    if (!canReviewClub && !hasExistingClubReview) return;
    setReviewModalOpen(true);
    setReviewLoading(true);
    setReviewFeedback(null);
    try {
      const existing = await getMyReviewForClub(slug);
      if (existing) {
        setReviewRating(Number(existing.rating || 5));
        setReviewComment(String(existing.comment || ''));
      } else {
        setReviewRating(5);
        setReviewComment('');
      }
    } catch (err) {
      reportUiError({ area: 'ClubPage', action: 'loadMyClubReview' }, err);
      setReviewRating(5);
      setReviewComment('');
    } finally {
      setReviewLoading(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!slug || typeof slug !== 'string') return;
    try {
      setReviewSaving(true);
      await upsertMyClubReview(slug, {
        rating: reviewRating,
        comment: reviewComment.trim() || null
      });
      setReviewModalOpen(false);
      setHasExistingClubReview(true);
      setReviewFeedback('Reseña guardada.');
      await loadReviews(slug);
    } catch (err: any) {
      reportUiError({ area: 'ClubPage', action: 'saveMyClubReview' }, err);
      setReviewFeedback(extractErrorMessage(err, 'No se pudo guardar la reseña.'));
    } finally {
      setReviewSaving(false);
    }
  };

  const slugReady = router.isReady && slug && typeof slug === 'string';
  const stillLoading = !slugReady || loadingClub;
  const pageTitle = club?.name ? `${club.name} | Pique` : 'Club | Pique';
  const clubBreadcrumbs = [
    { label: 'Inicio', href: '/' },
    { label: 'Complejos', href: '/complejos' },
    { label: club?.name || 'Club' },
  ];

  // Manifest propio del club: el acceso directo abre esta página y se instala con su nombre e ícono.
  // Solo depende de datos del servidor (slug y nombre) para que esté igual desde la primera carga.
  const headSlug = appSlug || (typeof slug === 'string' ? slug : '');
  const headName = appName || club?.name || '';
  const clubAppHead = headSlug ? (
    <Head>
      <link rel="manifest" href={clubManifestHref(headSlug, headName)} key="manifest" />
      <link rel="apple-touch-icon" href={clubIconHref(headSlug, headName, 180)} key="apple-touch-icon" />
      <meta name="apple-mobile-web-app-capable" content="yes" key="apple-capable" />
      <meta name="mobile-web-app-capable" content="yes" key="mobile-capable" />
      {headName ? <meta name="apple-mobile-web-app-title" content={headName} key="apple-title" /> : null}
    </Head>
  ) : null;

  // ── LOADING STATE ── (la app del club conserva su pantalla de carga propia)
  if (stillLoading) {
    return (
      <DarkPageLayout title={pageTitle} extraCss={PAGE_CSS} breadcrumbs={isClubAppMode ? undefined : clubBreadcrumbs}>
        {clubAppHead}
        {isClubAppMode ? (
          <UserLoadingState mode="block" minHeight="60vh" message="Cargando club..." />
        ) : (
          <div className="p-public-page cl-page" role="status" aria-label="Cargando club">
            <Skeleton className="cl-skel-hero" />
            <div className="cl-grid">
              <div className="cl-skel-panel">
                <Skeleton variant="line" width="40%" height={18} />
                <div className="cl-skel-row">
                  <Skeleton height={46} radius={12} />
                  <Skeleton height={46} radius={12} />
                  <Skeleton height={46} radius={12} />
                </div>
                <div className="cl-skel-slots">
                  {Array.from({ length: 10 }, (_, index) => <Skeleton key={index} height={38} radius={12} />)}
                </div>
                <Skeleton height={48} radius={16} />
              </div>
              <div className="cl-sidebar">
                <div className="cl-panel"><SkeletonText lines={4} /></div>
              </div>
            </div>
          </div>
        )}
      </DarkPageLayout>
    );
  }

  // ── ERROR STATE ──
  if (error || !club) {
    return (
      <DarkPageLayout title="Club no encontrado | Pique" extraCss={PAGE_CSS} breadcrumbs={clubBreadcrumbs}>
        {clubAppHead}
        <div className="p-public-page cl-page">
          <div className="cl-state">
            <span className="cl-state-icon" aria-hidden="true"><SearchX size={24} /></span>
            <h1 className="cl-state-title">No encontramos este club</h1>
            <p className="cl-state-copy">Puede que el enlace esté mal escrito o que el club ya no esté en Pique.</p>
            <Link href="/complejos" className="cl-state-btn">Ver complejos</Link>
          </div>
        </div>
      </DarkPageLayout>
    );
  }

  if (isClubAppMode) {
    const loginHref = `/login?from=${encodeURIComponent(router.asPath || `/club/${slug}`)}`;
    return (
      <DarkPageLayout title={pageTitle} extraCss={PAGE_CSS}>
        {clubAppHead}
        {router.query.view === 'reservar' ? (
          <div style={{ maxWidth: 760, width: '100%', margin: '0 auto', padding: '20px 12px 12px' }}>
            <BookingGrid clubSlug={slug as string} variant="clubApp" />
          </div>
        ) : (
          <ClubAppHome club={club} slug={slug as string} user={user as any} loginHref={loginHref} />
        )}
      </DarkPageLayout>
    );
  }

  const clubArea = formatClubArea(club);
  const fullAddress = formatClubAddress(club);
  const instagram = club.instagramUrl ? instagramLink(club.instagramUrl) : null;
  const facebook = club.facebookUrl ? externalLink(club.facebookUrl, 'Facebook') : null;
  const website = club.websiteUrl ? externalLink(club.websiteUrl, 'Sitio web') : null;
  const openingDays = Array.isArray(club.openingDays) ? club.openingDays : [];
  const canWriteReview = canReviewClub || hasExistingClubReview;
  const showReviewsPanel = reviewsSummary.count > 0 || canWriteReview;
  const roundedRating = Math.round(reviewsSummary.averageRating);

  return (
    <DarkPageLayout title={pageTitle} extraCss={PAGE_CSS} breadcrumbs={clubBreadcrumbs}>
      {clubAppHead}
      <div className="p-public-page cl-page">

        {/* ── HERO ── */}
        <div className="cl-hero">
          <div className="cl-hero-bg" />
          {club.clubImageUrl && (
            <>
              <Image
                src={club.clubImageUrl}
                alt=""
                fill
                priority
                sizes="(max-width: 1360px) 100vw, 1360px"
                className="cl-hero-img"
                unoptimized={!isLocalAsset(club.clubImageUrl)}
              />
              <div className="cl-hero-overlay" />
            </>
          )}

          <div className="cl-hero-body">
            <div className="cl-logo">
              {club.logoUrl ? (
                <Image
                  src={club.logoUrl}
                  alt={`Logo de ${club.name}`}
                  fill
                  sizes="100px"
                  style={{ objectFit: 'contain' }}
                  unoptimized={!isLocalAsset(club.logoUrl)}
                />
              ) : (
                <Trophy size={28} style={{ color: 'var(--text-muted)' }} />
              )}
            </div>

            <div className="cl-hero-info">
              {reviewsSummary.count > 0 && (
                <div className="cl-hero-rating">
                  <Star size={13} style={{ color: 'var(--accent-fg)', fill: 'var(--accent-fg)' }} />
                  <b>{formatRatingLabel(reviewsSummary.averageRating)}</b>
                  <span>({formatReviewCount(reviewsSummary.count)})</span>
                </div>
              )}
              <h1 className="cl-hero-h">{club.name}</h1>
              <div className="cl-hero-meta">
                {clubArea && (
                  <span className="cl-hero-meta-item">
                    <MapPin size={14} />
                    {clubArea}
                  </span>
                )}
                {fullAddress && (
                  <a href={directionsUrl(club)} target="_blank" rel="noopener noreferrer" className="cl-directions">
                    <Navigation size={13} />
                    Cómo llegar
                  </a>
                )}
              </div>
            </div>

            <div className="cl-hero-actions">
              <button
                type="button"
                className={`cl-icon-btn${isFavorite ? ' cl-fav-on' : ''}`}
                onClick={handleToggleFavorite}
                disabled={favoriteBusy}
                title={isFavorite ? 'Quitar de favoritos' : 'Guardar en favoritos'}
                aria-label={isFavorite ? 'Quitar de favoritos' : 'Guardar en favoritos'}
                aria-pressed={isFavorite}
              >
                <Heart size={20} />
              </button>
              <button type="button" className="cl-icon-btn" onClick={handleShare} title="Compartir" aria-label="Compartir">
                <Share2 size={20} />
              </button>
              <ClubInstallButton clubName={club.name} logoUrl={club.logoUrl || null} />
            </div>
          </div>
        </div>

        {/* ── MAIN GRID ── */}
        <div className="cl-grid">

          <BookingGrid clubSlug={slug} />

          <div className="cl-sidebar">

            {/* Información: un solo panel con todo lo de contacto */}
            <section className="cl-panel" aria-labelledby="club-info-title">
              <h2 id="club-info-title" className="cl-panel-h">Información</h2>
              {club.description && <p className="cl-panel-description">{club.description}</p>}
              <div className="cl-panel-rows">
                {fullAddress && (
                  <a href={directionsUrl(club)} target="_blank" rel="noopener noreferrer" className="cl-panel-row">
                    <MapPin size={14} className="cl-panel-icon" />
                    <span>{fullAddress}</span>
                  </a>
                )}
                {club.phone && (
                  <a href={`tel:${club.phone.replace(/\s+/g, '')}`} className="cl-panel-row">
                    <Phone size={14} className="cl-panel-icon" />
                    <span>{club.phone}</span>
                  </a>
                )}
                {openingDays.length > 0 && (
                  <div className="cl-panel-row">
                    <Clock size={14} className="cl-panel-icon" />
                    <div className="cl-hours" aria-label="Horario">
                      {buildScheduleLines(openingDays, club.openingHours).map((line) => (
                        <div key={line.label} className={`cl-hours-row${line.closed ? ' is-closed' : ''}`}>
                          <span className="cl-hours-day">{line.label}</span>
                          <span className="cl-hours-time">{line.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {instagram && (
                  <a href={instagram.href} target="_blank" rel="noopener noreferrer" className="cl-panel-row">
                    <Instagram size={14} className="cl-panel-icon" />
                    <span>{instagram.label}</span>
                  </a>
                )}
                {facebook && (
                  <a href={facebook.href} target="_blank" rel="noopener noreferrer" className="cl-panel-row">
                    <Facebook size={14} className="cl-panel-icon" />
                    <span>{facebook.label}</span>
                  </a>
                )}
                {website && (
                  <a href={website.href} target="_blank" rel="noopener noreferrer" className="cl-panel-row">
                    <Globe size={14} className="cl-panel-icon" />
                    <span>{website.label}</span>
                  </a>
                )}
              </div>
            </section>

            {/* Reseñas: lo que opinan y, si podés, el acceso a dejar la tuya */}
            {showReviewsPanel && (
              <section className="cl-panel" aria-labelledby="club-reviews-title">
                <h2 id="club-reviews-title" className="cl-panel-h">Reseñas</h2>
                {reviewsSummary.count > 0 ? (
                  <>
                    <div className="cl-rating-sum">
                      <div>
                        <div className="cl-rating-big">{formatRatingLabel(reviewsSummary.averageRating)}</div>
                        <div className="cl-rating-sub">de 5 · {formatReviewCount(reviewsSummary.count)}</div>
                      </div>
                      <div className="cl-stars" aria-hidden="true">
                        {[1, 2, 3, 4, 5].map(v => (
                          <Star
                            key={v}
                            size={14}
                            style={{ color: v <= roundedRating ? 'var(--accent-fg)' : 'var(--border-strong)', fill: v <= roundedRating ? 'var(--accent-fg)' : 'none' }}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="cl-reviews">
                      {reviews.slice(0, REVIEWS_SHOWN).map(review => (
                        <div key={review.id} className="cl-review-card">
                          <div className="cl-review-head">
                            <span className="cl-review-name">{review.user.name}</span>
                            <span className="cl-review-score">
                              <Star size={11} style={{ fill: 'var(--accent-fg)' }} />
                              {formatRatingLabel(Number(review.rating || 0))}
                            </span>
                          </div>
                          {review.comment
                            ? <p className="cl-review-comment">{review.comment}</p>
                            : <p className="cl-review-comment is-empty">Sin comentario</p>}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="cl-review-empty">Todavía no hay reseñas. Contá cómo te fue y ayudá a otros a elegir.</p>
                )}
                {canWriteReview && (
                  <button
                    type="button"
                    className="cl-review-cta"
                    onClick={handleOpenReviewModal}
                    disabled={reviewLoading || reviewSaving}
                  >
                    <Star size={14} />
                    {hasExistingClubReview ? 'Editar mi reseña' : 'Dejar mi reseña'}
                  </button>
                )}
                {reviewFeedback && <div className="cl-feedback" role="status">{reviewFeedback}</div>}
              </section>
            )}

          </div>
        </div>
      </div>

      <Modal
        open={reviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        title={`Tu reseña de ${club.name}`}
        subtitle="Una reseña por club. Podés editarla cuando quieras."
        closeDisabled={reviewSaving}
        maxWidth={480}
        footer={reviewLoading ? undefined : (
          <>
            <button type="button" className="p-modal-btn p-modal-btn-wide" onClick={() => setReviewModalOpen(false)} disabled={reviewSaving}>
              Cancelar
            </button>
            <button type="button" className="p-modal-btn p-modal-btn-primary p-modal-btn-wide" onClick={handleSubmitReview} disabled={reviewSaving || reviewRating < 1}>
              <BusyLabel busy={reviewSaving}>Guardar</BusyLabel>
            </button>
          </>
        )}
      >
        {reviewLoading ? (
          <UserLoadingState mode="block" minHeight={180} message="Cargando tu reseña..." />
        ) : (
          <>
            <div className="cl-review-stars" role="group" aria-label="Calificación">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`cl-review-star${reviewRating >= value ? ' cl-star-on' : ''}`}
                  onClick={() => setReviewRating(value)}
                  disabled={reviewSaving}
                  aria-label={`${value} ${value === 1 ? 'estrella' : 'estrellas'}`}
                  aria-pressed={reviewRating === value}
                >
                  <Star size={20} style={{ fill: reviewRating >= value ? 'currentColor' : 'none' }} />
                </button>
              ))}
            </div>
            <div style={{ marginTop: 18 }}>
              <textarea
                className="cl-review-textarea"
                rows={5}
                maxLength={220}
                value={reviewComment}
                onChange={(event) => setReviewComment(event.target.value)}
                placeholder="Contá cómo fue tu experiencia..."
                aria-label="Comentario"
                disabled={reviewSaving}
              />
              <div className="cl-review-count">{reviewComment.length}/220</div>
            </div>
            {reviewFeedback && <div className="cl-feedback">{reviewFeedback}</div>}
          </>
        )}
      </Modal>
    </DarkPageLayout>
  );
}
