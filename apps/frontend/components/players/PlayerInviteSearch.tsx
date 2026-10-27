import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AtSign, Loader2, Search, UserPlus, X } from 'lucide-react';
import {
  getFrequentPlayers,
  lookupPlayerForInvitation,
  searchPlayersForInvitation,
  type PlayerInviteCandidate,
  type PlayerLookupResult,
} from '../../services/BookingService';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';
import { isAuthSessionInvalidatedError } from '../../utils/apiClient';

// Jugador elegido para invitar:
// - 'token': encontrado por nombre o en "Jugaron con vos" (se invita con el token firmado del servidor).
// - 'dni' / 'email': búsqueda exacta, igual que antes.
export type PickedInvitePlayer =
  | { kind: 'token'; ref: string; inviteToken: string; displayName: string }
  | { kind: 'dni' | 'email'; value: string; displayName: string | null; lookupStatus: 'FOUND' | 'EMAIL_WITHOUT_ACCOUNT' };

type PlayerInviteSearchProps = {
  /** Club de la reserva: por slug (checkout) o por la reserva ya creada (Mis reservas). */
  clubSlug?: string | null;
  bookingId?: number | string | null;
  clubLabel?: string | null;
  ownerEmail?: string | null;
  /** Referencias ya agregadas (búsqueda por nombre) y DNI/emails ya agregados. */
  excludedRefs?: string[];
  excludedIdentifiers?: string[];
  busy?: boolean;
  autoFocus?: boolean;
  onPick: (player: PickedInvitePlayer) => void | Promise<void>;
};

type Mode =
  | { kind: 'empty' }
  | { kind: 'name'; query: string; letters: number }
  | { kind: 'dni'; value: string }
  | { kind: 'email'; value: string }
  | { kind: 'invalid'; message: string };

const MIN_NAME_LETTERS = 3;
const NAME_DEBOUNCE_MS = 300;
const EXACT_DEBOUNCE_MS = 450;

const PIS_CSS = `
  .pis { display:grid; gap:10px; }
  .pis-field { position:relative; }
  .pis-field-icon { position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--text-muted); pointer-events:none; display:inline-flex; }
  .pis-input { width:100%; height:44px; border-radius:13px; border:1px solid var(--border); background:var(--surface-1); color:var(--text-primary); padding:0 38px 0 36px; font-family:var(--font-sans); font-size:13px; font-weight:650; outline:none; box-sizing:border-box; }
  .pis-input:focus { border-color:var(--accent-border-strong); box-shadow:0 0 0 3px var(--accent-bg-soft); }
  .pis-clear { position:absolute; right:6px; top:50%; transform:translateY(-50%); width:30px; height:30px; border:0; border-radius:999px; background:transparent; color:var(--text-muted); display:inline-flex; align-items:center; justify-content:center; cursor:pointer; }
  .pis-label { margin:2px 0 0; color:var(--text-muted); font-size:10px; font-weight:900; letter-spacing:.04em; text-transform:uppercase; }
  .pis-rows { display:grid; gap:2px; padding:4px; border-radius:13px; background:var(--surface-1); }
  .pis-row { display:flex; align-items:center; gap:10px; padding:8px; border-radius:11px; }
  .pis-row-first { background:var(--accent-bg-soft); }
  .pis-avatar { width:32px; height:32px; border-radius:999px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; background:var(--surface-3); color:var(--text-primary); font-size:11px; font-weight:900; }
  .pis-info { min-width:0; flex:1; }
  .pis-name { margin:0; color:var(--text-primary); font-size:13px; font-weight:850; overflow-wrap:anywhere; }
  .pis-name mark { background:none; color:var(--accent-fg); }
  .pis-copy { margin:1px 0 0; color:var(--text-muted); font-size:11px; line-height:1.4; font-weight:650; }
  .pis-action { height:34px; flex-shrink:0; border-radius:11px; border:1px solid var(--brand); background:var(--brand); color:var(--brand-on); padding:0 12px; display:inline-flex; align-items:center; gap:5px; font-family:var(--font-sans); font-size:12px; font-weight:900; cursor:pointer; }
  .pis-action:hover { background:var(--brand-hover); border-color:var(--brand-hover); }
  .pis-action:disabled { opacity:.6; cursor:not-allowed; }
  .pis-hint { margin:0; display:flex; align-items:center; gap:6px; color:var(--text-muted); font-size:11px; line-height:1.4; font-weight:650; }
  .pis-warn { padding:11px 12px; border-radius:13px; background:var(--warn-bg); }
  .pis-warn-title { margin:0; color:var(--warn-fg); font-size:12px; font-weight:850; }
  .pis-error { margin:0; color:var(--error-fg); font-size:11px; font-weight:700; }
  @keyframes pis-spin { to { transform:rotate(360deg); } }
  .pis-spin { animation:pis-spin .8s linear infinite; }
`;

