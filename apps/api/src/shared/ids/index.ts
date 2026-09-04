import { randomUUID } from "node:crypto";

export function createRequestId(): string {
  return `req-${randomUUID()}`;
}

export function createId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
