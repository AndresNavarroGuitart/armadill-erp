// Pruebas de lo que se usa en producción: verificación de tokens asimétricos (JWKS), adaptador `pg`, migrador y endurecimiento de Supabase.
// Uso:  node api/probar_produccion.mjs        (no usa red externa: el "proveedor de identidad" y la base son locales)
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign as firmarNode, createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';
import { crearJwks, crearVerificador } from './jwt.mjs';
import { crearAutenticador, firmarJwtHS256 } from './auth.mjs';
import { crearBdPg } from './bd_pg.mjs';
import { crearEntornoPg } from './entorno_pg_prueba.mjs';
import { sembrarDemo } from './semilla.mjs';
import { migrar } from '../modelo/migrar_pg.mjs';
import { leerConfiguracion } from './configuracion.mjs';

let correctas = 0, fallas = 0;
async function prueba(nombre, fn) {
  try { await fn(); correctas += 1; console.log(`ok     ${nombre}`); }
  catch (error) { fallas += 1; console.log(`FALLA  ${nombre}\n         ${String(error.message).split('\n').slice(0, 4).join('\n         ')}`); }
}
const igual = (a, b, que = 'valor') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${que}: esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`); };
const verdad = (c, que) => { if (!c) throw new Error(que); };
const motivo = async (p) => { try { await p; return 'ACEPTADO'; } catch (e) { return e.message; } };

/* ---------- un proveedor de identidad de juguete: publica un JWKS que se puede cambiar ---------- */
const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const EMISOR = 'https://proyecto.supabase.test/auth/v1';
const ahoraS = () => Math.floor(Date.now() / 1000);
function claveEC(kid) { const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' }); return { kid, privateKey, publica: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' } }; }
function claveRSA(kid) { const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }); return { kid, privateKey, publica: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } }; }
function firmarES256(clave, payload, cabecera = {}) {
  const cuerpo = `${b64u({ alg: 'ES256', typ: 'JWT', kid: clave.kid, ...cabecera })}.${b64u(payload)}`;
  return `${cuerpo}.${firmarNode('sha256', Buffer.from(cuerpo), { key: clave.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
function firmarRS256(clave, payload) { const cuerpo = `${b64u({ alg: 'RS256', typ: 'JWT', kid: clave.kid })}.${b64u(payload)}`; return `${cuerpo}.${firmarNode('sha256', Buffer.from(cuerpo), clave.privateKey).toString('base64url')}`; }
const reclamos = (extra = {}) => ({ sub: 'sub-admin', aud: 'authenticated', iss: EMISOR, exp: ahoraS() + 3600, ...extra });

let publicadas = [], pedidos = 0, caido = false;
const invitacionesRecibidas = [], CLAVE_SERVICIO = 'sb_secret_otra-clave-de-prueba-que-no-debe-aparecer-en-ningun-registro';
const idp = http.createServer((req, res) => {
  if (req.url.startsWith('/auth/v1/invite') && req.method === 'POST') {
    let cuerpo = ''; req.on('data', (d) => { cuerpo += d; });
    return req.on('end', () => { invitacionesRecibidas.push({ auth: req.headers.authorization, apikey: req.headers.apikey, email: JSON.parse(cuerpo).email, redirect: new URL(req.url, 'http://x').searchParams.get('redirect_to') }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); });
  }
  if (req.url !== '/auth/v1/.well-known/jwks.json') { res.writeHead(404); return res.end(); }
  pedidos += 1;
  if (caido) { res.writeHead(503); return res.end('no'); }
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ keys: publicadas }));
});
await new Promise((r) => idp.listen(0, '127.0.0.1', r));
const URL_JWKS = `http://127.0.0.1:${idp.address().port}/auth/v1/.well-known/jwks.json`;
let reloj = Date.now();
const nuevoJwks = (extra = {}) => crearJwks({ url: URL_JWKS, ahora: () => reloj, ...extra });
const verificadorCon = (jwks, extra = {}) => crearVerificador({ jwks, audiencia: 'authenticated', emisor: EMISOR, ahora: () => reloj, ...extra });

// ---------------------------------------------------------------------------
// 1. Tokens asimétricos
// ---------------------------------------------------------------------------
const k1 = claveEC('k1'), k2 = claveEC('k2'), r1 = claveRSA('r1');
publicadas = [k1.publica, r1.publica];

