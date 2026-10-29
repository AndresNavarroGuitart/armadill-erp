// Pruebas de la trazabilidad: lectura con filtros, detalle con comprobación de la huella, exportación a CSV y verificación de la cadena
// (incluida la detección de eventos alterados y de eventos quitados del final). Con --pg pasan por el adaptador de producción.
// Uso:  node api/probar_trazabilidad.mjs [--pg]
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
await q('update usuario set auth_sub = $2 where id = $1', [S.usuarios.auxiliar.id, 'sub-auxiliar']);
const SESION = { admin: token('sub-admin'), consulta: token('sub-consulta'), otro: token('sub-otro'), auxiliar: token('sub-auxiliar') };
const pedir = (quien, metodo, ruta, { cuerpo, empresa } = {}) => { const t = SESION[quien] ?? quien; return fetch(srv.base + ruta, { method: metodo, headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(empresa ? { 'X-Empresa-Id': String(empresa) } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }); };
async function api(quien, metodo, ruta, op) { const r = await pedir(quien, metodo, ruta, op); const texto = await r.text(); let json = null; try { json = texto ? JSON.parse(texto) : null; } catch (e) { /* no JSON */ } return { estado: r.status, cuerpo: json }; }
const RI = S.empresas.ri.id, MT = S.empresas.mt.id, ADMIN = S.usuarios.admin.id;
const T = '/api/estudio/trazabilidad';
const hoyAR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const lista = async (qs = '', quien = 'admin') => (await api(quien, 'GET', `${T}${qs}`)).cuerpo;
const ids = {};

// ---------------------------------------------------------------------------
// Actividad de ejemplo para que haya qué mirar
await api('admin', 'POST', '/api/clientes', { empresa: RI, cuerpo: { tipo_documento: 'CUIT', nro_documento: cuitConDigito('3070811222'), razon_social: 'Distribuidora Sur SRL', condicion_iva_codigo: 1 } });
const cli = (await api('admin', 'POST', '/api/clientes', { empresa: MT, cuerpo: { tipo_documento: 'DNI', nro_documento: '27345118', razon_social: 'Marta Gómez', condicion_iva_codigo: 5 } })).cuerpo; ids.cliMT = cli.id;
await api('admin', 'PATCH', `/api/clientes/${cli.id}`, { empresa: MT, cuerpo: { condicion_pago_dias: 30, razon_social: 'Marta Gómez Paz' } });
await api('admin', 'POST', '/api/estudio/personas', { cuerpo: { email: 'nueva@estudio.test', nombre: 'Nueva Persona' } });
await api('auxiliar', 'POST', '/api/clientes', { empresa: RI, cuerpo: { tipo_documento: 'DNI', nro_documento: '30111222', razon_social: 'Cliente del Auxiliar', condicion_iva_codigo: 5 } });
// quien intenta entrar sin llegar a ser usuario: no hay persona en el contexto (si la hubiera, la base la pondría como autora)
await bd.conContexto({ estudioId: S.estudios.e1, empresaId: null, usuarioId: '' }, (c) => c.consultar(`select fn_registrar_evento('acceso', 'Ingreso rechazado', 'Contraseña incorrecta', 'rechazo', null, null, null, null, '203.0.113.7'::inet, 'Firefox', 'intruso@externo.test')`));
await bd.conContexto({ estudioId: S.estudios.e1, empresaId: RI, usuarioId: ADMIN }, (c) => c.consultar(`select fn_registrar_evento('comprobantes', 'La emisión falló', 'Sin conexión con ARCA', 'fallo')`));

await prueba('Acceso: solo los administradores del estudio; cada estudio ve únicamente su propia cadena', async () => {
  igual((await api('admin', 'GET', T)).estado, 200, 'admin');
  for (const quien of ['consulta', 'auxiliar']) igual((await api(quien, 'GET', T, { empresa: RI })).cuerpo.error.codigo, 'sin_permiso', quien);
  igual((await api(null, 'GET', T)).estado, 401, 'sin sesión');
  for (const [m, r] of [['GET', `${T}/1`], ['GET', `${T}/exportar`], ['POST', `${T}/verificar`]]) igual((await api('consulta', m, r, { cuerpo: m === 'POST' ? {} : undefined })).estado, 403, `consulta ${m} ${r}`);
  const mia = await lista(), ajena = await lista('', 'otro'); igual(ajena.total, 0, 'el otro estudio todavía no tiene eventos'); verdad(mia.total >= 7, `mi estudio: ${mia.total}`);
  await api('otro', 'POST', '/api/estudio/personas', { cuerpo: { email: 'x@otro.test', nombre: 'Persona Ajena' } }); const ajena2 = await lista('', 'otro');
  igual([ajena2.total, ajena2.datos[0].codigo], [1, 'TR-000001'], 'su cadena empieza de cero'); verdad(!ajena2.datos.some((e) => /Nueva Persona|Distribuidora/.test(e.accion + (e.detalle ?? ''))), 'no se mezcla con la mía');
});
await prueba('Listado: lo más nuevo primero, con código, persona, empresa y resultado; paginado y con tope', async () => {
  const r = await lista(); verdad(r.datos.every((e, i, a) => i === 0 || a[i - 1].nro > e.nro), 'orden descendente'); const e0 = r.datos[0];
  igual([typeof e0.codigo, e0.codigo, typeof e0.en, Object.keys(e0).sort()], ['string', 'TR-' + String(e0.nro).padStart(6, '0'), 'string', ['accion', 'categoria', 'codigo', 'detalle', 'empresa', 'empresa_id', 'en', 'entidad_id', 'entidad_tabla', 'id', 'nro', 'resultado', 'usuario', 'usuario_id']], 'forma');
  verdad(!('huella' in e0) && !('ip' in e0), 'el listado no trae huellas ni IP (eso es del detalle)');
  const alta = r.datos.find((e) => e.accion === 'Dio de alta el cliente Distribuidora Sur SRL'); igual([alta.usuario, alta.empresa, alta.categoria, alta.resultado], ['Andrés (administrador)', 'Comercial Andina SA', 'maestros', 'ok'], 'un evento de alta');
  const rechazo = r.datos.find((e) => e.accion === 'Ingreso rechazado'); igual([rechazo.usuario, rechazo.empresa, rechazo.resultado], ['intruso@externo.test', null, 'rechazo'], 'quien intentó entrar sin llegar a ser usuario');
  const p1 = await lista('?limite=3'), p2 = await lista('?limite=3&desplazamiento=3'); igual([p1.datos.length, p1.limite], [3, 3], 'página'); igual(p2.datos[0].nro, p1.datos[2].nro - 1, 'la siguiente continúa'); igual((await lista('?limite=5000')).limite, 100, 'tope de 100');
});
await prueba('Filtros: categoría, resultado, persona, empresa (o sin empresa), fechas en hora argentina, texto y código TR-', async () => {
  igual((await lista('?categoria=acceso')).datos.map((e) => e.accion), ['Ingreso rechazado'], 'categoría'); igual((await lista('?resultado=fallo')).datos.map((e) => e.accion), ['La emisión falló'], 'resultado');
  igual((await lista(`?usuario_id=${S.usuarios.auxiliar.id}`)).datos.map((e) => e.accion), ['Dio de alta el cliente Cliente del Auxiliar'], 'persona');
  const mt = await lista(`?empresa_id=${MT}`); verdad(mt.total >= 2 && mt.datos.every((e) => e.empresa_id === MT), 'empresa'); const sin = await lista('?empresa_id=sin'); verdad(sin.total >= 2 && sin.datos.every((e) => e.empresa_id === null), 'sin empresa (del estudio)');
  igual((await lista(`?desde=${hoyAR()}&hasta=${hoyAR()}`)).total, (await lista()).total, 'hoy incluye todo lo de hoy (día argentino)'); igual((await lista('?hasta=2000-01-01')).total, 0, 'hasta una fecha vieja'); igual((await lista('?desde=2999-01-01')).total, 0, 'desde una fecha futura');
  igual((await lista('?q=intruso')).total, 1, 'texto en la persona'); igual((await lista('?q=sin conexión')).total, 1, 'texto en el detalle'); igual((await lista('?q=Panadería')).total >= 2, true, 'texto en la empresa'); igual((await lista('?q=%25')).total, 0, 'el % no es comodín');
  const tr = await lista('?q=TR-000003'); igual([tr.total, tr.datos[0].nro], [1, 3], 'por código'); igual((await lista('?q=tr-3')).datos.map((e) => e.nro), [3], 'el código se acepta con o sin ceros'); igual((await lista('?q=TR-9999999')).total, 0, 'un código que no existe');
  igual((await lista(`?entidad_tabla=tercero&entidad_id=${ids.cliMT}`)).datos.map((e) => e.accion).sort(), ['Dio de alta el cliente Marta Gómez', 'Modificó el cliente Marta Gómez Paz'], 'todo lo hecho sobre un registro');
  const combinado = await lista(`?categoria=maestros&empresa_id=${MT}&desde=${hoyAR()}`); verdad(combinado.total >= 2 && combinado.datos.every((e) => e.categoria === 'maestros' && e.empresa_id === MT), 'combinados');
  for (const [qs, campo] of [['?categoria=inventada', 'categoria'], ['?resultado=quizas', 'resultado'], ['?usuario_id=abc', 'usuario_id'], ['?empresa_id=1;drop', 'empresa_id'], ['?desde=ayer', 'desde'], ['?hasta=2026-13-45', 'hasta'], ['?entidad_tabla=Robert;--', 'entidad_tabla'], ['?entidad_id=x', 'entidad_id']]) { const x = await api('admin', 'GET', `${T}${qs}`); igual(x.estado, 422, qs); verdad(campo in x.cuerpo.error.campos, `${campo} en ${JSON.stringify(x.cuerpo.error.campos)}`); }
});
await prueba('Detalle: el antes y el después, el origen y la huella recalculada por la base; el primer eslabón y los demás enlazan bien', async () => {
  const mod = (await lista('?q=Modificó el cliente')).datos[0]; const d = (await api('admin', 'GET', `${T}/${mod.nro}`)).cuerpo;
  igual([d.codigo, d.huella_ok, d.enlace_ok, d.huella.length, d.huella_prev.length], [mod.codigo, true, true, 64, 64], 'huellas'); igual(d.cambios.map((x) => [x.campo, x.antes, x.despues]).sort(), [['condicion_pago_dias', '0', '30'], ['razon_social', 'Marta Gómez', 'Marta Gómez Paz']], 'cambios');
  verdad(['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(d.ip) && /node|undici|fetch/i.test(d.dispositivo ?? 'node'), `origen: ${d.ip} / ${d.dispositivo}`);
  const primero = (await api('admin', 'GET', `${T}/1`)).cuerpo; igual([primero.huella_prev, primero.huella_ok, primero.enlace_ok], ['', true, true], 'el primero no tiene anterior');
  const rechazo = (await api('admin', 'GET', `${T}/${(await lista('?categoria=acceso')).datos[0].nro}`)).cuerpo; igual([rechazo.ip, rechazo.dispositivo, rechazo.usuario], ['203.0.113.7', 'Firefox', 'intruso@externo.test'], 'el evento del que intentó entrar');
  igual((await api('admin', 'GET', `${T}/99999`)).estado, 404, 'inexistente'); igual((await api('admin', 'GET', `${T}/abc`)).estado, 404, 'no numérico'); igual((await api('otro', 'GET', `${T}/${mod.nro}`)).estado === 404 || (await api('otro', 'GET', `${T}/${mod.nro}`)).cuerpo.accion !== mod.accion, true, 'el otro estudio no ve mi evento');
});

// ---------------------------------------------------------------------------
await prueba('Exportar: CSV con los mismos filtros, con BOM, acentos y escapes; las celdas que parecen fórmulas se neutralizan; queda constancia', async () => {
  const subF = token('sub-formula', { email: 'formula@estudio.test', email_verified: true });
  await api('admin', 'POST', '/api/estudio/personas', { cuerpo: { email: 'formula@estudio.test', nombre: '=SUMA(1;1)', accesos: [{ empresa_id: RI, rol_id: (await uno('select id from rol where estudio_id = $1 and nombre = $2', [S.estudios.e1, 'Auxiliar'])).id }] } });
  await api(subF, 'POST', '/api/clientes', { empresa: RI, cuerpo: { tipo_documento: 'DNI', nro_documento: '30999888', razon_social: 'Cliente con "comillas", coma y\nsalto', condicion_iva_codigo: 5 } });
  const r = await pedir('admin', 'GET', `${T}/exportar?categoria=maestros`); const bytes = Buffer.from(await r.arrayBuffer());
  igual([bytes[0], bytes[1], bytes[2]], [0xEF, 0xBB, 0xBF], 'empieza con BOM (para que Excel lea los acentos)'); const texto = bytes.toString('utf8');
  igual([r.status, r.headers.get('content-type'), /^attachment; filename="trazabilidad-\d{4}-\d{2}-\d{2}\.csv"$/.test(r.headers.get('content-disposition'))], [200, 'text/csv; charset=utf-8', true], 'cabeceras'); verdad(texto.startsWith('﻿Código,Fecha y hora,Empresa,Usuario,Categoría,Actividad'), `encabezado: ${texto.slice(0, 80)}`);
  const total = (await lista('?categoria=maestros')).total; verdad(texto.split('\r\n').length - 1 >= total, 'una fila por evento (más el encabezado)');
  verdad(texto.includes(`"'=SUMA(1;1)"`) && !/(^|,)=SUMA/.test(texto), 'la celda que empezaba con = quedó neutralizada'); verdad(texto.includes('"Dio de alta el cliente Cliente con ""comillas"", coma y\nsalto"'), 'comillas, comas y saltos escapados'); verdad(texto.includes('Marta Gómez Paz'), 'acentos');
  verdad(!texto.includes('Ingreso rechazado'), 'solo lo filtrado');
  const ev = (await lista('?q=Exportó la trazabilidad')).datos[0]; igual([ev.categoria, ev.usuario], ['seguridad', 'Andrés (administrador)'], 'constancia'); verdad(/\d+ eventos · categoria=maestros/.test(ev.detalle), ev.detalle);
  igual((await api('admin', 'GET', `${T}/exportar?categoria=mala`)).estado, 422, 'filtro inválido'); igual((await api('consulta', 'GET', `${T}/exportar`, { empresa: RI })).estado, 403, 'quien no administra no exporta');
});

// ---------------------------------------------------------------------------
await prueba('Verificar: la cadena íntegra se informa con su cabeza; la verificación deja constancia y tiene un freno', async () => {
  const r = await api('admin', 'POST', `${T}/verificar`, { cuerpo: {} }); igual(r.estado, 200, JSON.stringify(r.cuerpo)); igual([r.cuerpo.integra, r.cuerpo.primer_evento_roto, r.cuerpo.resguardo], [true, null, null], 'íntegra'); verdad(r.cuerpo.eventos >= 10 && r.cuerpo.cabeza.huella.length === 64 && /Z$/.test(r.cuerpo.cabeza.en), 'cabeza'); ids.cabeza = r.cuerpo.cabeza;
  const ev = (await lista('?q=Verificó la integridad')).datos[0]; igual([ev.categoria, ev.resultado, /íntegra/.test(ev.accion)], ['seguridad', 'ok', true], 'constancia de la verificación'); verdad(ev.nro > ids.cabeza.nro, 'la constancia es posterior a la cabeza informada');
  const mal = async (cuerpo, campo) => { const x = await api('admin', 'POST', `${T}/verificar`, { cuerpo }); igual(x.estado, 422, JSON.stringify(cuerpo)); verdad(campo in x.cuerpo.error.campos, `${campo} en ${JSON.stringify(x.cuerpo.error.campos)}`); };
  await mal({ nro: 3 }, 'huella'); await mal({ huella: 'a'.repeat(64) }, 'nro'); await mal({ nro: 3, huella: 'corta' }, 'huella'); await mal({ nro: 'x', huella: 'a'.repeat(64) }, 'nro'); await mal({ otro: 1 }, 'otro');
  for (let i = 0; i < 4; i++) await api('admin', 'POST', `${T}/verificar`, { cuerpo: {} }); const freno = await api('admin', 'POST', `${T}/verificar`, { cuerpo: {} }); igual([freno.estado, freno.cuerpo.error.codigo], [429, 'verificaciones_limitadas'], 'a la sexta en un minuto');
});
await prueba('Verificar contra la cabeza guardada por fuera: detecta tanto lo modificado como lo quitado del final', async () => {
  // Se trabaja en el otro estudio para no ensuciar la cadena de las demás pruebas. Para simular la manipulación se desactiva el disparador de solo agregar (solo posible con acceso de dueño a la base).
  for (let i = 0; i < 4; i++) await api('otro', 'POST', '/api/estudio/empresas', { cuerpo: { cuit: cuitConDigito(`3071${String(1000 + i)}00`.slice(0, 10)), razon_social: `Empresa de prueba ${i}`, condicion_iva_codigo: 1 } });
  const v0 = (await api('otro', 'POST', `${T}/verificar`, { cuerpo: {} })).cuerpo; igual(v0.integra, true, 'arranca íntegra'); const guardada = v0.cabeza;
  const ok = await api('otro', 'POST', `${T}/verificar`, { cuerpo: { nro: guardada.nro, huella: guardada.huella } }); igual([ok.cuerpo.integra, ok.cuerpo.resguardo.coincide], [true, true], 'coincide con lo guardado'); verdad(/siguió creciendo|exactamente/.test(ok.cuerpo.resguardo.motivo), ok.cuerpo.resguardo.motivo);
  const e2 = (await uno('select id, accion from evento where estudio_id = $1 and nro = 2', [S.estudios.e2]));
  await q('alter table evento disable trigger trg_evento_solo_agregar');
  try {
    await q(`update evento set accion = 'Dio de alta la empresa FALSA' where id = $1`, [e2.id]);
    const d = (await api('otro', 'GET', `${T}/2`)).cuerpo; igual([d.huella_ok, d.accion], [false, 'Dio de alta la empresa FALSA'], 'el detalle muestra que la huella ya no coincide');
    const roto = (await api('otro', 'POST', `${T}/verificar`, { cuerpo: {} })).cuerpo; igual([roto.integra, roto.primer_evento_roto], [false, 2], 'detecta el evento alterado y dice cuál');
    const ev = (await q(`select resultado from evento where estudio_id = $1 and accion like 'Verificó la integridad%CON PROBLEMAS' order by nro desc limit 1`, [S.estudios.e2]))[0]; igual(ev?.resultado, 'fallo', 'y deja constancia como fallo');
    await q('update evento set accion = $2 where id = $1', [e2.id, e2.accion]);                       // se repone: la cadena vuelve a cerrar
    await new Promise((r) => setTimeout(r, 50));
  } finally { await q('alter table evento enable trigger trg_evento_solo_agregar'); }
  // Quitar los últimos eventos NO rompe la cadena por dentro: solo se nota contra la cabeza guardada.
  await api('otro', 'POST', '/api/estudio/personas', { cuerpo: { email: 'z1@otro.test', nombre: 'Persona Z1' } }); const antes = (await api('otro', 'POST', `${T}/verificar`, { cuerpo: {} })).cuerpo.cabeza;
  await q('alter table evento disable trigger trg_evento_solo_agregar');
  try { await q('delete from evento where estudio_id = $1 and nro > $2', [S.estudios.e2, antes.nro - 2]); } finally { await q('alter table evento enable trigger trg_evento_solo_agregar'); }
  const sinResguardo = (await api('otro', 'POST', `${T}/verificar`, { cuerpo: {} })).cuerpo; igual(sinResguardo.integra, true, 'por dentro la cadena parece íntegra (por eso hace falta la cabeza guardada)');
  const conResguardo = (await api('otro', 'POST', `${T}/verificar`, { cuerpo: { nro: antes.nro, huella: antes.huella } })).cuerpo; igual([conResguardo.integra, conResguardo.resguardo.coincide], [false, false], 'contra la cabeza guardada se detecta que faltan eventos'); verdad(/faltan eventos|no coincide/.test(conResguardo.resguardo.motivo), conResguardo.resguardo.motivo);
  const futura = (await api('otro', 'POST', `${T}/verificar`, { cuerpo: { nro: 99999, huella: 'b'.repeat(64) } })).cuerpo; igual([futura.integra, futura.resguardo.coincide], [false, false], 'una cabeza guardada de un evento que ya no existe');
});
await prueba('Mi cadena sigue íntegra después de todo y los eventos de consulta no ensucian nada (leer no deja rastro; exportar y verificar sí)', async () => {
  const antes = (await lista()).total; await lista('?q=algo'); await api('admin', 'GET', `${T}/1`); igual((await lista()).total, antes, 'leer no agrega eventos');
  igual((await uno('select fn_verificar_trazabilidad($1) v', [S.estudios.e1])).v, null, 'cadena del estudio 1');
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
