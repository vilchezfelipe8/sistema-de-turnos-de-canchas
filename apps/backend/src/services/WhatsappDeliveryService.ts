import { toDialablePhoneNumber } from '../utils/phone';

export type WhatsappRuntimeStatus = {
  ready: boolean;
  hasQR: boolean;
  disabled: boolean;
  provider: 'wpp_http' | 'local_browser';
};

const DEFAULT_WPP_SERVICE_URL = 'http://wpp-service:3002';

const getProvider = (): 'wpp_http' | 'local_browser' => {
  return process.env.WHATSAPP_PROVIDER === 'local_browser' ? 'local_browser' : 'wpp_http';
};

const getBaseUrl = () => process.env.WPP_SERVICE_URL || DEFAULT_WPP_SERVICE_URL;

export class WhatsappDeliveryService {
  getProvider() {
    return getProvider();
  }

  async sendMessage(phoneNumber: string, message: string): Promise<boolean> {
    if (!phoneNumber || !message) return false;
    const dialablePhone = toDialablePhoneNumber(phoneNumber);
    if (!dialablePhone) return false;

    if (getProvider() === 'local_browser') {
      const { whatsappService } = await import('./WhatsappService');
      return whatsappService.sendMessage(dialablePhone, message);
    }

    const response = await fetch(`${getBaseUrl()}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: dialablePhone, message })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`wpp-service respondió ${response.status}: ${errorText}`);
    }

    return true;
  }

  async getStatus(): Promise<WhatsappRuntimeStatus> {
    if (getProvider() === 'local_browser') {
      const { whatsappService } = await import('./WhatsappService');
      return {
        ...whatsappService.getStatus(),
        provider: 'local_browser'
      };
    }

    try {
      const response = await fetch(`${getBaseUrl()}/status`);
      if (!response.ok) {
        return {
          ready: false,
          hasQR: false,
          disabled: false,
          provider: 'wpp_http'
        };
      }

      const payload = await response.json() as { ready?: boolean };
      return {
        ready: Boolean(payload.ready),
        hasQR: false,
        disabled: false,
        provider: 'wpp_http'
      };
    } catch {
      return {
        ready: false,
        hasQR: false,
        disabled: false,
        provider: 'wpp_http'
      };
    }
  }

  async getQr(): Promise<string | null> {
    if (getProvider() !== 'local_browser') return null;
    const { whatsappService } = await import('./WhatsappService');
    return whatsappService.getQR();
  }
}