await prueba('ES256: acepta un token firmado por una clave publicada y lo valida contra audiencia, emisor y vencimiento', async () => {
  const v = verificadorCon(nuevoJwks());
  igual((await v(firmarES256(k1, reclamos()))).sub, 'sub-admin', 'válido');
  igual(await motivo(v(firmarES256(k1, reclamos({ exp: ahoraS() - 3600 })))), 'vencido', 'vencido');
  igual(await motivo(v(firmarES256(k1, reclamos({ nbf: ahoraS() + 3600 })))), 'todavía no vale', 'nbf');
  igual(await motivo(v(firmarES256(k1, reclamos({ aud: 'otra' })))), 'audiencia', 'audiencia');
  igual(await motivo(v(firmarES256(k1, reclamos({ iss: 'https://malo.test' })))), 'emisor', 'emisor');
  igual(await motivo(v(firmarES256(k1, { aud: 'authenticated', iss: EMISOR, exp: ahoraS() + 60 }))), 'sin sub', 'sin sub');
});
await prueba('ES256: rechaza firma de otra clave (aun con la misma kid), payload alterado y firmas mal formadas', async () => {
  const v = verificadorCon(nuevoJwks());
  const impostora = { ...k2, kid: 'k1' };
  igual(await motivo(v(firmarES256(impostora, reclamos()))), 'firma', 'otra clave con la kid de k1');
  const t = firmarES256(k1, reclamos()).split('.');
  igual(await motivo(v(`${t[0]}.${b64u(reclamos({ sub: 'otra-persona' }))}.${t[2]}`)), 'firma', 'payload alterado');
  igual(await motivo(v(`${t[0]}.${t[1]}.${Buffer.from('basura').toString('base64url')}`)), 'firma', 'firma corta');
  igual(await motivo(v(`${t[0]}.${t[1]}.`)), 'firma', 'sin firma');
});
await prueba('Algoritmos: "none", otros, HS256 firmado con la clave pública (confusión) y clave EC usada para RS256 son rechazados', async () => {
  const v = verificadorCon(nuevoJwks());
  igual(await motivo(v(`${b64u({ alg: 'none', typ: 'JWT' })}.${b64u(reclamos())}.`)), 'algoritmo', 'none');
  igual(await motivo(v(`${b64u({ alg: 'HS512', typ: 'JWT' })}.${b64u(reclamos())}.x`)), 'algoritmo', 'HS512');
  const cuerpo = `${b64u({ alg: 'HS256', typ: 'JWT', kid: 'k1' })}.${b64u(reclamos())}`;
  const secretoDeLaClavePublica = JSON.stringify(k1.publica);
  igual(await motivo(v(`${cuerpo}.${createHmac('sha256', secretoDeLaClavePublica).update(cuerpo).digest('base64url')}`)), 'algoritmo', 'HS256 con la clave pública como secreto');
  const falso = `${b64u({ alg: 'RS256', typ: 'JWT', kid: 'k1' })}.${b64u(reclamos())}`;          // dice RS256 pero k1 es una clave EC
  igual(await motivo(v(`${falso}.${firmarNode('sha256', Buffer.from(falso), { key: k1.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`)), 'algoritmo', 'RS256 con clave EC');
  const falso2 = `${b64u({ alg: 'ES256', typ: 'JWT', kid: 'r1' })}.${b64u(reclamos())}`;          // dice ES256 pero r1 es RSA
  igual(await motivo(v(`${falso2}.${firmarNode('sha256', Buffer.from(falso2), r1.privateKey).toString('base64url')}`)), 'algoritmo', 'ES256 con clave RSA');
  igual(await motivo(v(firmarES256(k1, reclamos(), { kid: undefined }))), 'algoritmo', 'sin kid');
});
await prueba('RS256: también se acepta cuando la clave publicada es RSA', async () => {
  igual((await verificadorCon(nuevoJwks())(firmarRS256(r1, reclamos()))).sub, 'sub-admin', 'RS256');
});
await prueba('HS256: solo vale si se configuró un secreto; con secreto y claves públicas conviven', async () => {
  const hs = firmarJwtHS256(reclamos(), 'secreto-de-prueba-de-32-caracteres-minimo!!');
  igual(await motivo(verificadorCon(nuevoJwks())(hs)), 'algoritmo', 'sin secreto');
  const mixto = verificadorCon(nuevoJwks(), { secretoHS256: 'secreto-de-prueba-de-32-caracteres-minimo!!' });
  igual((await mixto(hs)).sub, 'sub-admin', 'HS256 con secreto'); igual((await mixto(firmarES256(k1, reclamos()))).sub, 'sub-admin', 'ES256 en el mismo verificador');
  igual(await motivo(mixto(firmarJwtHS256(reclamos(), 'otro-secreto-cualquiera-0123456789'))), 'firma', 'secreto equivocado');
});
await prueba('Verificador: no se puede crear sin secreto ni JWKS', async () => {
  let msg = ''; try { crearVerificador({}); } catch (e) { msg = e.message; } verdad(/secreto HS256 o un JWKS/.test(msg), `mensaje: ${msg}`);
});

