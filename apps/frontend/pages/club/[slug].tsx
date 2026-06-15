import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
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
import { MapPin, Calendar, Phone, Instagram, Share2, Trophy, Star, Heart, ChevronRight, X } from 'lucide-react';

const APP_NOTICE_EVENT = 'app:notice';
type AppNoticeTone = 'success' | 'error' | 'info' | 'warning';

const formatClubAddress = (club: Club) =>
  [club.addressLine, club.city, club.province, club.country].filter(Boolean).join(', ');

const formatRatingLabel = (value: number) => {
  const safe = Number(value || 0);
  if (!Number.isFinite(safe)) return '0';
  return Number.isInteger(safe) ? String(safe) : safe.toFixed(1);
};

const PAGE_CSS = `
  .cl-hero { position:relative; border-radius:24px; overflow:hidden; border:1px solid var(--border); margin-bottom:32px; }
  .cl-hero-bg { position:absolute; inset:0; background:linear-gradient(135deg,var(--brand-on) 0%,var(--ink-900) 50%,var(--positive-bg) 100%); }
  .cl-hero-img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .cl-hero-overlay { position:absolute; inset:0; background:var(--hero-image-overlay); }
  .cl-hero-body { position:relative; z-index:2; padding:36px 40px 32px; display:flex; align-items:flex-end; gap:28px; flex-wrap:wrap; }
  .cl-logo-wrap { position:relative; flex-shrink:0; }
  .cl-logo { position:relative; width:100px; height:100px; border-radius:20px; background:var(--surface-1); border:2px solid var(--border); overflow:hidden; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .cl-hero-info { flex:1; min-width:0; }
  .cl-hero-rating { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:var(--text-secondary); margin-bottom:10px; }
  .cl-hero-h { font-size:clamp(28px,4vw,52px); font-weight:800; color:var(--text-primary); letter-spacing:-.04em; line-height:1; margin:0 0 12px; }
  .cl-hero-h i { font-style:italic; color:var(--accent-fg); }
  .cl-hero-meta { display:flex; flex-wrap:wrap; gap:16px; align-items:center; }
  .cl-hero-meta-item { display:flex; align-items:center; gap:6px; font-size:13px; color:var(--text-secondary); font-weight:500; }
  .cl-hero-actions { display:flex; gap:10px; flex-shrink:0; }
  .cl-icon-btn { width:44px; height:44px; border-radius:14px; border:1px solid var(--border); background:var(--surface-2); display:flex; align-items:center; justify-content:center; cursor:pointer; transition:background .15s,border-color .15s,transform .15s; color:var(--text-secondary); }
  .cl-icon-btn:hover:not(:disabled) { background:var(--surface-3); border-color:var(--border-strong); transform:translateY(-1px); }
  .cl-icon-btn.cl-fav-on { background:var(--positive-bg); border-color:var(--accent-border); color:var(--accent-fg); }
  .cl-icon-btn:disabled { opacity:.5; cursor:not-allowed; }
  /* Grid */
  .cl-grid { display:grid; grid-template-columns:minmax(0,2fr) minmax(0,1fr); gap:24px; align-items:start; }
  .cl-grid > * { min-width:0; }
  .cl-sidebar { display:flex; flex-direction:column; gap:16px; min-width:0; }
  /* Sidebar panels */
  .cl-panel { background:var(--surface-1); border:1px solid var(--border); border-radius:18px; padding:22px 24px; }
  .cl-panel-h { font-size:11px; font-weight:700; letter-spacing:.04em; color:var(--text-muted); margin-bottom:16px; }
  .cl-panel-description { font-size:13px; color:var(--text-secondary); line-height:1.6; margin:0 0 12px; padding-bottom:12px; border-bottom:1px solid var(--border); }
  .cl-panel-row { display:flex; align-items:flex-start; gap:10px; font-size:13px; color:var(--text-secondary); font-weight:500; line-height:1.5; padding:8px 0; border-bottom:1px solid var(--border-subtle); }
  .cl-panel-row:last-child { border-bottom:none; }
  .cl-panel-row a { color:var(--text-secondary); text-decoration:none; transition:color .15s; }
  .cl-panel-row a:hover { color:var(--accent-fg); }
  .cl-panel-icon { color:var(--text-muted); flex-shrink:0; margin-top:1px; }
  .cl-day-chip { padding:3px 8px; background:var(--positive-bg); border:1px solid var(--accent-border-subtle); border-radius:6px; font-size:10px; font-weight:800; color:var(--accent-fg); }
  /* Reviews */
  .cl-review-card { background:var(--surface-2); border:1px solid var(--border-subtle); border-radius:14px; padding:14px 16px; }
  .cl-review-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
  .cl-review-name { font-size:12px; font-weight:800; color:var(--text-primary); letter-spacing:.01em; }
  .cl-review-score { display:flex; align-items:center; gap:4px; font-size:12px; font-weight:800; color:var(--accent-fg); }
  .cl-review-comment { font-size:13px; color:var(--text-muted); line-height:1.55; }
  .cl-review-overlay { position:fixed; inset:0; z-index:200; display:flex; align-items:center; justify-content:center; padding:20px; background:var(--overlay); }
  .cl-review-panel { width:100%; max-width:480px; border-radius:24px; border:1px solid var(--border); background:var(--surface-1); padding:30px; box-shadow:var(--shadow-lg); }
  .cl-review-modal-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:8px; }
  .cl-review-modal-title { font-size:20px; font-weight:800; color:var(--text-primary); letter-spacing:-.02em; }
  .cl-review-modal-sub { font-size:13px; color:var(--text-muted); margin-bottom:22px; line-height:1.45; }
  .cl-review-stars { display:flex; gap:8px; }
  .cl-review-star { width:40px; height:40px; border-radius:12px; border:1px solid var(--border); background:var(--surface-2); color:var(--text-muted); display:flex; align-items:center; justify-content:center; cursor:pointer; transition:background .15s,border-color .15s,color .15s; }
  .cl-review-star.cl-star-on { background:var(--positive-bg); border-color:var(--accent-border); color:var(--accent-fg); }
  .cl-review-textarea { width:100%; background:var(--surface-2); border:1px solid var(--border); border-radius:14px; padding:14px 16px; color:var(--text-primary); font-family:var(--font-sans); font-size:14px; outline:none; resize:none; transition:border-color .2s; }
  .cl-review-textarea:focus { border-color:var(--accent-border); }
  .cl-review-action-row { display:flex; gap:10px; margin-top:24px; }
  .cl-review-secondary { flex:1; height:46px; border-radius:12px; background:none; border:1px solid var(--border); color:var(--text-muted); font-family:inherit; font-size:12px; font-weight:700; letter-spacing:.01em; cursor:pointer; }
  .cl-review-primary { flex:1; height:46px; border-radius:12px; background:var(--brand); border:none; color:var(--brand-on); font-family:inherit; font-size:12px; font-weight:800; letter-spacing:.01em; cursor:pointer; }
  .cl-review-primary:disabled { opacity:.5; cursor:not-allowed; }
  /* Feedback toast */
  .cl-feedback { padding:10px 16px; border-radius:12px; background:var(--positive-bg); border:1px solid var(--accent-border-subtle); font-size:12px; font-weight:700; color:var(--brand-hover); margin-top:12px; }
  /* Loading/error */
  .cl-loading { min-height:60vh; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:16px; }
  @media(max-width:900px){
    .cl-grid { grid-template-columns:1fr; }
    .cl-hero-body { padding:24px 24px 20px; }
    .cl-hero-h { font-size:28px; }
  }
  @media(max-width:600px){
    .cl-page { padding-top:24px !important; padding-inline:24px !important; }
    .cl-hero-body { flex-direction:column; align-items:flex-start; gap:16px; }
    .cl-hero-actions { align-self:flex-end; }
    .cl-grid { gap:20px; }
    .cl-sidebar { gap:14px; }
    .cl-panel { padding:20px; }
  }
  .p-public-root.p-public-theme-light .cl-hero { border-color:var(--border); box-shadow:0 12px 28px var(--border); }
  .p-public-root.p-public-theme-light .cl-hero-bg { background:linear-gradient(135deg,var(--surface-1) 0%,var(--surface-2) 52%,var(--surface-3) 100%); }
  .p-public-root.p-public-theme-light .cl-hero-overlay { background:var(--hero-image-overlay-soft); }
  .p-public-root.p-public-theme-light .cl-logo { background:var(--surface-1); border-color:var(--border-strong); }
  .p-public-root.p-public-theme-light .cl-hero-rating,
  .p-public-root.p-public-theme-light .cl-hero-meta-item { color:var(--text-secondary); }
  .p-public-root.p-public-theme-light .cl-hero-h { color:var(--text-primary); }
  .p-public-root.p-public-theme-light .cl-icon-btn { background:var(--surface-1); border-color:var(--border); color:var(--text-secondary); box-shadow:0 4px 12px var(--border-subtle); }
  .p-public-root.p-public-theme-light .cl-icon-btn:hover:not(:disabled) { background:var(--surface-2); border-color:var(--border-strong); }
  .p-public-root.p-public-theme-light .cl-panel { background:var(--surface-1); border-color:var(--border); box-shadow:0 10px 24px var(--border-subtle); }
  .p-public-root.p-public-theme-light .cl-panel-icon,
  .p-public-root.p-public-theme-light .cl-review-modal-sub { color:var(--text-muted); }
  .p-public-root.p-public-theme-light .cl-panel-h { color:var(--text-muted); }
  .p-public-root.p-public-theme-light .cl-panel-description { color:var(--text-secondary); border-bottom-color:var(--border); }
  .p-public-root.p-public-theme-light .cl-panel-row { color:var(--text-secondary); border-bottom-color:var(--border-subtle); }
  .p-public-root.p-public-theme-light .cl-panel-row a { color:var(--text-primary); }
  .p-public-root.p-public-theme-light .cl-review-card { background:var(--surface-2); border-color:var(--border-subtle); }
  .p-public-root.p-public-theme-light .cl-review-name { color:var(--text-primary); }
  .p-public-root.p-public-theme-light .cl-review-comment { color:var(--text-secondary); }
  .p-public-root.p-public-theme-light .cl-feedback { background:var(--positive-bg); border-color:var(--accent-border-subtle); color:var(--positive-fg); }
  .p-public-root.p-public-theme-light .cl-review-overlay { background:var(--overlay-strong); }
  .p-public-root.p-public-theme-light .cl-review-panel { background:var(--surface-1); border-color:var(--border); box-shadow:0 22px 46px var(--border-strong); }
  .p-public-root.p-public-theme-light .cl-review-modal-title { color:var(--text-primary); }
  .p-public-root.p-public-theme-light .cl-review-star { border-color:var(--border); background:var(--surface-2); color:var(--text-muted); }
  .p-public-root.p-public-theme-light .cl-review-textarea { background:var(--surface-1); border-color:var(--border); color:var(--text-primary); }
  .p-public-root.p-public-theme-light .cl-review-secondary { border-color:var(--border); color:var(--text-secondary); }
  .cl-login-btn { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; margin-top:14px; padding:11px 16px; background:var(--brand); border:1px solid var(--accent-border); border-radius:12px; color:var(--brand-on); font-size:12px; font-weight:800; letter-spacing:.01em; cursor:pointer; font-family:var(--font-sans); transition:background .15s,border-color .15s,color .15s; }
  .cl-login-btn:hover { background:var(--brand-hover); border-color:var(--accent-border-strong); color:var(--brand-on); }
  .p-public-root.p-public-theme-light .cl-login-btn { background:var(--brand); border-color:var(--accent-border); color:var(--brand-on); }
  .p-public-root.p-public-theme-light .cl-login-btn:hover { background:var(--brand-hover); border-color:var(--accent-border-strong); color:var(--brand-on); }
`;

