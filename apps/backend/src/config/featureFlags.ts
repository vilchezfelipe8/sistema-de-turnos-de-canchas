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

  get ENABLE_WHATSAPP_SEND_V2(): boolean {
    const v = process.env.ENABLE_WHATSAPP_SEND_V2;
    if (v === 'true' || v === '1') return true;
    return false;
  },

  get ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2(): boolean {
    const v = process.env.ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2;
    if (v === 'true' || v === '1') return true;
    return false;
  },

  get ENABLE_WHATSAPP_STAFF_EVENTS_V2(): boolean {
    const v = process.env.ENABLE_WHATSAPP_STAFF_EVENTS_V2;
    if (v === 'true' || v === '1') return true;
    return false;
  },

  get ENABLE_WHATSAPP_V2_DRY_RUN(): boolean {
    const v = process.env.ENABLE_WHATSAPP_V2_DRY_RUN;
    if (v === 'true' || v === '1') return true;
    return false;
  },

  get ENABLE_WHATSAPP_CLOUD_API(): boolean {
    const v = process.env.ENABLE_WHATSAPP_CLOUD_API;
    if (v === 'true' || v === '1') return true;
    return false;
  },

  get ENABLE_WHATSAPP_WEBHOOK_PROCESSOR(): boolean {
    const v = process.env.ENABLE_WHATSAPP_WEBHOOK_PROCESSOR;
    if (v === 'true' || v === '1') return true;
    return false;
  },

  get ENABLE_READ_MODELS(): boolean {
    const v = process.env.ENABLE_READ_MODELS;
    if (v === 'false' || v === '0') return false;
    return true;
  },

  get ENABLE_ARCA_WORKER(): boolean {
    const v = process.env.ENABLE_ARCA_WORKER;
    if (v === 'true' || v === '1') return true;
    return false;
  },
};
