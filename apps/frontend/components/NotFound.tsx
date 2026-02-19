import Link from 'next/link';

interface NotFoundProps {
  /** Título corto (ej: "Página no encontrada") */
  title?: string;
  /** Mensaje opcional debajo del título */
  message?: string;
}

export default function NotFound({ title = '404', message = 'La página que buscás no existe o no tenés permiso para verla.' }: NotFoundProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="text-center max-w-md">
        <p className="text-6xl font-black text-muted/40 mb-4 select-none">404</p>
        <h1 className="text-xl font-bold text-text mb-2">{title}</h1>
        <p className="text-muted text-sm mb-8">{message}</p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all text-text border border-border hover:bg-[var(--surface)]"
        >
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
