import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  MultipartFileError,
  readMultipartFile,
} from './multipart-file.js';

const BOUNDARY = '----OpenImportTestBoundary';

function buildMultipart(
  parts: Array<{
    name: string;
    filename?: string;
    contentType?: string;
    body: Buffer | string;
  }>,
  options?: { close?: boolean },
): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`;
    const headers = [
      `--${BOUNDARY}`,
      `Content-Disposition: ${disposition}`,
    ];
    if (part.filename) {
      headers.push(
        `Content-Type: ${part.contentType ?? 'text/csv'}`,
      );
    }
    chunks.push(Buffer.from(`${headers.join('\r\n')}\r\n\r\n`, 'utf8'));
    chunks.push(
      Buffer.isBuffer(part.body) ? part.body : Buffer.from(part.body, 'utf8'),
    );
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  if (options?.close !== false) {
    chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`, 'utf8'));
  }
  return Buffer.concat(chunks);
}

function fakeRequest(body: Buffer): IncomingMessage {
  const stream = Readable.from([body]) as IncomingMessage;
  stream.headers = {
    'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
  };
  return stream;
}

async function drain(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('readMultipartFile', () => {
  it('accepts exactly one file field named file', async () => {
    const csv = 'sku,name\nA1,Widget\n';
    const multipart = await readMultipartFile(
      fakeRequest(
        buildMultipart([
          { name: 'file', filename: 'products.csv', body: csv },
        ]),
      ),
    );

    expect(multipart.filename).toBe('products.csv');
    expect((await drain(multipart.stream)).toString('utf8')).toBe(csv);
    await expect(multipart.completed).resolves.toBeUndefined();
  });

  it('rejects two file parts', async () => {
    const body = buildMultipart([
      { name: 'file', filename: 'a.csv', body: 'sku\n1\n' },
      { name: 'file', filename: 'b.csv', body: 'sku\n2\n' },
    ]);

    const multipart = await readMultipartFile(fakeRequest(body));
    await drain(multipart.stream).catch(() => undefined);
    await expect(multipart.completed).rejects.toBeInstanceOf(MultipartFileError);
    await expect(multipart.completed).rejects.toMatchObject({
      code: 'VALIDATION.FAILED',
    });
  });

  it('rejects a file with the wrong field name', async () => {
    await expect(
      readMultipartFile(
        fakeRequest(
          buildMultipart([
            { name: 'csv', filename: 'products.csv', body: 'sku\n1\n' },
          ]),
        ),
      ),
    ).rejects.toBeInstanceOf(MultipartFileError);
  });

  it('rejects an additional text field', async () => {
    const body = buildMultipart([
      { name: 'note', body: 'hello' },
      { name: 'file', filename: 'products.csv', body: 'sku\n1\n' },
    ]);

    await expect(readMultipartFile(fakeRequest(body))).rejects.toBeInstanceOf(
      MultipartFileError,
    );
  });

  it('rejects a truncated multipart body', async () => {
    const truncated = buildMultipart(
      [{ name: 'file', filename: 'products.csv', body: 'sku\n1\n' }],
      { close: false },
    );

    const multipartOrError = readMultipartFile(fakeRequest(truncated));
    await expect(
      multipartOrError.then(async (multipart) => {
        await drain(multipart.stream).catch(() => undefined);
        await multipart.completed;
      }),
    ).rejects.toBeInstanceOf(MultipartFileError);
  });

  it('surfaces a late Busboy error through completed', async () => {
    const csv = 'sku,name\nA1,Widget\n';
    const stream = new Readable({
      read() {
        // filled below
      },
    }) as IncomingMessage & EventEmitter;
    stream.headers = {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
    };

    const complete = buildMultipart([
      { name: 'file', filename: 'products.csv', body: csv },
    ]);
    const headerEnd = complete.indexOf('\r\n\r\n') + 4;
    queueMicrotask(() => {
      stream.push(complete.subarray(0, headerEnd + 8));
    });

    const multipart = await readMultipartFile(stream);
    stream.emit('error', new Error('socket hang up'));
    stream.push(null);

    await expect(multipart.completed).rejects.toBeInstanceOf(MultipartFileError);
  });

  it('aborts an opened file stream and settles completed', async () => {
    const body = Buffer.alloc(64 * 1024, 0x61);
    const multipart = await readMultipartFile(
      fakeRequest(
        buildMultipart([
          { name: 'file', filename: 'products.csv', body },
        ]),
      ),
    );

    expect(typeof multipart.abort).toBe('function');
    multipart.abort();
    multipart.abort();

    expect(
      multipart.stream.destroyed || multipart.stream.readableEnded,
    ).toBe(true);
    await expect(multipart.completed).rejects.toBeInstanceOf(MultipartFileError);
  });

  it('can abort more than once without throwing', async () => {
    const multipart = await readMultipartFile(
      fakeRequest(
        buildMultipart([
          { name: 'file', filename: 'products.csv', body: 'sku\n1\n' },
        ]),
      ),
    );

    expect(() => {
      multipart.abort();
      multipart.abort();
    }).not.toThrow();
  });

  it('drains a non-multipart request body', async () => {
    const payload = Buffer.alloc(32 * 1024, 0x7b);
    const req = Readable.from([payload]) as IncomingMessage;
    req.headers = { 'content-type': 'application/json' };

    await expect(readMultipartFile(req)).rejects.toBeInstanceOf(
      MultipartFileError,
    );

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(req.readableEnded || req.destroyed).toBe(true);
  });

  it('rejects multipart/form-data without a boundary as MultipartFileError', async () => {
    const req = Readable.from([Buffer.from('ignored')]) as IncomingMessage;
    req.headers = { 'content-type': 'multipart/form-data' };

    await expect(readMultipartFile(req)).rejects.toBeInstanceOf(
      MultipartFileError,
    );
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(req.readableEnded || req.destroyed).toBe(true);
  });

  it('rejects an invalid multipart boundary as MultipartFileError', async () => {
    const req = Readable.from([Buffer.from('ignored')]) as IncomingMessage;
    req.headers = {
      'content-type': 'multipart/form-data; boundary=',
    };

    await expect(readMultipartFile(req)).rejects.toMatchObject({
      code: 'VALIDATION.FAILED',
    });
  });
});
