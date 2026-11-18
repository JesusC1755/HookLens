import { isIP } from 'node:net';
import { z } from 'zod';

// Alias que entiende proxy-addr (el resolvedor de IPs que usa Fastify).
const PROXY_ALIASES = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isTrustedProxyEntry(entry: string): boolean {
  if (PROXY_ALIASES.has(entry)) return true;
  const [address = '', prefix, ...rest] = entry.split('/');
  const version = isIP(address);
  if (version === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  const bits = Number(prefix);
  return /^\d{1,3}$/.test(prefix) && bits <= (version === 4 ? 32 : 128);
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
    // Direcciones de los proxies de confianza, separadas por comas (vacío = ninguno).
    // Se exigen direcciones y no un número de saltos: con saltos, un cliente directo
    // podría falsear X-Forwarded-For (Fastify 5 ya ni lo acepta).
    TRUST_PROXY: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry !== ''),
      )
      .pipe(z.array(z.string().refine(isTrustedProxyEntry, 'Debe ser una IP, un CIDR o un alias'))),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.PUBLIC_BASE_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_BASE_URL'],
        message: 'Es obligatoria en producción',
      });
    }
  })
  .transform(({ PUBLIC_BASE_URL, ...env }) => ({
    ...env,
    PUBLIC_BASE_URL: (PUBLIC_BASE_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, ''),
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
