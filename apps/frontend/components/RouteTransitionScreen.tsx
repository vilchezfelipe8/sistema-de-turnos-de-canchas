import PiqueLogo from './PiqueLogo';

interface RouteTransitionScreenProps {
  message?: string;
}

export default function RouteTransitionScreen({
  message = 'Redirigiendo...'
}: RouteTransitionScreenProps) {
  return (
    <main className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center p-4 p-brand-ambient text-ink-50">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none opacity-25">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-lima-300 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] rounded-full bg-lima-100/30 blur-[150px]" />
      </div>
      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="relative h-14 w-14">
          <PiqueLogo variant="isotipoDark" className="h-14 w-14" />
          <span className="absolute inset-[-6px] rounded-2xl border-2 border-lima-300/20 border-t-lima-300 animate-spin" />
        </div>
        <p className="text-sm font-bold tracking-wide text-ink-50/90">{message}</p>
      </div>
    </main>
  );
}
