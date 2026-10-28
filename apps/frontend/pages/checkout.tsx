import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  Hourglass,
  Loader2,
  ShieldCheck,
  Ticket,
  UserPlus,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import DarkPageLayout from '../components/DarkPageLayout';
import UserLoadingState from '../components/UserLoadingState';
import { createBooking } from '../services/BookingService';
import PlayerInviteSearch, { type PickedInvitePlayer } from '../components/players/PlayerInviteSearch';
import { getPendingLogoutRedirect } from '../services/AuthService';
import { useValidateAuth } from '../hooks/useValidateAuth';
import { extractErrorMessage, reportUiError } from '../utils/uiError';
import { normalizeApiError } from '../utils/apiError';
import { downloadCalendarEvent } from '../utils/calendarInvite';
import {
  readBookingCheckoutDraft,
  readCheckoutReturn,
  removeBookingCheckoutDraft,
  saveBookingCheckoutDraft,
  type BookingCheckoutDraft,
  type BookingCheckoutParticipantDraft,
} from '../utils/bookingCheckoutDraft';

const CHECKOUT_CSS = `
  /* ── Confirmar: encabezado y resumen compactos ── */
  .ck-head { display:flex; align-items:center; gap:12px; margin-bottom:16px; }
  .ck-back { width:38px; height:38px; flex-shrink:0; border-radius:12px; border:1px solid var(--border); background:var(--surface-2); color:var(--text-secondary); display:inline-flex; align-items:center; justify-content:center; cursor:pointer; }
  .ck-back:hover { color:var(--text-primary); border-color:var(--border-strong); }
  .ck-eyebrow { margin:0; color:var(--accent-fg); font-size:11px; font-weight:900; letter-spacing:.03em; }
  .ck-title { margin:2px 0 0; color:var(--text-primary); font-size:24px; line-height:1.1; font-weight:900; letter-spacing:-.04em; }
  .ck-summary { display:flex; gap:14px; align-items:center; padding:14px; border-radius:18px; background:var(--surface-2); border:1px solid var(--border-subtle); }
  .ck-date { width:56px; flex-shrink:0; border-radius:15px; background:var(--positive-bg); border:1px solid var(--accent-border-subtle); text-align:center; padding:8px 0; }
  .ck-date small { display:block; color:var(--accent-fg); font-size:10px; font-weight:900; letter-spacing:.04em; }
  .ck-date b { display:block; color:var(--text-primary); font-size:21px; font-weight:900; line-height:1.1; }
  .ck-sum-main { margin:0; color:var(--text-primary); font-size:16px; font-weight:900; }
  .ck-sum-sub { margin:3px 0 0; color:var(--text-muted); font-size:12px; font-weight:650; line-height:1.35; }
  .ck-sum-club { margin:3px 0 0; color:var(--text-secondary); font-size:12px; font-weight:750; }
  .ck-cal { margin-top:12px; padding:11px 0 0; border:0; border-top:1px solid var(--border-subtle); width:100%; background:transparent; display:flex; align-items:center; justify-content:space-between; color:var(--accent-fg); font-family:var(--font-sans); font-size:12px; font-weight:800; cursor:pointer; }
  .ck-hint { display:flex; gap:10px; align-items:flex-start; padding:11px 13px; border-radius:14px; background:var(--warn-bg); color:var(--text-secondary); font-size:12px; line-height:1.45; font-weight:600; }
  .ck-hint b { color:var(--warn-fg); }
  .ck-hint svg { flex-shrink:0; color:var(--warn-fg); margin-top:1px; }
  .ck-price-toggle { display:none; }
  .ck-sticky { display:none; }
  /* Espacio al final para que la barra fija no tape el contenido (solo celular). */
  .ck-bar-spacer { display:none; }
  .ck-sticky-amount small { display:block; color:var(--text-muted); font-size:10px; font-weight:900; letter-spacing:.03em; }
  .ck-sticky-amount b { display:block; color:var(--accent-fg); font-size:20px; font-weight:900; letter-spacing:-.04em; line-height:1.15; }
  .ck-sticky-amount em { display:block; font-style:normal; color:var(--text-muted); font-size:10px; font-weight:700; }
  .ck-sticky-error { margin:0 0 8px; color:var(--error-fg); font-size:12px; font-weight:700; }
  @media(max-width:920px){
    .ck-desktop-actions { display:none!important; }
    .ck-price-toggle { display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%; padding:16px 20px; border:0; background:transparent; color:var(--text-primary); font-family:var(--font-sans); cursor:pointer; text-align:left; }
    .ck-price-toggle-title { display:block; font-size:14px; font-weight:900; }
    .ck-price-toggle-sub { display:block; margin-top:2px; color:var(--text-muted); font-size:12px; font-weight:650; }
    .ck-price-toggle-action { display:inline-flex; align-items:center; gap:4px; color:var(--accent-fg); font-size:12px; font-weight:800; white-space:nowrap; }
    .ck-price-toggle-action svg { transition:transform .2s; }
    .ck-price-toggle.is-open .ck-price-toggle-action svg { transform:rotate(180deg); }
    .ck-price-detail { display:none; }
    .ck-price-detail.is-open { display:block; }
    .ck-sticky { display:block; position:fixed; left:12px; right:12px; bottom:calc(10px + env(safe-area-inset-bottom)); z-index:40; padding:12px 14px; border-radius:18px; background:var(--surface-1); border:1px solid var(--border); box-shadow:0 -6px 30px rgba(0,0,0,.28); }
    .ck-sticky-row { display:flex; align-items:center; gap:12px; }
    .ck-sticky-row .checkout-primary, .ck-sticky-row .checkout-secondary { flex:1; min-width:0; }
    .ck-sticky-row .checkout-secondary { flex:0 0 auto; min-width:0; }
    .pique-layout-clubapp .ck-sticky { bottom:calc(78px + env(safe-area-inset-bottom)); }
    .ck-bar-spacer { display:block; height:110px; }
  }

  /* ── ¡Listo! ── */
  .ck-done { max-width:560px; margin:0 auto; display:flex; flex-direction:column; gap:12px; }
  .ck-done-hero { display:flex; flex-direction:column; align-items:center; text-align:center; gap:10px; padding:6px 0 4px; }
  .ck-mark { position:relative; width:88px; height:88px; }
  .ck-mark svg { position:absolute; inset:0; overflow:visible; }
  .ck-ring { fill:none; stroke-width:5; stroke-linecap:round; stroke-dasharray:240; stroke-dashoffset:240; transform:rotate(-90deg); transform-origin:44px 44px; animation:ck-ring .55s cubic-bezier(.65,0,.35,1) forwards; }
  .ck-disc { transform-origin:44px 44px; transform:scale(0); animation:ck-pop .45s cubic-bezier(.34,1.56,.64,1) .45s forwards; }
  .ck-tick { fill:none; stroke-width:6; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:60; stroke-dashoffset:60; animation:ck-tick .35s ease-out .8s forwards; }
  .ck-conf { position:absolute; left:50%; top:50%; width:7px; height:11px; border-radius:2px; opacity:0; animation:ck-conf 1s cubic-bezier(.2,.7,.3,1) .85s forwards; }
  .ck-pulse { position:absolute; inset:2px; border-radius:999px; border:2px solid var(--warn-fg); opacity:0; animation:ck-pulse 1.6s ease-out 1s 2; }
  .ck-rise { opacity:0; animation:ck-rise .4s ease-out forwards; }
  @keyframes ck-ring { to { stroke-dashoffset:0; } }
  @keyframes ck-pop { 0% { transform:scale(0); } 60% { transform:scale(1.12); } 100% { transform:scale(1); } }
  @keyframes ck-tick { to { stroke-dashoffset:0; } }
  @keyframes ck-conf { 0% { opacity:0; transform:translate(-50%,-50%) rotate(0) scale(.6); } 10% { opacity:1; } 70% { opacity:1; } 100% { opacity:0; transform:translate(var(--x),var(--y)) rotate(var(--r)) scale(1); } }
  @keyframes ck-pulse { 0% { opacity:.8; transform:scale(1); } 100% { opacity:0; transform:scale(1.45); } }
  @keyframes ck-rise { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
  @media (prefers-reduced-motion: reduce) {
    .ck-ring, .ck-tick { animation:none; stroke-dashoffset:0; }
    .ck-disc { animation:none; transform:none; }
    .ck-rise { animation:none; opacity:1; }
    .ck-conf, .ck-pulse { display:none; }
  }
  .ck-done-pill { display:inline-flex; align-items:center; gap:7px; height:28px; padding:0 11px; border-radius:999px; font-size:11px; font-weight:900; }
  .ck-done-pill.is-confirmed { background:var(--positive-bg); color:var(--accent-fg); border:1px solid var(--accent-border-subtle); }
  .ck-done-pill.is-pending { background:var(--warn-bg); color:var(--warn-fg); }
  .ck-done-title { margin:0; color:var(--text-primary); font-size:28px; line-height:1.05; font-weight:900; letter-spacing:-.05em; }
  .ck-done-copy { margin:0; max-width:340px; color:var(--text-secondary); font-size:13px; line-height:1.5; font-weight:600; }
  .ck-done-card { border-radius:20px; background:var(--surface-1); border:1px solid var(--border); padding:14px; }
  .ck-done-actions { display:flex; gap:10px; }
  .ck-done-actions .checkout-primary { flex:1; }
  @media(max-width:920px){
    .ck-done-actions { position:fixed; left:12px; right:12px; bottom:calc(10px + env(safe-area-inset-bottom)); z-index:40; padding:12px; border-radius:18px; background:var(--surface-1); border:1px solid var(--border); box-shadow:0 -6px 30px rgba(0,0,0,.28); }
    .ck-done-actions .checkout-secondary { flex:0 0 auto; min-width:0; }
    .pique-layout-clubapp .ck-done-actions { bottom:calc(78px + env(safe-area-inset-bottom)); }
  }
  .checkout-shell { max-width:1120px; margin:0 auto; }
  .checkout-top { margin-bottom:22px; }
  .checkout-layout { display:grid; grid-template-columns:minmax(0,1.1fr) 380px; gap:22px; align-items:start; }
  .checkout-card { background:var(--surface-1); border:1px solid var(--border); border-radius:24px; overflow:hidden; }
  .checkout-card-pad { padding:24px; }
  .checkout-hero { position:relative; padding:28px; border-bottom:1px solid var(--border); overflow:hidden; }
  .checkout-hero::before { content:''; position:absolute; inset:0; background:radial-gradient(circle at 10% 0%, var(--accent-border-subtle), transparent 34%), linear-gradient(135deg, var(--positive-bg), transparent 46%); pointer-events:none; }
  .checkout-hero-content { position:relative; z-index:1; }
  .checkout-pill { display:inline-flex; align-items:center; gap:8px; height:30px; padding:0 11px; border-radius:999px; background:var(--positive-bg); border:1px solid var(--accent-border-subtle); color:var(--accent-fg); font-size:10px; font-weight:900; letter-spacing:.03em; }
  .checkout-title { margin:14px 0 7px; color:var(--text-primary); font-size:clamp(28px,4vw,46px); line-height:.98; font-weight:900; letter-spacing:-.06em; }
  .checkout-copy { margin:0; max-width:560px; color:var(--text-muted); font-size:14px; line-height:1.6; font-weight:600; }
  .checkout-activity { display:flex; align-items:center; gap:12px; margin-bottom:18px; }
  .checkout-activity-icon { width:44px; height:44px; border-radius:16px; background:var(--positive-bg); color:var(--accent-fg); border:1px solid var(--accent-bg-muted); display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; }
  .checkout-activity-name { margin:0; color:var(--text-primary); font-size:17px; font-weight:900; line-height:1.2; }
  .checkout-activity-court { margin:2px 0 0; color:var(--text-muted); font-size:13px; font-weight:650; line-height:1.3; }
  .checkout-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .checkout-detail { min-height:88px; border-radius:18px; background:var(--surface-2); border:1px solid var(--border-subtle); padding:14px; }
  .checkout-label { display:flex; align-items:center; gap:7px; color:var(--text-muted); font-size:10px; font-weight:900; letter-spacing:.03em; margin-bottom:9px; }
  .checkout-value { margin:0; color:var(--text-primary); font-size:14px; line-height:1.35; font-weight:850; }
  .checkout-participants { padding:24px; border-top:1px solid var(--border); }
  .checkout-participants-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:16px; }
  .checkout-participants-title { display:flex; align-items:center; gap:8px; margin:0; color:var(--text-primary); font-size:15px; font-weight:900; }
  .checkout-participants-copy { margin:5px 0 0; color:var(--text-muted); font-size:12px; line-height:1.45; font-weight:600; }
  .checkout-places { flex-shrink:0; border-radius:999px; padding:6px 9px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-secondary); font-size:10px; font-weight:850; }
  .checkout-player-list { display:grid; gap:8px; margin-bottom:12px; }
  .checkout-player { display:flex; align-items:center; gap:10px; min-height:48px; padding:9px 11px; border-radius:15px; background:var(--surface-2); border:1px solid var(--border-subtle); }
  .checkout-player-icon { width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; border-radius:11px; background:var(--positive-bg); color:var(--accent-fg); }
  .checkout-player-info { min-width:0; flex:1; }
  .checkout-player-name { margin:0; color:var(--text-primary); font-size:12px; line-height:1.35; font-weight:850; overflow-wrap:anywhere; }
  .checkout-player-status { margin:2px 0 0; color:var(--text-muted); font-size:10px; line-height:1.35; font-weight:650; overflow-wrap:anywhere; }
  .checkout-player-remove { width:34px; height:34px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; border:0; border-radius:11px; background:transparent; color:var(--text-muted); cursor:pointer; }
  .checkout-player-remove:hover { background:var(--error-bg); color:var(--error-fg); }
  .checkout-participant-form { display:grid; grid-template-columns:minmax(0,1.25fr) minmax(0,.85fr) auto; gap:9px; align-items:end; }
  .checkout-form-field { display:grid; gap:6px; }
  .checkout-form-label { color:var(--text-secondary); font-size:10px; font-weight:850; }
  .checkout-form-input { width:100%; height:42px; border-radius:13px; border:1px solid var(--border); background:var(--surface-1); color:var(--text-primary); padding:0 12px; font-family:var(--font-sans); font-size:12px; font-weight:650; outline:none; }
  .checkout-form-input:focus { border-color:var(--accent-border-strong); box-shadow:0 0 0 3px var(--accent-bg-soft); }
  .checkout-add-player { height:42px; border-radius:13px; border:1px solid var(--border); background:var(--surface-1); color:var(--text-primary); padding:0 14px; display:inline-flex; align-items:center; justify-content:center; gap:7px; font-family:var(--font-sans); font-size:11px; font-weight:900; cursor:pointer; white-space:nowrap; }
  .checkout-add-player:hover { border-color:var(--accent-border-strong); background:var(--accent-bg-soft); }
  .checkout-field-error { margin:8px 0 0; color:var(--error-fg); font-size:11px; font-weight:700; }
  .checkout-participants-note { margin:10px 0 0; color:var(--text-muted); font-size:10px; line-height:1.45; font-weight:600; }
  .checkout-summary { position:sticky; top:88px; }
  .checkout-price { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:22px; border-bottom:1px solid var(--border); background:linear-gradient(135deg, var(--accent-bg-soft), transparent); }
  .checkout-price-label { margin:0; color:var(--text-muted); font-size:10px; font-weight:900; letter-spacing:.03em; }
  .checkout-price-value { margin:5px 0 0; color:var(--accent-fg); font-size:34px; font-weight:900; letter-spacing:-.06em; }
  .checkout-price-notes { flex-shrink:0; text-align:right; color:var(--text-muted); font-size:12px; line-height:1.55; font-weight:650; }
  .payment-option { display:flex; align-items:flex-start; gap:12px; border-radius:18px; padding:14px; border:1px solid var(--border); background:var(--surface-2); }
  .payment-option.active { border-color:var(--accent-border-strong); background:var(--accent-bg-soft); }
  .payment-option.disabled { opacity:.55; }
  .payment-icon { width:38px; height:38px; border-radius:14px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; background:var(--surface-2); color:var(--text-muted); }
  .payment-option.active .payment-icon { background:var(--accent-bg-muted); color:var(--accent-fg); }
  .payment-title { margin:0; color:var(--text-primary); font-size:13px; font-weight:850; }
  .payment-copy { margin:4px 0 0; color:var(--text-muted); font-size:12px; line-height:1.45; font-weight:600; }
  .checkout-error { border:1px solid var(--error-bg); background:var(--error-bg); color:var(--error-fg); border-radius:16px; padding:13px 14px; font-size:13px; font-weight:700; line-height:1.45; }
  .checkout-actions { display:flex; gap:10px; padding-top:16px; }
  .checkout-secondary,.checkout-primary { height:48px; min-height:48px; border-radius:15px; font-family:var(--font-sans); font-size:12px; font-weight:900; letter-spacing:.01em; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:8px; text-decoration:none; padding:0 18px; }
  .checkout-secondary { flex:0 0 auto; min-width:154px; border:1px solid var(--border); background:var(--surface-1); color:var(--text-secondary); }
  .checkout-primary { flex:1; border:1px solid var(--brand); background:var(--brand); color:var(--brand-on); }
  .checkout-primary:hover { border-color:var(--brand-hover); background:var(--brand-hover); color:var(--brand-on); }
  .checkout-primary:disabled { cursor:not-allowed; opacity:.65; }
  /* Botones que son links: el layout pone "a { color:inherit }" y dejaba el texto ilegible sobre el lima. */
  .pique-layout a.checkout-primary, .pique-layout a.checkout-primary:hover { color:var(--brand-on); }
  .pique-layout a.checkout-secondary { color:var(--text-secondary); }
  .checkout-success { max-width:720px; margin:0 auto; text-align:center; }
  .checkout-success-icon { width:68px; height:68px; border-radius:22px; margin:0 auto 18px; display:flex; align-items:center; justify-content:center; background:var(--positive-bg); border:1px solid var(--accent-border-subtle); color:var(--accent-fg); }
  @media(max-width:920px){
    .checkout-layout { grid-template-columns:1fr; }
    .checkout-summary { position:static; }
  }
  @media(max-width:620px){
    .checkout-top { align-items:flex-start; flex-direction:column; }
    .checkout-grid { grid-template-columns:1fr; }
    .checkout-price { flex-direction:column; gap:12px; padding:20px; }
    .checkout-price-notes { text-align:left; }
    .checkout-card-pad { padding:20px; }
    .checkout-participants { padding:20px; }
    .checkout-participants-head { flex-direction:column; gap:10px; }
    .checkout-participant-form { grid-template-columns:1fr; }
    .checkout-add-player { width:100%; }
    /* En la fila de un lugar libre, el botón Invitar baja a su propia línea para no aplastar el texto. */
    .checkout-player { flex-wrap:wrap; }
    .checkout-player > .checkout-add-player { flex:1 0 100%; }
    .checkout-actions { flex-direction:column; }
    .checkout-actions > .checkout-secondary,.checkout-actions > .checkout-primary { flex:none; width:100%; }
  }
  .p-public-root.p-public-theme-light .checkout-card { background:var(--surface-1); border-color:var(--border); box-shadow:0 12px 30px var(--border); }
  .p-public-root.p-public-theme-light .checkout-hero { border-bottom-color:var(--border-subtle); }
  .p-public-root.p-public-theme-light .checkout-hero::before { background:radial-gradient(circle at 10% 0%, var(--accent-bg-muted), transparent 36%), linear-gradient(135deg, var(--positive-bg), transparent 52%); }
  .p-public-root.p-public-theme-light .checkout-pill { color:var(--accent-fg); background:var(--positive-bg); border-color:var(--accent-border-subtle); }
  .p-public-root.p-public-theme-light .checkout-title,
  .p-public-root.p-public-theme-light .checkout-value,
  .p-public-root.p-public-theme-light .checkout-activity-name { color:var(--text-primary); }
  .p-public-root.p-public-theme-light .checkout-copy,
  .p-public-root.p-public-theme-light .checkout-price-label,
  .p-public-root.p-public-theme-light .payment-copy { color:var(--text-secondary); }
  .p-public-root.p-public-theme-light .checkout-activity-court { color:var(--text-secondary); }
  .p-public-root.p-public-theme-light .checkout-detail,
  .p-public-root.p-public-theme-light .payment-option { background:var(--surface-1); border-color:var(--border); }
  .p-public-root.p-public-theme-light .checkout-label { color:var(--text-muted); }
  .p-public-root.p-public-theme-light .checkout-summary { box-shadow:none; }
  .p-public-root.p-public-theme-light .checkout-price { border-bottom-color:var(--border-subtle); background:linear-gradient(135deg, var(--accent-bg-faint), transparent); }
  .p-public-root.p-public-theme-light .checkout-price-value { color:var(--accent-fg); }
  .p-public-root.p-public-theme-light .payment-icon { background:var(--surface-2); color:var(--text-muted); }
  .p-public-root.p-public-theme-light .payment-option.active { border-color:var(--accent-border-strong); background:var(--accent-bg-soft); }
  .p-public-root.p-public-theme-light .payment-option.active .payment-icon { background:var(--accent-bg-muted); color:var(--accent-fg); }
  .p-public-root.p-public-theme-light .payment-title { color:var(--text-primary); }
  .p-public-root.p-public-theme-light .checkout-secondary { background:var(--surface-1); border-color:var(--border); color:var(--text-secondary); }
  .p-public-root.p-public-theme-light .checkout-secondary:hover { background:var(--surface-2); color:var(--text-primary); }
  .p-public-root.p-public-theme-light .checkout-error { color:var(--error-fg); background:var(--error-bg); border-color:var(--danger-border); }
  .p-public-root.p-public-theme-light .checkout-success-icon { background:var(--positive-bg); border-color:var(--accent-border-subtle); color:var(--accent-fg); }
  .p-public-root:not(.p-public-theme-light) .checkout-success .checkout-primary { background:linear-gradient(135deg, var(--brand) 0%, var(--brand-hover) 100%); border-color:var(--brand-hover); color:var(--brand-on); box-shadow:0 14px 28px rgba(182,243,106,.18); }
  .p-public-root:not(.p-public-theme-light) .checkout-success .checkout-primary:hover { background:linear-gradient(135deg, var(--brand-hover) 0%, var(--brand) 100%); border-color:var(--brand); color:var(--brand-on); }
  .checkout-player-icon.is-pending { background:var(--warn-bg); color:var(--warn-fg); }
  .checkout-player-icon.is-empty { background:transparent; border:1px dashed var(--border-strong); color:var(--text-muted); }
  .checkout-player-index { font-size:11px; font-weight:900; }
  .checkout-player-status.is-accent { color:var(--accent-fg); }
  .checkout-player-status.is-warn { color:var(--warn-fg); }
  .checkout-player-name.is-muted { color:var(--text-secondary); }
  .checkout-player-amount { flex-shrink:0; color:var(--text-primary); font-size:13px; font-weight:850; white-space:nowrap; }
  .checkout-player-amount.is-muted { color:var(--text-secondary); }
  .checkout-invite-box { display:grid; gap:12px; padding:13px; border-radius:15px; background:var(--surface-2); border:1px solid var(--accent-border); }
  .checkout-invite-head { display:flex; align-items:center; gap:10px; }
  .checkout-invite-title { margin:0; flex:1; color:var(--text-primary); font-size:12px; font-weight:850; }
  .checkout-link-btn { border:0; background:transparent; color:var(--text-muted); padding:6px 4px; font-family:var(--font-sans); font-size:11px; font-weight:800; cursor:pointer; }
  .checkout-link-btn:hover { color:var(--text-primary); }
  .checkout-lookup { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:13px; background:var(--surface-1); }
  .checkout-lookup-avatar { width:32px; height:32px; border-radius:999px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; background:var(--surface-3); color:var(--text-primary); font-size:11px; font-weight:900; }
  .checkout-lookup-info { min-width:0; flex:1; }
  .checkout-lookup-name { margin:0; color:var(--text-primary); font-size:13px; font-weight:850; overflow-wrap:anywhere; }
  .checkout-lookup-copy { margin:2px 0 0; color:var(--text-muted); font-size:11px; line-height:1.4; font-weight:650; }
  .checkout-lookup-action { height:38px; flex-shrink:0; border-radius:12px; border:1px solid var(--brand); background:var(--brand); color:var(--brand-on); padding:0 14px; display:inline-flex; align-items:center; gap:6px; font-family:var(--font-sans); font-size:12px; font-weight:900; cursor:pointer; }
  .checkout-lookup-action:hover { background:var(--brand-hover); border-color:var(--brand-hover); }
  .checkout-lookup-warn { padding:11px 12px; border-radius:13px; background:var(--warn-bg); }
  .checkout-lookup-warn-title { margin:0; color:var(--warn-fg); font-size:12px; font-weight:850; }
  .checkout-lookup-hint { margin:0; display:flex; align-items:center; gap:6px; color:var(--text-muted); font-size:11px; font-weight:650; }
  .checkout-breakdown { display:grid; gap:10px; padding:20px 22px; border-bottom:1px solid var(--border); }
  .checkout-breakdown-row { display:flex; align-items:baseline; justify-content:space-between; gap:12px; font-size:13px; }
  .checkout-breakdown-label { color:var(--text-secondary); font-weight:650; }
  .checkout-breakdown-amount { color:var(--text-primary); font-weight:850; white-space:nowrap; }
  .checkout-breakdown-note { margin:0; color:var(--text-muted); font-size:11px; line-height:1.5; font-weight:600; }
  .checkout-value-sub { margin:4px 0 0; color:var(--text-muted); font-size:12px; font-weight:650; }
  .checkout-status-chip { flex-shrink:0; border-radius:999px; padding:4px 9px; font-size:10px; font-weight:900; white-space:nowrap; }
  .checkout-status-chip.is-confirmed { background:var(--positive-bg); color:var(--accent-fg); }
  .checkout-status-chip.is-pending { background:var(--warn-bg); color:var(--warn-fg); }
  .checkout-success-pay { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:20px; padding:14px 16px; border-radius:18px; background:var(--accent-bg-soft); border:1px solid var(--accent-border-subtle); text-align:left; }
  .checkout-success-pay-amount { margin:2px 0 0; color:var(--accent-fg); font-size:24px; font-weight:900; letter-spacing:-.05em; text-align:right; }
  @media(max-width:620px){
    .checkout-lookup { flex-wrap:wrap; }
    .checkout-lookup-action { width:100%; justify-content:center; }
    .checkout-success-pay { flex-direction:column; align-items:flex-start; }
    .checkout-success-pay-amount { text-align:left; }
  }
`;

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-AR')}`;

