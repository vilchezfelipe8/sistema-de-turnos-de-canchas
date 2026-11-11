import { fetchWithAuth } from './apiClient';
import { getApiUrl } from './apiUrl';
import { throwApiErrorFromResponse } from './apiError';
import { isStandaloneDisplay } from './clubApp';

// Avisos push web: soporte del dispositivo, permiso, suscripción y preferencias.

const SERVICE_WORKER_URL = '/push-sw.js';
const apiBase = () => `${getApiUrl()}/api`;

export type NotificationPreferences = {
  invitations: boolean;
  invitationResponses: boolean;
  bookingReminders: boolean;
};

// 'unsupported': el navegador no tiene push.
// 'ios-needs-install': iPhone/iPad en Safari: los avisos solo funcionan con Pique agregado a la pantalla de inicio.
export type PushSupport = 'supported' | 'unsupported' | 'ios-needs-install';

const isIosDevice = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPadOS se presenta como Mac con pantalla táctil.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
};

export const getPushSupport = (): PushSupport => {
  if (typeof window === 'undefined') return 'unsupported';
  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (isIosDevice() && !isStandaloneDisplay()) return 'ios-needs-install';
  return hasApis ? 'supported' : 'unsupported';
};

export const getNotificationPermission = (): NotificationPermission | 'unsupported' => {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
};

const urlBase64ToUint8Array = (base64: string) => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
};

const getPushConfig = async (): Promise<{ enabled: boolean; publicKey: string | null }> => {
  const res = await fetchWithAuth(`${apiBase()}/me/push/config`, { method: 'GET' });
  if (!res.ok) await throwApiErrorFromResponse(res, 'No pudimos preparar los avisos.');
  return res.json();
};

const registerServiceWorker = async () => {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing && existing.active?.scriptURL.endsWith(SERVICE_WORKER_URL)) return existing;
  await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' });
  return navigator.serviceWorker.ready;
};

const saveSubscription = async (subscription: PushSubscription) => {
  const json = subscription.toJSON();
  const res = await fetchWithAuth(`${apiBase()}/me/push/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  if (!res.ok) await throwApiErrorFromResponse(res, 'No pudimos activar los avisos.');
};

// Pide el permiso (debe llamarse desde un toque del usuario) y suscribe este dispositivo.
export const enablePushNotifications = async (): Promise<'enabled' | 'denied' | 'unavailable'> => {
  if (getPushSupport() !== 'supported') return 'unavailable';
  const config = await getPushConfig();
  if (!config.enabled || !config.publicKey) return 'unavailable';

  const permission = Notification.permission === 'default'
    ? await Notification.requestPermission()
    : Notification.permission;
  if (permission !== 'granted') return 'denied';

  const registration = await registerServiceWorker();
  const applicationServerKey = urlBase64ToUint8Array(config.publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  }
  await saveSubscription(subscription);
  return 'enabled';
};

// Con el permiso ya dado: vuelve a registrar la suscripción (cambio de cuenta, endpoint renovado, nuevo login).
export const syncPushSubscription = async () => {
  if (getPushSupport() !== 'supported' || Notification.permission !== 'granted') return;
  const config = await getPushConfig();
  if (!config.enabled || !config.publicKey) return;
  const registration = await registerServiceWorker();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    });
  }
  await saveSubscription(subscription);
};

export const hasActivePushSubscription = async () => {
  if (getPushSupport() !== 'supported' || Notification.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.getRegistration('/');
  return Boolean(await registration?.pushManager.getSubscription());
};

// Desactiva los avisos en este dispositivo (los demás dispositivos del usuario siguen activos).
export const disablePushNotifications = async () => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  const res = await fetchWithAuth(`${apiBase()}/me/push/subscriptions/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) await throwApiErrorFromResponse(res, 'No pudimos desactivar los avisos.');
};

export const getNotificationPreferences = async (): Promise<NotificationPreferences> => {
  const res = await fetchWithAuth(`${apiBase()}/me/notification-preferences`, { method: 'GET' });
  if (!res.ok) await throwApiErrorFromResponse(res, 'No pudimos cargar tus avisos.');
  return res.json();
};

export const updateNotificationPreferences = async (input: Partial<NotificationPreferences>): Promise<NotificationPreferences> => {
  const res = await fetchWithAuth(`${apiBase()}/me/notification-preferences`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) await throwApiErrorFromResponse(res, 'No pudimos guardar tus avisos.');
  return res.json();
};

// "Ahora no" en el cartel: no se vuelve a mostrar por 14 días.
const DISMISS_KEY = 'pique:push-optin-dismissed-at';
const DISMISS_DAYS = 14;

export const isPushOptInDismissed = () => {
  try {
    const raw = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
    return raw > 0 && Date.now() - raw < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
};

export const dismissPushOptIn = () => {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // noop
  }
};
