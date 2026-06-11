const normalizeUrl = (value: string | undefined) =>
  String(value || '').trim().replace(/\/+$/, '');

const normalizeInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeAllowlist = (value: string | undefined) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export function getWhatsappMetaConfig() {
  return {
    graphApiBaseUrl: normalizeUrl(
      process.env.WHATSAPP_META_GRAPH_API_BASE_URL || 'https://graph.facebook.com'
    ),
    graphApiVersion: String(
      process.env.WHATSAPP_META_GRAPH_API_VERSION || 'v19.0'
    ).trim(),
    requestTimeoutMs: normalizeInt(
      process.env.WHATSAPP_META_REQUEST_TIMEOUT_MS,
      10_000
    ),
    recipientAllowlist: normalizeAllowlist(
      process.env.WHATSAPP_META_RECIPIENT_ALLOWLIST
    ),
    webhookVerifyToken: String(
      process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN || ''
    ).trim()
  };
}
