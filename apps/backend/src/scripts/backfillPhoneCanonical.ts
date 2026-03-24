import path from 'node:path';
import fs from 'node:fs/promises';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { normalizeIdentityPhone } from '../utils/phone';

type Args = {
  apply: boolean;
  reportPath?: string;
  limitUsers?: number;
  limitClients?: number;
};

type ClientRow = {
  id: string;
  clubId: number;
  phone: string | null;
  clubCountry: string;
};

type UserRow = {
  id: number;
  phoneNumber: string;
  membershipCountries: string[];
};

type ClientEntry = {
  id: string;
  clubId: number;
  currentPhone: string | null;
  normalizedPhone: string | null;
  status:
    | 'NO_PHONE'
    | 'ALREADY_CANONICAL'
    | 'UPDATED'
    | 'DRY_RUN_UPDATE'
    | 'CONFLICT_SAME_TARGET'
    | 'INVALID_PHONE'
    | 'UPDATE_FAILED';
  detail?: string;
};

type UserEntry = {
  id: number;
  currentPhone: string;
  normalizedPhone: string | null;
  status:
    | 'ALREADY_CANONICAL'
    | 'UPDATED'
    | 'DRY_RUN_UPDATE'
    | 'INVALID_PHONE'
    | 'AMBIGUOUS_NO_COUNTRY_CONTEXT'
    | 'UPDATE_FAILED';
  detail?: string;
};

const parseArgs = (argv: string[]): Args => {
  const args: Args = { apply: false };
  for (const raw of argv) {
    if (raw === '--apply') {
      args.apply = true;
      continue;
    }
    if (raw.startsWith('--report=')) {
      args.reportPath = raw.split('=').slice(1).join('=').trim();
      continue;
    }
    if (raw.startsWith('--limit-users=')) {
      const n = Number(raw.split('=').slice(1).join('='));
      if (Number.isFinite(n) && n > 0) args.limitUsers = Math.floor(n);
      continue;
    }
    if (raw.startsWith('--limit-clients=')) {
      const n = Number(raw.split('=').slice(1).join('='));
      if (Number.isFinite(n) && n > 0) args.limitClients = Math.floor(n);
    }
  }
  return args;
};

const nowStamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const hasExplicitIntlPrefix = (value: string) => {
  const raw = String(value || '').trim();
  return raw.startsWith('+') || raw.startsWith('00');
};

const resolveReportPath = async (input?: string) => {
  if (input) return path.resolve(process.cwd(), input);
  const dir = path.resolve(process.cwd(), 'reports', 'phone-backfill');
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, `phone-backfill-${nowStamp()}.json`);
};

const loadClients = async (limit?: number): Promise<ClientRow[]> => {
  const rows = await prisma.client.findMany({
    take: limit,
    orderBy: { id: 'asc' },
    select: {
      id: true,
      clubId: true,
      phone: true,
      club: {
        select: {
          country: true
        }
      }
    }
  });

  return rows.map((row) => ({
    id: row.id,
    clubId: row.clubId,
    phone: row.phone,
    clubCountry: String(row.club?.country || '').trim()
  }));
};

const loadUsers = async (limit?: number): Promise<UserRow[]> => {
  const rows = await prisma.user.findMany({
    take: limit,
    orderBy: { id: 'asc' },
    select: {
      id: true,
      phoneNumber: true,
      memberships: {
        select: {
          club: {
            select: { country: true }
          }
        }
      }
    }
  });

  return rows.map((row) => {
    const countries = Array.from(
      new Set(
        row.memberships
          .map((membership) => String(membership.club?.country || '').trim().toUpperCase())
          .filter(Boolean)
      )
    );
    return {
      id: row.id,
      phoneNumber: row.phoneNumber,
      membershipCountries: countries
    };
  });
};

const backfillClients = async (clients: ClientRow[], apply: boolean): Promise<ClientEntry[]> => {
  const pre = clients.map((row) => {
    const currentPhone = row.phone ? String(row.phone).trim() : null;
    if (!currentPhone) {
      return {
        row,
        currentPhone,
        normalizedPhone: null,
        prelimStatus: 'NO_PHONE' as const
      };
    }

    const normalizedPhone = normalizeIdentityPhone(
      { phone: currentPhone },
      { defaultCountryIso2: row.clubCountry || null }
    );

    if (!normalizedPhone) {
      return {
        row,
        currentPhone,
        normalizedPhone: null,
        prelimStatus: 'INVALID_PHONE' as const
      };
    }

    if (normalizedPhone === currentPhone) {
      return {
        row,
        currentPhone,
        normalizedPhone,
        prelimStatus: 'ALREADY_CANONICAL' as const
      };
    }

    return {
      row,
      currentPhone,
      normalizedPhone,
      prelimStatus: 'CANDIDATE_UPDATE' as const
    };
  });

  const targetMap = new Map<string, Set<string>>();
  for (const item of pre) {
    const targetPhone =
      item.prelimStatus === 'CANDIDATE_UPDATE'
        ? item.normalizedPhone
        : item.currentPhone;
    if (!targetPhone) continue;
    const key = `${item.row.clubId}::${targetPhone}`;
    if (!targetMap.has(key)) targetMap.set(key, new Set<string>());
    targetMap.get(key)?.add(item.row.id);
  }

  const entries: ClientEntry[] = [];
  for (const item of pre) {
    if (item.prelimStatus !== 'CANDIDATE_UPDATE') {
      entries.push({
        id: item.row.id,
        clubId: item.row.clubId,
        currentPhone: item.currentPhone,
        normalizedPhone: item.normalizedPhone,
        status: item.prelimStatus
      });
      continue;
    }

    const key = `${item.row.clubId}::${item.normalizedPhone}`;
    const idsForTarget = targetMap.get(key);
    const hasCollision = Boolean(idsForTarget && idsForTarget.size > 1);
    if (hasCollision) {
      entries.push({
        id: item.row.id,
        clubId: item.row.clubId,
        currentPhone: item.currentPhone,
        normalizedPhone: item.normalizedPhone,
        status: 'CONFLICT_SAME_TARGET',
        detail: `target=${item.normalizedPhone}; ids=${Array.from(idsForTarget || []).join(',')}`
      });
      continue;
    }

    if (!apply) {
      entries.push({
        id: item.row.id,
        clubId: item.row.clubId,
        currentPhone: item.currentPhone,
        normalizedPhone: item.normalizedPhone,
        status: 'DRY_RUN_UPDATE'
      });
      continue;
    }

    try {
      await prisma.client.update({
        where: { id: item.row.id },
        data: { phone: item.normalizedPhone }
      });
      entries.push({
        id: item.row.id,
        clubId: item.row.clubId,
        currentPhone: item.currentPhone,
        normalizedPhone: item.normalizedPhone,
        status: 'UPDATED'
      });
    } catch (error: any) {
      const isUniqueError =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      entries.push({
        id: item.row.id,
        clubId: item.row.clubId,
        currentPhone: item.currentPhone,
        normalizedPhone: item.normalizedPhone,
        status: 'UPDATE_FAILED',
        detail: isUniqueError ? 'P2002 unique collision' : String(error?.message || error)
      });
    }
  }

  return entries;
};

