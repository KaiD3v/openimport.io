import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import Busboy from 'busboy';
import type { Request } from 'express';

export class MultipartFileError extends Error {
  readonly code = 'VALIDATION.FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'MultipartFileError';
  }
}

export type MultipartFile = {
  stream: Readable;
  filename: string;
  mimeType: string;
  completed: Promise<void>;
  abort: () => void;
};

function discard(stream: Readable): void {
  stream.on('error', () => undefined);
  if (!stream.destroyed && !stream.readableEnded) {
    stream.resume();
  }
}

export function readMultipartFile(
  req: Request | IncomingMessage,
  fieldName = 'file',
): Promise<MultipartFile> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'];
    if (typeof contentType !== 'string' || !contentType.includes('multipart/form-data')) {
      discard(req);
      reject(
        new MultipartFileError(
          'Content-Type must be multipart/form-data with a file field.',
        ),
      );
      return;
    }

    let fileCount = 0;
    let resolved = false;
    let completedSettled = false;
    let released = false;
    let fileStream: Readable | undefined;
    let completedResolve!: () => void;
    let completedReject!: (error: Error) => void;
    const completed = new Promise<void>((res, rej) => {
      completedResolve = res;
      completedReject = rej;
    });
    completed.catch(() => undefined);

    let busboy: Busboy.Busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: {
          files: 1,
          fields: 0,
        },
      });
    } catch (error) {
      discard(req);
      reject(
        new MultipartFileError(
          error instanceof Error
            ? error.message
            : 'Multipart Content-Type is invalid.',
        ),
      );
      return;
    }

    const releaseRequest = (): void => {
      if (released) {
        return;
      }
      released = true;
      try {
        req.unpipe(busboy);
      } catch {
        // already unpiped
      }
      busboy.removeAllListeners('error');
      busboy.on('error', () => undefined);
      if (!busboy.destroyed) {
        busboy.destroy();
      }
      discard(req);
    };

    const abort = (): void => {
      if (!completedSettled) {
        completedSettled = true;
        completedReject(
          new MultipartFileError('Multipart upload was cancelled.'),
        );
      }
      if (fileStream && !fileStream.destroyed) {
        fileStream.on('error', () => undefined);
        if (!fileStream.readableEnded) {
          fileStream.resume();
          fileStream.destroy();
        }
      }
      releaseRequest();
    };

    const fail = (error: Error): void => {
      const wrapped =
        error instanceof MultipartFileError
          ? error
          : new MultipartFileError('Multipart upload is truncated or invalid.');
      if (!completedSettled) {
        completedSettled = true;
        completedReject(wrapped);
      }
      if (!resolved) {
        resolved = true;
        reject(wrapped);
        if (fileStream && !fileStream.destroyed) {
          fileStream.on('error', () => undefined);
          fileStream.resume();
          fileStream.destroy();
        }
      }
      releaseRequest();
    };

    busboy.on('file', (name, stream, info) => {
      if (name !== fieldName) {
        discard(stream);
        fail(
          new MultipartFileError(
            `Multipart field "${fieldName}" is required.`,
          ),
        );
        return;
      }

      fileCount += 1;
      if (fileCount > 1) {
        discard(stream);
        fail(new MultipartFileError('Only one file upload is allowed.'));
        return;
      }

      fileStream = stream;
      stream.on('error', (error) => {
        fail(error);
      });
      resolved = true;
      resolve({
        stream,
        filename: info.filename || 'upload.csv',
        mimeType: info.mimeType || 'application/octet-stream',
        completed,
        abort,
      });
    });

    busboy.on('field', () => {
      fail(new MultipartFileError('Unexpected text field in multipart upload.'));
    });

    busboy.on('filesLimit', () => {
      fail(new MultipartFileError('Only one file upload is allowed.'));
    });

    busboy.on('fieldsLimit', () => {
      fail(new MultipartFileError('Unexpected text field in multipart upload.'));
    });

    busboy.on('error', (error: Error) => {
      fail(error);
    });

    busboy.on('finish', () => {
      if (!fileStream) {
        fail(
          new MultipartFileError(
            `Multipart field "${fieldName}" is required.`,
          ),
        );
        return;
      }
      if (!completedSettled) {
        completedSettled = true;
        completedResolve();
      }
    });

    req.on('error', (error: Error) => {
      fail(error);
    });
    req.pipe(busboy);
  });
}
