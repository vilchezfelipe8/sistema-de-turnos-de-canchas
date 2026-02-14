import { useState } from 'react';
import { useRouter } from 'next/router';
import { login, register } from '../services/AuthService';
import { ClubService } from '../services/ClubService';
import { Mail, Lock, User, Phone, UserPlus, LogIn, AlertCircle, Loader2 } from 'lucide-react';

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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isPhoneValid = (phone: string) => {
    if (!phone) return false;
    if (!phone.startsWith('+549')) return false;
    const digits = phone.replace(/\D/g, '');
    if (!digits.startsWith('549')) return false;
    const nationalDigits = digits.slice(3);
    if (nationalDigits.length !== 10) return false;
    return /^\+549\d+$/.test(phone);
  };

  const formatPhoneDigits = (digits: string) => {
    const clean = digits.slice(0, 10);
    const part1 = clean.slice(0, 3);
    const part2 = clean.slice(3, 6);
    const part3 = clean.slice(6, 10);
    return [part1, part2, part3].filter(Boolean).join(' ');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        const data = await login(email, password);
        if (returnTo) {
          window.location.href = returnTo;
        } else if (data?.user?.role === 'ADMIN') {
          window.location.href = '/admin/agenda';
        } else if (data?.user?.clubId) {
          const club = await ClubService.getClubById(data.user.clubId);
          window.location.href = `/club/${club.slug}`;
        } else {
          window.location.href = '/';
        }
      } else {
        const phoneDigits = phoneNumber.replace(/\D/g, '').slice(0, 10);
        const fullPhone = phoneDigits ? `+549${phoneDigits}` : '';
        if (!phoneDigits) {
          setError('Ingresá un teléfono para completar el registro.');
          return;
        }
        if (!isPhoneValid(fullPhone)) {
          setError('Ingresá un teléfono con formato válido.');
          return;
        }
        await register(firstName, lastName, email, password, fullPhone, 'MEMBER');
        setError('Usuario registrado exitosamente. Ahora puedes iniciar sesión.');
        setIsLogin(true);
        setFirstName(''); setLastName(''); setPhoneNumber('');
      }
    } catch (err: any) {
      setError(err.message || (isLogin ? 'Credenciales inválidas' : 'Error al registrar'));
    } finally {
      setLoading(false);
    }
  };

  return (
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

          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Nombre</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-[#347048]/40"><User size={16} strokeWidth={3} /></div>
                    <input type="text" required value={firstName} onChange={(e) => setFirstName(e.target.value)}
                      className="w-full pl-11 pr-4 py-3.5 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl text-[#347048] font-bold focus:outline-none transition-all shadow-sm placeholder-[#347048]/20" placeholder="Ej: Juan" />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Apellido</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-[#347048]/40"><User size={16} strokeWidth={3} /></div>
                    <input type="text" required value={lastName} onChange={(e) => setLastName(e.target.value)}
                      className="w-full pl-11 pr-4 py-3.5 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl text-[#347048] font-bold focus:outline-none transition-all shadow-sm placeholder-[#347048]/20" placeholder="Ej: Pérez" />
                  </div>
                </div>
                
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Teléfono</label>
                  <div className="relative flex items-stretch bg-white border-2 border-transparent focus-within:border-[#B9CF32] rounded-2xl transition-all shadow-sm overflow-hidden min-h-[56px]">
                    <div className="pl-4 pr-3 py-0 flex items-center bg-[#347048]/5 text-[#347048]/60 border-r border-[#347048]/10 shrink-0 self-stretch">
                      <Phone size={16} strokeWidth={3} className="mr-2 text-[#347048]/40" />
                      <span className="font-black text-sm whitespace-nowrap">+54 9</span>
                    </div>
                    <input type="tel" required maxLength={12} value={formatPhoneDigits(phoneNumber)}
                      onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                      className="w-full px-4 py-3.5 bg-transparent text-[#347048] font-bold focus:outline-none placeholder-[#347048]/20 h-full" placeholder="351 123 4567" />
                  </div>
                </div>
              </div>
            )}
            
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

            <div>
              <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Contraseña</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-[#347048]/40">
                  <Lock size={16} strokeWidth={3} />
                </div>
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3.5 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl text-[#347048] font-bold focus:outline-none transition-all shadow-sm placeholder-[#347048]/20" placeholder="••••••••" />
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
  );
}