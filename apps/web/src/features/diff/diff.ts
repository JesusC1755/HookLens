import { type ChangeObject, diffLines } from 'diff';
import { type Bytes, decodeBody } from '../../lib/body';
import { detectFormat } from '../../lib/contentType';
import { formatJson, tokensToText } from '../../lib/formatJson';
import type { MultiValueMap } from '../../lib/types';

/** Se comparan dos: al marcar una tercera, sale la que se marcó primero. */
export function toggleComparison(ids: readonly string[], id: string): string[] {
  if (ids.includes(id)) return ids.filter((other) => other !== id);
  return [...ids, id].slice(-2);
}

export type HeaderStatus = 'same' | 'changed' | 'added' | 'removed';

export interface HeaderDiffRow {
  name: string;
  before: string[] | null;
  after: string[] | null;
  status: HeaderStatus;
}

const sameValues = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export function diffHeaders(before: MultiValueMap, after: MultiValueMap): HeaderDiffRow[] {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort((a, b) =>
    a.localeCompare(b),
  );
  return names.map((name) => {
    const a = before[name] ?? null;
    const b = after[name] ?? null;
    const status: HeaderStatus =
      a === null ? 'added' : b === null ? 'removed' : sameValues(a, b) ? 'same' : 'changed';
    return { name, before: a, after: b, status };
  });
}

export type BodyDiff =
  | { kind: 'identical' }
  /** Mismo contenido tras reindentar: solo cambian espacios (y cambiaría una firma HMAC). */
  | { kind: 'format-only' }
  | { kind: 'text'; json: boolean; changes: ChangeObject<string>[] }
  | { kind: 'binary'; sizeBefore: number; sizeAfter: number }
  /** Tan distintos que el diff costaría demasiado. */
  | { kind: 'too-large' };

// Myers es O(N·D) y corre en el hilo principal: con dos bodies muy distintos puede
// congelar la pestaña segundos. Se corta por cantidad de ediciones o por tiempo, lo
// primero que ocurra.
const MAX_EDIT_LENGTH = 1_000;
const DIFF_TIMEOUT_MS = 200;

function bytesEqual(a: Bytes, b: Bytes): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

const EMPTY: Bytes = new Uint8Array(0);

/**
 * Si los dos son JSON se comparan reindentados (sin reordenar claves ni tocar números),
 * para que una diferencia de formato no tape las de contenido.
 */
export function diffBodies(
  before: { body: string | null; contentType: string | null },
  after: { body: string | null; contentType: string | null },
): BodyDiff {
  const a = decodeBody(before.body);
  const b = decodeBody(after.body);
  if (bytesEqual(a.kind === 'empty' ? EMPTY : a.bytes, b.kind === 'empty' ? EMPTY : b.bytes)) {
    return { kind: 'identical' };
  }
  if (a.kind === 'binary' || b.kind === 'binary') {
    return {
      kind: 'binary',
      sizeBefore: a.kind === 'empty' ? 0 : a.bytes.length,
      sizeAfter: b.kind === 'empty' ? 0 : b.bytes.length,
    };
  }

  const textA = a.kind === 'text' ? a.text : '';
  const textB = b.kind === 'text' ? b.text : '';
  const jsonA =
    detectFormat(before.contentType, textA).format === 'json' ? formatJson(textA) : null;
  const jsonB = detectFormat(after.contentType, textB).format === 'json' ? formatJson(textB) : null;
  const json = jsonA !== null && jsonB !== null;
  const normalizedA = json ? tokensToText(jsonA) : textA;
  const normalizedB = json ? tokensToText(jsonB) : textB;

  if (normalizedA === normalizedB) return { kind: 'format-only' };
  const changes = diffLines(normalizedA, normalizedB, {
    maxEditLength: MAX_EDIT_LENGTH,
    timeout: DIFF_TIMEOUT_MS,
  });
  return changes === undefined ? { kind: 'too-large' } : { kind: 'text', json, changes };
}

export type DiffLine =
  { kind: 'added' | 'removed' | 'same'; text: string } | { kind: 'skipped'; count: number };

function splitLines(value: string): string[] {
  const lines = value.split('\n');
  // diffLines incluye el salto final en cada bloque: no es una línea vacía extra.
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Diff unificado: alrededor de cada cambio quedan `context` líneas; el resto se pliega. */
export function toDiffLines(changes: readonly ChangeObject<string>[], context = 3): DiffLine[] {
  const lines: DiffLine[] = [];
  changes.forEach((change, index) => {
    const kind = change.added ? 'added' : change.removed ? 'removed' : 'same';
    const text = splitLines(change.value);
    if (kind !== 'same') {
      for (const line of text) lines.push({ kind, text: line });
      return;
    }
    const keepStart = index === 0 ? 0 : context;
    const keepEnd = index === changes.length - 1 ? 0 : context;
    if (text.length <= keepStart + keepEnd + 1) {
      for (const line of text) lines.push({ kind, text: line });
      return;
    }
    for (const line of text.slice(0, keepStart)) lines.push({ kind, text: line });
    lines.push({ kind: 'skipped', count: text.length - keepStart - keepEnd });
    for (const line of text.slice(text.length - keepEnd)) lines.push({ kind, text: line });
  });
  return lines;
}
