// Verificación de tokens del proveedor de identidad (Supabase Auth). Dos formas de firma, ambas con el algoritmo FIJADO por la clave,
// nunca por lo que diga el token:
//   - HS256 con un secreto compartido (proyectos con el "JWT secret" heredado y los tokens de las pruebas).
//   - ES256 / RS256 con las claves públicas del proveedor (JWKS: /auth/v1/.well-known/jwks.json), elegidas por `kid`.
// Se rechaza: "none", otro algoritmo, un token HS256 cuando solo hay claves públicas (confusión de algoritmo), una clave EC para un
// token RS256 (o al revés), vencidos, "todavía no válidos", audiencia o emisor distintos, y todo lo que no tenga `sub`.
import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

const desdeB64u = (s) => Buffer.from(s, 'base64url');

function partir(token) {
  if (typeof token !== 'string' || token.length > 4096) throw new Error('formato');
  const partes = token.split('.'); if (partes.length !== 3) throw new Error('formato');
  try { return { partes, cabecera: JSON.parse(desdeB64u(partes[0]).toString('utf8')), payload: JSON.parse(desdeB64u(partes[1]).toString('utf8')) }; } catch (e) { throw new Error('formato'); }
}
function validarReclamos(payload, { audiencia, emisor, ahora = () => Date.now(), tolerancia = 30 }) {
  const t = Math.floor(ahora() / 1000);
  if (typeof payload.exp !== 'number' || t > payload.exp + tolerancia) throw new Error('vencido');
  if (typeof payload.nbf === 'number' && t + tolerancia < payload.nbf) throw new Error('todavía no vale');
  if (audiencia && ![].concat(payload.aud || []).includes(audiencia)) throw new Error('audiencia');
  if (emisor && payload.iss !== emisor) throw new Error('emisor');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('sin sub');
  return payload;
}
function verificarHS256(partes, secreto) {
  const esperada = createHmac('sha256', secreto).update(`${partes[0]}.${partes[1]}`).digest(), recibida = desdeB64u(partes[2]);
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) throw new Error('firma');
}
const ALGORITMO_DE_CLAVE = (jwk) => (jwk.kty === 'EC' && jwk.crv === 'P-256' ? 'ES256' : jwk.kty === 'RSA' ? 'RS256' : null);
function verificarAsimetrica(partes, algoritmo, jwk) {
  if (ALGORITMO_DE_CLAVE(jwk) !== algoritmo) throw new Error('algoritmo');            // la clave decide qué algoritmo vale
  let clave; try { clave = createPublicKey({ key: jwk, format: 'jwk' }); } catch (e) { throw new Error('clave'); }
  const datos = Buffer.from(`${partes[0]}.${partes[1]}`), firma = desdeB64u(partes[2]);
  const ok = algoritmo === 'ES256' ? verify('sha256', datos, { key: clave, dsaEncoding: 'ieee-p1363' }, firma) : verify('sha256', datos, clave, firma);
  if (!ok) throw new Error('firma');
}

/** Almacén de claves públicas con caché. Una `kid` desconocida fuerza UNA recarga como máximo cada `minimoEntreRecargasMs`
 *  (para que un token con `kid` inventado no se convierta en un ataque contra el proveedor), y sigue sirviendo lo último que supo
 *  si el proveedor no responde. */
export function crearJwks({ url, buscar = fetch, vigenciaMs = 10 * 60_000, minimoEntreRecargasMs = 30_000, tiempoMaximoMs = 5000, ahora = () => Date.now(), registrarError = () => {} }) {
  let claves = new Map(), cargadoEn = 0, recargando = null;
  async function recargar() {
    if (recargando) return recargando;
    recargando = (async () => {
      try {
        const r = await buscar(url, { signal: AbortSignal.timeout(tiempoMaximoMs), headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error(`JWKS respondió ${r.status}`);
        const { keys } = await r.json();
        if (!Array.isArray(keys)) throw new Error('JWKS sin claves');
        claves = new Map(keys.filter((k) => k && k.kid && ALGORITMO_DE_CLAVE(k) && !k.d).map((k) => [k.kid, k]));   // jamás se aceptan claves con parte privada
      } catch (e) { registrarError(e); }
      finally { cargadoEn = ahora(); recargando = null; }
    })();
    return recargando;
  }
  return {
    async obtener(kid) {
      const t = ahora();
      if (claves.size === 0 || t - cargadoEn > vigenciaMs) await recargar();
      else if (!claves.has(kid) && t - cargadoEn > minimoEntreRecargasMs) await recargar();
      return claves.get(kid) ?? null;
    },
  };
}

/** Devuelve una función async (token) → contenido verificado, o lanza Error('motivo') (el motivo es para el registro interno). */
export function crearVerificador({ secretoHS256, jwks, audiencia, emisor, ahora, tolerancia }) {
  if (!secretoHS256 && !jwks) throw new Error('Hace falta un secreto HS256 o un JWKS para verificar tokens.');
  const reclamos = { audiencia, emisor, ahora, tolerancia };
  return async function verificar(token) {
    const { partes, cabecera, payload } = partir(token);
    if (!cabecera || typeof cabecera.alg !== 'string') throw new Error('formato');
    if (cabecera.alg === 'HS256') {
      if (!secretoHS256) throw new Error('algoritmo');                                 // con solo claves públicas, un HS256 es un intento de confusión
      verificarHS256(partes, secretoHS256);
    } else if (cabecera.alg === 'ES256' || cabecera.alg === 'RS256') {
      if (!jwks || typeof cabecera.kid !== 'string') throw new Error('algoritmo');
      const jwk = await jwks.obtener(cabecera.kid);
      if (!jwk) throw new Error('clave desconocida');
      verificarAsimetrica(partes, cabecera.alg, jwk);
    } else throw new Error('algoritmo');                                               // "none" y todo lo demás
    return validarReclamos(payload, reclamos);
  };
}
