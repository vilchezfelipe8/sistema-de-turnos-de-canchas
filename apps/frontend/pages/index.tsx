import BookingGrid from '../components/BookingGrid';
import Navbar from '../components/NavBar';

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      
      <h1 className="text-4xl font-extrabold text-blue-900 mb-8 tracking-tight">
        Club Deportivo
      </h1>
      <Navbar />
      
      {/* Aquí insertamos nuestro nuevo componente */}
      <BookingGrid />
      
      <p className="mt-8 text-sm text-gray-400">
        Sistema de Reservas v1.0
      </p>
    </main>
  );
}