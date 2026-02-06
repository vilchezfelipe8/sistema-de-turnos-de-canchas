import ProductsPage from '../ProductsPage';

interface AdminTabProductsProps {
  clubSlug?: string;
}

export default function AdminTabProducts({ clubSlug }: AdminTabProductsProps) {
  return (
    <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-8 mb-8 overflow-hidden">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-text flex items-center gap-2">
          <span>📦</span> GESTIÓN DE STOCK
        </h2>
        <p className="text-muted text-sm mt-1">Productos y consumos del club.</p>
      </div>
      {!clubSlug ? (
        <div className="text-muted">Cargando club...</div>
      ) : (
        <ProductsPage slug={clubSlug} />
      )}
    </div>
  );
}
