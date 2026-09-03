import { Transform } from 'node:stream';
import { createHash, type Hash } from 'node:crypto';

export class FileTooLargeError extends Error {
  readonly code = 'IMPORT.FILE_TOO_LARGE';

  constructor(message = 'Uploaded file exceeds the configured size limit.') {
    super(message);
    this.name = 'FileTooLargeError';
  }
}

export class HashAndLimitTransform extends Transform {
  private readonly hash: Hash = createHash('sha256');
  private size = 0;
  private digestHex = '';

  constructor(private readonly maxBytes: number) {
    super();
  }

  get byteSize(): number {
    return this.size;
  }

  digest(): string {
    return this.digestHex;
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.size += buffer.length;
    if (this.size > this.maxBytes) {
      callback(new FileTooLargeError());
      return;
    }
    this.hash.update(buffer);
    callback(null, buffer);
  }

  override _flush(callback: (error?: Error | null) => void): void {
    this.digestHex = this.hash.digest('hex');
    callback();
  }
}
