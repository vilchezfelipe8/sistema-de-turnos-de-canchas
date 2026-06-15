import test from 'node:test';
import assert from 'node:assert/strict';
import { ClubController } from '../src/controllers/ClubController';

function createResponse() {
  const response: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(payload: any) {
      response.body = payload;
      return response;
    }
  };
  return response;
}

test('getClubClientsList usa búsqueda de clients y no la búsqueda mixta de participantes', async () => {
  let getClientsCalls = 0;
  let searchParticipantsCalls = 0;
  const controller = new ClubController({
    getClients: async () => {
      getClientsCalls += 1;
      return [{ id: 'client-1', name: 'Admin Las Tejas' }];
    },
    searchParticipants: async () => {
      searchParticipantsCalls += 1;
      return [{ id: 'user-1', name: 'Admin Las Tejas', sourceType: 'systemUser' }];
    }
  } as any);

  const req: any = {
    club: { id: 5, slug: 'las-tejas' },
    query: { q: 'admin' }
  };
  const res = createResponse();

  await controller.getClubClientsList(req, res as any);

  assert.equal(getClientsCalls, 1);
  assert.equal(searchParticipantsCalls, 0);
  assert.deepEqual(res.body, [{ id: 'client-1', name: 'Admin Las Tejas' }]);
});
