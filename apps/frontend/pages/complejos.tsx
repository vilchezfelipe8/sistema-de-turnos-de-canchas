import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Image from 'next/image';
import { Search, MapPin, Star, ChevronDown, X, Navigation, Check } from 'lucide-react';
import DarkPageLayout from '../components/DarkPageLayout';
import UserLoadingState from '../components/UserLoadingState';
import { ClubService, Club } from '../services/ClubService';
import { getClubReviewsSummary } from '../services/ClubReviewService';
import { useUserTheme } from '../contexts/UserThemeContext';
import { PUBLIC_SPORT_OPTIONS as SPORTS, PUBLIC_SPORT_LABELS as SPORT_LABELS, getPublicClubLocations, matchesPublicClubFilters, normalizePublicSport, PublicSport } from '../utils/publicClubFilters';

/* ── Geocoding (Nominatim, sin API key) ──────────────────────────── */
const geocode = async (address: string): Promise<{ lat: number; lon: number } | null> => {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
    const data = await res.json();
    if (!data[0]) return null;
    return { lat: Number(data[0].lat), lon: Number(data[0].lon) };
  } catch { return null; }
};

/* ── CSS ─────────────────────────────────────────────────────────── */
const PAGE_CSS = `
  .p-public-root.p-public-theme-light .p-breadcrumbs-wrap { position:relative; z-index:45; padding-bottom:0; }
  .vn-explore-top { position:relative; }
  .vn-explore-inner { max-width:1360px; margin:0 auto; padding:12px 40px 28px; }
  .vn-head-row { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; flex-wrap:wrap; margin-bottom:18px; }
  .vn-head-copy { max-width:640px; }
  .vn-h1 { font-size:clamp(28px,4vw,42px); font-weight:800; letter-spacing:-.04em; line-height:1.05; color:var(--text-primary); margin:0 0 10px; }
  .vn-sub { font-size:14px; color:var(--text-muted); font-weight:400; margin:0; line-height:1.6; }
  .vn-toolbar-slot { position:relative; }
  .vn-toolbar { position:relative; z-index:3; display:flex; flex-direction:column; gap:14px; padding:16px 18px; border-radius:24px;
    background:color-mix(in srgb, var(--surface-1) 88%, transparent); border:1px solid var(--border);
    box-shadow:var(--shadow-md); backdrop-filter:blur(14px); box-sizing:border-box;
    /* Misma duración y curva que .p-header: la barra y el navbar se mueven juntos */
    transition: transform .38s cubic-bezier(.4,0,.2,1), opacity .22s ease-out, background-color .26s ease, border-color .26s ease;
    will-change:transform; }
  .vn-toolbar.v-stuck { }
  .vn-toolbar.v-near { z-index:60; }
  .vn-toolbar.v-floating { position:fixed; top:var(--vn-toolbar-top, 76px); left:var(--vn-toolbar-left, 40px); width:var(--vn-toolbar-width, calc(100vw - 80px)); z-index:9500; opacity:1; transform:translate3d(0,var(--vn-toolbar-shift, 0px),0); }
  .vn-toolbar.v-floating.v-stuck { transform:translate3d(0,var(--vn-toolbar-shift, 0px),0); opacity:1; }
  .vn-toolbar.v-floating.v-leaving { opacity:.97; transform:translate3d(0,var(--vn-toolbar-shift, 0px),0); }
  @media (prefers-reduced-motion: reduce) { .vn-toolbar { transition:none; } }
  .vn-toolbar-search { position:relative; z-index:25; display:flex; gap:0; background:var(--border-subtle); border:1px solid var(--border-subtle); border-radius:999px; padding:4px; backdrop-filter:blur(20px); align-items:center; flex-wrap:wrap; }
  .vn-toolbar-seg { display:flex; align-items:center; gap:8px; padding:10px 16px; font-size:13px; font-weight:600; color:var(--text-secondary); cursor:pointer; position:relative; white-space:nowrap; border-radius:999px; transition:background .15s; background:transparent; border:none; font-family:inherit; }
  .vn-toolbar-seg:hover { background:var(--border-subtle); }
  .vn-toolbar-caret { width:12px; height:12px; color:var(--text-muted); flex-shrink:0; transform-origin:center; transition:transform .22s ease, color .18s ease; }
  .vn-toolbar-seg:hover .vn-toolbar-caret { color:var(--text-muted); }
  .vn-chip-wrap.vn-open .vn-toolbar-caret { transform:rotate(180deg); color:var(--accent-fg); }
  .vn-toolbar-divider { width:1px; height:28px; background:var(--border); flex-shrink:0; margin:0 2px; }
  .vn-toolbar-input-wrap { flex:1; min-width:220px; display:flex; align-items:center; position:relative; }
  .vn-search-ico { padding:0 14px 0 18px; color:var(--text-muted); display:flex; align-items:center; flex-shrink:0; }
  .vn-search-input { flex:1; min-width:120px; padding:10px 0; background:transparent; border:none; outline:none; color:var(--text-primary);
    font-family:var(--font-sans); font-size:13px; font-weight:500; }
  .vn-search-input::placeholder { color:var(--text-muted); font-weight:400; }
  .vn-search-clear { background:none; border:none; color:var(--text-muted); cursor:pointer; padding:0 12px; display:flex; align-items:center; }
  .vn-toolbar-clear { padding:9px 14px; background:var(--surface-1); color:var(--text-secondary); border:1px solid var(--border); border-radius:999px; font-size:12px; font-weight:700; display:inline-flex; align-items:center; gap:6px; transition:background .15s, border-color .15s, color .15s; cursor:pointer; font-family:inherit; white-space:nowrap; flex-shrink:0; }
  .vn-toolbar-clear:hover { background:var(--surface-2); }
  .vn-toolbar-mobile-search-toggle { display:none; }
  .vn-toolbar-row { display:flex; align-items:center; gap:12px; flex-wrap:wrap; justify-content:space-between; }
  .vn-results-inline { display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
  .vn-results-inline-text { font-size:13px; font-weight:700; color:var(--text-muted); letter-spacing:.03em; }
  .vn-results-inline-text b { color:var(--text-primary); }
  .vn-active-filters { display:flex; gap:8px; flex-wrap:wrap; }
  .vn-active-filters::-webkit-scrollbar { display:none; }
  .vn-active-pill { display:inline-flex; align-items:center; gap:6px; padding:7px 12px; border-radius:999px; background:var(--positive-bg); border:1px solid var(--accent-border-subtle); font-size:11px; font-weight:700; color:var(--accent-fg); }
  .vn-active-pill-button { background:var(--surface-1); border-color:var(--border); color:var(--text-secondary); cursor:pointer; font-family:inherit; }
  .vn-active-pill-button:hover { background:var(--surface-2); }
  .vn-chip-wrap { position:relative; }
  .vn-dropdown { position:absolute; top:calc(100% + 8px); left:0; min-width:260px; background:var(--surface-1); border:1px solid var(--border); border-radius:12px; overflow:hidden; box-shadow:var(--shadow-lg); z-index:120; }
  .vn-dropdown-list { max-height:260px; overflow-y:auto; margin:0; padding:6px; list-style:none; display:flex; flex-direction:column; gap:2px; }
  .vn-dropdown-item { width:100%; display:flex; align-items:center; gap:10px; min-height:44px; padding:0 12px; background:transparent; border:0; border-radius:10px; cursor:pointer; font-family:inherit; font-size:14px; color:var(--text-primary); font-weight:500; text-align:left; transition:background .15s, color .15s; }
  .vn-dropdown-item:hover { background:var(--surface-2); }
  .vn-dropdown-label { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .vn-dropdown-count { font-size:12px; font-weight:600; color:var(--text-muted); font-variant-numeric:tabular-nums; }
  .vn-dropdown-check { width:16px; height:16px; flex-shrink:0; color:var(--accent-fg); visibility:hidden; }
  .vn-dropdown-item.vn-selected { color:var(--accent-fg); font-weight:700; }
  .vn-dropdown-item.vn-selected .vn-dropdown-check { visibility:visible; }
  /* Map */
  .vn-map-sec { border-top:1px solid var(--border-subtle); }
  .vn-map-inner { max-width:1360px; margin:0 auto; padding:64px 40px; }
  .vn-map-head { margin-bottom:24px; }
  .vn-map-title { font-size:22px; font-weight:800; color:var(--text-primary); letter-spacing:-.025em; margin:0 0 4px; }
  .vn-map-sub { font-size:13px; color:var(--text-muted); margin:0; }
  .vn-map-wrap { height:420px; border-radius:20px; overflow:hidden; border:1px solid var(--border);
    background:var(--surface-1); position:relative; }
  .vn-map-loading { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    flex-direction:column; gap:12px; color:var(--text-muted); font-size:13px; font-weight:600; }
  /* Body / grid */
  .vn-body { width:100%; max-width:1360px; margin:0 auto; padding:28px 40px 80px; }
  .vn-results-head { width:100%; display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:28px; gap:12px; flex-wrap:wrap; }
  .vn-results-copy { min-width:240px; }
  .vn-results-section-title { font-size:22px; font-weight:800; color:var(--text-primary); letter-spacing:-.025em; margin:0 0 4px; }
  .vn-results-section-sub { font-size:13px; color:var(--text-muted); margin:0; }
  .vn-results-title { font-size:13px; font-weight:700; color:var(--text-muted); letter-spacing:.04em; }
  .vn-results-title b { color:var(--text-primary); }
  .vn-results-count { display:inline-flex; align-items:center; gap:6px; padding:8px 12px; border-radius:999px; background:var(--surface-1); border:1px solid var(--border); font-size:12px; font-weight:700; color:var(--text-muted); white-space:nowrap; }
  .vn-results-count b { color:var(--text-primary); }
  .vn-grid { width:100%; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:20px; align-items:stretch; }
  /* Club card */
  .vn-card { background:var(--surface-1); border:1px solid var(--border); border-radius:20px; overflow:hidden;
    transition:border-color .2s,transform .2s,box-shadow .2s; text-decoration:none; color:inherit; position:relative; z-index:0;
    display:flex; flex-direction:column; }
  .vn-card:hover { border-color:var(--accent-border-subtle); transform:translateY(-3px); box-shadow:var(--shadow-lg); z-index:2; }
  .vn-card-img { position:relative; height:200px; background:var(--surface-3); overflow:hidden; flex-shrink:0; }
  .vn-card-img-placeholder { width:100%; height:100%; display:flex; align-items:center; justify-content:center;
    background:linear-gradient(135deg,var(--surface-1) 0%,var(--surface-3) 50%,var(--surface-1) 100%); }
  .vn-card-logo { position:absolute; bottom:12px; left:12px; width:44px; height:44px; border-radius:10px;
    background:var(--surface-1); border:2px solid var(--border); overflow:hidden; display:flex; align-items:center; justify-content:center; }
  .vn-card-rating { position:absolute; top:12px; right:12px; display:inline-flex; align-items:center; gap:5px;
    padding:4px 10px; border-radius:999px; background:var(--overlay); backdrop-filter:blur(8px);
    border:1px solid var(--border); font-size:11px; font-weight:700; color:var(--text-primary); }
  .vn-card-rating svg { color:var(--accent-fg); }
  .vn-card-body { padding:18px 20px 20px; flex:1; display:flex; flex-direction:column; gap:8px; }
  .vn-card-name { font-size:16px; font-weight:800; color:var(--text-primary); letter-spacing:-.01em; }
  .vn-card-addr { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text-muted); font-weight:500; }
  .vn-card-addr svg { color:var(--text-muted); flex-shrink:0; }
  .vn-card-addr-row { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .vn-card-addr-row .vn-card-addr { flex:1; min-width:0; }
  .vn-card-addr-row .vn-card-addr span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .vn-card-sports { font-size:12px; font-weight:700; color:var(--accent-fg); margin-bottom:8px; }
  .vn-card-desc { font-size:13px; color:var(--text-muted); line-height:1.5;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .vn-card-footer { margin-top:auto; padding-top:14px; border-top:1px solid var(--border-subtle);
    display:flex; align-items:center; justify-content:flex-end; }
  .vn-card-cta { display:inline-flex; align-items:center; gap:6px; padding:8px 16px; border-radius:999px;
    background:var(--brand); color:var(--brand-on); font-size:11px; font-weight:800; letter-spacing:.01em;
    white-space:nowrap; flex-shrink:0; transition:background .15s; }
  .vn-card:hover .vn-card-cta { background:var(--brand); }
  /* Empty / skeleton */
  .vn-empty { grid-column:1/-1; padding:80px 0; text-align:center; display:flex; flex-direction:column; align-items:center; gap:14px; }
  .vn-empty-ico { color:var(--accent-border-subtle); }
  .vn-empty-title { font-size:18px; font-weight:800; color:var(--text-primary); }
  .vn-empty-sub { font-size:14px; color:var(--text-muted); }
  .vn-skeleton { animation:p-pulse 1.5s ease-in-out infinite; }
  .vn-card-photo { opacity:0; transition:opacity .35s ease; }
  .vn-card-photo.vn-loaded { opacity:1; }
  .vn-card-logo { opacity:0; transition:opacity .25s ease; }
  .vn-card-logo.vn-loaded { opacity:1; }
  .vn-results-head-plain .vn-results-copy { margin-bottom:0; }
  /* Abrir o cerrar filtros cambia el alto de la barra: sin esto el navegador corrige el
     scroll solo y ese movimiento muestra u oculta el navbar. */
  html { overflow-anchor:none; }
  @media(min-width:721px){ .vn-veil { display:none; } }
  @keyframes vn-drop-in { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:none; } }
  @keyframes vn-fade-in { from { opacity:0; } to { opacity:1; } }
  @media (prefers-reduced-motion: reduce) { .vn-dropdown, .vn-veil, .vn-toolbar-input-wrap.vn-mobile-open { animation:none !important; } }
  .vn-card-directions { display:none; }
  @media(max-width:720px){
    .vn-map-sec { display:none; }
    /* Misma línea que la ciudad: el área tocable mide 40px pero no agranda la fila */
    .vn-card-directions { display:inline-flex; flex-shrink:0; align-items:center; gap:5px; min-height:40px; margin:-12px -8px -12px 0; padding:0 8px; border:none; border-radius:999px; background:transparent; color:var(--accent-fg); font-family:inherit; font-size:12px; font-weight:700; cursor:pointer; }
  }
  .vn-seg-ico { color:var(--text-muted); }
  .vn-toolbar-seg.vn-seg-active,
  .p-public-root.p-public-theme-light .vn-toolbar-seg.vn-seg-active { color:var(--accent-fg); background:var(--positive-bg); }
  .vn-toolbar-seg.vn-seg-active .vn-seg-ico { color:var(--accent-fg); }
  .vn-seg-clear { display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; margin-right:-4px; border-radius:999px; color:var(--accent-fg); flex-shrink:0; }
  .vn-seg-clear:hover { background:color-mix(in srgb, var(--accent-fg) 14%, transparent); }
  .vn-sub-clear { padding:0; border:none; background:none; font:inherit; font-weight:700; color:var(--accent-fg); cursor:pointer; text-decoration:underline; text-underline-offset:3px; }
  @media(max-width:720px){ .vn-results-head-plain { display:none; } }
  .vn-skel-card { background:var(--surface-1); border:1px solid var(--border-subtle); border-radius:20px; overflow:hidden; }
  .vn-skel-img { height:200px; background:var(--surface-2); }
  .vn-skel-body { padding:18px 20px 20px; display:flex; flex-direction:column; gap:10px; }
  .vn-skel-line { height:12px; border-radius:6px; background:var(--surface-2); }
  /* Responsive */
  @media(max-width:1100px){
    .vn-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
  }
  @media(max-width:720px){
    .vn-explore-inner,.vn-map-inner,.vn-body { padding-left:20px; padding-right:20px; }
    .vn-explore-inner { padding-top:18px; padding-bottom:20px; }
    .vn-grid { grid-template-columns:1fr; }
    .vn-h1 { font-size:30px; }
    .vn-toolbar { gap:10px; padding:12px; border-radius:18px; }
    /* Mantener mismo padding/borde cuando está stuck para evitar reflow */
    .vn-toolbar.v-stuck { padding:12px; border-radius:18px; }
    .vn-toolbar.v-floating { top:var(--vn-toolbar-top, 72px); left:var(--vn-toolbar-left, 20px); width:var(--vn-toolbar-width, calc(100vw - 40px)); }
    .vn-toolbar-search { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto; align-items:center; border-radius:24px; padding:8px; gap:8px; }
    .vn-toolbar-divider { display:none; }
    .vn-toolbar-zone { order:1; min-width:0; }
    .vn-toolbar-sport { order:2; min-width:0; }
    .vn-toolbar-mobile-search-toggle { order:3; min-width:0; display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:8px 10px; border:none; border-radius:999px; background:var(--surface-1); color:var(--text-secondary); font-family:inherit; font-size:12px; font-weight:700; cursor:pointer; }
    .vn-toolbar-mobile-search-toggle.vn-active { background:var(--positive-bg); color:var(--accent-fg); }
    .vn-toolbar-input-wrap { display:none; order:4; min-width:0; grid-column:1 / -1; }
    .vn-toolbar-input-wrap.vn-mobile-open { display:flex; }
    .vn-search-input { width:100%; min-width:0; padding:12px 0; }
    .vn-toolbar-clear { display:none; }
    .vn-chip-wrap { position:static; min-width:0; }
    .vn-dropdown { left:0; right:0; width:auto; min-width:0; max-width:none; }
    .vn-toolbar-row { align-items:stretch; justify-content:flex-start; }
    .vn-results-inline { display:none; }
    .vn-active-filters { flex-wrap:nowrap; overflow-x:auto; padding-bottom:2px; }
    .vn-active-pill { flex:0 0 auto; }
    .vn-map-inner { padding-top:48px; padding-bottom:48px; }
    .vn-toolbar-zone .vn-toolbar-seg,
    .vn-toolbar-sport .vn-toolbar-seg { width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
    .vn-toolbar-zone .vn-toolbar-seg span:not(.vn-seg-clear),
    .vn-toolbar-sport .vn-toolbar-seg span:not(.vn-seg-clear) { display:block; flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    /* Ajustes de padding para alinear selects y texto de búsqueda */
    .vn-toolbar-search { padding:8px 12px; }
    .vn-toolbar-seg { padding:8px 12px; }
    /* Ajuste de paddings para equalizar espacio entre iconos e inputs */
    .vn-search-ico { padding:0 8px 0 12px; display:flex; align-items:center; }
    .vn-search-input { padding:8px 0; }
    /* Asegurar tamaños consistentes de iconos */
    .vn-search-ico svg { width:14px; height:14px; display:block; }
    .vn-toolbar-seg svg { width:14px; height:14px; display:block; flex-shrink:0; }
    .vn-results-head { align-items:center; gap:10px; margin-bottom:16px; }
    .vn-results-copy { display:none; }
    .vn-results-count { padding:7px 11px; font-size:11px; }
    .vn-card-desc,
    .vn-card-footer { display:none; }
  }
  .p-public-root.p-public-theme-light .vn-toolbar { background:rgba(255,255,255,.82); border-color:var(--border); box-shadow:0 12px 30px var(--border-subtle); }
  .p-public-root.p-public-theme-light .vn-h1,
  .p-public-root.p-public-theme-light .vn-map-title,
  .p-public-root.p-public-theme-light .vn-results-section-title,
  .p-public-root.p-public-theme-light .vn-card-name,
  .p-public-root.p-public-theme-light .vn-empty-title { color:var(--text-primary); }
  .p-public-root.p-public-theme-light .vn-sub,
  .p-public-root.p-public-theme-light .vn-card-desc,
  .p-public-root.p-public-theme-light .vn-empty-sub,
  .p-public-root.p-public-theme-light .vn-results-section-sub,
  .p-public-root.p-public-theme-light .vn-map-sub { color:var(--text-secondary); }
  .p-public-root.p-public-theme-light .vn-toolbar-search { background:var(--surface-1); border-color:var(--border); box-shadow:0 10px 24px var(--border); }
  .p-public-root.p-public-theme-light .vn-toolbar-seg { color:var(--text-primary); }
  .p-public-root.p-public-theme-light .vn-toolbar-seg:hover { background:var(--surface-2); }
  .p-public-root.p-public-theme-light .vn-toolbar-caret { color:var(--text-muted); }
  .p-public-root.p-public-theme-light .vn-search-ico { color:var(--text-muted); }
  .p-public-root.p-public-theme-light .vn-search-input { color:var(--text-primary); }
  .p-public-root.p-public-theme-light .vn-search-input::placeholder { color:var(--text-muted); }
  .p-public-root.p-public-theme-light .vn-search-clear { color:var(--text-muted); }
  .p-public-root.p-public-theme-light .vn-chip-wrap.vn-open .vn-toolbar-caret { color:var(--accent-fg); }
  .p-public-root.p-public-theme-light .vn-toolbar-divider { background:var(--border); }
  .p-public-root.p-public-theme-light .vn-toolbar-clear { background:var(--surface-1); border-color:var(--border); color:var(--text-secondary); }
  .p-public-root.p-public-theme-light .vn-toolbar-clear:hover { background:var(--surface-2); }
  .p-public-root.p-public-theme-light .vn-dropdown { background:var(--surface-1); border-color:var(--border); box-shadow:0 12px 28px var(--border); }
  .p-public-root.p-public-theme-light .vn-dropdown-item:hover { background:var(--surface-2); }
  .p-public-root.p-public-theme-light .vn-map-sec { border-color:var(--border-subtle); }
  .p-public-user-foot { margin-top:0; }
  .p-public-root.p-public-theme-light .vn-card,
  .p-public-root.p-public-theme-light .vn-map-wrap,
  .p-public-root.p-public-theme-light .vn-skel-card { background:var(--surface-1); border-color:var(--border); box-shadow:0 10px 24px var(--border-subtle); }
  .p-public-root.p-public-theme-light .vn-card-addr,
  .p-public-root.p-public-theme-light .vn-results-title,
  .p-public-root.p-public-theme-light .vn-map-loading { color:var(--text-muted); }
  .p-public-root.p-public-theme-light .vn-card-addr svg { color:var(--text-muted); }
  .p-public-root.p-public-theme-light .vn-results-title b { color:var(--text-primary); }
  .p-public-root.p-public-theme-light .vn-card-footer { border-top-color:var(--border-subtle); }
  .p-public-root.p-public-theme-light .vn-skel-img { background:var(--surface-2); }
  .p-public-root.p-public-theme-light .vn-skel-line { background:var(--border-subtle); }

  /* Una sola cápsula de filtros: sin la tarjeta exterior que la envolvía */
  .vn-toolbar,
  .vn-toolbar.v-stuck,
  .p-public-root.p-public-theme-light .vn-toolbar { padding:0; background:transparent; border:none; box-shadow:none; backdrop-filter:none; }
  .vn-toolbar-search,
  .p-public-root.p-public-theme-light .vn-toolbar-search { background:var(--surface-1); border-color:var(--border); box-shadow:0 10px 26px var(--border-subtle); }

  /* Mobile: mismo lenguaje que el resto de pantallas públicas (sin franja hero ni contenedores anidados) */
  @media(max-width:720px){
    .vn-explore-inner { padding-bottom:4px; }
    .vn-head-row { margin-bottom:16px; }
    .vn-toolbar,
    .vn-toolbar.v-stuck,
    .p-public-root.p-public-theme-light .vn-toolbar { padding:0; gap:10px; background:transparent; border:none; box-shadow:none; backdrop-filter:none; }
    .vn-toolbar-search,
    .p-public-root.p-public-theme-light .vn-toolbar-search { grid-template-columns:minmax(0,1fr) minmax(0,1fr) 40px; background:var(--surface-1); border-color:var(--border); padding:6px; gap:4px; border-radius:18px; box-shadow:0 8px 20px var(--border-subtle); }
    .vn-toolbar-seg { padding:10px; gap:6px; justify-content:center; }
    .vn-toolbar-mobile-search-toggle { width:40px; height:40px; padding:0; }
    .vn-toggle-label { display:none; }
    /* Desplegables pegados a la cápsula pero superpuestos: no empujan la página */
    .vn-chip-wrap { display:contents; }
    .vn-toolbar-zone .vn-toolbar-seg { order:1; }
    .vn-toolbar-sport .vn-toolbar-seg { order:2; }
    .vn-toolbar-search.vn-has-open,
    .p-public-root.p-public-theme-light .vn-toolbar-search.vn-has-open { border-bottom-left-radius:0; border-bottom-right-radius:0; box-shadow:none; }
    .vn-dropdown,
    .p-public-root.p-public-theme-light .vn-dropdown { position:absolute; top:calc(100% - 1px); left:-1px; right:-1px; margin:0; background:var(--surface-1); border:1px solid var(--border); border-top:1px solid var(--border-subtle); border-radius:0 0 18px 18px; box-shadow:0 18px 32px rgba(0,0,0,.18); animation:vn-drop-in .16s ease-out; }
    .vn-veil { position:fixed; inset:0; z-index:2; background:rgba(0,0,0,.28); animation:vn-fade-in .16s ease-out; }
    .vn-toolbar-input-wrap.vn-mobile-open { animation:vn-drop-in .16s ease-out; }
    .vn-body { padding-top:20px; }
    .vn-card-img { height:168px; }
  }
`;

