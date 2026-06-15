import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

import { authEmailServiceInternals } from '../src/services/AuthEmailService';

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
