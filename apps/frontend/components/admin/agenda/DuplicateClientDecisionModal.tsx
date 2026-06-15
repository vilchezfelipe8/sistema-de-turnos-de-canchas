import { ADMIN_Z_INDEX } from '../../../utils/adminZIndex';
import { AdminFeedbackBanner } from '../ui/AdminFeedback';

export type DuplicateClientDecisionCandidate = {
  id: string | number;
  name: string;
  phone?: string;
  email?: string;
};

type DuplicateClientDecisionModalProps = {
  open: boolean;
  candidates: DuplicateClientDecisionCandidate[];
  selectedClientId: string;
  loading: boolean;
  error: string;
  onSelectClient: (clientId: string) => void;
  onClose: () => void;
  onUseExisting: () => void;
  onCreateNew: () => void;
};

export default function DuplicateClientDecisionModal({
  open,
  candidates,
  selectedClientId,
  loading,
  error,
  onSelectClient,
  onClose,
  onUseExisting,
  onCreateNew,
}: DuplicateClientDecisionModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-ink-950/45 px-4"
      style={{ zIndex: ADMIN_Z_INDEX.modal }}
    >
      <div className="w-full max-w-[560px] rounded-2xl border border-p-border bg-p-surface shadow-p-lg">
        <div className="border-b border-p-border px-5 py-4">
          <p className="text-[16px] font-semibold text-p-text">Ya existe un cliente parecido en este club</p>
          <p className="mt-1 text-[13px] text-p-text-muted">
            Elegí cómo continuar. No se va a vincular ni fusionar automáticamente.
          </p>
        </div>

        <div className="max-h-[46vh] space-y-2 overflow-y-auto px-5 py-4">
          {candidates.map((candidate) => {
            const isSelected = String(selectedClientId) === String(candidate.id);
            return (
              <button
                key={`duplicate-candidate-${candidate.id}`}
                type="button"
                onClick={() => onSelectClient(String(candidate.id))}
                disabled={loading}
                className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                  isSelected
                    ? 'border-p-accent bg-p-positive-bg'
                    : 'border-p-border bg-p-surface hover:bg-p-surface-2'
                } disabled:opacity-50`}
              >
                <p className="text-[13px] font-semibold text-p-text">{candidate.name}</p>
                <p className="mt-0.5 text-[12px] text-p-text-muted">
                  {[candidate.phone, candidate.email].filter(Boolean).join(' · ') || 'Sin contacto visible'}
                </p>
              </button>
            );
          })}

          {candidates.length === 0 && (
            <p className="rounded-xl border border-p-border bg-p-surface-2 px-3 py-2 text-[12px] text-p-text-muted">
              No llegaron candidatos detallados en la respuesta.
            </p>
          )}
        </div>

        {error && (
          <div className="px-5 pb-2">
            <AdminFeedbackBanner tone="error" compact>
              {error}
            </AdminFeedbackBanner>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-p-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text-secondary disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onUseExisting}
            disabled={loading || !selectedClientId}
            className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text disabled:opacity-40"
          >
            {loading ? 'Procesando...' : 'Usar cliente existente'}
          </button>
          <button
            type="button"
            onClick={onCreateNew}
            disabled={loading}
            className="h-10 rounded-xl bg-ink-900 px-4 text-[13px] font-semibold text-ink-50 disabled:opacity-40"
          >
            {loading ? 'Procesando...' : 'Crear cliente nuevo'}
          </button>
        </div>
      </div>
    </div>
  );
}
