import { Request, Response } from 'express';
import { prisma } from '../prisma'; // Asegurate que esta ruta sea la correcta a tu instancia de prisma
import os from 'os';

// Variables globales para calcular el delta de CPU
let lastCpuSnapshot: { idle: number; total: number } | null = null;

const getCpuSnapshot = () => {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      total += (cpu.times as any)[type];
    }
    idle += cpu.times.idle;
  }
  return { idle, total };
};

export const getSystemHealth = async (req: Request, res: Response) => {
  try {
    // 1. Medir CPU (Comparando con la última foto)
    const currentCpu = getCpuSnapshot();
    let cpuUsagePercent = 0;

    if (lastCpuSnapshot) {
      const idleDiff = currentCpu.idle - lastCpuSnapshot.idle;
      const totalDiff = currentCpu.total - lastCpuSnapshot.total;
      // Porcentaje de uso = 1 - (tiempo libre / tiempo total)
      cpuUsagePercent = totalDiff === 0 ? 0 : 100 - Math.round((100 * idleDiff) / totalDiff);
    }
    
    // Guardamos la foto actual para la próxima vez
    lastCpuSnapshot = currentCpu;

    // 2. Medir Base de Datos
    const startDb = process.hrtime();
    await prisma.$queryRaw`SELECT 1`;
    const endDb = process.hrtime(startDb);
    const dbLatencyMs = (endDb[0] * 1000 + endDb[1] / 1e6).toFixed(2);

    // 3. Memoria
    const memoryUsage = process.memoryUsage();
    
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      database: {
        status: 'Connected',
        latency: `${dbLatencyMs} ms`
      },
      server: {
        uptime: formatUptime(process.uptime()),
        memory: {
          rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`,
          heap: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`
        },
        cpu: {
            usage: `${cpuUsagePercent}%`, // <--- El dato nuevo
            cores: os.cpus().length,
            model: os.cpus()[0].model
        },
        platform: `${os.type()} ${os.release()} (${os.arch()})`
      }
    });

  } catch (error: any) {
    res.status(500).json({ status: 'ERROR', error: error.message });
  }
};

function formatUptime(seconds: number) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d}d ${h}h ${m}m ${s}s`;
}