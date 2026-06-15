import ProductsPage from '../ProductsPage';

interface AdminTabProductsProps {
  clubSlug?: string;
}

export default function AdminTabProducts({ clubSlug }: AdminTabProductsProps) {
  if (!clubSlug) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-p-border bg-p-surface py-10">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-p-border border-t-p-accent" />
        <span className="ml-3 text-[12px] font-semibold text-p-text-muted">
          Cargando club...
        </span>
      </div>
    );
  }
  return <ProductsPage slug={clubSlug} />;
}
