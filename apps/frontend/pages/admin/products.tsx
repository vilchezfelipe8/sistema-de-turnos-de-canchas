// apps/frontend/pages/admin/products.tsx
import React from 'react';
import AdminLayout from '../../components/AdminLayout';

export default function ProductsTest() {
  return (
    //<AdminLayout>
      <div style={{ backgroundColor: 'red', color: 'white', padding: '50px', height: '100vh' }}>
        <h1>SI VES ESTO, EL CULPABLE ES EL LAYOUT</h1>
        <p>La ruta funciona, pero el menú te estaba echando.</p>
        <a href="/admin/agenda" style={{color: 'yellow'}}>Volver</a>
      </div>
    //</AdminLayout>
  );
}