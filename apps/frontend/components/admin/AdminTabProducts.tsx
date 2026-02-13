import ProductsPage from '../ProductsPage';

interface AdminTabProductsProps {
  clubSlug?: string;
}

export default function AdminTabProducts({ clubSlug }: AdminTabProductsProps) {
  return (
    // CONTENEDOR PRINCIPAL: Tarjeta Beige Wimbledon con borde blanco y sombra
    <div className="bg-[#EBE1D8] border-4 border-white rounded-[2rem] p-8 mb-8 shadow-2xl shadow-[#347048]/30 relative overflow-hidden transition-all">
      
      {/* ENCABEZADO DE LA SECCIÓN */}
      <div className="mb-8 pb-6 border-b border-[#347048]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#926699] flex items-center gap-3 uppercase italic tracking-tight">
            <span className="bg-[#926699] text-[#EBE1D8] p-2 rounded-xl text-xl shadow-lg shadow-[#926699]/20">
              📦
            </span>
            Gestión de Stock
          </h2>
          <p className="text-[#347048] text-sm font-bold opacity-70 mt-2 ml-1">
            Control de productos y consumos del club.
          </p>
        </div>

        {/* Badge de estado Lima para coherencia visual */}
        <div className="hidden sm:block">
           <span className="bg-[#B9CF32] text-[#347048] text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-[0.15em] shadow-sm">
             Inventario en Tiempo Real
           </span>
        </div>
      </div>

      {/* RENDERIZADO DEL CONTENIDO */}
      <div className="relative z-10">
        {!clubSlug ? (
          <div className="flex items-center justify-center py-10">
             <div className="animate-spin rounded-full h-8 w-8 border-b-4 border-[#347048]"></div>
             <span className="ml-3 text-[#347048] font-bold uppercase tracking-widest text-xs">Cargando club...</span>
          </div>
        ) : (
          <ProductsPage slug={clubSlug} />
        )}
      </div>

      {/* DETALLE DECORATIVO DE FONDO */}
      <div className="absolute -bottom-6 -right-6 text-[#347048]/5 pointer-events-none rotate-12">
          <span className="text-9xl font-black italic uppercase tracking-tighter">Stock</span>
      </div>
    </div>
  );
}