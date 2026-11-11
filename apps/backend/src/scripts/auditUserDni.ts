import path from 'node:path';
import fs from 'node:fs/promises';
import { prisma } from '../prisma';
import { normalizeDni } from '../utils/dni';

// Fase 0 de socios: prepara User.dni para volverse único.
// - Dry-run por defecto: solo genera el reporte.
// - --apply: normaliza (solo dígitos) los DNI sin conflicto y vacía los inválidos.
//   Los DNI duplicados entre usuarios NO se tocan: se resuelven a mano antes de la migración.

type Args = { apply: boolean; reportPath?: string };

type Status = 'ALREADY_NORMALIZED' | 'NORMALIZE' | 'INVALID' | 'DUPLICATE';

type UserEntry = {
  id: number;
  email: string | null;
  currentDni: string;
  normalizedDni: string | null;
  status: Status;
};

const parseArgs = (argv: string[]): Args => {
  const args: Args = { apply: false };
  for (const raw of argv) {
    if (raw === '--apply') args.apply = true;
    if (raw.startsWith('--report=')) args.reportPath = raw.split('=').slice(1).join('=').trim();
  }
  return args;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const users = await prisma.user.findMany({
    where: { dni: { not: null } },
    select: { id: true, email: true, dni: true },
    orderBy: { id: 'asc' }
  });

  const byNormalized = new Map<string, number[]>();
  for (const user of users) {
    const normalized = normalizeDni(user.dni);
    if (!normalized) continue;
    byNormalized.set(normalized, [...(byNormalized.get(normalized) || []), user.id]);
  }

  const entries: UserEntry[] = users
    .filter((user) => String(user.dni || '').trim().length > 0)
    .map((user) => {
      const currentDni = String(user.dni);
      const normalizedDni = normalizeDni(currentDni);
      let status: Status;
      if (!normalizedDni) status = 'INVALID';
      else if ((byNormalized.get(normalizedDni) || []).length > 1) status = 'DUPLICATE';
      else if (normalizedDni === currentDni) status = 'ALREADY_NORMALIZED';
      else status = 'NORMALIZE';
      return { id: user.id, email: user.email, currentDni, normalizedDni, status };
    });

  if (args.apply) {
    for (const entry of entries) {
      if (entry.status === 'NORMALIZE') {
        await prisma.user.update({ where: { id: entry.id }, data: { dni: entry.normalizedDni } });
      } else if (entry.status === 'INVALID') {
        await prisma.user.update({ where: { id: entry.id }, data: { dni: null } });
      }
    }
  }

  const duplicates = Array.from(byNormalized.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([dni, userIds]) => ({ dni, userIds }));

  const summary = entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.status] = (acc[entry.status] || 0) + 1;
    return acc;
  }, {});

  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    scannedUsersWithDni: entries.length,
    summary,
    duplicates,
    invalid: entries.filter((entry) => entry.status === 'INVALID'),
    normalized: entries.filter((entry) => entry.status === 'NORMALIZE')
  };

  const reportPath = path.resolve(
    args.reportPath || path.join(process.cwd(), 'reports', `user-dni-audit-${Date.now()}.json`)
  );
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('User DNI audit finished');
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Summary: ${JSON.stringify(summary)}`);
  console.log(`Duplicate groups: ${duplicates.length}${duplicates.length ? ' -> resolver a mano antes de migrar' : ''}`);
  console.log(`Report: ${reportPath}`);
}

main()
  .catch((error) => {
    console.error('User DNI audit failed');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
