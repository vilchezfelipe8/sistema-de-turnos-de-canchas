import React from 'react';
import ClientsPage from '../ClientsPage';
import { Users } from 'lucide-react';
import AdminDuplicateIncidents from './AdminDuplicateIncidents';

export default function AdminTabClients() {
  return (
    // CONTENEDOR PRINCIPAL: Tarjeta Beige sólida con bordes blancos y sombra profunda
    <div className="density-compact bg-[#EBE1D8] border-4 border-white rounded-[1.5rem] p-5 mb-6 shadow-2xl shadow-[#347048]/30 relative overflow-hidden transition-all">
      
      {/* ENCABEZADO DE LA SECCIÓN */}
      <div className="mb-5 pb-4 border-b border-[#347048]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-[#926699] flex items-center gap-3 uppercase italic tracking-tight">
            <div className="bg-[#926699] text-[#EBE1D8] p-2 rounded-xl shadow-lg shadow-[#926699]/20">
              <Users size={24} strokeWidth={3} />
            </div>
            Gestión de Clientes
          </h2>
          <p className="text-[#347048] text-sm font-bold opacity-70 mt-2 ml-1">
            Base de datos de personas que han reservado en el club.
          </p>
        </div>
      </div>

      {/* Aviso: ClientsPage recibirá estos nuevos estilos del contenedor padre. 
          Asegurate de que las tablas dentro de ClientsPage usen fondos blancos/transparentes 
          para que se luzcan sobre este beige.
      */}
      <div className="relative z-10">
        <ClientsPage />
      </div>

      <div className="relative z-10 mt-7 pt-5 border-t border-[#347048]/15">
        <AdminDuplicateIncidents />
      </div>

      {/* DECORACIÓN SUTIL DE MARCA (Opcional, en la esquina inferior) */}
      <div className="absolute -bottom-6 -right-6 text-[#347048]/5 pointer-events-none rotate-12">
          <span className="text-9xl font-black italic uppercase tracking-tighter">Club</span>
      </div>
    </div>
  );
}
