import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePasswordChange } from '../utils/passwordChange';

test('campos vacíos reciben mensajes individuales', () => {
  assert.deepEqual(Object.keys(validatePasswordChange({ currentPassword: '', newPassword: '', confirmation: '' })),
    ['currentPassword', 'newPassword', 'confirmation']);
});

test('exige nueva contraseña distinta y confirmación coincidente', () => {
  assert.ok(validatePasswordChange({ currentPassword: 'Anterior2026!', newPassword: 'Anterior2026!', confirmation: 'Anterior2026!' }).newPassword);
  assert.ok(validatePasswordChange({ currentPassword: 'Anterior2026!', newPassword: 'Nueva2026!', confirmation: 'Otra2026!' }).confirmation);
  assert.ok(validatePasswordChange({ currentPassword: 'Anterior2026!', newPassword: 'corta', confirmation: 'corta' }).newPassword);
});

test('límite nuevo coincide con API en bytes UTF-8, sin truncar caracteres', () => {
  for (const newPassword of ['a'.repeat(8), 'a'.repeat(72), 'é'.repeat(36), '🔑'.repeat(18)]) {
    assert.deepEqual(validatePasswordChange({ currentPassword: 'Anterior2026!', newPassword, confirmation: newPassword }), {});
  }
  for (const newPassword of ['a'.repeat(73), 'é'.repeat(37), '🔑'.repeat(19)]) {
    assert.ok(validatePasswordChange({ currentPassword: 'Anterior2026!', newPassword, confirmation: newPassword }).newPassword);
  }
});

test('acepta contraseñas actuales heredadas hasta límite de API, sin exigir política nueva', () => {
  for (const currentPassword of ['corta', 'a'.repeat(256)]) {
    assert.deepEqual(validatePasswordChange({ currentPassword, newPassword: 'Nueva2026!', confirmation: 'Nueva2026!' }), {});
  }
  assert.ok(validatePasswordChange({ currentPassword: 'a'.repeat(257), newPassword: 'Nueva2026!', confirmation: 'Nueva2026!' }).currentPassword);
});

test('espacios forman parte de contraseña y confirmación', () => {
  const values = { currentPassword: 'Anterior2026!', newPassword: ' Nueva2026! ', confirmation: ' Nueva2026! ' };
  const before = { ...values };
  assert.deepEqual(validatePasswordChange(values), {});
  assert.deepEqual(values, before);
  assert.ok(validatePasswordChange({ ...values, confirmation: 'Nueva2026!' }).confirmation);
});