// ---------------------------------------------------------------------------
// 2. Caché de claves
// ---------------------------------------------------------------------------
await prueba('JWKS: una kid inventada no provoca una recarga por cada pedido; la rotación de claves se aprende pasado el mínimo', async () => {
  publicadas = [k1.publica]; reloj = Date.now(); pedidos = 0;
  const v = verificadorCon(nuevoJwks({ minimoEntreRecargasMs: 30_000, vigenciaMs: 600_000 }));
  await v(firmarES256(k1, reclamos())); igual(pedidos, 1, 'primera carga');
  for (let i = 0; i < 20; i++) await motivo(v(firmarES256({ ...k2, kid: `inventada-${i}` }, reclamos())));
  igual(pedidos, 1, '20 kid inventadas dentro del mínimo → sin recargas');
  publicadas = [k1.publica, k2.publica];                                             // el proveedor rota: aparece k2
  igual(await motivo(v(firmarES256(k2, reclamos()))), 'clave desconocida', 'todavía dentro del mínimo');
  reloj += 31_000;
  igual((await v(firmarES256(k2, reclamos()))).sub, 'sub-admin', 'pasado el mínimo se recarga y la nueva clave sirve'); igual(pedidos, 2, 'una sola recarga');
});
await prueba('JWKS: varios pedidos simultáneos comparten una sola carga, y se ignoran claves con parte privada o de tipo no admitido', async () => {
  publicadas = [{ ...k1.publica, d: 'parte-privada' }, { kty: 'oct', kid: 'sec', k: 'abc' }, k2.publica]; reloj += 700_000; pedidos = 0;
  const v = verificadorCon(nuevoJwks());
  const r = await Promise.all([1, 2, 3, 4, 5].map(() => motivo(v(firmarES256(k2, reclamos()))))); igual(r, Array(5).fill('ACEPTADO'), 'resultados'); igual(pedidos, 1, 'una carga');
  igual(await motivo(v(firmarES256(k1, reclamos()))), 'clave desconocida', 'la clave con "d" no se acepta');
});
await prueba('JWKS: si el proveedor se cae sigue sirviendo lo último que supo, y si estaba caído desde el inicio no tumba nada', async () => {
  publicadas = [k1.publica]; reloj += 700_000;
  const errores = []; const v = verificadorCon(nuevoJwks({ registrarError: (e) => errores.push(e.message) }));
  igual((await v(firmarES256(k1, reclamos()))).sub, 'sub-admin', 'carga inicial');
  caido = true; reloj += 700_000;                                                    // vence la vigencia y la recarga falla
  igual((await v(firmarES256(k1, reclamos()))).sub, 'sub-admin', 'sigue sirviendo con la caché'); verdad(errores.length >= 1, 'se registró el fallo');
  const desdeCero = verificadorCon(nuevoJwks());
  igual(await motivo(desdeCero(firmarES256(k1, reclamos()))), 'clave desconocida', 'sin caché y sin proveedor: rechaza, no revienta');
  caido = false;
});

// ---------------------------------------------------------------------------
// 3. El autenticador con tokens ES256 (identidad real contra la base)
// ---------------------------------------------------------------------------
const entorno = await crearEntornoPg({ antesDelModelo: async (db) => {
  await db.exec(`create role anon nologin; create role authenticated nologin; alter default privileges in schema public grant all on tables to anon, authenticated; alter default privileges in schema public grant execute on functions to anon, authenticated; grant usage on schema public to anon, authenticated;`);
} });
const S = await sembrarDemo(entorno.pool);
const bd = crearBdPg(entorno.pool);

