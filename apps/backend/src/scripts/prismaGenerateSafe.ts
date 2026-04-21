import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const MAX_RETRIES = Number(process.env.PRISMA_GENERATE_RETRIES || 4);
const RETRY_DELAY_MS = Number(process.env.PRISMA_GENERATE_RETRY_DELAY_MS || 1200);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isWindowsEngineLockError = (stderr: string) =>
  stderr.includes('EPERM') &&
  stderr.includes('query_engine-windows.dll.node') &&
  stderr.includes('rename');

const hasGeneratedClient = () => {
  const clientPath = join(process.cwd(), 'node_modules', '.prisma', 'client', 'index.js');
  return existsSync(clientPath);
};

const runGenerateOnce = () => {
  const result = spawnSync('npx', ['prisma', 'generate'], {
    stdio: 'pipe',
    shell: true,
    encoding: 'utf-8'
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
};

const main = async () => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const run = runGenerateOnce();

    if (run.ok) {
      process.stdout.write(run.stdout);
      return;
    }

    const lockError = isWindowsEngineLockError(run.stderr);
    const lastAttempt = attempt === MAX_RETRIES;

    if (!lockError) {
      process.stderr.write(run.stderr || `prisma generate failed with code ${run.status}\n`);
      process.exit(1);
    }

    if (!lastAttempt) {
      process.stderr.write(
        `[prisma-generate-safe] intento ${attempt}/${MAX_RETRIES} falló por lock de engine. Reintentando en ${RETRY_DELAY_MS}ms...\n`
      );
      await sleep(RETRY_DELAY_MS);
      continue;
    }

    if (hasGeneratedClient()) {
      process.stderr.write(
        '[prisma-generate-safe] prisma generate sigue bloqueado por lock de engine en Windows. Se continúa usando el cliente ya generado.\n'
      );
      return;
    }

    process.stderr.write(run.stderr || '[prisma-generate-safe] prisma generate failed and no generated client was found.\n');
    process.exit(1);
  }
};

void main();