const backfillUsers = async (users: UserRow[], apply: boolean): Promise<UserEntry[]> => {
  const entries: UserEntry[] = [];

  for (const row of users) {
    const currentPhone = String(row.phoneNumber || '').trim();
    const uniqueCountry =
      row.membershipCountries.length === 1 ? row.membershipCountries[0] : null;

    if (!hasExplicitIntlPrefix(currentPhone) && !uniqueCountry) {
      entries.push({
        id: row.id,
        currentPhone,
        normalizedPhone: null,
        status: 'AMBIGUOUS_NO_COUNTRY_CONTEXT',
        detail: row.membershipCountries.length > 1
          ? `multiple club countries: ${row.membershipCountries.join(',')}`
          : 'no club country context'
      });
      continue;
    }

    const normalizedPhone = normalizeIdentityPhone(
      { phone: currentPhone },
      { defaultCountryIso2: uniqueCountry }
    );

    if (!normalizedPhone) {
      entries.push({
        id: row.id,
        currentPhone,
        normalizedPhone: null,
        status: 'INVALID_PHONE'
      });
      continue;
    }

    if (normalizedPhone === currentPhone) {
      entries.push({
        id: row.id,
        currentPhone,
        normalizedPhone,
        status: 'ALREADY_CANONICAL'
      });
      continue;
    }

    if (!apply) {
      entries.push({
        id: row.id,
        currentPhone,
        normalizedPhone,
        status: 'DRY_RUN_UPDATE'
      });
      continue;
    }

    try {
      await prisma.user.update({
        where: { id: row.id },
        data: { phoneNumber: normalizedPhone }
      });
      entries.push({
        id: row.id,
        currentPhone,
        normalizedPhone,
        status: 'UPDATED'
      });
    } catch (error: any) {
      entries.push({
        id: row.id,
        currentPhone,
        normalizedPhone,
        status: 'UPDATE_FAILED',
        detail: String(error?.message || error)
      });
    }
  }

  return entries;
};

const summarizeByStatus = <T extends { status: string }>(rows: T[]) => {
  const map: Record<string, number> = {};
  for (const row of rows) {
    map[row.status] = (map[row.status] || 0) + 1;
  }
  return map;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const clients = await loadClients(args.limitClients);
  const users = await loadUsers(args.limitUsers);

  const clientResults = await backfillClients(clients, args.apply);
  const userResults = await backfillUsers(users, args.apply);

  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    scanned: {
      clients: clients.length,
      users: users.length
    },
    summary: {
      clients: summarizeByStatus(clientResults),
      users: summarizeByStatus(userResults)
    },
    conflicts: {
      clients: clientResults.filter((row) => row.status === 'CONFLICT_SAME_TARGET' || row.status === 'UPDATE_FAILED'),
      users: userResults.filter((row) => row.status === 'UPDATE_FAILED')
    },
    ambiguousUsers: userResults.filter((row) => row.status === 'AMBIGUOUS_NO_COUNTRY_CONTEXT'),
    invalid: {
      clients: clientResults.filter((row) => row.status === 'INVALID_PHONE'),
      users: userResults.filter((row) => row.status === 'INVALID_PHONE')
    },
    plannedOrAppliedUpdates: {
      clients: clientResults.filter((row) => row.status === 'DRY_RUN_UPDATE' || row.status === 'UPDATED'),
      users: userResults.filter((row) => row.status === 'DRY_RUN_UPDATE' || row.status === 'UPDATED')
    }
  };

  const reportPath = await resolveReportPath(args.reportPath);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('Phone backfill finished');
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Scanned: users=${users.length}, clients=${clients.length}`);
  console.log(`Client summary: ${JSON.stringify(report.summary.clients)}`);
  console.log(`User summary: ${JSON.stringify(report.summary.users)}`);
  console.log(`Report: ${reportPath}`);
}

main()
  .catch((error) => {
    console.error('Phone backfill failed');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
