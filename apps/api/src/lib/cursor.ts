import { z } from 'zod';

/**
 * Cursor de paginación por clave (keyset): la última fila vista (received_at, id).
 * Va en base64url para que el cliente lo trate como opaco y no dependa del formato.
 */
export interface Cursor {
  receivedAt: Date;
  id: string;
}

const CursorPayload = z.object({
  t: z.iso.datetime(),
  id: z.uuid(),
});

export function encodeCursor({ receivedAt, id }: Cursor): string {
  return Buffer.from(JSON.stringify({ t: receivedAt.toISOString(), id })).toString('base64url');
}

/** Devuelve `null` si el cursor está malformado o manipulado. */
export function decodeCursor(raw: string): Cursor | null {
  try {
    const json: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    const parsed = CursorPayload.safeParse(json);
    if (!parsed.success) return null;
    return { receivedAt: new Date(parsed.data.t), id: parsed.data.id };
  } catch {
    return null;
  }
}
