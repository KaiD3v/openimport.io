import { createConnection, type Socket } from 'node:net';
import {
  createServer as createHttpServer,
  type Server as HttpServer,
} from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { applyHttpServerLimits } from '../src/common/http/configure-http-server.js';

function rethrowTestAndCleanupErrors(
  assertionError: unknown,
  cleanupError: unknown,
): void {
  if (assertionError != null && cleanupError != null) {
    throw new AggregateError(
      [assertionError, cleanupError],
      'HTTP timeout TCP test and cleanup both failed',
    );
  }
  if (assertionError != null) {
    throw assertionError;
  }
  if (cleanupError != null) {
    throw cleanupError;
  }
}

async function listenHttp(server: HttpServer): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('expected TCP port');
  }
  return address.port;
}

function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

describe('HTTP reception timeouts (raw TCP)', () => {
  let httpServer: HttpServer | undefined;
  let idleServer: HttpServer | undefined;
  let activeSockets = new Set<Socket>();

  async function closeServer(server: HttpServer | undefined): Promise<void> {
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  async function teardown(): Promise<void> {
    for (const socket of activeSockets) {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    }
    activeSockets.clear();
    await closeServer(httpServer);
    httpServer = undefined;
    await closeServer(idleServer);
    idleServer = undefined;
  }

  afterEach(async () => {
    await teardown();
  });

  it('closes incomplete headers within headersTimeout', async () => {
    let assertionError: unknown;
    let cleanupError: unknown;
    try {
      let handlerHit = false;
      httpServer = createHttpServer((_req, res) => {
        handlerHit = true;
        res.writeHead(200);
        res.end('ok');
      });
      applyHttpServerLimits(httpServer, {
        HTTP_REQUEST_TIMEOUT_MS: 400,
        HTTP_HEADERS_TIMEOUT_MS: 100,
        HTTP_KEEP_ALIVE_TIMEOUT_MS: 1000,
        HTTP_MAX_REQUESTS_PER_SOCKET: 100,
      });
      const port = await listenHttp(httpServer);

      const started = Date.now();
      const outcome = await withDeadline(
        new Promise<{ closed: boolean; elapsed: number; data: string }>(
          (resolve) => {
            const socket = createConnection({ host: '127.0.0.1', port });
            activeSockets.add(socket);
            let data = '';
            socket.write('GET /slow HTTP/1.1\r\nHost: 127.0.0.1\r\n');
            socket.on('data', (chunk) => {
              data += chunk.toString('utf8');
            });
            const done = () =>
              resolve({ closed: true, elapsed: Date.now() - started, data });
            socket.on('close', done);
            socket.on('error', done);
            socket.on('end', done);
          },
        ),
        3000,
        'incomplete headers',
      );

      expect(handlerHit).toBe(false);
      expect(outcome.closed).toBe(true);
      expect(outcome.elapsed).toBeLessThan(2500);
      if (outcome.data.length > 0) {
        expect(outcome.data).toMatch(/408|Request Timeout|Connection/i);
      }
    } catch (error) {
      assertionError = error;
    } finally {
      try {
        await teardown();
      } catch (error) {
        cleanupError = error;
      }
    }
    rethrowTestAndCleanupErrors(assertionError, cleanupError);
  }, 10_000);

  it('closes an unfinished multipart body via socket inactivity timeout', async () => {
    let assertionError: unknown;
    let cleanupError: unknown;
    try {
      let handlerHit = false;
      let responseCompleted = false;
      httpServer = createHttpServer((req, res) => {
        handlerHit = true;
        // Wait for the declared Content-Length — do not end early.
        req.on('data', () => undefined);
        req.on('end', () => {
          responseCompleted = true;
          res.writeHead(200);
          res.end('should-not-complete');
        });
      });
      applyHttpServerLimits(httpServer, {
        HTTP_REQUEST_TIMEOUT_MS: 150,
        HTTP_HEADERS_TIMEOUT_MS: 1000,
        HTTP_KEEP_ALIVE_TIMEOUT_MS: 1000,
        HTTP_MAX_REQUESTS_PER_SOCKET: 100,
      });
      const port = await listenHttp(httpServer);

      const started = Date.now();
      const outcome = await withDeadline(
        new Promise<{ closed: boolean; elapsed: number }>((resolve) => {
          const socket = createConnection({ host: '127.0.0.1', port });
          activeSockets.add(socket);
          socket.write(
            'POST /upload HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: multipart/form-data; boundary=----x\r\nContent-Length: 5000\r\nConnection: keep-alive\r\n\r\n------x\r\npartial',
          );
          const done = () =>
            resolve({ closed: true, elapsed: Date.now() - started });
          socket.on('close', done);
          socket.on('error', done);
          socket.on('end', done);
        }),
        3000,
        'incomplete body',
      );

      expect(handlerHit).toBe(true);
      expect(responseCompleted).toBe(false);
      expect(outcome.closed).toBe(true);
      expect(outcome.elapsed).toBeLessThan(2500);
    } catch (error) {
      assertionError = error;
    } finally {
      try {
        await teardown();
      } catch (error) {
        cleanupError = error;
      }
    }
    rethrowTestAndCleanupErrors(assertionError, cleanupError);
  }, 10_000);

  it('enforces maxRequestsPerSocket and idle keepAliveTimeout', async () => {
    let assertionError: unknown;
    let cleanupError: unknown;
    try {
      let hits = 0;
      httpServer = createHttpServer((_req, res) => {
        hits += 1;
        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Content-Length': '4',
          Connection: 'keep-alive',
        });
        res.end(`ok-${hits}`.slice(0, 4));
      });
      applyHttpServerLimits(httpServer, {
        HTTP_REQUEST_TIMEOUT_MS: 5000,
        HTTP_HEADERS_TIMEOUT_MS: 2000,
        HTTP_KEEP_ALIVE_TIMEOUT_MS: 80,
        HTTP_MAX_REQUESTS_PER_SOCKET: 2,
      });
      const port = await listenHttp(httpServer);

      const socket = createConnection({ host: '127.0.0.1', port });
      activeSockets.add(socket);

      const readOne = (): Promise<string> =>
        withDeadline(
          new Promise((resolve, reject) => {
            let buffer = '';
            const onData = (chunk: Buffer) => {
              buffer += chunk.toString('utf8');
              if (buffer.includes('\r\n\r\n')) {
                socket.off('data', onData);
                resolve(buffer);
              }
            };
            socket.on('data', onData);
            socket.on('error', reject);
          }),
          2000,
          'read response',
        );

      socket.write(
        'GET /one HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n',
      );
      expect(await readOne()).toMatch(/HTTP\/1\.1 200/);

      socket.write(
        'GET /two HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n',
      );
      expect(await readOne()).toMatch(/HTTP\/1\.1 200/);

      const closedAfterMax = await withDeadline(
        new Promise<boolean>((resolve) => {
          socket.once('close', () => resolve(true));
          socket.write(
            'GET /three HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n',
          );
        }),
        2000,
        'maxRequestsPerSocket close',
      );
      expect(closedAfterMax).toBe(true);
      expect(hits).toBe(2);

      idleServer = createHttpServer((_req, res) => {
        res.writeHead(200, { 'Content-Length': '4' });
        res.end('idle');
      });
      applyHttpServerLimits(idleServer, {
        HTTP_REQUEST_TIMEOUT_MS: 5000,
        HTTP_HEADERS_TIMEOUT_MS: 2000,
        HTTP_KEEP_ALIVE_TIMEOUT_MS: 60,
        HTTP_MAX_REQUESTS_PER_SOCKET: 100,
      });
      const idlePort = await listenHttp(idleServer);
      const idleSocket = createConnection({ host: '127.0.0.1', port: idlePort });
      activeSockets.add(idleSocket);
      idleSocket.write(
        'GET /idle HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n',
      );
      await withDeadline(
        new Promise<void>((resolve) => idleSocket.once('data', () => resolve())),
        2000,
        'idle response',
      );
      const idleClosed = await withDeadline(
        new Promise<boolean>((resolve) => {
          idleSocket.once('close', () => resolve(true));
        }),
        2000,
        'keepAliveTimeout close',
      );
      expect(idleClosed).toBe(true);
    } catch (error) {
      assertionError = error;
    } finally {
      try {
        await teardown();
      } catch (error) {
        cleanupError = error;
      }
    }
    rethrowTestAndCleanupErrors(assertionError, cleanupError);
  }, 15_000);
});