type RatingMap = Record<number, { average: number; total: number }>;

function formatAddr(c: Club) {
  return [c.city, c.province].filter(Boolean).join(', ') || c.addressLine || '';
}

// Etiqueta corta solo para el botón del filtro; la lista muestra el nombre completo.
const ZONE_SHORT_LABELS: Record<string, string> = {
  'Ciudad Autónoma de Buenos Aires': 'CABA',
};

function directionsUrl(c: Club) {
  const query = [c.addressLine, c.city, c.province, c.country].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function SkeletonCard() {
  return (
    <div className="vn-skel-card vn-skeleton">
      <div className="vn-skel-img" />
      <div className="vn-skel-body">
        <div className="vn-skel-line" style={{ width: '65%' }} />
        <div className="vn-skel-line" style={{ width: '40%' }} />
        <div className="vn-skel-line" style={{ width: '80%' }} />
      </div>
    </div>
  );
}

function RatingBadge({ rating, total }: { rating: number; total: number }) {
  if (!total) return null;
  return (
    <div className="vn-card-rating">
      <Star size={11} fill="var(--brand)" />
      {rating.toFixed(1)} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>({total})</span>
    </div>
  );
}

export default function ComplejosPage() {
  const router = useRouter();
  const { isLight } = useUserTheme();
  const searchRef = useRef<HTMLInputElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const toolbarSentinelRef = useRef<HTMLDivElement>(null);
  const toolbarSlotRef = useRef<HTMLDivElement>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const mapTileLayerRef = useRef<any>(null);

  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratings, setRatings] = useState<RatingMap>({});
  const [loadedMedia, setLoadedMedia] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [zone, setZone] = useState('');
  const [sport, setSport] = useState<PublicSport>('');
  const [showZoneDropdown, setShowZoneDropdown] = useState(false);
  const [showSportDropdown, setShowSportDropdown] = useState(false);
  const [toolbarStuck, setToolbarStuck] = useState(false);
  const [toolbarFloating, setToolbarFloating] = useState(false);
  const [toolbarNear, setToolbarNear] = useState(false);
  const [toolbarLeaving, setToolbarLeaving] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [navHidden, setNavHidden] = useState(false);
  const [navHeight, setNavHeight] = useState(76);
  const [toolbarFrame, setToolbarFrame] = useState<{ left: number; width: number; height: number }>({
    left: 40,
    width: 960,
    height: 0
  });
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [paramsRead, setParamsRead] = useState(false);

  // Read URL params once router is ready
  useEffect(() => {
    if (!router.isReady || paramsRead) return;
    if (router.query.q) {
      setSearch(String(router.query.q));
      setMobileSearchOpen(true);
    }
    if (router.query.zone) setZone(String(router.query.zone));
    if (router.query.sport) setSport(normalizePublicSport(String(router.query.sport)));
    setParamsRead(true);
  }, [router.isReady, paramsRead, router.query.q, router.query.zone, router.query.sport]);

  // Sync filters → URL (shallow, no page reload)
  useEffect(() => {
    if (!paramsRead) return;
    const q: Record<string, string> = {};
    if (search) q.q = search;
    if (zone) q.zone = zone;
    if (sport) q.sport = sport;
    void router.replace({ pathname: '/complejos', query: q }, undefined, { shallow: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, zone, sport, paramsRead]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!filtersRef.current?.contains(event.target as Node)) {
        setShowZoneDropdown(false);
        setShowSportDropdown(false);
        // Un buscador abierto y vacío no aporta nada: se cierra al tocar afuera.
        if (!searchRef.current?.value.trim()) setMobileSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !toolbarSentinelRef.current) return;
    // Umbral fijo (alto del navbar visible): si dependiera de navHidden, al ocultarse el
    // navbar el umbral bajaría y la barra se soltaría y volvería a fijarse en pleno scroll.
    const observer = new IntersectionObserver(
      ([entry]) => setToolbarStuck(!entry.isIntersecting),
      {
        root: null,
        threshold: 0,
        rootMargin: `-${navHeight}px 0px 0px 0px`
      }
    );
    // El aviso de "fijada" llega un frame tarde: en ese frame la barra pasaría por debajo
    // del navbar. Al acercarse al borde se eleva por encima de él para que nunca la tape.
    const nearObserver = new IntersectionObserver(
      ([entry]) => setToolbarNear(!entry.isIntersecting),
      {
        root: null,
        threshold: 0,
        rootMargin: `-${navHeight + 48}px 0px 0px 0px`
      }
    );
    observer.observe(toolbarSentinelRef.current);
    nearObserver.observe(toolbarSentinelRef.current);
    return () => {
      observer.disconnect();
      nearObserver.disconnect();
    };
  }, [navHeight]);

  useEffect(() => {
    if (!toolbarStuck) {
      setToolbarFloating(false);
      setToolbarLeaving(false);
      return undefined;
    }

    setToolbarFloating(true);
    setToolbarLeaving(false);
    return undefined;
  }, [toolbarStuck]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const measure = () => {
      const slotRect = toolbarSlotRef.current?.getBoundingClientRect();
      const toolbarRect = filtersRef.current?.getBoundingClientRect();
      if (!slotRect) return;
      setToolbarFrame((prev) => ({
        left: slotRect.left,
        width: slotRect.width,
        // Con la barra fijada, el hueco reservado conserva su alto: si creciera al abrir un
        // desplegable empujaría la página y el scroll resultante ocultaría el navbar.
        height: toolbarStuck ? prev.height : (toolbarRect?.height || prev.height)
      }));
    };

    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, [toolbarStuck, showZoneDropdown, showSportDropdown, search, zone, sport]);

  // El estado del navbar se lee del propio NavBar (clase p-header-hidden) en vez de
  // recalcularlo acá: así la barra de filtros se mueve exactamente cuando él se mueve.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const header = document.querySelector<HTMLElement>('.p-player-nav');
    if (!header) return;

    const sync = () => {
      setNavHidden(header.classList.contains('p-header-hidden'));
      if (header.offsetHeight) setNavHeight(header.offsetHeight);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(header, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, []);

  useEffect(() => {
    if (!mobileSearchOpen) return;
    searchRef.current?.focus({ preventScroll: true });
  }, [mobileSearchOpen]);

  // Load clubs + ratings
  useEffect(() => {
    ClubService.getAllClubs()
      .then(async (all) => {
        setClubs(all);
        // Las tarjetas se muestran sin esperar las reseñas; el rating aparece cuando llega.
        setLoading(false);
        const ratingResults = await Promise.all(
          all.map(c =>
            getClubReviewsSummary(c.slug)
              .then(s => ({ id: c.id, average: s.averageRating, total: s.count }))
              .catch(() => ({ id: c.id, average: 0, total: 0 }))
          )
        );
        const map: RatingMap = {};
        ratingResults.forEach(r => { map[r.id] = { average: r.average, total: r.total }; });
        setRatings(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Load Leaflet from CDN (client-side only)
  useEffect(() => {
    if (typeof window === 'undefined' || mapLoaded) return;
    // En mobile el mapa no se muestra: cada tarjeta ofrece "Cómo llegar".
    if (window.matchMedia('(max-width:720px)').matches) return;
    setMapLoaded(true);
    const leafletCss = document.createElement('link');
    leafletCss.rel = 'stylesheet';
    leafletCss.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(leafletCss);

    const gestureCss = document.createElement('link');
    gestureCss.rel = 'stylesheet';
    gestureCss.href = 'https://unpkg.com/leaflet-gesture-handling/dist/leaflet-gesture-handling.min.css';
    document.head.appendChild(gestureCss);

    const leafletScript = document.createElement('script');
    leafletScript.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    leafletScript.onload = () => {
      const gestureScript = document.createElement('script');
      gestureScript.src = 'https://unpkg.com/leaflet-gesture-handling';
      gestureScript.onload = () => setMapReady(true);
      gestureScript.onerror = () => setMapReady(true); // fallback: init map without plugin
      document.head.appendChild(gestureScript);
    };
    leafletScript.onerror = () => setMapReady(false);
    document.head.appendChild(leafletScript);
  }, [mapLoaded]);

  // Initialize map once Leaflet + clubs are ready
  useEffect(() => {
    const L = typeof window !== 'undefined' ? (window as any).L : null;
    if (!mapReady || !L || !mapDivRef.current || leafletMapRef.current || clubs.length === 0) return;

    const map = L.map(mapDivRef.current, {
      zoomControl: true,
      attributionControl: false,
      scrollWheelZoom: true,
      gestureHandling: true,
      gestureHandlingOptions: {
        duration: 1200,
        text: {
          touch: 'Usa dos dedos para mover el mapa',
          scroll: 'Usa Ctrl + desplazamiento para acercar o alejar el mapa',
          scrollMac: 'Usa ⌘ + desplazamiento para acercar o alejar el mapa',
        },
      },
    })
      .setView([-34.6, -60], 5);

    // Fallback si el plugin no carga: evitar zoom accidental con trackpad/rueda.
    if (!map.gestureHandling) {
      map.scrollWheelZoom.disable();
      map.touchZoom.disable();
    }

    mapTileLayerRef.current = L.tileLayer(
      isLight
        ? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
        : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { maxZoom: 19 }
    ).addTo(map);
    L.control.attribution({ prefix: '© OpenStreetMap · CartoDB' }).addTo(map);
    leafletMapRef.current = map;

    // Pique marker icon
    const markerIcon = (name: string) => L.divIcon({
      className: '',
      html: `<div style="width:32px;height:32px;border-radius:50% 50% 50% 0;background:var(--brand);border:2px solid var(--brand-on);transform:rotate(-45deg);box-shadow:var(--shadow-md);display:flex;align-items:center;justify-content:center">
        <div style="transform:rotate(45deg);font-size:14px">📍</div>
      </div>
      <div style="position:absolute;top:36px;left:50%;transform:translateX(-50%);background:var(--overlay);color:var(--text-primary);font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;white-space:nowrap;font-family:Geist,system-ui,sans-serif;border:1px solid var(--border)">${name}</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -36],
    });

    // Geocode each club and add marker
    clubs.forEach(async (club) => {
      const addr = [club.addressLine, club.city, club.province, 'Argentina'].filter(Boolean).join(', ');
      const coords = await geocode(addr);
      if (!coords || !leafletMapRef.current) return;
      const marker = L.marker([coords.lat, coords.lon], { icon: markerIcon(club.name) }).addTo(map);
      marker.bindPopup(`<div style="font-family:Geist,system-ui,sans-serif;min-width:160px">
        <div style="font-weight:800;font-size:13px;margin-bottom:4px">${club.name}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${formatAddr(club)}</div>
        <a href="/club/${club.slug}" style="display:inline-block;padding:5px 12px;border-radius:8px;background:var(--brand);color:var(--brand-on);font-size:11px;font-weight:800;text-decoration:none">Ver complejo →</a>
      </div>`, { maxWidth: 220 });
    });
  }, [mapReady, clubs, isLight]);

  useEffect(() => {
    const L = typeof window !== 'undefined' ? (window as any).L : null;
    if (!L || !leafletMapRef.current) return;
    if (mapTileLayerRef.current) {
      leafletMapRef.current.removeLayer(mapTileLayerRef.current);
    }
    mapTileLayerRef.current = L.tileLayer(
      isLight
        ? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
        : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { maxZoom: 19 }
    ).addTo(leafletMapRef.current);
  }, [isLight]);

  const zones = useMemo(
    () => getPublicClubLocations(clubs).map(location => location.city),
    [clubs]
  );

  const filtered = useMemo(
    () => clubs.filter(club => matchesPublicClubFilters(club, { search, zone, sport })),
    [clubs, search, zone, sport],
  );

  // Cantidad por opción teniendo en cuenta los demás filtros; las opciones sin complejos se ocultan.
  const zoneOptions = useMemo(() => {
    const pool = clubs.filter(club => matchesPublicClubFilters(club, { search, sport }));
    return {
      all: pool.length,
      items: zones
        .map(z => ({ value: z, label: z, count: pool.filter(club => matchesPublicClubFilters(club, { zone: z })).length }))
        .filter(option => option.count > 0 || option.value === zone),
    };
  }, [clubs, zones, search, sport, zone]);
  const sportOptions = useMemo(() => {
    const pool = clubs.filter(club => matchesPublicClubFilters(club, { search, zone }));
    return {
      all: pool.length,
      items: SPORTS.filter(option => option.value)
        .map(option => ({ value: option.value, label: option.label, count: pool.filter(club => matchesPublicClubFilters(club, { sport: option.value })).length }))
        .filter(option => option.count > 0 || option.value === sport),
    };
  }, [clubs, search, zone, sport]);

  const hasFilters = search || zone || sport;
  const activeFilterCount = (zone ? 1 : 0) + (sport ? 1 : 0) + (search.trim() ? 1 : 0);
  // Sin resultados ya lo explica el estado vacío de la grilla.
  const heroSub = hasFilters && !loading && filtered.length > 0
    ? `${filtered.length} ${filtered.length === 1 ? 'complejo encontrado' : 'complejos encontrados'}`
    : '';
  // Cierre del segmento: con filtro activo, la flecha pasa a ser una ✕ que lo quita.
  // El desplegable sigue ofreciendo "Todas/Todos" para quien navega con teclado.
  const segmentEnd = (active: boolean, onClear: () => void) => (active
    ? (
      <span
        className="vn-seg-clear"
        aria-hidden="true"
        onClick={(event) => {
          event.stopPropagation();
          onClear();
          setShowZoneDropdown(false);
          setShowSportDropdown(false);
        }}
      >
        <X size={13} />
      </span>
    )
    : <ChevronDown className="vn-toolbar-caret" />);
  const markLoaded = (key: string) => setLoadedMedia(prev => (prev[key] ? prev : { ...prev, [key]: true }));
  const mapTitle = 'Mapa de complejos';
  const mapSub = hasFilters
    ? 'Ubicación de los complejos que coinciden con tus filtros.'
    : 'Encontrá el complejo más cercano a vos.';
  const clearFilters = () => {
    setSearch('');
    setZone('');
    setSport('');
    setMobileSearchOpen(false);
    setShowZoneDropdown(false);
    setShowSportDropdown(false);
  };

  return (
    <DarkPageLayout
      title="Complejos | Pique"
      extraCss={PAGE_CSS}
      breadcrumbs={[
        { label: 'Inicio', href: '/' },
        { label: 'Complejos' },
      ]}
    >

      <section className="vn-explore-top">
        <div className="vn-explore-inner">
          <div className="vn-head-row">
            <div className="vn-head-copy">
              <h1 className="p-public-page-h">Dónde <i>jugar</i></h1>
              {(heroSub || activeFilterCount >= 2) && (
                <p className="p-public-page-sub">
                  {heroSub}
                  {activeFilterCount >= 2 && (
                    <>
                      {heroSub && <span className="vn-sub-sep" aria-hidden="true"> · </span>}
                      <button type="button" className="vn-sub-clear" onClick={clearFilters}>Limpiar filtros</button>
                    </>
                  )}
                </p>
              )}
            </div>
          </div>

          {(showZoneDropdown || showSportDropdown) && <div className="vn-veil" aria-hidden="true" />}
          <div ref={toolbarSentinelRef} aria-hidden="true" style={{ height: 1 }} />
          <div
            ref={toolbarSlotRef}
            className="vn-toolbar-slot"
            style={{ minHeight: (toolbarFloating || toolbarLeaving) && toolbarFrame.height ? toolbarFrame.height : undefined }}
          >
          {(() => {
            const leaving = toolbarLeaving;
            const toolbarTop = (toolbarFloating || toolbarLeaving) ? `${navHeight}px` : undefined;
            // Con el navbar oculto la barra sube con transform (no con top) para acompañar
            // su animación con la misma duración y curva.
            const toolbarShift = navHidden ? `${-(navHeight - 14)}px` : '0px';
            return (
          <div
            className={`vn-toolbar${toolbarNear ? ' v-near' : ''}${(toolbarFloating || toolbarLeaving) ? ' v-floating' : ''}${toolbarStuck ? ' v-stuck' : leaving ? ' v-leaving' : ''}`}
            ref={filtersRef}
            style={
              (toolbarFloating || toolbarLeaving)
                ? ({
                    ['--vn-toolbar-top' as any]: toolbarTop,
                    ['--vn-toolbar-shift' as any]: toolbarShift,
                    ['--vn-toolbar-left' as any]: `${toolbarFrame.left}px`,
                    ['--vn-toolbar-width' as any]: `${toolbarFrame.width}px`
                  } as React.CSSProperties)
                : undefined
            }
          >
            <div className={`vn-toolbar-search${showZoneDropdown || showSportDropdown ? ' vn-has-open' : ''}`}>
              <div className={`vn-chip-wrap vn-toolbar-zone${showZoneDropdown ? ' vn-open' : ''}`} onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className={`vn-toolbar-seg${zone ? ' vn-seg-active' : ''}`}
                  onClick={() => {
                    setShowSportDropdown(false);
                    setMobileSearchOpen(false);
                    setShowZoneDropdown((prev) => !prev);
                  }}
                >
                  <MapPin size={13} className="vn-seg-ico" />
                  <span>{zone ? (ZONE_SHORT_LABELS[zone] || zone) : 'Zona'}</span>
                  {segmentEnd(!!zone, () => setZone(''))}
                </button>
                {showZoneDropdown && (
                  <div className="vn-dropdown">
                    <ul className="vn-dropdown-list" role="listbox" aria-label="Zona">
                      {[{ value: '', label: 'Todas las zonas', count: zoneOptions.all }, ...zoneOptions.items].map((option) => {
                        const selected = zone === option.value;
                        return (
                          <li key={option.value || 'all'}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={selected}
                              className={`vn-dropdown-item${selected ? ' vn-selected' : ''}`}
                              onClick={() => {
                                setZone(option.value);
                                setShowZoneDropdown(false);
                              }}
                            >
                              <span className="vn-dropdown-label">{option.label}</span>
                              <span className="vn-dropdown-count">{option.count}</span>
                              <Check className="vn-dropdown-check" aria-hidden="true" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>

              <div className="vn-toolbar-divider" />

              <div className={`vn-chip-wrap vn-toolbar-sport${showSportDropdown ? ' vn-open' : ''}`} onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className={`vn-toolbar-seg${sport ? ' vn-seg-active' : ''}`}
                  onClick={() => {
                    setShowZoneDropdown(false);
                    setMobileSearchOpen(false);
                    setShowSportDropdown((prev) => !prev);
                  }}
                >
                  <svg className="vn-seg-ico" style={{ display: 'flex', flexShrink: 0 }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 2a15 15 0 0 1 0 20M2 12h20" /></svg>
                  <span>{sport ? SPORT_LABELS[sport] : 'Deporte'}</span>
                  {segmentEnd(!!sport, () => setSport(''))}
                </button>
                {showSportDropdown && (
                  <div className="vn-dropdown">
                    <ul className="vn-dropdown-list" role="listbox" aria-label="Deporte">
                      {[{ value: '' as PublicSport, label: 'Todos los deportes', count: sportOptions.all }, ...sportOptions.items].map((option) => {
                        const selected = sport === option.value;
                        return (
                          <li key={option.value || 'all'}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={selected}
                              className={`vn-dropdown-item${selected ? ' vn-selected' : ''}`}
                              onClick={() => {
                                setSport(option.value);
                                setShowSportDropdown(false);
                              }}
                            >
                              <span className="vn-dropdown-label">{option.label}</span>
                              <span className="vn-dropdown-count">{option.count}</span>
                              <Check className="vn-dropdown-check" aria-hidden="true" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>

              <button
                type="button"
                className={`vn-toolbar-mobile-search-toggle${!!search && !mobileSearchOpen ? ' vn-active' : ''}`}
                onClick={() => {
                  setShowZoneDropdown(false);
                  setShowSportDropdown(false);
                  setMobileSearchOpen((prev) => {
                    if (!prev) requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
                    return !prev;
                  });
                }}
                aria-expanded={mobileSearchOpen}
                aria-controls="complejos-mobile-search"
              >
                <Search size={14} />
                <span className="vn-toggle-label">Buscar</span>
              </button>

              <div className="vn-toolbar-divider" />

              <div
                id="complejos-mobile-search"
                className={`vn-toolbar-input-wrap${mobileSearchOpen ? ' vn-mobile-open' : ''}`}
              >
                <span className="vn-search-ico"><Search size={16} /></span>
                <input ref={searchRef} className="vn-search-input" type="text" value={search}
                  onFocus={() => { setShowZoneDropdown(false); setShowSportDropdown(false); }}
                  onChange={e => setSearch(e.target.value)} placeholder="Buscar complejo" autoComplete="off" />
                {search && (
                  <button className="vn-search-clear" onClick={() => { setSearch(''); searchRef.current?.focus(); }}>
                    <X size={14} />
                  </button>
                )}
              </div>

            </div>

          </div>
            );
          })()}
          </div>
        </div>
      </section>

      {/* ── TODOS LOS COMPLEJOS ── */}
      <div className="vn-body">
        {!hasFilters && (
          <div className="vn-results-head vn-results-head-plain">
            <div className="vn-results-copy">
              <h2 className="vn-results-section-title">Todos los complejos</h2>
            </div>
          </div>
        )}

        <div className="vn-grid">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
            : filtered.length === 0
            ? (
              <div className="vn-empty">
                <svg className="vn-empty-ico" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
                </svg>
                <p className="vn-empty-title">Sin resultados</p>
                <p className="vn-empty-sub">Probá con otros filtros o buscá por otro nombre.</p>
              </div>
            )
            : filtered.map(club => {
              const r = ratings[club.id];
              return (
                <Link key={club.id} href={`/club/${club.slug}`} className="vn-card">
                  <div className={`vn-card-img${club.clubImageUrl && !loadedMedia[`img-${club.id}`] ? ' vn-skeleton' : ''}`}>
                    {club.clubImageUrl
                      ? <Image src={club.clubImageUrl} alt={club.name} fill
                          className={`vn-card-photo${loadedMedia[`img-${club.id}`] ? ' vn-loaded' : ''}`}
                          onLoad={() => markLoaded(`img-${club.id}`)}
                          style={{ objectFit: 'cover' }} sizes="(max-width:720px) 100vw, 380px" />
                      : <div className="vn-card-img-placeholder">
                          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--positive-bg)" strokeWidth="1">
                            <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                          </svg>
                        </div>
                    }
                    {club.logoUrl && (
                      <div className={`vn-card-logo${loadedMedia[`logo-${club.id}`] ? ' vn-loaded' : ''}`}>
                        <Image src={club.logoUrl} alt="" width={40} height={40} style={{ objectFit: 'contain' }}
                          onLoad={() => markLoaded(`logo-${club.id}`)} />
                      </div>
                    )}
                    {r && r.total > 0 && <RatingBadge rating={r.average} total={r.total} />}
                  </div>

                  <div className="vn-card-body">
                    <div className="vn-card-name">{club.name}</div>
                    {formatAddr(club) && (
                      <div className="vn-card-addr-row">
                        <div className="vn-card-addr"><MapPin size={11} /><span>{formatAddr(club)}</span></div>
                        <button
                          type="button"
                          className="vn-card-directions"
                          onClick={(event) => {
                            // La tarjeta entera es un link al club: este botón abre el mapa sin navegar.
                            event.preventDefault();
                            event.stopPropagation();
                            window.open(directionsUrl(club), '_blank', 'noopener,noreferrer');
                          }}
                        >
                          <Navigation size={12} />
                          Cómo llegar
                        </button>
                      </div>
                    )}
                    {club.publicSports && club.publicSports.length > 0 && (
                      <div className="vn-card-sports">
                        {club.publicSports.map(s => SPORT_LABELS[s as PublicSport] || s).join(' · ')}
                      </div>
                    )}
                    {club.description && <div className="vn-card-desc">{club.description}</div>}
                    <div className="vn-card-footer">
                      <span className="vn-card-cta">Ver complejo →</span>
                    </div>
                  </div>
                </Link>
              );
            })
          }
        </div>
      </div>

      {/* ── MAPA ── */}
      <section className="vn-map-sec">
        <div className="vn-map-inner">
          <div className="vn-map-head">
            <h2 className="vn-map-title">{mapTitle}</h2>
            <p className="vn-map-sub">{mapSub}</p>
          </div>
          <div className="vn-map-wrap">
            <div ref={mapDivRef} style={{ width: '100%', height: '100%' }} />
            {!mapReady && (
              <div
                className="vn-map-loading"
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  gap: 12,
                  color: 'var(--text-muted)',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                <UserLoadingState mode="inline" message="Cargando mapa..." />
              </div>
            )}
          </div>
        </div>
      </section>

    </DarkPageLayout>
  );
}
