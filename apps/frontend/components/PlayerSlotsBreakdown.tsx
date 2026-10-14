import { useEffect, useState } from 'react';
import { PlayerPricingService, type PlayerSlotView } from '../services/PlayerPricingService';
import { reportUiError } from '../utils/uiError';

type PlayerSlotsBreakdownProps = {
  bookingId: number | string;
  // Cambia cuando cambian los participantes (invitar, aceptar, quitar).
  refreshKey?: unknown;
};

const formatMoney = (amount: number) => `$${Number(amount || 0).toLocaleString('es-AR')}`;

// Mis reservas: lugares de un turno con precio por jugador. Cada jugador ve su propia categoría;
// de los demás, solo el nombre abreviado y el monto (P13). No se muestra si el turno es por cancha.
export default function PlayerSlotsBreakdown({ bookingId, refreshKey }: PlayerSlotsBreakdownProps) {
  const [data, setData] = useState<{ formatName: string | null; slots: PlayerSlotView[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    PlayerPricingService.getMyBookingSlots(bookingId)
      .then((result) => {
        if (cancelled) return;
        setData(result.perPlayer ? { formatName: result.activityFormat?.name ?? null, slots: result.slots } : null);
      })
      .catch((err) => reportUiError({ area: 'PlayerSlotsBreakdown', action: 'load' }, err));
    return () => {
      cancelled = true;
    };
  }, [bookingId, refreshKey]);

  if (!data || data.slots.length === 0) return null;
  const mine = data.slots.find((slot) => slot.isMine);
  const total = data.slots.reduce((sum, slot) => sum + slot.shareAmount, 0);

  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.03em', color: 'var(--text-muted)' }}>
        Jugadores{data.formatName ? ` · ${data.formatName}` : ''}
      </div>
      {mine ? (
        <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
          Tu parte: {formatMoney(mine.shareAmount)}
          {mine.memberCategoryName ? ` · Precio socio ${mine.memberCategoryName}` : ''}
          {mine.memberPricePending ? ' · Tu precio socio está pendiente: aceptá la invitación o validalo en el club' : ''}
          {mine.paid ? ' · Pagada' : ' · Se abona en el club'}
        </div>
      ) : null}
      <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
        {data.slots.map((slot) => (
          <div key={slot.slotIndex} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)' }}>
            <span>
              {slot.slotIndex}. {slot.isEmpty ? 'Lugar a confirmar' : slot.isMine ? 'Vos' : slot.displayName || 'Jugador'}
              {slot.paid ? ' · pagado' : ''}
            </span>
            <span style={{ fontWeight: 700 }}>{formatMoney(slot.shareAmount)}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>
        <span>Total del turno</span>
        <span>{formatMoney(total)}</span>
      </div>
    </div>
  );
}
