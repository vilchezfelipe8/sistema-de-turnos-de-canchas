import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import DarkPageLayout from '../components/DarkPageLayout';
import {
  getMyBookings,
  cancelBooking,
  getBookingParticipants,
  getPlayerBookingCheckout,
  createMercadoPagoCheckout,
  inviteBookingParticipant,
  removeBookingParticipant,
  getMyBookingInvitations,
  acceptBookingInvitation,
  declineBookingInvitation,
  leaveBooking,
  type PlayerBookingDto,
  type PlayerBookingCheckoutDto,
  type PlayerBookingParticipantDto,
  type PlayerBookingInvitationDto
} from '../services/BookingService';
import { getMyReviewForClub, upsertMyClubReview } from '../services/ClubReviewService';
import AppModal from '../components/AppModal';
import { extractErrorMessage } from '../utils/uiError';
import { useValidateAuth } from '../hooks/useValidateAuth';
import { getPendingLogoutRedirect } from '../services/AuthService';
import Link from 'next/link';
import UserLoadingState from '../components/UserLoadingState';
import { Calendar, Clock, MapPin, Ticket, ArrowRight, Search, XCircle, CheckCircle2, Star, MessageSquare, X, Users, UserPlus, Mail, LogOut, Trash2 } from 'lucide-react';
import { getApiFieldErrors, normalizeApiError } from '../utils/apiError';