await prueba('Autenticador: con un verificador ES256 identifica a la persona y arma el contexto de la empresa', async () => {
  publicadas = [k1.publica]; reloj = Date.now();
  const autenticar = crearAutenticador({ bd, verificador: verificadorCon(nuevoJwks()) });
  const pedido = (token, empresa) => ({ headers: { authorization: `Bearer ${token}`, ...(empresa ? { 'x-empresa-id': String(empresa) } : {}) } });
  const r = await autenticar(pedido(firmarES256(k1, reclamos()), S.empresas.ri.id));
  igual([r.ctx.rol, r.ctx.empresaId, r.ctx.permisos.has('ventas.emitir')], ['Administrador', S.empresas.ri.id, true], 'contexto');
  igual((await autenticar(pedido(firmarES256(k2, reclamos()), null))).error, 'sin_sesion', 'clave que no está publicada');
  igual((await autenticar(pedido(firmarES256(k1, reclamos({ sub: 'nadie' })), null))).error, 'sin_acceso', 'persona desconocida');
  igual((await autenticar(pedido(firmarES256(k1, reclamos()), S.empresas.ajena.id))).error, 'empresa_invalida', 'empresa ajena');
});

// ---------------------------------------------------------------------------
// 4. Adaptador pg
// ---------------------------------------------------------------------------
await prueba('Adaptador pg: trabaja como app_usuario, fija el contexto solo dentro de la transacción y no lo deja pegado a la conexión', async () => {
  const ctx = { estudioId: S.estudios.e1, empresaId: S.empresas.ri.id, usuarioId: S.usuarios.admin.id };
  const dentro = await bd.conContexto(ctx, (c) => c.uno(`select current_user u, current_setting('app.empresa_id', true) e, current_setting('app.usuario_id', true) p, 7::bigint b`));
  igual([dentro.u, dentro.e, dentro.p, dentro.b], ['app_usuario', String(S.empresas.ri.id), String(S.usuarios.admin.id), 7], 'dentro (bigint como número)');
  const despues = await bd.sinContexto((c) => c.uno(`select current_user u, coalesce(current_setting('app.empresa_id', true), '') e`));
  igual([despues.u, despues.e], ['app_usuario', ''], 'la conexión reutilizada no conserva el contexto anterior');
  igual((await entorno.pool.query(`select current_user u`)).rows[0].u, 'postgres', 'y fuera de la API la conexión sigue siendo la del dueño');
});
await prueba('Adaptador pg: la RLS aísla por empresa también por esta vía, y el rol de la API no puede saltearla', async () => {
  const ctxRi = { estudioId: S.estudios.e1, empresaId: S.empresas.ri.id, usuarioId: S.usuarios.admin.id };
  await bd.conContexto(ctxRi, (c) => c.consultar(`insert into tercero (empresa_id, tipo_documento_codigo, nro_documento, razon_social, condicion_iva_codigo, es_cliente) values ($1, 99, '0', 'Visible solo en RI', 5, true)`, [S.empresas.ri.id]));
  const enRi = await bd.conContexto(ctxRi, (c) => c.consultar(`select razon_social from tercero`));
  const enMt = await bd.conContexto({ ...ctxRi, empresaId: S.empresas.mt.id }, (c) => c.consultar(`select razon_social from tercero`));
  igual([enRi.length, enMt.length], [1, 0], 'filas por empresa');
  let msg = ''; try { await bd.conContexto({ ...ctxRi, empresaId: S.empresas.mt.id }, (c) => c.consultar(`insert into tercero (empresa_id, tipo_documento_codigo, nro_documento, razon_social, condicion_iva_codigo, es_cliente) values ($1, 99, '0', 'Intruso', 5, true)`, [S.empresas.ri.id])); } catch (e) { msg = e.message; }
  verdad(/row-level security|violates/i.test(msg), `no debía poder escribir en otra empresa: ${msg}`);
  msg = ''; try { await bd.conContexto(ctxRi, (c) => c.consultar(`update evento set accion = 'x'`)); } catch (e) { msg = e.message; } verdad(/permission denied/i.test(msg), `la API no debe poder alterar la trazabilidad: ${msg}`);
});
await prueba('Adaptador pg: ante un error se deshace todo y la conexión queda sana para el siguiente pedido', async () => {
  const ctx = { estudioId: S.estudios.e1, empresaId: S.empresas.ri.id, usuarioId: S.usuarios.admin.id };
  const antes = (await bd.conContexto(ctx, (c) => c.uno(`select count(*)::int n from tercero`))).n;
  let falla = ''; try { await bd.conContexto(ctx, async (c) => { await c.consultar(`insert into tercero (empresa_id, tipo_documento_codigo, nro_documento, razon_social, condicion_iva_codigo, es_cliente) values ($1, 99, '77', 'No debe quedar', 5, true)`, [S.empresas.ri.id]); throw new Error('falla a propósito'); }); } catch (e) { falla = e.message; }
  igual(falla, 'falla a propósito', 'el error original llega intacto');
  igual((await bd.conContexto(ctx, (c) => c.uno(`select count(*)::int n from tercero`))).n, antes, 'nada quedó guardado');
  let sql = ''; try { await bd.conContexto(ctx, (c) => c.consultar(`select * from tabla_que_no_existe`)); } catch (e) { sql = e.code; } igual(sql, '42P01', 'el código de error de PostgreSQL se conserva (la API lo traduce)');
  igual((await bd.sinContexto((c) => c.uno(`select 1 as uno`))).uno, 1, 'la conexión sigue andando');
});
await prueba('Adaptador pg: cada transacción lleva su límite de tiempo (el corte lo impone PostgreSQL; PGlite no lo hace cumplir)', async () => {
  const lento = crearBdPg(entorno.pool, { tiempoMaximoMs: 200 });
  const g = await lento.sinContexto((c) => c.uno(`select current_setting('statement_timeout') s, current_setting('idle_in_transaction_session_timeout') i`));
  igual([g.s, g.i], ['200ms', '200ms'], 'límites fijados dentro de la transacción');
  const fuera = await entorno.pool.query(`select current_setting('statement_timeout') s`); igual(fuera.rows[0].s, '0', 'y no quedan pegados a la conexión');
});

