import { X } from 'lucide-react';
import AdminOverlay from '../ui/AdminOverlay';
import { AdminPersonCreateOption, AdminPersonList, AdminPersonOption, AdminSearchInput } from '../ui/AdminPersonPicker';
import { modalCloseButtonCls, modalFooterCls, modalPanelScrollCls, modalPrimaryButtonCls, modalSecondaryButtonCls, modalTitleCls } from '../ui/adminModalStyles';
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

function ChangeTitularModalPanel({
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
    <div role="dialog" aria-modal="true" className={`${modalPanelScrollCls} sm:max-w-[480px]`}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 className={modalTitleCls}>Cambiar titular</h2>
          <p className="mt-1 truncate text-[13px] text-p-text-muted">
            Hoy está a nombre de <span className="font-semibold text-p-text">{currentTitle || 'otro cliente'}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          aria-label="Cerrar"
          className={`${modalCloseButtonCls} disabled:opacity-40`}
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-3 px-5 py-4">
        {!isDraftMode ? (
          <>
            <AdminSearchInput
              size="lg"
              autoFocus
              value={search}
              onChange={onSearchChange}
              placeholder="Buscá por nombre, teléfono o DNI"
              disabled={submitting}
            />

            {showResults && (
              <AdminPersonList loading={loading} query={search} count={candidates.length} empty="No hay clientes con ese dato.">
                {candidates.map((candidate) => {
                  const memberBadge = (candidate.badges || []).find((badge) => /^socio/i.test(String(badge)));
                  return (
                    <AdminPersonOption
                      key={`change-titular-candidate-${candidate.key}`}
                      name={candidate.name}
                      detail={candidate.phone || candidate.email}
                      badges={memberBadge ? [memberBadge] : undefined}
                      selected={String(selectedKey) === String(candidate.key)}
                      onClick={() => onSelectCandidate(String(candidate.key))}
                      disabled={submitting}
                    />
                  );
                })}
                {search.trim().length >= 2 && (
                  <AdminPersonCreateOption label="Titular nuevo" value={search.trim()} onClick={onUseNewClient} disabled={submitting} />
                )}
              </AdminPersonList>
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

      <div className={modalFooterCls}>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className={modalSecondaryButtonCls}
        >
          Volver
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || (!selectedCandidate && !isDraftMode)}
          className={`${modalPrimaryButtonCls} max-w-[260px] truncate`}
        >
          {submitting ? 'Guardando...' : nextOwnerName ? `Pasar a ${nextOwnerName}` : 'Elegí el nuevo titular'}
        </button>
      </div>
    </div>
  );
}


export default function ChangeTitularModal(props: ChangeTitularModalProps) {
  return (
    <AdminOverlay open={props.open} onClose={props.submitting ? undefined : props.onClose}>
      {props.open ? <ChangeTitularModalPanel {...props} /> : null}
    </AdminOverlay>
  );
}
