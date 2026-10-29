// Pruebas de la API (primer tramo): sesión y permisos, clientes, proveedores, artículos, precios y factura de venta sin ARCA.
// Corren contra la base REAL del modelo (PGlite) y un servidor HTTP real en un puerto libre; no usan red externa.
// Uso:  node api/probar_api.mjs
import http from 'node:http';
import { crearBase } from '../modelo/cargar.mjs';
import { sembrarDemo } from './semilla.mjs';
import { crearBd } from './bd.mjs';
import { crearBdPg } from './bd_pg.mjs';
import { crearEntornoPg } from './entorno_pg_prueba.mjs';
import { crearAutenticador, firmarJwtHS256, verificarJwtHS256 } from './auth.mjs';
import { crearApi } from './app.mjs';
import { crearLimitador } from '../asistente/http.mjs';
import { calcularVenta } from './calculo_venta.mjs';
import { compra as motorCompra } from '../reglas/calculo.mjs';
import { cuitConDigito } from './cuit.mjs';

let correctas = 0, fallas = 0;
async function prueba(nombre, fn) {
  try { await fn(); correctas += 1; console.log(`ok     ${nombre}`); }
  catch (error) { fallas += 1; console.log(`FALLA  ${nombre}\n         ${String(error.message).split('\n').slice(0, 4).join('\n         ')}`); }
}
const igual = (a, b, que = 'valor') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${que}: esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`); };
const verdad = (c, que) => { if (!c) throw new Error(que); };

/* ---------- entorno ---------- */
const SECRETO = 'secreto-de-prueba-de-32-caracteres-minimo!!', EMISOR = 'https://demo.supabase.test/auth/v1';
// ADAPTADOR=pg corre las mismas pruebas pasando por el adaptador de producción (`pg` + migrador) contra PGlite expuesto por socket.
const MODO_PG = process.env.ADAPTADOR === 'pg' || process.argv.includes('--pg');
let db, bd, cerrarBase = async () => {};
if (MODO_PG) { const e = await crearEntornoPg(); db = e.pool; bd = crearBdPg(e.pool); cerrarBase = e.cerrar; }
else { db = (await crearBase()).db; bd = crearBd(db); }
const S = await sembrarDemo(db);
const autenticar = crearAutenticador({ bd, secreto: SECRETO, emisor: EMISOR });
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const uno = async (sql, p = []) => (await q(sql, p))[0];

function iniciarServidor(opciones = {}) {
  const manejador = crearApi({ bd, autenticar, origenesPermitidos: ['https://app.ejemplo.test'], limitar: crearLimitador(10000), ...opciones });
  const srv = http.createServer(manejador);
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${srv.address().port}`, cerrar: () => new Promise((r) => srv.close(r)) })));
}
const srv = await iniciarServidor();

const token = ({ sub, email, verificado = true, exp = Math.floor(Date.now() / 1000) + 3600, extra = {} } = {}) =>
  firmarJwtHS256({ sub, email, aud: 'authenticated', iss: EMISOR, exp, user_metadata: { email_verified: verificado }, ...extra }, SECRETO);
const SESION = { admin: token({ sub: 'sub-admin' }), consulta: token({ sub: 'sub-consulta' }), otro: token({ sub: 'sub-otro' }), baja: token({ sub: 'sub-baja' }) };
async function api(quien, metodo, ruta, { cuerpo, empresa, cabeceras = {}, servidor = srv } = {}) {
  const t = SESION[quien] ?? quien;
  const r = await fetch(servidor.base + ruta, { method: metodo, headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(empresa ? { 'X-Empresa-Id': String(empresa) } : {}), ...cabeceras },
    body: cuerpo === undefined ? undefined : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) });
  const texto = await r.text(); let json = null; try { json = texto ? JSON.parse(texto) : null; } catch (e) { /* no era JSON */ }
  return { estado: r.status, cuerpo: json, texto, cabeceras: r.headers };
}
const RI = S.empresas.ri.id, MT = S.empresas.mt.id, AJENA = S.empresas.ajena.id;
const CUIT = (p) => cuitConDigito(p);
SESION.auxiliar = token({ sub: 'sub-auxiliar', email: 'auxiliar@estudio.test' });     // su primer ingreso se vincula por email

// ---------------------------------------------------------------------------
// 1. Verificación del token
// ---------------------------------------------------------------------------
await prueba('Token: acepta uno válido y rechaza firma ajena, algoritmo distinto, "none", vencido, todavía no vigente, audiencia y emisor incorrectos', async () => {
  const opc = { secreto: SECRETO, audiencia: 'authenticated', emisor: EMISOR };
  igual(verificarJwtHS256(token({ sub: 'x' }), opc).sub, 'x', 'válido');
  const motivo = (t, o = opc) => { try { verificarJwtHS256(t, o); return 'ACEPTADO'; } catch (e) { return e.message; } };
  igual(motivo(firmarJwtHS256({ sub: 'x', aud: 'authenticated', iss: EMISOR, exp: 9999999999 }, 'otro-secreto-cualquiera-0123456789')), 'firma', 'firma ajena');
  const partes = token({ sub: 'x' }).split('.');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  igual(motivo(`${b64({ alg: 'none', typ: 'JWT' })}.${partes[1]}.`), 'algoritmo', 'alg none');
  igual(motivo(`${b64({ alg: 'HS512', typ: 'JWT' })}.${partes[1]}.${partes[2]}`), 'algoritmo', 'otro algoritmo');
  igual(motivo(`${partes[0]}.${b64({ sub: 'otra-persona', aud: 'authenticated', iss: EMISOR, exp: 9999999999 })}.${partes[2]}`), 'firma', 'payload alterado');
  igual(motivo(token({ sub: 'x', exp: Math.floor(Date.now() / 1000) - 3600 })), 'vencido', 'vencido');
  igual(motivo(token({ sub: 'x', extra: { nbf: Math.floor(Date.now() / 1000) + 3600 } })), 'todavía no vale', 'nbf');
  igual(motivo(token({ sub: 'x' }), { ...opc, audiencia: 'otra' }), 'audiencia', 'audiencia'); igual(motivo(token({ sub: 'x' }), { ...opc, emisor: 'https://malo.test' }), 'emisor', 'emisor');
  igual(motivo(firmarJwtHS256({ aud: 'authenticated', iss: EMISOR, exp: 9999999999 }, SECRETO)), 'sin sub', 'sin sub');
  igual(motivo('no.es.un-token'), 'formato', 'basura'); igual(motivo('a'.repeat(5000)), 'formato', 'demasiado largo');
});

