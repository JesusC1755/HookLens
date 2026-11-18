import { type ReactNode, useMemo, useState } from 'react';
import { CopyButton } from '../../components/CopyButton';
import { type Bytes, type DecodedBody, decodeBody } from '../../lib/body';
import { type BodyFormat, detectFormat, parseFormBody } from '../../lib/contentType';
import { formatBytes } from '../../lib/format';
import { formatJson, type JsonToken, type JsonTokenKind, tokensToText } from '../../lib/formatJson';
import { formatXml } from '../../lib/formatXml';
import { hexDump } from '../../lib/hexdump';
import type { MultiValueMap, RequestDetail } from '../../lib/types';
import { MultiValueTable } from './MultiValueTable';

type ViewId = 'formatted' | 'raw' | 'hex';

const VIEW_LABELS: Record<ViewId, string> = { formatted: 'Formateado', raw: 'Texto', hex: 'Hex' };
// El hex de 1 MB serían 65 000 líneas: se muestran los primeros 64 KB (se puede descargar todo).
const HEX_PREVIEW_BYTES = 64 * 1024;
// Por encima de esto, colorear cada token vuelve lento el render: se muestra sin color.
const MAX_HIGHLIGHTED_TOKENS = 20_000;
const EXTENSIONS: Record<BodyFormat, string> = {
  json: 'json',
  xml: 'xml',
  form: 'txt',
  text: 'txt',
};

type Formatted =
  | { kind: 'json'; tokens: JsonToken[]; text: string }
  | { kind: 'xml'; text: string }
  | { kind: 'form'; values: MultiValueMap }
  | { kind: 'invalid'; format: string }
  | null;

function formatBody(text: string, contentType: string | null): Formatted {
  const { format, declared } = detectFormat(contentType, text);
  switch (format) {
    case 'json': {
      const tokens = formatJson(text);
      if (tokens) return { kind: 'json', tokens, text: tokensToText(tokens) };
      return declared ? { kind: 'invalid', format: 'JSON' } : null;
    }
    case 'xml': {
      const xml = formatXml(text);
      if (xml !== null) return { kind: 'xml', text: xml };
      return declared ? { kind: 'invalid', format: 'XML' } : null;
    }
    case 'form':
      return { kind: 'form', values: parseFormBody(text) };
    case 'text':
      return null;
  }
}

function downloadBytes(bytes: Bytes, filename: string) {
  // octet-stream: el navegador lo guarda como archivo, nunca lo abre ni lo interpreta.
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

export function BodyViewer({ request }: { request: RequestDetail }) {
  const decoded = useMemo(() => decodeBody(request.body), [request.body]);
  if (decoded.kind === 'empty') return <p className="text-sm text-zinc-500">Sin body</p>;
  return <LoadedBody decoded={decoded} contentType={request.contentType} id={request.id} />;
}

interface LoadedBodyProps {
  decoded: Exclude<DecodedBody, { kind: 'empty' }>;
  contentType: string | null;
  id: string;
}

function LoadedBody({ decoded, contentType, id }: LoadedBodyProps) {
  const text = decoded.kind === 'text' ? decoded.text : null;
  const formatted = useMemo(
    () => (text === null ? null : formatBody(text, contentType)),
    [text, contentType],
  );

  const views: ViewId[] = [];
  if (formatted !== null && formatted.kind !== 'invalid') views.push('formatted');
  if (text !== null) views.push('raw');
  views.push('hex');

  const [selected, setSelected] = useState<ViewId | null>(null);
  const view = selected !== null && views.includes(selected) ? selected : (views[0] ?? 'hex');

  const hex = useMemo(
    () => (view === 'hex' ? hexDump(decoded.bytes, HEX_PREVIEW_BYTES) : ''),
    [view, decoded.bytes],
  );

  let copyText = hex;
  let panel: ReactNode = <Pre wrap={false}>{hex}</Pre>;
  if (view === 'raw' && text !== null) {
    copyText = text;
    panel = <Pre>{text}</Pre>;
  } else if (view === 'formatted' && formatted?.kind === 'json') {
    copyText = formatted.text;
    panel = <JsonView tokens={formatted.tokens} text={formatted.text} />;
  } else if (view === 'formatted' && formatted?.kind === 'xml') {
    copyText = formatted.text;
    panel = <Pre>{formatted.text}</Pre>;
  } else if (view === 'formatted' && formatted?.kind === 'form') {
    copyText = text ?? '';
    panel = (
      <div className="p-3">
        <MultiValueTable values={formatted.values} />
      </div>
    );
  }

  const extension = text === null ? 'bin' : EXTENSIONS[detectFormat(contentType, text).format];

  return (
    <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-900">
      <div className="flex flex-wrap items-center gap-1 border-b border-zinc-800 px-2 py-1.5">
        {views.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === view}
            onClick={() => {
              setSelected(option);
            }}
            className={`rounded px-2 py-1 text-xs transition ${
              option === view ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-400 hover:text-zinc-100'
            }`}
          >
            {VIEW_LABELS[option]}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1.5">
          <CopyButton value={copyText} />
          <button
            type="button"
            onClick={() => {
              downloadBytes(decoded.bytes, `body-${id}.${extension}`);
            }}
            className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
          >
            Descargar
          </button>
        </span>
      </div>

      {formatted?.kind === 'invalid' && (
        <p className="border-b border-zinc-800 px-3 py-2 text-xs text-amber-300">
          El content-type dice {formatted.format}, pero el body no es {formatted.format} válido.
        </p>
      )}
      {decoded.kind === 'binary' && (
        <p className="border-b border-zinc-800 px-3 py-2 text-xs text-zinc-400">
          Contenido binario de {formatBytes(decoded.bytes.length)}: no es UTF-8 válido.
        </p>
      )}
      {view === 'hex' && decoded.bytes.length > HEX_PREVIEW_BYTES && (
        <p className="border-b border-zinc-800 px-3 py-2 text-xs text-zinc-400">
          Se muestran los primeros {formatBytes(HEX_PREVIEW_BYTES)} de{' '}
          {formatBytes(decoded.bytes.length)}. Descarga el body para verlo completo.
        </p>
      )}

      {panel}
    </div>
  );
}

function Pre({ children, wrap = true }: { children: ReactNode; wrap?: boolean }) {
  // Texto plano: React lo escapa, un body con HTML nunca se interpreta.
  return (
    <pre
      className={`max-h-[60vh] overflow-auto p-3 font-mono text-xs leading-relaxed text-zinc-200 ${
        wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre'
      }`}
    >
      {children}
    </pre>
  );
}

const TOKEN_STYLES: Record<JsonTokenKind, string> = {
  key: 'text-sky-300',
  string: 'text-emerald-300',
  number: 'text-amber-300',
  literal: 'text-violet-300',
  punctuation: 'text-zinc-500',
  whitespace: '',
};

function JsonView({ tokens, text }: { tokens: JsonToken[]; text: string }) {
  if (tokens.length > MAX_HIGHLIGHTED_TOKENS) return <Pre>{text}</Pre>;
  return (
    <Pre>
      {tokens.map((token, index) =>
        token.kind === 'whitespace' ? (
          token.text
        ) : (
          <span key={index} className={TOKEN_STYLES[token.kind]}>
            {token.text}
          </span>
        ),
      )}
    </Pre>
  );
}