export default function ClubPage() {
  const router = useRouter();
  const { slug } = router.query;
  const { authChecked, user } = useValidateAuth({ allowGuest: true });
  const [club, setClub] = useState<Club | null>(null);
  const [loadingClub, setLoadingClub] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewsSummary, setReviewsSummary] = useState<{ count: number; averageRating: number }>({ count: 0, averageRating: 0 });
  const [reviews, setReviews] = useState<ClubReviewItem[]>([]);
  const [reviewCtaLoading, setReviewCtaLoading] = useState(false);
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
  const reviewBackdropMouseDownRef = useRef(false);

  useEffect(() => {
    const loadClub = async () => {
      if (!slug || typeof slug !== 'string') { setLoadingClub(false); return; }
      try {
        setLoadingClub(true);
        setError(null);
        setClub(await ClubService.getClubBySlug(slug));
      } catch (err: any) {
        reportUiError({ area: 'ClubPage', action: 'loadClubBySlug' }, err);
        setError('Club no encontrado');
      } finally {
        setLoadingClub(false);
      }
    };
    loadClub();
  }, [slug]);

  const loadReviews = useCallback(async (clubSlug: string) => {
    try {
      const [summary, list] = await Promise.all([
        getClubReviewsSummary(clubSlug),
        listClubReviews(clubSlug, { take: 6 })
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
        setReviewCtaLoading(true);
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
        if (eligibleInClub.length === 0) {
          setCanReviewClub(false);
          setHasExistingClubReview(Boolean(existing));
          return;
        }
        setCanReviewClub(true);
        setHasExistingClubReview(Boolean(existing));
      } catch (err) {
        if (isAuthSessionInvalidatedError(err)) return;
        reportUiError({ area: 'ClubPage', action: 'loadReviewEligibility' }, err);
        setCanReviewClub(false); setHasExistingClubReview(false);
      } finally { setReviewCtaLoading(false); }
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

  const handleShare = async () => {
    if (typeof window === 'undefined') return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      window.dispatchEvent(new CustomEvent(APP_NOTICE_EVENT, { detail: { message: 'Enlace copiado.', tone: 'success' } }));
    } catch (err) { reportUiError({ area: 'ClubPage', action: 'copyShareLink' }, err); }
  };

  const showAppNotice = useCallback((message: string, tone: AppNoticeTone = 'info') => {
    if (typeof window === 'undefined') return;
    const safe = String(message || '').trim();
    if (!safe) return;
    window.dispatchEvent(new CustomEvent(APP_NOTICE_EVENT, { detail: { message: safe, tone } }));
  }, []);


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
    if (!user?.id) {
      void router.push(`/login?from=${encodeURIComponent(router.asPath || `/club/${slug}`)}`);
      return;
    }
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

  // ── LOADING STATE ──
  if (stillLoading) {
    return (
      <DarkPageLayout title={pageTitle} extraCss={PAGE_CSS} breadcrumbs={clubBreadcrumbs}>
        <div className="cl-loading">
          <UserLoadingState mode="inline" message="Cargando club..." />
        </div>
      </DarkPageLayout>
    );
  }

  // ── ERROR STATE ──
  if (error || !club) {
    return (
      <DarkPageLayout title={pageTitle} extraCss={PAGE_CSS} breadcrumbs={clubBreadcrumbs}>
        <div className="cl-loading" style={{ textAlign: 'center', gap: 20 }}>
          <div style={{ fontSize: 48, color: 'var(--text-muted)' }}>⚽</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>Club no encontrado</div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24 }}>{error || 'El club solicitado no existe'}</div>
            <button
              onClick={() => router.push('/')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 24px', background: 'var(--brand)', color: 'var(--brand-on)', border: 'none', borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Volver al inicio
            </button>
          </div>
        </div>
      </DarkPageLayout>
    );
  }

  const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  return (
    <DarkPageLayout title={pageTitle} extraCss={PAGE_CSS} breadcrumbs={clubBreadcrumbs}>
      <div className="p-public-page cl-page" style={{ paddingTop: 32 }}>

        {/* ── HERO ── */}
        <div className="cl-hero">
          {/* Background */}
          <div className="cl-hero-bg" />
          {club.clubImageUrl && (
            <>
              <Image
                src={club.clubImageUrl}
                alt={`Banner de ${club.name}`}
                fill
                sizes="100vw"
                className="cl-hero-img"
                unoptimized
              />
              <div className="cl-hero-overlay" />
            </>
          )}

          {/* Body */}
          <div className="cl-hero-body">

            {/* Logo */}
            <div className="cl-logo-wrap">
              <div className="cl-logo">
                {club.logoUrl ? (
                  <Image src={club.logoUrl} alt={club.name} fill sizes="100px" style={{ objectFit: 'contain' }} unoptimized />
                ) : (
                  <Trophy size={32} style={{ color: 'var(--text-muted)' }} />
                )}
              </div>
            </div>

            {/* Info */}
            <div className="cl-hero-info">
              {reviewsSummary.count > 0 && (
                <div className="cl-hero-rating">
                  <Star size={13} style={{ color: 'var(--brand)', fill: 'var(--brand)' }} />
                  <span style={{ color: 'var(--brand)', fontWeight: 800 }}>{formatRatingLabel(reviewsSummary.averageRating)}</span>
                  <span style={{ color: 'var(--text-muted)' }}>({reviewsSummary.count} reseñas)</span>
                </div>
              )}
              <h1 className="cl-hero-h">{club.name}</h1>
              <div className="cl-hero-meta">
                {(club.addressLine || club.city) && (
                  <span className="cl-hero-meta-item">
                    <MapPin size={14} style={{ color: 'var(--brand)', flexShrink: 0 }} />
                    {[club.addressLine, club.city].filter(Boolean).join(', ')}
                  </span>
                )}
                {club.instagramUrl && (
                  <a
                    href={club.instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cl-hero-meta-item"
                    style={{ textDecoration: 'none', transition: 'color .15s' }}
                  >
                    <Instagram size={14} style={{ color: 'var(--brand)', flexShrink: 0 }} />
                    @{club.instagramUrl.replace(/\/$/, '').split('/').pop() || 'Instagram'}
                  </a>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="cl-hero-actions">
              <button
                className={`cl-icon-btn${isFavorite ? ' cl-fav-on' : ''}`}
                onClick={handleToggleFavorite}
                disabled={favoriteBusy}
                title={isFavorite ? 'Quitar de favoritos' : 'Guardar en favoritos'}
                aria-label={isFavorite ? 'Quitar de favoritos' : 'Guardar en favoritos'}
              >
                <Heart size={20} style={{ fill: isFavorite ? 'var(--brand)' : 'none', transition: 'fill .2s' }} />
              </button>
              <button className="cl-icon-btn" onClick={handleShare} title="Copiar enlace">
                <Share2 size={20} />
              </button>
            </div>

          </div>

        </div>

        {/* ── MAIN GRID ── */}
        <div className="cl-grid">

          {/* BookingGrid — unchanged */}
          <BookingGrid clubSlug={slug} />

          {/* Sidebar */}
          <div className="cl-sidebar">

            {/* Info */}
            <div className="cl-panel">
              <div className="cl-panel-h">Información</div>
              {club.description && (
                <p className="cl-panel-description">
                  {club.description}
                </p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {(club.addressLine || club.city) && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(club.name + ' ' + formatClubAddress(club))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cl-panel-row"
                  >
                    <MapPin size={14} className="cl-panel-icon" />
                    <span style={{ textDecoration: 'underline', textDecorationColor: 'transparent', transition: 'text-decoration-color .15s' }}>
                      {formatClubAddress(club)}
                    </span>
                  </a>
                )}
                {club.phone && (
                  <a href={`tel:${club.phone.replace(/\s+/g, '')}`} className="cl-panel-row">
                    <Phone size={14} className="cl-panel-icon" />
                    <span>{club.phone}</span>
                  </a>
                )}
                {Array.isArray(club.openingDays) && club.openingDays.length > 0 && (
                  <div className="cl-panel-row" style={{ alignItems: 'flex-start', gap: 10 }}>
                    <Calendar size={14} className="cl-panel-icon" style={{ marginTop: 2 }} />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {DAY_LABELS.map((label, idx) =>
                        club.openingDays!.includes(idx) ? (
                          <span key={label} className="cl-day-chip">{label}</span>
                        ) : null
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Social */}
            {(club.instagramUrl || club.facebookUrl || club.websiteUrl) && (
              <div className="cl-panel">
                <div className="cl-panel-h">Social</div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {club.instagramUrl && (
                    <a href={club.instagramUrl} target="_blank" rel="noreferrer" className="cl-panel-row">
                      <Instagram size={14} className="cl-panel-icon" />
                      <span>{club.instagramUrl.replace(/^https?:\/\/(www\.)?(instagram\.com\/)?/, '@')}</span>
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Reviews */}
            {reviewsSummary.count > 0 && (
              <div className="cl-panel">
                <div className="cl-panel-h">Reseñas</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border-subtle)' }}>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--brand)', letterSpacing: '-.03em', lineHeight: 1 }}>
                      {formatRatingLabel(reviewsSummary.averageRating)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.03em', marginTop: 4 }}>
                      de 5 · {reviewsSummary.count} reseñas
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {[1, 2, 3, 4, 5].map(v => (
                      <Star key={v} size={14} style={{ color: v <= Math.round(reviewsSummary.averageRating) ? 'var(--brand)' : 'var(--border-strong)', fill: v <= Math.round(reviewsSummary.averageRating) ? 'var(--brand)' : 'none' }} />
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {reviews.slice(0, 3).map(review => (
                    <div key={review.id} className="cl-review-card">
                      <div className="cl-review-head">
                        <span className="cl-review-name">{review.user.name}</span>
                        <span className="cl-review-score">
                          <Star size={11} style={{ fill: 'var(--brand)' }} />
                          {formatRatingLabel(Number(review.rating || 0))}
                        </span>
                      </div>
                      {review.comment
                        ? <p className="cl-review-comment">{review.comment}</p>
                        : <p className="cl-review-comment" style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Sin comentario</p>
                      }
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Review CTA */}
            <div className="cl-panel">
              <div className="cl-panel-h">Tu reseña</div>
              {reviewCtaLoading ? (
                <UserLoadingState mode="inline" message="Validando elegibilidad..." />
              ) : canReviewClub || hasExistingClubReview ? (
                <div>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
                    {hasExistingClubReview
                      ? 'Ya dejaste una reseña en este club. Podés editarla.'
                      : 'Podés dejar tu reseña de este club.'}
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenReviewModal}
                    disabled={reviewLoading || reviewSaving}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '11px 16px', background: 'var(--positive-bg)', border: '1px solid var(--accent-border-subtle)', borderRadius: 12, color: 'var(--brand)', fontSize: 12, fontWeight: 800, letterSpacing: '.01em', cursor: reviewLoading || reviewSaving ? 'not-allowed' : 'pointer', opacity: reviewLoading || reviewSaving ? .6 : 1, fontFamily: 'inherit', transition: 'background .15s' }}
                  >
                    <ChevronRight size={14} />
                    {hasExistingClubReview ? 'Editar mi reseña' : 'Dejar mi reseña'}
                  </button>
                  {reviewFeedback && <div className="cl-feedback">{reviewFeedback}</div>}
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    {user ? 'Completá una reserva en este club para poder reseñarlo.' : 'Iniciá sesión y completá una reserva para reseñar.'}
                  </p>
                  {!user && (
                    <button
                      type="button"
                      className="cl-login-btn"
                      onClick={() => router.push(`/login?from=${encodeURIComponent(router.asPath || `/club/${slug}`)}`)}
                    >
                      <ChevronRight size={14} />
                      Iniciar sesión
                    </button>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      {reviewModalOpen && (
        <div
          className="cl-review-overlay"
          onMouseDown={(event) => {
            reviewBackdropMouseDownRef.current = event.target === event.currentTarget;
          }}
          onMouseUp={(event) => {
            if (reviewBackdropMouseDownRef.current && event.target === event.currentTarget && !reviewSaving) {
              setReviewModalOpen(false);
            }
            reviewBackdropMouseDownRef.current = false;
          }}
        >
          <div className="cl-review-panel" role="dialog" aria-modal="true" aria-labelledby="club-review-title">
            <div className="cl-review-modal-head">
              <div>
                <div id="club-review-title" className="cl-review-modal-title">Tu reseña de {club.name}</div>
                <div className="cl-review-modal-sub">Una reseña por club. Podés editarla cuando quieras.</div>
              </div>
              <button
                type="button"
                className="p-public-close-btn"
                onClick={() => !reviewSaving && setReviewModalOpen(false)}
                disabled={reviewSaving}
                aria-label="Cerrar"
                title="Cerrar"
              >
                <X size={15} />
              </button>
            </div>

            {reviewLoading ? (
              <UserLoadingState mode="inline" message="Cargando tu reseña..." />
            ) : (
              <>
                <div className="cl-review-stars" aria-label="Calificación">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`cl-review-star${reviewRating >= value ? ' cl-star-on' : ''}`}
                      onClick={() => setReviewRating(value)}
                      disabled={reviewSaving}
                      aria-label={`${value} ${value === 1 ? 'estrella' : 'estrellas'}`}
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
                    disabled={reviewSaving}
                  />
                  <div style={{ marginTop: 8, textAlign: 'right', fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>
                    {reviewComment.length}/220
                  </div>
                </div>
                {reviewFeedback && <div className="cl-feedback">{reviewFeedback}</div>}
                <div className="cl-review-action-row">
                  <button
                    type="button"
                    className="cl-review-secondary"
                    onClick={() => setReviewModalOpen(false)}
                    disabled={reviewSaving}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="cl-review-primary"
                    onClick={handleSubmitReview}
                    disabled={reviewSaving || reviewRating < 1}
                  >
                    {reviewSaving ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </DarkPageLayout>
  );
}