// ---------------------------------------------------------------------------
// 2. Acceso en la base (funciones de identidad y contexto)
// ---------------------------------------------------------------------------
await prueba('Acceso: por "sub", por email solo si está verificado y solo una vez, y nunca para una persona dada de baja', async () => {
  const f = (sub, email, ver) => uno('select * from fn_autenticar($1,$2,$3)', [sub, email, ver]);
  igual((await f('sub-admin', null, false)).usuario_id, S.usuarios.admin.id, 'por sub');
  igual(await f('sub-nuevo-1', 'consulta@estudio.test', false), undefined, 'email sin verificar'); igual(await f('sub-baja', null, true), undefined, 'dada de baja');
  igual(await f('', 'admin@estudio.test', true), undefined, 'sin sub'); igual(await f(null, 'admin@estudio.test', true), undefined, 'sub nulo');
  igual((await f('sub-aux-1', 'AUXILIAR@estudio.test', true)).usuario_id, S.usuarios.auxiliar.id, 'primer ingreso por email verificado (sin importar mayúsculas)');
  igual((await uno('select auth_sub from usuario where id = $1', [S.usuarios.auxiliar.id])).auth_sub, 'sub-aux-1', 'quedó vinculado');
  igual(await f('sub-otro-distinto', 'auxiliar@estudio.test', true), undefined, 'ya vinculado: otro "sub" con el mismo email no entra');
  await q('update usuario set auth_sub = $2 where id = $1', [S.usuarios.auxiliar.id, 'sub-auxiliar']);   // la prueba de HTTP usa este
  SESION.auxiliar = token({ sub: 'sub-auxiliar' });
});
await prueba('Contexto: devuelve el rol y los permisos solo de las empresas de la persona y de su estudio', async () => {
  const c = (u, e) => uno('select * from fn_contexto_empresa($1,$2)', [u, e]);
  const admin = await c(S.usuarios.admin.id, RI); igual(admin.rol, 'Administrador', 'rol'); verdad(admin.permisos.includes('ventas.emitir') && admin.permisos.includes('clientes.editar'), 'permisos del administrador');
  const con = await c(S.usuarios.consulta.id, RI); igual(con.rol, 'Consulta', 'rol'); verdad(con.permisos.includes('ventas.ver') && !con.permisos.includes('ventas.emitir') && !con.permisos.includes('clientes.editar'), 'la consulta solo ve');
  igual(await c(S.usuarios.consulta.id, MT), undefined, 'empresa sin vínculo'); igual(await c(S.usuarios.admin.id, AJENA), undefined, 'empresa de otro estudio'); igual(await c(S.usuarios.baja.id, RI), undefined, 'persona dada de baja');
  igual((await q('select * from fn_empresas_de($1)', [S.usuarios.admin.id])).map((e) => e.razon_social), ['Comercial Andina SA', 'Panadería La Espiga'], 'empresas del administrador');
  igual((await q('select * from fn_empresas_de($1)', [S.usuarios.otro.id])).length, 1, 'empresas de la otra persona');
});
await prueba('Acceso: las funciones de identidad no se pueden usar sin ser la aplicación, y los roles base se pueden volver a crear sin duplicar', async () => {
  const n0 = (await uno('select count(*)::int n from rol where estudio_id = $1', [S.estudios.e1])).n;
  await q('select fn_roles_base($1)', [S.estudios.e1]); igual((await uno('select count(*)::int n from rol where estudio_id = $1', [S.estudios.e1])).n, n0, 'roles duplicados');
  await q('set role app_usuario'); let msg = '';
  try { await q('select fn_roles_base($1)', [S.estudios.e1]); } catch (e) { msg = e.message; } finally { await q('reset role'); }
  verdad(/permission denied/i.test(msg), `la aplicación no debe poder crear roles: ${msg}`);
});

// ---------------------------------------------------------------------------
// 3. Sesión por HTTP
// ---------------------------------------------------------------------------
await prueba('Sesión: sin token, token inválido o vencido → 401; persona desconocida o dada de baja → 403', async () => {
  igual((await api(null, 'GET', '/api/yo')).estado, 401, 'sin token'); igual((await api('basura', 'GET', '/api/yo')).estado, 401, 'token inválido');
  igual((await api(token({ sub: 'sub-admin', exp: 1 }), 'GET', '/api/yo')).estado, 401, 'vencido');
  const des = await api(token({ sub: 'nadie' }), 'GET', '/api/yo'); igual(des.estado, 403, 'desconocida'); igual(des.cuerpo.error.codigo, 'sin_acceso', 'código');
  igual((await api('baja', 'GET', '/api/yo')).estado, 403, 'dada de baja');
  igual((await api(token({ sub: 'nuevo-sin-verificar', email: 'consulta@estudio.test', verificado: false }), 'GET', '/api/yo')).estado, 403, 'email sin verificar');
});
await prueba('Sesión: /api/yo muestra las empresas de la persona y, con X-Empresa-Id, sus permisos; no deja abrir empresas ajenas', async () => {
  const yo = await api('admin', 'GET', '/api/yo'); igual(yo.estado, 200, 'estado'); igual(yo.cuerpo.empresas.map((e) => e.id), [RI, MT], 'empresas'); igual(yo.cuerpo.empresa_activa, null, 'sin empresa activa');
  const conEmpresa = await api('admin', 'GET', '/api/yo', { empresa: RI }); igual(conEmpresa.cuerpo.empresa_activa.rol, 'Administrador', 'rol'); igual(conEmpresa.cuerpo.empresa_activa.condicion_iva_codigo, 1, 'condición de la empresa'); verdad(conEmpresa.cuerpo.empresa_activa.permisos.includes('ventas.emitir'), 'permisos');
  igual((await api('consulta', 'GET', '/api/yo', { empresa: MT })).estado, 403, 'empresa sin vínculo'); igual((await api('admin', 'GET', '/api/yo', { empresa: AJENA })).estado, 403, 'empresa de otro estudio');
  igual((await api('admin', 'GET', '/api/yo', { empresa: 99999 })).estado, 403, 'empresa inexistente'); igual((await api('admin', 'GET', '/api/yo', { empresa: '1 or 1=1' })).estado, 403, 'basura en el encabezado');
  igual((await api('otro', 'GET', '/api/yo')).cuerpo.empresas.map((e) => e.id), [AJENA], 'la otra persona ve solo la suya');
});
await prueba('Sesión: el primer ingreso se vincula por email verificado y después solo entra con ese mismo "sub"', async () => {
  igual((await api('auxiliar', 'GET', '/api/yo', { empresa: RI })).estado, 200, 'ingresa');
  igual((await api(token({ sub: 'otro-sub', email: 'auxiliar@estudio.test' }), 'GET', '/api/yo')).estado, 403, 'otro sub con el mismo email');
});
await prueba('Pedidos: sin empresa → 400, sin permiso → 403, ruta o método inexistentes → 404/405, contenido que no es JSON → 415', async () => {
  igual((await api('admin', 'GET', '/api/clientes')).cuerpo.error.codigo, 'falta_empresa', 'sin empresa');
  igual((await api('consulta', 'GET', '/api/clientes', { empresa: RI })).estado, 200, 'la consulta puede ver');
  igual((await api('consulta', 'POST', '/api/clientes', { empresa: RI, cuerpo: {} })).estado, 403, 'la consulta no crea');
  igual((await api('consulta', 'POST', '/api/ventas/facturas', { empresa: RI, cuerpo: {} })).estado, 403, 'la consulta no emite');
  igual((await api('admin', 'GET', '/api/inexistente', { empresa: RI })).estado, 404, 'ruta'); igual((await api('admin', 'DELETE', '/api/clientes', { empresa: RI })).estado, 405, 'método');
  igual((await api('admin', 'POST', '/api/clientes', { empresa: RI, cuerpo: 'x', cabeceras: { 'Content-Type': 'text/plain' } })).estado, 415, 'tipo');
  igual((await api('admin', 'GET', '/api/clientes/abc', { empresa: RI })).estado, 404, 'id que no es número');
});

