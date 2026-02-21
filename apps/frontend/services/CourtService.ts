import { getToken } from './AuthService';
import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';

const apiBase = () => `${getApiUrl()}/api`;

export const getCourts = async () => {
    const res = await fetchWithAuth(`${apiBase()}/courts`);
    if (!res.ok) throw new Error('Error al cargar canchas');
    return res.json();
};

export const createCourt = async (name: string, sport: string) => {
    if (!getToken()) throw new Error('No hay token. Tenés que loguearte de nuevo.');
    const res = await fetchWithAuth(`${apiBase()}/courts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, surface: sport, clubId: 1 })
    });
    if (!res.ok) throw new Error('Error al crear cancha');
    return res.json();
};

export const suspendCourt = async (courtId: number) => {
    if (!getToken()) throw new Error('No hay token. Tenés que loguearte de nuevo.');
    const res = await fetchWithAuth(`${apiBase()}/courts/${courtId}/suspend`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isUnderMaintenance: true })
    });
    if (!res.ok) throw new Error('Error al suspender cancha');
    return res.json();
};

export const reactivateCourt = async (courtId: number) => {
    if (!getToken()) throw new Error('No hay token. Tenés que loguearte de nuevo.');
    const res = await fetchWithAuth(`${apiBase()}/courts/${courtId}/reactivate`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isUnderMaintenance: false })
    });
    if (!res.ok) throw new Error('Error al reactivar cancha');
    return res.json();
};

export const updateCourtPrice = async (courtId: number, price: number) => {
    if (!getToken()) throw new Error('No hay token. Tenés que loguearte de nuevo.');
    const res = await fetchWithAuth(`${apiBase()}/courts/${courtId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price })
    });
    if (!res.ok) throw new Error('Error al actualizar precio de cancha');
    return res.json();
};

export const deleteCourt = async (courtId: number) => {
    if (!getToken()) throw new Error('No autenticado');
    const res = await fetchWithAuth(`${apiBase()}/courts/${courtId}`, {
        method: 'DELETE'
    });
    if (!res.ok) throw new Error('Error al eliminar cancha');
    return res.json();
};