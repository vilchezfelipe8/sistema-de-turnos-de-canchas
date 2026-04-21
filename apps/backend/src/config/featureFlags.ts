/**
 * Feature flags para habilitar/deshabilitar componentes sin redeploy.
 * Por defecto: true cuando no se especifica (comportamiento actual).
 */
export const featureFlags = {
  get ENABLE_OUTBOX(): boolean {
    const v = process.env.ENABLE_OUTBOX;
    if (v === 'false' || v === '0') return false;
    return true;
  },

  get ENABLE_WHATSAPP_WORKER(): boolean {
    const v = process.env.ENABLE_WHATSAPP_WORKER;
    if (v === 'false' || v === '0') return false;
    return true;
  },

  get ENABLE_READ_MODELS(): boolean {
    const v = process.env.ENABLE_READ_MODELS;
    if (v === 'false' || v === '0') return false;
    return true;
  },
};
