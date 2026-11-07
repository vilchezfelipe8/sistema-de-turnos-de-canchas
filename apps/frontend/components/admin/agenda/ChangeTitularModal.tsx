import { Check, Plus, Search, X } from 'lucide-react';
import { ADMIN_Z_INDEX } from '../../../utils/adminZIndex';
import { AdminFeedbackBanner } from '../ui/AdminFeedback';

export type ChangeTitularCandidate = {
  key: string;
  kind: 'linked' | 'clubClient' | 'systemUser';
  clientId?: string;
  userId?: number;
  name: string;
  phone?: string;
  email?: string;
  badges?: string[];
  personKey?: string;
  searchQuery?: string;
};

type ChangeTitularModalProps = {
  open: boolean;
  currentTitle: string;
  search: string;
  reason: string;
  candidates: ChangeTitularCandidate[];
  selectedKey: string;
  selectedCandidate: ChangeTitularCandidate | null;
  draftName: string;
  draftPhone: string;
  draftEmail: string;
  draftDni: string;
  loading: boolean;
  submitting: boolean;
  error: string;
  onSearchChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onSelectCandidate: (candidateKey: string) => void;
  onDraftNameChange: (value: string) => void;
  onDraftPhoneChange: (value: string) => void;
  onDraftEmailChange: (value: string) => void;
  onDraftDniChange: (value: string) => void;
  onUseNewClient: () => void;
  onClose: () => void;
  onSubmit: () => void;
};

export default function ChangeTitularModal({
  open,
  currentTitle,
  search,
  reason,
  candidates,
  selectedKey,
  selectedCandidate,
  draftName,
  draftPhone,
  draftEmail,
  draftDni,
  loading,
  submitting,
  error,
  onSearchChange,
  onReasonChange,
  onSelectCandidate,
  onDraftNameChange,
  onDraftPhoneChange,
  onDraftEmailChange,
  onDraftDniChange,
  onUseNewClient,
  onClose,
  onSubmit,
}: ChangeTitularModalProps) {
  if (!open) return null;

  const isDraftMode = !selectedCandidate && draftName.trim().length >= 2;
  const nextOwnerName = selectedCandidate?.name || (isDraftMode ? draftName.trim() : '');
  const showResults = loading || candidates.length > 0 || search.trim().length >= 2;

  return (
    <div
      className="fixed inset-0 flex items-end justify-center bg-ink-950/45 px-0 sm:items-center sm:px-4"
      style={{ zIndex: ADMIN_Z_INDEX.modal }}
    >
      <div className="w-full max-w-[480px] rounded-2xl border border-p-border bg-p-surface shadow-p-lg max-sm:max-h-[92dvh] max-sm:overflow-y-auto max-sm:rounded-b-none max-sm:rounded-t-3xl max-sm:border-b-0 max-sm:pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            <p className="text-[20px] font-bold tracking-[-0.01em] text-p-text">Cambiar titular</p>
            <p className="mt-0.5 truncate text-[13px] text-p-text-muted">
              Hoy está a nombre de <span className="font-semibold text-p-text">{currentTitle || 'otro cliente'}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Cerrar"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-p-border text-p-text-muted hover:bg-p-surface-2 disabled:opacity-40"
          >
            <X size={15} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {!isDraftMode ? (
            <>
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-p-text-muted" />
                <input
                  autoFocus
                  value={search}
                  onChange={(event) => onSearchChange(event.target.value)}
                  placeholder="Buscá por nombre, teléfono o DNI"
                  disabled={submitting}
                  className="h-11 w-full rounded-xl border border-p-border bg-p-surface pl-9 pr-3 text-[15px] text-p-text outline-none focus:border-p-border-strong"
                />
              </div>

              {showResults && (
                <div className="max-h-[40vh] overflow-y-auto rounded-xl border border-p-border p-1">
                  {loading && <p className="px-3 py-2 text-[13px] text-p-text-muted">Buscando...</p>}
                  {!loading && candidates.length === 0 && search.trim().length >= 2 && (
                    <p className="px-3 py-2 text-[13px] text-p-text-muted">No hay clientes con ese dato.</p>
                  )}
                  {candidates.map((candidate) => {
                    const isSelected = String(selectedKey) === String(candidate.key);
                    const memberBadge = (candidate.badges || []).find((badge) => /^socio/i.test(String(badge)));
                    const detail = [candidate.phone || candidate.email, memberBadge].filter(Boolean).join(' · ');
                    return (
                      <button
                        key={`change-titular-candidate-${candidate.key}`}
                        type="button"
                        onClick={() => onSelectCandidate(String(candidate.key))}
                        disabled={submitting}
                        aria-pressed={isSelected}
                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition ${
                          isSelected ? 'bg-p-positive-bg' : 'hover:bg-p-surface-2'
                        } disabled:opacity-50`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold text-p-text">{candidate.name}</span>
                          {detail && <span className="block truncate text-[12px] text-p-text-muted">{detail}</span>}
                        </span>
                        {isSelected && <Check size={16} className="shrink-0 text-p-accent" />}
                      </button>
                    );
                  })}
                  {search.trim().length >= 2 && (
                    <>
                      <div className="my-1 h-px bg-p-border" />
                      <button
                        type="button"
                        onClick={onUseNewClient}
                        disabled={submitting}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[14px] text-p-text hover:bg-p-surface-2 disabled:opacity-40"
                      >
                        <Plus size={15} className="shrink-0 text-p-accent" />
                        <span className="truncate">
                          Titular nuevo: <strong className="font-semibold">{search.trim()}</strong>
                        </span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <div>
              <div className="flex flex-wrap gap-2">
                <input
                  value={draftName}
                  onChange={(event) => onDraftNameChange(event.target.value)}
                  placeholder="Nombre"
                  disabled={submitting}
                  className="h-11 min-w-[160px] flex-1 rounded-xl border border-p-border bg-p-surface px-3 text-[15px] text-p-text outline-none focus:border-p-border-strong"
                />
                <input
                  autoFocus
                  inputMode="tel"
                  value={draftPhone}
                  onChange={(event) => onDraftPhoneChange(event.target.value)}
                  placeholder="Teléfono"
                  disabled={submitting}
                  className="h-11 w-[160px] rounded-xl border border-p-border bg-p-surface px-3 text-[15px] text-p-text outline-none focus:border-p-border-strong"
                />
              </div>
              <button
                type="button"
                onClick={() => onDraftNameChange('')}
                disabled={submitting}
                className="mt-2 text-[13px] font-semibold text-p-accent hover:underline underline-offset-2"
              >
                Buscar un cliente existente
              </button>
            </div>
          )}

          <input
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="Motivo (opcional)"
            disabled={submitting}
            className="h-11 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[14px] text-p-text outline-none focus:border-p-border-strong"
          />

          {error && (
            <AdminFeedbackBanner tone="error" compact>
              {error}
            </AdminFeedbackBanner>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-p-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text-secondary disabled:opacity-40"
          >
            Volver
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting || (!selectedCandidate && !isDraftMode)}
            className="h-10 max-w-[260px] truncate rounded-xl bg-ink-900 px-4 text-[13px] font-semibold text-ink-50 disabled:opacity-40"
          >
            {submitting ? 'Guardando...' : nextOwnerName ? `Pasar a ${nextOwnerName}` : 'Elegí el nuevo titular'}
          </button>
        </div>
      </div>
    </div>
  );
}
