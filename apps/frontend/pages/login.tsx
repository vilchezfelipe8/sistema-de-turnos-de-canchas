import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { login, register } from '../services/AuthService';
import { ClubService } from '../services/ClubService';
import { Mail, Lock, User, Phone, UserPlus, LogIn, AlertCircle, Loader2, IdCard, CheckCircle, Eye, EyeOff } from 'lucide-react'; // Agregamos IdCard y Eye
import { getActiveClubSlug, hasAdminAccess, normalizeSessionUser } from '../utils/session';
import { buildCanonicalPhone, DEFAULT_PHONE_COUNTRY_ISO2, normalizePhoneCountryIso2, PHONE_COUNTRY_OPTIONS, resolveCallingCodeByIso2 } from '../utils/phone';

export default function LoginPage() {
  const router = useRouter();
  const returnTo = typeof router.query.from === 'string' && router.query.from.startsWith('/') && !router.query.from.startsWith('//')
    ? router.query.from
    : null;

  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneCountryIso2, setPhoneCountryIso2] = useState(DEFAULT_PHONE_COUNTRY_ISO2);
  const [dni, setDni] = useState(''); // Estado del DNI listo
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const userRaw = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
        const parsedUser = userRaw ? normalizeSessionUser(JSON.parse(userRaw)) : null;
        const activeClubId = Number(parsedUser?.activeClubId || parsedUser?.clubId || parsedUser?.club?.id || 0);
        if (!Number.isInteger(activeClubId) || activeClubId <= 0) return;
        const club = await ClubService.getClubById(activeClubId);
        if (cancelled) return;
        setPhoneCountryIso2(normalizePhoneCountryIso2(club?.country));
      } catch {
        if (!cancelled) setPhoneCountryIso2(DEFAULT_PHONE_COUNTRY_ISO2);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setLoading(true);

    try {
      if (isLogin) {
        const data = await login(email, password);
        const normalizedUser = normalizeSessionUser(data?.user);
        const activeSlug = getActiveClubSlug(normalizedUser);
        if (hasAdminAccess(normalizedUser)) {
          window.location.href = '/admin/agenda';
        } else if (returnTo) {
          window.location.href = returnTo;
        } else if (activeSlug) {
          window.location.href = `/club/${activeSlug}`;
        } else if (normalizedUser?.activeClubId || data?.user?.clubId) {
          const club = await ClubService.getClubById(Number(normalizedUser?.activeClubId || data.user.clubId));
          window.location.href = `/club/${club.slug}`;
        } else {
          window.location.href = '/';
        }
      } else {
        const localPhone = String(phoneNumber || '').replace(/[^\d]/g, '');
        const fullPhone = buildCanonicalPhone({
          countryIso2: phoneCountryIso2,
          localNumber: localPhone
        });

        if (!localPhone) {
          setError('Ingresá un teléfono para completar el registro.');
          return;
        }
        if (!fullPhone) {
          setError('Ingresá un teléfono con formato válido.');
          return;
        }
        const safeDni = String(dni || '').trim();
        if (safeDni && safeDni.length < 7) {
          setError('Si cargás DNI, debe tener al menos 7 dígitos.');
          return;
        }

        await register(
          firstName,
          lastName,
          email,
          password,
          fullPhone,
          'MEMBER',
          safeDni || undefined,
          resolveCallingCodeByIso2(phoneCountryIso2),
          localPhone
        );
        
        setSuccessMessage('Usuario registrado exitosamente. Ahora podés iniciar sesión.');
        setIsLogin(true);
        // Limpiamos los campos
        setFirstName(''); setLastName(''); setPhoneNumber(''); setDni(''); 
      }
    } catch (err: any) {
      setError(err.message || (isLogin ? 'Credenciales inválidas' : 'Error al registrar'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Ingresar | TuCancha</title>
      </Head>
      <div className="flex min-h-screen items-center justify-center p-4 relative overflow-hidden bg-[#347048]">
      
      {/* Decoración de Fondo (Estilo Wimbledon) */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none opacity-20">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-[#B9CF32] blur-[120px]"></div>
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] rounded-full bg-[#926699] blur-[150px]"></div>
      </div>

      <div className="w-full max-w-md relative z-10 animate-in fade-in zoom-in duration-300">

        {/* Card Principal Beige Wimbledon */}
        <div className="bg-[#EBE1D8] border-4 border-white rounded-[2.5rem] shadow-2xl shadow-black/40 p-8 md:p-10 relative overflow-hidden">
          
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#347048] text-[#B9CF32] shadow-inner mb-4">
               {isLogin ? <Lock size={32} strokeWidth={2.5} /> : <UserPlus size={32} strokeWidth={2.5} />}
            </div>
            <h2 className="text-3xl font-black text-[#347048] uppercase italic tracking-tighter">
              {isLogin ? 'Iniciar Sesión' : 'Crear Cuenta'}
            </h2>
            <p className="text-[10px] font-black text-[#347048]/40 uppercase tracking-widest mt-2">
              {isLogin ? 'Accedé a tu panel de control' : 'Sumate al club en segundos'}
            </p>
          </div>
          
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 rounded-2xl text-xs font-bold flex items-start gap-3 shadow-sm animate-in slide-in-from-top-2">
              <AlertCircle size={18} className="shrink-0 mt-0.5" strokeWidth={2.5} />
              <span>{error}</span>
            </div>
          )}

          {/* 👉 NUEVO CARTEL DE ÉXITO */}
          {successMessage && (
            <div className="mb-6 p-4 bg-[#B9CF32]/20 border border-[#B9CF32] text-[#347048] rounded-2xl text-xs font-bold flex items-start gap-3 shadow-sm animate-in slide-in-from-top-2">
              <CheckCircle size={18} className="shrink-0 mt-0.5 text-[#347048]" strokeWidth={2.5} />
              <span>{successMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <div className="grid grid-cols-2 gap-4">
                
                {/* Nombre */}
                <div>
                  <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Nombre</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-[#347048]/40"><User size={16} strokeWidth={3} /></div>
                    <input type="text" required value={firstName} onChange={(e) => setFirstName(e.target.value)}
                      className="w-full pl-11 pr-4 py-3.5 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl text-[#347048] font-bold focus:outline-none transition-all shadow-sm placeholder-[#347048]/20" placeholder="Ej: Juan" />
                  </div>
                </div>
                
                {/* Apellido */}
                <div>
                  <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Apellido</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-[#347048]/40"><User size={16} strokeWidth={3} /></div>
                    <input type="text" required value={lastName} onChange={(e) => setLastName(e.target.value)}
                      className="w-full pl-11 pr-4 py-3.5 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl text-[#347048] font-bold focus:outline-none transition-all shadow-sm placeholder-[#347048]/20" placeholder="Ej: Pérez" />
                  </div>
                </div>

                {/* DNI (NUEVO CAMPO) */}
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">DNI</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-[#347048]/40">
                      <IdCard size={16} strokeWidth={3} />
                    </div>
                    <input 
                      type="number" 
                      value={dni} 
                      onChange={(e) => setDni(e.target.value)}
                      className="w-full pl-11 pr-4 py-3.5 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl text-[#347048] font-bold focus:outline-none transition-all shadow-sm placeholder-[#347048]/20" 
                      placeholder="Opcional. Ej: 35123456" 
                    />
                  </div>
                </div>
                
                {/* Teléfono */}
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Teléfono</label>
                  <div className="relative flex items-stretch bg-white border-2 border-transparent focus-within:border-[#B9CF32] rounded-2xl transition-all shadow-sm overflow-hidden min-h-[56px]">
                    <div className="pl-3 pr-2 py-0 flex items-center bg-[#347048]/5 text-[#347048]/60 border-r border-[#347048]/10 shrink-0 self-stretch gap-2">
                      <Phone size={16} strokeWidth={3} className="text-[#347048]/40" />
                      <select
                        value={phoneCountryIso2}
                        onChange={(e) => setPhoneCountryIso2(normalizePhoneCountryIso2(e.target.value))}
                        className="bg-transparent text-[#347048] font-black text-xs focus:outline-none"
                      >
                        {PHONE_COUNTRY_OPTIONS.map((option) => (
                          <option key={option.iso2} value={option.iso2}>
                            {option.callingCode} {option.iso2}
                          </option>
                        ))}
                      </select>
                    </div>
                    <input
                      type="tel"
                      required
                      maxLength={20}
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value.replace(/[^\d]/g, ''))}
                      className="w-full px-4 py-3.5 bg-transparent text-[#347048] font-bold focus:outline-none placeholder-[#347048]/20 h-full"
                      placeholder="Número local"
                    />
                  </div>
                </div>
              </div>
            )}
            
            {/* Email */}
            <div>
              <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Correo Electrónico</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-[#347048]/40">
                  <Mail size={16} strokeWidth={3} />
                </div>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3.5 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl text-[#347048] font-bold focus:outline-none transition-all shadow-sm placeholder-[#347048]/20" placeholder="tu@email.com" />
              </div>
            </div>

            {/* Contraseña */}
            <div>
              <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Contraseña</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-[#347048]/40">
                  <Lock size={16} strokeWidth={3} />
                </div>
                <input type={showPassword ? 'text' : 'password'} required value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-14 py-3.5 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl text-[#347048] font-bold focus:outline-none transition-all shadow-sm placeholder-[#347048]/20" placeholder="••••••••" />

                <button
                  type="button"
                  aria-label="Mantener pulsado para ver la contraseña"
                  onMouseDown={() => setShowPassword(true)}
                  onMouseUp={() => setShowPassword(false)}
                  onMouseLeave={() => setShowPassword(false)}
                  onTouchStart={() => setShowPassword(true)}
                  onTouchEnd={() => setShowPassword(false)}
                  onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') setShowPassword(true); }}
                  onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') setShowPassword(false); }}
                  className="absolute inset-y-0 right-3 flex items-center text-[#347048]/60 hover:text-[#347048] transition-colors"
                >
                  {showPassword ? <EyeOff size={18} strokeWidth={2.5} /> : <Eye size={18} strokeWidth={2.5} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} 
              className="w-full mt-8 py-4 bg-[#B9CF32] text-[#347048] font-black text-sm uppercase tracking-widest rounded-2xl shadow-xl shadow-[#B9CF32]/20 hover:-translate-y-1 hover:bg-[#aebd2b] active:scale-95 transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            >
              {loading ? (
                <><Loader2 size={18} strokeWidth={3} className="animate-spin" /> Procesando...</>
              ) : (
                isLogin ? <><LogIn size={18} strokeWidth={3} /> Ingresar</> : <><UserPlus size={18} strokeWidth={3} /> Registrarse</>
              )}
            </button>
          </form>

          <div className="mt-8 text-center border-t border-[#347048]/10 pt-6">
            <button onClick={() => { setIsLogin(!isLogin); setError(''); }}
              className="text-[#347048]/60 hover:text-[#347048] text-[10px] font-black uppercase tracking-widest transition-colors hover:underline decoration-2 underline-offset-4"
            >
              {isLogin ? '¿No tenés cuenta? Regístrate gratis' : '¿Ya tenés cuenta? Inicia sesión'}
            </button>
          </div>
        </div>
      </div>
      </div>
    </>
  );
}
