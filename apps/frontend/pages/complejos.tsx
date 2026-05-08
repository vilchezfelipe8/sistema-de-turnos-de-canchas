import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Image from 'next/image';
import { Search, MapPin, Star, ChevronDown, X, SlidersHorizontal, Flame, Tag } from 'lucide-react';
import DarkPageLayout from '../components/DarkPageLayout';
import UserLoadingState from '../components/UserLoadingState';
import { ClubService, Club } from '../services/ClubService';
import { getClubReviewsSummary } from '../services/ClubReviewService';
import { useUserTheme } from '../contexts/UserThemeContext';

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
  /* Hero */
  .vn-hero { position:relative; overflow:visible; border-bottom:1px solid rgba(255,255,255,.06); z-index:30; }
  .vn-hero-bg { position:absolute; inset:0;
    background: radial-gradient(ellipse 70% 60% at 60% 80%, rgba(34,197,94,.07) 0%, transparent 70%),
                radial-gradient(ellipse 50% 40% at 10% 20%, rgba(34,197,94,.04) 0%, transparent 60%); }
  .vn-hero-inner { position:relative; z-index:2; max-width:860px; margin:0 auto; padding:72px 40px 60px; text-align:center; }
  .vn-badge { display:inline-flex; align-items:center; gap:8px; padding:5px 14px; border-radius:999px;
    background:rgba(34,197,94,.1); border:1px solid rgba(34,197,94,.2);
    font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:#22c55e; margin-bottom:20px; }
  .vn-badge-dot { width:6px; height:6px; border-radius:50%; background:#22c55e; animation:tc-pulse 2s ease-in-out infinite; }
  .vn-eyebrow { font-size:11px; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:#555; margin-bottom:14px; }
  .vn-h1 { font-size:clamp(36px,5vw,64px); font-weight:800; letter-spacing:-.04em; line-height:1.05; color:#f2f2f2; margin:0 0 16px; }
  .vn-h1 i { font-style:italic; color:#22c55e; }
  .vn-sub { font-size:16px; color:#666; font-weight:400; margin:0 0 36px; line-height:1.6; }
  /* Search */
  .vn-search { display:flex; align-items:center; background:#111; border:1px solid rgba(255,255,255,.12);
    border-radius:999px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,.4);
    max-width:640px; margin:0 auto 24px; transition:border-color .2s; }
  .vn-search:focus-within { border-color:rgba(34,197,94,.4); }
  .vn-search-ico { padding:0 14px 0 20px; color:#444; display:flex; align-items:center; flex-shrink:0; }
  .vn-search-input { flex:1; background:transparent; border:none; outline:none; color:#f2f2f2;
    font-family:'Sora',system-ui,sans-serif; font-size:14px; font-weight:500; padding:14px 0; }
  .vn-search-input::placeholder { color:#444; font-weight:400; }
  .vn-search-clear { background:none; border:none; color:#555; cursor:pointer; padding:0 8px; display:flex; align-items:center; }
  /* Chips */
  .vn-filters { display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:center; }
  .vn-chip-wrap { position:relative; }
  .vn-chip { position:relative; display:inline-flex; align-items:center; gap:7px; padding:8px 14px; border-radius:999px;
    background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1);
    font-size:12px; font-weight:700; color:#888; cursor:pointer; font-family:inherit;
    transition:border-color .15s,color .15s, background .15s; appearance:none; }
  .vn-chip:hover { border-color:rgba(255,255,255,.2); color:#e8e8e8; }
  .vn-chip.vn-active { background:rgba(34,197,94,.1); border-color:rgba(34,197,94,.35); color:#22c55e; }
  .vn-chip-ico { width:13px; height:13px; flex-shrink:0; }
  .vn-chip-caret { width:11px; height:11px; flex-shrink:0; color:#666; transform-origin:center; transition:transform .22s ease, color .18s ease; }
  .vn-chip-wrap:hover .vn-chip-caret { color:#9ca3af; }
  .vn-chip-wrap.vn-open .vn-chip-caret { transform:rotate(180deg); color:#22c55e; }
  .vn-dropdown { position:absolute; top:calc(100% + 8px); left:0; min-width:260px; background:#111; border:1px solid rgba(255,255,255,.1); border-radius:12px; overflow:hidden; box-shadow:0 8px 24px rgba(0,0,0,.4); z-index:120; }
  .vn-dropdown-head { padding:10px 16px; border-bottom:1px solid rgba(255,255,255,.08); font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.14em; color:#555; }
  .vn-dropdown-list { max-height:220px; overflow-y:auto; margin:0; padding:0; list-style:none; }
  .vn-dropdown-item { width:100%; display:flex; align-items:center; gap:10px; padding:11px 16px; background:transparent; border:0; border-bottom:1px solid rgba(255,255,255,.05); cursor:pointer; font-family:inherit; font-size:13px; color:#c8c8c8; font-weight:500; text-align:left; transition:background .15s, color .15s; }
  .vn-dropdown-item:last-child { border-bottom:none; }
  .vn-dropdown-item:hover { background:rgba(255,255,255,.05); }
  .vn-dropdown-item.vn-selected { background:rgba(34,197,94,.1); color:#22c55e; }
  .vn-dropdown-item-ico { width:13px; height:13px; color:#22c55e; flex-shrink:0; }
  .vn-chip-sep { width:1px; height:20px; background:rgba(255,255,255,.08); margin:0 2px; }
  .vn-adv-btn { display:inline-flex; align-items:center; gap:7px; padding:8px 14px; border-radius:999px;
    background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1);
    font-size:12px; font-weight:700; color:#888; cursor:pointer; font-family:inherit; transition:border-color .15s,color .15s; }
  .vn-adv-btn:hover { border-color:rgba(255,255,255,.2); color:#e8e8e8; }
  /* Adv panel */
  .vn-adv { max-width:640px; margin:16px auto 0; background:#111; border:1px solid rgba(255,255,255,.1);
    border-radius:16px; padding:18px 22px; display:flex; align-items:flex-end; gap:16px; flex-wrap:wrap; }
  .vn-adv label { display:block; font-size:10px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:#555; margin-bottom:8px; }
  .vn-adv input[type="number"] { width:140px; padding:9px 12px; background:#0a0a0a;
    border:1px solid rgba(255,255,255,.1); border-radius:10px;
    color:#f2f2f2; font-family:inherit; font-size:13px; font-weight:600; outline:none; }
  .vn-adv input[type="number"]:focus { border-color:rgba(34,197,94,.4); }
  .vn-adv-apply { padding:10px 20px; border-radius:10px; background:#22c55e; border:none; color:#052010;
    font-size:12px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; cursor:pointer; font-family:inherit; }
  /* Featured */
  .vn-feat { position:relative; z-index:10; border-bottom:1px solid rgba(255,255,255,.06); }
  .vn-feat-inner { max-width:1360px; margin:0 auto; padding:64px 40px; }
  .vn-feat-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:32px; flex-wrap:wrap; }
  .vn-feat-title { font-size:22px; font-weight:800; color:#f2f2f2; letter-spacing:-.025em; margin:0 0 4px; }
  .vn-feat-sub { font-size:13px; color:#555; margin:0; }
  .vn-feat-tabs { display:flex; gap:6px; flex-wrap:wrap; }
  .vn-feat-tab { display:inline-flex; align-items:center; gap:7px; padding:8px 16px; border-radius:999px;
    background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08);
    font-size:12px; font-weight:700; color:#666; cursor:pointer; font-family:inherit; transition:all .15s; }
  .vn-feat-tab:hover { color:#e8e8e8; border-color:rgba(255,255,255,.15); }
  .vn-feat-tab.vn-feat-tab-active { background:rgba(34,197,94,.12); border-color:rgba(34,197,94,.3); color:#22c55e; }
  .vn-feat-tab svg { width:13px; height:13px; }
  /* Featured cards track */
  .vn-feat-track { display:flex; gap:16px; overflow-x:auto; padding-top:6px; padding-bottom:4px; scroll-snap-type:x mandatory; -ms-overflow-style:none; scrollbar-width:none; }
  .vn-feat-track::-webkit-scrollbar { display:none; }
  .vn-feat-card { flex:0 0 300px; scroll-snap-align:start; background:#0f0f0f; border:1px solid rgba(255,255,255,.07);
    border-radius:18px; overflow:hidden; text-decoration:none; color:inherit; position:relative; z-index:0;
    transition:border-color .2s,transform .2s,box-shadow .2s; display:flex; flex-direction:column; }
  .vn-feat-card:hover { border-color:rgba(34,197,94,.25); transform:translateY(-3px); box-shadow:0 12px 40px rgba(0,0,0,.5); z-index:2; }
  .vn-feat-card-img { position:relative; height:160px; background:#1a1a1a; flex-shrink:0; overflow:hidden; }
  .vn-feat-card-body { padding:14px 16px 16px; display:flex; flex-direction:column; gap:6px; flex:1; }
  .vn-feat-card-name { font-size:14px; font-weight:800; color:#f2f2f2; }
  .vn-feat-card-addr { font-size:11px; color:#555; display:flex; align-items:center; gap:4px; }
  .vn-feat-card-rating { display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:700; color:#22c55e; }
  .vn-feat-empty { padding:40px 20px; text-align:center; color:#444; font-size:13px; font-weight:600; }
  /* Map */
  .vn-map-sec { border-top:1px solid rgba(255,255,255,.06); }
  .vn-map-inner { max-width:1360px; margin:0 auto; padding:64px 40px; }
  .vn-map-head { margin-bottom:24px; }
  .vn-map-title { font-size:22px; font-weight:800; color:#f2f2f2; letter-spacing:-.025em; margin:0 0 4px; }
  .vn-map-sub { font-size:13px; color:#555; margin:0; }
  .vn-map-wrap { height:420px; border-radius:20px; overflow:hidden; border:1px solid rgba(255,255,255,.08);
    background:#111; position:relative; }
  .vn-map-loading { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    flex-direction:column; gap:12px; color:#555; font-size:13px; font-weight:600; }
  /* Body / grid */
  .vn-body { max-width:1360px; margin:0 auto; padding:48px 40px 80px; }
  .vn-results-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:28px; gap:12px; flex-wrap:wrap; }
  .vn-results-copy { min-width:240px; }
  .vn-results-section-title { font-size:22px; font-weight:800; color:#f2f2f2; letter-spacing:-.025em; margin:0 0 4px; }
  .vn-results-section-sub { font-size:13px; color:#555; margin:0; }
  .vn-results-title { font-size:13px; font-weight:700; color:#555; letter-spacing:.04em; }
  .vn-results-title b { color:#f2f2f2; }
  .vn-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:20px; }
  /* Club card */
  .vn-card { background:#0f0f0f; border:1px solid rgba(255,255,255,.07); border-radius:20px; overflow:hidden;
    transition:border-color .2s,transform .2s,box-shadow .2s; text-decoration:none; color:inherit; position:relative; z-index:0;
    display:flex; flex-direction:column; }
  .vn-card:hover { border-color:rgba(34,197,94,.25); transform:translateY(-3px); box-shadow:0 12px 40px rgba(0,0,0,.5); z-index:2; }
  .vn-card-img { position:relative; height:200px; background:#1a1a1a; overflow:hidden; flex-shrink:0; }
  .vn-card-img-placeholder { width:100%; height:100%; display:flex; align-items:center; justify-content:center;
    background:linear-gradient(135deg,#111 0%,#1a1a1a 50%,#0f0f0f 100%); }
  .vn-card-logo { position:absolute; bottom:12px; left:12px; width:44px; height:44px; border-radius:10px;
    background:#111; border:2px solid rgba(255,255,255,.12); overflow:hidden; display:flex; align-items:center; justify-content:center; }
  .vn-card-rating { position:absolute; top:12px; right:12px; display:inline-flex; align-items:center; gap:5px;
    padding:4px 10px; border-radius:999px; background:rgba(0,0,0,.7); backdrop-filter:blur(8px);
    border:1px solid rgba(255,255,255,.1); font-size:11px; font-weight:700; color:#f2f2f2; }
  .vn-card-rating svg { color:#22c55e; }
  .vn-card-body { padding:18px 20px 20px; flex:1; display:flex; flex-direction:column; gap:8px; }
  .vn-card-name { font-size:16px; font-weight:800; color:#f2f2f2; letter-spacing:-.01em; }
  .vn-card-addr { display:flex; align-items:center; gap:6px; font-size:12px; color:#555; font-weight:500; }
  .vn-card-addr svg { color:#444; flex-shrink:0; }
  .vn-card-desc { font-size:13px; color:#666; line-height:1.5;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .vn-card-footer { margin-top:auto; padding-top:14px; border-top:1px solid rgba(255,255,255,.05);
    display:flex; align-items:center; justify-content:flex-end; }
  .vn-card-cta { display:inline-flex; align-items:center; gap:6px; padding:8px 16px; border-radius:999px;
    background:#22c55e; color:#052010; font-size:11px; font-weight:800; letter-spacing:.06em;
    text-transform:uppercase; white-space:nowrap; flex-shrink:0; transition:background .15s; }
  .vn-card:hover .vn-card-cta { background:#16a34a; }
  /* Empty / skeleton */
  .vn-empty { grid-column:1/-1; padding:80px 0; text-align:center; display:flex; flex-direction:column; align-items:center; gap:14px; }
  .vn-empty-ico { color:rgba(34,197,94,.2); }
  .vn-empty-title { font-size:18px; font-weight:800; color:#f2f2f2; }
  .vn-empty-sub { font-size:14px; color:#555; }
  .vn-skeleton { animation:tc-pulse 1.5s ease-in-out infinite; }
  .vn-skel-card { background:#0f0f0f; border:1px solid rgba(255,255,255,.06); border-radius:20px; overflow:hidden; }
  .vn-skel-img { height:200px; background:rgba(255,255,255,.04); }
  .vn-skel-body { padding:18px 20px 20px; display:flex; flex-direction:column; gap:10px; }
  .vn-skel-line { height:12px; border-radius:6px; background:rgba(255,255,255,.05); }
  /* Responsive */
  @media(max-width:720px){
    .vn-hero-inner,.vn-feat-inner,.vn-map-inner,.vn-body { padding-left:20px; padding-right:20px; }
    .vn-hero-inner { padding-top:56px; padding-bottom:48px; }
    .vn-grid { grid-template-columns:1fr; }
    .vn-h1 { font-size:36px; }
    .vn-feat-inner,.vn-map-inner { padding-top:48px; padding-bottom:48px; }
    .vn-feat-head { flex-direction:column; }
  }
  .tc-root.tc-theme-light .vn-hero { border-bottom-color:rgba(15,23,42,.08); }
  .tc-root.tc-theme-light .vn-hero-bg { background:radial-gradient(ellipse 70% 60% at 60% 80%, rgba(34,197,94,.11) 0%, transparent 70%), radial-gradient(ellipse 50% 40% at 10% 20%, rgba(14,165,233,.08) 0%, transparent 60%); }
  .tc-root.tc-theme-light .vn-badge { background:rgba(34,197,94,.12); border-color:rgba(34,197,94,.28); color:#15803d; }
  .tc-root.tc-theme-light .vn-eyebrow { color:#64748b; }
  .tc-root.tc-theme-light .vn-h1,
  .tc-root.tc-theme-light .vn-feat-title,
  .tc-root.tc-theme-light .vn-map-title,
  .tc-root.tc-theme-light .vn-results-section-title,
  .tc-root.tc-theme-light .vn-card-name,
  .tc-root.tc-theme-light .vn-feat-card-name,
  .tc-root.tc-theme-light .vn-empty-title { color:#0f172a; }
  .tc-root.tc-theme-light .vn-sub,
  .tc-root.tc-theme-light .vn-card-desc,
  .tc-root.tc-theme-light .vn-empty-sub,
  .tc-root.tc-theme-light .vn-results-section-sub,
  .tc-root.tc-theme-light .vn-feat-sub,
  .tc-root.tc-theme-light .vn-map-sub { color:#475569; }
  .tc-root.tc-theme-light .vn-search { background:#ffffff; border-color:rgba(15,23,42,.14); box-shadow:0 12px 30px rgba(15,23,42,.1); }
  .tc-root.tc-theme-light .vn-search:focus-within { border-color:rgba(34,197,94,.45); }
  .tc-root.tc-theme-light .vn-search-ico { color:#94a3b8; }
  .tc-root.tc-theme-light .vn-search-input { color:#0f172a; }
  .tc-root.tc-theme-light .vn-search-input::placeholder { color:#94a3b8; }
  .tc-root.tc-theme-light .vn-search-clear { color:#64748b; }
  .tc-root.tc-theme-light .vn-chip,
  .tc-root.tc-theme-light .vn-adv-btn { background:#ffffff; border-color:rgba(15,23,42,.12); color:#334155; box-shadow:0 4px 12px rgba(15,23,42,.06); }
  .tc-root.tc-theme-light .vn-chip:hover,
  .tc-root.tc-theme-light .vn-adv-btn:hover { border-color:rgba(15,23,42,.2); color:#0f172a; }
  .tc-root.tc-theme-light .vn-chip.vn-active { background:rgba(34,197,94,.12); border-color:rgba(34,197,94,.28); color:#15803d; }
  .tc-root.tc-theme-light .vn-chip-caret { color:#64748b; }
  .tc-root.tc-theme-light .vn-chip-wrap:hover .vn-chip-caret { color:#334155; }
  .tc-root.tc-theme-light .vn-chip-wrap.vn-open .vn-chip-caret { color:#15803d; }
  .tc-root.tc-theme-light .vn-dropdown { background:#ffffff; border-color:rgba(15,23,42,.14); box-shadow:0 12px 28px rgba(15,23,42,.14); }
  .tc-root.tc-theme-light .vn-dropdown-head { color:#64748b; border-bottom-color:rgba(15,23,42,.08); }
  .tc-root.tc-theme-light .vn-dropdown-item { color:#1f2937; border-bottom-color:rgba(15,23,42,.06); }
  .tc-root.tc-theme-light .vn-dropdown-item:hover { background:rgba(15,23,42,.05); }
  .tc-root.tc-theme-light .vn-dropdown-item.vn-selected { color:#15803d; background:rgba(34,197,94,.12); }
  .tc-root.tc-theme-light .vn-dropdown-item-ico { color:#16a34a; }
  .tc-root.tc-theme-light .vn-chip-sep { background:rgba(15,23,42,.1); }
  .tc-root.tc-theme-light .vn-adv { background:#ffffff; border-color:rgba(15,23,42,.12); box-shadow:0 16px 34px rgba(15,23,42,.14); }
  .tc-root.tc-theme-light .vn-adv label { color:#64748b; }
  .tc-root.tc-theme-light .vn-adv input[type="number"] { background:#ffffff; border-color:rgba(15,23,42,.14); color:#0f172a; }
  .tc-root.tc-theme-light .vn-feat,
  .tc-root.tc-theme-light .vn-map-sec { border-color:rgba(15,23,42,.08); }
  .tc-user-foot { margin-top:0; }
  .tc-root.tc-theme-light .vn-feat-tab { background:#ffffff; border-color:rgba(15,23,42,.1); color:#475569; }
  .tc-root.tc-theme-light .vn-feat-tab:hover { color:#0f172a; border-color:rgba(15,23,42,.16); }
  .tc-root.tc-theme-light .vn-feat-tab.vn-feat-tab-active { background:rgba(34,197,94,.12); border-color:rgba(34,197,94,.28); color:#15803d; }
  .tc-root.tc-theme-light .vn-feat-card,
  .tc-root.tc-theme-light .vn-card,
  .tc-root.tc-theme-light .vn-map-wrap,
  .tc-root.tc-theme-light .vn-skel-card { background:#ffffff; border-color:rgba(15,23,42,.12); box-shadow:0 10px 24px rgba(15,23,42,.08); }
  .tc-root.tc-theme-light .vn-feat-card-addr,
  .tc-root.tc-theme-light .vn-card-addr,
  .tc-root.tc-theme-light .vn-results-title,
  .tc-root.tc-theme-light .vn-feat-empty,
  .tc-root.tc-theme-light .vn-map-loading { color:#64748b; }
  .tc-root.tc-theme-light .vn-card-addr svg { color:#94a3b8; }
  .tc-root.tc-theme-light .vn-results-title b { color:#0f172a; }
  .tc-root.tc-theme-light .vn-card-footer { border-top-color:rgba(15,23,42,.08); }
  .tc-root.tc-theme-light .vn-skel-img { background:rgba(15,23,42,.06); }
  .tc-root.tc-theme-light .vn-skel-line { background:rgba(15,23,42,.08); }
`;

const SPORTS = [
  { value: '', label: 'Todos los deportes' },
  { value: 'football', label: 'Fútbol' },
  { value: 'padel', label: 'Pádel' },
  { value: 'tennis', label: 'Tenis' },
  { value: 'basketball', label: 'Básquet' },
  { value: 'volleyball', label: 'Vóley' },
];
const SPORT_LABELS: Record<string, string> = { football:'Fútbol', padel:'Pádel', tennis:'Tenis', basketball:'Básquet', volleyball:'Vóley' };

type FeatTab = 'top' | 'disc' | 'rated';
type RatingMap = Record<number, { average: number; total: number }>;

function formatAddr(c: Club) {
  return [c.city, c.province].filter(Boolean).join(', ') || c.addressLine || '';
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
      <Star size={11} fill="#22c55e" />
      {rating.toFixed(1)} <span style={{ color: '#555', fontWeight: 500 }}>({total})</span>
    </div>
  );
}

function FeatCard({ club, rating }: { club: Club; rating?: { average: number; total: number } }) {
  return (
    <Link href={`/club/${club.slug}`} className="vn-feat-card">
      <div className="vn-feat-card-img">
        {club.clubImageUrl
          ? <Image src={club.clubImageUrl} alt={club.name} fill style={{ objectFit: 'cover' }} sizes="300px" />
          : <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg,#111,#1a1a1a)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(34,197,94,.15)" strokeWidth="1"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
            </div>
        }
        {rating && rating.total > 0 && (
          <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 999, background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,.1)', fontSize: 11, fontWeight: 700, color: '#f2f2f2' }}>
            <Star size={10} fill="#22c55e" color="#22c55e" />{rating.average.toFixed(1)}
          </div>
        )}
      </div>
      <div className="vn-feat-card-body">
        <div className="vn-feat-card-name">{club.name}</div>
        {formatAddr(club) && <div className="vn-feat-card-addr"><MapPin size={10} />{formatAddr(club)}</div>}
        {rating && rating.total > 0 && (
          <div className="vn-feat-card-rating"><Star size={11} fill="#22c55e" />{rating.average.toFixed(1)} <span style={{ color: '#555', fontWeight: 400 }}>· {rating.total} reseña{rating.total !== 1 ? 's' : ''}</span></div>
        )}
      </div>
    </Link>
  );
}

export default function ComplejosPage() {
  const router = useRouter();
  const { isLight } = useUserTheme();
  const searchRef = useRef<HTMLInputElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const mapTileLayerRef = useRef<any>(null);

  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratings, setRatings] = useState<RatingMap>({});
  const [search, setSearch] = useState('');
  const [zone, setZone] = useState('');
  const [sport, setSport] = useState('');
  const [showZoneDropdown, setShowZoneDropdown] = useState(false);
  const [showSportDropdown, setShowSportDropdown] = useState(false);
  const [showAdv, setShowAdv] = useState(false);
  const [featTab, setFeatTab] = useState<FeatTab>('top');
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [paramsRead, setParamsRead] = useState(false);

  // Read URL params once router is ready
  useEffect(() => {
    if (!router.isReady || paramsRead) return;
    if (router.query.q) setSearch(String(router.query.q));
    if (router.query.zone) setZone(String(router.query.zone));
    if (router.query.sport) setSport(String(router.query.sport));
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
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  // Load clubs + ratings
  useEffect(() => {
    ClubService.getAllClubs()
      .then(async (all) => {
        setClubs(all);
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

    // Custom green marker icon
    const markerIcon = (name: string) => L.divIcon({
      className: '',
      html: `<div style="width:32px;height:32px;border-radius:50% 50% 50% 0;background:#22c55e;border:2px solid #052010;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center">
        <div style="transform:rotate(45deg);font-size:14px">📍</div>
      </div>
      <div style="position:absolute;top:36px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#f2f2f2;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;white-space:nowrap;font-family:Sora,sans-serif;border:1px solid rgba(255,255,255,.1)">${name}</div>`,
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
      marker.bindPopup(`<div style="font-family:Sora,sans-serif;min-width:160px">
        <div style="font-weight:800;font-size:13px;margin-bottom:4px">${club.name}</div>
        <div style="font-size:11px;color:#888;margin-bottom:8px">${formatAddr(club)}</div>
        <a href="/club/${club.slug}" style="display:inline-block;padding:5px 12px;border-radius:8px;background:#22c55e;color:#052010;font-size:11px;font-weight:800;text-decoration:none">Ver cancha →</a>
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
    () => [...new Set(clubs.map(c => c.city).filter((c): c is string => Boolean(c)))].sort(),
    [clubs]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clubs.filter(c => {
      if (q && !`${c.name} ${c.city} ${c.province} ${c.addressLine} ${c.description || ''}`.toLowerCase().includes(q)) return false;
      if (zone && c.city !== zone) return false;
      return true;
    });
  }, [clubs, search, zone]);

  // Featured: top rated (min 1 review), rest show placeholder
  const topRated = useMemo(() =>
    [...clubs]
      .filter(c => (ratings[c.id]?.total || 0) > 0)
      .sort((a, b) => (ratings[b.id]?.average || 0) - (ratings[a.id]?.average || 0))
      .slice(0, 8),
    [clubs, ratings]
  );

  // "Más reservados": show clubs with images first as proxy (no booking count in API)
  const mostBooked = useMemo(() =>
    [...clubs].sort((a, b) => (b.clubImageUrl ? 1 : 0) - (a.clubImageUrl ? 1 : 0)).slice(0, 8),
    [clubs]
  );

  const hasFilters = search || zone || sport;
  const clearFilters = () => {
    setSearch('');
    setZone('');
    setSport('');
    setShowZoneDropdown(false);
    setShowSportDropdown(false);
  };

  return (
    <DarkPageLayout
      title="Complejos · TuCancha"
      extraCss={PAGE_CSS}
      breadcrumbs={[
        { label: 'Inicio', href: '/' },
        { label: 'Complejos' },
      ]}
    >

      {/* ── HERO ── */}
      <section className="vn-hero">
        <div className="vn-hero-bg" />
        <div className="vn-hero-inner">
          {!loading && (
            <div className="vn-badge">
              <span className="vn-badge-dot" />
              {clubs.length} {clubs.length === 1 ? 'complejo disponible' : 'complejos disponibles'}
            </div>
          )}
          <div className="vn-eyebrow">Explorar complejos</div>
          <h1 className="vn-h1">Encontrá <i>tu cancha</i></h1>
          <p className="vn-sub">Filtrá por zona y deporte. Reservá online en segundos, sin llamar.</p>

          <div className="vn-search">
            <span className="vn-search-ico"><Search size={16} /></span>
            <input ref={searchRef} className="vn-search-input" type="text" value={search}
              onChange={e => setSearch(e.target.value)} placeholder="Buscá por nombre, zona o descripción…" autoComplete="off" />
            {search && (
              <button className="vn-search-clear" onClick={() => { setSearch(''); searchRef.current?.focus(); }}>
                <X size={14} />
              </button>
            )}
          </div>

          <div ref={filtersRef} className="vn-filters">
            <div className={`vn-chip-wrap${showZoneDropdown ? ' vn-open' : ''}`} onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className={`vn-chip${zone ? ' vn-active' : ''}`}
                onClick={() => {
                  setShowSportDropdown(false);
                  setShowZoneDropdown((prev) => !prev);
                }}
              >
                <MapPin className="vn-chip-ico" />
                {zone || 'Zona'}
                <ChevronDown className="vn-chip-caret" />
              </button>
              {showZoneDropdown && (
                <div className="vn-dropdown">
                  <div className="vn-dropdown-head">Elegí zona</div>
                  <ul className="vn-dropdown-list">
                    <li>
                      <button
                        type="button"
                        className={`vn-dropdown-item${!zone ? ' vn-selected' : ''}`}
                        onClick={() => {
                          setZone('');
                          setShowZoneDropdown(false);
                        }}
                      >
                        <MapPin className="vn-dropdown-item-ico" />
                        Todas las zonas
                      </button>
                    </li>
                    {zones.map((z) => (
                      <li key={z}>
                        <button
                          type="button"
                          className={`vn-dropdown-item${zone === z ? ' vn-selected' : ''}`}
                          onClick={() => {
                            setZone(z);
                            setShowZoneDropdown(false);
                          }}
                        >
                          <MapPin className="vn-dropdown-item-ico" />
                          {z}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className={`vn-chip-wrap${showSportDropdown ? ' vn-open' : ''}`} onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className={`vn-chip${sport ? ' vn-active' : ''}`}
                onClick={() => {
                  setShowZoneDropdown(false);
                  setShowSportDropdown((prev) => !prev);
                }}
              >
                <svg className="vn-chip-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 2a15 15 0 0 1 0 20M2 12h20" /></svg>
                {sport ? SPORT_LABELS[sport] : 'Deporte'}
                <ChevronDown className="vn-chip-caret" />
              </button>
              {showSportDropdown && (
                <div className="vn-dropdown">
                  <div className="vn-dropdown-head">Elegí deporte</div>
                  <ul className="vn-dropdown-list">
                    {SPORTS.map((option) => (
                      <li key={option.value || 'all'}>
                        <button
                          type="button"
                          className={`vn-dropdown-item${sport === option.value ? ' vn-selected' : ''}`}
                          onClick={() => {
                            setSport(option.value);
                            setShowSportDropdown(false);
                          }}
                        >
                          <svg className="vn-dropdown-item-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 2a15 15 0 0 1 0 20M2 12h20" /></svg>
                          {option.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {hasFilters && (
              <>
                <div className="vn-chip-sep" />
                <button type="button" className="vn-chip" onClick={clearFilters}><X size={12} /> Limpiar</button>
              </>
            )}

            <div className="vn-chip-sep" />
            <button type="button" className="vn-adv-btn" onClick={() => setShowAdv(p => !p)}>
              <SlidersHorizontal size={13} /> Más filtros
            </button>
          </div>

          {showAdv && (
            <div className="vn-adv">
              <div>
                <label>Precio mínimo (ARS)</label>
                <input type="number" placeholder="Ej: 5.000" min="0" />
              </div>
              <div>
                <label>Precio máximo (ARS)</label>
                <input type="number" placeholder="Ej: 20.000" min="0" />
              </div>
              <button type="button" className="vn-adv-apply" onClick={() => setShowAdv(false)}>Aplicar</button>
            </div>
          )}
        </div>
      </section>

      {/* ── DESTACADOS ── */}
      {!loading && clubs.length > 0 && (
        <section className="vn-feat">
          <div className="vn-feat-inner">
            <div className="vn-feat-head">
              <div>
                <h2 className="vn-feat-title">Destacados</h2>
                <p className="vn-feat-sub">Los complejos con mejor actividad y valoraciones.</p>
              </div>
              <div className="vn-feat-tabs">
                <button type="button" className={`vn-feat-tab${featTab === 'top' ? ' vn-feat-tab-active' : ''}`} onClick={() => setFeatTab('top')}>
                  <Flame size={13} /> Más reservados
                </button>
                <button type="button" className={`vn-feat-tab${featTab === 'disc' ? ' vn-feat-tab-active' : ''}`} onClick={() => setFeatTab('disc')}>
                  <Tag size={13} /> Descuentos
                </button>
                <button type="button" className={`vn-feat-tab${featTab === 'rated' ? ' vn-feat-tab-active' : ''}`} onClick={() => setFeatTab('rated')}>
                  <Star size={13} /> Mejor valorados
                </button>
              </div>
            </div>

            {featTab === 'top' && (
              <div className="vn-feat-track">
                {mostBooked.length > 0
                  ? mostBooked.map(c => <FeatCard key={c.id} club={c} rating={ratings[c.id]} />)
                  : <div className="vn-feat-empty">Las reservas de la semana aparecerán acá</div>
                }
              </div>
            )}

            {featTab === 'disc' && (
              <div style={{ padding: '40px 0', textAlign: 'center', color: '#444' }}>
                <Tag size={32} style={{ marginBottom: 12, opacity: .4 }} />
                <div style={{ fontSize: 15, fontWeight: 800, color: '#555', marginBottom: 6 }}>Próximamente</div>
                <div style={{ fontSize: 13 }}>Los complejos con descuentos activos aparecerán acá.</div>
              </div>
            )}

            {featTab === 'rated' && (
              <div className="vn-feat-track">
                {topRated.length > 0
                  ? topRated.map(c => <FeatCard key={c.id} club={c} rating={ratings[c.id]} />)
                  : <div className="vn-feat-empty">Aún no hay reseñas suficientes para mostrar un ranking.</div>
                }
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── TODOS LOS COMPLEJOS ── */}
      <div className="vn-body">
        <div className="vn-results-head">
          <div className="vn-results-copy">
            <h2 className="vn-results-section-title">Todos los complejos</h2>
            <p className="vn-results-section-sub">Explorá la red completa de complejos disponibles.</p>
          </div>
          <p className="vn-results-title">
            {loading
              ? 'Cargando complejos…'
              : <><b>{filtered.length}</b> {filtered.length === 1 ? 'complejo' : 'complejos'}{hasFilters ? ' encontrados' : ' disponibles'}</>
            }
          </p>
        </div>

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
                  <div className="vn-card-img">
                    {club.clubImageUrl
                      ? <Image src={club.clubImageUrl} alt={club.name} fill style={{ objectFit: 'cover' }} sizes="(max-width:720px) 100vw, 380px" />
                      : <div className="vn-card-img-placeholder">
                          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(34,197,94,.12)" strokeWidth="1">
                            <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                          </svg>
                        </div>
                    }
                    {club.logoUrl && (
                      <div className="vn-card-logo">
                        <Image src={club.logoUrl} alt="" width={40} height={40} style={{ objectFit: 'contain' }} />
                      </div>
                    )}
                    {r && r.total > 0 && <RatingBadge rating={r.average} total={r.total} />}
                  </div>

                  <div className="vn-card-body">
                    <div className="vn-card-name">{club.name}</div>
                    {formatAddr(club) && (
                      <div className="vn-card-addr"><MapPin size={11} />{formatAddr(club)}</div>
                    )}
                    {club.description && <div className="vn-card-desc">{club.description}</div>}
                    <div className="vn-card-footer">
                      <span className="vn-card-cta">Ver cancha →</span>
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
            <h2 className="vn-map-title">Mapa de complejos</h2>
            <p className="vn-map-sub">Encontrá el complejo más cercano a vos.</p>
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
                  color: '#555',
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
