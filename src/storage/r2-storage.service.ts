import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { AppConfigService } from '../config/app-config.service';

const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DIMENSION = 800;

// Don't retain decoded image data in libvips' cache during bulk uploads.
sharp.cache(false);

/**
 * Cloudflare R2 (S3-compatible) uploader. Port of legacy BucketService —
 * downloads a source image, resizes it (≤800×800, jpeg q80), and re-hosts
 * it on our bucket, returning the public URL.
 */
@Injectable()
export class R2StorageService {
  private readonly logger = new Logger(R2StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly keyPrefix: string;
  private readonly publicBase: string;

  constructor(
    private readonly http: HttpService,
    config: AppConfigService,
  ) {
    const r2 = config.r2;
    this.bucket = r2.bucket;
    this.keyPrefix = r2.keyPrefix;
    this.publicBase = r2.publicDomain || `${r2.endpoint}/${r2.bucket}`;
    this.client = new S3Client({
      region: 'auto',
      endpoint: r2.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: r2.accessKeyId,
        secretAccessKey: r2.secretAccessKey,
      },
    });
  }

  /** Download `sourceUrl`, resize, and store it at `key`; returns the
   *  public URL. Throws on download/upload failure — callers decide the
   *  fallback. */
  public async uploadFromUrl(sourceUrl: string, key: string): Promise<string> {
    const { data } = await this.http.axiosRef.get<ArrayBuffer>(sourceUrl, {
      responseType: 'arraybuffer',
      timeout: DOWNLOAD_TIMEOUT_MS,
      maxContentLength: MAX_IMAGE_BYTES,
      maxBodyLength: MAX_IMAGE_BYTES,
    });
    const { body, contentType } = await this.resize(Buffer.from(data));
    const fullKey = `${this.keyPrefix}${key}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: fullKey,
        Body: body,
        ContentType: contentType,
      }),
    );
    return `${this.publicBase}/${fullKey}`;
  }

  /** Resize to ≤800×800 (contain, white bg) jpeg q80, mirroring legacy.
   *  Falls back to the original bytes if sharp can't process the image. */
  private async resize(
    original: Buffer,
  ): Promise<{ body: Buffer; contentType: string }> {
    try {
      const body = await sharp(original)
        .resize(MAX_DIMENSION, MAX_DIMENSION, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .jpeg({ quality: 80 })
        .toBuffer();
      return { body, contentType: 'image/jpeg' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`resize failed, uploading original: ${message}`);
      return { body: original, contentType: 'image/jpeg' };
    }
  }
}