// ---------------------------------------------------------------------------
// 4. Clientes y proveedores
// ---------------------------------------------------------------------------
const clienteRI = { tipo_documento: 'CUIT', nro_documento: CUIT('3070811222'), razon_social: 'Distribuidora Sur SRL', condicion_iva_codigo: 1, condicion_pago_dias: 30, email: 'compras@sur.test' };
const ids = {};
await prueba('Clientes: se crea con datos válidos, queda en la trazabilidad con quién y cuándo, y se puede leer', async () => {
  const r = await api('admin', 'POST', '/api/clientes', { empresa: RI, cuerpo: { ...clienteRI, nro_documento: clienteRI.nro_documento.replace(/(\d{2})(\d{8})(\d)/, '$1-$2-$3') } });
  igual(r.estado, 201, `estado ${JSON.stringify(r.cuerpo)}`); ids.sur = r.cuerpo.id; igual(r.cuerpo.tipo_documento, 'CUIT', 'tipo'); igual(r.cuerpo.nro_documento, clienteRI.nro_documento, 'documento sin guiones'); igual(r.cuerpo.es_cliente, true, 'rol');
  const ev = await uno(`select categoria, accion, usuario_id, empresa_id, entidad_tabla, entidad_id from evento where entidad_tabla = 'tercero' and entidad_id = $1`, [ids.sur]);
  igual([ev.categoria, ev.accion, ev.usuario_id, ev.empresa_id, ev.entidad_id], ['maestros', 'Dio de alta el cliente Distribuidora Sur SRL', S.usuarios.admin.id, RI, ids.sur], 'evento');
  igual((await api('admin', 'GET', `/api/clientes/${ids.sur}`, { empresa: RI })).cuerpo.razon_social, 'Distribuidora Sur SRL', 'lectura');
});
await prueba('Clientes: las reglas de documento y de condición frente al IVA se informan campo por campo', async () => {
  const mal = async (cuerpo, campo) => { const r = await api('admin', 'POST', '/api/clientes', { empresa: RI, cuerpo: { ...clienteRI, ...cuerpo } }); igual(r.estado, 422, `${campo}: estado (${JSON.stringify(r.cuerpo)})`); verdad(campo in r.cuerpo.error.campos, `${campo} en ${JSON.stringify(r.cuerpo.error.campos)}`); return r; };
  await mal({ nro_documento: '30000000000' }, 'nro_documento');
  await mal({ nro_documento: CUIT('3070811222').slice(0, 10) }, 'nro_documento');
  await mal({ tipo_documento: 'DNI', nro_documento: '12345678' }, 'tipo_documento');           // un responsable inscripto necesita CUIT
  await mal({ tipo_documento: 'SIN_IDENTIFICAR', nro_documento: '0' }, 'tipo_documento');
  await mal({ condicion_iva_codigo: 77 }, 'condicion_iva_codigo'); await mal({ razon_social: 'AB' }, 'razon_social'); await mal({ email: 'no-es-email' }, 'email');
  await mal({ condicion_pago_dias: -1 }, 'condicion_pago_dias'); await mal({ limite_credito: 'mucho' }, 'limite_credito'); await mal({ es_cliente: false }, 'es_cliente'); await mal({ lista_id: 9999 }, 'lista_id');
  const varios = await api('admin', 'POST', '/api/clientes', { empresa: RI, cuerpo: { razon_social: 'x' } }); verdad(Object.keys(varios.cuerpo.error.campos).length >= 4, 'devuelve todos los errores juntos');
  const sinId = await api('admin', 'POST', '/api/clientes', { empresa: RI, cuerpo: { tipo_documento: 'SIN_IDENTIFICAR', nro_documento: '0', razon_social: 'Consumidor Final', condicion_iva_codigo: 5 } });
  igual(sinId.estado, 201, 'consumidor final sin identificar'); ids.cf = sinId.cuerpo.id;
  const dni = await api('admin', 'POST', '/api/clientes', { empresa: RI, cuerpo: { tipo_documento: 'DNI', nro_documento: '27.345.118', razon_social: 'Marta Gómez', condicion_iva_codigo: 5 } }); igual(dni.estado, 201, 'consumidor final con DNI'); ids.marta = dni.cuerpo.id;
});
await prueba('Clientes: no se repite el documento, y dar de alta como proveedor a quien ya es cliente le suma el rol en vez de duplicarlo', async () => {
  const dup = await api('admin', 'POST', '/api/clientes', { empresa: RI, cuerpo: clienteRI }); igual(dup.estado, 409, 'duplicado'); verdad(/Distribuidora Sur/.test(dup.cuerpo.error.mensaje), 'dice cuál es');
  const prov = await api('admin', 'POST', '/api/proveedores', { empresa: RI, cuerpo: { tipo_documento: 'CUIT', nro_documento: clienteRI.nro_documento, razon_social: 'Distribuidora Sur SRL', condicion_iva_codigo: 1 } });
  igual(prov.estado, 200, 'rol agregado'); igual(prov.cuerpo.id, ids.sur, 'es la misma persona'); igual(prov.cuerpo.es_cliente && prov.cuerpo.es_proveedor, true, 'ambos roles');
  igual((await api('admin', 'POST', '/api/proveedores', { empresa: RI, cuerpo: { tipo_documento: 'CUIT', nro_documento: clienteRI.nro_documento, razon_social: 'x'.repeat(5), condicion_iva_codigo: 1 } })).estado, 409, 'ya es proveedor');
  const dni = await api('admin', 'POST', '/api/proveedores', { empresa: RI, cuerpo: { tipo_documento: 'DNI', nro_documento: '11222333', razon_social: 'Persona Física', condicion_iva_codigo: 5 } }); igual(dni.estado, 422, 'un proveedor se identifica con CUIT');
});
await prueba('Clientes: búsqueda, filtro de bajas y paginación; los comodines del buscador no se interpretan', async () => {
  for (const n of ['Alfa', 'Beta', 'Gama']) await api('admin', 'POST', '/api/clientes', { empresa: RI, cuerpo: { tipo_documento: 'CUIT', nro_documento: CUIT('3071000' + String(['Alfa', 'Beta', 'Gama'].indexOf(n)).padStart(3, '0')), razon_social: `Cliente ${n} SA`, condicion_iva_codigo: 1 } });
  const todos = await api('admin', 'GET', '/api/clientes', { empresa: RI }); verdad(todos.cuerpo.total >= 6, 'total'); igual(todos.cuerpo.datos.map((c) => c.razon_social), [...todos.cuerpo.datos.map((c) => c.razon_social)].sort((a, b) => a.localeCompare(b, 'es')), 'ordenados');
  igual((await api('admin', 'GET', '/api/clientes?q=gama', { empresa: RI })).cuerpo.datos.length, 1, 'q ignora mayúsculas'); igual((await api('admin', 'GET', '/api/clientes?q=%25', { empresa: RI })).cuerpo.datos.length, 0, 'el % no es comodín');
  igual((await api('admin', 'GET', '/api/clientes?limite=2&desplazamiento=1', { empresa: RI })).cuerpo.datos.length, 2, 'paginación'); igual((await api('admin', 'GET', '/api/clientes?q=Distribuidora', { empresa: RI })).cuerpo.datos[0].id, ids.sur, 'por nombre');
  igual((await api('admin', 'GET', `/api/clientes?q=${clienteRI.nro_documento}`, { empresa: RI })).cuerpo.datos[0].id, ids.sur, 'por documento');
  verdad((await api('admin', 'GET', '/api/clientes?limite=100000', { empresa: RI })).cuerpo.limite <= 100, 'tope de página');
});
await prueba('Clientes: modificar deja el antes y el después; el documento no se cambia; la baja es lógica y no borra', async () => {
  const r = await api('admin', 'PATCH', `/api/clientes/${ids.sur}`, { empresa: RI, cuerpo: { razon_social: 'Distribuidora Sur S.R.L.', condicion_pago_dias: 45 } }); igual(r.estado, 200, JSON.stringify(r.cuerpo)); igual(r.cuerpo.condicion_pago_dias, 45, 'cambió');
  const ev = await uno(`select cambios from evento where accion = 'Modificó el cliente Distribuidora Sur S.R.L.'`); igual(ev.cambios.map((x) => x.campo).sort(), ['condicion_pago_dias', 'razon_social'], 'campos'); igual(ev.cambios.find((x) => x.campo === 'condicion_pago_dias').antes, '30', 'antes');
  igual((await api('admin', 'PATCH', `/api/clientes/${ids.sur}`, { empresa: RI, cuerpo: { nro_documento: '20000000001' } })).estado, 422, 'el documento no se cambia');
  igual((await api('admin', 'PATCH', `/api/clientes/${ids.sur}`, { empresa: RI, cuerpo: {} })).estado, 422, 'sin cambios');
  igual((await api('admin', 'PATCH', `/api/clientes/${ids.marta}`, { empresa: RI, cuerpo: { condicion_iva_codigo: 1 } })).estado, 422, 'RI sin CUIT');
  const antes = (await q(`select count(*)::int n from evento where categoria = 'maestros'`))[0].n;
  await api('admin', 'PATCH', `/api/clientes/${ids.sur}`, { empresa: RI, cuerpo: { condicion_pago_dias: 45 } }); igual((await q(`select count(*)::int n from evento where categoria = 'maestros'`))[0].n, antes, 'sin cambios reales no hay evento');
  igual((await api('admin', 'PATCH', `/api/clientes/${ids.marta}`, { empresa: RI, cuerpo: { activo: false } })).cuerpo.activo, false, 'baja'); igual((await api('admin', 'GET', '/api/clientes?activo=false', { empresa: RI })).cuerpo.datos.length, 1, 'filtro de bajas');
  igual((await api('admin', 'GET', `/api/clientes/${ids.marta}`, { empresa: RI })).estado, 200, 'sigue existiendo');
});
await prueba('Aislamiento: ni otra empresa del mismo estudio ni otro estudio ven ni tocan estos datos (404, no 403)', async () => {
  igual((await api('admin', 'GET', `/api/clientes/${ids.sur}`, { empresa: MT })).estado, 404, 'otra empresa del estudio'); igual((await api('admin', 'GET', '/api/clientes', { empresa: MT })).cuerpo.total, 0, 'lista vacía en la otra empresa');
  igual((await api('admin', 'PATCH', `/api/clientes/${ids.sur}`, { empresa: MT, cuerpo: { condicion_pago_dias: 1 } })).estado, 404, 'no se modifica desde otra empresa');
  igual((await api('otro', 'GET', `/api/clientes/${ids.sur}`, { empresa: AJENA })).estado, 404, 'otro estudio'); igual((await api('otro', 'GET', '/api/clientes', { empresa: AJENA })).cuerpo.total, 0, 'lista vacía en otro estudio');
  igual((await api('otro', 'GET', '/api/clientes', { empresa: RI })).estado, 403, 'no abre empresas ajenas');
  igual((await uno('select condicion_pago_dias from tercero where id = $1', [ids.sur])).condicion_pago_dias, 45, 'el dato sigue intacto');
});

