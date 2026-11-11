import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

import { AuthEmailService, authEmailServiceInternals } from '../src/services/AuthEmailService';

test('AuthEmailService tolera ausencia del logo inline', () => {
  const originalReadFileSync = fs.readFileSync;

  authEmailServiceInternals.resetLogoAttachmentCache();
  fs.readFileSync = (() => {
    throw new Error('missing asset');
  }) as typeof fs.readFileSync;

  try {
    assert.equal(authEmailServiceInternals.getInlineLogoAttachment(), null);
  } finally {
    fs.readFileSync = originalReadFileSync;
    authEmailServiceInternals.resetLogoAttachmentCache();
  }
});

test('AuthEmailService prioriza FRONTEND_URL para links públicos', () => {
  const previousFrontendUrl = process.env.FRONTEND_URL;
  const previousAppBaseUrl = process.env.APP_BASE_URL;

  process.env.FRONTEND_URL = 'https://frontend.example.com/';
  process.env.APP_BASE_URL = 'https://backend.example.com/';

  try {
    assert.equal(authEmailServiceInternals.getPublicSiteUrl(), 'https://frontend.example.com');
  } finally {
    process.env.FRONTEND_URL = previousFrontendUrl;
    process.env.APP_BASE_URL = previousAppBaseUrl;
  }
});

test('AuthEmailService exige aceptación del proveedor en enlaces y códigos', async (t) => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.EMAIL_FROM;
  process.env.RESEND_API_KEY = 're_unit_test';
  process.env.EMAIL_FROM = 'Pique <login@example.com>';
  try {
    for (const method of ['magic-link', 'verification-code'] as const) {
      await t.test(method, async () => {
        const service = new AuthEmailService();
        let payload: any;
        let response: any = { data: null, error: { name: 'validation_error', message: 'Domain is not verified' } };
        (service as any).resend = { emails: { send: async (input: any) => { payload = input; return response; } } };
        const send = () => method === 'magic-link'
          ? service.sendMagicLink('recipient@example.com', 'https://pique.ar/login#magic_token=unit-test', 10)
          : service.sendVerificationCode('recipient@example.com', '123456', 10, 'PASSWORD_RESET');
        await assert.rejects(send, /Resend rechazó.*Domain is not verified/);
        response = { data: null, error: null };
        await assert.rejects(send, /identificador de envío/);
        response = { data: { id: 'email-test-id' }, error: null };
        await assert.doesNotReject(send);
        if (method === 'magic-link') assert.match(payload.text, /https:\/\/pique\.ar\/login#magic_token=unit-test/);
      });
    }
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = previousFrom;
  }
});
