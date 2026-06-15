import crypto from 'crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ErrorCodes, badRequest, conflict } from '../errors';

const DEFAULT_MAX_INLINE_BYTES = Number(process.env.MAX_INLINE_MEDIA_BYTES || 350_000);
const DEFAULT_S3_PREFIX = process.env.S3_PREFIX?.trim() || 'clubs-assets';

let s3Client: S3Client | null = null;

const isDataUrl = (value: string) => value.startsWith('data:');

const estimateDataUrlBytes = (value: string) => {
  const base64Index = value.indexOf('base64,');
  if (base64Index === -1) return value.length;
  const base64Payload = value.slice(base64Index + 'base64,'.length);
  return Math.floor((base64Payload.length * 3) / 4);
};

const extensionByContentType: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg'
};

const parseDataUrl = (value: string) => {
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw badRequest('Formato de data URL inválido', ErrorCodes.INVALID_INPUT);
  }

  const [, contentType, rawBase64] = match;
  return {
    contentType,
    buffer: Buffer.from(rawBase64, 'base64')
  };
};

const getS3Client = () => {
  if (s3Client) return s3Client;

  const region = process.env.S3_REGION?.trim();
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();

  if (!region || !accessKeyId || !secretAccessKey) {
    throw conflict('Faltan credenciales/configuración S3 para almacenar assets', ErrorCodes.CLUB_CONFIG_INVALID);
  }

  s3Client = new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  });

  return s3Client;
};

export class MediaStorageService {
  async normalizeAsset(value: string | null | undefined, fieldName: string) {
    if (value == null) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (!isDataUrl(trimmed)) {
      return trimmed;
    }

    const storageMode = String(process.env.MEDIA_STORAGE_MODE || 'inline').toLowerCase();
    if (storageMode === 'external-url') {
      throw badRequest(`${fieldName} debe almacenarse en object storage y enviarse como URL externa`, ErrorCodes.INVALID_INPUT);
    }

    const estimatedBytes = estimateDataUrlBytes(trimmed);
    if (estimatedBytes > DEFAULT_MAX_INLINE_BYTES && storageMode !== 's3') {
      throw badRequest(`${fieldName} excede el tamaño máximo inline permitido`, ErrorCodes.INVALID_INPUT);
    }

    if (storageMode === 's3') {
      return this.uploadDataUrl(trimmed, fieldName);
    }

    return trimmed;
  }

  private async uploadDataUrl(value: string, fieldName: string) {
    const bucket = process.env.S3_BUCKET?.trim();
    if (!bucket) {
      throw conflict('Falta S3_BUCKET para almacenar assets', ErrorCodes.CLUB_CONFIG_INVALID);
    }

    const { contentType, buffer } = parseDataUrl(value);
    const extension = extensionByContentType[contentType];
    if (!extension) {
      throw badRequest(`Tipo de archivo no soportado para ${fieldName}: ${contentType}`, ErrorCodes.INVALID_INPUT);
    }

    const objectKey = [
      DEFAULT_S3_PREFIX.replace(/\/+$/, ''),
      fieldName,
      `${Date.now()}-${crypto.randomUUID()}.${extension}`
    ].join('/');

    const client = getS3Client();
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable'
    }));

    return this.buildPublicUrl(bucket, objectKey);
  }

  private buildPublicUrl(bucket: string, objectKey: string) {
    const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL?.trim();
    if (publicBaseUrl) {
      return `${publicBaseUrl.replace(/\/+$/, '')}/${objectKey}`;
    }

    const endpoint = process.env.S3_ENDPOINT?.trim();
    if (endpoint) {
      return `${endpoint.replace(/\/+$/, '')}/${bucket}/${objectKey}`;
    }

    const region = process.env.S3_REGION?.trim();
    if (!region) {
      throw conflict('Falta S3_REGION para construir la URL pública del asset', ErrorCodes.CLUB_CONFIG_INVALID);
    }

    return `https://${bucket}.s3.${region}.amazonaws.com/${objectKey}`;
  }
}