const parseDraftDate = (date: string) => {
  const [year, month, day] = String(date || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDurationLabel = (minutes: number) => {
  const safeMinutes = Math.max(0, Math.round(Number(minutes || 0)));
  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
};

const getInitials = (value: string) =>
  String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk.charAt(0).toUpperCase())
    .join('') || '?';

const getTimeRange = (draft: BookingCheckoutDraft) => {
  const minutes = Number(draft.durationMinutes || 0);
  const [hour, minute] = String(draft.slotTime || '').split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(minutes)) return draft.slotTime;
  const start = new Date(2000, 0, 1, hour, minute);
  const end = new Date(start.getTime() + minutes * 60000);
  const format = (date: Date) => date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${format(start)} – ${format(end)}`;
};

const formatSlugLabel = (value: string) =>
  String(value || '')
    .split('-')
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');

export default function CheckoutPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth();
  const [draft, setDraft] = useState<BookingCheckoutDraft | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmedBookingId, setConfirmedBookingId] = useState<string | null>(null);
  // Estado real de la reserva creada: el club puede confirmarla a mano (queda pendiente).
  const [confirmedStatus, setConfirmedStatus] = useState<'CONFIRMED' | 'PENDING'>('PENDING');
  // Detalle del precio: en el celular arranca cerrado.
  const [priceDetailOpen, setPriceDetailOpen] = useState(false);
  const [participants, setParticipants] = useState<BookingCheckoutParticipantDraft[]>([]);
  const [participantError, setParticipantError] = useState('');
  // Invitar: el editor se abre sobre el primer lugar libre (buscador por nombre, DNI o email).
  const [inviteEditorOpen, setInviteEditorOpen] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    const draftId = typeof router.query.draft === 'string' ? router.query.draft : '';
    const loadedDraft = readBookingCheckoutDraft(draftId);
    setDraft(loadedDraft);
    setParticipants(loadedDraft?.participants || []);
    setDraftLoaded(true);
  }, [router.isReady, router.query.draft]);

  useEffect(() => {
    if (!authChecked || user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/checkout')}`);
  }, [authChecked, router, user]);

  const timeRange = useMemo(() => (draft ? getTimeRange(draft) : ''), [draft]);
  const backHref = draft?.clubSlug ? `/club/${draft.clubSlug}` : '/';
  // Volver a la grilla: con el historial si venimos de ahí (conserva día, horario y scroll);
  // si se entró directo al checkout, reemplaza por la página del club.
  const goBackToClub = () => {
    const returnPath = readCheckoutReturn();
    const cameFromClub = Boolean(returnPath && returnPath.split('?')[0] === backHref);
    if (cameFromClub && typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    void router.replace(returnPath && returnPath.split('?')[0] === backHref ? returnPath : backHref);
  };
  const maxParticipants = draft?.playerCount ? Math.max(0, draft.playerCount - 1) : 20;
  const participantLimitReached = participants.length >= maxParticipants;
  const ownerName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || 'Vos';
  const durationLabel = formatDurationLabel(Number(draft?.durationMinutes || 0));
  const activityLabel = [draft?.activityName, draft?.formatName].filter(Boolean).join(' · ');
  const openSlotCount = draft?.playerCount ? Math.max(0, draft.playerCount - 1 - participants.length) : 0;
  // Precio por jugador: parte del titular y de cada lugar sin asignar (precio general, con luces).
  const isPerPlayer = Boolean(draft?.activityFormatId && draft?.pricePerPlayer != null);
  const ownerShare = Number(draft?.pricePerPlayer || 0);
  const otherSlotsCount = draft?.playerCount ? Math.max(0, draft.playerCount - 1) : 0;
  const generalShare = draft?.generalPricePerPlayer != null
    ? Number(draft.generalPricePerPlayer)
    : otherSlotsCount > 0
      ? Math.max(0, (Number(draft?.price || 0) - ownerShare) / otherSlotsCount)
      : 0;
  const checkoutBreadcrumbs = useMemo(() => {
    const items: Array<{ label: string; href?: string }> = [{ label: 'Inicio', href: '/' }];
    if (draft?.clubSlug) {
      items.push({ label: 'Complejos', href: '/complejos' });
      items.push({ label: formatSlugLabel(draft.clubSlug) || 'Club', href: `/club/${draft.clubSlug}` });
    }
    items.push({ label: confirmedBookingId !== null ? 'Confirmación' : 'Checkout' });
    return items;
  }, [confirmedBookingId, draft?.clubSlug]);

  const persistParticipants = (nextParticipants: BookingCheckoutParticipantDraft[]) => {
    setParticipants(nextParticipants);
    setDraft((currentDraft) => {
      if (!currentDraft) return currentDraft;
      const updatedDraft = { ...currentDraft, participants: nextParticipants };
      saveBookingCheckoutDraft(updatedDraft);
      return updatedDraft;
    });
  };

  const resetInviteEditor = () => {
    setInviteEditorOpen(false);
    setParticipantError('');
  };

  const handlePickPlayer = (picked: PickedInvitePlayer) => {
    if (participantLimitReached) return;
    const id = `participant_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    persistParticipants([
      ...participants,
      picked.kind === 'token'
        ? {
            id,
            identifier: picked.displayName,
            name: picked.displayName,
            lookupStatus: 'FOUND',
            inviteToken: picked.inviteToken,
            ref: picked.ref,
          }
        : {
            id,
            identifier: picked.value,
            name: picked.displayName,
            lookupStatus: picked.lookupStatus,
          },
    ]);
    resetInviteEditor();
  };

  const handleRemoveParticipant = (participantId: string) => {
    persistParticipants(participants.filter((participant) => participant.id !== participantId));
    setParticipantError('');
  };

  const handleConfirm = async () => {
    if (!draft || submitting) return;
    const date = parseDraftDate(draft.date);
    if (!date) {
      setSubmitError('No pudimos leer la fecha de la reserva. Volvé a elegir el turno.');
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError('');
      setParticipantError('');
      const result = await createBooking(draft.courtId, draft.activityId, date, draft.slotTime, {
        durationMinutes: draft.durationMinutes,
        applyDiscount: false,
        ...(draft.activityFormatId ? { activityFormatId: draft.activityFormatId } : {}),
        initialParticipants: participants.map((participant) => ({
          ...(participant.inviteToken
            ? { inviteToken: participant.inviteToken }
            : participant.identifier.includes('@')
              ? { email: participant.identifier.trim().toLowerCase() }
              : { dni: participant.identifier.replace(/\D/g, '') }),
          ...(participant.name ? { name: participant.name } : {}),
        })),
      });
      const booking = (result as any)?.booking || result;
      const bookingId = String(booking?.id || (result as any)?.bookingId || '').trim();
      const rawStatus = String(booking?.status || '').toUpperCase();
      const isConfirmed = rawStatus
        ? rawStatus === 'CONFIRMED'
        : draft.bookingConfirmationMode === 'AUTOMATIC';
      removeBookingCheckoutDraft(draft.id);
      setConfirmedStatus(isConfirmed ? 'CONFIRMED' : 'PENDING');
      setConfirmedBookingId(bookingId || 'created');
      // La confirmación se ve desde arriba (en el celular el botón estaba al final de la página).
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'auto' });
        if (isConfirmed) {
          try {
            window.navigator.vibrate?.(35);
          } catch {
            // Vibrar es opcional.
          }
        }
      }
      // Si se recarga, la dirección lleva a la reserva creada (el borrador ya no existe).
      if (bookingId) {
        void router.replace(
          { pathname: router.pathname, query: { ...router.query, done: bookingId } },
          undefined,
          { shallow: true, scroll: false }
        );
      }
    } catch (error) {
      const message = extractErrorMessage(error, 'No pudimos confirmar la reserva. Intentá nuevamente.');
      const apiError = normalizeApiError(error, message);
      const participantMessage = apiError.fieldErrors?.email
        || apiError.fieldErrors?.dni
        || apiError.fieldErrors?.name;
      if (
        participants.length > 0
        && (participantMessage
          || apiError.code === 'BOOKING_FULL'
          || apiError.code === 'BOOKING_PARTICIPANT_ALREADY_EXISTS'
          || apiError.code === 'USER_NOT_FOUND')
      ) {
        setParticipantError(participantMessage || message);
      }
      reportUiError({ area: 'CheckoutPage', action: 'confirmBooking' }, error);
      if (message.toLowerCase().includes('sesión expirada')) {
        void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/checkout')}`);
        return;
      }
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const doneBookingId = typeof router.query.done === 'string' ? router.query.done : '';
  useEffect(() => {
    if (!draftLoaded || draft || confirmedBookingId !== null || !doneBookingId) return;
    void router.replace(`/bookings?booking=${encodeURIComponent(doneBookingId)}`);
  }, [confirmedBookingId, doneBookingId, draft, draftLoaded, router]);

  if (!authChecked || !draftLoaded) {
    return <UserLoadingState mode="page" message="Preparando checkout..." />;
  }

  if (!draft && doneBookingId && confirmedBookingId === null) {
    return <UserLoadingState mode="page" message="Abriendo tu reserva..." />;
  }

  if (!draft) {
    return (
      <DarkPageLayout title="Checkout | Pique" extraCss={CHECKOUT_CSS} breadcrumbs={checkoutBreadcrumbs}>
        <main className="p-public-page-sm">
          <section className="checkout-card checkout-card-pad checkout-success">
            <div className="checkout-success-icon">
              <Ticket size={30} />
            </div>
            <h1 className="checkout-title">No encontramos esta reserva</h1>
            <p className="checkout-copy" style={{ margin: '0 auto 24px' }}>
              El resumen pudo haber vencido o se abrió desde otra pestaña. Volvé a elegir el turno para continuar.
            </p>
            <Link href="/" className="checkout-primary" style={{ maxWidth: 260, margin: '0 auto' }}>
              Buscar turno
            </Link>
          </section>
        </main>
      </DarkPageLayout>
    );
  }


  const draftDate = parseDraftDate(draft.date);
  const dateBadge = draftDate
    ? {
        weekday: draftDate.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '').toUpperCase(),
        day: draftDate.getDate(),
      }
    : null;
  const clubDisplayName = draft.clubName || formatSlugLabel(draft.clubSlug || '') || '';
  const clubConfirmsManually = draft.bookingConfirmationMode === 'MANUAL';
  const stickyAmount = isPerPlayer ? ownerShare : Number(draft.price || 0);
  const confirmLabel = participants.length > 0
    ? `Confirmar y enviar ${participants.length === 1 ? 'invitación' : 'invitaciones'}`
    : 'Confirmar reserva';
  const renderConfirmContent = () => (
    submitting ? (
      <>
        <Loader2 size={15} style={{ animation: 'p-public-spin .8s linear infinite' }} />
        Confirmando...
      </>
    ) : (
      <>
        <ShieldCheck size={15} />
        {confirmLabel}
      </>
    )
  );
  const addToCalendar = () => {
    if (!draftDate) return;
    const [hour, minute] = String(draft.slotTime || '').split(':').map(Number);
    const start = new Date(draftDate.getFullYear(), draftDate.getMonth(), draftDate.getDate(), hour || 0, minute || 0);
    const end = new Date(start.getTime() + Number(draft.durationMinutes || 0) * 60000);
    downloadCalendarEvent({
      uid: `booking-${confirmedBookingId || draft.id}`,
      title: [activityLabel || 'Partido', clubDisplayName].filter(Boolean).join(' · '),
      start,
      end,
      location: [clubDisplayName, draft.courtName].filter(Boolean).join(' · '),
      description: 'Reserva hecha en Pique.',
    });
  };
  const summaryCard = (withCalendar: boolean) => (
    <div className={withCalendar ? 'ck-done-card' : undefined}>
      <div className={withCalendar ? 'ck-summary' : 'ck-summary'} style={withCalendar ? { padding: 0, border: 0, background: 'transparent' } : undefined}>
        {dateBadge && (
          <span className="ck-date"><small>{dateBadge.weekday}</small><b>{dateBadge.day}</b></span>
        )}
        <div style={{ minWidth: 0 }}>
          <p className="ck-sum-main">{timeRange} · {durationLabel}</p>
          <p className="ck-sum-sub">{[activityLabel, draft.courtName].filter(Boolean).join(' · ')}{draft.playerCount ? ` · ${draft.playerCount} jugadores` : ''}</p>
          {clubDisplayName && <p className="ck-sum-club">{clubDisplayName}</p>}
        </div>
      </div>
      {withCalendar && (
        <button type="button" className="ck-cal" onClick={addToCalendar}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><CalendarPlus size={15} /> Agregar al calendario</span>
          <span style={{ color: 'var(--text-muted)' }}>›</span>
        </button>
      )}
    </div>
  );

  if (confirmedBookingId !== null) {
    const isConfirmed = confirmedStatus === 'CONFIRMED';
    const firstName = String(user?.firstName || '').trim();
    const confetti = Array.from({ length: 16 }, (_, index) => {
      const angle = (index / 16) * Math.PI * 2;
      const distance = 78 + (index % 3) * 18;
      return {
        x: Math.round(Math.cos(angle) * distance),
        y: Math.round(Math.sin(angle) * distance) - 10,
        r: ((index * 97) % 520) - 260,
        color: ['var(--brand)', 'var(--brand-hover)', 'var(--text-primary)', 'var(--accent-fg)'][index % 4],
      };
    });
    return (
      <DarkPageLayout title={isConfirmed ? 'Reserva confirmada | Pique' : 'Solicitud enviada | Pique'} extraCss={CHECKOUT_CSS} breadcrumbs={checkoutBreadcrumbs}>
        <main className="p-public-page-sm">
          <div className="ck-done">
            <div className="ck-done-hero">
              <div className="ck-mark" aria-hidden="true">
                {isConfirmed
                  ? confetti.map((piece, index) => (
                      <span
                        key={`conf-${index}`}
                        className="ck-conf"
                        style={{
                          background: piece.color,
                          ['--x' as string]: `calc(-50% + ${piece.x}px)`,
                          ['--y' as string]: `calc(-50% + ${piece.y}px)`,
                          ['--r' as string]: `${piece.r}deg`,
                        }}
                      />
                    ))
                  : <span className="ck-pulse" />}
                <svg viewBox="0 0 88 88">
                  <circle className="ck-disc" cx="44" cy="44" r="36" fill={isConfirmed ? 'var(--brand)' : 'var(--warn-fg)'} />
                  <circle className="ck-ring" cx="44" cy="44" r="40" stroke={isConfirmed ? 'var(--brand)' : 'var(--warn-fg)'} />
                  <path className="ck-tick" d="M29 45l10 10 20-21" stroke={isConfirmed ? 'var(--brand-on)' : 'var(--surface-1)'} />
                </svg>
              </div>
              <span className={`ck-done-pill ck-rise ${isConfirmed ? 'is-confirmed' : 'is-pending'}`} style={{ animationDelay: '.9s' }}>
                {isConfirmed ? <><ShieldCheck size={13} /> Reserva confirmada</> : <><Hourglass size={13} /> Esperando al club</>}
              </span>
              <h1 className="ck-done-title ck-rise" style={{ animationDelay: '.95s' }}>
                {isConfirmed
                  ? <>¡Listo{firstName ? `, ${firstName}` : ''}!<br />Tu turno está reservado</>
                  : '¡Solicitud enviada!'}
              </h1>
              <p className="ck-done-copy ck-rise" style={{ animationDelay: '1s' }}>
                {isConfirmed
                  ? 'Te esperamos en el club. Está en Mis reservas cuando la necesites.'
                  : 'El club tiene que confirmar tu turno. Te avisamos apenas lo haga, y lo ves en Mis reservas.'}
              </p>
            </div>

            <div className="ck-rise" style={{ animationDelay: '1.05s' }}>{summaryCard(true)}</div>

            {(participants.length > 0 || openSlotCount > 0) && (
              <div className="checkout-card ck-rise" style={{ textAlign: 'left', animationDelay: '1.05s' }}>
                <div className="checkout-card-pad">
                  <div className="checkout-participants-head" style={{ marginBottom: 12 }}>
                    <h2 className="checkout-participants-title"><Users size={17} /> Jugadores</h2>
                    {participants.length > 0 && (
                      <span className="checkout-places">
                        1 confirmado · {participants.length} {participants.length === 1 ? 'pendiente' : 'pendientes'}
                      </span>
                    )}
                  </div>
                  <div className="checkout-player-list" style={{ marginBottom: 0 }}>
                    <div className="checkout-player">
                      <span className="checkout-player-icon"><span className="checkout-player-index">{getInitials(ownerName)}</span></span>
                      <div className="checkout-player-info">
                        <p className="checkout-player-name">{ownerName} · Vos</p>
                        {isPerPlayer && (
                          <p className="checkout-player-status">
                            {draft.memberCategoryName ? 'Socio · ' : ''}tu parte {formatMoney(Number(draft.pricePerPlayer || 0))}
                          </p>
                        )}
                      </div>
                      <span className={`checkout-status-chip ${confirmedStatus === 'CONFIRMED' ? 'is-confirmed' : 'is-pending'}`}>{confirmedStatus === 'CONFIRMED' ? 'Confirmado' : 'Esperando al club'}</span>
                    </div>
                    {participants.map((participant) => (
                      <div className="checkout-player" key={participant.id}>
                        <span className="checkout-player-icon is-pending">
                          <span className="checkout-player-index">{getInitials(participant.name || participant.identifier)}</span>
                        </span>
                        <div className="checkout-player-info">
                          <p className="checkout-player-name">{participant.name || participant.identifier}</p>
                          <p className="checkout-player-status">
                            {participant.lookupStatus === 'EMAIL_WITHOUT_ACCOUNT'
                              ? 'La verá cuando se registre con ese email'
                              : 'Le avisamos para que acepte'}
                          </p>
                        </div>
                        <span className="checkout-status-chip is-pending">Esperando respuesta</span>
                      </div>
                    ))}
                  </div>
                  {openSlotCount > 0 && (
                    <p className="checkout-participants-note">
                      {openSlotCount === 1 ? 'Queda 1 lugar libre' : `Quedan ${openSlotCount} lugares libres`}. Podés invitar desde Mis reservas.
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="checkout-success-pay ck-rise" style={{ marginBottom: 0, animationDelay: '1.1s' }}>
              <div>
                <p className="payment-title">Se paga en el club</p>
                <p className="payment-copy">
                  {isPerPlayer ? 'Cada uno abona su parte en el mostrador.' : 'Lo abonás en el mostrador del club.'}
                </p>
              </div>
              <div>
                <p className="checkout-price-label" style={{ textAlign: 'inherit' }}>Total del turno</p>
                <p className="checkout-success-pay-amount">{formatMoney(draft.price)}</p>
              </div>
            </div>

            <div className="ck-bar-spacer" aria-hidden="true" />
            <div className="ck-done-actions">
              <button type="button" className="checkout-secondary" onClick={goBackToClub}>Reservar otro</button>
              <Link href="/bookings" replace className="checkout-primary">Ver mis reservas</Link>
            </div>
          </div>
        </main>
      </DarkPageLayout>
    );
  }

  return (
    <DarkPageLayout title="Checkout | Pique" extraCss={CHECKOUT_CSS} breadcrumbs={checkoutBreadcrumbs}>
      <main className="p-public-page">
        <div className="checkout-shell">
          <div className="checkout-layout">
            <section className="checkout-card">
              <div className="checkout-card-pad">
                <div className="ck-head">
                  <button type="button" className="ck-back" onClick={goBackToClub} aria-label="Volver">
                    <ChevronLeft size={18} />
                  </button>
                  <div>
                    <p className="ck-eyebrow">Último paso</p>
                    <h1 className="ck-title">Confirmá tu reserva</h1>
                  </div>
                </div>
                {summaryCard(false)}
              </div>

              <div className="checkout-participants">
                <div className="checkout-participants-head">
                  <div>
                    <h2 className="checkout-participants-title"><Users size={17} /> ¿Con quién jugás?</h2>
                    <p className="checkout-participants-copy">Opcional. También podés invitar después desde Mis reservas.</p>
                  </div>
                  <span className="checkout-places">
                    {draft.playerCount
                      ? `${participants.length + 1} de ${draft.playerCount} lugares`
                      : `${participants.length + 1} ${participants.length === 0 ? 'jugador' : 'jugadores'}`}
                  </span>
                </div>

                <div className="checkout-player-list" style={{ marginBottom: 0 }}>
                  <div className="checkout-player">
                    <span className="checkout-player-icon"><span className="checkout-player-index">1</span></span>
                    <div className="checkout-player-info">
                      <p className="checkout-player-name">{ownerName} · Vos</p>
                      <p className={`checkout-player-status${draft.memberCategoryName ? ' is-accent' : ''}`}>
                        {draft.memberCategoryName ? 'Socio · precio socio' : 'Titular'}
                      </p>
                    </div>
                    {isPerPlayer && <span className="checkout-player-amount">{formatMoney(ownerShare)}</span>}
                  </div>

                  {participants.map((participant, index) => (
                    <div className="checkout-player" key={participant.id}>
                      <span className="checkout-player-icon is-pending"><span className="checkout-player-index">{index + 2}</span></span>
                      <div className="checkout-player-info">
                        <p className="checkout-player-name">{participant.name || participant.identifier}</p>
                        <p className="checkout-player-status is-warn">
                          {participant.lookupStatus === 'EMAIL_WITHOUT_ACCOUNT'
                            ? 'Sin cuenta todavía · la invitación lo espera'
                            : 'Le llega la invitación al confirmar'}
                        </p>
                      </div>
                      {isPerPlayer && <span className="checkout-player-amount is-muted">{formatMoney(generalShare)}</span>}
                      <button
                        type="button"
                        className="checkout-player-remove"
                        aria-label={`Quitar a ${participant.name || participant.identifier}`}
                        onClick={() => handleRemoveParticipant(participant.id)}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}

                  {(draft.playerCount
                    ? Array.from({ length: openSlotCount }, (_, offset) => participants.length + 2 + offset)
                    : participantLimitReached ? [] : [participants.length + 2]
                  ).map((slotNumber, offset) => {
                    const isFirstOpen = offset === 0;
                    if (isFirstOpen && inviteEditorOpen) {
                      return (
                        <div key={`slot-${slotNumber}`} className="checkout-invite-box">
                          <div className="checkout-invite-head">
                            <span className="checkout-player-icon is-empty"><span className="checkout-player-index">{slotNumber}</span></span>
                            <p className="checkout-invite-title">
                              {draft.playerCount ? `Invitar al lugar ${slotNumber}` : 'Invitar a un jugador'}
                            </p>
                            <button type="button" className="checkout-link-btn" onClick={resetInviteEditor}>Cancelar</button>
                          </div>
                          <PlayerInviteSearch
                            clubSlug={draft.clubSlug}
                            clubLabel={formatSlugLabel(draft.clubSlug || '') || null}
                            ownerEmail={user?.email || null}
                            excludedRefs={participants.map((participant) => participant.ref || '').filter(Boolean)}
                            excludedIdentifiers={participants
                              .filter((participant) => !participant.inviteToken)
                              .map((participant) => participant.identifier)}
                            onPick={handlePickPlayer}
                          />
                          {participantError && (
                            <p className="checkout-field-error" role="alert" style={{ margin: 0 }}>{participantError}</p>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div className="checkout-player" key={`slot-${slotNumber}`}>
                        <span className="checkout-player-icon is-empty"><span className="checkout-player-index">{slotNumber}</span></span>
                        <div className="checkout-player-info">
                          <p className="checkout-player-name is-muted">{draft.playerCount ? 'Lugar libre' : 'Sumar otro jugador'}</p>
                          <p className="checkout-player-status">
                            {isPerPlayer ? 'Se cobra como no socio hasta que alguien lo ocupe' : 'Opcional'}
                          </p>
                        </div>
                        {isPerPlayer && <span className="checkout-player-amount is-muted">{formatMoney(generalShare)}</span>}
                        {isFirstOpen && (
                          <button
                            type="button"
                            className="checkout-add-player"
                            onClick={() => {
                              setInviteEditorOpen(true);
                              setParticipantError('');
                            }}
                          >
                            <UserPlus size={14} /> Invitar
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {draft.playerCount && openSlotCount === 0 ? (
                  <p className="checkout-participants-note">Ya completaste todos los lugares de esta modalidad.</p>
                ) : null}
              </div>
            </section>

            <aside className="checkout-card checkout-summary">
              <button
                type="button"
                className={`ck-price-toggle${priceDetailOpen ? ' is-open' : ''}`}
                onClick={() => setPriceDetailOpen((open) => !open)}
                aria-expanded={priceDetailOpen}
              >
                <span>
                  <span className="ck-price-toggle-title">Precio</span>
                  <span className="ck-price-toggle-sub">Total del turno {formatMoney(draft.price)}</span>
                </span>
                <span className="ck-price-toggle-action">
                  {priceDetailOpen ? 'Ocultar detalle' : 'Ver detalle'} <ChevronDown size={14} />
                </span>
              </button>
              <div className={`ck-price-detail${priceDetailOpen ? ' is-open' : ''}`}>
              <div className="checkout-price">
                <div>
                  <p className="checkout-price-label">Total del turno</p>
                  <p className="checkout-price-value">{formatMoney(draft.price)}</p>
                </div>
                {!isPerPlayer && (
                  <div className="checkout-price-notes">
                    {draft.lightsExtraApplied > 0.009 && (
                      <div>Luces +{formatMoney(draft.lightsExtraApplied)}{draft.lightsFromHour ? ` desde ${draft.lightsFromHour}` : ''}</div>
                    )}
                    {draft.discountAmount > 0.009 && <div style={{ color: 'var(--accent-fg)' }}>Descuento -{formatMoney(draft.discountAmount)}</div>}
                  </div>
                )}
              </div>

              {isPerPlayer && (
                <div className="checkout-breakdown">
                  <div className="checkout-breakdown-row">
                    <span className="checkout-breakdown-label">Vos{draft.memberCategoryName ? ' · socio' : ''}</span>
                    <span className="checkout-breakdown-amount">{formatMoney(ownerShare)}</span>
                  </div>
                  {Array.from({ length: otherSlotsCount }, (_, index) => {
                    const participant = participants[index];
                    return (
                      <div className="checkout-breakdown-row" key={`share-${index}`}>
                        <span className="checkout-breakdown-label">
                          {participant ? (participant.name || participant.identifier) : `Lugar ${index + 2} · sin asignar`}
                        </span>
                        <span className="checkout-breakdown-amount">{formatMoney(generalShare)}</span>
                      </div>
                    );
                  })}
                  <p className="checkout-breakdown-note">
                    {otherSlotsCount > 0 ? 'Si un invitado es socio y acepta, su parte baja a precio socio. ' : ''}
                    {draft.lightsExtraApplied > 0.009
                      ? `Incluye luces${draft.lightsFromHour ? ` desde ${draft.lightsFromHour}` : ''}, divididas entre los jugadores.`
                      : ''}
                  </p>
                </div>
              )}
              </div>

              <div className="checkout-card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="payment-option active">
                  <div className="payment-icon"><WalletCards size={18} /></div>
                  <div>
                    <p className="payment-title">Se paga en el club</p>
                    <p className="payment-copy">
                      {isPerPlayer
                        ? 'Cada jugador abona su parte en el mostrador.'
                        : 'Confirmás el turno ahora y lo abonás en el mostrador del club.'}
                    </p>
                  </div>
                </div>

                {clubConfirmsManually && (
                  <div className="ck-hint">
                    <Hourglass size={15} />
                    <span><b>El club confirma tu turno.</b> Te avisamos apenas lo haga; mientras tanto queda reservado a tu nombre.</span>
                  </div>
                )}

                {submitError && <div className="checkout-error">{submitError}</div>}

                <div className="checkout-actions ck-desktop-actions">
                  <button type="button" className="checkout-secondary" onClick={goBackToClub}>Volver</button>
                  <button
                    type="button"
                    className="checkout-primary"
                    onClick={() => { void handleConfirm(); }}
                    disabled={submitting}
                  >
                    {renderConfirmContent()}
                  </button>
                </div>
              </div>
            </aside>
          </div>

          {/* Celular: total y confirmar siempre a la vista */}
          <div className="ck-bar-spacer" aria-hidden="true" />
          <div className="ck-sticky">
            {submitError && <p className="ck-sticky-error" role="alert">{submitError}</p>}
            <div className="ck-sticky-row">
              <div className="ck-sticky-amount">
                <small>{isPerPlayer ? 'TU PARTE' : 'TOTAL'}</small>
                <b>{formatMoney(stickyAmount)}</b>
                <em>Se paga en el club</em>
              </div>
              <button
                type="button"
                className="checkout-primary"
                onClick={() => { void handleConfirm(); }}
                disabled={submitting}
              >
                {renderConfirmContent()}
              </button>
            </div>
          </div>
        </div>
      </main>
    </DarkPageLayout>
  );
}
