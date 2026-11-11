import Head from 'next/head';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import AdminPlaygroundShell from './AdminPlaygroundShell';

/**
 * Staff (operador) que entra a una sección solo para administradores:
 * se queda dentro del panel, con el menú, y un camino claro para seguir.
 */
export default function AdminNoAccessScreen({ user, activeItem, title }: { user: any; activeItem: string; title?: string }) {
  return (
    <>
      {title ? (
        <Head>
          <title>{title}</title>
        </Head>
      ) : null}
      <AdminPlaygroundShell activeItem={activeItem} user={user}>
        <section className="flex h-full min-h-0 items-center justify-center p-6">
          <div className="max-w-sm text-center">
            <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-p-surface-2 text-p-text-secondary">
              <Lock size={18} />
            </span>
            <h1 className="text-[18px] font-bold text-p-text">Esta parte es solo para administradores</h1>
            <p className="mt-1 text-[13px] text-p-text-muted">
              Con tu usuario podés usar el calendario, la caja y los informes. Si necesitás entrar acá, pedíselo a quien administra el club.
            </p>
            <Link
              href="/admin/agenda"
              className="mt-4 inline-flex h-10 items-center rounded-xl bg-ink-900 px-4 text-[13px] font-semibold !text-ink-50 hover:bg-ink-800"
            >
              Ir al calendario
            </Link>
          </div>
        </section>
      </AdminPlaygroundShell>
    </>
  );
}
