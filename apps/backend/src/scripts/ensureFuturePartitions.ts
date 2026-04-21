import { prisma } from '../prisma';

const MONTHS_AHEAD = Number(process.env.PARTITION_MONTHS_AHEAD || 3);
const TABLES = ['Event', 'OutboxMessage', 'AuditLog'] as const;

const monthStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
const addMonths = (date: Date, months: number) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
const formatPartitionSuffix = (date: Date) =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

const isPartitioned = async (tableName: string) => {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_partitioned_table pt
      JOIN pg_class c ON c.oid = pt.partrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = ${tableName}
        AND n.nspname = 'public'
    ) AS "exists"
  `;

  return Boolean(rows[0]?.exists);
};

const ensurePartition = async (tableName: string, from: Date, to: Date) => {
  const suffix = formatPartitionSuffix(from);
  const partitionName = `"${tableName}_${suffix}"`;
  const parentName = `"${tableName}"`;

  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS ${partitionName} PARTITION OF ${parentName} FOR VALUES FROM ('${from.toISOString()}') TO ('${to.toISOString()}')`
  );

  return partitionName.replace(/"/g, '');
};

const run = async () => {
  const results: Array<Record<string, unknown>> = [];

  for (const tableName of TABLES) {
    const partitioned = await isPartitioned(tableName);
    if (!partitioned) {
      results.push({
        tableName,
        status: 'skipped',
        reason: 'table_not_partitioned'
      });
      continue;
    }

    const created: string[] = [];
    const start = monthStart(new Date());
    for (let offset = 0; offset < MONTHS_AHEAD; offset += 1) {
      const from = addMonths(start, offset);
      const to = addMonths(start, offset + 1);
      created.push(await ensurePartition(tableName, from, to));
    }

    results.push({
      tableName,
      status: 'ok',
      created
    });
  }

  console.log(JSON.stringify({ ok: true, results }));
  await prisma.$disconnect();
};

run().catch(async (error) => {
  console.error('[ERROR] ensure_future_partitions:', error);
  await prisma.$disconnect();
  process.exit(1);
});
