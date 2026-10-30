import { useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { syncPushSubscription } from '../../utils/pushNotifications';
import { reportUiError } from '../../utils/uiError';
import { isAuthSessionInvalidatedError } from '../../utils/apiClient';

// Si el dispositivo ya dio permiso de avisos, mantiene la suscripción asociada al usuario logueado
// (nuevo login, cambio de cuenta o endpoint renovado por el navegador). No pide permisos.
export default function PushSubscriptionSync() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    syncPushSubscription().catch((error) => {
      if (!isAuthSessionInvalidatedError(error)) {
        reportUiError({ area: 'PushSubscriptionSync', action: 'sync' }, error);
      }
    });
  }, [userId]);

  return null;
}
