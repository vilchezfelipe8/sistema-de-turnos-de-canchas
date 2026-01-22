// Función helper para normalizar la URL del API y evitar barras dobles
export const getApiUrl = (): string => {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  // Remover barra al final si existe
  return apiUrl.replace(/\/+$/, '');
};
