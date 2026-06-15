import test from 'node:test';
import assert from 'node:assert/strict';

const modulePath = '../src/utils/authConfig';

const loadAuthConfig = () => {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath).authConfig as {
    cookieSameSite: 'lax' | 'strict' | 'none';
    cookieSecure: boolean;
  };
};

test('permite configurar cookies cross-site seguras para smoke HTTPS', () => {
  const previousSameSite = process.env.AUTH_COOKIE_SAMESITE;
  const previousSecure = process.env.AUTH_COOKIE_SECURE;
  const previousNodeEnv = process.env.NODE_ENV;

  process.env.NODE_ENV = 'development';
  process.env.AUTH_COOKIE_SAMESITE = 'none';
  process.env.AUTH_COOKIE_SECURE = 'true';

  const authConfig = loadAuthConfig();

  assert.equal(authConfig.cookieSameSite, 'none');
  assert.equal(authConfig.cookieSecure, true);

  process.env.AUTH_COOKIE_SAMESITE = previousSameSite;
  process.env.AUTH_COOKIE_SECURE = previousSecure;
  process.env.NODE_ENV = previousNodeEnv;
});

test('rechaza SameSite=None sin Secure', () => {
  const previousSameSite = process.env.AUTH_COOKIE_SAMESITE;
  const previousSecure = process.env.AUTH_COOKIE_SECURE;
  const previousNodeEnv = process.env.NODE_ENV;

  process.env.NODE_ENV = 'development';
  process.env.AUTH_COOKIE_SAMESITE = 'none';
  process.env.AUTH_COOKIE_SECURE = 'false';

  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];

  assert.throws(
    () => require(modulePath),
    /SameSite=None requires AUTH_COOKIE_SECURE=true/
  );

  process.env.AUTH_COOKIE_SAMESITE = previousSameSite;
  process.env.AUTH_COOKIE_SECURE = previousSecure;
  process.env.NODE_ENV = previousNodeEnv;
});
