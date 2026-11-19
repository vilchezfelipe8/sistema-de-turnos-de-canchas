// Agente local del molinete (tools/molinete): abre el molinete y lee huellas.
// Corre en la misma PC que el kiosco, en http://127.0.0.1:7788.

export type AgentHealth = {
  ok: boolean;
  version: string;
  relay: string;
  lastOpenAt: string | null;
  lastError: string | null;
  fingerprint?: { type: string; ready: boolean; error: string | null; templates: number; syncedAt: string | null; seq: number };
};

export type FingerprintEvent = { seq: number; kind: 'match' | 'unknown'; fingerprintId?: string; score?: number; at: string };

export type EnrollState = {
  active: boolean;
  step: number;
  needed: number;
  template: string | null;
  format: string;
  error: string | null;
};

const NOT_RUNNING = 'No responde. Revisá que el agente esté corriendo en esta PC.';

export const agentBase = (url: string) => url.trim().replace(/\/+$/, '');

/** Pedido al agente con tope de tiempo: si no contesta, el kiosco sigue. */
export const callAgent = async <T = any>(url: string, path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown, timeoutMs = 3000): Promise<T> => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${agentBase(url)}${path}`, {
      method,
      signal: controller.signal,
      cache: 'no-store',
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    }).catch(() => {
      throw new Error(NOT_RUNNING);
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) throw new Error(data?.error || `El agente respondió ${res.status}`);
    return data as T;
  } finally {
    window.clearTimeout(timer);
  }
};

export const hasFingerprintReader = (health: AgentHealth | null) => Boolean(health?.fingerprint && health.fingerprint.type !== 'none');
