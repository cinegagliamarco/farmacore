import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { AppConfigService } from '../config/app-config.service';

const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Cloudflare R2 (S3-compatible) uploader. Port of legacy BucketService —
 * downloads a source image and re-hosts it on our bucket, returning the
 * public URL. Resize (legacy used sharp) is omitted to avoid a native
 * dependency in the Alpine image; the original bytes are uploaded as-is.
 */
@Injectable()
export class R2StorageService {
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

  /** Download `sourceUrl` and store it at `key`; returns the public URL.
   *  Throws on download/upload failure — callers decide the fallback. */
  public async uploadFromUrl(sourceUrl: string, key: string): Promise<string> {
    const { data, headers } = await this.http.axiosRef.get<ArrayBuffer>(
      sourceUrl,
      {
        responseType: 'arraybuffer',
        timeout: DOWNLOAD_TIMEOUT_MS,
        maxContentLength: MAX_IMAGE_BYTES,
        maxBodyLength: MAX_IMAGE_BYTES,
      },
    );
    const fullKey = `${this.keyPrefix}${key}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: fullKey,
        Body: Buffer.from(data),
        ContentType:
          (headers['content-type'] as string | undefined) ?? 'image/jpeg',
      }),
    );
    return `${this.publicBase}/${fullKey}`;
  }
}
