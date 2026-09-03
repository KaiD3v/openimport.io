import { Injectable, Logger } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'node:stream';
import type { Env } from '../../core/config/env.js';
import type {
  ObjectStorage,
  PutObjectOptions,
} from './object-storage.port.js';

export type S3CommandSender = {
  send: (command: unknown) => Promise<unknown>;
};

export function isMissingBucketError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    err.name === 'NotFound' ||
    err.name === 'NoSuchBucket' ||
    err.$metadata?.httpStatusCode === 404
  );
}

@Injectable()
export class S3ObjectStorage implements ObjectStorage {
  private readonly logger = new Logger(S3ObjectStorage.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly allowCreate: boolean;
  private bucketReady: Promise<void> | undefined;

  constructor(env: Env, client?: S3CommandSender) {
    this.bucket = env.S3_BUCKET;
    this.allowCreate =
      env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
    this.client = client
      ? (client as unknown as S3Client)
      : new S3Client({
          region: env.S3_REGION,
          endpoint: env.S3_ENDPOINT,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
          credentials: {
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          },
        });
  }

  async putObject(
    key: string,
    body: Readable,
    options?: PutObjectOptions,
  ): Promise<void> {
    await this.ensureReady();
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: options?.contentType,
      },
    });
    await upload.done();
  }

  async openObject(key: string): Promise<Readable> {
    await this.ensureReady();
    const result = (await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    )) as {
      Body?: Readable | { transformToWebStream?: () => ReadableStream };
    };
    if (!result.Body) {
      throw new Error('Object body stream is unavailable.');
    }
    if (result.Body instanceof Readable) {
      return result.Body;
    }
    const body = result.Body;
    if (typeof body.transformToWebStream === 'function') {
      const webStream = body.transformToWebStream();
      return Readable.from(
        (async function* () {
          const reader = webStream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            yield Buffer.from(value);
          }
        })(),
      );
    }
    throw new Error('Object body stream is unavailable.');
  }

  async deleteObject(key: string): Promise<void> {
    await this.ensureReady();
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  ensureReady(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = this.createBucketIfMissing().catch((error) => {
        this.bucketReady = undefined;
        throw error;
      });
    }
    return this.bucketReady;
  }

  private async createBucketIfMissing(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch (error) {
      if (!this.allowCreate || !isMissingBucketError(error)) {
        throw error;
      }
    }

    await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    this.logger.log('Ensured object storage bucket is available.');
  }
}
