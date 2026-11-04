import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPerPlayerHoverParticipants } from '../src/services/BookingService';

test('hover de reserva por jugador usa importe real de cada lugar', () => {
  const participants = buildPerPlayerHoverParticipants({
    client: { id: 'client-owner', name: 'Francisco López Mora' },
    participants: [
      { id: 'participant-owner', role: 'ORGANIZER', displayName: 'Francisco López Mora' },
      { id: 'participant-guest', role: 'PARTICIPANT', displayName: 'Admin B.' }
    ],
    playerSlots: [
      {
        slotIndex: 1,
        participantId: 'participant-owner',
        clientId: 'client-owner',
        userId: 10,
        displayName: 'Francisco López Mora',
        shareAmount: 10000,
        accountItem: { total: 10000, paymentAllocations: [] }
      },
      {
        slotIndex: 2,
        participantId: 'participant-guest',
        clientId: 'client-guest',
        userId: 20,
        displayName: 'Admin B.',
        shareAmount: 10000,
        accountItem: { total: 10000, paymentAllocations: [{ amount: 2500 }] }
      }
    ]
  });

  assert.deepEqual(participants, [
    {
      ref: 'booking-client:client-owner',
      name: 'Francisco López Mora',
      isOwner: true,
      assignedAmount: 10000,
      paidAmount: 0
    },
    {
      ref: 'participant-client:client-guest',
      name: 'Admin B.',
      isOwner: false,
      assignedAmount: 10000,
      paidAmount: 2500
    }
  ]);
});
