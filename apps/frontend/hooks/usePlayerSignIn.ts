import { useCallback, useEffect, useRef, useState } from 'react';
import {
  confirmAccountActivation,
  confirmPasswordReset,
  login,
  requestAccountActivation,
  requestMagicLink,
  requestPasswordReset
} from '../services/AuthService';
import { normalizeApiError } from '../utils/apiError';
import { extractErrorMessage } from '../utils/uiError';

// Activación de cuenta de socio (primer ingreso) y recuperación de contraseña: pedir código → confirmar.
export type RecoveryMode = 'activate' | 'reset';
export type RecoveryStep = 'request' | 'confirm';

export const normalizeDniInput = (value: string) => String(value || '').replace(/\D/g, '');

type UsePlayerSignInOptions = {
  // Se llama con la respuesta del backend cuando la sesión quedó iniciada (login, activación o recuperación).
  onAuthenticated: (data: any) => void | Promise<void>;
};

// Lógica de ingreso del jugador usada por /login (único login de la app; la grilla de reservas manda ahí):
// DNI o email + contraseña, cuenta de socio pendiente → activación, olvidé mi contraseña y enlace por email.
export function usePlayerSignIn({ onAuthenticated }: UsePlayerSignInOptions) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryMode, setRecoveryMode] = useState<RecoveryMode | null>(null);
  const [recoveryStep, setRecoveryStep] = useState<RecoveryStep>('request');
  const [recoveryIdentifier, setRecoveryIdentifier] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);

  const onAuthenticatedRef = useRef(onAuthenticated);
  useEffect(() => {
    onAuthenticatedRef.current = onAuthenticated;
  }, [onAuthenticated]);

  const requestRecoveryCode = useCallback(async (mode: RecoveryMode, value: string) => {
    const target = String(value || '').trim();
    if (!target) {
      setError(mode === 'activate' ? 'Ingresá tu DNI.' : 'Ingresá tu DNI o email.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      if (mode === 'activate') await requestAccountActivation(target);
      else await requestPasswordReset(target);
      setRecoveryStep('confirm');
      setSuccess(
        mode === 'activate'
          ? 'Si el DNI corresponde a un socio, te enviamos un código por WhatsApp al teléfono registrado en el club. Si no lo recibís, pedilo en el mostrador.'
          : 'Si los datos corresponden a una cuenta, te enviamos un código por email o WhatsApp.'
      );
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'No se pudo enviar el código.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const openRecovery = useCallback((mode: RecoveryMode, prefill?: string) => {
    const value = String(prefill || '').trim();
    // La activación es solo por DNI; la recuperación acepta DNI o email.
    const nextIdentifier = mode === 'activate' ? normalizeDniInput(value) : value;
    setRecoveryMode(mode);
    setRecoveryStep('request');
    setRecoveryIdentifier(nextIdentifier);
    setRecoveryCode('');
    setRecoveryPassword('');
    setError('');
    setSuccess('');
    if (mode === 'activate' && nextIdentifier.length >= 6) {
      void requestRecoveryCode(mode, nextIdentifier);
    }
  }, [requestRecoveryCode]);

  const closeRecovery = useCallback(() => {
    setRecoveryMode(null);
    setRecoveryStep('request');
    setRecoveryCode('');
    setRecoveryPassword('');
    setError('');
  }, []);

  const submitLogin = useCallback(async () => {
    const safeIdentifier = identifier.trim();
    if (!safeIdentifier || !password) {
      setError('Completá tu DNI o email y la contraseña.');
      return;
    }
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const data = await login(safeIdentifier, password);
      await onAuthenticatedRef.current(data);
    } catch (err: unknown) {
      if (normalizeApiError(err).code === 'ACCOUNT_PENDING_ACTIVATION') {
        // Socio cargado por el club que todavía no eligió contraseña.
        openRecovery('activate', safeIdentifier);
        setSuccess('Tu cuenta de socio todavía no está activada. Te enviamos un código para activarla.');
        return;
      }
      setError(extractErrorMessage(err, 'No se pudo iniciar sesión.'));
    } finally {
      setLoading(false);
    }
  }, [identifier, openRecovery, password]);

  const confirmRecovery = useCallback(async () => {
    if (!recoveryMode) return;
    if (recoveryPassword.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const data = recoveryMode === 'activate'
        ? await confirmAccountActivation(recoveryIdentifier, recoveryCode.trim(), recoveryPassword)
        : await confirmPasswordReset(recoveryIdentifier, recoveryCode.trim(), recoveryPassword);
      await onAuthenticatedRef.current(data);
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'No se pudo validar el código.'));
    } finally {
      setLoading(false);
    }
  }, [recoveryCode, recoveryIdentifier, recoveryMode, recoveryPassword]);

  // El enlace de acceso solo existe para email.
  const canRequestMagicLink = identifier.includes('@');
  const requestMagicLinkForIdentifier = useCallback(async () => {
    const safeEmail = identifier.trim();
    if (!safeEmail.includes('@')) {
      setError('Ingresá tu email para enviarte el enlace.');
      return;
    }
    setError('');
    setSuccess('');
    setMagicLoading(true);
    try {
      const data = await requestMagicLink(safeEmail);
      setSuccess(data?.message || 'Si el email es válido, te enviamos un enlace para ingresar.');
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'No se pudo enviar el enlace en este momento.'));
    } finally {
      setMagicLoading(false);
    }
  }, [identifier]);

  const reset = useCallback(() => {
    setRecoveryMode(null);
    setRecoveryStep('request');
    setRecoveryCode('');
    setRecoveryPassword('');
    setError('');
    setSuccess('');
    setLoading(false);
    setMagicLoading(false);
  }, []);

  return {
    identifier,
    setIdentifier,
    password,
    setPassword,
    recoveryMode,
    recoveryStep,
    recoveryIdentifier,
    setRecoveryIdentifier,
    recoveryCode,
    setRecoveryCode,
    recoveryPassword,
    setRecoveryPassword,
    error,
    setError,
    success,
    setSuccess,
    loading,
    setLoading,
    magicLoading,
    canRequestMagicLink,
    submitLogin,
    openRecovery,
    closeRecovery,
    requestRecoveryCode,
    confirmRecovery,
    requestMagicLink: requestMagicLinkForIdentifier,
    reset
  };
}
