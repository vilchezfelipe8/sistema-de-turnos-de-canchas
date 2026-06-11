import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleOAuthService } from '../src/services/GoogleOAuthService';

const ORIGINAL_ENV = {
  clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
  scopes: process.env.GOOGLE_OAUTH_SCOPES,
  jwtSecret: process.env.JWT_SECRET
};

const restoreEnv = () => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = ORIGINAL_ENV.clientId;
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = ORIGINAL_ENV.clientSecret;
  process.env.GOOGLE_OAUTH_REDIRECT_URI = ORIGINAL_ENV.redirectUri;
  process.env.GOOGLE_OAUTH_SCOPES = ORIGINAL_ENV.scopes;
  process.env.JWT_SECRET = ORIGINAL_ENV.jwtSecret;
};

test.afterEach(() => {
  restoreEnv();
});

test('GoogleOAuthService normalizeReturnTo only accepts internal paths', () => {
  const service = new GoogleOAuthService();
  assert.equal(service.normalizeReturnTo('/perfil'), '/perfil');
  assert.equal(service.normalizeReturnTo('/admin/agenda?view=week'), '/admin/agenda?view=week');
  assert.equal(service.normalizeReturnTo('https://evil.test'), '/');
  assert.equal(service.normalizeReturnTo('//evil.test'), '/');
  assert.equal(service.normalizeReturnTo('bookings'), '/');
});

test('GoogleOAuthService createStateToken and verifyStateToken roundtrip returnTo', () => {
  process.env.JWT_SECRET = 'google-oauth-test-secret';
  const service = new GoogleOAuthService();
  const state = service.createStateToken('/bookings?tab=upcoming');
  const result = service.verifyStateToken(state, state);
  assert.equal(result.returnTo, '/bookings?tab=upcoming');
  assert.equal(result.intent, 'login');
});

test('GoogleOAuthService createStateToken keeps connect intent', () => {
  process.env.JWT_SECRET = 'google-oauth-test-secret';
  const service = new GoogleOAuthService();
  const state = service.createStateToken('/perfil', 'connect');
  const result = service.verifyStateToken(state, state);
  assert.equal(result.returnTo, '/perfil');
  assert.equal(result.intent, 'connect');
});

test('GoogleOAuthService buildAuthorizationUrl uses discovery and configured redirect', async () => {
  process.env.JWT_SECRET = 'google-oauth-test-secret';
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id.apps.googleusercontent.com';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret';
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:3000/api/auth/oauth/google/callback';
  process.env.GOOGLE_OAUTH_SCOPES = 'openid email profile';

  const service = new GoogleOAuthService(async (input: any) => {
    assert.equal(String(input), 'https://accounts.google.com/.well-known/openid-configuration');
    return {
      ok: true,
      json: async () => ({
        authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_endpoint: 'https://oauth2.googleapis.com/token',
        userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo'
      })
    } as Response;
  });

  const url = new URL(await service.buildAuthorizationUrl('state-token'));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), 'client-id.apps.googleusercontent.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/api/auth/oauth/google/callback');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('state'), 'state-token');
  assert.equal(url.searchParams.get('prompt'), 'select_account');
});
