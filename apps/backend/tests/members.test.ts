import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeDni, normalizeDni } from '../src/utils/dni';
import { parseImportDate, parseMembersCsv } from '../src/services/MemberImportService';
import { isMemberCurrent, localDateKey } from '../src/services/MemberService';
import { hashVerificationCode } from '../src/services/AccountVerificationService';
import { MetaCloudWhatsappProvider } from '../src/services/MetaCloudWhatsappProvider';

test('normalizeDni deja solo dígitos y valida largo', () => {
  assert.equal(normalizeDni('30.123.456'), '30123456');
  assert.equal(normalizeDni(' 30 123 456 '), '30123456');
  assert.equal(normalizeDni('12345'), null);
  assert.equal(normalizeDni('1234567890'), null);
  assert.equal(normalizeDni(null), null);
  assert.equal(normalizeDni('abc'), null);
});

test('looksLikeDni distingue DNI de email', () => {
  assert.equal(looksLikeDni('30.123.456'), true);
  assert.equal(looksLikeDni('30123456'), true);
  assert.equal(looksLikeDni('juan@mail.com'), false);
  assert.equal(looksLikeDni(''), false);
});

test('parseMembersCsv detecta separador, normaliza encabezados y respeta comillas', () => {
  const rows = parseMembersCsv('﻿Nombre;Apellido;DNI;Teléfono;Categoria\n"Pérez; Juan";Gómez;30.123.456;+5493511234567;Activo\r\n\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nombre, 'Pérez; Juan');
  assert.equal(rows[0].telefono, '+5493511234567');
  assert.equal(rows[0].categoria, 'Activo');

  const comma = parseMembersCsv('nombre,dni\n"Ana ""La"" Ruiz",30111222');
  assert.equal(comma[0].nombre, 'Ana "La" Ruiz');
  assert.equal(comma[0].dni, '30111222');
});

test('parseImportDate acepta AAAA-MM-DD y DD/MM/AAAA', () => {
  assert.deepEqual(parseImportDate('2024-03-01'), { value: '2024-03-01', invalid: false });
  assert.deepEqual(parseImportDate('1/3/2024'), { value: '2024-03-01', invalid: false });
  assert.deepEqual(parseImportDate(''), { value: null, invalid: false });
  assert.equal(parseImportDate('marzo 2024').invalid, true);
});

test('isMemberCurrent aplica RN-01: activo, categoría activa y al día', () => {
  const base = { status: 'ACTIVE' as const, validUntil: null, category: { isActive: true } };
  assert.equal(isMemberCurrent(base, '2026-10-13'), true);
  assert.equal(isMemberCurrent({ ...base, status: 'SUSPENDED' }, '2026-10-13'), false);
  assert.equal(isMemberCurrent({ ...base, status: 'INACTIVE' }, '2026-10-13'), false);
  assert.equal(isMemberCurrent({ ...base, category: { isActive: false } }, '2026-10-13'), false);
  // "al día hasta" se compara contra la fecha del turno, inclusive
  assert.equal(isMemberCurrent({ ...base, validUntil: new Date('2026-10-13T00:00:00.000Z') }, '2026-10-13'), true);
  assert.equal(isMemberCurrent({ ...base, validUntil: new Date('2026-10-12T00:00:00.000Z') }, '2026-10-13'), false);
});

test('localDateKey usa la fecha local del club', () => {
  // 02:00 UTC del 14 = 23:00 del 13 en Buenos Aires
  assert.equal(localDateKey(new Date('2026-10-14T02:00:00.000Z'), 'America/Argentina/Buenos_Aires'), '2026-10-13');
});

test('hashVerificationCode depende del usuario y del código', () => {
  assert.equal(hashVerificationCode(1, '123456'), hashVerificationCode(1, '123456'));
  assert.notEqual(hashVerificationCode(1, '123456'), hashVerificationCode(2, '123456'));
  assert.notEqual(hashVerificationCode(1, '123456'), hashVerificationCode(1, '123457'));
});

test('plantillas de autenticación de Meta incluyen el código en el botón', () => {
  const provider = new MetaCloudWhatsappProvider(async () => new Response('{}'));
  const base = {
    senderId: 's1',
    templateName: 'pique_codigo',
    languageCode: 'es_AR',
    toPhone: '5493511234567',
    recipientRole: 'CUSTOMER' as const,
    eventType: 'ACCOUNT_VERIFICATION_CODE' as const,
    params: { code: '482913' },
    templateParameterOrder: ['code'],
    outboxMessageId: 'o1'
  };

  const auth = provider.buildTemplateRequestBody({ ...base, templateCategory: 'AUTHENTICATION' });
  assert.deepEqual(auth.template.components, [
    { type: 'body', parameters: [{ type: 'text', text: '482913' }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '482913' }] }
  ]);

  const utility = provider.buildTemplateRequestBody({ ...base, templateCategory: 'UTILITY' });
  assert.equal(utility.template.components.length, 1);
});
