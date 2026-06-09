import test from 'node:test';
import assert from 'node:assert/strict';
import { AppleOAuthService } from '../src/services/AppleOAuthService';

const ORIGINAL_ENV = {
  clientId: process.env.APPLE_OAUTH_CLIENT_ID,
  teamId: process.env.APPLE_OAUTH_TEAM_ID,
  keyId: process.env.APPLE_OAUTH_KEY_ID,
  privateKey: process.env.APPLE_OAUTH_PRIVATE_KEY,
  redirectUri: process.env.APPLE_OAUTH_REDIRECT_URI,
  scopes: process.env.APPLE_OAUTH_SCOPES
};

const restoreEnv = () => {
  process.env.APPLE_OAUTH_CLIENT_ID = ORIGINAL_ENV.clientId;
  process.env.APPLE_OAUTH_TEAM_ID = ORIGINAL_ENV.teamId;
  process.env.APPLE_OAUTH_KEY_ID = ORIGINAL_ENV.keyId;
  process.env.APPLE_OAUTH_PRIVATE_KEY = ORIGINAL_ENV.privateKey;
  process.env.APPLE_OAUTH_REDIRECT_URI = ORIGINAL_ENV.redirectUri;
  process.env.APPLE_OAUTH_SCOPES = ORIGINAL_ENV.scopes;
};

test.afterEach(() => {
  restoreEnv();
});

test('AppleOAuthService normalizeReturnTo only accepts internal paths', () => {
  const service = new AppleOAuthService();
  assert.equal(service.normalizeReturnTo('/perfil'), '/perfil');
  assert.equal(service.normalizeReturnTo('/bookings?tab=upcoming'), '/bookings?tab=upcoming');
  assert.equal(service.normalizeReturnTo('https://evil.test'), '/');
  assert.equal(service.normalizeReturnTo('//evil.test'), '/');
  assert.equal(service.normalizeReturnTo('bookings'), '/');
});

test('AppleOAuthService state roundtrip preserves connect intent', async () => {
  const service = new AppleOAuthService();
  const state = await service.createState('/perfil', 'connect');
  const result = await service.inspectState(state);
  assert.equal(result.returnTo, '/perfil');
  assert.equal(result.intent, 'connect');
  const consumed = await service.consumeState(state);
  assert.equal(consumed.returnTo, '/perfil');
  assert.equal(consumed.intent, 'connect');
});

test('AppleOAuthService buildAuthorizationUrl uses form_post and configured redirect', async () => {
  process.env.APPLE_OAUTH_CLIENT_ID = 'com.pique.web';
  process.env.APPLE_OAUTH_TEAM_ID = 'TEAM123456';
  process.env.APPLE_OAUTH_KEY_ID = 'KEY123456';
  process.env.APPLE_OAUTH_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----';
  process.env.APPLE_OAUTH_REDIRECT_URI = 'http://localhost:3000/api/auth/oauth/apple/callback';
  process.env.APPLE_OAUTH_SCOPES = 'name email';

  const service = new AppleOAuthService();
  const url = new URL(await service.buildAuthorizationUrl('apple-state-token'));
  assert.equal(url.origin + url.pathname, 'https://appleid.apple.com/auth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'com.pique.web');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/api/auth/oauth/apple/callback');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('response_mode'), 'form_post');
  assert.equal(url.searchParams.get('scope'), 'name email');
  assert.equal(url.searchParams.get('state'), 'apple-state-token');
});