// ---------------------------------------------------------------------------
// 5. Artículos, listas y precios
// ---------------------------------------------------------------------------
await prueba('Listas y artículos: se crean con IVA, precio y costo; el código se normaliza y no se repite; exento no lleva alícuota', async () => {
  const lista = await api('admin', 'POST', '/api/listas-precio', { empresa: RI, cuerpo: { nombre: 'Mayorista', orden: 2 } }); igual(lista.estado, 201, 'lista'); ids.mayorista = lista.cuerpo.id;
  igual((await api('admin', 'POST', '/api/listas-precio', { empresa: RI, cuerpo: { nombre: 'mayorista' } })).estado, 409, 'lista repetida');
  const listas = (await api('admin', 'GET', '/api/listas-precio', { empresa: RI })).cuerpo.datos; igual(listas.map((l) => l.nombre), ['General', 'Mayorista'], 'listas'); ids.general = listas[0].id;
  const nuevo = (extra) => api('admin', 'POST', '/api/articulos', { empresa: RI, cuerpo: { codigo: 'x', nombre: 'Artículo', ...extra } });
  const a1 = await nuevo({ codigo: 'cons-001', nombre: 'Servicio de consultoría', tipo: 'servicio', alicuota_venta: '21', alicuota_compra: '21', lista_id: ids.general, precio_neto: '120000.00' });
  igual(a1.estado, 201, JSON.stringify(a1.cuerpo)); ids.consultoria = a1.cuerpo.id; igual(a1.cuerpo.codigo, 'CONS-001', 'código en mayúsculas'); igual(a1.cuerpo.controla_stock, false, 'un servicio no lleva stock'); igual(a1.cuerpo.alicuota_venta, '21', 'alícuota'); igual(a1.cuerpo.precios[0].precio_neto, '120000.0000', 'precio');
  const a2 = await nuevo({ codigo: 'PAN-01', nombre: 'Pan lactal x500 g', alicuota_venta: '10.5', lista_id: ids.general, precio_neto: '1850', costo: '1200' }); igual(a2.estado, 201, 'bien'); ids.pan = a2.cuerpo.id; igual(a2.cuerpo.controla_stock, true, 'un bien lleva stock'); igual(a2.cuerpo.alicuota_venta, '10.5', '10,5 %'); igual(a2.cuerpo.costo, '1200.0000', 'costo');
  const a3 = await nuevo({ codigo: 'SEG-01', nombre: 'Seguro exento', tipo: 'servicio', tratamiento_iva_venta: 'exento' }); igual(a3.estado, 201, 'exento'); ids.exento = a3.cuerpo.id; igual(a3.cuerpo.alicuota_venta, null, 'sin alícuota');
  const a4 = await nuevo({ codigo: 'REINT-01', nombre: 'Reintegro de gastos', tipo: 'servicio', tratamiento_iva_venta: 'no_gravado' }); ids.nograv = a4.cuerpo.id;
  const a5 = await nuevo({ codigo: 'TEL-01', nombre: 'Telecomunicaciones', tipo: 'servicio', alicuota_venta: '27', lista_id: ids.general, precio_neto: '38000' }); ids.tel = a5.cuerpo.id;
  const a6 = await nuevo({ codigo: 'GAS-01', nombre: 'Gasto interno', tipo: 'gasto' }); ids.gasto = a6.cuerpo.id;
  igual((await nuevo({ codigo: 'CONS-001' })).estado, 409, 'código repetido'); igual((await nuevo({ codigo: 'no valido!' })).estado, 422, 'código con símbolos');
  const mal = await nuevo({ codigo: 'EX-2', tratamiento_iva_venta: 'exento', alicuota_venta: '21' }); igual(mal.estado, 422, 'exento con alícuota'); verdad('alicuota_venta' in mal.cuerpo.error.campos, 'campo');
  igual((await nuevo({ codigo: 'P-3', precio_neto: '10' })).estado, 422, 'precio sin lista'); igual((await nuevo({ codigo: 'P-4', lista_id: 9999, precio_neto: '10' })).estado, 422, 'lista inexistente'); igual((await nuevo({ codigo: 'P-5', precio_neto: '-1', lista_id: ids.general })).estado, 422, 'precio negativo');
});
await prueba('Artículos: búsqueda con el precio vigente de una lista, modificación con rastro; el código y el tipo no cambian', async () => {
  const l = await api('admin', 'GET', `/api/articulos?q=pan&lista_id=${ids.general}`, { empresa: RI }); igual(l.cuerpo.datos.map((a) => [a.codigo, a.precio_neto]), [['PAN-01', '1850.0000']], 'con precio');
  igual((await api('admin', 'GET', '/api/articulos?tipo=servicio', { empresa: RI })).cuerpo.total, 4, 'filtro por tipo');
  const m = await api('admin', 'PATCH', `/api/articulos/${ids.pan}`, { empresa: RI, cuerpo: { nombre: 'Pan lactal 500 g', alicuota_venta: '21' } }); igual(m.estado, 200, JSON.stringify(m.cuerpo)); igual(m.cuerpo.alicuota_venta, '21', 'cambió la alícuota');
  const ev = await uno(`select cambios from evento where accion = 'Modificó el artículo Pan lactal 500 g'`); igual(ev.cambios.map((x) => x.campo).sort(), ['alicuota_venta', 'nombre'], 'campos del rastro');
  igual((await api('admin', 'PATCH', `/api/articulos/${ids.pan}`, { empresa: RI, cuerpo: { codigo: 'OTRO' } })).estado, 422, 'el código no cambia'); igual((await api('admin', 'PATCH', `/api/articulos/${ids.exento}`, { empresa: RI, cuerpo: { alicuota_venta: '21' } })).estado, 422, 'exento con alícuota');
  await api('admin', 'PATCH', `/api/articulos/${ids.pan}`, { empresa: RI, cuerpo: { alicuota_venta: '10.5', nombre: 'Pan lactal x500 g' } });
});
await prueba('Precios: un cambio rige desde su fecha, el vigente es el último que ya empezó, y queda en la trazabilidad', async () => {
  const hoy = new Date().toISOString().slice(0, 10), manana = new Date(Date.now() + 864e5).toISOString().slice(0, 10), ayer = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  igual((await api('admin', 'PUT', `/api/articulos/${ids.pan}/precios`, { empresa: RI, cuerpo: { lista_id: ids.general, precio_neto: '2000', vigente_desde: manana } })).estado, 200, 'precio futuro');
  const precioHoy = async (f) => (await api('admin', 'GET', `/api/articulos?q=PAN-01&lista_id=${ids.general}&fecha=${f}`, { empresa: RI })).cuerpo.datos[0].precio_neto;
  igual(await precioHoy(hoy), '1850.0000', 'hoy sigue el viejo'); igual(await precioHoy(manana), '2000.0000', 'mañana rige el nuevo'); igual(await precioHoy(ayer), null, 'ayer todavía no había precio');
  igual((await api('admin', 'PUT', `/api/articulos/${ids.pan}/precios`, { empresa: RI, cuerpo: { lista_id: ids.general, precio_neto: '1999.99', vigente_desde: manana } })).estado, 200, 'corregir el mismo día'); igual(await precioHoy(manana), '1999.9900', 'se reemplazó, no se duplicó');
  igual((await api('admin', 'PUT', `/api/articulos/${ids.pan}/precios`, { empresa: RI, cuerpo: { lista_id: 9999, precio_neto: '1' } })).estado, 422, 'lista inexistente'); igual((await api('admin', 'PUT', '/api/articulos/9999/precios', { empresa: RI, cuerpo: { lista_id: ids.general, precio_neto: '1' } })).estado, 404, 'artículo inexistente');
  verdad((await uno(`select count(*)::int n from evento where accion = 'Cambió el precio de Pan lactal x500 g'`)).n >= 2, 'rastro');
  await q('delete from articulo_precio where articulo_id = $1 and vigente_desde > current_date', [ids.pan]);
});

