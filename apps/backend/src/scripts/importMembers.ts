import path from 'node:path';
import fs from 'node:fs/promises';
import { prisma } from '../prisma';
import { MemberImportService, parseMembersCsv } from '../services/MemberImportService';

// Importa el padrón de socios de un club desde CSV.
//   npm run members:import -- --club=<slug> --file=padron.csv            (previsualización, no escribe)
//   npm run members:import -- --club=<slug> --file=padron.csv --apply    (aplica)
// Columnas: nombre,apellido,dni,telefono,email,numero_socio,categoria,estado,fecha_alta,al_dia_hasta

type Args = { clubSlug?: string; file?: string; apply: boolean; reportPath?: string };

const parseArgs = (argv: string[]): Args => {
  const args: Args = { apply: false };
  for (const raw of argv) {
    if (raw === '--apply') args.apply = true;
    else if (raw.startsWith('--club=')) args.clubSlug = raw.slice('--club='.length).trim();
    else if (raw.startsWith('--file=')) args.file = raw.slice('--file='.length).trim();
    else if (raw.startsWith('--report=')) args.reportPath = raw.slice('--report='.length).trim();
  }
  return args;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.clubSlug || !args.file) {
    throw new Error('Uso: --club=<slug> --file=<padron.csv> [--apply] [--report=<ruta.json>]');
  }

  const club = await prisma.club.findUnique({ where: { slug: args.clubSlug }, select: { id: true, name: true } });
  if (!club) throw new Error(`Club no encontrado: ${args.clubSlug}`);

  const rows = parseMembersCsv(await fs.readFile(path.resolve(args.file), 'utf8'));
  const report = await new MemberImportService().importRows({
    clubId: club.id,
    rows,
    mode: args.apply ? 'commit' : 'preview',
    actorUserId: null
  });

  const reportPath = path.resolve(
    args.reportPath || path.join(process.cwd(), 'reports', `members-import-${args.clubSlug}-${Date.now()}.json`)
  );
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Padrón ${club.name}: ${args.apply ? 'APLICADO' : 'PREVISUALIZACIÓN (no se escribió nada)'}`);
  console.log(`Filas: ${report.totalRows}`);
  console.log(`Resultado: ${JSON.stringify(report.summary)}`);
  console.log(`Cuentas de la app: ${JSON.stringify(report.accounts)}`);
  for (const row of report.rows.filter((r) => r.status === 'CONFLICT' || r.status === 'ERROR')) {
    console.log(`  línea ${row.line} [${row.status}] ${row.name || '(sin nombre)'}: ${row.detail}`);
  }
  console.log(`Reporte: ${reportPath}`);
}

main()
  .catch((error) => {
    console.error('Importación de padrón fallida');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
