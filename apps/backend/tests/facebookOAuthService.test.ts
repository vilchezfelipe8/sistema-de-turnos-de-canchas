import test from 'node:test';
import assert from 'node:assert/strict';
import { FacebookOAuthService } from '../src/services/FacebookOAuthService';

const ORIGINAL_ENV = {
  clientId: process.env.FACEBOOK_OAUTH_CLIENT_ID,
  clientSecret: process.env.FACEBOOK_OAUTH_CLIENT_SECRET,
  redirectUri: process.env.FACEBOOK_OAUTH_REDIRECT_URI,
  scopes: process.env.FACEBOOK_OAUTH_SCOPES,
  graphVersion: process.env.FACEBOOK_OAUTH_GRAPH_VERSION
};

const restoreEnv = () => {
  process.env.FACEBOOK_OAUTH_CLIENT_ID = ORIGINAL_ENV.clientId;
  process.env.FACEBOOK_OAUTH_CLIENT_SECRET = ORIGINAL_ENV.clientSecret;
  process.env.FACEBOOK_OAUTH_REDIRECT_URI = ORIGINAL_ENV.redirectUri;
  process.env.FACEBOOK_OAUTH_SCOPES = ORIGINAL_ENV.scopes;
  process.env.FACEBOOK_OAUTH_GRAPH_VERSION = ORIGINAL_ENV.graphVersion;
};

test.afterEach(() => {
  restoreEnv();
});

test('FacebookOAuthService normalizeReturnTo only accepts internal paths', () => {
  const service = new FacebookOAuthService();
  assert.equal(service.normalizeReturnTo('/perfil'), '/perfil');
  assert.equal(service.normalizeReturnTo('/bookings?tab=upcoming'), '/bookings?tab=upcoming');
  assert.equal(service.normalizeReturnTo('https://evil.test'), '/');
  assert.equal(service.normalizeReturnTo('//evil.test'), '/');
  assert.equal(service.normalizeReturnTo('bookings'), '/');
});

test('FacebookOAuthService state roundtrip preserves connect intent', async () => {
  const service = new FacebookOAuthService();
  const state = await service.createState('/perfil', 'connect');
  const result = await service.inspectState(state);
  assert.equal(result.returnTo, '/perfil');
  assert.equal(result.intent, 'connect');
  const consumed = await service.consumeState(state);
  assert.equal(consumed.returnTo, '/perfil');
  assert.equal(consumed.intent, 'connect');
});

test('FacebookOAuthService buildAuthorizationUrl uses configured redirect and scopes', async () => {
  process.env.FACEBOOK_OAUTH_CLIENT_ID = '123456789012345';
  process.env.FACEBOOK_OAUTH_CLIENT_SECRET = 'secret-facebook';
  process.env.FACEBOOK_OAUTH_REDIRECT_URI = 'http://localhost:3000/api/auth/oauth/facebook/callback';
  process.env.FACEBOOK_OAUTH_SCOPES = 'email public_profile';
  process.env.FACEBOOK_OAUTH_GRAPH_VERSION = 'v19.0';

  const service = new FacebookOAuthService();
  const url = new URL(await service.buildAuthorizationUrl('facebook-state-token'));
  assert.equal(url.origin + url.pathname, 'https://www.facebook.com/v19.0/dialog/oauth');
  assert.equal(url.searchParams.get('client_id'), '123456789012345');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/api/auth/oauth/facebook/callback');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'email,public_profile');
  assert.equal(url.searchParams.get('state'), 'facebook-state-token');
});