// ---------------------------------------------------------------------------
// 6. Cálculo de la factura
// ---------------------------------------------------------------------------
await prueba('Cálculo: coincide con el motor de reglas de referencia (columnas por alícuota, descuentos y descuento al pie, IVA redondeado por alícuota)', async () => {
  const renglones = [{ precio: '100.00', cantidad: '3', alicuota: '21', descPct: '10' }, { precio: '33.33', cantidad: '7', alicuota: '21' }, { precio: '48.17', cantidad: '12', alicuota: '10.5', descPct: '5' }, { precio: '999.99', cantidad: '1.5', alicuota: '27' }];
  for (const pie of ['0', '5', '12.5']) {
    const m = motorCompra(renglones, { descPiePct: pie });
    const v = calcularVenta(renglones.map((r) => ({ cantidad: r.cantidad, precio: r.precio, descPct: r.descPct ?? '0', tratamiento: 'gravado', alicuota: r.alicuota })), { descPiePct: pie });
    igual(v.impTotal, m.total, `total con pie ${pie}`); igual(v.impIva, m.iva, `IVA con pie ${pie}`);
    for (const col of v.ivas) { igual(col.base, m.columnas[col.alicuota].base, `base ${col.alicuota} pie ${pie}`); igual(col.iva, m.columnas[col.alicuota].iva, `IVA ${col.alicuota} pie ${pie}`); }
  }
});
await prueba('Cálculo: exento y no gravado van en cajas separadas, el total es exactamente la suma de sus partes y no hay punto flotante', async () => {
  const v = calcularVenta([{ cantidad: '2', precio: '120000', tratamiento: 'gravado', alicuota: '21' }, { cantidad: '1', precio: '54000', tratamiento: 'exento' }, { cantidad: '1', precio: '15000', tratamiento: 'no_gravado' }, { cantidad: '3', precio: '0.1', tratamiento: 'gravado', alicuota: '21' }]);
  igual([v.impNeto, v.impIva, v.impOpEx, v.impTotConc, v.impTotal], ['240000.30', '50400.06', '54000.00', '15000.00', '359400.36'], 'importes');
  igual(calcularVenta([{ cantidad: '3', precio: '0.1', tratamiento: 'gravado', alicuota: '0' }]).impTotal, '0.30', '3 × 0,1 = 0,3 exacto');
  igual(calcularVenta([{ cantidad: '1', precio: '1', tratamiento: 'gravado', alicuota: '27' }, { cantidad: '1', precio: '1', tratamiento: 'gravado', alicuota: '10.5' }, { cantidad: '1', precio: '1', tratamiento: 'gravado', alicuota: '21' }]).ivas.map((x) => x.alicuota), ['27', '21', '10.5'], 'columnas de mayor a menor');
});

// ---------------------------------------------------------------------------
// 7. Factura de venta (sin ARCA)
// ---------------------------------------------------------------------------
const hoy = new Date().toISOString().slice(0, 10);
const factura = (cliente, items, extra = {}) => ({ tercero_id: cliente, punto_venta: 1, items, ...extra });
const emitir = (quien, empresa, cuerpo, cabeceras = {}) => api(quien, 'POST', '/api/ventas/facturas', { empresa, cuerpo, cabeceras });
const lineasAsiento = async (id) => (await q(`select c.codigo, l.debe::text d, l.haber::text h from asiento_linea l join plan_cuenta c on c.id = l.cuenta_id where l.asiento_id = $1 order by c.codigo`, [id])).map((l) => `${l.codigo} ${Number(l.d) > 0 ? 'D ' + l.d : 'H ' + l.h}`);