const normalizeText = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const resolveMode = (raw: string): Mode => {
  const value = String(raw || '').trim();
  if (!value) return { kind: 'empty' };
  if (value.includes('@')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { kind: 'invalid', message: 'Terminá de escribir el email.' };
    return { kind: 'email', value: value.toLowerCase() };
  }
  const letters = value.replace(/[^\p{L}]/gu, '').length;
  if (letters === 0) {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 6) return { kind: 'invalid', message: 'Seguí escribiendo el DNI.' };
    if (digits.length > 9) return { kind: 'invalid', message: 'Ingresá un DNI válido.' };
    return { kind: 'dni', value: digits };
  }
  return { kind: 'name', query: value, letters };
};

// Resalta en el nombre las palabras buscadas (sin distinguir acentos ni mayúsculas).
const highlight = (name: string, query: string): ReactNode => {
  const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return name;
  const normalized = normalizeText(name);
  const marks = new Array(name.length).fill(false);
  tokens.forEach((token) => {
    let from = 0;
    while (from <= normalized.length) {
      const index = normalized.indexOf(token, from);
      if (index < 0) break;
      for (let i = index; i < index + token.length && i < marks.length; i += 1) marks[i] = true;
      from = index + token.length;
    }
  });
  const parts: ReactNode[] = [];
  let current = '';
  let currentMarked = marks[0];
  for (let i = 0; i < name.length; i += 1) {
    if (marks[i] !== currentMarked) {
      parts.push(currentMarked ? <mark key={`m-${i}`}>{current}</mark> : current);
      current = '';
      currentMarked = marks[i];
    }
    current += name[i];
  }
  if (current) parts.push(currentMarked ? <mark key="m-end">{current}</mark> : current);
  return parts;
};

const playedWithLabel = (count: number) =>
  count > 0 ? `Jugaron juntos ${count} ${count === 1 ? 'vez' : 'veces'}` : 'Juega en este club';

