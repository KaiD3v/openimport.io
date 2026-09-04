import type { Readable } from 'node:stream';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export type PutObjectOptions = {
  contentType?: string;
};

export interface ObjectStorage {
  putObject(
    key: string,
    body: Readable,
    options?: PutObjectOptions,
  ): Promise<void>;
  openObject(key: string): Promise<Readable>;
  deleteObject(key: string): Promise<void>;
  /** Non-mutating readiness probe (HeadBucket only). */
  checkReady(options?: { signal?: AbortSignal }): Promise<void>;
}
