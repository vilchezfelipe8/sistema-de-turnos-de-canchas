import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Image from 'next/image';
import { Search, MapPin, Star, ChevronDown, X } from 'lucide-react';
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
  .p-public-root.p-public-theme-light .p-breadcrumbs-wrap { position:relative; z-index:45; padding-bottom:0; background:
    radial-gradient(ellipse 82% 66% at 72% 18%, rgba(182,243,106,.24) 0%, rgba(182,243,106,.08) 44%, transparent 74%),
    linear-gradient(180deg, #fbfff4 0%, rgba(245,244,240,.86) 100%); }
  .p-public-root.p-public-theme-light .p-breadcrumbs-cloud { background:rgba(255,255,255,.72); }
  .vn-explore-top { position:relative; border-bottom:1px solid var(--border-subtle); background:
    radial-gradient(ellipse 80% 64% at 72% 16%, rgba(182,243,106,.12) 0%, transparent 72%),
    linear-gradient(180deg, rgba(182,243,106,.05) 0%, transparent 100%);
  }
  .vn-explore-inner { max-width:1360px; margin:0 auto; padding:12px 40px 28px; }
  .vn-head-row { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; flex-wrap:wrap; margin-bottom:18px; }
  .vn-head-copy { max-width:640px; }
  .vn-h1 { font-size:clamp(28px,4vw,42px); font-weight:800; letter-spacing:-.04em; line-height:1.05; color:var(--text-primary); margin:0 0 10px; }
  .vn-sub { font-size:14px; color:var(--text-muted); font-weight:400; margin:0; line-height:1.6; }
  .vn-toolbar-slot { position:relative; }
  .vn-toolbar { display:flex; flex-direction:column; gap:14px; padding:16px 18px; border-radius:24px;
    background:color-mix(in srgb, var(--surface-1) 88%, transparent); border:1px solid var(--border);
    box-shadow:var(--shadow-md); backdrop-filter:blur(14px); box-sizing:border-box;
    transition: top .28s ease-out, left .28s ease-out, width .28s ease-out, transform .28s ease-out, opacity .22s ease-out, background-color .26s ease, border-color .26s ease;
    will-change:top, transform, opacity; }
  .vn-toolbar.v-stuck { }
  .vn-toolbar.v-floating { position:fixed; top:var(--vn-toolbar-top, 76px); left:var(--vn-toolbar-left, 40px); width:var(--vn-toolbar-width, calc(100vw - 80px)); z-index:70; opacity:1; transform:translate3d(0,0,0) scale(1); }
  .vn-toolbar.v-floating.v-stuck { transform:translate3d(0,0,0) scale(1); opacity:1; }
  .vn-toolbar.v-floating.v-leaving { opacity:.97; transform:translate3d(0,0,0) scale(1); }
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
  .vn-toolbar-row { display:flex; align-items:center; gap:12px; flex-wrap:wrap; justify-content:space-between; }
  .vn-results-inline { display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
  .vn-results-inline-text { font-size:13px; font-weight:700; color:var(--text-muted); letter-spacing:.03em; }
  .vn-results-inline-text b { color:var(--text-primary); }
  .vn-active-filters { display:flex; gap:8px; flex-wrap:wrap; }
  .vn-active-pill { display:inline-flex; align-items:center; gap:6px; padding:7px 12px; border-radius:999px; background:var(--positive-bg); border:1px solid var(--accent-border-subtle); font-size:11px; font-weight:700; color:var(--accent-fg); }
  .vn-chip-wrap { position:relative; }
  .vn-dropdown { position:absolute; top:calc(100% + 8px); left:0; min-width:260px; background:var(--surface-1); border:1px solid var(--border); border-radius:12px; overflow:hidden; box-shadow:var(--shadow-lg); z-index:120; }
  .vn-dropdown-head { padding:10px 16px; border-bottom:1px solid var(--border); font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.14em; color:var(--text-muted); }
  .vn-dropdown-list { max-height:220px; overflow-y:auto; margin:0; padding:0; list-style:none; }
  .vn-dropdown-item { width:100%; display:flex; align-items:center; gap:10px; padding:11px 16px; background:transparent; border:0; border-bottom:1px solid var(--border-subtle); cursor:pointer; font-family:inherit; font-size:13px; color:var(--text-secondary); font-weight:500; text-align:left; transition:background .15s, color .15s; }
  .vn-dropdown-item:last-child { border-bottom:none; }
  .vn-dropdown-item:hover { background:var(--surface-2); }
  .vn-dropdown-item.vn-selected { background:var(--positive-bg); color:var(--accent-fg); }
  .vn-dropdown-item-ico { width:13px; height:13px; color:var(--accent-fg); flex-shrink:0; }
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
  .vn-body { max-width:1360px; margin:0 auto; padding:28px 40px 80px; }
  .vn-results-head { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:28px; gap:12px; flex-wrap:wrap; }
  .vn-results-copy { min-width:240px; }
  .vn-results-section-title { font-size:22px; font-weight:800; color:var(--text-primary); letter-spacing:-.025em; margin:0 0 4px; }
  .vn-results-section-sub { font-size:13px; color:var(--text-muted); margin:0; }
  .vn-results-title { font-size:13px; font-weight:700; color:var(--text-muted); letter-spacing:.04em; }
  .vn-results-title b { color:var(--text-primary); }
  .vn-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:20px; }
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
  .vn-card-desc { font-size:13px; color:var(--text-muted); line-height:1.5;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .vn-card-footer { margin-top:auto; padding-top:14px; border-top:1px solid var(--border-subtle);
    display:flex; align-items:center; justify-content:flex-end; }
  .vn-card-cta { display:inline-flex; align-items:center; gap:6px; padding:8px 16px; border-radius:999px;
    background:var(--brand); color:var(--brand-on); font-size:11px; font-weight:800; letter-spacing:.06em;
    text-transform:uppercase; white-space:nowrap; flex-shrink:0; transition:background .15s; }
  .vn-card:hover .vn-card-cta { background:var(--accent-fg); }
  /* Empty / skeleton */
  .vn-empty { grid-column:1/-1; padding:80px 0; text-align:center; display:flex; flex-direction:column; align-items:center; gap:14px; }
  .vn-empty-ico { color:var(--accent-border-subtle); }
  .vn-empty-title { font-size:18px; font-weight:800; color:var(--text-primary); }
  .vn-empty-sub { font-size:14px; color:var(--text-muted); }
  .vn-skeleton { animation:p-public-pulse 1.5s ease-in-out infinite; }
  .vn-skel-card { background:var(--surface-1); border:1px solid var(--border-subtle); border-radius:20px; overflow:hidden; }
  .vn-skel-img { height:200px; background:var(--surface-2); }
  .vn-skel-body { padding:18px 20px 20px; display:flex; flex-direction:column; gap:10px; }
  .vn-skel-line { height:12px; border-radius:6px; background:var(--surface-2); }
  /* Responsive */
  @media(max-width:720px){
    .vn-explore-inner,.vn-map-inner,.vn-body { padding-left:20px; padding-right:20px; }
    .vn-explore-inner { padding-top:18px; padding-bottom:20px; }
    .vn-grid { grid-template-columns:1fr; }
    .vn-h1 { font-size:30px; }
    .vn-toolbar { padding:14px; border-radius:20px; }
    /* Mantener mismo padding/borde cuando está stuck para evitar reflow */
    .vn-toolbar.v-stuck { padding:14px; border-radius:20px; }
    .vn-toolbar.v-floating { top:var(--vn-toolbar-top, 72px); left:var(--vn-toolbar-left, 20px); width:var(--vn-toolbar-width, calc(100vw - 40px)); }
    .vn-toolbar-search { border-radius:24px; padding:8px; gap:8px; }
    .vn-toolbar-divider { display:none; }
    .vn-toolbar-zone { order:1; flex:1 1 0; min-width:0; }
    .vn-toolbar-sport { order:2; flex:1 1 0; min-width:0; }
    .vn-toolbar-input-wrap { order:3; flex:1 0 100%; min-width:0; }
    .vn-search-input { width:100%; min-width:0; padding:12px 0; }
    .vn-toolbar-clear { order:4; width:auto; justify-content:center; padding:9px 14px; }
    .vn-dropdown { width:100%; min-width:0; max-width:100%; }
    .vn-toolbar-row { align-items:stretch; }
    .vn-results-inline { justify-content:flex-start; }
    .vn-map-inner { padding-top:48px; padding-bottom:48px; }
    /* Evitar solapamientos en móvil: dar proporciones 60/40 para zona/deporte */
    .vn-toolbar-zone { order:1; flex:0 0 60%; max-width:60%; min-width:0; }
    .vn-toolbar-sport { order:2; flex:0 0 40%; max-width:40%; min-width:0; }
    .vn-toolbar-zone .vn-toolbar-seg,
    .vn-toolbar-sport .vn-toolbar-seg { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
    .vn-toolbar-zone .vn-toolbar-seg span,
    .vn-toolbar-sport .vn-toolbar-seg span { display:inline-block; max-width:calc(100% - 28px); overflow:hidden; text-overflow:ellipsis; vertical-align:middle; }
    .vn-chip-wrap { min-width:0; }
    /* Ajustes de padding para alinear selects y texto de búsqueda */
    .vn-toolbar-search { padding:8px 12px; }
    .vn-toolbar-seg { padding:8px 12px; }
    /* Ajuste de paddings para equalizar espacio entre iconos e inputs */
    .vn-search-ico { padding:0 8px 0 12px; display:flex; align-items:center; }
    .vn-search-input { padding:8px 0; }
    /* Asegurar tamaños consistentes de iconos */
    .vn-search-ico svg { width:14px; height:14px; display:block; }
    .vn-toolbar-seg svg { width:14px; height:14px; display:block; flex-shrink:0; }
  }
  .p-public-root.p-public-theme-light .vn-explore-top { border-bottom-color:rgba(106,176,48,.18); background:
    radial-gradient(ellipse 82% 66% at 72% 18%, rgba(182,243,106,.24) 0%, rgba(182,243,106,.08) 44%, transparent 74%),
    linear-gradient(180deg, #fbfff4 0%, rgba(245,244,240,.86) 100%); }
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
  .p-public-root.p-public-theme-light .vn-dropdown-head { color:var(--text-muted); border-bottom-color:var(--border-subtle); }
  .p-public-root.p-public-theme-light .vn-dropdown-item { color:var(--text-primary); border-bottom-color:var(--surface-2); }
  .p-public-root.p-public-theme-light .vn-dropdown-item:hover { background:var(--surface-2); }
  .p-public-root.p-public-theme-light .vn-dropdown-item.vn-selected { color:var(--accent-fg); background:var(--positive-bg); }
  .p-public-root.p-public-theme-light .vn-dropdown-item-ico { color:var(--accent-fg); }
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
  const [search, setSearch] = useState('');
  const [zone, setZone] = useState('');
  const [sport, setSport] = useState('');
  const [showZoneDropdown, setShowZoneDropdown] = useState(false);
  const [showSportDropdown, setShowSportDropdown] = useState(false);
  const [toolbarStuck, setToolbarStuck] = useState(false);
  const [toolbarFloating, setToolbarFloating] = useState(false);
  const [toolbarLeaving, setToolbarLeaving] = useState(false);
  const [navHidden, setNavHidden] = useState(false);
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

  useEffect(() => {
    if (typeof window === 'undefined' || !toolbarSentinelRef.current) return;
    const toolbarTopOffset = navHidden ? 18 : 76;
    const observer = new IntersectionObserver(
      ([entry]) => setToolbarStuck(!entry.isIntersecting),
      {
        root: null,
        threshold: 0,
        rootMargin: `-${toolbarTopOffset}px 0px 0px 0px`
      }
    );
    observer.observe(toolbarSentinelRef.current);
    return () => observer.disconnect();
  }, [navHidden]);

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
        height: toolbarRect?.height || prev.height
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

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let lastY = window.scrollY;
    const threshold = 4;

    const updateNavState = () => {
      const currentY = window.scrollY;
      const delta = Math.abs(currentY - lastY);

      if (currentY < 80) {
        setNavHidden(false);
        lastY = currentY;
        return;
      }

      if (delta < threshold) return;

      setNavHidden(currentY > lastY);
      lastY = currentY;
    };

    updateNavState();
    window.addEventListener('scroll', updateNavState, { passive: true });
    return () => window.removeEventListener('scroll', updateNavState);
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
        <a href="/club/${club.slug}" style="display:inline-block;padding:5px 12px;border-radius:8px;background:var(--brand);color:var(--brand-on);font-size:11px;font-weight:800;text-decoration:none">Ver cancha →</a>
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
      if (sport && !(Array.isArray(c.publicSports) && c.publicSports.includes(sport))) return false;
      return true;
    });
  }, [clubs, search, zone, sport]);

  const hasFilters = search || zone || sport;
  const activeFilterParts = [
    zone ? zone : null,
    sport ? SPORT_LABELS[sport] || sport : null,
    search ? `“${search.trim()}”` : null,
  ].filter(Boolean) as string[];
  const heroTitle = 'Complejos';
  const heroSub = hasFilters
    ? activeFilterParts.length === 1
      ? `Resultados para ${activeFilterParts[0]}.`
      : activeFilterParts.length > 1
        ? `Resultados para ${activeFilterParts.slice(0, -1).join(' · ')} y ${activeFilterParts[activeFilterParts.length - 1]}.`
        : 'Mostrando resultados según tus filtros.'
    : 'Encontrá dónde jugar y filtrá por zona, deporte o nombre.';
  const resultsTitle = hasFilters ? 'Resultados' : 'Todos los complejos';
  const resultsSub = hasFilters
    ? 'Elegí un complejo para seguir con la reserva.'
    : 'Explorá la red completa de complejos disponibles.';
  const mapTitle = 'Mapa de complejos';
  const mapSub = hasFilters
    ? 'Ubicación de los complejos que coinciden con tus filtros.'
    : 'Encontrá el complejo más cercano a vos.';
  const clearFilters = () => {
    setSearch('');
    setZone('');
    setSport('');
    setShowZoneDropdown(false);
    setShowSportDropdown(false);
  };

  return (
    <DarkPageLayout
      title="Complejos · Pique"
      extraCss={PAGE_CSS}
    >

      <section className="vn-explore-top">
        <div className="vn-explore-inner">
          <nav className="p-breadcrumbs" aria-label="Breadcrumb" style={{ marginBottom: 18 }}>
            <div className="p-breadcrumbs-cloud">
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Link href="/" className="p-breadcrumb-link">Inicio</Link>
                <span className="p-breadcrumb-sep">/</span>
              </div>
              <span className="p-breadcrumb-current">Complejos</span>
            </div>
          </nav>

          <div className="vn-head-row">
            <div className="vn-head-copy">
              <h1 className="vn-h1">{heroTitle}</h1>
              <p className="vn-sub">{heroSub}</p>
            </div>
          </div>

          <div ref={toolbarSentinelRef} aria-hidden="true" style={{ height: 1 }} />
          <div
            ref={toolbarSlotRef}
            className="vn-toolbar-slot"
            style={{ minHeight: (toolbarFloating || toolbarLeaving) && toolbarFrame.height ? toolbarFrame.height : undefined }}
          >
          {(() => {
            const leaving = toolbarLeaving;
            const toolbarTop = (toolbarFloating || toolbarLeaving)
              ? `${navHidden ? 18 : 76}px`
              : undefined;
            return (
          <div
            className={`vn-toolbar${(toolbarFloating || toolbarLeaving) ? ' v-floating' : ''}${toolbarStuck ? ' v-stuck' : leaving ? ' v-leaving' : ''}`}
            ref={filtersRef}
            style={
              (toolbarFloating || toolbarLeaving)
                ? ({
                    ['--vn-toolbar-top' as any]: toolbarTop,
                    ['--vn-toolbar-left' as any]: `${toolbarFrame.left}px`,
                    ['--vn-toolbar-width' as any]: `${toolbarFrame.width}px`
                  } as React.CSSProperties)
                : undefined
            }
          >
            <div className="vn-toolbar-search">
              <div className={`vn-chip-wrap vn-toolbar-zone${showZoneDropdown ? ' vn-open' : ''}`} onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="vn-toolbar-seg"
                  onClick={() => {
                    setShowSportDropdown(false);
                    setShowZoneDropdown((prev) => !prev);
                  }}
                >
                  <MapPin size={13} style={{ color: 'var(--text-muted)' }} />
                  <span>{zone || 'Zona'}</span>
                  <ChevronDown className="vn-toolbar-caret" />
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

              <div className="vn-toolbar-divider" />

              <div className={`vn-chip-wrap vn-toolbar-sport${showSportDropdown ? ' vn-open' : ''}`} onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="vn-toolbar-seg"
                  onClick={() => {
                    setShowZoneDropdown(false);
                    setShowSportDropdown((prev) => !prev);
                  }}
                >
                  <svg style={{ color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 2a15 15 0 0 1 0 20M2 12h20" /></svg>
                  <span>{sport ? SPORT_LABELS[sport] : 'Deporte'}</span>
                  <ChevronDown className="vn-toolbar-caret" />
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

              <div className="vn-toolbar-divider" />

              <div className="vn-toolbar-input-wrap">
                <span className="vn-search-ico"><Search size={16} /></span>
                <input ref={searchRef} className="vn-search-input" type="text" value={search}
                  onChange={e => setSearch(e.target.value)} placeholder="Buscá por nombre, zona o descripción…" autoComplete="off" />
                {search && (
                  <button className="vn-search-clear" onClick={() => { setSearch(''); searchRef.current?.focus(); }}>
                    <X size={14} />
                  </button>
                )}
              </div>

              {hasFilters && (
                <button type="button" className="vn-toolbar-clear" onClick={clearFilters}>
                  <X size={13} />
                  Limpiar
                </button>
              )}
            </div>

            <div className="vn-toolbar-row">
              {hasFilters && activeFilterParts.length > 0 ? (
                <div className="vn-active-filters" aria-label="Filtros activos">
                  {activeFilterParts.map((part) => (
                    <span key={part} className="vn-active-pill">{part}</span>
                  ))}
                </div>
              ) : <div />}

              <div className="vn-results-inline">
                <span className="vn-results-inline-text">
                  {loading
                    ? 'Cargando complejos…'
                    : <><b>{filtered.length}</b> {filtered.length === 1 ? 'complejo' : 'complejos'} {hasFilters ? 'encontrados' : 'disponibles'}</>
                  }
                </span>
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
        <div className="vn-results-head">
          <div className="vn-results-copy">
            <h2 className="vn-results-section-title">{resultsTitle}</h2>
            <p className="vn-results-section-sub">{resultsSub}</p>
          </div>
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
                          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--positive-bg)" strokeWidth="1">
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