const PAGE_CSS = `
  .bk-layout { display:grid; grid-template-columns:1.4fr 1fr; gap:24px; align-items:start; }
  .bk-list-panel { background:var(--surface-1); border:1px solid var(--border); border-radius:24px; overflow:hidden; }
  .bk-list-body { padding:0 16px 16px; max-height:68vh; overflow-y:auto; display:flex; flex-direction:column; gap:8px; }
  .bk-list-body::-webkit-scrollbar { width:4px; }
  .bk-list-body::-webkit-scrollbar-track { background:transparent; }
  .bk-list-body::-webkit-scrollbar-thumb { background:var(--surface-2); border-radius:4px; }
  .bk-card { display:flex; align-items:center; gap:16px; padding:16px 18px; background:var(--surface-1); border:1px solid var(--border-subtle); border-radius:16px; cursor:pointer; transition:border-color .2s,background .2s; }
  .bk-card:hover { border-color:var(--accent-border-subtle); background:var(--surface-2); }
  .bk-card.bk-selected { border-color:var(--accent-border-strong); background:var(--positive-bg); }
  .bk-date-box { width:48px; height:48px; border-radius:12px; display:flex; flex-direction:column; align-items:center; justify-content:center; flex-shrink:0; }
  .bk-date-box-active { background:var(--positive-bg); border:1px solid var(--accent-border-subtle); }
  .bk-date-box-past { background:var(--surface-2); border:1px solid var(--border); }
  .bk-date-box-cancelled { background:var(--error-bg); border:1px solid var(--error-bg); }
  .bk-date-day { font-size:20px; font-weight:800; line-height:1; color:var(--text-primary); }
  .bk-date-month { font-size:9px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--text-muted); }
  .bk-card-club { font-size:15px; font-weight:800; color:var(--text-primary); line-height:1.2; margin-bottom:4px; }
  .bk-card-meta { display:flex; align-items:center; gap:8px; font-size:11px; color:var(--text-muted); font-weight:600; flex-wrap:wrap; }
  .bk-card-chip { padding:2px 8px; background:var(--surface-2); border-radius:6px; font-size:10px; color:var(--text-muted); font-weight:600; }
  /* Detail panel */
  .bk-detail { background:var(--surface-1); border:1px solid var(--border); border-radius:24px; padding:28px; position:sticky; top:84px; }
  .bk-ticket-label { display:inline-flex; align-items:center; gap:6px; padding:5px 14px; background:var(--positive-bg); border:1px solid var(--accent-border-subtle); border-radius:999px; font-size:10px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; color:var(--accent-fg); margin-bottom:20px; }
  .bk-detail-court { font-size:22px; font-weight:800; color:var(--text-primary); letter-spacing:-.02em; line-height:1.1; margin-bottom:6px; }
  .bk-detail-activity { font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--text-muted); margin-bottom:24px; }
  .bk-detail-row { display:flex; align-items:center; gap:14px; padding:14px 0; border-bottom:1px solid var(--border-subtle); }
  .bk-detail-row:last-of-type { border-bottom:none; }
  .bk-detail-icon { width:36px; height:36px; border-radius:10px; background:var(--surface-2); display:flex; align-items:center; justify-content:center; color:var(--text-muted); flex-shrink:0; }
  .bk-detail-row-label { font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--text-muted); margin-bottom:3px; }
  .bk-detail-row-val { font-size:14px; font-weight:700; color:var(--text-secondary); line-height:1.4; }
  .bk-detail-total { display:flex; align-items:center; justify-content:space-between; padding:20px 0 16px; border-top:1px solid var(--border); margin-top:8px; }
  .bk-detail-total-label { font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--text-muted); }
  .bk-detail-total-val { font-size:26px; font-weight:800; color:var(--text-primary); letter-spacing:-.03em; }
  .bk-action-btn { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:12px 16px; border-radius:14px; font-size:12px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; cursor:pointer; font-family:var(--font-sans); border:none; transition:background .15s,transform .15s; text-decoration:none; }
  .bk-action-btn:hover { transform:translateY(-1px); }
  .bk-action-cancel { background:var(--error-bg); border:1px solid var(--error-bg)!important; color:var(--error-fg); }
  .bk-action-cancel:hover { background:var(--error-bg); }
  .bk-action-review { background:var(--positive-bg); border:1px solid var(--accent-border-subtle)!important; color:var(--accent-fg); }
  .bk-action-review:hover { background:var(--accent-bg-muted); }
  .bk-action-rebook { background:var(--brand); color:var(--brand-on); }
  .bk-action-rebook:hover { background:var(--brand-hover); }
  /* Empty state */
  .bk-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:64px 32px; text-align:center; gap:16px; }
  .bk-empty-icon { color:var(--border-strong); }
  .bk-empty-title { font-size:13px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--text-muted); }
  /* Review modal */
  .bk-review-overlay { position:fixed; inset:0; background:var(--overlay); z-index:200; display:flex; align-items:center; justify-content:center; padding:20px; }
  .bk-review-panel { background:var(--surface-1); border:1px solid var(--border); border-radius:24px; width:100%; max-width:480px; padding:32px; box-shadow:var(--shadow-lg); }
  .bk-review-h { font-size:20px; font-weight:800; color:var(--text-primary); letter-spacing:-.02em; margin-bottom:6px; }
  .bk-review-sub { font-size:13px; color:var(--text-muted); margin-bottom:24px; font-weight:500; }
  .bk-review-stars { display:flex; gap:8px; }
  .bk-review-star { width:40px; height:40px; border-radius:12px; border:1px solid var(--border); background:var(--surface-2); display:flex; align-items:center; justify-content:center; cursor:pointer; transition:background .15s,border-color .15s; color:var(--text-muted); }
  .bk-review-star.bk-star-on { background:var(--positive-bg); border-color:var(--accent-border); color:var(--accent-fg); }
  .bk-review-textarea { width:100%; background:var(--surface-2); border:1px solid var(--border); border-radius:14px; padding:14px 16px; color:var(--text-primary); font-family:var(--font-sans); font-size:14px; outline:none; resize:none; transition:border-color .2s; }
  .bk-review-textarea:focus { border-color:var(--accent-border); }
  /* Review modal actions */
  .bk-review-action-row { display:flex; gap:10px; margin-top:24px; }
  .bk-review-secondary { flex:1; height:46px; border-radius:12px; background:none; border:1px solid var(--border); color:var(--text-muted); font-family:var(--font-sans); font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; cursor:pointer; transition:background .15s,border-color .15s; }
  .bk-review-secondary:hover { background:var(--surface-2); border-color:var(--border-strong); }
  .bk-review-primary { flex:1; height:46px; border-radius:12px; background:var(--brand); border:none; color:var(--brand-on); font-family:var(--font-sans); font-size:12px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; cursor:pointer; transition:background .15s; }
  .bk-review-primary:hover:not(:disabled) { background:var(--brand-hover); }
  .bk-review-primary:disabled { opacity:.5; cursor:not-allowed; }
  @media(max-width:900px){
    .bk-layout { grid-template-columns:1fr; }
    .bk-detail { position:static; }
    .bk-list-body { max-height:50vh; }
  }
  .p-public-root.p-public-theme-light .bk-list-panel,
  .p-public-root.p-public-theme-light .bk-detail { background:var(--surface-1); border-color:var(--border); box-shadow:0 12px 28px var(--border); }
  .p-public-root.p-public-theme-light .bk-card { background:var(--surface-1); border-color:var(--border); }
  .p-public-root.p-public-theme-light .bk-card:hover { border-color:var(--accent-border); background:var(--surface-2); }
  .p-public-root.p-public-theme-light .bk-card.bk-selected { border-color:var(--accent-border-strong); background:var(--positive-bg); }
  .p-public-root.p-public-theme-light .bk-date-box-past { background:var(--surface-2); border-color:var(--border); }
  .p-public-root.p-public-theme-light .bk-date-day,
  .p-public-root.p-public-theme-light .bk-card-club,
  .p-public-root.p-public-theme-light .bk-detail-court,
  .p-public-root.p-public-theme-light .bk-detail-total-val,
  .p-public-root.p-public-theme-light .bk-review-h { color:var(--text-primary); }
  .p-public-root.p-public-theme-light .bk-date-month,
  .p-public-root.p-public-theme-light .bk-card-meta,
  .p-public-root.p-public-theme-light .bk-detail-row-label,
  .p-public-root.p-public-theme-light .bk-detail-total-label,
  .p-public-root.p-public-theme-light .bk-empty-title,
  .p-public-root.p-public-theme-light .bk-review-sub { color:var(--text-muted); }
  .p-public-root.p-public-theme-light .bk-card-chip { background:var(--surface-2); color:var(--text-secondary); }
  .p-public-root.p-public-theme-light .bk-detail-row { border-bottom-color:var(--border-subtle); }
  .p-public-root.p-public-theme-light .bk-detail-icon { background:var(--surface-2); color:var(--text-muted); }
  .p-public-root.p-public-theme-light .bk-detail-row-val { color:var(--text-secondary); }
  .p-public-root.p-public-theme-light .bk-detail-total { border-top-color:var(--border); }
  .p-public-root.p-public-theme-light .bk-empty-icon { color:var(--border-strong); }
  .p-public-root.p-public-theme-light .bk-review-overlay { background:var(--overlay-strong); }
  .p-public-root.p-public-theme-light .bk-review-panel { background:var(--surface-1); border-color:var(--border); box-shadow:var(--shadow-lg); }
  .p-public-root.p-public-theme-light .bk-review-star { border-color:var(--border-strong); background:var(--surface-2); color:var(--text-muted); }
  .p-public-root.p-public-theme-light .bk-review-textarea { background:var(--surface-1); border-color:var(--border); color:var(--text-primary); }
  .p-public-root.p-public-theme-light .bk-review-textarea:focus { border-color:var(--accent-border); }
  .p-public-root.p-public-theme-light .bk-date-box-active { background:var(--positive-bg); border-color:var(--accent-border-subtle); }
  .p-public-root.p-public-theme-light .bk-date-box-cancelled { background:var(--error-bg); border-color:var(--error-bg); }
  .p-public-root.p-public-theme-light .bk-ticket-label { background:var(--positive-bg); border-color:var(--accent-border-subtle); color:var(--accent-fg); }
  .p-public-root.p-public-theme-light .bk-detail-activity { color:var(--text-muted); }
  .p-public-root.p-public-theme-light .bk-action-cancel { background:var(--error-bg); border-color:var(--error-bg)!important; color:var(--error-fg); }
  .p-public-root.p-public-theme-light .bk-action-cancel:hover { background:var(--error-bg); }
  .p-public-root.p-public-theme-light .bk-action-review { background:var(--positive-bg); border-color:var(--accent-border-subtle)!important; color:var(--accent-fg); }
  .p-public-root.p-public-theme-light .bk-action-review:hover { background:var(--accent-bg-muted); }
  .p-public-root.p-public-theme-light .bk-star-on { background:var(--positive-bg)!important; border-color:var(--accent-border)!important; color:var(--accent-fg)!important; }
  .p-public-root.p-public-theme-light .bk-list-body::-webkit-scrollbar-thumb { background:var(--border); }
  .bk-detail-empty { background:var(--surface-2); border:1px dashed var(--border); border-radius:24px; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:320px; padding:40px; text-align:center; gap:12px; }
  .bk-detail-empty-icon { color:var(--border-strong); }
  .bk-detail-empty-label { font-size:12px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--text-muted); line-height:1.5; }
  .p-public-root.p-public-theme-light .bk-detail-empty { background:var(--surface-2); border-color:var(--border); }
  .p-public-root.p-public-theme-light .bk-detail-empty-icon { color:var(--border-strong); }
  .p-public-root.p-public-theme-light .bk-detail-empty-label { color:var(--text-muted); }
  .p-public-root.p-public-theme-light .bk-review-secondary { border-color:var(--border-strong); color:var(--text-secondary); }
  .p-public-root.p-public-theme-light .bk-review-secondary:hover { background:var(--surface-2); border-color:var(--border-strong); }
`;

