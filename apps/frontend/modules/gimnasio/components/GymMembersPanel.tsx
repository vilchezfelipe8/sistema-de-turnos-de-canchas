import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AdminDrawer from '../../../components/admin/ui/AdminDrawer';
import AdminSegmentedControl from '../../../components/admin/ui/AdminSegmentedControl';
import AdminEmptyState from '../../../components/admin/ui/AdminEmptyState';
import { AdminSearchInput } from '../../../components/admin/ui/AdminPersonPicker';
import { AdminFeedbackBanner } from '../../../components/admin/ui/AdminFeedback';
import { adminButton } from '../../../components/admin/ui/adminButton';
import ClientSubscriptionsPanel from '../../../components/admin/subscriptions/ClientSubscriptionsPanel';
import { SubscriptionAdminService, type ClientSubscription } from '../../../services/SubscriptionAdminService';
import { formatMoney } from '../../cuentas/accountUtils';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';

type Filter = 'all' | 'owing' | 'renewing' | 'paused';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'owing', label: 'Deben' },
  { value: 'renewing', label: 'Vencen esta semana' },
  { value: 'paused', label: 'Pausados' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

const parseDay = (iso: string | null) => {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};

const shortDate = (iso: string | null) => {
  const date = parseDay(iso);
  return date ? date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : '';
};

const owes = (row: ClientSubscription) => row.hasOverdue || row.status === 'PAST_DUE';

const renewsSoon = (row: ClientSubscription) => {
  const end = parseDay(row.currentPeriodEnd);
  if (!end || row.status === 'PAUSED') return false;
  const days = (end.getTime() - new Date().setHours(0, 0, 0, 0)) / DAY_MS;
  return days >= 0 && days <= 7;
};

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

type Props = { clubSlug: string; canManage: boolean };

/** Gimnasio → Abonados: quién tiene plan, quién debe y a quién se le vence. */
export default function GymMembersPanel({ clubSlug, canManage }: Props) {
  const [rows, setRows] = useState<ClientSubscription[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    if (!clubSlug) return;
    try {
      setRows(await SubscriptionAdminService.listForClub(clubSlug));
      setError('');
    } catch (err) {
      reportUiError({ area: 'GymMembersPanel', action: 'load' }, err);
      setRows([]);
      setError(extractErrorMessage(err, 'No se pudieron cargar los abonados.'));
    }
  }, [clubSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const list = rows || [];
    return {
      all: list.length,
      owing: list.filter(owes).length,
      renewing: list.filter(renewsSoon).length,
      paused: list.filter((row) => row.status === 'PAUSED').length,
    };
  }, [rows]);

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    return (rows || []).filter((row) => {
      if (filter === 'owing' && !owes(row)) return false;
      if (filter === 'renewing' && !renewsSoon(row)) return false;
      if (filter === 'paused' && row.status !== 'PAUSED') return false;
      if (!needle) return true;
      return normalize(`${row.client.name} ${row.payerClient.name} ${row.planName}`).includes(needle);
    });
  }, [rows, filter, query]);

  if (rows && rows.length === 0 && !error) {
    return (
      <AdminEmptyState
        title="Todavía no hay abonados"
        description="Cuando vendas un plan (desde la ficha del cliente, o el jugador lo compre en la app), aparece acá."
        action={
          <Link href="/admin/ajustes?tab=planes" className={adminButton('secondary', 'md')}>
            Ver planes
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <AdminSegmentedControl
          variant="filter"
          ariaLabel="Filtrar abonados"
          value={filter}
          onChange={(value) => setFilter(value as Filter)}
          options={FILTERS.map((option) => ({
            value: option.value,
            label: option.value === 'all' || !counts[option.value] ? option.label : `${option.label} (${counts[option.value]})`,
          }))}
        />
        <AdminSearchInput
          value={query}
          onChange={setQuery}
          placeholder="Buscar por nombre o plan"
          wrapperClassName="min-w-[220px] flex-1 sm:max-w-xs"
        />
      </div>

      {error ? <AdminFeedbackBanner tone="error">{error}</AdminFeedbackBanner> : null}

      <div className="overflow-hidden rounded-2xl border border-p-border bg-p-surface">
        {!rows ? (
          <p className="px-4 py-6 text-center text-[13px] text-p-text-muted">Cargando...</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-p-text-muted">Nadie en esta lista.</p>
        ) : (
          <ul className="divide-y divide-p-border">
            {visible.map((row) => {
              const owing = owes(row);
              const paused = row.status === 'PAUSED';
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setSelected({ id: row.client.id, name: row.client.name })}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-p-surface-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-p-text">{row.client.name}</p>
                      <p className="truncate text-[12px] text-p-text-muted">
                        {[
                          `${row.planName} · ${row.optionLabel}`,
                          row.payerClient.id !== row.client.id ? `paga ${row.payerClient.name}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <div className="flex-none text-right">
                      {owing ? (
                        <>
                          <p className="text-[13px] font-semibold tabular-nums text-p-warning">Debe {formatMoney(row.pendingAmount)}</p>
                          <p className="text-[11px] text-p-text-muted">
                            {row.paidThrough ? `pagó hasta ${shortDate(row.paidThrough)}` : 'sin pagos'}
                          </p>
                        </>
                      ) : paused ? (
                        <>
                          <p className="text-[13px] font-semibold text-p-text-secondary">Pausado</p>
                          <p className="text-[11px] text-p-text-muted">vence {shortDate(row.currentPeriodEnd)}</p>
                        </>
                      ) : (
                        <>
                          <p className="text-[13px] font-semibold text-p-positive">Al día</p>
                          <p className={`text-[11px] ${renewsSoon(row) ? 'font-semibold text-p-text-secondary' : 'text-p-text-muted'}`}>
                            {row.billingType === 'FIXED_TERM' ? 'termina' : 'renueva'} {shortDate(row.currentPeriodEnd)}
                          </p>
                        </>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <AdminDrawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.name || 'Abonado'} size="md">
        {selected ? (
          <ClientSubscriptionsPanel
            key={`${selected.id}-${version}`}
            clubSlug={clubSlug}
            clientId={selected.id}
            clientName={selected.name}
            canManage={canManage}
            onChanged={() => {
              setVersion((value) => value + 1);
              void load();
            }}
          />
        ) : null}
      </AdminDrawer>
    </div>
  );
}
