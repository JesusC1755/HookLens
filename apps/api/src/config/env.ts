import { isIP } from 'node:net';
import { z } from 'zod';

// Alias que entiende proxy-addr (el resolvedor de IPs que usa Fastify).
const PROXY_ALIASES = new Set(['loopback', 'linklocal', 'uniquelocal']);

const DEV_WEB_ORIGIN = 'http://localhost:5173';

function isTrustedProxyEntry(entry: string): boolean {
  if (PROXY_ALIASES.has(entry)) return true;
  const [address = '', prefix, ...rest] = entry.split('/');
  const version = isIP(address);
  if (version === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  const bits = Number(prefix);
  return /^\d{1,3}$/.test(prefix) && bits <= (version === 4 ? 32 : 128);
}

/** Origen exacto (`https://app.dev`), sin path ni barra final: así lo compara el navegador. */
function isOrigin(entry: string): boolean {
  if (!URL.canParse(entry)) return false;
  const url = new URL(entry);
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === entry;
}

/** Lista separada por comas; cada elemento se valida con `isValid`. */
function commaList(isValid: (entry: string) => boolean, message: string) {
  return z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ''),
    )
    .pipe(z.array(z.string().refine(isValid, message)));
}

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    // URL pública con la que se construyen las URLs de ingesta que ve el usuario.
    PUBLIC_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),
    // Direcciones de los proxies de confianza (vacío = ninguno). Se exigen direcciones
    // y no un número de saltos: con saltos, un cliente directo podría falsear
    // X-Forwarded-For (Fastify 5 ya ni lo acepta).
    TRUST_PROXY: commaList(isTrustedProxyEntry, 'Debe ser una IP, un CIDR o un alias'),
    // Orígenes del front autorizados a llamar a /api desde el navegador.
    CORS_ORIGINS: commaList(isOrigin, 'Debe ser un origen como https://app.ejemplo.com'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (env.PUBLIC_BASE_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_BASE_URL'],
        message: 'Es obligatoria en producción',
      });
    }
    if (env.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'Es obligatoria en producción',
      });
    }
  })
  .transform(({ PUBLIC_BASE_URL, CORS_ORIGINS, ...env }) => ({
    ...env,
    PUBLIC_BASE_URL: (PUBLIC_BASE_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, ''),
    CORS_ORIGINS: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : [DEV_WEB_ORIGIN],
  }));

export type Env = z.infer<typeof EnvSchema>;

/** Valida el entorno al arrancar: si falta algo, el proceso no levanta. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Variables de entorno inválidas:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