export default function MyBookingsPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth();
  const [bookings, setBookings] = useState<PlayerBookingDto[]>([]);
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'PAST' | 'CANCELLED'>('ACTIVE');
  const [selectedBooking, setSelectedBooking] = useState<PlayerBookingDto | null>(null);
  const selectedDetailRef = useRef<HTMLDivElement | null>(null);
  const bookingRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalState, setModalState] = useState<{
    show: boolean;
    title?: string;
    message?: React.ReactNode;
    cancelText?: string;
    confirmText?: string;
    isWarning?: boolean;
    onConfirm?: () => Promise<void> | void;
    confirmDisabled?: boolean;
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
  }>({ show: false });
  const [cancellingBooking, setCancellingBooking] = useState(false);
  const [cancelSuccessMessage, setCancelSuccessMessage] = useState('');
  const cancelSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingInvitations, setPendingInvitations] = useState<PlayerBookingInvitationDto[]>([]);
  const [invitationActionId, setInvitationActionId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<PlayerBookingParticipantDto[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [participantsError, setParticipantsError] = useState('');
  const [checkoutSummary, setCheckoutSummary] = useState<PlayerBookingCheckoutDto | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteFieldErrors, setInviteFieldErrors] = useState<Record<string, string>>({});
  const [inviteBannerError, setInviteBannerError] = useState('');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [participantActionId, setParticipantActionId] = useState<string | null>(null);
  const [paymentBanner, setPaymentBanner] = useState<{ tone: 'success' | 'info' | 'error'; message: string } | null>(null);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewAnchorBookingId, setReviewAnchorBookingId] = useState<number | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const reviewBackdropMouseDownRef = useRef(false);
  const tabRefs = useRef<Record<'ACTIVE' | 'PAST' | 'CANCELLED', HTMLButtonElement | null>>({
    ACTIVE: null, PAST: null, CANCELLED: null
  });

  const closeModal = () => setModalState(p => ({ ...p, show: false, onConfirm: undefined, confirmDisabled: undefined, closeOnBackdrop: undefined, closeOnEscape: undefined }));

  const showError = (message: string) => setModalState({ show: true, title: 'Error', message, isWarning: true, cancelText: '', confirmText: 'Aceptar' });
  const flashSuccess = (message: string) => {
    if (cancelSuccessTimerRef.current) clearTimeout(cancelSuccessTimerRef.current);
    setCancelSuccessMessage(message);
    cancelSuccessTimerRef.current = setTimeout(() => setCancelSuccessMessage(''), 4000);
  };

  const toPublicBookingErrorMessage = (error: unknown, fallback: string) => {
    const normalized = normalizeApiError(error, fallback);
    switch (normalized.code) {
      case 'BOOKING_HAS_PAYMENTS':
        return 'Esta reserva tiene pagos registrados. Contactá al club para cancelarla.';
      case 'BOOKING_CANCELLATION_NOT_ALLOWED':
      case 'BOOKING_IN_PAST':
        return 'Esta reserva ya comenzó o ya pasó, así que no se puede cancelar desde acá.';
      case 'BOOKING_INVALID_STATUS':
        return 'Esta reserva ya no está disponible para cancelación.';
      case 'BOOKING_PARTICIPANT_ALREADY_EXISTS':
        return 'Ese jugador ya está invitado o ya forma parte de esta reserva.';
      case 'BOOKING_INVITATION_EMAIL_MISMATCH':
        return 'Esta invitación fue enviada a otro email.';
      case 'BOOKING_INVITATION_NOT_FOUND':
      case 'BOOKING_PARTICIPANT_NOT_FOUND':
        return 'No encontramos ese acceso o esa invitación.';
      case 'BOOKING_INVITATION_ALREADY_ACCEPTED':
        return 'Esa invitación ya había sido aceptada.';
      case 'BOOKING_INVITATION_ALREADY_DECLINED':
        return 'Esa invitación ya había sido rechazada.';
      case 'BOOKING_INVITATION_EXPIRED':
      case 'BOOKING_INVITATION_INVALID':
        return 'La invitación ya no está disponible.';
      case 'BOOKING_CANNOT_INVITE_PARTICIPANTS':
        return 'Esta reserva ya no admite nuevas invitaciones desde la app.';
      case 'BOOKING_CANNOT_LEAVE':
        return 'Ya no podés salirte de esta reserva desde acá.';
      case 'BOOKING_FORBIDDEN':
      case 'FORBIDDEN':
        return 'No tenés permiso para gestionar esta reserva.';
      case 'BOOKING_NOT_FOUND':
        return 'No encontramos esa reserva.';
      case 'CHECKOUT_PROVIDER_NOT_CONFIGURED':
      case 'CHECKOUT_NOT_AVAILABLE':
        return 'El pago online todavía no está disponible para esta reserva.';
      case 'CHECKOUT_ACCOUNT_NOT_FOUND':
        return 'Todavía no hay una cuenta publicada para esta reserva.';
      case 'CHECKOUT_NO_PENDING_BALANCE':
        return 'Esta reserva no tiene saldo pendiente por ahora.';
      case 'CHECKOUT_ALREADY_PAID':
        return 'Esta reserva ya no tiene saldo pendiente para pagar online.';
      case 'CHECKOUT_AMOUNT_CHANGED':
        return 'El saldo de esta reserva cambió. Volvé a revisar el estado de pago antes de intentar de nuevo.';
      case 'PAYMENT_PROVIDER_NOT_CONFIGURED':
      case 'PAYMENT_PROVIDER_AUTH_FAILED':
        return 'El pago online no está disponible ahora mismo para este club.';
      case 'AUTH_MISSING':
      case 'AUTH_INVALID':
      case 'AUTH_EXPIRED':
      case 'AUTH_REVOKED':
        return 'Necesitás iniciar sesión de nuevo para continuar.';
      default:
        return extractErrorMessage(normalized, fallback);
    }
  };

  const showConfirm = (options: {
    title: string; message: string; confirmText?: string; cancelText?: string;
    isWarning?: boolean; onConfirm: () => Promise<void> | void;
  }) => {
    setModalState({
      show: true,
      title: options.title,
      message: options.message,
      confirmText: options.confirmText ?? 'Aceptar',
      cancelText: options.cancelText ?? 'Cancelar',
      isWarning: options.isWarning ?? true,
      onConfirm: async () => { closeModal(); await options.onConfirm(); }
    });
  };

  const refreshSelectedParticipants = useCallback(async () => {
    if (!selectedBooking) return;
    const items = await getBookingParticipants(selectedBooking.id);
    setParticipants(items);
  }, [selectedBooking]);

  useEffect(() => () => { if (cancelSuccessTimerRef.current) clearTimeout(cancelSuccessTimerRef.current); }, []);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const [data, invitations] = await Promise.all([
        getMyBookings(user.id),
        getMyBookingInvitations().catch(() => [] as PlayerBookingInvitationDto[])
      ]);
      setBookings(data.sort((a, b) => new Date(b.startDateTime).getTime() - new Date(a.startDateTime).getTime()));
      setPendingInvitations(invitations);
      setError('');
    } catch (err: unknown) {
      setError(toPublicBookingErrorMessage(err, 'No pudimos cargar tus reservas. Recargá la página.'));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { if (authChecked && user) loadData(); }, [authChecked, user, loadData]);

  useEffect(() => {
    if (!authChecked || user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/bookings')}`);
  }, [authChecked, user, router]);

  const { activeBookings, pastBookings, cancelledBookings } = useMemo(() => {
    const now = new Date();
    const active: PlayerBookingDto[] = [], past: PlayerBookingDto[] = [], cancelled: PlayerBookingDto[] = [];
    bookings.forEach(b => {
      const end = b.endDateTime ? new Date(b.endDateTime) : new Date(b.startDateTime);
      if (b.status === 'CANCELLED') cancelled.push(b);
      else if (b.status === 'COMPLETED' || end.getTime() < now.getTime()) past.push(b);
      else active.push(b);
    });
    return { activeBookings: active, pastBookings: past, cancelledBookings: cancelled };
  }, [bookings]);

  const visibleBookings = useMemo(() => {
    if (activeTab === 'PAST') return pastBookings;
    if (activeTab === 'CANCELLED') return cancelledBookings;
    return activeBookings;
  }, [activeTab, activeBookings, pastBookings, cancelledBookings]);

  useEffect(() => {
    if (selectedBooking && !bookings.some(b => b.id === selectedBooking.id)) setSelectedBooking(null);
  }, [bookings, selectedBooking]);

  useEffect(() => {
    if (!selectedBooking) {
      setParticipants([]);
      setParticipantsError('');
      setParticipantsLoading(false);
      setCheckoutSummary(null);
      setCheckoutError('');
      setCheckoutLoading(false);
      setInviteBannerError('');
      setInviteFieldErrors({});
      return;
    }

    let cancelled = false;
    setParticipantsLoading(true);
    setParticipantsError('');
    setInviteBannerError('');
    setInviteFieldErrors({});
    void getBookingParticipants(selectedBooking.id)
      .then((items) => {
        if (cancelled) return;
        setParticipants(items);
      })
      .catch((err) => {
        if (cancelled) return;
        setParticipants([]);
        setParticipantsError(toPublicBookingErrorMessage(err, 'No pudimos cargar los participantes de esta reserva.'));
      })
      .finally(() => {
        if (cancelled) return;
        setParticipantsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedBooking]);

  useEffect(() => {
    if (!selectedBooking) return;

    let cancelled = false;
    setCheckoutLoading(true);
    setCheckoutError('');
    void getPlayerBookingCheckout(selectedBooking.id)
      .then((payload) => {
        if (cancelled) return;
        setCheckoutSummary(payload);
      })
      .catch((err) => {
        if (cancelled) return;
        setCheckoutSummary(null);
        setCheckoutError(toPublicBookingErrorMessage(err, 'No pudimos cargar el estado de pago de esta reserva.'));
      })
      .finally(() => {
        if (cancelled) return;
        setCheckoutLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedBooking]);

  useEffect(() => {
    const checkoutStatus = String(router.query.checkoutStatus || '').trim().toLowerCase();
    if (!checkoutStatus) return;

    if (checkoutStatus === 'success') {
      setPaymentBanner({
        tone: 'success',
        message: 'Mercado Pago recibió tu pago. Estamos validándolo con el club.'
      });
    } else if (checkoutStatus === 'pending') {
      setPaymentBanner({
        tone: 'info',
        message: 'Tu pago quedó pendiente de confirmación en Mercado Pago.'
      });
    } else if (checkoutStatus === 'failure') {
      setPaymentBanner({
        tone: 'error',
        message: 'No se pudo completar el pago online. Revisá el estado de pago o contactá al club.'
      });
    }

    const nextQuery = { ...router.query } as Record<string, unknown>;
    delete nextQuery.checkoutStatus;
    void router.replace({ pathname: router.pathname, query: nextQuery as any }, undefined, { shallow: true });
  }, [router]);

  useEffect(() => {
    if (!reviewModalOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !reviewSaving) setReviewModalOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [reviewModalOpen, reviewSaving]);

  useEffect(() => {
    if (!reviewModalOpen && !reviewSaving) {
      setReviewAnchorBookingId(null);
    }
  }, [reviewModalOpen, reviewSaving]);

  useEffect(() => {
    if (!selectedBooking) return;
    const el = selectedDetailRef.current;
    if (!el) return;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true }); }
    catch { el.scrollIntoView(); }
  }, [selectedBooking]);

  const formatTime = (date: Date) =>
    date.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false });

  const formatWeekday = (date: Date) =>
    date.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
      .replace(/^\w/, c => c.toUpperCase());

  const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-AR')}`;

  const getDuration = (b: PlayerBookingDto) =>
    Math.max(0, Math.round((new Date(b.endDateTime).getTime() - new Date(b.startDateTime).getTime()) / 60000)) || 60;

  const getCheckoutReasonMessage = (checkout: PlayerBookingCheckoutDto) => {
    if (checkout.checkout.enabled) {
      return 'Mercado Pago está disponible para este pago. Cuando avances, el monto se toma desde la cuenta real de la reserva.';
    }
    switch (checkout.checkout.reason) {
      case 'ACCOUNT_MISSING':
        return 'Todavía no hay una cuenta publicada para esta reserva. Contactá al club para confirmar el estado de pago.';
      case 'NO_PENDING_BALANCE':
        return 'Esta reserva no tiene saldo pendiente por ahora.';
      case 'PARTICIPANT_PAYMENTS_NOT_SUPPORTED':
        return 'Por ahora el pago online está disponible solo para el titular de la reserva. Si necesitás resolver un pago, contactá al club.';
      case 'BOOKING_HAS_REFUNDS':
        return 'Esta reserva tiene devoluciones o ajustes en revisión. Contactá al club para resolver cualquier cambio de pago.';
      case 'BOOKING_NOT_PAYABLE':
        return 'Esta reserva ya no está disponible para pago online desde la app.';
      case 'PROVIDER_NOT_CONFIGURED':
        return 'El pago online todavía no está disponible para este club. Contactá al club para pagar o resolver cambios.';
      default:
        return 'Todavía no pudimos habilitar el pago online para esta reserva.';
    }
  };

  const handleStartOnlineCheckout = async () => {
    if (!selectedBooking || !checkoutSummary?.checkout.enabled || checkoutSubmitting) return;
    setCheckoutSubmitting(true);
    try {
      const payload = await createMercadoPagoCheckout(selectedBooking.id);
      if (typeof window !== 'undefined') {
        window.location.assign(payload.initPoint);
      }
    } catch (error) {
      showError(toPublicBookingErrorMessage(error, 'No pudimos iniciar el pago online.'));
    } finally {
      setCheckoutSubmitting(false);
    }
  };

  const accountItemTypeLabel = (type: string) => {
    if (type === 'COURT') return 'Cancha';
    if (type === 'PRODUCT') return 'Producto';
    if (type === 'SERVICE') return 'Servicio';
    return 'Concepto';
  };

  const resolveReviewAnchorForClub = (clubSlug: string) =>
    bookings.find((booking) => {
      const bookingClubSlug = String(booking?.club?.slug || '').trim();
      const status = String(booking?.status || '').toUpperCase();
      return bookingClubSlug === clubSlug && status === 'COMPLETED' && String(booking?.id || '').trim().length > 0;
    }) || null;

  const selectedBookingClubSlug = String(selectedBooking?.club?.slug || '').trim();
  const selectedClubHasCompletedBooking = Boolean(
    selectedBookingClubSlug && resolveReviewAnchorForClub(selectedBookingClubSlug)
  );

  const CANCEL_CONFIRM_MESSAGE = 'Vas a cancelar tu reserva. Si el club ya registró pagos, la cancelación se resuelve directamente con ellos.';

  const handleCancel = (id: string) => {
    if (cancellingBooking) return;
    setModalState({
      show: true,
      title: '¿Cancelar esta reserva?',
      message: CANCEL_CONFIRM_MESSAGE,
      isWarning: true,
      confirmText: 'Cancelar reserva',
      cancelText: 'Volver',
      closeOnBackdrop: false,
      closeOnEscape: false,
      confirmDisabled: false,
      onConfirm: async () => {
        if (cancellingBooking) return;
        setCancellingBooking(true);
        setModalState(prev => ({ ...prev, confirmDisabled: true }));
        try {
          await cancelBooking(id);
          closeModal();
          setSelectedBooking(null);
          await loadData();
          flashSuccess('Reserva cancelada.');
        } catch (e: any) {
          setModalState(prev => ({
            ...prev,
            confirmDisabled: false,
            message: (
              <span>
                {CANCEL_CONFIRM_MESSAGE}
              <span style={{ display: 'block', marginTop: 10, color: 'var(--error-fg)', fontSize: 13, fontWeight: 600 }}>
                  {toPublicBookingErrorMessage(e, 'No pudimos cancelar la reserva. Intentá nuevamente.')}
                </span>
              </span>
            ),
          }));
        } finally {
          setCancellingBooking(false);
        }
      },
    });
  };

  const handleAcceptInvitation = async (invitationId: string) => {
    if (invitationActionId) return;
    setInvitationActionId(invitationId);
    try {
      await acceptBookingInvitation(invitationId);
      await loadData();
      flashSuccess('Invitación aceptada.');
    } catch (error) {
      showError(toPublicBookingErrorMessage(error, 'No pudimos aceptar la invitación.'));
    } finally {
      setInvitationActionId(null);
    }
  };

  const handleDeclineInvitation = async (invitationId: string) => {
    if (invitationActionId) return;
    setInvitationActionId(invitationId);
    try {
      await declineBookingInvitation(invitationId);
      await loadData();
      flashSuccess('Invitación rechazada.');
    } catch (error) {
      showError(toPublicBookingErrorMessage(error, 'No pudimos rechazar la invitación.'));
    } finally {
      setInvitationActionId(null);
    }
  };

  const handleLeaveBooking = (booking: PlayerBookingDto) => {
    if (participantActionId) return;
    showConfirm({
      title: '¿Salirte de esta reserva?',
      message: 'Vas a dejar de figurar como participante. Si necesitás resolver algo de pago o una excepción, contactá al club.',
      confirmText: 'Salir de la reserva',
      cancelText: 'Volver',
      isWarning: true,
      onConfirm: async () => {
        setParticipantActionId(booking.id);
        try {
          await leaveBooking(booking.id);
          setSelectedBooking(null);
          await loadData();
          flashSuccess('Te saliste de la reserva.');
        } catch (error) {
          showError(toPublicBookingErrorMessage(error, 'No pudimos procesar tu salida de la reserva.'));
        } finally {
          setParticipantActionId(null);
        }
      }
    });
  };

  const handleInviteParticipant = async () => {
    if (!selectedBooking || inviteSubmitting) return;
    setInviteSubmitting(true);
    setInviteFieldErrors({});
    setInviteBannerError('');
    try {
      await inviteBookingParticipant(selectedBooking.id, {
        email: inviteEmail,
        name: inviteName
      });
      setInviteEmail('');
      setInviteName('');
      await refreshSelectedParticipants();
      await loadData();
    } catch (error) {
      const fieldErrors = getApiFieldErrors(error);
      setInviteFieldErrors(fieldErrors);
      const message = toPublicBookingErrorMessage(error, 'No pudimos enviar la invitación.');
      if (Object.keys(fieldErrors).length === 0) {
        setInviteBannerError(message);
      }
    } finally {
      setInviteSubmitting(false);
    }
  };

  const handleRemoveParticipant = (participant: PlayerBookingParticipantDto) => {
    if (!selectedBooking || participantActionId) return;
    showConfirm({
      title: '¿Remover participante?',
      message: `Vamos a quitar a ${participant.displayName} de esta reserva.`,
      confirmText: 'Remover',
      cancelText: 'Volver',
      isWarning: true,
      onConfirm: async () => {
        setParticipantActionId(participant.id);
        try {
          await removeBookingParticipant(selectedBooking.id, participant.id);
          await refreshSelectedParticipants();
          await loadData();
        } catch (error) {
          showError(toPublicBookingErrorMessage(error, 'No pudimos remover al participante.'));
        } finally {
          setParticipantActionId(null);
        }
      }
    });
  };

  const handleOpenReviewModal = async (booking: PlayerBookingDto) => {
    const clubSlug = String(booking?.club?.slug || '').trim();
    const anchor = resolveReviewAnchorForClub(clubSlug);
    const bookingId = Number(anchor?.id || 0);
    if (!clubSlug || !Number.isInteger(bookingId) || bookingId <= 0) {
      showError('Para calificar este club necesitás al menos una reserva completada.');
      return;
    }
    setReviewAnchorBookingId(bookingId);
    setReviewModalOpen(true);
    setReviewLoading(true);
    try {
      const existing = await getMyReviewForClub(clubSlug);
      if (existing) { setReviewRating(Number(existing.rating || 5)); setReviewComment(String(existing.comment || '')); }
      else { setReviewRating(5); setReviewComment(''); }
    } catch (e: unknown) {
      showError(extractErrorMessage(e, 'No se pudo cargar tu reseña.'));
      setReviewModalOpen(false);
    } finally { setReviewLoading(false); }
  };

  const handleSubmitReview = async () => {
    if (!selectedBooking) return;
    const clubSlug = String(selectedBooking?.club?.slug || '').trim();
    const bookingId = Number(reviewAnchorBookingId || 0);
    if (!clubSlug || !Number.isInteger(bookingId) || bookingId <= 0) {
      showError('No pudimos identificar una reserva completada para este club.');
      return;
    }
    try {
      setReviewSaving(true);
      await upsertMyClubReview(clubSlug, { bookingId, rating: reviewRating, comment: reviewComment.trim() || null });
      setReviewModalOpen(false);
      setReviewComment('');
      setReviewAnchorBookingId(null);
      showConfirm({ title: 'Reseña guardada', message: 'Tu reseña fue guardada correctamente.', confirmText: 'Aceptar', cancelText: '', isWarning: false, onConfirm: async () => {} });
    } catch (e: unknown) {
      showError(extractErrorMessage(e, 'No se pudo guardar la reseña.'));
    } finally { setReviewSaving(false); }
  };

  if (!authChecked || !user) {
    return <UserLoadingState mode="page" message={authChecked ? 'Redirigiendo...' : 'Validando sesión...'} />;
  }

  const TAB_LABELS: Record<'ACTIVE' | 'PAST' | 'CANCELLED', string> = {
    ACTIVE: `Activas${activeBookings.length ? ` (${activeBookings.length})` : ''}`,
    PAST: 'Pasadas',
    CANCELLED: 'Canceladas'
  };
  const roleLabel = (booking: PlayerBookingDto) => booking.myRole === 'PARTICIPANT' ? 'Participante' : 'Titular';

  return (
    <DarkPageLayout
      title="Mis Reservas | Pique"
      extraCss={PAGE_CSS}
      breadcrumbs={[
        { label: 'Inicio', href: '/' },
        { label: 'Mis reservas' },
      ]}
    >
      <div className="p-public-page">

        {/* ── PAGE HEADER ── */}
        <div style={{ marginBottom: 36, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, paddingBottom: 28, borderBottom: '1px solid var(--border-subtle)' }}>
          <div>
            <span className="p-public-page-eyebrow">Mi cuenta</span>
            <h1 className="p-public-page-h">Mis <i>reservas</i></h1>
            <p className="p-public-page-sub">Próximos partidos e historial</p>
          </div>
          <Link
            href="/complejos"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: 'var(--brand)', color: 'var(--brand-on)', borderRadius: 999, fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', textDecoration: 'none' }}
          >
            + Nueva reserva
          </Link>
        </div>

        {/* ── TABS ── */}
        <div style={{ marginBottom: 24 }}>
          {pendingInvitations.length > 0 && (
            <div style={{ marginBottom: 18, display: 'grid', gap: 10 }}>
              {pendingInvitations.map((invitation) => {
                const busy = invitationActionId === invitation.id;
                return (
                  <div
                    key={invitation.id}
                    style={{
                      padding: '14px 16px',
                      borderRadius: 16,
                      background: 'var(--surface-1)',
                      border: '1px solid var(--accent-border-subtle)',
                      display: 'grid',
                      gap: 10
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>
                          Invitación pendiente para {invitation.club.name}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {invitation.court.name} · {formatWeekday(new Date(invitation.startDateTime))} · {formatTime(new Date(invitation.startDateTime))}
                        </div>
                      </div>
                      <span className="bk-card-chip" style={{ background: 'var(--positive-bg)', color: 'var(--accent-fg)' }}>
                        Invitación
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="bk-action-btn bk-action-rebook"
                        style={{ width: 'auto', padding: '10px 14px' }}
                        disabled={busy}
                        onClick={() => handleAcceptInvitation(invitation.id)}
                      >
                        <CheckCircle2 size={14} />
                        {busy ? 'Procesando...' : 'Aceptar'}
                      </button>
                      <button
                        type="button"
                        className="bk-action-btn bk-action-cancel"
                        style={{ width: 'auto', padding: '10px 14px' }}
                        disabled={busy}
                        onClick={() => handleDeclineInvitation(invitation.id)}
                      >
                        <XCircle size={14} />
                        Rechazar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="p-public-tabs" style={{ display: 'inline-flex' }}>
            {(['ACTIVE', 'PAST', 'CANCELLED'] as const).map(tab => (
              <button
                key={tab}
                ref={el => { tabRefs.current[tab] = el; }}
                className={`p-public-tab${activeTab === tab ? ' p-public-active' : ''}`}
                onClick={() => { setActiveTab(tab); setSelectedBooking(null); }}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        </div>

        {/* ── MAIN LAYOUT ── */}
        <div className="bk-layout">

          {/* LIST PANEL */}
          <div className="bk-list-panel">
            <div style={{ padding: '20px 20px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                {visibleBookings.length} {activeTab === 'ACTIVE' ? 'próximas' : activeTab === 'PAST' ? 'pasadas' : 'canceladas'}
              </div>
            </div>
            <div className="bk-list-body" style={{ padding: '16px' }}>
              {cancelSuccessMessage && (
                <div style={{ padding: '12px 16px', background: 'var(--positive-bg)', border: '1px solid var(--accent-border-subtle)', borderRadius: 12, fontSize: 13, color: 'var(--accent-fg)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
                  {cancelSuccessMessage}
                </div>
              )}
              {paymentBanner && (
                <div
                  style={{
                    padding: '12px 16px',
                    background: paymentBanner.tone === 'success'
                      ? 'var(--positive-bg)'
                      : paymentBanner.tone === 'error'
                        ? 'var(--error-bg)'
                        : 'var(--surface-2)',
                    border: paymentBanner.tone === 'success'
                      ? '1px solid var(--accent-border-subtle)'
                      : paymentBanner.tone === 'error'
                        ? '1px solid var(--error-bg)'
                        : '1px solid var(--border-subtle)',
                    borderRadius: 12,
                    fontSize: 13,
                    color: paymentBanner.tone === 'success'
                      ? 'var(--accent-fg)'
                      : paymentBanner.tone === 'error'
                        ? 'var(--error-fg)'
                        : 'var(--text-secondary)',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                  }}
                >
                  <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
                  {paymentBanner.message}
                </div>
              )}
              {loading ? (
                <div className="bk-empty">
                  <UserLoadingState mode="inline" message="Cargando reservas..." />
                </div>
              ) : error ? (
                <div style={{ padding: '20px 16px', background: 'var(--error-bg)', border: '1px solid var(--error-bg)', borderRadius: 12, fontSize: 13, color: 'var(--error-fg)', fontWeight: 600 }}>
                  {error}
                </div>
              ) : visibleBookings.length === 0 ? (
                <div className="bk-empty">
                  <Search size={40} className="bk-empty-icon" />
                  <div className="bk-empty-title">
                    {activeTab === 'CANCELLED' ? 'Sin cancelaciones' : activeTab === 'PAST' ? 'Sin historial' : 'No hay reservas activas'}
                  </div>
                  {activeTab === 'ACTIVE' && (
                    <Link href="/complejos" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: 'var(--brand)', color: 'var(--brand-on)', borderRadius: 999, fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', textDecoration: 'none', marginTop: 4 }}>
                      Reservar ahora
                    </Link>
                  )}
                </div>
              ) : (
                visibleBookings.map(booking => {
                  const date = new Date(booking.startDateTime);
                  const isSelected = selectedBooking?.id === booking.id;
                  const boxClass = activeTab === 'ACTIVE' ? 'bk-date-box-active' : activeTab === 'CANCELLED' ? 'bk-date-box-cancelled' : 'bk-date-box-past';
                  const dayColor = activeTab === 'ACTIVE' ? 'var(--brand)' : activeTab === 'CANCELLED' ? 'var(--error-fg)' : 'var(--text-muted)';
                  return (
                    <div
                      key={booking.id}
                      ref={el => { bookingRefs.current[Number(booking.id)] = el; }}
                      tabIndex={-1}
                      className={`bk-card${isSelected ? ' bk-selected' : ''}`}
                      onClick={() => setSelectedBooking(booking)}
                    >
                      <div className={`bk-date-box ${boxClass}`}>
                        <span className="bk-date-day" style={{ color: dayColor }}>{date.getDate()}</span>
                        <span className="bk-date-month">{date.toLocaleString('es-AR', { month: 'short' }).replace('.', '')}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="bk-card-club">{booking.club?.name || 'Club'}</div>
                        <div className="bk-card-meta">
                          {booking.activity?.name && <span className="bk-card-chip">{booking.activity.name}</span>}
                          <span className="bk-card-chip">{roleLabel(booking)}</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Clock size={10} /> {formatTime(date)}
                          </span>
                          {booking.court?.name && <span style={{ color: 'var(--text-muted)' }}>{booking.court.name}</span>}
                          <span style={{ color: 'var(--text-muted)' }}>{booking.paymentSummary.label}</span>
                        </div>
                      </div>
                      <ArrowRight size={16} style={{ color: isSelected ? 'var(--brand)' : 'var(--text-muted)', flexShrink: 0, transition: 'color .2s' }} />
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* DETAIL PANEL */}
          {selectedBooking ? (
            <div
              className="bk-detail"
              ref={el => { selectedDetailRef.current = el; }}
              tabIndex={-1}
            >
              <div className="bk-ticket-label">
                <Ticket size={12} /> Ticket de reserva
              </div>
              <div className="bk-detail-court">{selectedBooking.court?.name || 'Cancha'}</div>
              <div className="bk-detail-activity">{selectedBooking.activity?.name || 'Deporte'} · {selectedBooking.club?.name}</div>

              <hr className="p-public-divider" style={{ margin: '0 0 16px' }} />

              <div>
                <div className="bk-detail-row">
                  <div className="bk-detail-icon"><Calendar size={16} /></div>
                  <div>
                    <div className="bk-detail-row-label">Fecha</div>
                    <div className="bk-detail-row-val">{formatWeekday(new Date(selectedBooking.startDateTime))}</div>
                  </div>
                </div>
                <div className="bk-detail-row">
                  <div className="bk-detail-icon"><Clock size={16} /></div>
                  <div>
                    <div className="bk-detail-row-label">Horario</div>
                    <div className="bk-detail-row-val">{formatTime(new Date(selectedBooking.startDateTime))} · {getDuration(selectedBooking)} min</div>
                  </div>
                </div>
                <div className="bk-detail-row">
                  <div className="bk-detail-icon"><MapPin size={16} /></div>
                  <div>
                    <div className="bk-detail-row-label">Club</div>
                    <div className="bk-detail-row-val">{selectedBooking.club?.name || 'Club'}</div>
                  </div>
                </div>
                <div className="bk-detail-row">
                  <div className="bk-detail-icon"><Ticket size={16} /></div>
                  <div>
                    <div className="bk-detail-row-label">Código</div>
                    <div className="bk-detail-row-val">{selectedBooking.publicCode}</div>
                  </div>
                </div>
                <div className="bk-detail-row">
                  <div className="bk-detail-icon"><Users size={16} /></div>
                  <div>
                    <div className="bk-detail-row-label">Tu rol</div>
                    <div className="bk-detail-row-val">{roleLabel(selectedBooking)}</div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                    Participantes
                  </div>
                  {selectedBooking.capabilities.canInvitePlayers && (
                    <span className="bk-card-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <UserPlus size={12} /> Podés invitar
                    </span>
                  )}
                </div>

                {participantsLoading ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Cargando participantes...</div>
                ) : participantsError ? (
                  <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--error-bg)', color: 'var(--error-fg)', fontSize: 13, fontWeight: 600 }}>
                    {participantsError}
                  </div>
                ) : participants.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Todavía no hay participantes registrados para esta reserva.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {participants.map((participant) => (
                      <div
                        key={participant.id}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 12,
                          border: '1px solid var(--border-subtle)',
                          background: 'var(--surface-2)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                            {participant.displayName} {participant.isMe ? '· Vos' : ''}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {participant.status === 'JOINED' ? 'Confirmado' :
                              participant.status === 'INVITED' ? 'Invitado' :
                              participant.status === 'DECLINED' ? 'Rechazó' :
                              participant.status === 'LEFT' ? 'Se bajó' : 'Removido'}
                            {participant.invitedEmail ? ` · ${participant.invitedEmail}` : ''}
                          </div>
                        </div>
                        {participant.canManage && (
                          <button
                            type="button"
                            className="bk-action-btn bk-action-cancel"
                            style={{ width: 'auto', padding: '8px 12px' }}
                            disabled={participantActionId === participant.id}
                            onClick={() => handleRemoveParticipant(participant)}
                          >
                            <Trash2 size={14} />
                            Quitar
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {selectedBooking.capabilities.canInvitePlayers && (
                  <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      Invitar jugador
                    </div>
                    {inviteBannerError && (
                      <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--error-bg)', color: 'var(--error-fg)', fontSize: 13, fontWeight: 600 }}>
                        {inviteBannerError}
                      </div>
                    )}
                    <div style={{ display: 'grid', gap: 10 }}>
                      <div>
                        <div style={{ position: 'relative' }}>
                          <Mail size={14} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
                          <input
                            type="email"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder="Email del jugador"
                            style={{ width: '100%', padding: '10px 12px 10px 34px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)' }}
                          />
                        </div>
                        {inviteFieldErrors.email && (
                          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--error-fg)' }}>{inviteFieldErrors.email}</div>
                        )}
                      </div>
                      <div>
                        <input
                          type="text"
                          value={inviteName}
                          onChange={(e) => setInviteName(e.target.value)}
                          placeholder="Nombre (opcional)"
                          style={{ width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)' }}
                        />
                        {inviteFieldErrors.name && (
                          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--error-fg)' }}>{inviteFieldErrors.name}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        className="bk-action-btn bk-action-rebook"
                        onClick={handleInviteParticipant}
                        disabled={inviteSubmitting}
                      >
                        <UserPlus size={15} />
                        {inviteSubmitting ? 'Enviando...' : 'Invitar jugador'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="bk-detail-total">
                <div className="bk-detail-total-label">Estado de pago</div>
                <div className="bk-detail-total-val" style={{ fontSize: 18 }}>{selectedBooking.paymentSummary.label}</div>
              </div>

              <div style={{ display: 'grid', gap: 10, marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  Resumen de pago
                </div>

                {checkoutLoading ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Cargando estado de pago...</div>
                ) : checkoutError ? (
                  <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--error-bg)', color: 'var(--error-fg)', fontSize: 13, fontWeight: 600 }}>
                    {checkoutError}
                  </div>
                ) : checkoutSummary ? (
                  <>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                        gap: 10
                      }}
                    >
                      {[
                        { label: 'Total', value: checkoutSummary.account ? formatMoney(checkoutSummary.account.total) : '—' },
                        { label: 'Pagado', value: checkoutSummary.account ? formatMoney(checkoutSummary.account.paid) : '—' },
                        { label: 'Pendiente', value: checkoutSummary.account ? formatMoney(checkoutSummary.account.pending) : '—' }
                      ].map((item) => (
                        <div
                          key={item.label}
                          style={{
                            padding: '12px 14px',
                            borderRadius: 14,
                            background: 'var(--surface-2)',
                            border: '1px solid var(--border-subtle)'
                          }}
                        >
                          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
                            {item.label}
                          </div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{item.value}</div>
                        </div>
                      ))}
                    </div>

                    {checkoutSummary.account?.items?.length ? (
                      <div style={{ display: 'grid', gap: 8 }}>
                        {checkoutSummary.account.items.map((item, index) => (
                          <div
                            key={`${item.label}-${index}`}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 12,
                              background: 'var(--surface-2)',
                              border: '1px solid var(--border-subtle)',
                              display: 'flex',
                              justifyContent: 'space-between',
                              gap: 12
                            }}
                          >
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{item.label}</div>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                {accountItemTypeLabel(item.type)} · {item.quantity} x {formatMoney(item.unitPrice)}
                              </div>
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                              {formatMoney(item.total)}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        No hay conceptos de cobro visibles para esta reserva.
                      </div>
                    )}

                    <div
                      style={{
                        padding: '12px 14px',
                        borderRadius: 12,
                        background: checkoutSummary.checkout.enabled
                          ? 'var(--positive-bg)'
                          : checkoutSummary.checkout.reason === 'NO_PENDING_BALANCE'
                          ? 'var(--positive-bg)'
                          : 'var(--surface-2)',
                        border: checkoutSummary.checkout.enabled
                          ? '1px solid var(--accent-border-subtle)'
                          : checkoutSummary.checkout.reason === 'NO_PENDING_BALANCE'
                          ? '1px solid var(--accent-border-subtle)'
                          : '1px solid var(--border-subtle)',
                        color: checkoutSummary.checkout.enabled
                          ? 'var(--accent-fg)'
                          : checkoutSummary.checkout.reason === 'NO_PENDING_BALANCE'
                          ? 'var(--accent-fg)'
                          : 'var(--text-secondary)',
                        fontSize: 13,
                        fontWeight: 600,
                        lineHeight: 1.5
                      }}
                    >
                      {getCheckoutReasonMessage(checkoutSummary)}
                    </div>

                    {checkoutSummary.checkout.enabled && (
                      <button
                        type="button"
                        className="bk-action-btn bk-action-rebook"
                        onClick={handleStartOnlineCheckout}
                        disabled={checkoutSubmitting}
                      >
                        <Ticket size={15} />
                        {checkoutSubmitting ? 'Redirigiendo...' : 'Pagar online con Mercado Pago'}
                      </button>
                    )}
                  </>
                ) : null}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {activeTab === 'ACTIVE' && selectedBooking.capabilities?.canCancelBooking && (
                  <button className="bk-action-btn bk-action-cancel" onClick={() => handleCancel(selectedBooking.id)}>
                    <XCircle size={15} /> Cancelar reserva
                  </button>
                )}
                {activeTab === 'ACTIVE' && !selectedBooking.capabilities?.canCancelBooking && selectedBooking.capabilities?.canLeaveBooking && (
                  <button className="bk-action-btn bk-action-cancel" onClick={() => handleLeaveBooking(selectedBooking)} disabled={participantActionId === selectedBooking.id}>
                    <LogOut size={15} /> {participantActionId === selectedBooking.id ? 'Procesando...' : 'Salir de la reserva'}
                  </button>
                )}
                {(activeTab === 'PAST' || activeTab === 'CANCELLED') && selectedBooking.club?.slug && (
                  <>
                    {activeTab === 'PAST' && selectedClubHasCompletedBooking && (
                      <button className="bk-action-btn bk-action-review" onClick={() => handleOpenReviewModal(selectedBooking)}>
                        <MessageSquare size={15} /> Dejar / editar reseña del club
                      </button>
                    )}
                    <Link href={`/club/${selectedBooking.club.slug}`} className="bk-action-btn bk-action-rebook">
                      <CheckCircle2 size={15} /> Volver a reservar
                    </Link>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="bk-detail-empty">
              <Ticket size={48} className="bk-detail-empty-icon" />
              <div className="bk-detail-empty-label">Seleccioná un turno<br />para ver el ticket</div>
            </div>
          )}

        </div>
      </div>

      {/* ── CONFIRM/ERROR MODAL ── */}
      <AppModal
        show={modalState.show}
        onClose={closeModal}
        title={modalState.title}
        message={modalState.message}
        cancelText={modalState.cancelText}
        confirmText={modalState.confirmText}
        isWarning={modalState.isWarning}
        onConfirm={modalState.onConfirm}
        confirmDisabled={modalState.confirmDisabled}
        closeOnBackdrop={modalState.closeOnBackdrop}
        closeOnEscape={modalState.closeOnEscape}
      />

      {/* ── REVIEW MODAL ── */}
      {reviewModalOpen && (
        <div
          className="bk-review-overlay"
          onMouseDown={e => { reviewBackdropMouseDownRef.current = e.target === e.currentTarget; }}
          onTouchStart={e => { reviewBackdropMouseDownRef.current = e.target === e.currentTarget; }}
          onClick={e => {
            const started = reviewBackdropMouseDownRef.current;
            reviewBackdropMouseDownRef.current = false;
            if (started && e.target === e.currentTarget && !reviewSaving) setReviewModalOpen(false);
          }}
        >
          <div className="bk-review-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22 }}>
              <div>
                <div className="bk-review-h">Tu reseña del club</div>
                <div className="bk-review-sub">{selectedBooking?.club?.name || 'Club'} · Una reseña por club, editala cuando quieras.</div>
              </div>
              <button
                type="button"
                className="p-public-close-btn"
                onClick={() => setReviewModalOpen(false)}
                disabled={reviewSaving}
                aria-label="Cerrar"
              >
                <X size={15} />
              </button>
            </div>

            {reviewLoading ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Cargando reseña...</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>Calificación</div>
                  <div className="bk-review-stars">
                    {[1, 2, 3, 4, 5].map(v => (
                      <button key={v} type="button" className={`bk-review-star${reviewRating >= v ? ' bk-star-on' : ''}`} onClick={() => setReviewRating(v)} disabled={reviewSaving} aria-label={`${v} ${v === 1 ? 'estrella' : 'estrellas'}`}>
                        <Star size={16} style={{ fill: reviewRating >= v ? 'currentColor' : 'none' }} />
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>Comentario (opcional)</div>
                  <textarea
                    className="bk-review-textarea"
                    rows={4}
                    value={reviewComment}
                    onChange={e => setReviewComment(e.target.value.slice(0, 220))}
                    placeholder="Contá tu experiencia..."
                    disabled={reviewSaving}
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>{reviewComment.length}/220</div>
                </div>
              </div>
            )}

            <div className="bk-review-action-row">
              <button
                type="button"
                className="bk-review-secondary"
                onClick={() => setReviewModalOpen(false)}
                disabled={reviewSaving}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="bk-review-primary"
                onClick={handleSubmitReview}
                disabled={reviewLoading || reviewSaving || reviewRating < 1}
              >
                {reviewSaving ? 'Guardando...' : 'Guardar reseña'}
              </button>
            </div>

          </div>
        </div>
      )}

    </DarkPageLayout>
  );
}
