// src/services/AuthService.ts

import { getApiUrl } from '../utils/apiUrl';

const API_URL = getApiUrl();

export const login = async (email: string, password: string) => {
  const response = await fetch(`${API_URL}/auth/login`, { // Asegúrate que esta sea tu ruta real en el back
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || 'Error al iniciar sesión');
  }

  const data = await response.json();
  
  // Aquí es donde ocurre la magia: Guardamos el token en el navegador
  if (data.token) {
    localStorage.setItem('token', data.token);


    // Opcional: Guardar datos del usuario si el back los devuelve
    if (data.user) {
        localStorage.setItem('user', JSON.stringify(data.user));
    }
  }

  return data;
};

export const register = async (firstName: string, lastName: string, email: string, password: string, phoneNumber: string, role: string) => {
  const response = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ firstName, lastName, email, password, phoneNumber, role }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || 'Error al registrar usuario');
  }

  const data = await response.json();
  return data;
};

export const logout = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login'; // O recargar la página
};

export const getToken = () => {
    // Esta función la usaremos en las reservas
    if (typeof window !== 'undefined') {
        return localStorage.getItem('token');
    }
    return null;
};