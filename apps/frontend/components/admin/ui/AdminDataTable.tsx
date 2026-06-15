import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminDataTableColumn<T> = {
  key: string;
  label: string;
  /** Tailwind width class, e.g. 'w-[140px]' or 'w-[30%]'. Optional. */
  width?: string;
  /** Text alignment for header + cells. Default 'left'. */
  align?: 'left' | 'center' | 'right';
  /** Custom renderer. Receives the full row and its index. */
  render?: (row: T, index: number) => ReactNode;
  /** If true, the cell receives the hover-group class so actions can appear/hide. */
  isActions?: boolean;
};

type AdminDataTableProps<T> = {
  columns: AdminDataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  /** Shown when !loading && data.length === 0 */
  empty?: {
    title: string;
    description?: string;
    action?: ReactNode;
  };
  /** Extra class applied to the wrapping <div> */
  className?: string;
  /** Extra class applied to each <tr> */
  rowClassName?: string | ((row: T, index: number) => string);
  /** Called when the user clicks a row (excluding clicks on interactive elements inside) */
  onRowClick?: (row: T) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

const alignClass = (align?: 'left' | 'center' | 'right') => {
  if (align === 'center') return 'text-center';
  if (align === 'right') return 'text-right';
  return 'text-left';
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminDataTable<T>({
  columns,
  data,
  rowKey,
  loading = false,
  empty,
  className,
  rowClassName,
  onRowClick,
}: AdminDataTableProps<T>) {
  const colSpan = columns.length;

  return (
    <div className={cx('w-full overflow-x-auto', className)}>
      <table className="w-full min-w-full border-collapse [border-spacing:0] text-left">
        {/* ── Header ── */}
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-p-border bg-p-surface-2">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cx(
                  'px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-p-text-muted',
                  alignClass(col.align),
                  col.width
                )}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>

        {/* ── Body ── */}
        <tbody className="divide-y divide-p-border text-[13px] text-p-text-secondary">
          {loading ? (
            <tr>
              <td colSpan={colSpan} className="p-14 text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-p-border border-t-p-accent" />
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="p-14 text-center">
                {empty ? (
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-[14px] font-semibold text-p-text-muted">{empty.title}</p>
                    {empty.description && (
                      <p className="text-[12px] text-p-text-muted">{empty.description}</p>
                    )}
                    {empty.action && <div className="mt-2">{empty.action}</div>}
                  </div>
                ) : (
                  <p className="text-[14px] font-semibold text-p-text-muted">Sin resultados</p>
                )}
              </td>
            </tr>
          ) : (
            data.map((row, index) => {
              const extraRowClass =
                typeof rowClassName === 'function'
                  ? rowClassName(row, index)
                  : rowClassName;
              return (
                <tr
                  key={rowKey(row)}
                  className={cx(
                    'group transition-colors hover:bg-p-surface-2',
                    onRowClick && 'cursor-pointer',
                    extraRowClass
                  )}
                  onClick={
                    onRowClick
                      ? (e) => {
                          // Avoid triggering row click when clicking buttons/links
                          const target = e.target as HTMLElement;
                          if (
                            target.closest('button') ||
                            target.closest('a') ||
                            target.closest('[role="button"]')
                          ) {
                            return;
                          }
                          onRowClick(row);
                        }
                      : undefined
                  }
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cx(
                        'px-4 py-3',
                        alignClass(col.align),
                        col.isActions && 'opacity-0 group-hover:opacity-100 transition-opacity'
                      )}
                    >
                      {col.render
                        ? col.render(row, index)
                        : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
