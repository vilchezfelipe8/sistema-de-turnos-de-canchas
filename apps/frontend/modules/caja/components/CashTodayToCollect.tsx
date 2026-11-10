const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-AR')}`;

export type CashTodayItem = {
  id: string;
  /** "10:00–11:30" o vacío si no es una reserva. */
  time: string;
  who: string;
  /** "Reserva · Cancha 1", "Consumos"… */
  what: string;
  owes: number;
};

type CashTodayToCollectProps = {
  items: CashTodayItem[];
  /** Lo que quedó debiendo de días anteriores. */
  olderDebt: { count: number; amount: number };
  loading?: boolean;
  onPay: (accountId: string) => void;
  onSeeAccounts: () => void;
};

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** Resumen de Caja: qué hay que cobrar hoy y cuánto quedó debiendo de antes. */
export default function CashTodayToCollect({ items, olderDebt, loading = false, onPay, onSeeAccounts }: CashTodayToCollectProps) {
  const todayTotal = items.reduce((sum, item) => sum + item.owes, 0);

  return (
    <section className="w-full rounded-2xl border border-p-border bg-p-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-4">
        <h2 className="text-[15px] font-bold text-p-text">
          {loading
            ? 'Cargando lo que hay que cobrar...'
            : items.length === 0
              ? 'Hoy no queda nada por cobrar'
              : `Hoy hay que cobrar ${formatMoney(todayTotal)}`}
        </h2>
        {!loading && items.length > 0 && (
          <span className="text-[12px] text-p-text-muted">
            {items.length} {plural(items.length, 'cuenta', 'cuentas')}
          </span>
        )}
      </div>

      {!loading && items.length === 0 && (
        <p className="px-4 pt-1 text-[13px] text-p-text-muted">Todo lo de hoy está pago o no hay turnos con deuda.</p>
      )}

      {items.length > 0 && (
        <ul className="mt-2 divide-y divide-p-border border-t border-p-border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
              {item.time ? (
                <span className="hidden w-[88px] flex-none text-[13px] font-semibold tabular-nums text-p-text-secondary sm:block">
                  {item.time}
                </span>
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-p-text">{item.who}</p>
                <p className="truncate text-[12px] text-p-text-muted">
                  {item.time ? <span className="font-semibold tabular-nums text-p-text-secondary sm:hidden">{item.time} · </span> : null}
                  {item.what}
                </p>
              </div>
              <span className="flex-none text-[13px] font-bold tabular-nums text-p-warning">{formatMoney(item.owes)}</span>
              <button
                type="button"
                onClick={() => onPay(item.id)}
                className="h-8 flex-none rounded-lg bg-ink-900 px-3 text-[12px] font-semibold text-ink-50 hover:bg-ink-800"
              >
                Cobrar
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 border-t border-p-border px-4 py-3">
        {olderDebt.count > 0 ? (
          <button
            type="button"
            onClick={onSeeAccounts}
            className="flex w-full items-center justify-between gap-3 text-left text-[13px]"
          >
            <span className="text-p-text-secondary">
              De días anteriores te deben{' '}
              <span className="font-bold text-p-warning">{formatMoney(olderDebt.amount)}</span> en {olderDebt.count}{' '}
              {plural(olderDebt.count, 'cuenta', 'cuentas')}.
            </span>
            <span className="flex-none font-semibold text-p-accent">Ver →</span>
          </button>
        ) : (
          <p className="text-[13px] text-p-text-muted">{loading ? '' : 'Nadie quedó debiendo de días anteriores.'}</p>
        )}
      </div>
    </section>
  );
}
