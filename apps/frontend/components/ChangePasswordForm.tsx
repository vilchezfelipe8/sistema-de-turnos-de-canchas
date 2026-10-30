import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle, Eye, EyeOff, Loader2, LockKeyhole } from 'lucide-react';
import { changePassword } from '../services/AuthService';
import { normalizeApiError } from '../utils/apiError';
import { validatePasswordChange, type PasswordChangeErrors, type PasswordChangeValues } from '../utils/passwordChange';

const EMPTY_VALUES: PasswordChangeValues = { currentPassword: '', newPassword: '', confirmation: '' };
const FIELDS = [
  { name: 'currentPassword', label: 'Contraseña actual', autoComplete: 'current-password' },
  { name: 'newPassword', label: 'Nueva contraseña', autoComplete: 'new-password' },
  { name: 'confirmation', label: 'Repetir nueva contraseña', autoComplete: 'new-password' },
] as const;

const CSS = `
  .pf-password.pf-security-card { width:100%; padding:20px; }
  .pf-password-title { display:flex; align-items:center; gap:8px; margin:0 0 8px; font-size:16px; font-weight:800; color:var(--text-primary); }
  .pf-password-copy { margin:0 0 16px; font-size:13px; line-height:1.45; color:var(--text-secondary); }
  .pf-password-fields { display:grid; gap:12px; }
  .pf-password-label { display:block; margin-bottom:5px; font-size:12px; font-weight:700; color:var(--text-primary); }
  .pf-password-input-wrap { position:relative; }
  .pf-password .p-public-input { min-height:42px; padding:10px 44px 10px 12px; font-size:14px; }
  .pf-password .p-public-input[aria-invalid="true"] { border-color:var(--error-fg); }
  .pf-password-toggle { position:absolute; right:4px; top:50%; transform:translateY(-50%); width:42px; height:42px; display:flex; align-items:center; justify-content:center; padding:0; border:0; border-radius:8px; background:none; color:var(--text-muted); cursor:pointer; transition:color .15s; }
  .pf-password-toggle:hover:not(:disabled) { color:var(--text-secondary); }
  .pf-password-toggle:focus-visible { outline:2px solid var(--accent-fg); outline-offset:2px; }
  .pf-password-toggle:disabled { opacity:.5; cursor:not-allowed; }
  .pf-password-help, .pf-password-error { margin:5px 0 0; font-size:12px; line-height:1.4; }
  .pf-password-help { color:var(--text-secondary); }
  .pf-password-error { color:var(--error-fg); }
  .pf-password .pf-actions { margin-top:16px; }
  .pf-password .pf-save { min-height:42px; justify-content:center; padding:10px 18px; border-radius:12px; font-size:13px; }
  .pf-password .pf-notice { margin:14px 0 0; font-size:13px; }
  .pf-password .pf-notice:focus { outline:none; }
  @media(max-width:600px) { .pf-password .p-public-input { font-size:16px; } .pf-password .pf-save { width:100%; } }
`;

