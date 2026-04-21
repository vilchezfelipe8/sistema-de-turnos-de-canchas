import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Navbar from '../components/NavBar';
import RouteTransitionScreen from '../components/RouteTransitionScreen';
import { getPendingLogoutRedirect } from '../services/AuthService';
import { useValidateAuth } from '../hooks/useValidateAuth';
import { updateMyProfile } from '../services/AuthService';
import { Mail, Phone, IdCard, User, Save } from 'lucide-react';
import {
  buildCanonicalPhone,
  DEFAULT_PHONE_COUNTRY_ISO2,
  normalizePhoneCountryIso2,
  PHONE_COUNTRY_OPTIONS,
  resolveCallingCodeByIso2,
  splitCanonicalPhone
} from '../utils/phone';

export default function PerfilPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    dni: '',
    phoneCountryIso2: DEFAULT_PHONE_COUNTRY_ISO2,
    phoneLocal: ''
  });

  useEffect(() => {
    if (!authChecked) return;
    if (user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/perfil')}`);
  }, [authChecked, user, router]);

  useEffect(() => {
    if (!user) return;
    const splitPhone = splitCanonicalPhone(String(user.phoneNumber || ''), DEFAULT_PHONE_COUNTRY_ISO2);
    setForm({
      firstName: String(user.firstName || ''),
      lastName: String(user.lastName || ''),
      email: String(user.email || ''),
      dni: String((user as any).dni || ''),
      phoneCountryIso2: normalizePhoneCountryIso2(splitPhone.countryIso2),
      phoneLocal: String(splitPhone.localNumber || '')
    });
  }, [user]);

  if (!authChecked || !user) return <RouteTransitionScreen message={authChecked ? 'Redirigiendo...' : 'Validando sesion...'} />;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    const firstName = String(form.firstName || '').trim();
    const lastName = String(form.lastName || '').trim();
    const phoneLocal = String(form.phoneLocal || '').replace(/[^\d]/g, '');
    const safeDni = String(form.dni || '').trim();

    if (!firstName || !lastName) {
      setError('Nombre y apellido son obligatorios.');
      return;
    }
    if (!phoneLocal) {
      setError('Ingresá un teléfono.');
      return;
    }
    if (safeDni && safeDni.length < 7) {
      setError('Si cargás DNI, debe tener al menos 7 dígitos.');
      return;
    }

    const canonicalPhone = buildCanonicalPhone({
      countryIso2: form.phoneCountryIso2,
      localNumber: phoneLocal
    });
    if (!canonicalPhone) {
      setError('Número de teléfono inválido.');
      return;
    }

    setSaving(true);
    try {
      await updateMyProfile({
        firstName,
        lastName,
        phoneNumber: canonicalPhone,
        phoneCountryCode: resolveCallingCodeByIso2(form.phoneCountryIso2),
        phoneNumberLocal: phoneLocal,
        dni: safeDni || undefined
      });
      setSuccess('Perfil actualizado.');
    } catch (err: any) {
      setError(err?.message || 'No se pudo actualizar el perfil.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Head>
        <title>Mi Perfil | TuCancha</title>
      </Head>
      <div className="min-h-screen bg-vibrant-brand text-[#EBE1D8]">
        <Navbar />
        <main className="density-compact max-w-3xl mx-auto px-4 sm:px-5 pt-24 pb-10">
          <div className="bg-[#EBE1D8] border-4 border-white rounded-[1.5rem] p-5 shadow-2xl shadow-[#1f4b33]/30 text-[#347048]">
            <div className="flex items-center justify-between gap-4 flex-wrap border-b border-[#347048]/10 pb-4 mb-4">
              <div>
                <h1 className="text-2xl font-black uppercase italic tracking-tight text-[#926699]">Mi Perfil</h1>
                <p className="text-sm font-bold text-[#347048]/70 mt-1">Editá los datos de tu cuenta</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error ? (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm font-bold text-red-600">{error}</div>
              ) : null}
              {success ? (
                <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm font-bold text-green-700">{success}</div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="rounded-xl border border-[#347048]/10 bg-white p-4 block">
                  <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50 mb-2 flex items-center gap-2">
                    <User size={14} />
                    Nombre
                  </div>
                  <input
                    value={form.firstName}
                    onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
                    className="w-full bg-transparent text-base font-black outline-none"
                  />
                </label>

                <label className="rounded-xl border border-[#347048]/10 bg-white p-4 block">
                  <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50 mb-2 flex items-center gap-2">
                    <User size={14} />
                    Apellido
                  </div>
                  <input
                    value={form.lastName}
                    onChange={(e) => setForm((prev) => ({ ...prev, lastName: e.target.value }))}
                    className="w-full bg-transparent text-base font-black outline-none"
                  />
                </label>

                <label className="rounded-xl border border-[#347048]/10 bg-white p-4 block md:col-span-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50 mb-2 flex items-center gap-2">
                    <Mail size={14} />
                    Email (no editable)
                  </div>
                  <input
                    value={form.email}
                    disabled
                    className="w-full bg-transparent text-base font-black outline-none text-[#347048]/60"
                  />
                </label>

                <div className="rounded-xl border border-[#347048]/10 bg-white p-4 md:col-span-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50 mb-2 flex items-center gap-2">
                    <Phone size={14} />
                    Teléfono
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={form.phoneCountryIso2}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, phoneCountryIso2: normalizePhoneCountryIso2(e.target.value) }))
                      }
                      className="bg-[#347048]/5 rounded-lg px-2 py-2 text-sm font-black outline-none"
                    >
                      {PHONE_COUNTRY_OPTIONS.map((option) => (
                        <option key={option.iso2} value={option.iso2}>
                          {option.callingCode} {option.iso2}
                        </option>
                      ))}
                    </select>
                    <input
                      value={form.phoneLocal}
                      onChange={(e) => setForm((prev) => ({ ...prev, phoneLocal: e.target.value.replace(/[^\d]/g, '') }))}
                      className="flex-1 bg-transparent text-base font-black outline-none"
                      placeholder="Número local"
                    />
                  </div>
                </div>

                <label className="rounded-xl border border-[#347048]/10 bg-white p-4 block md:col-span-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50 mb-2 flex items-center gap-2">
                    <IdCard size={14} />
                    DNI (opcional)
                  </div>
                  <input
                    value={form.dni}
                    onChange={(e) => setForm((prev) => ({ ...prev, dni: e.target.value.replace(/[^\d]/g, '') }))}
                    className="w-full bg-transparent text-base font-black outline-none"
                  />
                </label>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#347048] text-[#B9CF32] text-sm font-black uppercase tracking-wider disabled:opacity-60"
                >
                  <Save size={16} />
                  {saving ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </>
  );
}

