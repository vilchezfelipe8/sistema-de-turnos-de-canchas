import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('cancelBooking reutiliza refundBookingPaymentsTx', () => {
  const bookingServicePath = path.resolve(__dirname, '../src/services/BookingService.ts');
  const content = fs.readFileSync(bookingServicePath, 'utf8');
  assert.match(content, /refundService\.refundBookingPaymentsTx\(/);
});
