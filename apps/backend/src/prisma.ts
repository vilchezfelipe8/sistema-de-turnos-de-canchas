// src/prisma.ts
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
export const prismaRead = process.env.READ_DATABASE_URL
  ? new PrismaClient({
      datasources: {
        db: {
          url: process.env.READ_DATABASE_URL
        }
      }
    })
  : prisma;

