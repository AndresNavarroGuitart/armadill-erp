// Autenticación: verifica el token de la sesión y arma el contexto de trabajo (persona, estudio, empresa, permisos).
//   - Verificación de JWT con firma HS256 (secreto compartido, como el "JWT secret" de Supabase). Comprueba firma, vencimiento,
//     "no antes de", audiencia y emisor. NO acepta tokens sin firma ni con otro algoritmo.
//     Las claves asimétricas del proveedor (ES256/RS256 por JWKS) se verifican en jwt.mjs; este archivo conserva el HS256 síncrono para las pruebas.
//   - La persona se identifica con fn_autenticar (por el "sub" del token; el primer ingreso se vincula por email VERIFICADO).
//   - La empresa llega en el encabezado X-Empresa-Id y se valida contra lo que esa persona puede abrir.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { crearVerificador } from './jwt.mjs';

const b64u = (b) => Buffer.from(b).toString('base64url');
const desdeB64u = (s) => Buffer.from(s, 'base64url');

export function firmarJwtHS256(payload, secreto) {
  const cuerpo = `${b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64u(JSON.stringify(payload))}`;
  return `${cuerpo}.${createHmac('sha256', secreto).update(cuerpo).digest('base64url')}`;
}

/* Devuelve el contenido del token o lanza Error('motivo'). Los mensajes son para el registro interno, no para la persona. */
export function verificarJwtHS256(token, { secreto, audiencia, emisor, ahora = () => Date.now(), tolerancia = 30 }) {
  if (typeof token !== 'string' || token.length > 4096) throw new Error('formato');
  const partes = token.split('.'); if (partes.length !== 3) throw new Error('formato');
  let cabecera, payload;
  try { cabecera = JSON.parse(desdeB64u(partes[0]).toString('utf8')); payload = JSON.parse(desdeB64u(partes[1]).toString('utf8')); } catch (e) { throw new Error('formato'); }
  if (!cabecera || cabecera.alg !== 'HS256') throw new Error('algoritmo');          // nunca "none", nunca otro algoritmo
  const esperada = createHmac('sha256', secreto).update(`${partes[0]}.${partes[1]}`).digest(), recibida = desdeB64u(partes[2]);
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) throw new Error('firma');
  const t = Math.floor(ahora() / 1000);
  if (typeof payload.exp !== 'number' || t > payload.exp + tolerancia) throw new Error('vencido');
  if (typeof payload.nbf === 'number' && t + tolerancia < payload.nbf) throw new Error('todavía no vale');
  if (audiencia && ![].concat(payload.aud || []).includes(audiencia)) throw new Error('audiencia');
  if (emisor && payload.iss !== emisor) throw new Error('emisor');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('sin sub');
  return payload;
}

const CONDICION_TEXTO = { 1: 'responsable inscripto', 4: 'exento', 6: 'monotributista', 13: 'monotributista social', 16: 'monotributista' };

/* `verificador` (async, de jwt.mjs: HS256 y/o claves públicas por JWKS) es la forma de producción. Con solo `secreto` se arma uno HS256. */
export function crearAutenticador({ bd, secreto, verificador, audiencia = 'authenticated', emisor, ahora, registrarError = () => {} }) {
  verificador = verificador ?? crearVerificador({ secretoHS256: secreto, audiencia, emisor, ahora });
  /* Devuelve { ctx } si la sesión es válida; { error: 'sin_sesion' | 'sin_acceso' | 'empresa_invalida' } si no. */
  return async function autenticar(req) {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    if (!m) return { error: 'sin_sesion' };
    let payload;
    try { payload = await verificador(m[1]); } catch (e) { registrarError(e); return { error: 'sin_sesion' }; }
    const verificado = payload.email_verified === true || (payload.user_metadata && payload.user_metadata.email_verified === true);
    const persona = await bd.sinContexto((c) => c.uno('select * from fn_autenticar($1, $2, $3)', [payload.sub, payload.email || null, !!verificado]));
    if (!persona) return { error: 'sin_acceso' };
    const base = { usuarioId: Number(persona.usuario_id), estudioId: Number(persona.estudio_id), nombre: persona.nombre, empresaId: null, permisos: new Set() };
    const pedida = req.headers['x-empresa-id'];
    if (pedida === undefined || pedida === '') return { ctx: base };
    if (!/^\d{1,15}$/.test(String(pedida))) return { error: 'empresa_invalida' };
    const e = await bd.sinContexto((c) => c.uno('select * from fn_contexto_empresa($1, $2)', [base.usuarioId, Number(pedida)]));
    if (!e) return { error: 'empresa_invalida' };          // no existe, no es de su estudio, o no tiene acceso: la respuesta es la misma
    return { ctx: { ...base, empresaId: Number(e.empresa_id), empresa: { razonSocial: e.razon_social, cuit: e.cuit, condicionIvaCodigo: Number(e.condicion_iva_codigo) },
      condicionIva: CONDICION_TEXTO[Number(e.condicion_iva_codigo)] || 'otra condición', rol: e.rol, permisos: new Set(e.permisos) } };
  };
}
