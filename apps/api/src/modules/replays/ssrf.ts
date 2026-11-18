import dns from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { AppError } from '../../lib/errors.js';

/** Decide si el replay puede conectarse a una IP. En producción, solo IPs públicas. */
export type AddressPolicy = (ip: string) => boolean;

const BLOCKED_IPV4: readonly [string, number][] = [
  ['0.0.0.0', 8], // "esta red": en Linux 0.0.0.0 llega a localhost
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT: redes internas de algunos proveedores
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local: metadatos de la nube (169.254.169.254)
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reservado y broadcast
];

const BLOCKED_IPV6: readonly [string, number][] = [
  ['::', 96], // no especificada, loopback (::1) e IPv4-compatibles (::a.b.c.d)
  ['64:ff9b::', 96], // NAT64: un gateway la traduciría a una IPv4 interna
  ['fc00::', 7], // unique local (la red privada de Fly.io es fdaa::/16)
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
];

const blockList = new BlockList();
for (const [network, prefix] of BLOCKED_IPV4) blockList.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of BLOCKED_IPV6) blockList.addSubnet(network, prefix, 'ipv6');

/**
 * BlockList compara las IPv6 que mapean IPv4 (::ffff:127.0.0.1) contra las reglas
 * IPv4, así que esa forma de colar una IP privada también queda bloqueada.
 */
export const isPublicAddress: AddressPolicy = (ip) => {
  const family = isIP(ip);
  if (family === 0) return false;
  return !blockList.check(ip, family === 4 ? 'ipv4' : 'ipv6');
};

const TARGET_NOT_ALLOWED = 'ERR_TARGET_NOT_ALLOWED';

class TargetNotAllowedError extends Error {
  readonly code = TARGET_NOT_ALLOWED;
}

export function targetNotAllowed(): AppError {
  return new AppError(
    422,
    'TARGET_NOT_ALLOWED',
    'El destino apunta a una dirección privada o reservada: está bloqueado por seguridad',
  );
}

export function isTargetNotAllowed(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === TARGET_NOT_ALLOWED;
}

type Resolver = (
  hostname: string,
  options: dns.LookupAllOptions,
  callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void,
) => void;

/**
 * `lookup` para el socket del replay. Validar y conectar usan la misma resolución:
 * si se resolviera, validara y luego el cliente HTTP volviera a resolver, un DNS
 * malicioso podría responder una IP pública la primera vez y 127.0.0.1 la segunda
 * (DNS rebinding).
 */
export function createSafeLookup(
  isAllowed: AddressPolicy,
  resolve: Resolver = dns.lookup,
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) {
        callback(err, '');
        return;
      }
      // Se revisan todas: si un nombre tiene una IP pública y una privada, el socket
      // podría terminar conectándose a la privada.
      if (addresses.some(({ address }) => !isAllowed(address))) {
        callback(new TargetNotAllowedError(`${hostname} resuelve a una IP no permitida`), '');
        return;
      }
      const [first] = addresses;
      if (options.all) {
        callback(null, addresses);
      } else if (first) {
        callback(null, first.address, first.family);
      } else {
        callback(Object.assign(new Error(`${hostname} no resuelve`), { code: 'ENOTFOUND' }), '');
      }
    });
  };
}

/** Valida la URL de destino. Las IPs literales no pasan por `lookup`: se revisan aquí. */
export function parseTargetUrl(raw: string, isAllowed: AddressPolicy): URL {
  if (!URL.canParse(raw)) {
    throw new AppError(400, 'INVALID_TARGET_URL', 'La URL de destino no es válida');
  }
  // El parser WHATWG normaliza 0x7f.1 o 2130706433 a 127.0.0.1 antes de esta revisión.
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError(400, 'INVALID_TARGET_URL', 'El destino debe ser http o https');
  }
  if (url.username !== '' || url.password !== '') {
    // Quedarían guardadas en el historial; para autenticarse está el header Authorization.
    throw new AppError(400, 'INVALID_TARGET_URL', 'La URL no puede llevar usuario ni contraseña');
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  if (isIP(host) !== 0 && !isAllowed(host)) throw targetNotAllowed();
  return url;
}
