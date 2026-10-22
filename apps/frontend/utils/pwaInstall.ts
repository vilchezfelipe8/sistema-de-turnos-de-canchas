// Instalación de la app (acceso directo). Chrome/Edge/Android avisan con `beforeinstallprompt`,
// que llega una sola vez al cargar: se captura temprano (desde _app) y se guarda para usarlo
// cuando el jugador toca "Agregar a mi celular". iPhone no tiene ese aviso: se muestran instrucciones.

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferredPrompt: InstallPromptEvent | null = null;
let captureStarted = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export const startPwaInstallCapture = () => {
  if (captureStarted || typeof window === 'undefined') return;
  captureStarted = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
};

export const subscribePwaInstall = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const canPromptPwaInstall = () => Boolean(deferredPrompt);

export const promptPwaInstall = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
  if (!deferredPrompt) return 'unavailable';
  const event = deferredPrompt;
  deferredPrompt = null;
  notify();
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome;
};

export const isIosSafari = () => {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  const isIos = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && 'ontouchend' in document);
  // En iPhone solo Safari permite "Agregar a inicio".
  return isIos && !/crios|fxios|edgios/i.test(ua);
};