export default function ChangePasswordForm({ onPasswordChanged }: { onPasswordChanged: () => void }) {
  const [values, setValues] = useState<PasswordChangeValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<PasswordChangeErrors>({});
  const [visible, setVisible] = useState<Partial<Record<keyof PasswordChangeValues, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState({ error: '', success: '' });
  const savingRef = useRef(false);
  const inputsRef = useRef<Partial<Record<keyof PasswordChangeValues, HTMLInputElement>>>({});
  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (notice.success) successRef.current?.focus();
  }, [notice.success]);

  const focusFirstError = (nextErrors: PasswordChangeErrors) => {
    const field = FIELDS.find(({ name }) => nextErrors[name]);
    if (field) inputsRef.current[field.name]?.focus();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current) return;
    setNotice({ error: '', success: '' });
    const nextErrors = validatePasswordChange(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      focusFirstError(nextErrors);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await changePassword(values.currentPassword, values.newPassword);
    } catch (error: unknown) {
      const apiError = normalizeApiError(error, 'No pudimos cambiar la contraseña. Intentá de nuevo.');
      const fieldErrors: PasswordChangeErrors = {};
      for (const { name } of FIELDS) {
        if (apiError.fieldErrors?.[name]) fieldErrors[name] = apiError.fieldErrors[name];
      }
      setErrors(fieldErrors);
      setNotice({ error: Object.keys(fieldErrors).length ? 'Revisá los campos marcados.' : apiError.message, success: '' });
      // Re-enable inputs before focusing the field rejected by the server.
      requestAnimationFrame(() => focusFirstError(fieldErrors));
      return;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    setValues(EMPTY_VALUES);
    setVisible({});
    setErrors({});
    setNotice({ error: '', success: 'Tu contraseña se actualizó. En este dispositivo seguís conectado; en los demás tendrás que ingresar de nuevo.' });
    // Refresh sessions separately: failure there must not report a failed password change.
    onPasswordChanged();
  };

  return (
    <form className="p-public-card pf-security-card pf-password" onSubmit={handleSubmit} noValidate aria-labelledby="pf-password-title" aria-busy={saving}>
      <style>{CSS}</style>
      <h2 id="pf-password-title" className="pf-password-title"><LockKeyhole size={18} aria-hidden="true" /> Cambiar contraseña</h2>
      <p className="pf-password-copy">Se cerrarán las sesiones de otros dispositivos.</p>
      <div className="pf-password-fields">
        {FIELDS.map(({ name, label, autoComplete }) => {
          const id = `pf-password-${name}`;
          return (
            <div key={name}>
              <label className="pf-password-label" htmlFor={id}>{label}</label>
              <div className="pf-password-input-wrap">
                <input
                  ref={input => { if (input) inputsRef.current[name] = input; }}
                  id={id} name={name} className="p-public-input"
                  type={visible[name] ? 'text' : 'password'} autoComplete={autoComplete}
                  autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  required minLength={name === 'currentPassword' ? 1 : 8}
                  disabled={saving} value={values[name]}
                  aria-invalid={Boolean(errors[name])}
                  aria-describedby={[name === 'newPassword' ? 'pf-password-help' : '', errors[name] ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined}
                  onChange={event => {
                    const value = event.target.value;
                    setValues(previous => ({ ...previous, [name]: value }));
                    setErrors(previous => ({ ...previous, [name]: undefined,
                      ...(name === 'newPassword' ? { confirmation: undefined } : {}),
                      ...(name === 'currentPassword' ? { newPassword: undefined } : {}) }));
                    setNotice({ error: '', success: '' });
                  }}
                  onBlur={() => setErrors(previous => ({ ...previous, [name]: validatePasswordChange(values)[name] }))}
                />
                <button type="button" className="pf-password-toggle" disabled={saving}
                  aria-label={`${visible[name] ? 'Ocultar' : 'Mostrar'} ${label.toLowerCase()}`}
                  aria-controls={id} aria-pressed={Boolean(visible[name])}
                  onClick={() => setVisible(previous => ({ ...previous, [name]: !previous[name] }))}>
                  {visible[name] ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
              {name === 'newPassword' && <p id="pf-password-help" className="pf-password-help">Mínimo 8 caracteres.</p>}
              {errors[name] && <p id={`${id}-error`} className="pf-password-error">{errors[name]}</p>}
            </div>
          );
        })}
      </div>
      {notice.error && <div role="alert" className="pf-notice pf-notice-err">{notice.error}</div>}
      {notice.success && <div ref={successRef} role="status" tabIndex={-1} className="pf-notice pf-notice-ok"><CheckCircle size={20} aria-hidden="true" style={{ flexShrink: 0 }} />{notice.success}</div>}
      <div className="pf-actions">
        <button className="pf-save" type="submit" disabled={saving}>
          {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
          {saving ? 'Guardando...' : 'Cambiar contraseña'}
        </button>
      </div>
    </form>
  );
}
