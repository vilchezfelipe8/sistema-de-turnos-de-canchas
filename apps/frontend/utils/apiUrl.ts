// Función helper para normalizar la URL del API y evitar barras dobles
export const getApiUrl = (): string => {
  // Si está definido en variables de entorno, usarlo
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '');
  }
  
  // Si estamos en el cliente (navegador), detectar automáticamente
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    // Si no es localhost, usar el mismo hostname para el API
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return `http://${hostname}:3000`;
    }
  }
  
  // Por defecto, localhost para desarrollo local
  return 'http://localhost:3000';
};
