import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseApiErrorPayload } from '../utils/apiError';
import { BOOKING_ERROR_BEHAVIOR_BY_CODE } from '../utils/bookingErrorMap';

const readBackendErrorCodes = () => {
  const source = readFileSync(
    resolve(__dirname, '../../backend/src/errors/errorCodes.ts'),
    'utf8',
  );
  return new Set(
    Array.from(source.matchAll(/:\s*'([A-Z0-9_]+)'/g)).map((match) => match[1]),
  );
};

describe('frontend apiError — AppError payload', () => {
  test('lee code, message, meta y fieldErrors desde payload AppError raíz', () => {
    const parsed = parseApiErrorPayload(
      {
        error: 'Datos inválidos.',
        code: 'VALIDATION_ERROR',
        fieldErrors: { phone: 'Teléfono requerido', empty: '' },
        meta: { source: 'booking' },
      },
      'Fallback',
    );

    assert.equal(parsed.message, 'Datos inválidos.');
    assert.equal(parsed.code, 'VALIDATION_ERROR');
    assert.deepEqual(parsed.fieldErrors, { phone: 'Teléfono requerido' });
    assert.deepEqual(parsed.meta, { source: 'booking' });
  });

  test('lee payload AppError anidado legacy-compatible', () => {
    const parsed = parseApiErrorPayload(
      {
        error: {
          message: 'Ya existe un cliente parecido.',
          code: 'CLIENT_POSSIBLE_DUPLICATE',
          fieldErrors: { owner: 'Revisá el titular.' },
          meta: { candidates: [{ id: 1 }] },
        },
      },
      'Fallback',
    );

    assert.equal(parsed.message, 'Ya existe un cliente parecido.');
    assert.equal(parsed.code, 'CLIENT_POSSIBLE_DUPLICATE');
    assert.deepEqual(parsed.fieldErrors, { owner: 'Revisá el titular.' });
    assert.deepEqual(parsed.meta, { candidates: [{ id: 1 }] });
  });
});

describe('frontend bookingErrorMap — sincronía con backend ErrorCodes', () => {
  test('todos los codes mapeados existen en el catálogo backend', () => {
    const backendCodes = readBackendErrorCodes();
    const frontendCodes = Object.keys(BOOKING_ERROR_BEHAVIOR_BY_CODE);

    for (const code of frontendCodes) {
      assert.ok(backendCodes.has(code as any), `${code} no existe en backend ErrorCodes`);
    }
  });
});
