import 'express';
import type { AuthenticatedOrganization } from '../core/auth/authenticated-organization.js';

declare module 'express' {
  interface Request {
    id?: string;
    organization?: AuthenticatedOrganization;
  }
}