export default function PlayerInviteSearch({
  clubSlug,
  bookingId,
  clubLabel,
  ownerEmail,
  excludedRefs = [],
  excludedIdentifiers = [],
  busy = false,
  autoFocus = true,
  onPick,
}: PlayerInviteSearchProps) {
  const [query, setQuery] = useState('');
  const [frequent, setFrequent] = useState<PlayerInviteCandidate[]>([]);
  const [nameResults, setNameResults] = useState<{ query: string; items: PlayerInviteCandidate[] } | null>(null);
  const [exact, setExact] = useState<{ key: string; result: PlayerLookupResult } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestSeqRef = useRef(0);

  const mode = useMemo(() => resolveMode(query), [query]);
  const excludedRefSet = useMemo(() => new Set(excludedRefs), [excludedRefs]);
  const excludedIdentifierSet = useMemo(
    () => new Set(excludedIdentifiers.map((value) => (value.includes('@') ? value.trim().toLowerCase() : value.replace(/\D/g, '')))),
    [excludedIdentifiers]
  );

  useEffect(() => {
    let cancelled = false;
    getFrequentPlayers()
      .then((items) => {
        if (!cancelled) setFrequent(items);
      })
      .catch((loadError) => {
        if (!isAuthSessionInvalidatedError(loadError)) {
          reportUiError({ area: 'PlayerInviteSearch', action: 'loadFrequent' }, loadError);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Búsqueda en vivo: por nombre (en el club) o exacta por DNI/email (en todo Pique).
  useEffect(() => {
    setError('');
    if (mode.kind === 'name' && mode.letters >= MIN_NAME_LETTERS) {
      const seq = ++requestSeqRef.current;
      setLoading(true);
      const timer = window.setTimeout(async () => {
        try {
          const items = await searchPlayersForInvitation({ q: mode.query, clubSlug, bookingId });
          if (seq !== requestSeqRef.current) return;
          setNameResults({ query: mode.query, items });
        } catch (searchError) {
          if (seq !== requestSeqRef.current) return;
          reportUiError({ area: 'PlayerInviteSearch', action: 'searchByName' }, searchError);
          setError(extractErrorMessage(searchError, 'No pudimos buscar jugadores. Intentá de nuevo.'));
        } finally {
          if (seq === requestSeqRef.current) setLoading(false);
        }
      }, NAME_DEBOUNCE_MS);
      return () => window.clearTimeout(timer);
    }
    if (mode.kind === 'dni' || mode.kind === 'email') {
      const key = `${mode.kind}:${mode.value}`;
      if (exact?.key === key) {
        requestSeqRef.current += 1;
        setLoading(false);
        return;
      }
      const seq = ++requestSeqRef.current;
      setLoading(true);
      const timer = window.setTimeout(async () => {
        try {
          const result = await lookupPlayerForInvitation(mode.kind === 'dni' ? { dni: mode.value } : { email: mode.value });
          if (seq !== requestSeqRef.current) return;
          setExact({ key, result });
        } catch (lookupError) {
          if (seq !== requestSeqRef.current) return;
          reportUiError({ area: 'PlayerInviteSearch', action: 'lookupExact' }, lookupError);
          setError(extractErrorMessage(lookupError, 'No pudimos buscar al jugador. Intentá de nuevo.'));
        } finally {
          if (seq === requestSeqRef.current) setLoading(false);
        }
      }, EXACT_DEBOUNCE_MS);
      return () => window.clearTimeout(timer);
    }
    requestSeqRef.current += 1;
    setLoading(false);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, clubSlug, bookingId]);

  const pick = useCallback(
    (player: PickedInvitePlayer) => {
      if (busy) return;
      void onPick(player);
    },
    [busy, onPick]
  );

  const visibleFrequent = frequent.filter((item) => !excludedRefSet.has(item.ref));
  // Mientras se escribe se mantienen los últimos resultados hasta que llegan los nuevos.
  const visibleNameResults =
    nameResults && mode.kind === 'name' ? nameResults.items.filter((item) => !excludedRefSet.has(item.ref)) : null;
  const nameResultsAreFresh = Boolean(nameResults && mode.kind === 'name' && nameResults.query === mode.query);
  const exactKey = mode.kind === 'dni' || mode.kind === 'email' ? `${mode.kind}:${mode.value}` : '';
  const exactResult = exact && exact.key === exactKey ? exact.result : null;
  const exactAlreadyAdded =
    (mode.kind === 'dni' || mode.kind === 'email') && excludedIdentifierSet.has(mode.value);
  const isOwnerEmail = mode.kind === 'email' && Boolean(ownerEmail) && mode.value === String(ownerEmail).trim().toLowerCase();

  const renderCandidate = (item: PlayerInviteCandidate, index: number, withHighlight: string | null) => (
    <div key={item.ref} className={`pis-row${index === 0 && withHighlight ? ' pis-row-first' : ''}`}>
      <span className="pis-avatar">{item.initials}</span>
      <div className="pis-info">
        <p className="pis-name">{withHighlight ? highlight(item.displayName, withHighlight) : item.displayName}</p>
        <p className="pis-copy">{playedWithLabel(item.playedWithCount)}</p>
      </div>
      <button
        type="button"
        className="pis-action"
        disabled={busy}
        onClick={() => pick({ kind: 'token', ref: item.ref, inviteToken: item.inviteToken, displayName: item.displayName })}
      >
        <UserPlus size={14} /> Invitar
      </button>
    </div>
  );

  let body: ReactNode = null;
  if (error) {
    body = <p className="pis-error" role="alert">{error}</p>;
  } else if (mode.kind === 'empty') {
    body = visibleFrequent.length > 0 ? (
      <>
        <p className="pis-label">Jugaron con vos</p>
        <div className="pis-rows">{visibleFrequent.map((item, index) => renderCandidate(item, index, null))}</div>
        <p className="pis-hint">Escribí al menos 3 letras del nombre para buscar en el club, o su DNI o email.</p>
      </>
    ) : (
      <p className="pis-hint">Escribí el nombre (mínimo 3 letras), el DNI o el email de tu compañero.</p>
    );
  } else if (mode.kind === 'invalid') {
    body = <p className="pis-hint">{mode.message}</p>;
  } else if (mode.kind === 'name' && mode.letters < MIN_NAME_LETTERS) {
    body = <p className="pis-hint">Seguí escribiendo: buscamos desde 3 letras.</p>;
  } else if (loading && !(mode.kind === 'name' && visibleNameResults && visibleNameResults.length > 0)) {
    body = (
      <p className="pis-hint">
        <Loader2 size={13} className="pis-spin" /> Buscando…
      </p>
    );
  } else if (mode.kind === 'name' && visibleNameResults && (visibleNameResults.length > 0 || nameResultsAreFresh)) {
    body = visibleNameResults.length > 0 ? (
      <>
        <p className="pis-label">
          {clubLabel ? `En ${clubLabel}` : 'En este club'} · {visibleNameResults.length}{' '}
          {visibleNameResults.length === 1 ? 'resultado' : 'resultados'}
        </p>
        <div className="pis-rows">{visibleNameResults.map((item, index) => renderCandidate(item, index, mode.query))}</div>
        <p className="pis-hint">¿No aparece? Buscalo por su DNI o email.</p>
      </>
    ) : (
      <div className="pis-warn">
        <p className="pis-warn-title">No encontramos a «{mode.query}» en el club</p>
        <p className="pis-copy">
          Por nombre buscamos solo entre quienes juegan en el club. Si es nuevo, buscalo por su DNI o email: si no tiene
          cuenta, la invitación lo espera cuando se registre.
        </p>
      </div>
    );
  } else if ((mode.kind === 'dni' || mode.kind === 'email') && exactResult) {
    if (exactAlreadyAdded) {
      body = <p className="pis-error" role="alert">Ese jugador ya está agregado.</p>;
    } else if (exactResult.status === 'SELF' || isOwnerEmail) {
      body = <p className="pis-error" role="alert">Vos ya sos el titular de la reserva.</p>;
    } else if (exactResult.status === 'FOUND') {
      body = (
        <div className="pis-rows">
          <div className="pis-row pis-row-first">
            <span className="pis-avatar">
              {String(exactResult.displayName || '?')
                .split(/\s+/)
                .slice(0, 2)
                .map((chunk) => chunk.charAt(0).toUpperCase())
                .join('')}
            </span>
            <div className="pis-info">
              <p className="pis-name">{exactResult.displayName}</p>
              <p className="pis-copy">Tiene cuenta en pique · le llega la invitación en la app</p>
            </div>
            <button
              type="button"
              className="pis-action"
              disabled={busy}
              onClick={() => pick({ kind: mode.kind, value: mode.value, displayName: exactResult.displayName, lookupStatus: 'FOUND' })}
            >
              <UserPlus size={14} /> Invitar
            </button>
          </div>
        </div>
      );
    } else if (exactResult.status === 'EMAIL_WITHOUT_ACCOUNT') {
      body = (
        <div className="pis-rows">
          <div className="pis-row">
            <span className="pis-avatar"><AtSign size={14} /></span>
            <div className="pis-info">
              <p className="pis-name">{mode.value}</p>
              <p className="pis-copy">Todavía no tiene cuenta. La invitación lo espera cuando se registre con este email.</p>
            </div>
            <button
              type="button"
              className="pis-action"
              disabled={busy}
              onClick={() => pick({ kind: 'email', value: mode.value, displayName: null, lookupStatus: 'EMAIL_WITHOUT_ACCOUNT' })}
            >
              <UserPlus size={14} /> Invitar igual
            </button>
          </div>
        </div>
      );
    } else {
      body = (
        <div className="pis-warn">
          <p className="pis-warn-title">No encontramos una cuenta con ese DNI</p>
          <p className="pis-copy">Probá con su nombre o su email: si todavía no tiene cuenta, la invitación lo espera cuando se registre.</p>
        </div>
      );
    }
  }

  return (
    <div className="pis">
      <style dangerouslySetInnerHTML={{ __html: PIS_CSS }} />
      <div className="pis-field">
        <span className="pis-field-icon"><Search size={15} /></span>
        <input
          className="pis-input"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            // Enter solo confirma resultados exactos (DNI/email), nunca adivina entre nombres.
            if ((mode.kind === 'dni' || mode.kind === 'email') && exactResult && !exactAlreadyAdded && !isOwnerEmail) {
              if (exactResult.status === 'FOUND') {
                pick({ kind: mode.kind, value: mode.value, displayName: exactResult.displayName, lookupStatus: 'FOUND' });
              } else if (exactResult.status === 'EMAIL_WITHOUT_ACCOUNT' && mode.kind === 'email') {
                pick({ kind: 'email', value: mode.value, displayName: null, lookupStatus: 'EMAIL_WITHOUT_ACCOUNT' });
              }
            }
          }}
          placeholder="Buscá por nombre, DNI o email"
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="search"
          autoFocus={autoFocus}
          aria-label="Buscar jugador por nombre, DNI o email"
        />
        {query && (
          <button type="button" className="pis-clear" onClick={() => setQuery('')} aria-label="Borrar búsqueda">
            <X size={14} />
          </button>
        )}
      </div>
      {body}
    </div>
  );
}
