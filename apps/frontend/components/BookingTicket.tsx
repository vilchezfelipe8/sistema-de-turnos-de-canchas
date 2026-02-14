import React from 'react';

interface TicketProps {
  booking: any; // O tu tipo 'Booking' completo si lo tenés importado
  currentItems: any[]; // Los items que estás agregando ahora (carrito)
}

export const BookingTicket: React.FC<TicketProps> = ({ booking, currentItems }) => {
  
  // 1. Precios Base
  const courtPrice = Number(booking.price) || 0;
  const baseCourtPrice = Number(booking.court?.price ?? booking.courtPrice ?? 0);
  const lightsExtra = Math.max(courtPrice - (baseCourtPrice || courtPrice), 0);
  
  // 2. Items YA cargados en base de datos
  const savedItems = booking.items || [];
  const savedItemsTotal = savedItems.reduce((sum: number, item: any) => sum + (Number(item.price) * item.quantity), 0);

  // 3. Items NUEVOS (los que están en el carrito ahora mismo)
  const newItemsTotal = currentItems.reduce((sum: number, item: any) => sum + (Number(item.product.price) * item.quantity), 0);

  // 4. Totales
  const grandTotal = courtPrice + savedItemsTotal + newItemsTotal;

  // 5. Lo que ya pagó (sumando movimientos de caja)
  const totalPaid = (booking.cashMovements || []).reduce((sum: number, mov: any) => sum + Number(mov.amount), 0);

  // 6. Deuda Final
  let remainingDebt = grandTotal - totalPaid;
  if (remainingDebt < 0) remainingDebt = 0; // Por si pagó de más (propina)

  return (
    <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700 font-mono text-sm shadow-inner">
      <div className="text-center mb-4 border-b border-gray-700 pb-2">
        <h3 className="text-white font-bold text-lg">RESUMEN DE CUENTA</h3>
        <p className="text-gray-500 text-xs">Reserva #{booking.id}</p>
      </div>

      {/* DETALLE */}
      <div className="space-y-2 mb-4">
        {/* Cancha */}
        <div className="flex justify-between text-gray-300">
          <span>1x Alquiler Cancha</span>
          <span>${courtPrice}</span>
        </div>
        {lightsExtra > 0 && (
          <div className="flex justify-between text-[11px] text-gray-400">
            <span>Incluye extra por luces</span>
            <span>+ ${lightsExtra}</span>
          </div>
        )}

        {/* Items Guardados */}
        {savedItems.map((item: any) => (
          <div key={`saved-${item.id}`} className="flex justify-between text-gray-400">
            <span>{item.quantity}x {item.product?.name || 'Item'} (Cargado)</span>
            <span>${Number(item.price) * item.quantity}</span>
          </div>
        ))}

        {/* Items Nuevos (Carrito) */}
        {currentItems.map((item: any, idx: number) => (
          <div key={`new-${idx}`} className="flex justify-between text-emerald-400 font-bold">
            <span>{item.quantity}x {item.product.name} (Nuevo)</span>
            <span>${Number(item.product.price) * item.quantity}</span>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-600 my-2 pt-2 space-y-1">
        <div className="flex justify-between text-white font-bold text-lg">
          <span>TOTAL</span>
          <span>${grandTotal}</span>
        </div>

        <div className="flex justify-between text-blue-400">
          <span>Abonado / Seña</span>
          <span>- ${totalPaid}</span>
        </div>
      </div>

      {/* SALDO FINAL */}
      <div className={`mt-4 p-3 rounded-lg text-center border-2 ${remainingDebt > 0 ? 'border-red-500/50 bg-red-900/20' : 'border-emerald-500/50 bg-emerald-900/20'}`}>
        <span className="block text-xs uppercase tracking-widest text-gray-400 mb-1">Saldo a Pagar</span>
        <span className={`text-2xl font-black ${remainingDebt > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
          ${remainingDebt}
        </span>
      </div>
    </div>
  );
};