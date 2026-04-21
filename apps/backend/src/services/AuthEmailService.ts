import { Resend } from 'resend';

const getRequiredEnv = (key: 'RESEND_API_KEY' | 'EMAIL_FROM') => {
  const value = String(process.env[key] || '').trim();
  if (!value) {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
};

export class AuthEmailService {
  private readonly resend: Resend;
  private readonly from: string;

  constructor() {
    this.resend = new Resend(getRequiredEnv('RESEND_API_KEY'));
    this.from = getRequiredEnv('EMAIL_FROM');
  }

  async sendMagicLink(email: string, url: string, ttlMinutes: number): Promise<void> {
    const safeTtl = Math.max(1, Math.floor(ttlMinutes));
    const subject = 'Tu enlace de acceso a TuCancha';
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
        <h2 style="margin-bottom: 12px;">Ingresá a TuCancha</h2>
        <p>Recibimos una solicitud para iniciar sesión con este correo.</p>
        <p>
          <a
            href="${url}"
            style="display: inline-block; background: #347048; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 8px; font-weight: 700;"
          >
            Ingresar con enlace seguro
          </a>
        </p>
        <p>Este enlace vence en <strong>${safeTtl} minuto${safeTtl === 1 ? '' : 's'}</strong> y solo puede usarse una vez.</p>
        <p>Si no pediste este acceso, podés ignorar este correo.</p>
      </div>
    `;

    await this.resend.emails.send({
      from: this.from,
      to: email,
      subject,
      html
    });
  }
}
