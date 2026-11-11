import { Fragment, useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import DarkPageLayout from '../components/DarkPageLayout';
import {
  getMyBookings,
  cancelBooking,
  getBookingParticipants,
  getPlayerBookingCheckout,
  createMercadoPagoCheckout,
  type OnlinePaymentScope,
  inviteBookingParticipant,
  removeBookingParticipant,
  getMyBookingInvitations,
  acceptBookingInvitation,
  BOOKING_INVITATIONS_CHANGED_EVENT,
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
import { useClubApp } from '../hooks/useClubApp';
import { getPendingLogoutRedirect } from '../services/AuthService';
import Link from 'next/link';
import UserLoadingState from '../components/UserLoadingState';
import PlayerInviteSearch, { type PickedInvitePlayer } from '../components/players/PlayerInviteSearch';
import PushOptInCard from '../components/push/PushOptInCard';
import { downloadCalendarEvent } from '../utils/calendarInvite';
import { Calendar, Clock, Ticket, ArrowRight, Search, XCircle, CheckCircle2, Star, MessageSquare, X, UserPlus, LogOut, ChevronDown } from 'lucide-react';
import { getApiFieldErrors, normalizeApiError } from '../utils/apiError';
import BusyLabel from '../components/ui/BusyLabel';
import Modal from '../components/ui/Modal';

const APP_NOTICE_EVENT = 'app:notice';

const PAGE_CSS = `
  .bk-action-secondary { background:var(--surface-2); color:var(--text-primary); border:1px solid var(--border); }
  .bk-action-secondary:hover:not(:disabled) { background:var(--surface-3); }
  .bk-share-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 12px; border-radius:12px; background:var(--surface-2); border:1px solid var(--border-subtle); }
  .bk-share-name { font-size:13px; font-weight:700; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bk-share-status { margin-top:2px; font-size:12px; font-weight:600; color:var(--text-muted); }
  .bk-share-status.is-paid { color:var(--accent-fg); }
  .bk-share-amount { flex-shrink:0; font-size:13px; font-weight:800; color:var(--text-primary); white-space:nowrap; }
  .bk-page { padding-top:16px!important; padding-bottom:var(--page-end-gap)!important; }
  .bk-page-head { margin-bottom:28px; display:flex; align-items:flex-end; justify-content:space-between; flex-wrap:wrap; gap:12px; padding-bottom:22px; border-bottom:1px solid var(--border-subtle); }
  .bk-tabs-wrap { margin-bottom:18px; }
  .bk-invite-section { margin-bottom:22px; display:grid; gap:10px; scroll-margin-top:90px; }
  .bk-invite-heading { margin:0; display:flex; align-items:center; gap:8px; color:var(--text-primary); font-size:14px; font-weight:900; }
  .bk-invite-dot { width:8px; height:8px; border-radius:999px; background:var(--brand); }
  .bk-invite-group { display:grid; gap:8px; }
  .bk-invite-day { margin:6px 0 0; color:var(--text-muted); font-size:12px; font-weight:800; letter-spacing:.02em; }
  .bk-invite-card { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:16px; align-items:center; padding:14px 16px; border-radius:18px; background:var(--surface-1); border:1px solid var(--accent-border); }
  .bk-invite-body { min-width:0; display:grid; gap:3px; }
  .bk-invite-title { margin:0; color:var(--text-primary); font-size:15px; font-weight:900; line-height:1.3; }
  .bk-invite-line { margin:0; color:var(--text-secondary); font-size:13px; font-weight:600; line-height:1.45; }
  .bk-invite-meta { margin-top:6px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .bk-invite-share { padding:4px 10px; border-radius:999px; background:var(--positive-bg); color:var(--accent-fg); font-size:12px; font-weight:900; }
  .bk-invite-pay { color:var(--text-muted); font-size:12px; font-weight:650; }
  .bk-invite-actions { display:flex; align-items:center; gap:8px; }
  .bk-invite-actions .bk-action-btn { width:auto; height:38px; padding:0 16px; border-radius:12px; }
  .bk-invite-decline { height:38px; padding:0 14px; border:1px solid var(--border-subtle); border-radius:12px; background:transparent; color:var(--text-muted); font-family:var(--font-sans); font-size:12px; font-weight:800; cursor:pointer; }
  .bk-invite-decline:hover { background:var(--surface-2); color:var(--text-primary); }
  .bk-invite-decline:disabled, .bk-invite-actions .bk-action-btn:disabled { opacity:.6; cursor:not-allowed; }
  .bk-invite-done { display:grid; gap:12px; text-align:left; }
  .bk-invite-done-card { display:grid; gap:12px; padding:14px; border-radius:16px; background:var(--surface-2); border:1px solid var(--border-subtle); }
  .bk-invite-done-row { display:flex; align-items:center; gap:12px; }
  .bk-invite-done-title { color:var(--text-primary); font-size:14px; font-weight:850; }
  .bk-invite-done-sub { margin-top:2px; color:var(--text-muted); font-size:12px; font-weight:650; }
  .bk-invite-done-share { display:flex; align-items:center; justify-content:space-between; gap:12px; padding-top:10px; border-top:1px solid var(--border); color:var(--text-secondary); font-size:12px; font-weight:700; }
  .bk-invite-done-share strong { color:var(--text-primary); font-size:15px; font-weight:900; }
  .bk-invite-calendar { height:44px; display:inline-flex; align-items:center; justify-content:center; gap:8px; border-radius:14px; border:1px solid var(--border); background:var(--surface-1); color:var(--text-primary); font-family:var(--font-sans); font-size:13px; font-weight:800; cursor:pointer; }
  .bk-invite-calendar:hover { background:var(--surface-2); }
  @media(max-width:620px){
    .bk-invite-card { grid-template-columns:minmax(0,1fr); gap:12px; }
    .bk-invite-actions { grid-column:1 / -1; display:grid; grid-template-columns:minmax(0, 2fr) minmax(0, 1fr); }
    .bk-invite-actions .bk-action-btn { width:100%; }
  }
  .bk-layout { display:grid; grid-template-columns:1.4fr 1fr; gap:20px; align-items:start; }
  .bk-layout.bk-layout-empty { align-items:stretch; }
  .bk-list-panel { background:var(--surface-1); border:1px solid var(--border); border-radius:24px; overflow:hidden; }
  .bk-list-panel-head { padding:16px 18px 10px; border-bottom:1px solid var(--border-subtle); }
  .bk-list-body { padding:14px; max-height:calc(100vh - 260px); overflow-y:auto; display:flex; flex-direction:column; gap:8px; }
  .bk-list-body::-webkit-scrollbar { width:4px; }
  .bk-list-body::-webkit-scrollbar-track { background:transparent; }
  .bk-list-body::-webkit-scrollbar-thumb { background:var(--surface-2); border-radius:4px; }
  .bk-card { display:flex; align-items:center; gap:16px; padding:16px 18px; background:var(--surface-1); border:1px solid var(--border-strong); border-radius:16px; cursor:pointer; outline:none; transition:border-color .2s,background .2s,box-shadow .2s; }
  .bk-card:hover { border-color:var(--text-muted); background:var(--surface-2); }
  .bk-card:focus-visible { border-color:var(--accent-fg); box-shadow:var(--shadow-focus); }
  .bk-card.bk-selected { border-color:var(--accent-fg); background:var(--positive-bg); box-shadow:var(--shadow-card); }
  .bk-date-box { width:48px; height:48px; border-radius:12px; display:flex; flex-direction:column; align-items:center; justify-content:center; flex-shrink:0; }
  .bk-date-box-active { background:var(--positive-bg); border:1px solid var(--accent-border-strong); }
  .bk-card.bk-selected .bk-date-box-active { background:var(--brand); border-color:var(--accent-fg); }
  .bk-card.bk-selected .bk-date-box-active .bk-date-day,
  .bk-card.bk-selected .bk-date-box-active .bk-date-month { color:var(--brand-on)!important; }
  .bk-date-box-past { background:var(--surface-2); border:1px solid var(--border); }
  .bk-date-box-cancelled { background:var(--error-bg); border:1px solid var(--error-bg); }
  .bk-date-day { font-size:20px; font-weight:800; line-height:1; color:var(--text-primary); }
  .bk-date-month { font-size:9px; font-weight:700; letter-spacing:.03em; color:var(--text-muted); }
  .bk-card-club { font-size:15px; font-weight:800; color:var(--text-primary); line-height:1.2; margin-bottom:4px; }
  .bk-card-meta { display:flex; align-items:center; gap:8px; font-size:11px; color:var(--text-muted); font-weight:600; flex-wrap:wrap; }
  .bk-card-chip { padding:2px 8px; background:var(--surface-2); border-radius:6px; font-size:10px; color:var(--text-muted); font-weight:600; white-space:nowrap; }
  .bk-card-arrow { color:var(--text-muted); flex-shrink:0; transition:color .2s, transform .2s; }
  /* Detail panel */
  .bk-detail { background:var(--surface-1); border:1px solid var(--border); border-radius:24px; padding:24px; position:sticky; top:80px; max-height:calc(100vh - 96px); overflow-y:auto; }
  .bk-detail::-webkit-scrollbar { width:4px; }
  .bk-detail::-webkit-scrollbar-track { background:transparent; }
  .bk-detail::-webkit-scrollbar-thumb { background:var(--surface-2); border-radius:4px; }
  .bk-ticket-label { display:inline-flex; align-items:center; gap:6px; padding:5px 14px; background:var(--positive-bg); border:1px solid var(--accent-border-subtle); border-radius:999px; font-size:10px; font-weight:800; letter-spacing:.03em; color:var(--accent-fg); margin-bottom:16px; }
  .bk-ticket-label.is-pending { background:var(--warn-bg); border-color:var(--warn-bg); color:var(--warn-fg); }
  .bk-ticket-label.is-cancelled { background:var(--error-bg); border-color:var(--error-bg); color:var(--error-fg); }
  .bk-ticket-label.is-muted { background:var(--surface-2); border-color:var(--border-subtle); color:var(--text-muted); }
  .bk-detail-court { font-size:22px; font-weight:800; color:var(--text-primary); letter-spacing:-.02em; line-height:1.1; margin-bottom:6px; }
  .bk-detail-activity { font-size:11px; font-weight:700; letter-spacing:.03em; color:var(--text-muted); margin-bottom:18px; }
  .bk-detail-row { display:flex; align-items:center; gap:14px; padding:12px 0; border-bottom:1px solid var(--border-subtle); }
  .bk-detail-row:last-of-type { border-bottom:none; }
  .bk-detail-icon { width:36px; height:36px; border-radius:10px; background:var(--surface-2); display:flex; align-items:center; justify-content:center; color:var(--text-muted); flex-shrink:0; }
  .bk-detail-row-label { font-size:10px; font-weight:700; letter-spacing:.03em; color:var(--text-muted); margin-bottom:3px; }
  .bk-detail-row-val { font-size:14px; font-weight:700; color:var(--text-secondary); line-height:1.4; }
  .bk-detail-total { display:flex; align-items:center; justify-content:space-between; padding:18px 0 14px; border-top:1px solid var(--border); margin-top:8px; }
  .bk-detail-total-label { font-size:11px; font-weight:700; letter-spacing:.03em; color:var(--text-muted); }
  .bk-detail-total-val { font-size:26px; font-weight:800; color:var(--text-primary); letter-spacing:-.03em; }
  .bk-collapsible { margin-top:16px; border-top:1px solid var(--border); padding-top:16px; }
  .bk-collapsible-head { width:100%; display:flex; align-items:center; justify-content:space-between; gap:12px; background:none; border:none; padding:0; cursor:pointer; font-family:var(--font-sans); text-align:left; }
  .bk-collapsible-title { font-size:11px; font-weight:800; letter-spacing:.03em; color:var(--text-muted); }
  .bk-collapsible-chevron { color:var(--text-muted); flex-shrink:0; transition:transform .18s ease, color .18s ease; }
  .bk-collapsible-open .bk-collapsible-chevron { transform:rotate(180deg); color:var(--accent-fg); }
  .bk-collapsible-body { margin-top:12px; display:grid; gap:12px; }
  .bk-compact-status { margin-top:16px; padding-top:16px; border-top:1px solid var(--border); display:flex; align-items:flex-start; justify-content:space-between; gap:18px; }
  .bk-compact-status-label { flex:none; color:var(--text-muted); font-size:11px; font-weight:800; letter-spacing:.03em; }
  .bk-compact-status-copy { color:var(--text-secondary); font-size:12px; font-weight:650; line-height:1.45; text-align:right; }
  .bk-player-list { display:grid; gap:8px; }
  .bk-player { min-height:48px; display:flex; align-items:center; gap:10px; padding:9px 11px; border:1px solid var(--border-subtle); border-radius:15px; background:var(--surface-2); }
  .bk-player-icon { width:30px; height:30px; flex:none; display:inline-flex; align-items:center; justify-content:center; border-radius:11px; background:var(--positive-bg); color:var(--accent-fg); font-size:10px; font-weight:900; }
  .bk-player-info { min-width:0; flex:1; }
  .bk-player-name { margin:0; color:var(--text-primary); font-size:12px; line-height:1.35; font-weight:850; overflow-wrap:anywhere; }
  .bk-player-status { margin:2px 0 0; color:var(--text-muted); font-size:10px; line-height:1.35; font-weight:650; overflow-wrap:anywhere; }
  .bk-player-status.is-pending { color:var(--warn-fg); }
  .bk-player-remove { width:34px; height:34px; flex:none; display:inline-flex; align-items:center; justify-content:center; padding:0; border:0; border-radius:11px; background:transparent; color:var(--text-muted); cursor:pointer; }
  .bk-player-remove:hover:not(:disabled) { background:var(--error-bg); color:var(--error-fg); }
  .bk-player-remove:disabled { opacity:.5; cursor:not-allowed; }
  .bk-player-amount { flex:none; margin-left:auto; color:var(--text-primary); font-size:12px; font-weight:850; white-space:nowrap; }
  .bk-pay-mine { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 14px; border-radius:14px; background:var(--surface-2); border:1px solid var(--border-subtle); }
  .bk-pay-mine-label { font-size:11px; font-weight:800; color:var(--text-muted); letter-spacing:.03em; }
  .bk-pay-mine-status { margin-top:2px; font-size:13px; font-weight:750; color:var(--warning-fg, var(--text-secondary)); }
  .bk-pay-mine-status.is-paid { color:var(--accent-fg); }
  .bk-pay-mine-amount { flex:none; font-size:20px; font-weight:900; color:var(--text-primary); white-space:nowrap; }
  .bk-pay-extras { display:grid; gap:6px; padding:12px 14px; border-radius:14px; background:var(--surface-2); border:1px solid var(--border-subtle); }
  .bk-pay-extras-head { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:12px; font-weight:800; color:var(--text-secondary); }
  .bk-pay-extras-head strong { color:var(--text-primary); font-size:14px; font-weight:900; }
  .bk-pay-extra { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:12px; font-weight:600; color:var(--text-muted); }
  .bk-pay-extra-note { font-size:11px; font-weight:650; color:var(--text-muted); }
  .bk-pay-total { font-size:12px; font-weight:650; color:var(--text-muted); line-height:1.45; }
  .bk-pay-note { font-size:12px; font-weight:600; color:var(--text-muted); line-height:1.45; }
  .bk-invite-pending-note { margin:10px 2px 0; color:var(--text-muted); font-size:12px; font-weight:650; line-height:1.45; }
  .bk-action-btn { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:12px 16px; border-radius:14px; font-size:12px; font-weight:800; letter-spacing:.01em; cursor:pointer; font-family:var(--font-sans); border:none; transition:background .15s,transform .15s; text-decoration:none; }
  .bk-action-btn:hover { transform:translateY(-1px); }
  .bk-action-cancel { background:var(--error-bg); border:1px solid var(--error-bg)!important; color:var(--error-fg); }
  .bk-action-cancel:hover { background:var(--error-bg); }
  .bk-action-review { background:var(--positive-bg); border:1px solid var(--accent-border-subtle)!important; color:var(--accent-fg); }
  .bk-action-review:hover { background:var(--accent-bg-muted); }
  .bk-action-rebook { background:var(--brand); color:var(--brand-on); }
  .bk-action-rebook:hover { background:var(--brand-hover); }
  /* Empty state */
  .bk-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:280px; padding:44px 28px; text-align:center; gap:14px; }
  .bk-layout.bk-layout-empty .bk-empty { min-height:160px; padding:20px 18px; }
  .bk-empty-icon { color:var(--border-strong); }
  .bk-empty-title { font-size:13px; font-weight:700; letter-spacing:.03em; color:var(--text-muted); }
  /* Review modal */
  .bk-review-stars { display:flex; gap:8px; }
  .bk-review-star { width:40px; height:40px; border-radius:12px; border:1px solid var(--border); background:var(--surface-2); display:flex; align-items:center; justify-content:center; cursor:pointer; transition:background .15s,border-color .15s; color:var(--text-muted); }
  .bk-review-star.bk-star-on { background:var(--positive-bg); border-color:var(--accent-border); color:var(--accent-fg); }
  .bk-review-textarea { width:100%; background:var(--surface-2); border:1px solid var(--border); border-radius:14px; padding:14px 16px; color:var(--text-primary); font-family:var(--font-sans); font-size:14px; outline:none; resize:none; transition:border-color .2s; }
  .bk-review-textarea:focus { border-color:var(--accent-border); }
  /* Review modal actions */
  @media(max-width:900px){
    .bk-page { padding-top:12px!important; padding-bottom:var(--page-end-gap)!important; }
    .bk-page-head { margin-bottom:22px; padding-bottom:18px; }
    .bk-tabs-wrap { margin-bottom:16px; }
    .bk-layout { grid-template-columns:1fr; gap:16px; }
    .bk-detail { position:static; max-height:none; overflow:visible; padding:20px; }
    .bk-list-body { max-height:none; }
    .bk-list-panel-head { padding:14px 16px 10px; }
    .bk-card { padding:14px 16px; }
  }
  .p-public-root.p-public-theme-light .bk-list-panel,
  .p-public-root.p-public-theme-light .bk-detail { background:var(--surface-1); border-color:var(--border); box-shadow:0 12px 28px var(--border); }
  .p-public-root.p-public-theme-light .bk-card { background:var(--surface-1); border-color:var(--border-strong); }
  .p-public-root.p-public-theme-light .bk-card:hover { border-color:var(--text-muted); background:var(--surface-2); }
  .p-public-root.p-public-theme-light .bk-card:focus-visible { border-color:var(--accent-fg); }
  .p-public-root.p-public-theme-light .bk-card.bk-selected { border-color:var(--accent-fg); background:var(--positive-bg); }
  .p-public-root.p-public-theme-light .bk-date-box-past { background:var(--surface-2); border-color:var(--border); }
  .p-public-root.p-public-theme-light .bk-date-day,
  .p-public-root.p-public-theme-light .bk-card-club,
  .p-public-root.p-public-theme-light .bk-detail-court,
  .p-public-root.p-public-theme-light .bk-detail-total-val { color:var(--text-primary); }
  .p-public-root.p-public-theme-light .bk-date-month,
  .p-public-root.p-public-theme-light .bk-card-meta,
  .p-public-root.p-public-theme-light .bk-detail-row-label,
  .p-public-root.p-public-theme-light .bk-detail-total-label,
  .p-public-root.p-public-theme-light .bk-empty-title { color:var(--text-muted); }
  .p-public-root.p-public-theme-light .bk-card-chip { background:var(--surface-2); color:var(--text-secondary); }
  .p-public-root.p-public-theme-light .bk-detail-row { border-bottom-color:var(--border-subtle); }
  .p-public-root.p-public-theme-light .bk-detail-icon { background:var(--surface-2); color:var(--text-muted); }
  .p-public-root.p-public-theme-light .bk-detail-row-val { color:var(--text-secondary); }
  .p-public-root.p-public-theme-light .bk-detail-total { border-top-color:var(--border); }
  .p-public-root.p-public-theme-light .bk-empty-icon { color:var(--border-strong); }
  .p-public-root.p-public-theme-light .bk-review-star { border-color:var(--border-strong); background:var(--surface-2); color:var(--text-muted); }
  .p-public-root.p-public-theme-light .bk-review-textarea { background:var(--surface-1); border-color:var(--border); color:var(--text-primary); }
  .p-public-root.p-public-theme-light .bk-review-textarea:focus { border-color:var(--accent-border); }
  .p-public-root.p-public-theme-light .bk-date-box-active { background:var(--positive-bg); border-color:var(--accent-border-strong); }
  .p-public-root.p-public-theme-light .bk-card.bk-selected .bk-date-box-active { background:var(--brand); border-color:var(--accent-fg); }
  .p-public-root.p-public-theme-light .bk-date-box-cancelled { background:var(--error-bg); border-color:var(--error-bg); }
  .p-public-root.p-public-theme-light .bk-ticket-label:not(.is-pending):not(.is-cancelled):not(.is-muted) { background:var(--positive-bg); border-color:var(--accent-border-subtle); color:var(--accent-fg); }
  .p-public-root.p-public-theme-light .bk-detail-activity { color:var(--text-muted); }
  .p-public-root.p-public-theme-light .bk-action-cancel { background:var(--error-bg); border-color:var(--error-bg)!important; color:var(--error-fg); }
  .p-public-root.p-public-theme-light .bk-action-cancel:hover { background:var(--error-bg); }
  .p-public-root.p-public-theme-light .bk-action-review { background:var(--positive-bg); border-color:var(--accent-border-subtle)!important; color:var(--accent-fg); }
  .p-public-root.p-public-theme-light .bk-action-review:hover { background:var(--accent-bg-muted); }
  .p-public-root.p-public-theme-light .bk-star-on { background:var(--positive-bg)!important; border-color:var(--accent-border)!important; color:var(--accent-fg)!important; }
  .p-public-root.p-public-theme-light .bk-list-body::-webkit-scrollbar-thumb { background:var(--border); }
  .bk-detail-empty { background:var(--surface-2); border:1px dashed var(--border); border-radius:24px; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:280px; padding:32px; text-align:center; gap:12px; }
  .bk-layout.bk-layout-empty .bk-detail-empty { min-height:100%; padding:20px 18px; }
  .bk-detail-empty-icon { color:var(--border-strong); }
  .bk-detail-empty-label { font-size:12px; font-weight:700; letter-spacing:.03em; color:var(--text-muted); line-height:1.5; }
  .p-public-root.p-public-theme-light .bk-detail-empty { background:var(--surface-2); border-color:var(--border); }
  .p-public-root.p-public-theme-light .bk-detail-empty-icon { color:var(--border-strong); }
  .p-public-root.p-public-theme-light .bk-detail-empty-label { color:var(--text-muted); }
  .p-public-root:not(.p-public-theme-light) .bk-action-rebook { background:linear-gradient(135deg, var(--brand) 0%, var(--brand-hover) 100%); color:var(--brand-on); box-shadow:0 10px 22px rgba(182,243,106,.14); }
  .p-public-root:not(.p-public-theme-light) .bk-action-rebook:hover { background:linear-gradient(135deg, var(--brand-hover) 0%, var(--brand) 100%); }
  @media(max-width:900px){
    .bk-list-panel-head { display:none; }
    .bk-empty-cta { display:none!important; }
    .bk-detail-empty { display:none; }
    .bk-layout.bk-layout-empty { display:block; }
    .bk-layout.bk-has-selection { gap:0; }
    .bk-layout.bk-has-selection .bk-list-panel { border-radius:20px 20px 0 0; }
    .bk-layout.bk-has-selection .bk-detail { border-top:0; border-radius:0 0 20px 20px; }
    .bk-card.bk-selected .bk-card-arrow { color:var(--positive-fg); transform:rotate(90deg); }
  }
`;

// Última carga de Mis reservas en esta visita (solo navegador): al volver a la página se muestra
// al instante y se actualiza por detrás, sin pasar por "Cargando reservas...".
let bookingsPageCache: { userId: number; bookings: PlayerBookingDto[]; invitations: PlayerBookingInvitationDto[] } | null = null;
const readBookingsPageCache = (userId: number | undefined) =>
  typeof window !== 'undefined' && bookingsPageCache && userId && bookingsPageCache.userId === Number(userId)
    ? bookingsPageCache
    : null;

const getInitials = (value: string) =>
  String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk.charAt(0).toUpperCase())
    .join('') || '?';

export default function MyBookingsPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth();
  const clubApp = useClubApp();
  const newBookingHref = clubApp ? `/club/${clubApp.slug}?view=reservar` : '/complejos';
  const openedBookingIdRef = useRef<string | null>(null);
  const [bookings, setBookings] = useState<PlayerBookingDto[]>(() => readBookingsPageCache(user?.id)?.bookings ?? []);
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'PAST' | 'CANCELLED'>('ACTIVE');
  // Reserva a abrir cuando termine de cargar (después de aceptar una invitación).
  const [focusBookingId, setFocusBookingId] = useState<string | null>(null);
  const [joinPaySubmitting, setJoinPaySubmitting] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<PlayerBookingDto | null>(null);
  const selectedDetailRef = useRef<HTMLDivElement | null>(null);
  // Pantalla angosta (una columna): el detalle se abre debajo de la reserva tocada.
  const [isCompact, setIsCompact] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(max-width: 900px)');
    const sync = () => setIsCompact(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);
  const skipDetailAutoScrollRef = useRef(false);
  const listBodyRef = useRef<HTMLDivElement | null>(null);
  const pendingTabScrollRestoreRef = useRef<{ windowY: number; listScrollTop: number } | null>(null);
  const bookingRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [loading, setLoading] = useState(() => !readBookingsPageCache(user?.id));
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
  const [pendingInvitations, setPendingInvitations] = useState<PlayerBookingInvitationDto[]>(() => readBookingsPageCache(user?.id)?.invitations ?? []);
  // Llegando desde el aviso de la barra (/bookings#invitaciones): ir a las invitaciones cuando cargan.
  useEffect(() => {
    if (pendingInvitations.length === 0 || typeof window === 'undefined') return;
    if (window.location.hash !== '#invitaciones') return;
    document.getElementById('invitaciones')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [pendingInvitations.length]);
  const [invitationActionId, setInvitationActionId] = useState<string | null>(null);
  // Llegando desde un aviso push (/bookings?booking=123): abrir esa reserva cuando cargan.
  const deepLinkedBookingRef = useRef<string | null>(null);
  useEffect(() => {
    if (!router.isReady) return;
    const requested = typeof router.query.booking === 'string' ? router.query.booking : '';
    if (!requested || deepLinkedBookingRef.current === requested) return;
    const match = bookings.find((booking) => String(booking.id) === requested);
    if (!match) return;
    deepLinkedBookingRef.current = requested;
    setSelectedBooking(match);
    const restQuery = { ...router.query };
    delete restQuery.booking;
    void router.replace({ pathname: router.pathname, query: restQuery }, undefined, { shallow: true, scroll: false });
  }, [bookings, router]);
  const [participants, setParticipants] = useState<PlayerBookingParticipantDto[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [participantsError, setParticipantsError] = useState('');
  const [checkoutSummary, setCheckoutSummary] = useState<PlayerBookingCheckoutDto | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [participantsExpanded, setParticipantsExpanded] = useState(false);
  const [paymentExpanded, setPaymentExpanded] = useState(false);
  const [inviteBannerError, setInviteBannerError] = useState('');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  // Cambia después de invitar para vaciar el buscador.
  const [inviteSearchKey, setInviteSearchKey] = useState(0);
  const [participantActionId, setParticipantActionId] = useState<string | null>(null);
  const [paymentBanner, setPaymentBanner] = useState<{ tone: 'success' | 'info' | 'error'; message: string } | null>(null);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewAnchorBookingId, setReviewAnchorBookingId] = useState<number | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const tabRefs = useRef<Record<'ACTIVE' | 'PAST' | 'CANCELLED', HTMLButtonElement | null>>({
    ACTIVE: null, PAST: null, CANCELLED: null
  });

  const closeModal = () => setModalState(p => ({ ...p, show: false, onConfirm: undefined, confirmDisabled: undefined, closeOnBackdrop: undefined, closeOnEscape: undefined }));

  const showError = (message: string) => setModalState({ show: true, title: 'Error', message, isWarning: true, cancelText: '', confirmText: 'Aceptar' });
  const flashSuccess = (message: string) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(APP_NOTICE_EVENT, {
      detail: { message, tone: 'success' },
    }));
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

  const loadData = useCallback(async () => {
    if (!user) return [] as PlayerBookingDto[];
    try {
      const [data, invitations] = await Promise.all([
        getMyBookings(user.id),
        getMyBookingInvitations().catch(() => [] as PlayerBookingInvitationDto[])
      ]);
      const sortedBookings = data.sort((a, b) => new Date(b.startDateTime).getTime() - new Date(a.startDateTime).getTime());
      setBookings(sortedBookings);
      setPendingInvitations(invitations);
      bookingsPageCache = { userId: Number(user.id), bookings: sortedBookings, invitations };
      setError('');
      return sortedBookings;
    } catch (err: unknown) {
      setError(toPublicBookingErrorMessage(err, 'No pudimos cargar tus reservas. Recargá la página.'));
      return [] as PlayerBookingDto[];
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

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
    active.sort((a, b) => new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime());
    return { activeBookings: active, pastBookings: past, cancelledBookings: cancelled };
  }, [bookings]);

  // Abrir el partido tocado en Inicio o la reserva recién confirmada.
  // La lista ya está limitada a reservas accesibles por la sesión actual.
  const requestedBookingId = typeof router.query.bookingId === 'string' ? router.query.bookingId : null;
  useEffect(() => {
    if (!router.isReady || loading || !requestedBookingId || openedBookingIdRef.current === requestedBookingId) return;
    const booking = bookings.find(item => item.id === requestedBookingId);
    if (!booking) return;
    openedBookingIdRef.current = requestedBookingId;
    setActiveTab(booking.status === 'CANCELLED' ? 'CANCELLED' : pastBookings.includes(booking) ? 'PAST' : 'ACTIVE');
    setSelectedBooking(booking);
  }, [bookings, loading, pastBookings, requestedBookingId, router.isReady]);

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
      setParticipantsExpanded(false);
      setPaymentExpanded(false);
      return;
    }

    // Si todavía puede invitar, los jugadores quedan a la vista (el checkout le dijo que invite desde acá).
    setParticipantsExpanded(Boolean(selectedBooking.capabilities?.canInvitePlayers));
    setPaymentExpanded(false);

    let cancelled = false;
    setParticipantsLoading(true);
    setParticipantsError('');
    setInviteBannerError('');
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
    if (skipDetailAutoScrollRef.current) {
      skipDetailAutoScrollRef.current = false;
      return;
    }
    const el = selectedDetailRef.current;
    if (!el) return;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true }); }
    catch { el.scrollIntoView(); }
  }, [selectedBooking]);

  useEffect(() => {
    if (!focusBookingId) return;
    const booking = bookings.find((item) => String(item.id) === focusBookingId);
    if (!booking) return;
    setFocusBookingId(null);
    setActiveTab('ACTIVE');
    setSelectedBooking(booking);
  }, [focusBookingId, bookings]);

  useEffect(() => {
    const pending = pendingTabScrollRestoreRef.current;
    if (!pending || typeof window === 'undefined') return;
    pendingTabScrollRestoreRef.current = null;

    const restoreScroll = () => {
      window.scrollTo({ top: pending.windowY, behavior: 'auto' });
      if (!listBodyRef.current) return;
      const maxScrollTop = Math.max(listBodyRef.current.scrollHeight - listBodyRef.current.clientHeight, 0);
      listBodyRef.current.scrollTop = Math.min(pending.listScrollTop, maxScrollTop);
    };

    const frame = window.requestAnimationFrame(() => restoreScroll());
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, selectedBooking, visibleBookings.length]);

  const formatTime = (date: Date, timeZone?: string | null) =>
    date.toLocaleTimeString('es-AR', { ...(timeZone ? { timeZone } : {}), hour: '2-digit', minute: '2-digit', hour12: false });

  const formatWeekday = (date: Date, timeZone?: string | null) =>
    date.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', ...(timeZone ? { timeZone } : {}) })
      .replace(',', '')
      .replace(/^\w/, c => c.toUpperCase());

  const getDateBoxParts = (date: Date, timeZone?: string | null) => {
    const formatter = new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: 'short',
      ...(timeZone ? { timeZone } : {}),
    });
    const parts = formatter.formatToParts(date);
    const day = parts.find((part) => part.type === 'day')?.value ?? '--';
    const month = (parts.find((part) => part.type === 'month')?.value ?? '---').replace('.', '');
    return { day, month };
  };

  const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-AR')}`;

  const getDuration = (b: PlayerBookingDto) =>
    Math.max(0, Math.round((new Date(b.endDateTime).getTime() - new Date(b.startDateTime).getTime()) / 60000)) || 60;

  // Lo que falta de la parte de cancha, sin consumos.
  const minePartPending = (checkout: PlayerBookingCheckoutDto) =>
    Math.max(0, (checkout.shares?.mine?.pending || 0) - (checkout.shares?.mine?.extrasPending || 0));

  // Seña pendiente (club "Con seña"): botón para pagarla y hasta cuándo, si es obligatoria.
  const renderDepositAction = (checkout: PlayerBookingCheckoutDto) => {
    const deposit = checkout.deposit;
    if (!deposit || deposit.covered || deposit.remainingAmount <= 0.009) return null;
    const dueLabel = deposit.dueAt
      ? new Date(deposit.dueAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
      : null;
    return (
      <>
        <div className="bk-pay-note">
          {deposit.onlineRequired && dueLabel
            ? `Tu reserva queda confirmada al pagar la seña. Pagala antes de las ${dueLabel} o el turno se libera.`
            : 'Tu reserva queda confirmada al pagar la seña.'}
        </div>
        {checkout.checkout.enabled && (
          <button
            type="button"
            className="bk-action-btn bk-action-rebook"
            onClick={() => { void handleStartOnlineCheckout('DEPOSIT'); }}
            disabled={checkoutSubmitting}
          >
            <BusyLabel busy={checkoutSubmitting}>
              <Ticket size={15} />
              {`Pagar seña · ${formatMoney(deposit.remainingAmount)}`}
            </BusyLabel>
          </button>
        )}
      </>
    );
  };

  // Precio online con descuento y precio efectivo en el club, si el club los tiene.
  const renderPriceHintsNote = (checkout: PlayerBookingCheckoutDto) => {
    const hints = checkout.priceHints;
    if (!hints || (hints.onlineAmount == null && hints.cashAmount == null) || hints.listAmount <= 0.009) return null;
    const parts = [
      hints.onlineAmount != null ? `online ${formatMoney(hints.onlineAmount)} (${hints.onlinePercent}% off)` : null,
      hints.cashAmount != null ? `en efectivo en el club ${formatMoney(hints.cashAmount)}` : null,
    ].filter(Boolean);
    return (
      <div className="bk-pay-note">
        Precio de lista {formatMoney(hints.listAmount)} · {parts.join(' · ')}
      </div>
    );
  };

  const minePayLabel = (checkout: PlayerBookingCheckoutDto) => {
    const hasExtras = (checkout.shares?.mine?.extrasPending || 0) > 0.009;
    if (!hasExtras) return 'Pagar mi parte';
    return minePartPending(checkout) > 0.009 ? 'Pagar mi parte y consumos' : 'Pagar consumos';
  };

  const sharesTotalCopy = (checkout: PlayerBookingCheckoutDto) => {
    const players = checkout.shares?.players || [];
    const empty = players.filter((player) => player.isEmpty).length;
    return [
      `Total de la reserva ${checkout.account ? formatMoney(checkout.account.total) : '—'}`,
      `${players.filter((player) => player.paid).length} de ${players.length} partes pagas`,
      empty ? (empty === 1 ? 'el lugar libre se paga en el club' : `los ${empty} lugares libres se pagan en el club`) : null
    ].filter(Boolean).join(' · ');
  };

  const sharesPayNote = (checkout: PlayerBookingCheckoutDto) => {
    const shares = checkout.shares;
    if (!shares?.canPayAll || shares.allPending <= (shares.mine?.pending || 0) + 0.009) {
      return 'Cada jugador paga la suya, online o en el club.';
    }
    const others = shares.players
      .filter((player) => !player.isMine && !player.isEmpty && !player.paid)
      .map((player) => player.displayName || `Lugar ${player.slotIndex}`);
    return others.length
      ? `"Pagar todas" incluye la parte de ${others.join(', ').replace(/\.$/, '')}. Cada jugador también puede pagar la suya.`
      : 'Cada jugador también puede pagar la suya.';
  };

  const getCheckoutReasonMessage = (checkout: PlayerBookingCheckoutDto) => {
    if (checkout.checkout.enabled) {
      return checkout.shares
        ? 'Podés pagar tu parte online con Mercado Pago. Cada jugador paga la suya.'
        : 'Mercado Pago está disponible para este pago. Cuando avances, el monto se toma desde la cuenta real de la reserva.';
    }
    switch (checkout.checkout.reason) {
      case 'MEMBER_PRICE_PENDING':
        return 'Tu precio socio todavía no está validado. Aceptá la invitación o validalo en el club; así pagás el precio que te corresponde.';
      case 'ACCOUNT_MISSING':
        return 'El club todavía no confirmó la reserva. Cuando la confirme vas a ver acá lo que hay que pagar.';
      case 'NO_PENDING_BALANCE':
        return checkout.shares ? 'Tu parte ya está paga.' : 'Esta reserva no tiene saldo pendiente por ahora.';
      case 'PARTICIPANT_PAYMENTS_NOT_SUPPORTED':
        return 'Por ahora el pago online está disponible solo para el titular de la reserva. Si necesitás resolver un pago, contactá al club.';
      case 'BOOKING_HAS_REFUNDS':
        return 'Esta reserva tiene devoluciones o ajustes en revisión. Contactá al club para resolver cualquier cambio de pago.';
      case 'BOOKING_NOT_PAYABLE':
        return (checkout.account?.pending || 0) > 0.009
          ? `Lo que falta (${formatMoney(Number(checkout.account?.pending || 0))}) se paga en el club.`
          : 'Esta reserva ya no se puede pagar desde la app.';
      case 'PAY_AT_CLUB':
        return 'Este club cobra las reservas en el mostrador. Cada jugador abona su parte al llegar.';
      case 'PROVIDER_NOT_CONFIGURED':
        return 'El pago online todavía no está disponible para este club. Contactá al club para pagar o resolver cambios.';
      default:
        return 'Todavía no pudimos habilitar el pago online para esta reserva.';
    }
  };

  const invitationPayCopy = (invitation: PlayerBookingInvitationDto) =>
    invitation.onlinePaymentAvailable ? 'Pagás online o en el club' : 'Se paga en el club';

  const invitationSpotsCopy = (invitation: PlayerBookingInvitationDto) => {
    if (invitation.openSpots == null) return null;
    if (invitation.openSpots === 0) return 'Sos el lugar que falta';
    return invitation.openSpots === 1 ? 'Queda 1 lugar más' : `Quedan ${invitation.openSpots} lugares más`;
  };

  // Pagar la parte propia apenas se acepta la invitación.
  const handlePayJoinedShare = async (bookingId: string) => {
    if (joinPaySubmitting) return;
    setJoinPaySubmitting(true);
    try {
      const payload = await createMercadoPagoCheckout(bookingId, 'OWN_SHARE');
      if (typeof window !== 'undefined') window.location.assign(payload.initPoint);
    } catch (error) {
      closeModal();
      showError(toPublicBookingErrorMessage(error, 'No pudimos iniciar el pago online. Podés pagar desde la reserva o en el club.'));
    } finally {
      setJoinPaySubmitting(false);
    }
  };

  const handleStartOnlineCheckout = async (scope: OnlinePaymentScope = 'OWN_SHARE') => {
    if (!selectedBooking || checkoutSubmitting) return;
    if (scope === 'OWN_SHARE' && !checkoutSummary?.checkout.enabled) return;
    if (scope === 'ALL_SHARES' && !checkoutSummary?.shares?.canPayAll) return;
    if (scope === 'DEPOSIT' && !((checkoutSummary?.deposit?.remainingAmount || 0) > 0.009)) return;
    setCheckoutSubmitting(true);
    try {
      const payload = await createMercadoPagoCheckout(selectedBooking.id, scope);
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

  // Solo se puede cancelar si no hay pagos registrados, así que es gratis.
  const cancelConfirmMessage = (id: string) => {
    const booking = bookings.find((item) => String(item.id) === String(id));
    if (!booking) return 'Vas a cancelar tu reserva. Es gratis y le avisamos al club.';
    const timeZone = booking.club?.timeZone || 'America/Argentina/Buenos_Aires';
    const start = new Date(booking.startDateTime);
    const day = new Intl.DateTimeFormat('es-AR', { timeZone, weekday: 'long', day: 'numeric' }).format(start).replace(',', '');
    return `Vas a cancelar el ${day} a las ${formatTime(start, timeZone)}${booking.club?.name ? ` en ${booking.club.name}` : ''}. Es gratis y le avisamos al club.`;
  };

  const handleCancel = (id: string) => {
    if (cancellingBooking) return;
    setModalState({
      show: true,
      title: '¿Cancelar esta reserva?',
      message: cancelConfirmMessage(id),
      isWarning: true,
      confirmText: 'Cancelar reserva',
      cancelText: 'Volver',
      // Cerrar sin confirmar equivale a "Volver"; solo se bloquea mientras se cancela.
      closeOnBackdrop: true,
      closeOnEscape: true,
      confirmDisabled: false,
      onConfirm: async () => {
        if (cancellingBooking) return;
        setCancellingBooking(true);
        setModalState(prev => ({ ...prev, confirmDisabled: true, closeOnBackdrop: false, closeOnEscape: false }));
        try {
          await cancelBooking(id);
          closeModal();
          setActiveTab('ACTIVE');
          setSelectedBooking(null);
          if (requestedBookingId) {
            const nextQuery = { ...router.query };
            delete nextQuery.bookingId;
            void router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true });
          }
          await loadData();
          flashSuccess('Reserva cancelada.');
        } catch (e: any) {
          setModalState(prev => ({
            ...prev,
            confirmDisabled: false,
            message: (
              <span>
                {cancelConfirmMessage(id)}
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

  const getInvitationLabels = (invitation: PlayerBookingInvitationDto) => {
    const start = new Date(invitation.startDateTime);
    const end = new Date(invitation.endDateTime);
    const timeZone = invitation.club.timeZone;
    const longDate = start
      .toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', ...(timeZone ? { timeZone } : {}) })
      .replace(',', '');
    return {
      start,
      end,
      dateBox: getDateBoxParts(start, timeZone),
      longDate: longDate.charAt(0).toUpperCase() + longDate.slice(1),
      timeRange: `${formatTime(start, timeZone)} – ${formatTime(end, timeZone)}`,
      activity: [invitation.activityName, invitation.formatName].filter(Boolean).join(' '),
      inviter: String(invitation.invitedByName || '').trim(),
    };
  };

  const invitationInviters = Array.from(new Set(pendingInvitations.map((invitation) => String(invitation.invitedByName || '').trim())));
  const sharedInviter = invitationInviters.length === 1 && invitationInviters[0] ? invitationInviters[0] : null;

  const handleAcceptInvitation = async (invitation: PlayerBookingInvitationDto) => {
    if (invitationActionId) return;
    setInvitationActionId(invitation.id);
    try {
      await acceptBookingInvitation(invitation.id);
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(BOOKING_INVITATIONS_CHANGED_EVENT));
      await loadData();
      // La reserva aceptada queda abierta en Mis reservas, detrás del aviso.
      setFocusBookingId(invitation.bookingId);
      const labels = getInvitationLabels(invitation);
      const inviterFirstName = labels.inviter.split(' ')[0];
      setModalState({
        show: true,
        title: '¡Listo, estás anotado!',
        isWarning: false,
        cancelText: '',
        confirmText: 'Entendido',
        message: (
          <div className="bk-invite-done">
            <p style={{ margin: 0 }}>
              Ya está en tus reservas activas.{inviterFirstName ? ` ${inviterFirstName} lo ve en su reserva.` : ''}
            </p>
            <div className="bk-invite-done-card">
              <div className="bk-invite-done-row">
                <div className="bk-date-box bk-date-box-active">
                  <span className="bk-date-day" style={{ color: 'var(--accent-fg)' }}>{labels.dateBox.day}</span>
                  <span className="bk-date-month">{labels.dateBox.month}</span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="bk-invite-done-title">{labels.longDate} · {labels.timeRange}</div>
                  <div className="bk-invite-done-sub">
                    {[labels.activity, invitation.court.name, invitation.club.name].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
              {invitation.myShareAmount != null && (
                <div className="bk-invite-done-share">
                  <span>Tu parte · {invitationPayCopy(invitation).toLowerCase()}</span>
                  <strong>{formatMoney(Number(invitation.myShareAmount))}</strong>
                </div>
              )}
            </div>
            {invitation.myShareAmount != null && invitation.onlinePaymentAvailable && (
              <button
                type="button"
                className="bk-action-btn bk-action-rebook"
                onClick={() => { void handlePayJoinedShare(invitation.bookingId); }}
              >
                <Ticket size={15} />
                Pagar mi parte ahora · {formatMoney(Number(invitation.myShareAmount))}
              </button>
            )}
            <button
              type="button"
              className="bk-invite-calendar"
              onClick={() => downloadCalendarEvent({
                uid: `booking-${invitation.bookingId}`,
                title: [labels.activity || 'Partido', invitation.club.name].join(' · '),
                start: labels.start,
                end: labels.end,
                location: `${invitation.club.name} · ${invitation.court.name}`,
                description: labels.inviter ? `Te invitó ${labels.inviter}.` : null,
              })}
            >
              <Calendar size={15} />
              Agregar a mi calendario
            </button>
          </div>
        ),
        onConfirm: () => closeModal(),
      });
    } catch (error) {
      showError(toPublicBookingErrorMessage(error, 'No pudimos aceptar la invitación.'));
    } finally {
      setInvitationActionId(null);
    }
  };

  // "No puedo": pide confirmación antes de rechazar, para no perder la invitación por un toque sin querer.
  const handleDeclineInvitation = (invitation: PlayerBookingInvitationDto) => {
    if (invitationActionId) return;
    const inviterFirstName = getInvitationLabels(invitation).inviter.split(' ')[0];
    showConfirm({
      title: '¿No podés ir?',
      message: `Vas a rechazar la invitación y tu lugar queda libre${inviterFirstName ? ` para que ${inviterFirstName} invite a otra persona` : ''}.`,
      confirmText: 'Rechazar invitación',
      cancelText: 'Volver',
      isWarning: true,
      onConfirm: async () => {
        setInvitationActionId(invitation.id);
        try {
          await declineBookingInvitation(invitation.id);
          if (typeof window !== 'undefined') window.dispatchEvent(new Event(BOOKING_INVITATIONS_CHANGED_EVENT));
          await loadData();
          flashSuccess('Invitación rechazada.');
        } catch (error) {
          showError(toPublicBookingErrorMessage(error, 'No pudimos rechazar la invitación.'));
        } finally {
          setInvitationActionId(null);
        }
      }
    });
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

  const handleInvitePicked = async (picked: PickedInvitePlayer) => {
    if (!selectedBooking || inviteSubmitting) return;
    setInviteSubmitting(true);
    setInviteBannerError('');
    try {
      await inviteBookingParticipant(
        selectedBooking.id,
        picked.kind === 'token'
          ? { inviteToken: picked.inviteToken, name: picked.displayName }
          : {
              ...(picked.kind === 'email' ? { email: picked.value } : { dni: picked.value }),
              ...(picked.displayName ? { name: picked.displayName } : {})
            }
      );
      setInviteSearchKey((current) => current + 1);
      await refreshSelectedParticipants();
      await loadData();
    } catch (error) {
      const fieldErrors = getApiFieldErrors(error);
      const fieldMessage = fieldErrors.email || fieldErrors.dni || fieldErrors.name;
      setInviteBannerError(fieldMessage || toPublicBookingErrorMessage(error, 'No pudimos enviar la invitación.'));
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
    PAST: `Pasadas${pastBookings.length ? ` (${pastBookings.length})` : ''}`,
    CANCELLED: `Canceladas${cancelledBookings.length ? ` (${cancelledBookings.length})` : ''}`
  };
  const roleLabel = (booking: PlayerBookingDto) => booking.myRole === 'PARTICIPANT' ? 'Participante' : 'Titular';
  const bookingStatusLabel = (booking: PlayerBookingDto) => {
    const hasEnded = new Date(booking.endDateTime || booking.startDateTime).getTime() < Date.now();
    if (booking.status === 'CANCELLED') return 'Reserva cancelada';
    // Pasó el turno y el club nunca la confirmó: no es una reserva "finalizada".
    if (booking.status === 'PENDING' && hasEnded) return 'No confirmada por el club';
    if (booking.status === 'COMPLETED' || hasEnded) return 'Reserva finalizada';
    switch (booking.status) {
      case 'PENDING': return 'Pendiente de confirmación';
      case 'CONFIRMED': return 'Reserva confirmada';
    }
  };
  const paymentStatusLabel = (booking: PlayerBookingDto) => {
    const remaining = Number(booking.paymentSummary.remainingAmount || 0);
    const hasEnded = new Date(booking.endDateTime || booking.startDateTime).getTime() < Date.now();
    switch (booking.paymentSummary.status) {
      case 'PAID': return 'Pagado';
      case 'AWAITING_CONFIRMATION': return 'Sin confirmar';
      case 'NOT_CONFIRMED': return 'No confirmada';
      // Después del turno, lo útil es cuánto falta; antes, alcanza con saber que se paga.
      case 'PARTIAL': return remaining > 0.009 ? `Falta pagar ${formatMoney(remaining)}` : 'Pago parcial';
      case 'PENDING': return hasEnded && remaining > 0.009 ? `Falta pagar ${formatMoney(remaining)}` : 'Se paga en el club';
      default:
        return '';
    }
  };

  // Reserva sin cuenta todavía: lo que sabemos del precio, en vez de "consultá con el club".
  const noAccountPaymentCopy = (booking: PlayerBookingDto) => {
    const summary = booking.paymentSummary;
    if (summary.status === 'AWAITING_CONFIRMATION') {
      const share = Number(summary.myShareAmount || 0);
      const total = Number(summary.totalAmount || 0);
      if (share > 0.009) return `Tu parte ${formatMoney(share)} · se paga en el club cuando confirmen`;
      if (total > 0.009) return `${formatMoney(total)} · se paga en el club cuando confirmen`;
      return 'Se paga en el club cuando confirmen';
    }
    if (summary.status === 'NOT_CONFIRMED') return 'No se confirmó: no hay nada para pagar';
    if (booking.status === 'CANCELLED') return 'No hay nada para pagar';
    return summary.label || 'Se paga en el club';
  };

  const paymentStatusTone = (booking: PlayerBookingDto) => {
    switch (booking.paymentSummary.status) {
      case 'PAID':
        return { background: 'var(--positive-bg)', border: 'var(--accent-border-subtle)', color: 'var(--accent-fg)' };
      case 'PARTIAL':
        return { background: 'var(--surface-2)', border: 'var(--accent-border-subtle)', color: 'var(--text-secondary)' };
      case 'PENDING':
      case 'AWAITING_CONFIRMATION':
        return { background: 'var(--warn-bg)', border: 'var(--warn-bg)', color: 'var(--warn-fg)' };
      case 'NOT_CONFIRMED':
        return { background: 'var(--surface-2)', border: 'var(--border-subtle)', color: 'var(--text-muted)' };
      case 'NOT_REQUIRED':
      default:
        return { background: 'var(--surface-2)', border: 'var(--border-subtle)', color: 'var(--text-secondary)' };
    }
  };

  const handleTabChange = (tab: 'ACTIVE' | 'PAST' | 'CANCELLED') => {
    if (tab === activeTab) return;
    pendingTabScrollRestoreRef.current = {
      windowY: typeof window !== 'undefined' ? window.scrollY : 0,
      listScrollTop: listBodyRef.current?.scrollTop ?? 0,
    };
    skipDetailAutoScrollRef.current = true;
    setActiveTab(tab);
    setSelectedBooking(null);
  };

  const isDualEmptyState = !loading && !error && visibleBookings.length === 0 && !selectedBooking;
  const activeParticipants = participants.filter((participant) => participant.status === 'INVITED' || participant.status === 'JOINED');
  const participantCapacity = selectedBooking?.playerCount && selectedBooking.playerCount > 0
    ? selectedBooking.playerCount
    : null;
  const occupiedParticipantSlots = selectedBooking
    ? Math.min(1 + activeParticipants.length, participantCapacity ?? Number.POSITIVE_INFINITY)
    : 0;
  // Parte de cada jugador (reservas por jugador): se muestra junto a su nombre.
  const shareByParticipantId = new Map(
    (checkoutSummary?.shares?.players || [])
      .filter((player) => player.participantId)
      .map((player) => [String(player.participantId), player] as const)
  );
  const ownerShare = checkoutSummary?.shares?.players.find((player) => player.slotIndex === 1) ?? null;
  const sharePayLabel = (share: { paid: boolean; memberPricePending: boolean } | null) => {
    if (!share) return '';
    if (share.paid) return ' · Pagó su parte';
    return share.memberPricePending ? ' · Precio socio por validar' : ' · Pago pendiente';
  };
  const participantTeamIsFull = Boolean(participantCapacity && occupiedParticipantSlots >= participantCapacity);
  const pendingInviteNames = activeParticipants
    .filter((participant) => participant.status === 'INVITED')
    .map((participant) => participant.displayName);
  const confirmedParticipantSlots = Math.max(0, occupiedParticipantSlots - pendingInviteNames.length);
  const canInviteParticipant = Boolean(selectedBooking?.capabilities.canInvitePlayers && !participantTeamIsFull);
  const hasNoPublishedAccount = Boolean(
    selectedBooking
    && !checkoutLoading
    && !checkoutError
    && checkoutSummary
    && !checkoutSummary.account
  );

  // El detalle va a la derecha en desktop y, en pantallas angostas, debajo de la reserva tocada.
  const renderDetail = () => {
    if (!selectedBooking) return null;
    return (
              <div
                className="bk-detail"
                ref={el => { selectedDetailRef.current = el; }}
                tabIndex={-1}
              >
                <div className={`bk-ticket-label${selectedBooking.status === 'PENDING' ? (activeTab === 'ACTIVE' ? ' is-pending' : ' is-muted') : ''}${selectedBooking.status === 'CANCELLED' ? ' is-cancelled' : ''}`}>
                  <Ticket size={12} /> {bookingStatusLabel(selectedBooking)}
                </div>
                <div className="bk-detail-court">{selectedBooking.court?.name || 'Cancha'}</div>
                <div className="bk-detail-activity">{selectedBooking.activity?.name || 'Deporte'} · {selectedBooking.club?.name}</div>
  
                <hr className="p-public-divider" style={{ margin: '0 0 16px' }} />
  
                <div>
                  <div className="bk-detail-row">
                    <div className="bk-detail-icon"><Calendar size={16} /></div>
                    <div>
                      <div className="bk-detail-row-label">Fecha</div>
                      <div className="bk-detail-row-val">{formatWeekday(new Date(selectedBooking.startDateTime), selectedBooking.club?.timeZone)}</div>
                    </div>
                  </div>
                  <div className="bk-detail-row">
                    <div className="bk-detail-icon"><Clock size={16} /></div>
                    <div>
                      <div className="bk-detail-row-label">Horario</div>
                      <div className="bk-detail-row-val">{formatTime(new Date(selectedBooking.startDateTime), selectedBooking.club?.timeZone)} a {formatTime(new Date(selectedBooking.endDateTime || selectedBooking.startDateTime), selectedBooking.club?.timeZone)} · {getDuration(selectedBooking)} min</div>
                    </div>
                  </div>
                </div>
  
                <div className={`bk-collapsible${participantsExpanded ? ' bk-collapsible-open' : ''}`}>
                  <button
                    type="button"
                    className="bk-collapsible-head"
                    onClick={() => setParticipantsExpanded((prev) => !prev)}
                    aria-expanded={participantsExpanded}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.03em', color: 'var(--text-muted)' }}>
                        Participantes
                      </div>
                      {participantCapacity ? (
                        <span className="bk-card-chip" title={selectedBooking.formatName || undefined}>
                          {selectedBooking.formatName ? `${selectedBooking.formatName} · ` : ''}
                          {pendingInviteNames.length
                            ? `${confirmedParticipantSlots} de ${participantCapacity} confirmados`
                            : `${occupiedParticipantSlots} de ${participantCapacity}`}
                        </span>
                      ) : canInviteParticipant ? (
                        <span className="bk-card-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <UserPlus size={12} /> Podés invitar
                        </span>
                      ) : null}
                    </div>
                    <ChevronDown size={14} className="bk-collapsible-chevron" />
                  </button>
  
                  {participantsExpanded && (
                    <div className="bk-collapsible-body">
                      {participantsLoading ? (
                        <UserLoadingState mode="inline" message="Cargando jugadores..." />
                      ) : participantsError ? (
                        <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--error-bg)', color: 'var(--error-fg)', fontSize: 13, fontWeight: 600 }}>
                          {participantsError}
                        </div>
                      ) : (
                        <div className="bk-player-list">
                          <div className="bk-player">
                            <span className="bk-player-icon" aria-hidden="true">{getInitials(selectedBooking.owner.displayName)}</span>
                            <div className="bk-player-info">
                              <p className="bk-player-name">
                                {selectedBooking.owner.displayName}{selectedBooking.myRole === 'OWNER' ? ' · Vos' : ''}
                              </p>
                              <p className="bk-player-status">{selectedBooking.status === 'PENDING' ? 'Titular · Esperando al club' : 'Titular · Confirmado'}{sharePayLabel(ownerShare)}</p>
                            </div>
                            {ownerShare && <span className="bk-player-amount">{formatMoney(ownerShare.amount)}</span>}
                          </div>
                          {activeParticipants.map((participant) => {
                            const share = participant.status === 'JOINED' ? shareByParticipantId.get(participant.id) ?? null : null;
                            return (
                            <div className="bk-player" key={participant.id}>
                              <span className="bk-player-icon" aria-hidden="true">{getInitials(participant.displayName)}</span>
                              <div className="bk-player-info">
                                <p className="bk-player-name">{participant.displayName} {participant.isMe ? '· Vos' : ''}</p>
                                <p className={`bk-player-status${participant.status === 'INVITED' ? ' is-pending' : ''}`}>
                                  {participant.status === 'JOINED' ? 'Confirmado' :
                                    participant.status === 'INVITED' ? 'Invitación enviada' :
                                    participant.status === 'DECLINED' ? 'Rechazó la invitación' :
                                    participant.status === 'LEFT' ? 'Se bajó de la reserva' : 'Removido'}
                                  {sharePayLabel(share)}
                                  {participant.invitedEmail ? ` · ${participant.invitedEmail}` : ''}
                                </p>
                              </div>
                              {share && <span className="bk-player-amount">{formatMoney(share.amount)}</span>}
                              {participant.canManage && (
                                <button
                                  type="button"
                                  className="bk-player-remove"
                                  aria-label={`Quitar a ${participant.displayName}`}
                                  disabled={participantActionId === participant.id}
                                  onClick={() => handleRemoveParticipant(participant)}
                                >
                                  <X size={15} aria-hidden="true" />
                                </button>
                              )}
                            </div>
                            );
                          })}
                        </div>
                      )}
  
                      {pendingInviteNames.length > 0 && (
                        <p className="bk-invite-pending-note">
                          {pendingInviteNames.length === 1
                            ? `Falta que ${pendingInviteNames[0]} acepte la invitación.`
                            : `Faltan aceptar: ${pendingInviteNames.join(', ')}.`}
                        </p>
                      )}
  
                      {canInviteParticipant && (
                        <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
                          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.03em', color: 'var(--text-muted)' }}>
                            Invitar jugador
                          </div>
                          {inviteBannerError && (
                            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--error-bg)', color: 'var(--error-fg)', fontSize: 13, fontWeight: 600 }}>
                              {inviteBannerError}
                            </div>
                          )}
                          <PlayerInviteSearch
                            key={`${selectedBooking.id}-${inviteSearchKey}`}
                            bookingId={selectedBooking.id}
                            clubLabel={selectedBooking.club?.name || null}
                            busy={inviteSubmitting}
                            autoFocus={false}
                            onPick={handleInvitePicked}
                          />
                          {inviteSubmitting && (
                            <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--text-muted)' }}>Enviando invitación…</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
  
                {hasNoPublishedAccount ? (
                  <div className="bk-compact-status" style={{ marginBottom: 18 }}>
                    <span className="bk-compact-status-label">Estado de pago</span>
                    <span className="bk-compact-status-copy">{noAccountPaymentCopy(selectedBooking)}</span>
                  </div>
                ) : (
                <div className={`bk-collapsible${paymentExpanded ? ' bk-collapsible-open' : ''}`} style={{ marginBottom: 18 }}>
                  <button
                    type="button"
                    className="bk-collapsible-head"
                    onClick={() => setPaymentExpanded((prev) => !prev)}
                    aria-expanded={paymentExpanded}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      <div className="bk-detail-total-label">Estado de pago</div>
                    </div>
                    <ChevronDown size={14} className="bk-collapsible-chevron" />
                  </button>
  
                  {paymentExpanded && (
                    <div className="bk-collapsible-body">
                      <div style={{ display: 'grid', gap: 10 }}>
                        {checkoutLoading ? (
                          <UserLoadingState mode="inline" message="Cargando pago..." />
                        ) : checkoutError ? (
                          <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--error-bg)', color: 'var(--error-fg)', fontSize: 13, fontWeight: 600 }}>
                            {checkoutError}
                          </div>
                        ) : checkoutSummary?.shares ? (
                          <>
                            {checkoutSummary.shares.mine && (
                              <div className="bk-pay-mine">
                                <div style={{ minWidth: 0 }}>
                                  <div className="bk-pay-mine-label">Tu parte</div>
                                  <div className={`bk-pay-mine-status${minePartPending(checkoutSummary) <= 0.009 ? ' is-paid' : ''}`}>
                                    {minePartPending(checkoutSummary) <= 0.009
                                      ? 'Pagada'
                                      : checkoutSummary.shares.mine.memberPricePending
                                        ? 'Precio socio pendiente de validar'
                                        : checkoutSummary.shares.mine.paid > 0.009
                                          ? `Pagaste ${formatMoney(checkoutSummary.shares.mine.paid)} · falta ${formatMoney(minePartPending(checkoutSummary))}`
                                          : 'Pendiente'}
                                  </div>
                                </div>
                                <div className="bk-pay-mine-amount">{formatMoney(checkoutSummary.shares.mine.amount)}</div>
                              </div>
                            )}
                            {checkoutSummary.shares.extras.length > 0 && (
                              <div className="bk-pay-extras">
                                <div className="bk-pay-extras-head">
                                  <span>{checkoutSummary.shares.extras.some((extra) => extra.isMine) ? 'Consumos a tu cargo' : 'Consumos'}</span>
                                  <strong>{formatMoney(checkoutSummary.shares.extras.reduce((sum, extra) => sum + extra.pending, 0))}</strong>
                                </div>
                                {checkoutSummary.shares.extras.map((extra, index) => (
                                  <div key={`${extra.label}-${index}`} className="bk-pay-extra">
                                    <span>{extra.label}</span>
                                    <span>{formatMoney(extra.pending)}</span>
                                  </div>
                                ))}
                                {!checkoutSummary.shares.extras.some((extra) => extra.isMine) && (
                                  <div className="bk-pay-extra-note">Los paga el titular de la reserva.</div>
                                )}
                              </div>
                            )}
                            <div className="bk-pay-total">{sharesTotalCopy(checkoutSummary)}</div>
                            {renderDepositAction(checkoutSummary)}
                            {renderPriceHintsNote(checkoutSummary)}
                            {!checkoutSummary.checkout.enabled && (
                              <div className="bk-pay-note">{getCheckoutReasonMessage(checkoutSummary)}</div>
                            )}
                            {checkoutSummary.checkout.enabled && (
                              <button
                                type="button"
                                className="bk-action-btn bk-action-rebook"
                                onClick={() => { void handleStartOnlineCheckout('OWN_SHARE'); }}
                                disabled={checkoutSubmitting}
                              >
                                <BusyLabel busy={checkoutSubmitting}>
                                  <Ticket size={15} />
                                  {checkoutSummary.shares.mine
                                    ? `${minePayLabel(checkoutSummary)} · ${formatMoney(checkoutSummary.priceHints?.onlineAmount ?? checkoutSummary.shares.mine.pending)}`
                                    : 'Pagar online con Mercado Pago'}
                                </BusyLabel>
                              </button>
                            )}
                            {checkoutSummary.shares.canPayAll && checkoutSummary.shares.allPending > (checkoutSummary.shares.mine?.pending || 0) + 0.009 && (
                              // Solo con todos los lugares ocupados y precios validados: nadie pierde su precio socio.
                              <button
                                type="button"
                                className="bk-action-btn bk-action-secondary"
                                onClick={() => { void handleStartOnlineCheckout('ALL_SHARES'); }}
                                disabled={checkoutSubmitting}
                              >
                                Pagar todas las partes · {formatMoney(checkoutSummary.shares.allPending)}
                              </button>
                            )}
                            {checkoutSummary.checkout.enabled && (
                              <div className="bk-pay-note">{sharesPayNote(checkoutSummary)}</div>
                            )}
                          </>
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
                                { label: 'Falta pagar', value: checkoutSummary.account ? formatMoney(checkoutSummary.account.pending) : '—' }
                              ].map((item) => (
                                <div
                                  key={item.label}
                                  style={{
                                    padding: '10px 10px',
                                    minWidth: 0,
                                    borderRadius: 14,
                                    background: 'var(--surface-2)',
                                    border: '1px solid var(--border-subtle)'
                                  }}
                                >
                                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.03em', color: 'var(--text-muted)', marginBottom: 6 }}>
                                    {item.label}
                                  </div>
                                  <div style={{ fontSize: 'clamp(14px, 4vw, 18px)', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{item.value}</div>
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
                                onClick={() => { void handleStartOnlineCheckout('OWN_SHARE'); }}
                                disabled={checkoutSubmitting}
                              >
                                <BusyLabel busy={checkoutSubmitting}>
                                  <Ticket size={15} />
                                  {checkoutSummary.priceHints?.onlineAmount != null
                                    ? `Pagar online · ${formatMoney(checkoutSummary.priceHints.onlineAmount)}`
                                    : 'Pagar online con Mercado Pago'}
                                </BusyLabel>
                              </button>
                            )}
                            {renderDepositAction(checkoutSummary)}
                            {renderPriceHintsNote(checkoutSummary)}
                          </>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
                )}
  
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {activeTab === 'ACTIVE' && selectedBooking.capabilities?.canCancelBooking && (
                    <button className="bk-action-btn bk-action-cancel" onClick={() => handleCancel(selectedBooking.id)}>
                      <XCircle size={15} /> Cancelar reserva
                    </button>
                  )}
                  {activeTab === 'ACTIVE' && !selectedBooking.capabilities?.canCancelBooking && selectedBooking.capabilities?.canLeaveBooking && (
                    <button className="bk-action-btn bk-action-cancel" onClick={() => handleLeaveBooking(selectedBooking)} disabled={participantActionId === selectedBooking.id}>
                      <BusyLabel busy={participantActionId === selectedBooking.id}><LogOut size={15} />Salir de la reserva</BusyLabel>
                    </button>
                  )}
                  {(activeTab === 'PAST' || activeTab === 'CANCELLED') && selectedBooking.club?.slug && (
                    <>
                      {activeTab === 'PAST' && selectedClubHasCompletedBooking && (
                        <button className="bk-action-btn bk-action-review" onClick={() => handleOpenReviewModal(selectedBooking)}>
                          <MessageSquare size={15} /> Dejar / editar reseña del club
                        </button>
                      )}
                      <Link href={`/club/${selectedBooking.club.slug}?view=reservar`} className="bk-action-btn bk-action-rebook">
                        <CheckCircle2 size={15} /> Volver a reservar
                      </Link>
                    </>
                  )}
                </div>
              </div>
    );
  };

  return (
    <DarkPageLayout
      title="Mis reservas | Pique"
      extraCss={PAGE_CSS}
      breadcrumbs={[
        { label: 'Inicio', href: '/' },
        { label: 'Mis reservas' },
      ]}
    >
      <div className={`p-public-page bk-page${isDualEmptyState ? ' bk-page-empty' : ''}`}>

        {/* ── PAGE HEADER ── */}
        <div className="bk-page-head">
          <div>
            <h1 className="p-public-page-h">Mis <i>reservas</i></h1>
            <p className="p-public-page-sub">Tus próximos partidos e historial.</p>
          </div>
          <Link
            href={newBookingHref}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: 'var(--brand)', color: 'var(--brand-on)', borderRadius: 999, fontSize: 12, fontWeight: 800, letterSpacing: '.01em', textDecoration: 'none' }}
          >
            + Nueva reserva
          </Link>
        </div>

        <PushOptInCard />

        {/* ── TABS ── */}
        <div className="bk-tabs-wrap">
          {pendingInvitations.length > 0 && (
            <section id="invitaciones" className="bk-invite-section">
              <h2 className="bk-invite-heading">
                <span className="bk-invite-dot" aria-hidden="true" />
                {sharedInviter ? `${sharedInviter} te invitó a jugar` : 'Te invitaron a jugar'}
              </h2>
              {pendingInvitations
                .reduce<Array<{ day: string; items: PlayerBookingInvitationDto[] }>>((groups, invitation) => {
                  const day = getInvitationLabels(invitation).longDate;
                  const last = groups[groups.length - 1];
                  if (last && last.day === day) last.items.push(invitation);
                  else groups.push({ day, items: [invitation] });
                  return groups;
                }, [])
                .map((group) => (
                <div key={group.day} className="bk-invite-group">
                  <h3 className="bk-invite-day">{group.day}</h3>
                  {group.items.map((invitation) => {
                const busy = invitationActionId === invitation.id;
                const labels = getInvitationLabels(invitation);
                return (
                  <article key={invitation.id} className="bk-invite-card">
                    <div className="bk-invite-body">
                      <p className="bk-invite-title">
                        {[labels.timeRange, labels.activity].filter(Boolean).join(' · ')}
                      </p>
                      <p className="bk-invite-line">
                        {[invitation.court.name, invitation.club.name, labels.inviter && !sharedInviter ? `Te invitó ${labels.inviter}` : null].filter(Boolean).join(' · ')}
                      </p>
                      {invitation.myShareAmount != null && (
                        <div className="bk-invite-meta">
                          <span className="bk-invite-share">
                            Tu parte {formatMoney(Number(invitation.myShareAmount))}
                            {invitation.myMemberCategoryName ? ' · precio socio' : ''}
                          </span>
                          <span className="bk-invite-pay">
                            {[invitationSpotsCopy(invitation), invitationPayCopy(invitation)].filter(Boolean).join(' · ')}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="bk-invite-actions">
                      <button
                        type="button"
                        className="bk-action-btn bk-action-rebook"
                        disabled={busy}
                        onClick={() => handleAcceptInvitation(invitation)}
                      >
                        <BusyLabel busy={busy}><CheckCircle2 size={15} />Sumarme</BusyLabel>
                      </button>
                      <button
                        type="button"
                        className="bk-invite-decline"
                        disabled={busy}
                        onClick={() => handleDeclineInvitation(invitation)}
                      >
                        No puedo
                      </button>
                    </div>
                  </article>
                );
                  })}
                </div>
                ))}
            </section>
          )}
          <div className="p-public-tabs" style={{ display: 'inline-flex' }}>
            {(['ACTIVE', 'PAST', 'CANCELLED'] as const).map(tab => (
              <button
                key={tab}
                ref={el => { tabRefs.current[tab] = el; }}
                className={`p-public-tab${activeTab === tab ? ' p-public-active' : ''}`}
                onClick={() => handleTabChange(tab)}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        </div>

        {/* ── MAIN LAYOUT ── */}
        <div className={`bk-layout${isDualEmptyState ? ' bk-layout-empty' : ''}${selectedBooking && !isCompact ? ' bk-has-selection' : ''}`}>

          {/* LIST PANEL */}
          <div className="bk-list-panel">
            <div className="bk-list-panel-head">
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: 'var(--text-muted)' }}>
                {visibleBookings.length} {visibleBookings.length === 1
                  ? (activeTab === 'ACTIVE' ? 'próxima' : activeTab === 'PAST' ? 'pasada' : 'cancelada')
                  : (activeTab === 'ACTIVE' ? 'próximas' : activeTab === 'PAST' ? 'pasadas' : 'canceladas')}
              </div>
            </div>
            <div className="bk-list-body" ref={listBodyRef}>
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
                    <Link href={newBookingHref} className="bk-empty-cta" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: 'var(--brand)', color: 'var(--brand-on)', borderRadius: 999, fontSize: 12, fontWeight: 800, letterSpacing: '.01em', textDecoration: 'none', marginTop: 4 }}>
                      Reservar ahora
                    </Link>
                  )}
                </div>
              ) : (
                visibleBookings.map(booking => {
                  const date = new Date(booking.startDateTime);
                  const bookingTimeZone = booking.club?.timeZone || undefined;
                  const dateBox = getDateBoxParts(date, bookingTimeZone);
                  const isSelected = selectedBooking?.id === booking.id;
                  const boxClass = activeTab === 'ACTIVE' ? 'bk-date-box-active' : activeTab === 'CANCELLED' ? 'bk-date-box-cancelled' : 'bk-date-box-past';
                  const dayColor = activeTab === 'ACTIVE' ? 'var(--positive-fg)' : activeTab === 'CANCELLED' ? 'var(--error-fg)' : 'var(--text-muted)';
                  return (
                    <Fragment key={booking.id}>
                    <div
                      ref={el => { bookingRefs.current[Number(booking.id)] = el; }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      className={`bk-card${isSelected ? ' bk-selected' : ''}`}
                      onClick={() => setSelectedBooking(booking)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        setSelectedBooking(booking);
                      }}
                    >
                      <div className={`bk-date-box ${boxClass}`}>
                        <span className="bk-date-day" style={{ color: dayColor }}>{dateBox.day}</span>
                        <span className="bk-date-month">{dateBox.month}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="bk-card-club">{booking.club?.name || 'Club'}</div>
                        <div className="bk-card-meta">
                          {booking.activity?.name && <span className="bk-card-chip">{booking.activity.name}</span>}
                          {booking.myRole === 'PARTICIPANT' && <span className="bk-card-chip">{roleLabel(booking)}</span>}
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Clock size={10} /> {formatTime(date, bookingTimeZone)}
                          </span>
                          {booking.court?.name && <span style={{ color: 'var(--text-muted)' }}>{booking.court.name}</span>}
                          {booking.paymentSummary.status !== 'NOT_REQUIRED' && paymentStatusLabel(booking) && (
                            <span
                              className="bk-card-chip"
                              style={{
                                background: paymentStatusTone(booking).background,
                                border: `1px solid ${paymentStatusTone(booking).border}`,
                                color: paymentStatusTone(booking).color
                              }}
                            >
                              {paymentStatusLabel(booking)}
                            </span>
                          )}
                        </div>
                      </div>
                      <ArrowRight
                        size={16}
                        className="bk-card-arrow"
                        aria-hidden="true"
                      />
                    </div>
                    {isSelected && isCompact && renderDetail()}
                    </Fragment>
                  );
                })
              )}
            </div>
          </div>

          {/* DETAIL PANEL */}
          {selectedBooking ? (
            isCompact ? null : renderDetail()
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
      <Modal
        open={reviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        title="Tu reseña del club"
        subtitle={`${selectedBooking?.club?.name || 'Club'} · Una reseña por club, editala cuando quieras.`}
        closeDisabled={reviewSaving}
        maxWidth={480}
        footer={(
          <>
            <button type="button" className="p-modal-btn p-modal-btn-wide" onClick={() => setReviewModalOpen(false)} disabled={reviewSaving}>
              Cancelar
            </button>
            <button type="button" className="p-modal-btn p-modal-btn-primary p-modal-btn-wide" onClick={handleSubmitReview} disabled={reviewLoading || reviewSaving || reviewRating < 1}>
              <BusyLabel busy={reviewSaving}>Guardar reseña</BusyLabel>
            </button>
          </>
        )}
      >
        {reviewLoading ? (
          <UserLoadingState mode="block" minHeight={160} message="Cargando reseña..." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: 'var(--text-muted)', marginBottom: 10 }}>Calificación</div>
              <div className="bk-review-stars">
                {[1, 2, 3, 4, 5].map(v => (
                  <button key={v} type="button" className={`bk-review-star${reviewRating >= v ? ' bk-star-on' : ''}`} onClick={() => setReviewRating(v)} disabled={reviewSaving} aria-label={`${v} ${v === 1 ? 'estrella' : 'estrellas'}`}>
                    <Star size={16} style={{ fill: reviewRating >= v ? 'currentColor' : 'none' }} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: 'var(--text-muted)', marginBottom: 10 }}>Comentario (opcional)</div>
              <textarea
                className="bk-review-textarea"
                rows={4}
                value={reviewComment}
                onChange={e => setReviewComment(e.target.value.slice(0, 220))}
                placeholder="Contá tu experiencia..."
                aria-label="Comentario"
                disabled={reviewSaving}
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>{reviewComment.length}/220</div>
            </div>
          </div>
        )}
      </Modal>

    </DarkPageLayout>
  );
}