await prueba('Factura A: la letra sale del cliente, el cálculo es exacto, se numera, genera su asiento balanceado y queda en la trazabilidad', async () => {
  const r = await emitir('admin', RI, factura(ids.sur, [{ articulo_id: ids.consultoria, cantidad: '2' }]));
  igual(r.estado, 201, JSON.stringify(r.cuerpo)); const f = r.cuerpo;
  igual([f.letra, f.tipo_comprobante_codigo, f.estado, f.numero_formateado], ['A', 1, 'confirmado', '0001-00000001'], 'tipo, estado y número');
  igual([f.imp_neto, f.imp_iva, f.imp_total, f.imp_trib], ['240000.00', '50400.00', '290400.00', '0.00'], 'importes (los del prototipo)');
  igual(f.condicion_iva_receptor_codigo, 1, 'condición del receptor (RG 5616)'); igual(f.items[0].precio_unitario, '120000.0000', 'precio de la lista'); igual(f.ivas, [{ alicuota: '21', codigo: 5, base_imponible: '240000.00', importe_iva: '50400.00' }], 'IVA por alícuota');
  verdad(f.asiento && f.asiento.estado === 'contabilizado', 'asiento contabilizado'); igual(await lineasAsiento(f.asiento_id ?? f.asiento.id), ['1.1.3 D 290400.00', '2.1.4 H 50400.00', '4.1.1 H 240000.00'], 'asiento');
  const ev = await uno(`select accion, usuario_id from evento where entidad_tabla = 'comprobante' and entidad_id = $1`, [f.id]); igual([ev.accion, ev.usuario_id], ['Emitió Factura A 0001-00000001', S.usuarios.admin.id], 'evento');
  igual((await uno(`select fn_verificar_trazabilidad($1) v`, [S.estudios.e1])).v, null, 'la cadena de la trazabilidad sigue íntegra'); ids.facturaA = f.id;
  igual((await api('admin', 'GET', `/api/clientes/${ids.sur}`, { empresa: RI })).cuerpo.saldo, '290400.00', 'el cliente debe lo facturado');
});
await prueba('Factura: la numeración es correlativa por tipo y punto de venta, y una emisión que falla no consume número ni deja nada a medias', async () => {
  const f2 = await emitir('admin', RI, factura(ids.sur, [{ articulo_id: ids.tel, cantidad: '1' }])); igual(f2.cuerpo.numero_formateado, '0001-00000002', 'segunda');
  const antes = (await uno('select count(*)::int c, (select count(*)::int from asiento) a from comprobante')), numeros = await q(`select clave, valor from secuencia where clave like 'cbte-%'`);
  const mal = await emitir('admin', RI, factura(ids.sur, [{ articulo_id: ids.consultoria, cantidad: '1' }, { articulo_id: ids.pan, cantidad: '5' }])); igual(mal.estado, 422, 'sin stock'); igual(mal.cuerpo.error.codigo, 'stock_insuficiente', 'código');
  const despues = (await uno('select count(*)::int c, (select count(*)::int from asiento) a from comprobante')); igual([despues.c, despues.a], [antes.c, antes.a], 'no quedó nada guardado'); igual(await q(`select clave, valor from secuencia where clave like 'cbte-%'`), numeros, 'la numeración no avanzó');
  igual((await emitir('admin', RI, factura(ids.sur, [{ articulo_id: ids.tel, cantidad: '1' }]))).cuerpo.numero_formateado, '0001-00000003', 'la siguiente no se saltea números');
});
await prueba('Factura B (consumidor final) y C (empresa monotributista): B discrimina IVA, C no', async () => {
  const b = await emitir('admin', RI, factura(ids.cf, [{ articulo_id: ids.tel, cantidad: '1' }])); igual(b.estado, 201, JSON.stringify(b.cuerpo)); igual([b.cuerpo.letra, b.cuerpo.tipo_comprobante_codigo, b.cuerpo.numero_formateado, b.cuerpo.imp_total], ['B', 6, '0001-00000001', '48260.00'], 'B');
  const cli = await api('admin', 'POST', '/api/clientes', { empresa: MT, cuerpo: { tipo_documento: 'CUIT', nro_documento: CUIT('3070811222'), razon_social: 'Distribuidora Sur SRL', condicion_iva_codigo: 1 } }); igual(cli.estado, 201, 'cliente de la otra empresa');
  const art = await api('admin', 'POST', '/api/articulos', { empresa: MT, cuerpo: { codigo: 'PAN', nombre: 'Pan', alicuota_venta: '21', controla_stock: false } }); igual(art.estado, 201, 'artículo de la otra empresa');
  const c = await emitir('admin', MT, factura(cli.cuerpo.id, [{ articulo_id: art.cuerpo.id, cantidad: '10', precio_unitario: '1000' }])); igual(c.estado, 201, JSON.stringify(c.cuerpo));
  igual([c.cuerpo.letra, c.cuerpo.tipo_comprobante_codigo, c.cuerpo.imp_neto, c.cuerpo.imp_iva, c.cuerpo.imp_total], ['C', 11, '10000.00', '0.00', '10000.00'], 'C sin IVA'); igual(c.cuerpo.ivas.map((v) => v.alicuota), ['0'], 'una fila al 0 %');
  igual(await lineasAsiento(c.cuerpo.asiento.id), ['1.1.3 D 10000.00', '4.1.1 H 10000.00'], 'asiento de la C (sin IVA débito)');
  igual((await api('admin', 'GET', '/api/comprobantes', { empresa: RI })).cuerpo.datos.every((x) => x.letra !== 'C'), true, 'la otra empresa no se mezcla');
});
await prueba('Factura con IVA mixto, exento, no gravado y descuentos: coincide con el cálculo previo y con la suma de los renglones', async () => {
  await q(`insert into movimiento_stock (empresa_id, fecha, articulo_id, deposito_id, cantidad, tipo) values ($1, current_date, $2, $3, 100, 'inventario')`, [RI, ids.pan, S.empresas.ri.deposito]);
  const cuerpo = factura(ids.sur, [{ articulo_id: ids.consultoria, cantidad: '2', desc_pct: '10' }, { articulo_id: ids.pan, cantidad: '12', precio_unitario: '48.17', desc_pct: '5' }, { articulo_id: ids.tel, cantidad: '1.5' }, { articulo_id: ids.exento, cantidad: '1', precio_unitario: '54000' }, { articulo_id: ids.nograv, cantidad: '1', precio_unitario: '15000' }], { desc_pie_pct: '5' });
  const prev = await api('admin', 'POST', '/api/ventas/facturas/calcular', { empresa: RI, cuerpo }); igual(prev.estado, 200, JSON.stringify(prev.cuerpo));
  const antes = (await uno('select count(*)::int c from comprobante')).c; const r = await emitir('admin', RI, cuerpo); igual(r.estado, 201, JSON.stringify(r.cuerpo)); const f = r.cuerpo;
  igual((await uno('select count(*)::int c from comprobante')).c, antes + 1, 'el cálculo previo no había guardado nada');
  for (const k of ['imp_neto', 'imp_iva', 'imp_tot_conc', 'imp_op_ex', 'imp_desc_pie', 'imp_total']) igual(f[k], prev.cuerpo[k], `${k}: igual al cálculo previo`);
  const suma = (a) => a.reduce((s, x) => s + Math.round(Number(x) * 100), 0);
  igual(suma([f.imp_neto, f.imp_iva, f.imp_tot_conc, f.imp_op_ex, f.imp_trib]), suma([f.imp_total]), 'total = suma de sus partes'); igual(f.imp_op_ex, '54000.00', 'exento aparte'); igual(f.imp_tot_conc, '15000.00', 'no gravado aparte'); igual(f.ivas.map((v) => v.alicuota), ['27', '21', '10.5'].filter((a) => f.ivas.some((v) => v.alicuota === a)), 'alícuotas');
  igual((await uno('select abs(sum(debe) - sum(haber))::text d from asiento_linea where asiento_id = $1', [f.asiento.id])).d, '0.00', 'el asiento balancea');
  verdad(Number(prev.cuerpo.imp_desc_pie) > 0, 'hubo descuento al pie');
});
await prueba('Factura: descuenta stock del depósito, no deja stock negativo ni toca los servicios, y el stock queda registrado contra el renglón', async () => {
  const saldo = async () => Number((await uno('select coalesce(sum(cantidad), 0)::text s from movimiento_stock where articulo_id = $1', [ids.pan])).s);
  const antes = await saldo(); const r = await emitir('admin', RI, factura(ids.sur, [{ articulo_id: ids.pan, cantidad: '4' }])); igual(r.estado, 201, JSON.stringify(r.cuerpo)); igual(await saldo(), antes - 4, 'bajó 4');
  const mov = await uno(`select tipo, cantidad::text c, comprobante_item_id from movimiento_stock where tipo = 'venta' order by id desc limit 1`); igual([mov.tipo, mov.c], ['venta', '-4.0000'], 'movimiento'); verdad(mov.comprobante_item_id, 'enlazado al renglón');
  const todo = await emitir('admin', RI, factura(ids.sur, [{ articulo_id: ids.pan, cantidad: String(antes + 1000) }])); igual(todo.cuerpo.error.codigo, 'stock_insuficiente', 'más de lo que hay'); verdad(/Pan lactal/.test(todo.cuerpo.error.mensaje), 'dice cuál artículo'); igual(await saldo(), antes - 4, 'no cambió');
  const antesServ = (await uno('select count(*)::int c from movimiento_stock')).c; await emitir('admin', RI, factura(ids.sur, [{ articulo_id: ids.consultoria, cantidad: '1' }])); igual((await uno('select count(*)::int c from movimiento_stock')).c, antesServ, 'un servicio no mueve stock');
});
await prueba('Factura: servicios exigen fechas, la fecha tiene que caer en un período abierto y cerca de hoy, y el punto de venta tiene que servir', async () => {
  const mal = async (extra, campo, items = [{ articulo_id: ids.consultoria, cantidad: '1' }]) => { const r = await emitir('admin', RI, { ...factura(ids.sur, items), ...extra }); igual(r.estado, r.cuerpo.error.codigo === 'arca_pendiente' ? 409 : 422, `${campo}: ${JSON.stringify(r.cuerpo)}`); verdad(campo === 'arca_pendiente' ? r.cuerpo.error.codigo === 'arca_pendiente' : campo in r.cuerpo.error.campos, `${campo}: ${JSON.stringify(r.cuerpo)}`); };
  await mal({ concepto: 2 }, 'fecha_servicio_desde'); await mal({ concepto: 2, fecha_servicio_desde: hoy, fecha_servicio_hasta: '2000-01-01', fecha_vto_pago: hoy }, 'fecha_servicio_hasta');
  await mal({ fecha: `${S.anio - 1}-03-10` }, 'fecha'); await mal({ fecha: new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10) }, 'fecha');
  await mal({ punto_venta: 9 }, 'punto_venta'); await mal({ punto_venta: 2 }, 'arca_pendiente');
  igual((await emitir('admin', RI, { ...factura(ids.sur, [{ articulo_id: ids.consultoria, cantidad: '1' }]), concepto: 2, fecha_servicio_desde: hoy, fecha_servicio_hasta: hoy, fecha_vto_pago: hoy })).estado, 201, 'servicio con fechas');
  const sinPv = { tercero_id: ids.sur, items: [{ articulo_id: ids.consultoria, cantidad: '1' }] }; igual((await emitir('admin', RI, sinPv)).estado, 201, 'sin indicar punto de venta se usa el único que hoy se puede usar (el electrónico se ignora)');
});
await prueba('Factura: cliente y artículos tienen que ser válidos, tener precio, y respetar los topes de los datos', async () => {
  const mal = async (cuerpo, campo) => { const r = await emitir('admin', RI, cuerpo); igual(r.estado, 422, `${campo}: ${JSON.stringify(r.cuerpo)}`); verdad(campo in r.cuerpo.error.campos, `${campo}: ${JSON.stringify(r.cuerpo.error.campos)}`); };
  await mal(factura(99999, [{ articulo_id: ids.consultoria, cantidad: '1' }]), 'tercero_id'); await mal(factura(ids.marta, [{ articulo_id: ids.consultoria, cantidad: '1' }]), 'tercero_id');   // inexistente / dado de baja
  const prov = await api('admin', 'POST', '/api/proveedores', { empresa: RI, cuerpo: { tipo_documento: 'CUIT', nro_documento: CUIT('3069876543'), razon_social: 'Solo Proveedor SA', condicion_iva_codigo: 1 } });
  await mal(factura(prov.cuerpo.id, [{ articulo_id: ids.consultoria, cantidad: '1' }]), 'tercero_id');
  await mal(factura(ids.sur, [{ articulo_id: 99999, cantidad: '1' }]), 'items[0].articulo_id'); await mal(factura(ids.sur, [{ articulo_id: ids.gasto, cantidad: '1', precio_unitario: '5' }]), 'items[0].articulo_id');
  await mal(factura(ids.sur, [{ articulo_id: ids.exento, cantidad: '1' }]), 'items[0].precio_unitario');                        // sin precio en la lista
  await mal(factura(ids.sur, [{ articulo_id: ids.consultoria, cantidad: '0' }]), 'items[0].cantidad'); await mal(factura(ids.sur, [{ articulo_id: ids.consultoria, cantidad: 'dos' }]), 'items[0].cantidad');
  await mal(factura(ids.sur, [{ articulo_id: ids.consultoria, cantidad: '1', desc_pct: '100' }]), 'items[0].desc_pct'); await mal(factura(ids.sur, []), 'items'); await mal({ ...factura(ids.sur, [{ articulo_id: ids.consultoria, cantidad: '1' }]), desc_pie_pct: '150' }, 'desc_pie_pct');
  await mal({ ...factura(ids.sur, [{ articulo_id: ids.consultoria, cantidad: '1' }]), total: '1' }, 'total');                      // no se acepta un total enviado por el cliente
  const cero = await emitir('admin', RI, factura(ids.sur, [{ articulo_id: ids.consultoria, cantidad: '1', precio_unitario: '0' }])); igual(cero.estado, 422, 'total en cero');
});
await prueba('Factura: una clave de idempotencia evita emitir dos veces ante un doble clic o un reintento', async () => {
  const cuerpo = factura(ids.sur, [{ articulo_id: ids.tel, cantidad: '2' }]), antes = (await uno('select count(*)::int c from comprobante')).c;
  const a = await emitir('admin', RI, cuerpo, { 'Idempotency-Key': 'pedido-0001-abcdef' }), b = await emitir('admin', RI, cuerpo, { 'Idempotency-Key': 'pedido-0001-abcdef' });
  igual([a.estado, b.estado, b.cuerpo.repetido], [201, 200, true], 'estados'); igual(b.cuerpo.id, a.cuerpo.id, 'es el mismo comprobante'); igual((await uno('select count(*)::int c from comprobante')).c, antes + 1, 'se emitió una sola vez');
  const otro = await emitir('admin', RI, factura(ids.sur, [{ articulo_id: ids.tel, cantidad: '3' }]), { 'Idempotency-Key': 'pedido-0001-abcdef' }); igual(otro.cuerpo.error.codigo, 'clave_reutilizada', 'misma clave con otro pedido');
  igual((await emitir('admin', RI, cuerpo, { 'Idempotency-Key': 'corta' })).estado, 422, 'clave inválida'); igual((await emitir('admin', RI, cuerpo, { 'Idempotency-Key': 'pedido-0001-abcdef' })).estado, 200, 'sigue respondiendo lo mismo');
  igual((await api('auxiliar', 'POST', '/api/ventas/facturas', { empresa: RI, cuerpo, cabeceras: { 'Idempotency-Key': 'pedido-0001-abcdef' } })).cuerpo.error.codigo, 'clave_reutilizada', 'otra persona no puede repetir esa clave');
});
await prueba('Factura: avisa (sin bloquear) cuando el cliente supera su límite de crédito, y el cálculo previo no modifica nada', async () => {
  const ch = await api('admin', 'POST', '/api/clientes', { empresa: RI, cuerpo: { tipo_documento: 'CUIT', nro_documento: CUIT('3071999888'), razon_social: 'Tecno Plata SRL', condicion_iva_codigo: 1, limite_credito: '1000' } });
  const antes = (await uno('select count(*)::int c from comprobante')).c;
  const prev = await api('admin', 'POST', '/api/ventas/facturas/calcular', { empresa: RI, cuerpo: factura(ch.cuerpo.id, [{ articulo_id: ids.consultoria, cantidad: '1' }]) }); verdad(prev.cuerpo.avisos.some((a) => /límite de crédito/.test(a)), 'aviso en el cálculo previo');
  const r = await emitir('admin', RI, factura(ch.cuerpo.id, [{ articulo_id: ids.consultoria, cantidad: '1' }])); igual(r.estado, 201, 'se emite igual'); verdad(r.cuerpo.avisos.length === 1, 'aviso al emitir'); igual((await uno('select count(*)::int c from comprobante')).c, antes + 1, 'una sola');
});
await prueba('Comprobantes: listado con filtros y paginación, lectura por número, y cada empresa ve solo los suyos', async () => {
  const todos = await api('admin', 'GET', '/api/comprobantes', { empresa: RI }); verdad(todos.cuerpo.total >= 8, 'total'); verdad(todos.cuerpo.datos[0].numero_formateado, 'con número');
  igual((await api('admin', 'GET', '/api/comprobantes?estado=anulado', { empresa: RI })).cuerpo.total, 0, 'filtro por estado'); igual((await api('admin', 'GET', `/api/comprobantes?tercero_id=${ids.cf}`, { empresa: RI })).cuerpo.total, 1, 'por cliente');
  igual((await api('admin', 'GET', `/api/comprobantes?desde=${hoy}&hasta=${hoy}&limite=2`, { empresa: RI })).cuerpo.datos.length, 2, 'por fecha y página'); igual((await api('admin', 'GET', '/api/comprobantes?estado=inventado', { empresa: RI })).estado, 422, 'estado inválido'); igual((await api('admin', 'GET', '/api/comprobantes?desde=ayer', { empresa: RI })).estado, 422, 'fecha inválida');
  const uno1 = await api('admin', 'GET', `/api/comprobantes/${ids.facturaA}`, { empresa: RI }); igual(uno1.cuerpo.items.length, 1, 'detalle'); igual((await api('admin', 'GET', `/api/comprobantes/${ids.facturaA}`, { empresa: MT })).estado, 404, 'otra empresa'); igual((await api('otro', 'GET', `/api/comprobantes/${ids.facturaA}`, { empresa: AJENA })).estado, 404, 'otro estudio');
  igual((await api('consulta', 'GET', '/api/comprobantes', { empresa: RI })).estado, 200, 'la consulta puede ver');
});
await prueba('Factura: la persona de otro estudio, aun conociendo los ids, no puede emitir contra nuestros clientes ni artículos', async () => {
  const r = await emitir('otro', AJENA, factura(ids.sur, [{ articulo_id: ids.consultoria, cantidad: '1' }])); igual(r.estado, 422, 'no existe para ella'); verdad('tercero_id' in r.cuerpo.error.campos, 'dice que el cliente no existe');
  const cuenta = (await uno('select count(*)::int c from comprobante where empresa_id = $1', [AJENA])).c; igual(cuenta, 0, 'nada se guardó en la otra empresa');
});

