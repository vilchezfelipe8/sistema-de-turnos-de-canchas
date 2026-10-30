import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-auth-token-types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AuthTokenService } = require('../src/services/AuthTokenService');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { signPlayerInviteToken, verifyPlayerInviteToken } = require('../src/utils/playerInviteToken');

describe('auth token types', () => {
  const tokens = new AuthTokenService();

  test('a session token is accepted', () => {
    const claims = tokens.verifyAccessToken(tokens.signAccessToken({ userId: 7, role: 'MEMBER', sid: 's1' }));
    assert.equal(claims.userId, 7);
  });

  test('an invite token is never accepted as a session', () => {
    const invite = signPlayerInviteToken({ invitedUserId: 7, requesterUserId: 9 });
    assert.throws(() => tokens.verifyAccessToken(invite));
  });

  test('a JWT signed with JWT_SECRET but without a numeric userId is rejected', () => {
    const secret = String(process.env.JWT_SECRET);
    assert.throws(() => tokens.verifyAccessToken(jwt.sign({ typ: 'player-invite', uid: 7, by: 9 }, secret)));
    assert.throws(() => tokens.verifyAccessToken(jwt.sign({ role: 'ADMIN' }, secret)));
    assert.throws(() => tokens.verifyAccessToken(jwt.sign({ userId: '7', role: 'ADMIN' }, secret)));
  });

  test('a session token is never accepted as an invite', () => {
    const session = tokens.signAccessToken({ userId: 7, role: 'MEMBER' });
    assert.equal(verifyPlayerInviteToken(session, 9), null);
  });

  test('an invite token only works for whoever searched', () => {
    const invite = signPlayerInviteToken({ invitedUserId: 7, requesterUserId: 9 });
    assert.equal(verifyPlayerInviteToken(invite, 9), 7);
    assert.equal(verifyPlayerInviteToken(invite, 10), null);
  });
});
