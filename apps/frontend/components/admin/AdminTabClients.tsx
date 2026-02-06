import React from 'react';
import ClientsPage from '../ClientsPage';

export default function AdminTabClients() {
  return (
    <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-8 mb-8 overflow-hidden">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-text flex items-center gap-2">
          <span>👥</span> GESTIÓN DE CLIENTES
        </h2>
        <p className="text-muted text-sm mt-1">Base de datos de personas que han reservado.</p>
      </div>
      <ClientsPage />
    </div>
  );
}
