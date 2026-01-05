import { getToken } from './AuthService';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export const getCourts = async () => {
    // Este endpoint suele ser público, pero si es privado agrega el header Authorization
    const res = await fetch(`${API_URL}/api/courts`);
    return res.json();
};

export const createCourt = async (name: string, sport: string) => {
    const token = getToken();
    const res = await fetch(`${API_URL}/api/courts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name, sport }) // Ajusta según lo que pida tu backend
    });
    if (!res.ok) throw new Error('Error al crear cancha');
    return res.json();
};

export const deleteCourt = async (courtId: number) => {
    const token = getToken();
    const res = await fetch(`${API_URL}/api/courts/${courtId}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    if (!res.ok) throw new Error('Error al eliminar cancha');
    return res.json();
};