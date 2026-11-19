import AdminOverlay from '../ui/AdminOverlay';
import { AdminPersonList, AdminPersonOption } from '../ui/AdminPersonPicker';
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

      <div className="px-5 py-4">
        {candidates.length === 0 ? (
          <p className="text-[13px] text-p-text-muted">No llegaron candidatos detallados en la respuesta.</p>
        ) : (
          <AdminPersonList count={candidates.length}>
            {candidates.map((candidate) => (
              <AdminPersonOption
                key={`duplicate-candidate-${candidate.id}`}
                name={candidate.name}
                detail={[candidate.phone, candidate.email].filter(Boolean).join(' · ') || 'Sin contacto visible'}
                selected={String(selectedClientId) === String(candidate.id)}
                onClick={() => onSelectClient(String(candidate.id))}
                disabled={loading}
              />
            ))}
          </AdminPersonList>
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
