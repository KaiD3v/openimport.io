import type { Readable } from 'node:stream';
import type { ObjectStorage } from './object-storage.port.js';

export class UploadCleanupError extends Error {
  readonly cause: unknown;
  readonly cleanupMessage: string;

  constructor(original: unknown, cleanup: unknown) {
    const originalMessage =
      original instanceof Error ? original.message : 'Upload processing failed.';
    const cleanupMessage =
      cleanup instanceof Error ? cleanup.message : 'Object cleanup failed.';
    super(originalMessage);
    this.name = 'UploadCleanupError';
    this.cause = original;
    this.cleanupMessage = cleanupMessage;
  }
}

type CleanupLogger = {
  error(message: string): void;
};

function discardReadable(stream: Readable): void {
  stream.on('error', () => undefined);
  if (!stream.readableEnded && !stream.destroyed) {
    stream.resume();
  }
}

export async function persistUploadWithCleanup<T>(options: {
  storage: ObjectStorage;
  key: string;
  body: Readable;
  contentType?: string;
  afterStored: (opened: Readable) => Promise<T>;
  logger?: CleanupLogger;
}): Promise<T> {
  await options.storage.putObject(options.key, options.body, {
    contentType: options.contentType,
  });

  let opened: Readable | undefined;
  try {
    opened = await options.storage.openObject(options.key);
    return await options.afterStored(opened);
  } catch (error) {
    if (opened) {
      discardReadable(opened);
    }
    try {
      await options.storage.deleteObject(options.key);
    } catch (cleanupError) {
      options.logger?.error(
        `Failed to delete invalid object key=${options.key} cleanup=${
          cleanupError instanceof Error ? cleanupError.message : 'unknown'
        }`,
      );
      throw new UploadCleanupError(error, cleanupError);
    }
    throw error;
  }
}
