#!/usr/bin/env ts-node
import 'dotenv/config';
import { prisma } from '../src/prisma';
import { encryptIntegrationSecret } from '../src/utils/integrationSecrets';

type Args = {
  clubId?: string;
  environment?: 'TEST' | 'PRODUCTION';
  issuerTaxId?: string;
  issuerTaxCondition?: string;
  issuerLegalName?: string;
  pointOfSaleNumber?: string;
  certificatePem?: string;
  privateKeyPem?: string;
};

const parseArgs = (): Args => {
  const out: Args = {};
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.split('=');
    const key = k.replace(/^--/, '');
    (out as any)[key] = v;
  }
  return out;
};

async function main() {
  const args = parseArgs();
  const clubId = Number(args.clubId || process.env.SEED_CLUB_ID || process.env.CLUB_ID || 1);
  const environment = (args.environment || process.env.SEED_ENVIRONMENT || 'TEST') as 'TEST' | 'PRODUCTION';
  const issuerTaxId = args.issuerTaxId || process.env.SEED_ISSUER_TAX_ID || '20304050607';
  const issuerTaxCondition = (args.issuerTaxCondition || process.env.SEED_ISSUER_TAX_CONDITION || 'RESPONSABLE_INSCRIPTO') as any;
  const issuerLegalName = args.issuerLegalName || process.env.SEED_ISSUER_LEGAL_NAME || 'Club Prueba SRL';
  const pointOfSaleNumber = Number(args.pointOfSaleNumber || process.env.SEED_POS || '1');
  const certificatePem = args.certificatePem || process.env.SEED_CERT_PEM || 'CERT_PEM_PLACEHOLDER_'.repeat(4);
  const privateKeyPem = args.privateKeyPem || process.env.SEED_KEY_PEM || 'PRIVATE_KEY_PEM_PLACEHOLDER_'.repeat(4);

  console.log('Seeding BillingIntegration with:');
  console.log({ clubId, environment, issuerTaxId, issuerTaxCondition, issuerLegalName, pointOfSaleNumber });

  const existing = await prisma.billingIntegration.findFirst({ where: { clubId, environment } });
  const data: any = {
    clubId,
    environment,
    status: 'CONNECTED',
    issuerTaxId,
    issuerTaxCondition,
    issuerLegalName,
    pointOfSaleNumber,
    certificateEnc: encryptIntegrationSecret(certificatePem),
    privateKeyEnc: encryptIntegrationSecret(privateKeyPem)
  };

  if (existing) {
    const updated = await prisma.billingIntegration.update({ where: { id: existing.id }, data });
    console.log('Updated BillingIntegration:', updated.id);
  } else {
    const created = await prisma.billingIntegration.create({ data });
    console.log('Created BillingIntegration:', created.id);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed', err);
  process.exit(1);
});