// ---------------------------------------------------------------------------
// 5. Migrador y endurecimiento
// ---------------------------------------------------------------------------
await prueba('Migrador: aplicó todo el modelo en orden, es repetible y avisa qué falta sin cambiar nada', async () => {
  igual(entorno.migracion.aplicadas.length, readdirSync(new URL('../modelo/', import.meta.url)).filter((f) => /^\d\d_.*\.sql$/.test(f)).length, 'archivos aplicados');
  igual(entorno.migracion.aplicadas[0], '00_base.sql', 'el primero'); igual(entorno.migracion.aplicadas.at(-1), '32_endurecimiento_supabase.sql', 'el último');
  const c = new pg.Client({ connectionString: entorno.url }); await c.connect();
  try { igual(await migrar(c, { aplicar: true }), { aplicadas: [], pendientes: [] }, 'segunda vez: nada'); igual(await migrar(c), { aplicadas: [], pendientes: [] }, 'consulta: nada pendiente'); } finally { await c.end(); }
});
await prueba('Migrador: detecta un archivo aplicado que fue modificado, y aplica solo los archivos nuevos', async () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'migr-')); const origen = new URL('../modelo/', import.meta.url);
  try {
    for (const f of readdirSync(origen).filter((x) => /^\d\d_.*\.sql$/.test(x))) writeFileSync(join(carpeta, f), readFileSync(new URL(f, origen)));
    const c = new pg.Client({ connectionString: entorno.url }); await c.connect();
    try {
      igual(await migrar(c, { carpeta: new URL(`file:///${carpeta.replace(/\\/g, '/')}/`) }), { aplicadas: [], pendientes: [] }, 'carpeta idéntica');
      writeFileSync(join(carpeta, '21_prueba.sql'), 'create table prueba_migracion (id int);');
      const nueva = new URL(`file:///${carpeta.replace(/\\/g, '/')}/`);
      igual((await migrar(c, { carpeta: nueva })).pendientes, ['21_prueba.sql'], 'detecta el nuevo');
      igual((await migrar(c, { carpeta: nueva, aplicar: true })).aplicadas, ['21_prueba.sql'], 'lo aplica');
      writeFileSync(join(carpeta, '21_prueba.sql'), 'create table prueba_migracion (id int, extra int);');
      const msg = await (async () => { try { await migrar(c, { carpeta: nueva, aplicar: true }); return ''; } catch (e) { return e.message; } })();
      verdad(/ya estaba aplicado y ahora es distinto/.test(msg), `debía frenar: ${msg}`);
      writeFileSync(join(carpeta, '22_falla.sql'), 'create table sera_revertida (id int); select * from no_existe;'); writeFileSync(join(carpeta, '21_prueba.sql'), 'create table prueba_migracion (id int);');
      const m2 = await (async () => { try { await migrar(c, { carpeta: nueva, aplicar: true }); return ''; } catch (e) { return e.message; } })();
      verdad(/^22_falla\.sql:/.test(m2), `el error nombra el archivo: ${m2}`);
      igual((await c.query(`select to_regclass('sera_revertida') r`)).rows[0].r, null, 'un archivo que falla se revierte entero');
      igual((await c.query(`select count(*)::int n from schema_migracion where archivo = '22_falla.sql'`)).rows[0].n, 0, 'y no queda registrado');
    } finally { await c.query('drop table if exists prueba_migracion'); await c.query(`delete from schema_migracion where archivo like '2[12]_%'`); await c.end(); }
  } finally { rmSync(carpeta, { recursive: true, force: true }); }
});
await prueba('Endurecimiento (Supabase): anon y authenticated no tienen acceso a nada, ni siquiera a las funciones de identidad; app_usuario sí', async () => {
  const q = async (sql, p) => (await entorno.pool.query(sql, p)).rows[0];
  for (const rol of ['anon', 'authenticated']) {
    igual((await q(`select has_table_privilege($1, 'tercero', 'select') ok`, [rol])).ok, false, `${rol} no lee tablas`);
    igual((await q(`select has_table_privilege($1, 'evento', 'insert') ok`, [rol])).ok, false, `${rol} no escribe la trazabilidad`);
    igual((await q(`select has_function_privilege($1, 'fn_autenticar(text,text,boolean)', 'execute') ok`, [rol])).ok, false, `${rol} no ejecuta fn_autenticar`);
    igual((await q(`select has_function_privilege($1, 'fn_contexto_empresa(bigint,bigint)', 'execute') ok`, [rol])).ok, false, `${rol} no ejecuta fn_contexto_empresa`);
  }
  igual((await q(`select has_function_privilege('app_usuario', 'fn_autenticar(text,text,boolean)', 'execute') ok`)).ok, true, 'app_usuario sí ejecuta la función');
  igual((await q(`select has_function_privilege('app_usuario', 'fn_roles_base(bigint)', 'execute') ok`)).ok, false, 'y sigue sin poder crear roles base');
  igual((await q(`select has_function_privilege('public', 'fn_siguiente(bigint, text)', 'execute') ok`).catch(() => ({ ok: false }))).ok, false, 'las funciones ya no son ejecutables por PUBLIC');
  igual((await q(`select has_table_privilege('app_usuario', 'tercero', 'select') ok`)).ok, true, 'app_usuario sí lee tablas');
});
await prueba('Endurecimiento: lo que se crea después tampoco queda abierto para esos roles', async () => {
  await entorno.pool.query(`create table tabla_nueva_prueba (id int); create function fn_nueva_prueba() returns int language sql as 'select 1'`);
  const r = (await entorno.pool.query(`select has_table_privilege('anon', 'tabla_nueva_prueba', 'select') t, has_function_privilege('authenticated', 'fn_nueva_prueba()', 'execute') f, has_function_privilege('app_usuario', 'fn_nueva_prueba()', 'execute') a`)).rows[0];
  await entorno.pool.query(`drop table tabla_nueva_prueba; drop function fn_nueva_prueba()`);
  igual([r.t, r.f, r.a], [false, false, false], 'tabla y función nuevas: cerradas para anon, authenticated y también para la app hasta que se la conceda');
});

