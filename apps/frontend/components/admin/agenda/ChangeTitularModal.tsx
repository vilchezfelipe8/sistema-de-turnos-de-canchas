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

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-ink-950/45 px-4"
      style={{ zIndex: ADMIN_Z_INDEX.modal }}
    >
      <div className="w-full max-w-[560px] rounded-2xl border border-p-border bg-p-surface shadow-p-lg">
        <div className="border-b border-p-border px-5 py-4">
          <p className="text-[16px] font-semibold text-p-text">Cambiar titular</p>
          <p className="mt-1 text-[13px] text-p-text-muted">
            Buscá una persona del club o cargá un nuevo titular sin salir de Agenda.
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="rounded-xl border border-p-border bg-p-surface-2 px-3 py-2 text-[12px] text-p-text-secondary">
            <p>
              <span className="font-semibold text-p-text">Titular actual:</span>{' '}
              {currentTitle || 'Titular actual'}
            </p>
            <p className="mt-1">
              <span className="font-semibold text-p-text">Nuevo titular:</span>{' '}
              {selectedCandidate?.name || draftName.trim() || 'Seleccioná una persona'}
            </p>
            <p className="mt-1 text-p-text-muted">
              Si la reserva tiene pagos o movimientos registrados, el sistema puede bloquear el cambio.
            </p>
          </div>

          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar por nombre, teléfono o email"
            disabled={submitting}
            className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none"
          />

          <div className="max-h-[34vh] space-y-2 overflow-y-auto">
            {loading && (
              <p className="text-[12px] text-p-text-muted">Buscando personas...</p>
            )}
            {!loading && candidates.length === 0 && (
              <p className="rounded-xl border border-p-border bg-p-surface-2 px-3 py-2 text-[12px] text-p-text-muted">
                Escribí al menos 2 caracteres para buscar o cargá un nuevo titular.
              </p>
            )}
            {candidates.map((candidate) => {
              const isSelected = String(selectedKey) === String(candidate.key);
              return (
                <button
                  key={`change-titular-candidate-${candidate.key}`}
                  type="button"
                  onClick={() => onSelectCandidate(String(candidate.key))}
                  disabled={submitting}
                  className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                    isSelected
                      ? 'border-p-accent bg-p-positive-bg'
                      : 'border-p-border bg-p-surface hover:bg-p-surface-2'
                  } disabled:opacity-50`}
                >
                  <p className="text-[13px] font-semibold text-p-text">{candidate.name}</p>
                  {Array.isArray(candidate.badges) && candidate.badges.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {candidate.badges.map((badge) => (
                        <span
                          key={`${candidate.key}-${badge}`}
                          className="inline-flex items-center rounded-full border border-p-border bg-p-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-p-text-muted"
                        >
                          {badge}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mt-0.5 text-[12px] text-p-text-muted">
                    {[candidate.phone, candidate.email].filter(Boolean).join(' · ') || 'Sin contacto visible'}
                  </p>
                </button>
              );
            })}

            <button
              type="button"
              onClick={onUseNewClient}
              disabled={submitting || search.trim().length < 2}
              className="w-full rounded-xl border border-dashed border-p-border px-3 py-2 text-left hover:bg-p-surface-2 disabled:opacity-40"
            >
              <p className="text-[13px] font-semibold text-p-text">Cargar nuevo titular</p>
              <p className="mt-0.5 text-[12px] text-p-text-muted">
                Usar “{search.trim() || 'Nuevo titular'}”, cargar teléfono y, si querés, sumar email o DNI acá mismo.
              </p>
            </button>
          </div>

          {isDraftMode && (
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-p-border bg-p-surface-2 p-3 md:grid-cols-2">
              <label className="block md:col-span-2">
                <span className="text-[12px] font-medium text-p-text-muted">Nombre</span>
                <input
                  value={draftName}
                  onChange={(event) => onDraftNameChange(event.target.value)}
                  disabled={submitting}
                  className="mt-1 h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none"
                />
              </label>
              <label className="block">
                <span className="text-[12px] font-medium text-p-text-muted">Teléfono</span>
                <input
                  value={draftPhone}
                  onChange={(event) => onDraftPhoneChange(event.target.value)}
                  placeholder="3511234567"
                  disabled={submitting}
                  className="mt-1 h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none"
                />
              </label>
              <label className="block">
                <span className="text-[12px] font-medium text-p-text-muted">Email</span>
                <input
                  type="email"
                  value={draftEmail}
                  onChange={(event) => onDraftEmailChange(event.target.value)}
                  placeholder="cliente@email.com"
                  disabled={submitting}
                  className="mt-1 h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none"
                />
              </label>
              <label className="block md:col-span-2">
                <span className="text-[12px] font-medium text-p-text-muted">DNI</span>
                <input
                  value={draftDni}
                  onChange={(event) => onDraftDniChange(event.target.value)}
                  placeholder="30111222"
                  disabled={submitting}
                  className="mt-1 h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none"
                />
              </label>
            </div>
          )}

          <textarea
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="Motivo (opcional)"
            rows={2}
            disabled={submitting}
            className="w-full rounded-xl border border-p-border bg-p-surface px-3 py-2 text-[13px] text-p-text outline-none"
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
            Cancelar
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting || (!selectedCandidate && !isDraftMode)}
            className="h-10 rounded-xl bg-ink-900 px-4 text-[13px] font-semibold text-ink-50 disabled:opacity-40"
          >
            {submitting ? 'Guardando...' : 'Confirmar cambio'}
          </button>
        </div>
      </div>
    </div>
  );
}
