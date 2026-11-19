import AdminOverlay from '../ui/AdminOverlay';
import { modalFooterCls, modalPanelScrollCls, modalPrimaryButtonCls, modalSecondaryButtonCls, modalTitleCls } from '../ui/adminModalStyles';
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

function DuplicateClientDecisionModalPanel({
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
    <div role="dialog" aria-modal="true" className={`${modalPanelScrollCls} sm:max-w-[560px]`}>
      <div className="border-b border-p-border px-5 py-4">
        <h2 className={modalTitleCls}>Ya existe un cliente parecido en este club</h2>
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

      <div className={modalFooterCls}>
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className={modalSecondaryButtonCls}
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onUseExisting}
          disabled={loading || !selectedClientId}
          className={modalSecondaryButtonCls}
        >
          {loading ? 'Procesando...' : 'Usar cliente existente'}
        </button>
        <button
          type="button"
          onClick={onCreateNew}
          disabled={loading}
          className={modalPrimaryButtonCls}
        >
          {loading ? 'Procesando...' : 'Crear cliente nuevo'}
        </button>
      </div>
    </div>
  );
}


export default function DuplicateClientDecisionModal(props: DuplicateClientDecisionModalProps) {
  return (
    <AdminOverlay open={props.open} onClose={props.loading ? undefined : props.onClose}>
      {props.open ? <DuplicateClientDecisionModalPanel {...props} /> : null}
    </AdminOverlay>
  );
}