// ---------------------------------------------------------------------------
// 8. Higiene de la API
// ---------------------------------------------------------------------------
await prueba('Higiene: JSON inválido 400, pedido demasiado grande 413, errores sin trazas internas y con cabeceras de seguridad', async () => {
  const mal = await api('admin', 'POST', '/api/clientes', { empresa: RI, cuerpo: '{no es json' }); igual(mal.estado, 400, 'json'); verdad(!/SyntaxError|at |node:|\.mjs/.test(mal.texto), 'sin trazas');
  const grande = await iniciarServidor({ maxBytes: 500 }); try { igual((await api('admin', 'POST', '/api/clientes', { empresa: RI, cuerpo: { razon_social: 'x'.repeat(2000) }, servidor: grande })).estado, 413, 'grande'); } finally { await grande.cerrar(); }
  igual(mal.cabeceras.get('x-content-type-options'), 'nosniff', 'nosniff'); igual(mal.cabeceras.get('cache-control'), 'no-store', 'no-store'); verdad(/application\/json/.test(mal.cabeceras.get('content-type')), 'tipo');
  const arr = await api('admin', 'POST', '/api/clientes', { empresa: RI, cuerpo: '[1,2]' }); igual(arr.estado, 422, 'un arreglo no es un objeto');
});
await prueba('Higiene: solo los orígenes permitidos pueden llamar desde un navegador, y el límite de pedidos devuelve 429 con cuánto esperar', async () => {
  const ok = await api('admin', 'GET', '/api/yo', { cabeceras: { Origin: 'https://app.ejemplo.test' } }); igual(ok.cabeceras.get('access-control-allow-origin'), 'https://app.ejemplo.test', 'permitido');
  const mal = await api('admin', 'GET', '/api/yo', { cabeceras: { Origin: 'https://malo.test' } }); igual(mal.estado, 403, 'ajeno'); igual(mal.cabeceras.get('access-control-allow-origin'), null, 'sin CORS');
  const pre = await fetch(srv.base + '/api/clientes', { method: 'OPTIONS', headers: { Origin: 'https://app.ejemplo.test' } }); igual(pre.status, 204, 'preflight'); verdad(/X-Empresa-Id/.test(pre.headers.get('access-control-allow-headers')) && /Idempotency-Key/.test(pre.headers.get('access-control-allow-headers')), 'cabeceras permitidas');
  const limitado = await iniciarServidor({ limitar: crearLimitador(3, 60_000) });
  try { for (let i = 0; i < 3; i++) await api('admin', 'GET', '/api/yo', { servidor: limitado }); const r = await api('admin', 'GET', '/api/yo', { servidor: limitado }); igual(r.estado, 429, 'estado'); verdad(Number(r.cabeceras.get('retry-after')) > 0, 'Retry-After'); } finally { await limitado.cerrar(); }
  igual((await fetch(srv.base + '/api/salud')).status, 200, 'salud sin sesión');
});
await prueba('Trazabilidad: toda escritura de la API quedó registrada, con la persona y la empresa correctas, y la cadena sigue íntegra', async () => {
  const sinPersona = (await uno(`select count(*)::int n from evento where categoria in ('maestros','comprobantes') and usuario_id is null`)).n; igual(sinPersona, 0, 'todos tienen persona');
  const porEmpresa = await q(`select distinct empresa_id from evento where categoria in ('maestros','comprobantes') order by 1`); igual(porEmpresa.map((x) => x.empresa_id), [RI, MT], 'solo las empresas donde se trabajó (nada en la ajena)');
  igual((await uno(`select fn_verificar_trazabilidad($1) v`, [S.estudios.e1])).v, null, 'cadena del estudio'); igual((await uno(`select fn_verificar_trazabilidad($1) v`, [S.estudios.e2])).v, null, 'cadena del otro estudio');
  verdad((await uno(`select count(*)::int n from evento where categoria = 'comprobantes'`)).n >= 8, 'emisiones registradas');
});

