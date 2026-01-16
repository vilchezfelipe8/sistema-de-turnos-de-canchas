import { getToken } from './AuthService';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export const getCourts = async () => {
    // Este endpoint suele ser público, pero si es privado agrega el header Authorization
    const res = await fetch(`${API_URL}/api/courts`);
    return res.json();
};

export const createCourt = async (name: string, sport: string) => {
    const token = getToken();
    console.log("MIRA AQUÍ EL TOKEN:", token);
    if (!token) {
        throw new Error('No hay token. Tenés que loguearte de nuevo.');
    }
    console.log("Enviando petición con headers:", {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    });
    const res = await fetch(`${API_URL}/api/courts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name, surface: sport, clubId: 1 }) // Ajusta según lo que pida tu backend
    });
    console.log("Respuesta del servidor:", res.status, res.statusText);
    if (!res.ok) {
        const errorText = await res.text();
        console.log("Error response:", errorText);
        throw new Error('Error al crear cancha');
    }
    return res.json();
};

export const suspendCourt = async (courtId: number) => {
    const token = getToken();
    if (!token) {
        throw new Error('No hay token. Tenés que loguearte de nuevo.');
    }
    const res = await fetch(`${API_URL}/api/courts/${courtId}/suspend`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ isUnderMaintenance: true })
    });
    if (!res.ok) {
        const errorText = await res.text();
        console.log("Error response:", errorText);
        throw new Error('Error al suspender cancha');
    }
    return res.json();
};

export const reactivateCourt = async (courtId: number) => {
    const token = getToken();
    if (!token) {
        throw new Error('No hay token. Tenés que loguearte de nuevo.');
    }
    const res = await fetch(`${API_URL}/api/courts/${courtId}/reactivate`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ isUnderMaintenance: false })
    });
    if (!res.ok) {
        const errorText = await res.text();
        console.log("Error response:", errorText);
        throw new Error('Error al reactivar cancha');
    }
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