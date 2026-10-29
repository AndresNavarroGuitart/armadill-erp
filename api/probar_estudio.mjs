// Pruebas de la administración del estudio: personas, accesos, roles y empresas, y el alta de un estudio nuevo.
// Corren contra la base real del modelo; con --pg pasan por el adaptador de producción (pg + migrador) contra PGlite por socket.
// Uso:  node api/probar_estudio.mjs [--pg]
import http from 'node:http';
import { crearBase } from '../modelo/cargar.mjs';
import { sembrarDemo } from './semilla.mjs';
import { crearBd } from './bd.mjs';
import { crearBdPg } from './bd_pg.mjs';
import { crearEntornoPg } from './entorno_pg_prueba.mjs';
import { crearAutenticador, firmarJwtHS256 } from './auth.mjs';
import { crearApi } from './app.mjs';
import { crearLimitador } from '../asistente/http.mjs';
import { cuitConDigito } from './cuit.mjs';
import { altaEstudio, validarAltaEstudio } from './alta_estudio.mjs';

let correctas = 0, fallas = 0;
async function prueba(nombre, fn) {
  try { await fn(); correctas += 1; console.log(`ok     ${nombre}`); }
  catch (error) { fallas += 1; console.log(`FALLA  ${nombre}\n         ${String(error.message).split('\n').slice(0, 4).join('\n         ')}`); }
}
const igual = (a, b, que = 'valor') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${que}: esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`); };
const verdad = (c, que) => { if (!c) throw new Error(que); };

/* ---------- entorno ---------- */
const SECRETO = 'secreto-de-prueba-de-32-caracteres-minimo!!', EMISOR = 'https://demo.supabase.test/auth/v1';
const MODO_PG = process.argv.includes('--pg');
let db, bd, cerrarBase = async () => {};
if (MODO_PG) { const e = await crearEntornoPg(); db = e.pool; bd = crearBdPg(e.pool); cerrarBase = e.cerrar; } else { db = (await crearBase()).db; bd = crearBd(db); }
const S = await sembrarDemo(db);
const autenticar = crearAutenticador({ bd, secreto: SECRETO, emisor: EMISOR });
const q = async (sql, p = []) => (await db.query(sql, p)).rows, uno = async (sql, p = []) => (await q(sql, p))[0];
const srv = await new Promise((ok) => { const s = http.createServer(crearApi({ bd, autenticar, origenesPermitidos: [], limitar: crearLimitador(100000) })); s.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${s.address().port}`, cerrar: () => new Promise((r) => s.close(r)) })); });
const token = (sub, extra = {}) => firmarJwtHS256({ sub, aud: 'authenticated', iss: EMISOR, exp: Math.floor(Date.now() / 1000) + 3600, ...extra }, SECRETO);
const SESION = { admin: token('sub-admin'), consulta: token('sub-consulta'), otro: token('sub-otro'), auxiliar: token('sub-auxiliar', { email: 'auxiliar@estudio.test', email_verified: true }) };
async function api(quien, metodo, ruta, { cuerpo, empresa } = {}) {
  const t = SESION[quien] ?? quien;
  const r = await fetch(srv.base + ruta, { method: metodo, headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(empresa ? { 'X-Empresa-Id': String(empresa) } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const texto = await r.text(); let json = null; try { json = texto ? JSON.parse(texto) : null; } catch (e) { /* no JSON */ }
  return { estado: r.status, cuerpo: json };
}
const RI = S.empresas.ri.id, MT = S.empresas.mt.id, AJENA = S.empresas.ajena.id, ADMIN = S.usuarios.admin.id;
const rolId = async (nombre, estudio = S.estudios.e1) => (await uno('select id from rol where estudio_id = $1 and nombre = $2', [estudio, nombre])).id;
const ultimoEvento = async (patron) => uno(`select usuario_id, empresa_id, categoria, accion, cambios from evento where accion like $1 order by id desc limit 1`, [patron]);
const ids = {};

// ---------------------------------------------------------------------------
await prueba('Acceso: solo los administradores del estudio entran a /api/estudio; no hace falta empresa activa', async () => {
  for (const r of ['/api/estudio', '/api/estudio/personas', '/api/estudio/empresas', '/api/estudio/roles', '/api/estudio/permisos']) {
    igual((await api('admin', 'GET', r)).estado, 200, `admin ${r}`);
    igual((await api('admin', 'GET', r, { empresa: RI })).estado, 200, `admin con empresa ${r}`);
    const a = await api('consulta', 'GET', r, { empresa: RI }); igual([a.estado, a.cuerpo.error.codigo], [403, 'sin_permiso'], `consulta ${r}`);
    igual((await api('auxiliar', 'GET', r, { empresa: RI })).estado, 403, `auxiliar ${r}`);
    igual((await api(null, 'GET', r)).estado, 401, `sin sesión ${r}`);
  }
  igual((await api('consulta', 'POST', '/api/estudio/personas', { cuerpo: { email: 'a@b.com', nombre: 'Ana' } })).estado, 403, 'una persona sin marca no puede crear personas');
  igual([(await api('admin', 'GET', '/api/yo')).cuerpo.admin_estudio, (await api('consulta', 'GET', '/api/yo')).cuerpo.admin_estudio], [true, false], '/api/yo informa la marca');
});

await prueba('Estudio: se leen sus datos y conteos, se modifica con rastro, y cada estudio ve solo el suyo', async () => {
  const e = (await api('admin', 'GET', '/api/estudio')).cuerpo; igual([e.id, e.nombre], [S.estudios.e1, 'Estudio Contable Demo'], 'datos'); verdad(e.personas === 3 && e.empresas === 2, `conteos: ${JSON.stringify(e)}`);
  igual((await api('otro', 'GET', '/api/estudio')).cuerpo.nombre, 'Otro Estudio', 'el otro estudio ve el suyo');
  const m = await api('admin', 'PATCH', '/api/estudio', { cuerpo: { nombre: 'Estudio Contable Andina', cuit: cuitConDigito('3070000001') } }); igual(m.estado, 200, JSON.stringify(m.cuerpo)); igual(m.cuerpo.nombre, 'Estudio Contable Andina', 'nombre');
  const ev = await ultimoEvento('Modificó los datos del estudio'); igual([ev.categoria, ev.usuario_id, ev.empresa_id], ['maestros', ADMIN, null], 'evento sin empresa'); igual(ev.cambios.map((x) => x.campo).sort(), ['cuit', 'nombre'], 'cambios');
  igual((await api('admin', 'PATCH', '/api/estudio', { cuerpo: { cuit: '30000000000' } })).cuerpo.error.campos.cuit.slice(0, 15), 'el CUIT no es v', 'CUIT inválido');
  igual((await api('admin', 'PATCH', '/api/estudio', { cuerpo: {} })).estado, 422, 'sin cambios'); igual((await api('admin', 'PATCH', '/api/estudio', { cuerpo: { id: 5 } })).estado, 422, 'campos no editables');
  igual((await uno('select nombre from estudio where id = $1', [S.estudios.e2])).nombre, 'Otro Estudio', 'el otro estudio no cambió');
});

// ---------------------------------------------------------------------------
await prueba('Personas: alta con accesos, email normalizado, y validaciones campo por campo', async () => {
  const aux = await rolId('Auxiliar'), con = await rolId('Consulta');
  const r = await api('admin', 'POST', '/api/estudio/personas', { cuerpo: { email: '  Lucia.Gomez@Estudio.TEST ', nombre: 'Lucía Gómez', accesos: [{ empresa_id: RI, rol_id: aux }, { empresa_id: MT, rol_id: con }] } });
  igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.lucia = r.cuerpo.id; igual([r.cuerpo.email, r.cuerpo.activo, r.cuerpo.admin_estudio, r.cuerpo.vinculada], ['lucia.gomez@estudio.test', true, false, false], 'datos');
  igual(r.cuerpo.accesos.map((a) => [a.empresa, a.rol]), [['Comercial Andina SA', 'Auxiliar'], ['Panadería La Espiga', 'Consulta']], 'accesos');
  const ev = await ultimoEvento('Dio de alta a la persona%'); igual([ev.categoria, ev.usuario_id], ['seguridad', ADMIN], 'evento');
  const mal = async (cuerpo, campo) => { const x = await api('admin', 'POST', '/api/estudio/personas', { cuerpo }); igual(x.estado, 422, `${campo}: ${JSON.stringify(x.cuerpo)}`); verdad(campo in x.cuerpo.error.campos, `${campo} en ${JSON.stringify(x.cuerpo.error.campos)}`); };
  await mal({ email: 'no-es-email', nombre: 'Ana' }, 'email'); await mal({ email: 'ana@x.com', nombre: 'A' }, 'nombre'); await mal({ email: 'ana@x.com' }, 'nombre'); await mal({ email: 'ana@x.com', nombre: 'Ana', rol: 'x' }, 'rol');
  await mal({ email: 'ana@x.com', nombre: 'Ana', accesos: [{ empresa_id: 99999, rol_id: aux }] }, 'accesos[0].empresa_id'); await mal({ email: 'ana@x.com', nombre: 'Ana', accesos: [{ empresa_id: RI, rol_id: 99999 }] }, 'accesos[0].rol_id');
  await mal({ email: 'ana@x.com', nombre: 'Ana', accesos: [{ empresa_id: RI, rol_id: aux }, { empresa_id: RI, rol_id: con }] }, 'accesos[1].empresa_id');
  await mal({ email: 'ana@x.com', nombre: 'Ana', accesos: [{ empresa_id: AJENA, rol_id: aux }] }, 'accesos[0].empresa_id');                              // empresa de otro estudio
  await mal({ email: 'ana@x.com', nombre: 'Ana', accesos: [{ empresa_id: RI, rol_id: await rolId('Auxiliar', S.estudios.e2) }] }, 'accesos[0].rol_id');   // rol de otro estudio
  igual((await api('admin', 'POST', '/api/estudio/personas', { cuerpo: { email: 'LUCIA.gomez@estudio.test', nombre: 'Otra Lucía' } })).estado, 409, 'email repetido (sin importar mayúsculas)');
  igual((await api('admin', 'POST', '/api/estudio/personas', { cuerpo: { email: 'otro@otro.test', nombre: 'Intento' } })).estado, 409, 'el email de OTRO estudio tampoco se puede usar');
  igual((await uno('select count(*)::int n from usuario where nombre in ($1, $2)', ['Otra Lucía', 'Intento'])).n, 0, 'los rechazados no dejaron nada');
});
await prueba('Personas: listado con búsqueda y filtro, lectura y aislamiento entre estudios', async () => {
  const todas = await api('admin', 'GET', '/api/estudio/personas'); verdad(todas.cuerpo.datos.length >= 5, 'lista'); verdad(todas.cuerpo.datos.every((p) => p.email !== 'otro@otro.test'), 'no aparece gente de otro estudio');
  igual((await api('admin', 'GET', '/api/estudio/personas?q=lucía')).cuerpo.datos.map((p) => p.id), [ids.lucia], 'búsqueda por nombre');
  igual((await api('admin', 'GET', '/api/estudio/personas?q=%25')).cuerpo.datos.length, 0, 'el % no es comodín');
  igual((await api('admin', 'GET', '/api/estudio/personas?activo=false')).cuerpo.datos.map((p) => p.email), ['baja@estudio.test'], 'dadas de baja');
  igual((await api('admin', 'GET', `/api/estudio/personas/${ids.lucia}`)).cuerpo.accesos.length, 2, 'lectura');
  igual((await api('otro', 'GET', `/api/estudio/personas/${ids.lucia}`)).estado, 404, 'otro estudio: 404'); igual((await api('otro', 'PATCH', `/api/estudio/personas/${ids.lucia}`, { cuerpo: { activo: false } })).estado, 404, 'otro estudio no modifica');
  igual((await api('otro', 'PUT', `/api/estudio/personas/${ids.lucia}/accesos`, { cuerpo: { accesos: [] } })).estado, 404, 'otro estudio no cambia accesos');
  igual((await api('admin', 'GET', '/api/estudio/personas/abc')).estado, 404, 'id inválido');
});
await prueba('Personas: modificar deja rastro; no se cambia el email de quien ya ingresó; nadie se da de baja a sí misma', async () => {
  const m = await api('admin', 'PATCH', `/api/estudio/personas/${ids.lucia}`, { cuerpo: { nombre: 'Lucía Gómez Paz', email: 'lucia.paz@estudio.test' } }); igual(m.estado, 200, JSON.stringify(m.cuerpo)); igual([m.cuerpo.nombre, m.cuerpo.email], ['Lucía Gómez Paz', 'lucia.paz@estudio.test'], 'cambió (todavía no ingresó)');
  igual((await ultimoEvento('Modificó a la persona%')).cambios.map((x) => x.campo).sort(), ['email', 'nombre'], 'rastro');
  const antes = (await uno(`select count(*)::int n from evento where categoria = 'seguridad'`)).n; await api('admin', 'PATCH', `/api/estudio/personas/${ids.lucia}`, { cuerpo: { nombre: 'Lucía Gómez Paz' } }); igual((await uno(`select count(*)::int n from evento where categoria = 'seguridad'`)).n, antes, 'sin cambios reales no hay evento');
  const yaIngreso = await api('admin', 'PATCH', `/api/estudio/personas/${S.usuarios.consulta.id}`, { cuerpo: { email: 'otra@casilla.test' } }); igual(yaIngreso.estado, 422, 'ya ingresó'); verdad('email' in yaIngreso.cuerpo.error.campos, 'campo email');
  const propio = await api('admin', 'PATCH', `/api/estudio/personas/${ADMIN}`, { cuerpo: { activo: false } }); igual(propio.estado, 422, 'no se da de baja a sí misma'); verdad('activo' in propio.cuerpo.error.campos, 'campo activo');
  igual((await api('admin', 'PATCH', `/api/estudio/personas/${ids.lucia}`, { cuerpo: { email: 'admin@estudio.test' } })).estado, 409, 'email en uso'); igual((await api('admin', 'PATCH', `/api/estudio/personas/${ids.lucia}`, { cuerpo: { auth_sub: 'x' } })).estado, 422, 'el vínculo con el proveedor de identidad no se toca por la API');
  igual((await api('admin', 'PATCH', `/api/estudio/personas/${ids.lucia}`, { cuerpo: {} })).estado, 422, 'sin cambios');
});
await prueba('Baja de una persona: pierde el acceso en el acto (con su token vigente) y se puede reactivar', async () => {
  const sub = token('sub-lucia', { email: 'lucia.paz@estudio.test', email_verified: true });
  igual((await api(sub, 'GET', '/api/yo', { empresa: RI })).estado, 200, 'ingresa y queda vinculada'); igual((await api('admin', 'GET', `/api/estudio/personas/${ids.lucia}`)).cuerpo.vinculada, true, 'vinculada');
  igual((await api('admin', 'PATCH', `/api/estudio/personas/${ids.lucia}`, { cuerpo: { activo: false } })).estado, 200, 'baja');
  igual((await api(sub, 'GET', '/api/yo')).estado, 403, 'con el mismo token ya no entra'); igual((await api('admin', 'GET', '/api/estudio/personas?activo=true')).cuerpo.datos.some((p) => p.id === ids.lucia), false, 'sale de las activas');
  igual((await api('admin', 'PATCH', `/api/estudio/personas/${ids.lucia}`, { cuerpo: { activo: true } })).estado, 200, 'reactivación'); igual((await api(sub, 'GET', '/api/yo')).estado, 200, 'vuelve a entrar');
});

// ---------------------------------------------------------------------------
await prueba('Administradores: el estudio nunca se queda sin uno (lo impone la base), y se puede traspasar la marca', async () => {
  const quitar = await api('otro', 'PATCH', `/api/estudio/personas/${S.usuarios.otro.id}`, { cuerpo: { admin_estudio: false } });
  igual([quitar.estado, quitar.cuerpo.error.codigo], [422, 'regla_de_negocio'], 'quitarse la marca siendo la única'); verdad(/al menos un administrador/.test(quitar.cuerpo.error.mensaje), quitar.cuerpo.error.mensaje);
  let msg = ''; try { await q('update usuario set activo = false where id = $1', [S.usuarios.otro.id]); } catch (e) { msg = e.message; } verdad(/al menos un administrador/.test(msg), `ni siquiera el dueño de la base: ${msg}`);
  const nueva = await api('otro', 'POST', '/api/estudio/personas', { cuerpo: { email: 'segunda@otro.test', nombre: 'Segunda Admin', admin_estudio: true } }); igual(nueva.estado, 201, JSON.stringify(nueva.cuerpo));
  igual((await api('otro', 'PATCH', `/api/estudio/personas/${S.usuarios.otro.id}`, { cuerpo: { admin_estudio: false } })).estado, 200, 'con otra administradora sí puede dejar la marca');
  igual((await api('otro', 'GET', '/api/estudio')).estado, 403, 'y ya no administra'); igual((await api(token('sub-segunda', { email: 'segunda@otro.test', email_verified: true }), 'GET', '/api/estudio')).estado, 200, 'la nueva sí');
  const baja = await api(token('sub-segunda'), 'PATCH', `/api/estudio/personas/${nueva.cuerpo.id}`, { cuerpo: { activo: false } }); igual(baja.estado, 422, 'no se da de baja a sí misma');
  igual((await api(token('sub-segunda'), 'PATCH', `/api/estudio/personas/${S.usuarios.otro.id}`, { cuerpo: { admin_estudio: true } })).estado, 200, 'se le devuelve la marca para seguir con las pruebas');
});

// ---------------------------------------------------------------------------
await prueba('Accesos: se reemplazan con detalle (agregó, cambió, quitó) y se aplican en el acto con los permisos del rol', async () => {
  const aux = await rolId('Auxiliar'), con = await rolId('Consulta'), adm = await rolId('Administrador');
  const sub = token('sub-lucia');
  igual((await api(sub, 'GET', '/api/yo', { empresa: MT })).cuerpo.empresa_activa.rol, 'Consulta', 'estado inicial');
  const r = await api('admin', 'PUT', `/api/estudio/personas/${ids.lucia}/accesos`, { cuerpo: { accesos: [{ empresa_id: RI, rol_id: adm }] } }); igual(r.estado, 200, JSON.stringify(r.cuerpo)); igual(r.cuerpo.accesos.map((a) => [a.empresa, a.rol]), [['Comercial Andina SA', 'Administrador']], 'quedó con uno');
  const ev = await ultimoEvento('Cambió los accesos de%'); igual(ev.cambios.map((x) => [x.campo, x.antes, x.despues]), [['acceso a Comercial Andina SA', 'Auxiliar', 'Administrador'], ['acceso a Panadería La Espiga', 'Consulta', null]], 'rastro con antes y después');
  igual((await api(sub, 'GET', '/api/yo', { empresa: MT })).estado, 403, 'sin acceso a la que se quitó'); const yo = await api(sub, 'GET', '/api/yo', { empresa: RI }); igual(yo.cuerpo.empresa_activa.rol, 'Administrador', 'con el rol nuevo'); verdad(yo.cuerpo.empresa_activa.permisos.includes('ventas.emitir'), 'permisos del rol');
  await api('admin', 'PUT', `/api/estudio/personas/${ids.lucia}/accesos`, { cuerpo: { accesos: [{ empresa_id: RI, rol_id: con }, { empresa_id: MT, rol_id: aux }] } });
  igual((await api(sub, 'POST', '/api/clientes', { empresa: RI, cuerpo: {} })).estado, 403, 'como Consulta no puede crear clientes');
  igual((await api('admin', 'PUT', `/api/estudio/personas/${ids.lucia}/accesos`, { cuerpo: { accesos: [] } })).cuerpo.accesos.length, 0, 'se pueden quitar todos'); igual((await api(sub, 'GET', '/api/yo')).cuerpo.empresas.length, 0, 'sin empresas');
  const antes = (await uno(`select count(*)::int n from evento where accion like 'Cambió los accesos%'`)).n; await api('admin', 'PUT', `/api/estudio/personas/${ids.lucia}/accesos`, { cuerpo: { accesos: [] } }); igual((await uno(`select count(*)::int n from evento where accion like 'Cambió los accesos%'`)).n, antes, 'repetir lo mismo no genera evento');
  igual((await api('admin', 'PUT', `/api/estudio/personas/${ids.lucia}/accesos`, { cuerpo: { accesos: [], otro: 1 } })).estado, 422, 'solo "accesos"'); igual((await api('admin', 'PUT', `/api/estudio/personas/${ids.lucia}/accesos`, { cuerpo: { accesos: 'todos' } })).estado, 422, 'lista inválida');
});

// ---------------------------------------------------------------------------
await prueba('Empresas: el alta deja una empresa lista para facturar, con acceso para quien la crea', async () => {
  const cuit = cuitConDigito('3071999000');
  const r = await api('admin', 'POST', '/api/estudio/empresas', { cuerpo: { cuit: cuit.replace(/(\d{2})(\d{8})(\d)/, '$1-$2-$3'), razon_social: 'Ferretería del Centro SRL', condicion_iva_codigo: 1, inicio_actividades: '2020-03-01', domicilio_fiscal: 'Av. Colón 1234, Córdoba' } });
  igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.ferreteria = r.cuerpo.id; igual([r.cuerpo.cuit, r.cuerpo.activa, r.cuerpo.personas], [cuit, true, 1], 'datos');
  const ev = await ultimoEvento('Dio de alta la empresa%'); igual([ev.categoria, ev.empresa_id, ev.usuario_id], ['maestros', ids.ferreteria, ADMIN], 'evento de la empresa');
  igual((await api('admin', 'GET', '/api/yo')).cuerpo.empresas.map((e) => e.razon_social), ['Comercial Andina SA', 'Ferretería del Centro SRL', 'Panadería La Espiga'], 'aparece entre las suyas');
  const e = ids.ferreteria;
  const cli = await api('admin', 'POST', '/api/clientes', { empresa: e, cuerpo: { tipo_documento: 'CUIT', nro_documento: cuitConDigito('3070811222'), razon_social: 'Cliente Nuevo SA', condicion_iva_codigo: 1 } }); igual(cli.estado, 201, JSON.stringify(cli.cuerpo));
  const art = await api('admin', 'POST', '/api/articulos', { empresa: e, cuerpo: { codigo: 'SERV-1', nombre: 'Servicio', tipo: 'servicio', alicuota_venta: '21', lista_id: (await api('admin', 'GET', '/api/listas-precio', { empresa: e })).cuerpo.datos[0].id, precio_neto: '1000' } }); igual(art.estado, 201, JSON.stringify(art.cuerpo));
  const f = await api('admin', 'POST', '/api/ventas/facturas', { empresa: e, cuerpo: { tercero_id: cli.cuerpo.id, items: [{ articulo_id: art.cuerpo.id, cantidad: '3' }] } }); igual(f.estado, 201, JSON.stringify(f.cuerpo));
  igual([f.cuerpo.letra, f.cuerpo.numero_formateado, f.cuerpo.imp_total, f.cuerpo.asiento.estado], ['A', '0001-00000001', '3630.00', 'contabilizado'], 'factura A con asiento desde el primer minuto');
});
await prueba('Empresas: validaciones (CUIT, condición, repetido), sin acceso propio, edición con rastro, baja y reactivación', async () => {
  const mal = async (cuerpo, campo) => { const x = await api('admin', 'POST', '/api/estudio/empresas', { cuerpo: { cuit: cuitConDigito('3071999111'), razon_social: 'Otra SA', condicion_iva_codigo: 1, ...cuerpo } }); igual(x.estado, 422, `${campo}: ${JSON.stringify(x.cuerpo)}`); verdad(campo in x.cuerpo.error.campos, `${campo} en ${JSON.stringify(x.cuerpo.error.campos)}`); };
  await mal({ cuit: '30000000000' }, 'cuit'); await mal({ condicion_iva_codigo: 77 }, 'condicion_iva_codigo'); await mal({ razon_social: 'AB' }, 'razon_social'); await mal({ inicio_actividades: '31/12/2020' }, 'inicio_actividades'); await mal({ estudio_id: 2 }, 'estudio_id');
  const dup = await api('admin', 'POST', '/api/estudio/empresas', { cuerpo: { cuit: S.empresas.ri.cuit, razon_social: 'Repetida SA', condicion_iva_codigo: 1 } }); igual(dup.estado, 409, 'CUIT repetido en el estudio');
  const sin = await api('admin', 'POST', '/api/estudio/empresas', { cuerpo: { cuit: cuitConDigito('3071999222'), razon_social: 'Sin acceso propio SA', condicion_iva_codigo: 6, dar_acceso: false } }); igual(sin.estado, 201, JSON.stringify(sin.cuerpo)); ids.sinAcceso = sin.cuerpo.id; igual(sin.cuerpo.personas, 0, 'nadie tiene acceso');
  igual((await api('admin', 'GET', '/api/yo')).cuerpo.empresas.some((e) => e.id === ids.sinAcceso), false, 'no aparece en /api/yo hasta darse acceso'); igual((await api('admin', 'GET', `/api/estudio/empresas/${ids.sinAcceso}`)).estado, 200, 'pero el administrador la ve en la administración');
  igual((await api('otro', 'POST', '/api/estudio/empresas', { cuerpo: { cuit: S.empresas.ri.cuit, razon_social: 'Mismo CUIT en otro estudio', condicion_iva_codigo: 1 } })).estado, 201, 'el mismo CUIT puede existir en otro estudio');
  const m = await api('admin', 'PATCH', `/api/estudio/empresas/${ids.ferreteria}`, { cuerpo: { razon_social: 'Ferretería del Centro SA', nro_iibb: '901-123456-7', condicion_iva_codigo: 1 } }); igual(m.estado, 200, JSON.stringify(m.cuerpo)); igual(m.cuerpo.razon_social, 'Ferretería del Centro SA', 'cambió');
  igual((await ultimoEvento('Modificó la empresa%')).cambios.map((x) => x.campo).sort(), ['nro_iibb', 'razon_social'], 'rastro (solo lo que cambió)');
  igual((await api('admin', 'PATCH', `/api/estudio/empresas/${ids.ferreteria}`, { cuerpo: { cuit: cuitConDigito('3071999333') } })).estado, 422, 'el CUIT no se modifica'); igual((await api('admin', 'PATCH', `/api/estudio/empresas/${ids.ferreteria}`, { cuerpo: { condicion_iva_codigo: 99 } })).estado, 422, 'condición inexistente');
  igual((await api('otro', 'PATCH', `/api/estudio/empresas/${ids.ferreteria}`, { cuerpo: { razon_social: 'Robada' } })).estado, 404, 'otro estudio no la toca'); igual((await api('otro', 'GET', `/api/estudio/empresas/${ids.ferreteria}`)).estado, 404, 'ni la ve');
  igual((await api('admin', 'PATCH', `/api/estudio/empresas/${ids.ferreteria}`, { cuerpo: { activa: false } })).cuerpo.activa, false, 'baja'); verdad((await ultimoEvento('Dio de baja la empresa%')), 'evento de baja');
  igual((await api('admin', 'GET', '/api/yo', { empresa: ids.ferreteria })).estado, 403, 'no se puede abrir una empresa dada de baja'); igual((await api('admin', 'GET', '/api/estudio/empresas?activa=false')).cuerpo.datos.map((e) => e.id), [ids.ferreteria], 'figura entre las dadas de baja');
  igual((await api('admin', 'PUT', `/api/estudio/personas/${S.usuarios.auxiliar.id}/accesos`, { cuerpo: { accesos: [{ empresa_id: ids.ferreteria, rol_id: await rolId('Auxiliar') }] } })).cuerpo.error.campos['accesos[0].empresa_id'], 'la empresa está dada de baja', 'no se da acceso a una empresa dada de baja');
  igual((await api('admin', 'PATCH', `/api/estudio/empresas/${ids.ferreteria}`, { cuerpo: { activa: true } })).cuerpo.activa, true, 'reactivación'); igual((await api('admin', 'GET', '/api/yo', { empresa: ids.ferreteria })).estado, 200, 'vuelve a abrirse');
});

// ---------------------------------------------------------------------------
await prueba('Roles: los de base, alta de uno propio con permisos, edición, y el rol Administrador no se toca', async () => {
  const l = (await api('admin', 'GET', '/api/estudio/roles')).cuerpo.datos; igual(l.map((r) => r.nombre), ['Administrador', 'Auxiliar', 'Consulta', 'Contador'], 'roles de base'); igual(l.find((r) => r.nombre === 'Administrador').sistema, true, 'de sistema');
  const permisos = (await api('admin', 'GET', '/api/estudio/permisos')).cuerpo.datos; verdad(permisos.some((p) => p.clave === 'ventas.emitir'), 'catálogo'); igual(l.find((r) => r.nombre === 'Administrador').permisos.length, permisos.length, 'el Administrador tiene todos');
  const nuevo = await api('admin', 'POST', '/api/estudio/roles', { cuerpo: { nombre: 'Facturación', permisos: ['clientes.ver', 'articulos.ver', 'ventas.ver', 'ventas.emitir'] } }); igual(nuevo.estado, 201, JSON.stringify(nuevo.cuerpo)); ids.rolFact = nuevo.cuerpo.id; igual(nuevo.cuerpo.permisos.length, 4, 'permisos');
  igual((await api('admin', 'POST', '/api/estudio/roles', { cuerpo: { nombre: 'facturación', permisos: [] } })).estado, 409, 'nombre repetido'); igual((await api('admin', 'POST', '/api/estudio/roles', { cuerpo: { nombre: 'Malo', permisos: ['inventado.todo'] } })).cuerpo.error.campos['permisos[0]'], 'el permiso "inventado.todo" no existe', 'permiso inexistente'); igual((await api('admin', 'POST', '/api/estudio/roles', { cuerpo: { nombre: 'Doble', permisos: ['ventas.ver', 'ventas.ver'] } })).estado, 422, 'repetidos');
  const e = await api('admin', 'PUT', `/api/estudio/roles/${ids.rolFact}/permisos`, { cuerpo: { permisos: ['clientes.ver', 'ventas.ver'] } }); igual(e.estado, 200, JSON.stringify(e.cuerpo)); igual(e.cuerpo.permisos, ['clientes.ver', 'ventas.ver'], 'quedaron dos');
  igual((await ultimoEvento('Cambió los permisos del rol%')).cambios.map((x) => [x.campo, x.antes, x.despues]), [['permiso articulos.ver', 'si', null], ['permiso ventas.emitir', 'si', null]], 'rastro de lo quitado');
  const r = await api('admin', 'PUT', `/api/estudio/roles/${l.find((x) => x.nombre === 'Administrador').id}/permisos`, { cuerpo: { permisos: [] } }); igual([r.estado, r.cuerpo.error.codigo], [422, 'rol_de_sistema'], 'Administrador');
  igual((await api('otro', 'PUT', `/api/estudio/roles/${ids.rolFact}/permisos`, { cuerpo: { permisos: [] } })).estado, 404, 'otro estudio no toca roles ajenos'); igual((await api('otro', 'GET', '/api/estudio/roles')).cuerpo.datos.some((x) => x.nombre === 'Facturación'), false, 'ni los ve');
  await api('admin', 'PUT', `/api/estudio/personas/${ids.lucia}/accesos`, { cuerpo: { accesos: [{ empresa_id: RI, rol_id: ids.rolFact }] } });
  igual((await api(token('sub-lucia'), 'GET', '/api/yo', { empresa: RI })).cuerpo.empresa_activa.permisos, ['clientes.ver', 'ventas.ver'], 'la persona tiene exactamente los permisos del rol');
});

// ---------------------------------------------------------------------------
await prueba('Base de datos: reglas que no dependen de la API (vínculos de otro estudio, email, RLS de permisos, funciones cerradas)', async () => {
  const mensaje = async (f) => { try { await f(); return ''; } catch (e) { return e.message; } };
  const rolAjeno = await rolId('Auxiliar', S.estudios.e2);
  verdad(/mismo estudio/.test(await mensaje(() => q('insert into usuario_empresa (usuario_id, empresa_id, rol_id) values ($1, $2, $3)', [S.usuarios.consulta.id, MT, rolAjeno]))), 'rol de otro estudio');
  const rolMio = await rolId('Auxiliar');
  verdad(/mismo estudio/.test(await mensaje(() => q('insert into usuario_empresa (usuario_id, empresa_id, rol_id) values ($1, $2, $3)', [S.usuarios.otro.id, MT, rolMio]))), 'persona de otro estudio');
  await q(`insert into usuario (estudio_id, email, nombre) values ($1, '  MAYUS@Estudio.TEST ', 'Prueba email')`, [S.estudios.e1]); igual((await uno(`select email from usuario where nombre = 'Prueba email'`)).email, 'mayus@estudio.test', 'email normalizado por la base');
  const ctx1 = { estudioId: S.estudios.e1, empresaId: null, usuarioId: ADMIN }, ctx2 = { estudioId: S.estudios.e2, empresaId: null, usuarioId: S.usuarios.otro.id };
  const roles1 = (await q('select id from rol where estudio_id = $1', [S.estudios.e1])).map((r) => r.id);
  igual((await bd.conContexto(ctx2, (c) => c.uno('select count(*)::int n from rol_permiso where rol_id = any($1::bigint[])', [roles1]))).n, 0, 'otro estudio no ve los permisos de mis roles');
  igual((await bd.conContexto(ctx1, (c) => c.uno('select count(*)::int n from rol_permiso where rol_id = any($1::bigint[])', [roles1]))).n > 0, true, 'yo sí');
  verdad(/permission denied|row-level security/i.test(await mensaje(() => bd.conContexto(ctx2, (c) => c.consultar('delete from rol_permiso where rol_id = any($1::bigint[])', [roles1]).then((r) => { if (!r.length) throw new Error('permission denied: no borró nada (RLS)'); })))), 'otro estudio no borra permisos ajenos');
  igual((await uno('select count(*)::int n from rol_permiso where rol_id = any($1::bigint[])', [roles1])).n > 0, true, 'los permisos siguen');
  verdad(/permission denied/i.test(await mensaje(() => bd.conContexto(ctx1, (c) => c.consultar(`insert into permiso (clave, modulo, descripcion) values ('x.y', 'x', 'inventado')`)))), 'la app no inventa permisos');
  verdad(/permission denied/i.test(await mensaje(() => bd.conContexto(ctx1, (c) => c.consultar(`select fn_alta_estudio('X', null, 'x@y.com', 'X Y')`)))), 'la app no da de alta estudios');
  verdad(/permission denied/i.test(await mensaje(() => bd.conContexto(ctx1, (c) => c.consultar('select fn_provisionar_empresa($1, 2026)', [MT])))), 'la app no provisiona por su cuenta');
  const aux = { estudioId: S.estudios.e1, empresaId: RI, usuarioId: S.usuarios.auxiliar.id };
  verdad(/administrador del estudio/.test(await mensaje(() => bd.conContexto(aux, (c) => c.consultar(`select fn_alta_empresa($1, 'Intrusa SA', 1::smallint, null, null, null, 2026, false)`, [cuitConDigito('3071999444')])))), 'quien no administra no da de alta empresas, ni llamando a la función directo');
  verdad(/administrador del estudio/.test(await mensaje(() => bd.conContexto({ estudioId: S.estudios.e1, empresaId: null, usuarioId: S.usuarios.otro.id }, (c) => c.consultar(`select fn_alta_empresa($1, 'Cruzada SA', 1::smallint, null, null, null, 2026, false)`, [cuitConDigito('3071999555')])))), 'ni una persona de otro estudio usando el contexto de este');
});

// ---------------------------------------------------------------------------
await prueba('Alta de un estudio nuevo (operación de la plataforma): roles, administradora, trazabilidad, y primer ingreso hasta facturar', async () => {
  igual(validarAltaEstudio({ nombre: ' Estudio Rivas ', cuit: cuitConDigito('3070000002').replace(/(\d{2})(\d{8})(\d)/, '$1-$2-$3'), adminEmail: ' ANA@Rivas.com ', adminNombre: 'Ana Rivas' }).adminEmail, 'ana@rivas.com', 'datos limpios');
  let msg = ''; try { validarAltaEstudio({ nombre: 'x', adminEmail: 'malo', adminNombre: '' }); } catch (e) { msg = e.message; } verdad(/--nombre/.test(msg) && /--admin-email/.test(msg) && /--admin-nombre/.test(msg), `todos los problemas juntos: ${msg}`);
  // Con el pool de una sola conexión (PGlite por socket) no se puede retener un cliente mientras se consulta: se toma y se devuelve en cada alta.
  const alta = async (datos) => { if (!MODO_PG) return altaEstudio(db, datos); const cl = await db.connect(); try { return await altaEstudio(cl, datos); } finally { cl.release(); } };
  {
    const r = await alta({ nombre: 'Estudio Rivas', adminEmail: 'ana@rivas.com', adminNombre: 'Ana Rivas' });
    igual((await q('select nombre from rol where estudio_id = $1 order by nombre', [r.estudioId])).map((x) => x.nombre), ['Administrador', 'Auxiliar', 'Consulta', 'Contador'], 'roles de base');
    igual(await uno('select admin_estudio, activo, auth_sub from usuario where id = $1', [r.usuarioId]), { admin_estudio: true, activo: true, auth_sub: null }, 'administradora sin vincular');
    const ev = await uno(`select usuario_texto, categoria, usuario_id from evento where estudio_id = $1`, [r.estudioId]); igual([ev.categoria, ev.usuario_texto, ev.usuario_id], ['seguridad', 'Alta de la plataforma', null], 'el alta quedó en su trazabilidad');
    igual((await uno('select fn_verificar_trazabilidad($1) v', [r.estudioId])).v, null, 'cadena íntegra');
    const antes = (await uno('select count(*)::int n from estudio')).n; let dup = ''; try { await alta({ nombre: 'Estudio Duplicado', adminEmail: 'ana@rivas.com', adminNombre: 'Otra Ana' }); } catch (e) { dup = e.message; }
    verdad(/ya existe una persona con ese email/i.test(dup), `email repetido: ${dup}`); igual((await uno('select count(*)::int n from estudio')).n, antes, 'la transacción se deshizo: no quedó un estudio a medias');
    // primer ingreso: la persona entra con su email verificado y arma su estudio
    const ana = token('sub-ana', { email: 'ana@rivas.com', email_verified: true });
    const yo = await api(ana, 'GET', '/api/yo'); igual([yo.estado, yo.cuerpo.admin_estudio, yo.cuerpo.empresas.length], [200, true, 0], 'primer ingreso por email verificado');
    igual((await api(token('sub-ana-falsa', { email: 'ana@rivas.com', email_verified: false }), 'GET', '/api/yo')).estado, 403, 'otro sub con email sin verificar no entra');
    const emp = await api(ana, 'POST', '/api/estudio/empresas', { cuerpo: { cuit: cuitConDigito('2027333444'), razon_social: 'Primer Cliente de Ana', condicion_iva_codigo: 6 } }); igual(emp.estado, 201, JSON.stringify(emp.cuerpo));
    igual((await api(ana, 'GET', '/api/yo', { empresa: emp.cuerpo.id })).cuerpo.empresa_activa.rol, 'Administrador', 'ya puede trabajar en la empresa');
    igual((await api('admin', 'GET', `/api/estudio/empresas/${emp.cuerpo.id}`)).estado, 404, 'y mi estudio no la ve');
    igual((await uno('select fn_verificar_trazabilidad($1) v', [r.estudioId])).v, null, 'cadena íntegra tras operar');
  }
});

await prueba('Trazabilidad: toda la administración quedó registrada con la persona correcta y las cadenas siguen íntegras', async () => {
  igual((await uno(`select count(*)::int n from evento where categoria = 'seguridad' and usuario_id is null and usuario_texto is null`)).n, 0, 'todos tienen autor');
  for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena del estudio ${e}`);
  verdad((await uno(`select count(*)::int n from evento where categoria = 'seguridad'`)).n >= 8, 'hay eventos de seguridad');
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