await prueba('Trazabilidad: la IP registrada no es la que la persona escribe en un encabezado; con un proxy propio delante es la que anotó ese proxy', async () => {
  const ultimaIp = async () => (await uno(`select host(ip) ip from evento where categoria = 'maestros' order by id desc limit 1`)).ip;
  const nuevo = (n) => ({ tipo_documento: 'DNI', nro_documento: String(30000000 + n), razon_social: `Persona IP ${n}`, condicion_iva_codigo: 5 });
  await api('admin', 'POST', '/api/clientes', { empresa: RI, cuerpo: nuevo(1), cabeceras: { 'X-Forwarded-For': '6.6.6.6' } });
  verdad(['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(await ultimaIp()), `sin proxy de confianza se usa la conexión, no el encabezado (quedó ${await ultimaIp()})`);
  const trasProxy = await iniciarServidor({ saltosDeProxy: 1 });
  try { await api('admin', 'POST', '/api/clientes', { empresa: RI, cuerpo: nuevo(2), cabeceras: { 'X-Forwarded-For': '6.6.6.6, 203.0.113.9' }, servidor: trasProxy }); } finally { await trasProxy.cerrar(); }
  igual(await ultimaIp(), '203.0.113.9', 'con un proxy propio se toma lo que anotó ese proxy y no lo que mandó la persona');
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