// ---------------------------------------------------------------------------
// 6. Configuración y servidor de producción completo (proceso aparte)
// ---------------------------------------------------------------------------
const BUENA = { DATABASE_URL: 'postgres://postgres:x@db.proyecto.supabase.co:5432/postgres', SUPABASE_URL: 'https://proyecto.supabase.co', ORIGENES: 'https://app.ejemplo.com' };
await prueba('Configuración: completa es válida, deriva el emisor y las claves públicas, y no tiene valores por defecto inseguros', async () => {
  const c = leerConfiguracion(BUENA);
  igual([c.jwt.emisor, c.jwt.jwksUrl, c.jwt.audiencia, c.origenes, c.puerto, c.saltosDeProxy], ['https://proyecto.supabase.co/auth/v1', 'https://proyecto.supabase.co/auth/v1/.well-known/jwks.json', 'authenticated', ['https://app.ejemplo.com'], 8080, 0], 'derivados');
  igual(leerConfiguracion({ ...BUENA, SUPABASE_URL: 'https://proyecto.supabase.co/', ORIGENES: 'https://a.com, https://b.com', PORT: '9000', TRUST_PROXY_HOPS: '1', SUPABASE_JWT_SECRET: 'x'.repeat(40) }).origenes, ['https://a.com', 'https://b.com'], 'varios orígenes y barra final');
  verdad(leerConfiguracion({ ...BUENA, SUPABASE_JWT_SECRET: 'x'.repeat(40) }).jwt.secretoHS256, 'secreto heredado opcional');
});
await prueba('Configuración: informa todos los problemas juntos y rechaza "*", http fuera de localhost, rutas en el origen y secretos de juguete', async () => {
  const msg = (env) => { try { leerConfiguracion(env); return ''; } catch (e) { return e.message; } };
  const vacia = msg({}); for (const n of ['DATABASE_URL', 'ORIGENES', 'SUPABASE_URL']) verdad(vacia.includes(n), `debe nombrar ${n}: ${vacia}`);
  verdad(/ORIGENES.*"\*"/.test(msg({ ...BUENA, ORIGENES: '*' })), 'comodín'); verdad(/https/.test(msg({ ...BUENA, ORIGENES: 'http://app.ejemplo.com' })), 'http en producción');
  verdad(/solo el origen/.test(msg({ ...BUENA, ORIGENES: 'https://app.ejemplo.com/' })), 'barra final'); verdad(/solo el origen/.test(msg({ ...BUENA, ORIGENES: 'https://app.ejemplo.com/inicio' })), 'ruta');
  igual(msg({ ...BUENA, ORIGENES: 'http://localhost:3030' }), '', 'localhost sí con http');
  verdad(/SUPABASE_URL: tiene que ser https/.test(msg({ ...BUENA, SUPABASE_URL: 'http://proyecto.supabase.co' })), 'SUPABASE_URL http');
  verdad(/demasiado corto/.test(msg({ ...BUENA, SUPABASE_JWT_SECRET: 'secreto' })), 'secreto corto'); verdad(/DATABASE_URL: tiene que empezar/.test(msg({ ...BUENA, DATABASE_URL: 'mysql://x' })), 'otro motor');
  verdad(/DATABASE_CA/.test(msg({ ...BUENA, DATABASE_CA: 'no es un certificado' })), 'CA inválida');
  igual(leerConfiguracion(BUENA).invitaciones, null, 'sin clave de servicio no hay invitaciones');
  igual(leerConfiguracion({ ...BUENA, SUPABASE_SERVICE_KEY: 'sb_secret_' + 'x'.repeat(30) }).invitaciones, { url: 'https://proyecto.supabase.co', claveServicio: 'sb_secret_' + 'x'.repeat(30), urlRetorno: 'https://app.ejemplo.com' }, 'invitaciones con la URL de la app tomada del primer origen');
  verdad(/clave de servicio/.test(msg({ ...BUENA, SUPABASE_SERVICE_KEY: 'sb_publishable_' + 'x'.repeat(30) })), 'la clave publicable no sirve para invitar');
  verdad(/SUPABASE_URL/.test(msg({ DATABASE_URL: BUENA.DATABASE_URL, ORIGENES: BUENA.ORIGENES, SUPABASE_JWT_SECRET: 'x'.repeat(40), SUPABASE_SERVICE_KEY: 'sb_secret_' + 'x'.repeat(30) })), 'sin URL del proyecto no se acepta una clave de servicio');
  verdad(/URL_APP: tiene que ser https/.test(msg({ ...BUENA, SUPABASE_SERVICE_KEY: 'sb_secret_' + 'x'.repeat(30), URL_APP: 'http://app.ejemplo.com' })), 'URL_APP http');
  igual(leerConfiguracion({ ...BUENA, DATABASE_CA: '-----BEGIN CERTIFICATE-----\\nAAAA\\n-----END CERTIFICATE-----' }).baseDeDatosCa, '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----', 'CA con saltos escritos como \\n');
  verdad(/PORT/.test(msg({ ...BUENA, PORT: 'abc' })), 'puerto'); verdad(/TRUST_PROXY_HOPS/.test(msg({ ...BUENA, TRUST_PROXY_HOPS: '99' })), 'saltos');
});
await prueba('Servidor de producción: arranca con su configuración, verifica un ingreso ES256 real, aísla por empresa y no arranca si falta configuración', async () => {
  const puertoIdp = idp.address().port, puerto = 20000 + Math.floor(Math.random() * 20000), emisor = `http://127.0.0.1:${puertoIdp}/auth/v1`;
  publicadas = [k1.publica];
  const env = { ...process.env, DATABASE_URL: entorno.url, SUPABASE_URL: `http://127.0.0.1:${puertoIdp}`, ORIGENES: 'http://localhost:3030', PORT: String(puerto), HOST: '127.0.0.1', POOL_MAX: '1', SUPABASE_SERVICE_KEY: CLAVE_SERVICIO };
  const hijo = spawn(process.execPath, [fileURLToPath(new URL('./servidor.mjs', import.meta.url))], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let salida = ''; hijo.stdout.on('data', (d) => { salida += d; }); hijo.stderr.on('data', (d) => { salida += d; });
  try {
    for (let i = 0; i < 100 && !/API escuchando/.test(salida); i++) await new Promise((r) => setTimeout(r, 100));
    verdad(/API escuchando/.test(salida), `no arrancó: ${salida}`);
    const t = (extra) => firmarES256(k1, { sub: 'sub-admin', aud: 'authenticated', iss: emisor, exp: ahoraS() + 600, ...extra });
    const pedir = (token, empresa) => fetch(`http://127.0.0.1:${puerto}/api/yo`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(empresa ? { 'X-Empresa-Id': String(empresa) } : {}) } });
    const ok = await pedir(t(), S.empresas.ri.id); igual(ok.status, 200, 'ingreso válido'); const cuerpo = await ok.json();
    igual([cuerpo.empresa_activa.rol, cuerpo.empresas.length], ['Administrador', 2], 'sesión');
    igual((await pedir(t({ iss: 'https://otro.test/auth/v1' }))).status, 401, 'emisor ajeno'); igual((await pedir(t({ exp: ahoraS() - 600 }))).status, 401, 'vencido'); igual((await pedir(null)).status, 401, 'sin token');
    igual((await pedir(t(), S.empresas.ajena.id)).status, 403, 'empresa de otro estudio'); igual((await pedir(t({ sub: 'desconocida' }))).status, 403, 'persona desconocida');
    verdad(!/eyJ/.test(salida) && !/Bearer/.test(salida), 'el registro no debe contener tokens');
    // Invitación de punta a punta: persona nueva → el servidor llama al proveedor con la clave de servicio.
    const post = (ruta, cuerpo) => fetch('http://127.0.0.1:' + puerto + ruta, { method: 'POST', headers: { Authorization: 'Bearer ' + t(), 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const persona = await (await post('/api/estudio/personas', { email: 'Recien.Llegada@Estudio.test', nombre: 'Recién Llegada' })).json();
    const inv = await post('/api/estudio/personas/' + persona.id + '/invitacion', {}); igual(inv.status, 200, 'invita');
    igual((await inv.json()).estado, 'invitada', 'estado');
    igual(invitacionesRecibidas.map((x) => [x.email, x.redirect, x.auth, x.apikey]), [['recien.llegada@estudio.test', 'http://localhost:3030', 'Bearer ' + CLAVE_SERVICIO, CLAVE_SERVICIO]], 'el proveedor recibió la invitación con la clave de servicio y la dirección de la aplicación');
    verdad(!salida.includes(CLAVE_SERVICIO), 'la clave de servicio no aparece en el registro del servidor');
  } finally { hijo.kill(); }
  const sinConfig = spawnSync(process.execPath, [fileURLToPath(new URL('./servidor.mjs', import.meta.url))], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  igual(sinConfig.status, 1, 'sin configuración no arranca'); verdad(/DATABASE_URL: falta/.test(sinConfig.stderr), `explica qué falta: ${sinConfig.stderr}`);
});

await entorno.cerrar();
await new Promise((r) => idp.close(r));
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla`);
process.exit(fallas ? 1 : 0);
