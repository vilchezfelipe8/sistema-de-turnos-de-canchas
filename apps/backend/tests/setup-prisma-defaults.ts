// Lecturas de configuración que los tests no suelen mockear: en tests responden "sin configuración"
// (los defaults del código) en vez de intentar conectarse a una base que no existe.
//
// Corre después de ts-node (node --test -r ./tests/setup-env.js -r ts-node/register
// -r ./tests/setup-prisma-defaults.ts). Un test que necesite otro valor sigue pudiendo reemplazar
// el método (p. ej. `(prisma.clubSettings as any).findUnique = async () => ({...})`) y restaurarlo.
import { prisma } from '../src/prisma';

type Stub = { model: string; method: string; value: () => unknown };

const STUBS: Stub[] = [
  // Config del club: sin fila = defaults (precio por cancha, sin socios, sin ventanas, sin seña).
  { model: 'clubSettings', method: 'findUnique', value: () => null },
  { model: 'clubSettings', method: 'findFirst', value: () => null },
  // Bloqueos de cancha: ninguno.
  { model: 'courtBlock', method: 'findMany', value: () => [] },
  { model: 'courtBlock', method: 'findFirst', value: () => null },
  // Clases de academia en la cancha: ninguna (crear una reserva chequea que no se pise con una clase).
  { model: 'classSession', method: 'findFirst', value: () => null },
  { model: 'classSession', method: 'findMany', value: () => [] },
  // Padrón de socios: vacío.
  { model: 'clubMember', method: 'findMany', value: () => [] },
];

for (const stub of STUBS) {
  const delegate = (prisma as any)[stub.model];
  if (!delegate) continue;
  delegate[stub.method] = async () => stub.value();
}
