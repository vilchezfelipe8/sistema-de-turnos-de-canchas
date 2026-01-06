import { useState } from 'react';
import { useRouter } from 'next/router'; // O 'next/navigation' si es App Router
import { login, register } from '../services/AuthService';

export default function LoginPage() {
  const router = useRouter();
  const [isLogin, setIsLogin] = useState(true); // true para login, false para registro
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [role, setRole] = useState('MEMBER');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await login(email, password);
        window.location.href = '/';
      } else {
        await register(firstName, lastName, email, password, phoneNumber, role);
        setError('Usuario registrado exitosamente. Ahora puedes iniciar sesión.');
        setIsLogin(true);
        // Limpiar campos de registro
        setFirstName('');
        setLastName('');
        setPhoneNumber('');
        setRole('MEMBER');
      }
    } catch (err: any) {
      setError(err.message || (isLogin ? 'Credenciales inválidas' : 'Error al registrar'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-orange-600 via-orange-500 to-amber-600 p-3 sm:p-4">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-6 sm:mb-8">
          <div className="inline-block p-3 sm:p-4 bg-white/20 backdrop-blur-lg rounded-2xl mb-3 sm:mb-4">
            <span className="text-4xl sm:text-5xl">🏓</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white mb-1">LAS TEJAS</h1>
          <p className="text-orange-100 text-xs sm:text-sm font-bold uppercase tracking-wider mb-2">CLUB DE PADEL Y AMIGOS</p>
          <p className="text-white/90 font-medium text-sm sm:text-base">{isLogin ? 'Bienvenido de vuelta' : 'Únete a nosotros'}</p>
        </div>

        {/* Card de Login/Registro */}
        <div className="bg-white/95 backdrop-blur-lg rounded-2xl shadow-2xl p-5 sm:p-6 lg:p-8 border border-white/20">
          <h2 className="text-xl sm:text-2xl font-bold text-center mb-5 sm:mb-6 text-gray-800">
            {isLogin ? 'Iniciar Sesión' : 'Crear Cuenta'}
          </h2>
          
          {error && (
            <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 rounded-lg text-sm">
              <div className="flex items-center gap-2">
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Nombre
                  </label>
                  <input
                    type="text"
                    required
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all text-gray-700 font-medium"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Tu nombre"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Apellido
                  </label>
                  <input
                    type="text"
                    required
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all text-gray-700 font-medium"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Tu apellido"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Teléfono
                  </label>
                  <input
                    type="tel"
                    required
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all text-gray-700 font-medium"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="Tu número de teléfono"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Rol
                  </label>
                  <select
                    required
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all text-gray-700 font-medium"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    <option value="MEMBER">Miembro</option>
                    <option value="ADMIN">Administrador</option>
                  </select>
                </div>
              </>
            )}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Email
              </label>
              <input
                type="email"
                required
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all text-gray-700 font-medium"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ejemplo@email.com"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Contraseña
              </label>
              <input
                type="password"
                required
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all text-gray-700 font-medium"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center items-center gap-2 py-3 px-4 rounded-xl text-base font-bold text-white bg-gradient-to-r from-orange-600 via-orange-500 to-amber-600 hover:from-orange-700 hover:via-orange-600 hover:to-amber-700 focus:outline-none focus:ring-4 focus:ring-orange-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.02] shadow-lg shadow-orange-500/30"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  <span>Cargando...</span>
                </>
              ) : (
                <>
                  <span>{isLogin ? 'Ingresar' : 'Registrarse'}</span>
                  <span>→</span>
                </>
              )}
            </button>
          </form>

          {/* Toggle entre login y registro */}
          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setError('');
                setFirstName('');
                setLastName('');
                setPhoneNumber('');
                setRole('MEMBER');
                setEmail('');
                setPassword('');
              }}
              className="text-orange-600 hover:text-orange-800 font-medium text-sm underline"
            >
              {isLogin ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
            </button>
          </div>

          {/* Footer decorativo */}
          <div className="mt-6 pt-6 border-t border-gray-200 text-center">
            <p className="text-xs text-gray-500">
              Sistema seguro de reservas
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}