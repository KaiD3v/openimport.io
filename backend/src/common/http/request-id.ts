import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

export const REQUEST_ID_MAX_LENGTH = 128;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function isValidRequestId(value: string): boolean {
  return REQUEST_ID_PATTERN.test(value);
}

export function resolveRequestId(req: Request): string {
  if (typeof req.id === 'string' && isValidRequestId(req.id)) {
    return req.id;
  }

  const incoming = req.headers['x-request-id'];
  if (typeof incoming === 'string' && isValidRequestId(incoming)) {
    return incoming;
  }

  return `req_${randomUUID()}`;
}

export function applyRequestId(req: Request, res: Response): string {
  const id = resolveRequestId(req);
  req.id = id;
  res.setHeader('X-Request-ID', id);
  return id;
}
