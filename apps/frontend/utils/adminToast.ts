/**
 * adminToast — helper global de toast para el panel admin.
 *
 * Uso desde cualquier componente dentro de AdminPlaygroundShell:
 *   import { showAdminToast } from '../utils/adminToast';
 *   showAdminToast('Producto creado.');
 *   showAdminToast('No se pudo guardar.', 'error');
 *
 * El listener vive en <AdminToast /> montado en AdminPlaygroundShell.
 * No requiere Context ni Provider.
 */

export const ADMIN_TOAST_EVENT = 'pique-admin-toast' as const;

export type AdminToastType = 'success' | 'error' | 'info' | 'warning';

export interface AdminToastPayload {
  message: string;
  type: AdminToastType;
}

export function showAdminToast(message: string, type: AdminToastType = 'success'): void {
  const text = String(message || '').trim();
  if (!text || typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<AdminToastPayload>(ADMIN_TOAST_EVENT, {
      detail: { message: text, type },
    }),
  );
}
