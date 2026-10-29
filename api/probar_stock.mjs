// Pruebas de stock y listas de precios: depósitos, existencias, movimientos, ajustes, transferencias, listas y ajuste de precios en bloque.
// Corren contra la base real del modelo; con --pg pasan por el adaptador de producción (pg + migrador) contra PGlite por socket.
// Uso:  node api/probar_stock.mjs [--pg]
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
async function api(quien, metodo, ruta, { cuerpo, empresa = RI } = {}) {
  const t = SESION[quien] ?? quien;
  const r = await fetch(srv.base + ruta, { method: metodo, headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(empresa ? { 'X-Empresa-Id': String(empresa) } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const texto = await r.text(); let json = null; try { json = texto ? JSON.parse(texto) : null; } catch (e) { /* no JSON */ }
  return { estado: r.status, cuerpo: json };
}
var RI = S.empresas.ri.id; const MT = S.empresas.mt.id, AJENA = S.empresas.ajena.id, ADMIN = S.usuarios.admin.id;
const ids = {};
const ultimoEvento = (patron) => uno(`select usuario_id, empresa_id, categoria, accion, detalle, cambios from evento where accion like $1 order by id desc limit 1`, [patron]);
const articulo = async (codigo, nombre, extra = {}) => { const r = await api('admin', 'POST', '/api/articulos', { cuerpo: { codigo, nombre, alicuota_venta: '21', ...extra } }); if (r.estado !== 201) throw new Error(`no se pudo crear ${codigo}: ${JSON.stringify(r.cuerpo)}`); return r.cuerpo; };
const saldo = async (articuloId, depositoId) => Number((await uno('select coalesce(sum(cantidad), 0)::text s from movimiento_stock where articulo_id = $1 and deposito_id = $2', [articuloId, depositoId])).s);

// ---------------------------------------------------------------------------
await prueba('Permisos: los roles de base reciben los permisos nuevos (el Administrador todos; Auxiliar y Consulta solo ver stock)', async () => {
  const roles = (await api('admin', 'GET', '/api/estudio/roles')).cuerpo.datos, de = (n) => roles.find((r) => r.nombre === n).permisos;
  verdad(['stock.ver', 'stock.ajustar', 'listas.editar'].every((p) => de('Administrador').includes(p) && de('Contador').includes(p)), 'Administrador y Contador');
  igual([de('Auxiliar').includes('stock.ver'), de('Auxiliar').includes('stock.ajustar'), de('Auxiliar').includes('listas.editar')], [true, false, false], 'Auxiliar');
  igual([de('Consulta').includes('stock.ver'), de('Consulta').includes('stock.ajustar')], [true, false], 'Consulta');
  igual((await api('consulta', 'GET', '/api/stock')).estado, 200, 'consulta ve el stock'); igual((await api('auxiliar', 'GET', '/api/depositos')).estado, 200, 'auxiliar ve depósitos');
  for (const [m, r, c] of [['POST', '/api/stock/ajustes', {}], ['POST', '/api/stock/transferencias', {}], ['POST', '/api/depositos', { nombre: 'X' }], ['POST', '/api/listas-precio', { nombre: 'X' }]]) igual((await api('auxiliar', m, r, { cuerpo: c })).estado, 403, `auxiliar no puede ${m} ${r}`);
  igual((await api('consulta', 'DELETE', '/api/listas-precio/1')).estado, 403, 'consulta no borra listas'); igual((await api('consulta', 'POST', '/api/listas-precio/1/ajuste', { cuerpo: { porcentaje: '10' } })).estado, 403, 'consulta no ajusta precios');
});

// ---------------------------------------------------------------------------
await prueba('Listas: alta, nombres sin repetir, cambio de nombre y orden, y conteo de lo que usa cada una', async () => {
  const lista = (await api('admin', 'GET', '/api/listas-precio')).cuerpo.datos; igual(lista.map((l) => [l.nombre, l.articulos, l.clientes]), [['General', 0, 0]], 'lista inicial'); ids.general = lista[0].id;
  const m = await api('admin', 'POST', '/api/listas-precio', { cuerpo: { nombre: 'Mayorista', orden: 2 } }); igual(m.estado, 201, JSON.stringify(m.cuerpo)); ids.mayorista = m.cuerpo.id;
  igual((await api('admin', 'POST', '/api/listas-precio', { cuerpo: { nombre: 'MAYORISTA' } })).estado, 409, 'repetida');
  const mi = await api('admin', 'POST', '/api/listas-precio', { cuerpo: { nombre: 'Minorista', orden: 3 } }); ids.minorista = mi.cuerpo.id;
  const r = await api('admin', 'PATCH', `/api/listas-precio/${ids.minorista}`, { cuerpo: { nombre: 'Público', orden: 1 } }); igual([r.estado, r.cuerpo.nombre, r.cuerpo.orden], [200, 'Público', 1], JSON.stringify(r.cuerpo));
  igual((await ultimoEvento('Modificó la lista de precios%')).cambios.map((x) => x.campo).sort(), ['nombre', 'orden'], 'rastro');
  igual((await api('admin', 'PATCH', `/api/listas-precio/${ids.minorista}`, { cuerpo: { nombre: 'general' } })).estado, 409, 'no pisa a otra'); igual((await api('admin', 'PATCH', `/api/listas-precio/${ids.minorista}`, { cuerpo: {} })).estado, 422, 'sin cambios');
  igual((await api('admin', 'GET', '/api/listas-precio')).cuerpo.datos.map((l) => l.nombre), ['General', 'Público', 'Mayorista'], 'ordenadas por orden y nombre'); igual((await api('admin', 'PATCH', '/api/listas-precio/99999', { cuerpo: { nombre: 'Nada' } })).estado, 404, 'inexistente');
});
await prueba('Listas: solo se borra una que nadie usa, y la empresa conserva al menos una; cada empresa ve las suyas', async () => {
  igual((await api('admin', 'DELETE', `/api/listas-precio/${ids.minorista}`)).cuerpo, { borrada: true, nombre: 'Público' }, 'borra una sin uso'); verdad(await ultimoEvento('Borró la lista de precios%'), 'queda el rastro');
  const a = await articulo('USO-1', 'Artículo en lista', { lista_id: ids.mayorista, precio_neto: '10' });
  const enUso = await api('admin', 'DELETE', `/api/listas-precio/${ids.mayorista}`); igual([enUso.estado, enUso.cuerpo.error.codigo], [422, 'lista_en_uso'], 'con precios cargados'); verdad(/1 precios cargados/.test(enUso.cuerpo.error.mensaje), enUso.cuerpo.error.mensaje);
  igual((await api('admin', 'GET', '/api/listas-precio')).cuerpo.datos.find((l) => l.id === ids.mayorista).articulos, 1, 'cuenta artículos');
  await q('delete from articulo_precio where articulo_id = $1', [a.id]); await q('update articulo set activo = false where id = $1', [a.id]);
  const cli = await api('admin', 'POST', '/api/clientes', { cuerpo: { tipo_documento: 'CUIT', nro_documento: cuitConDigito('3070811222'), razon_social: 'Cliente Mayorista SA', condicion_iva_codigo: 1, lista_precio_id: ids.mayorista } }); igual(cli.estado, 201, JSON.stringify(cli.cuerpo)); ids.clienteMay = cli.cuerpo.id;
  igual((await api('admin', 'GET', '/api/listas-precio')).cuerpo.datos.find((l) => l.id === ids.mayorista).clientes, 1, 'cuenta clientes');
  igual((await api('admin', 'DELETE', `/api/listas-precio/${ids.mayorista}`)).cuerpo.error.codigo, 'lista_en_uso', 'con clientes asignados');
  igual((await api('admin', 'DELETE', `/api/listas-precio/${ids.general}`)).estado, 200, 'General sin uso (hay otra lista)'); const ultima = await api('admin', 'DELETE', `/api/listas-precio/${ids.mayorista}`); igual(ultima.cuerpo.error.codigo, 'lista_en_uso', 'sigue en uso'); await q('update tercero set lista_precio_id = null where id = $1', [ids.clienteMay]);
  const sola = await api('admin', 'DELETE', `/api/listas-precio/${ids.mayorista}`); igual([sola.estado, sola.cuerpo.error.codigo], [422, 'ultima_lista'], 'la última lista no se borra');
  const g = await api('admin', 'POST', '/api/listas-precio', { cuerpo: { nombre: 'General' } }); ids.general = g.cuerpo.id; igual((await api('admin', 'GET', '/api/listas-precio', { empresa: MT })).cuerpo.datos.map((l) => l.nombre), ['General'], 'la otra empresa conserva la suya');
  igual((await api('admin', 'DELETE', `/api/listas-precio/${ids.general}`, { empresa: MT })).estado, 404, 'ni se toca desde otra empresa'); igual((await api('otro', 'GET', '/api/listas-precio', { empresa: AJENA })).cuerpo.datos.length, 1, 'otro estudio ve la suya');
});

// ---------------------------------------------------------------------------
await prueba('Ajuste de precios en bloque: vista previa exacta, redondeos, bajo el costo, y no se escribe nada al simular', async () => {
  await api('admin', 'PATCH', `/api/listas-precio/${ids.general}`, { cuerpo: { orden: 1 } });
  const A = await articulo('AJ-A', 'Artículo A', { lista_id: ids.general, precio_neto: '100.00' }), B = await articulo('AJ-B', 'Artículo B', { lista_id: ids.general, precio_neto: '33.33' });
  const C = await articulo('AJ-C', 'Artículo C', { lista_id: ids.general, precio_neto: '100.00', costo: '95' }), D = await articulo('AJ-D', 'Sin precio'); const E = await articulo('AJ-E', 'Dado de baja', { lista_id: ids.general, precio_neto: '50' });
  await q('update articulo set activo = false where id = $1', [E.id]); Object.assign(ids, { A: A.id, B: B.id, C: C.id, D: D.id, E: E.id });
  const sim = (extra) => api('admin', 'POST', `/api/listas-precio/${ids.mayorista}/ajuste`, { cuerpo: { base_lista_id: ids.general, simular: true, ...extra } });
  const r = await sim({ porcentaje: '-10' }); igual(r.estado, 200, JSON.stringify(r.cuerpo));
  igual(r.cuerpo.datos.map((x) => [x.codigo, x.base, x.actual, x.nuevo, x.bajo_costo]), [['AJ-A', '100.0000', null, '90.00', false], ['AJ-B', '33.3300', null, '30.00', false], ['AJ-C', '100.0000', null, '90.00', true]], '−10 %: 33,33 × 0,9 = 29,997 → 30,00');
  igual([r.cuerpo.aplicado, r.cuerpo.total, r.cuerpo.cambian, r.cuerpo.bajo_costo, r.cuerpo.sin_precio_base], [false, 3, 3, 1, 1], 'resumen (el dado de baja no entra; el que no tiene precio se informa)');
  igual((await uno('select count(*)::int n from articulo_precio where lista_id = $1', [ids.mayorista])).n, 0, 'simular no escribe');
  igual((await sim({ porcentaje: '50' })).cuerpo.datos.map((x) => x.nuevo), ['150.00', '50.00', '150.00'], '+50 %: 33,33 × 1,5 = 49,995 → 50,00 (se redondea hacia arriba, exacto)');
  igual((await sim({ porcentaje: '-10', redondeo: 'entero' })).cuerpo.datos.map((x) => x.nuevo), ['90.00', '30.00', '90.00'], 'redondeo al entero'); igual((await sim({ porcentaje: '7.5', redondeo: 'decena' })).cuerpo.datos.map((x) => x.nuevo), ['110.00', '40.00', '110.00'], 'redondeo a la decena (107,5 → 110; 35,8 → 40)');
  igual((await sim({ porcentaje: '-10', articulo_ids: [ids.A, ids.D, ids.E] })).cuerpo.datos.map((x) => x.codigo), ['AJ-A'], 'solo los elegidos que tengan precio y estén activos');
  const mal = async (cuerpo, campo) => { const x = await api('admin', 'POST', `/api/listas-precio/${ids.mayorista}/ajuste`, { cuerpo }); igual(x.estado, 422, `${campo}: ${JSON.stringify(x.cuerpo)}`); verdad(campo in x.cuerpo.error.campos, `${campo} en ${JSON.stringify(x.cuerpo.error.campos)}`); };
  await mal({ porcentaje: '-100' }, 'porcentaje'); await mal({ porcentaje: '1001' }, 'porcentaje'); await mal({ porcentaje: 'diez' }, 'porcentaje'); await mal({ base_lista_id: ids.general }, 'porcentaje'); await mal({ porcentaje: '5', base_lista_id: 99999 }, 'base_lista_id');
  await mal({ porcentaje: '5', vigente_desde: '1900-01-01' }, 'vigente_desde'); await mal({ porcentaje: '5', redondeo: 'raro' }, 'redondeo'); await mal({ porcentaje: '5', otro: 1 }, 'otro');
  const mismaEn0 = await api('admin', 'POST', `/api/listas-precio/${ids.general}/ajuste`, { cuerpo: { porcentaje: '0' } }); igual(mismaEn0.cuerpo.error.campos.porcentaje.slice(0, 18), 'con la misma lista', 'misma lista y 0 %');
  igual((await api('admin', 'POST', '/api/listas-precio/99999/ajuste', { cuerpo: { porcentaje: '5' } })).estado, 404, 'lista inexistente'); igual((await api('admin', 'POST', `/api/listas-precio/${ids.mayorista}/ajuste`, { empresa: MT, cuerpo: { porcentaje: '5' } })).estado, 404, 'ni desde otra empresa');
});
await prueba('Ajuste de precios: se aplica con vigencia, es repetible solo si cambia algo, no toca lo emitido y lo usa la factura del cliente asignado', async () => {
  const hoy = new Date().toISOString().slice(0, 10), futuro = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  const r = await api('admin', 'POST', `/api/listas-precio/${ids.mayorista}/ajuste`, { cuerpo: { base_lista_id: ids.general, porcentaje: '-10' } }); igual([r.estado, r.cuerpo.aplicado, r.cuerpo.cambian], [200, true, 3], JSON.stringify(r.cuerpo));
  const ev = await ultimoEvento('Ajustó los precios de la lista%'); igual([ev.categoria, ev.usuario_id], ['maestros', ADMIN], 'evento'); verdad(/-10 % desde .* · 3 artículos · 1 quedaron bajo el costo/.test(ev.detalle), ev.detalle);
  const precios = (await q('select a.codigo, p.precio_neto::text pn, p.vigente_desde::text vd from articulo_precio p join articulo a on a.id = p.articulo_id where p.lista_id = $1 order by a.codigo', [ids.mayorista])); igual(precios.map((x) => [x.codigo, x.pn, x.vd]), [['AJ-A', '90.0000', hoy], ['AJ-B', '30.0000', hoy], ['AJ-C', '90.0000', hoy]], 'precios nuevos');
  const otra = await api('admin', 'POST', `/api/listas-precio/${ids.mayorista}/ajuste`, { cuerpo: { base_lista_id: ids.general, porcentaje: '-10' } }); igual([otra.estado, otra.cuerpo.error.codigo], [422, 'sin_cambios'], 'repetirlo no cambia nada');
  const sobreSi = await api('admin', 'POST', `/api/listas-precio/${ids.mayorista}/ajuste`, { cuerpo: { porcentaje: '10', vigente_desde: futuro } }); igual([sobreSi.estado, sobreSi.cuerpo.cambian], [200, 3], 'sobre sí misma, desde una fecha futura');
  const hoyPrecio = async () => (await api('admin', 'GET', `/api/articulos?q=AJ-A&lista_id=${ids.mayorista}`)).cuerpo.datos[0].precio_neto; igual(await hoyPrecio(), '90.0000', 'hoy sigue el precio actual'); igual((await api('admin', 'GET', `/api/articulos?q=AJ-A&lista_id=${ids.mayorista}&fecha=${futuro}`)).cuerpo.datos[0].precio_neto, '99.0000', 'y desde la fecha rige el nuevo');
  // un cliente con la lista Mayorista factura al precio de esa lista
  await api('admin', 'PATCH', `/api/clientes/${ids.clienteMay}`, { cuerpo: { lista_precio_id: ids.mayorista } });
  await q(`insert into movimiento_stock (empresa_id, fecha, articulo_id, deposito_id, cantidad, tipo) values ($1, current_date, $2, $3, 10, 'inventario')`, [RI, ids.A, S.empresas.ri.deposito]); ids.dep1 = S.empresas.ri.deposito;
  const f = await api('admin', 'POST', '/api/ventas/facturas', { cuerpo: { tercero_id: ids.clienteMay, items: [{ articulo_id: ids.A, cantidad: '2' }] } }); igual(f.estado, 201, JSON.stringify(f.cuerpo)); igual([f.cuerpo.items[0].precio_unitario, f.cuerpo.imp_neto], ['90.0000', '180.00'], 'factura al precio de la lista del cliente');
  igual((await api('admin', 'GET', '/api/estudio/roles')).estado, 200, 'sanidad');
});

// ---------------------------------------------------------------------------
await prueba('Depósitos: alta, nombres sin repetir, cambio de nombre, y no se da de baja uno con existencias ni el último activo', async () => {
  const l = (await api('admin', 'GET', '/api/depositos')).cuerpo.datos; igual(l.map((d) => [d.nombre, d.activo]), [['Depósito central', true]], 'el que trae la empresa');
  const n = await api('admin', 'POST', '/api/depositos', { cuerpo: { nombre: 'Sucursal Norte' } }); igual(n.estado, 201, JSON.stringify(n.cuerpo)); ids.dep2 = n.cuerpo.id;
  igual((await api('admin', 'POST', '/api/depositos', { cuerpo: { nombre: 'sucursal norte' } })).estado, 409, 'repetido'); igual((await api('admin', 'POST', '/api/depositos', { cuerpo: { nombre: 'A' } })).estado, 422, 'muy corto');
  const r = await api('admin', 'PATCH', `/api/depositos/${ids.dep2}`, { cuerpo: { nombre: 'Sucursal Norte (Córdoba)' } }); igual(r.cuerpo.nombre, 'Sucursal Norte (Córdoba)', 'renombrado'); verdad(await ultimoEvento('Modificó el depósito%'), 'rastro');
  const conStock = await api('admin', 'PATCH', `/api/depositos/${ids.dep1}`, { cuerpo: { activo: false } }); igual([conStock.estado, conStock.cuerpo.error.codigo], [422, 'regla_de_negocio'], 'con existencias'); verdad(/todavía tiene existencias/.test(conStock.cuerpo.error.mensaje), conStock.cuerpo.error.mensaje);
  await q('update movimiento_stock set cantidad = cantidad where false'); const baja = await api('admin', 'PATCH', `/api/depositos/${ids.dep2}`, { cuerpo: { activo: false } }); igual(baja.cuerpo.activo, false, 'uno vacío sí se da de baja'); verdad(await ultimoEvento('Dio de baja el depósito%'), 'rastro de la baja');
  const ultimo = await api('admin', 'PATCH', `/api/depositos/${ids.dep1}`, { cuerpo: { activo: false } }); verdad(/existencias|al menos un depósito/.test(ultimo.cuerpo.error.mensaje), 'el único activo no se da de baja');
  igual((await api('admin', 'PATCH', `/api/depositos/${ids.dep2}`, { cuerpo: { activo: true } })).cuerpo.activo, true, 'reactivación'); igual((await api('admin', 'GET', '/api/depositos', { empresa: MT })).cuerpo.datos.length, 1, 'cada empresa los suyos'); igual([(await api('admin', 'GET', '/api/ventas/depositos')).estado, (await api('consulta', 'GET', '/api/ventas/depositos')).estado], [200, 403], 'quien emite facturas ve los depósitos para elegir de cuál sale lo que vende (la consulta, no)'); igual((await api('admin', 'PATCH', `/api/depositos/${ids.dep1}`, { empresa: MT, cuerpo: { nombre: 'Robado' } })).estado, 404, 'no desde otra empresa');
});
await prueba('Ajustes de stock: ingreso, egreso y conteo físico, con el saldo antes y después, motivo obligatorio y rastro', async () => {
  const P = await articulo('ST-1', 'Pan lactal', { tipo: 'bien' }); ids.P = P.id;
  const aj = (c) => api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: ids.P, deposito_id: ids.dep1, motivo: 'Inventario inicial', ...c } });
  const i = await aj({ tipo: 'ingreso', cantidad: '10', costo_unitario: '1200' }); igual(i.estado, 201, JSON.stringify(i.cuerpo)); igual([i.cuerpo.saldo_antes, i.cuerpo.saldo_despues, i.cuerpo.cantidad], ['0', '10.0000', '10.0000'], 'ingreso');
  const e = await aj({ tipo: 'egreso', cantidad: '3.5', motivo: 'Merma por vencimiento' }); igual([e.cuerpo.saldo_antes, e.cuerpo.saldo_despues, e.cuerpo.cantidad], ['10.0000', '6.5000', '-3.5000'], 'egreso con decimales');
  const c = await aj({ tipo: 'conteo', cantidad: '9', motivo: 'Conteo de octubre' }); igual([c.cuerpo.cantidad, c.cuerpo.saldo_despues], ['2.5000', '9.0000'], 'conteo: 9 contados contra 6,5 → +2,5'); igual((await uno(`select tipo, motivo from movimiento_stock where id = $1`, [c.cuerpo.movimiento_id])), { tipo: 'inventario', motivo: 'Conteo de octubre' }, 'queda como inventario con su motivo');
  const baja = await aj({ tipo: 'conteo', cantidad: '4', motivo: 'Conteo con faltante' }); igual(baja.cuerpo.cantidad, '-5.0000', 'conteo menor → ajuste negativo');
  const igualConteo = await aj({ tipo: 'conteo', cantidad: '4', motivo: 'Mismo conteo otra vez' }); igual([igualConteo.estado, igualConteo.cuerpo.error.codigo], [422, 'sin_diferencia'], 'sin diferencia');
  const ev = await ultimoEvento('Ajustó el stock de Pan lactal'); igual([ev.categoria, ev.usuario_id, ev.empresa_id], ['stock', ADMIN, RI], 'evento'); verdad(/Depósito central: -5.0000 \(conteo\) · 9.0000 → 4.0000/.test(ev.detalle), ev.detalle);
  const sin = await aj({ tipo: 'egreso', cantidad: '100' }); igual([sin.estado, sin.cuerpo.error.codigo], [422, 'stock_insuficiente'], 'más de lo que hay'); verdad(/Pan lactal en Depósito central: hay 4 y se quieren sacar 100/.test(sin.cuerpo.error.mensaje), sin.cuerpo.error.mensaje); igual(await saldo(ids.P, ids.dep1), 4, 'no cambió');
  const mal = async (cuerpo, campo) => { const x = await api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: ids.P, deposito_id: ids.dep1, tipo: 'ingreso', cantidad: '1', motivo: 'Prueba de validación', ...cuerpo } }); igual(x.estado, 422, `${campo}: ${JSON.stringify(x.cuerpo)}`); verdad(campo in x.cuerpo.error.campos, `${campo} en ${JSON.stringify(x.cuerpo.error.campos)}`); };
  await mal({ motivo: 'ab' }, 'motivo'); await mal({ motivo: undefined }, 'motivo'); await mal({ cantidad: '0' }, 'cantidad'); await mal({ cantidad: '-1' }, 'cantidad'); await mal({ cantidad: 'dos' }, 'cantidad'); await mal({ tipo: 'regalo' }, 'tipo'); await mal({ articulo_id: 99999 }, 'articulo_id'); await mal({ deposito_id: 99999 }, 'deposito_id');
  await mal({ fecha: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) }, 'fecha'); await mal({ tipo: 'egreso', costo_unitario: '5' }, 'costo_unitario'); await mal({ movimiento_id: 1 }, 'movimiento_id');
  const serv = await articulo('SV-1', 'Un servicio', { tipo: 'servicio' }); await mal({ articulo_id: serv.id }, 'articulo_id');
  const sinUso = (await api('admin', 'POST', '/api/depositos', { cuerpo: { nombre: 'Depósito de baja' } })).cuerpo.id; await api('admin', 'PATCH', `/api/depositos/${sinUso}`, { cuerpo: { activo: false } }); await mal({ deposito_id: sinUso }, 'deposito_id');
});
await prueba('Stock negativo: se impide con un mensaje claro, salvo que la empresa lo permita', async () => {
  const aj = () => api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: ids.P, deposito_id: ids.dep1, tipo: 'egreso', cantidad: '10', motivo: 'Prueba de saldo negativo' } });
  igual((await aj()).cuerpo.error.codigo, 'stock_insuficiente', 'por defecto no se permite');
  await q('update empresa_parametro set permite_stock_negativo = true where empresa_id = $1', [RI]); const r = await aj(); igual([r.estado, r.cuerpo.saldo_despues], [201, '-6.0000'], 'si la empresa lo permite queda en negativo'); await q('update empresa_parametro set permite_stock_negativo = false where empresa_id = $1', [RI]);
  await api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: ids.P, deposito_id: ids.dep1, tipo: 'conteo', cantidad: '4', motivo: 'Se vuelve al saldo de las pruebas' } }); igual(await saldo(ids.P, ids.dep1), 4, 'saldo restablecido con un conteo (el libro no se edita)');
});
await prueba('Transferencias: mueven entre depósitos en un solo paso, con las dos patas en el libro, y no dejan nada a medias si algo falla', async () => {
  const tr = (c) => api('admin', 'POST', '/api/stock/transferencias', { cuerpo: { articulo_id: ids.P, deposito_origen_id: ids.dep1, deposito_destino_id: ids.dep2, cantidad: '1.5', ...c } });
  const r = await tr({}); igual(r.estado, 201, JSON.stringify(r.cuerpo)); igual([r.cuerpo.saldo_origen, r.cuerpo.saldo_destino, r.cuerpo.cantidad], ['2.5000', '1.5000', '1.5000'], 'saldos');
  const patas = await q(`select tipo, deposito_id, cantidad::text c, motivo from movimiento_stock where id = any($1::bigint[]) order by id`, [r.cuerpo.movimientos]); igual(patas.map((x) => [x.tipo, x.deposito_id, x.c]), [['transferencia_salida', ids.dep1, '-1.5000'], ['transferencia_entrada', ids.dep2, '1.5000']], 'las dos patas'); verdad(/Transferencia de Depósito central a Sucursal Norte/.test(patas[0].motivo), 'motivo automático');
  igual((await ultimoEvento('Transfirió stock de%')).categoria, 'stock', 'rastro');
  const antes = (await uno('select count(*)::int n from movimiento_stock')).n;
  igual((await tr({ deposito_destino_id: ids.dep1 })).cuerpo.error.campos.deposito_destino_id, 'el destino tiene que ser otro depósito', 'mismo depósito'); igual((await tr({ cantidad: '50' })).cuerpo.error.codigo, 'stock_insuficiente', 'sin saldo');
  const vacio = (await api('admin', 'POST', '/api/depositos', { cuerpo: { nombre: 'Depósito sin uso' } })).cuerpo.id; await api('admin', 'PATCH', `/api/depositos/${vacio}`, { cuerpo: { activo: false } });
  igual((await tr({ deposito_destino_id: vacio })).cuerpo.error.campos.deposito_destino_id, 'el depósito está dado de baja', 'destino de baja');
  igual((await tr({ deposito_origen_id: 99999 })).estado, 422, 'origen inexistente'); igual((await tr({ cantidad: '0' })).estado, 422, 'cantidad cero'); igual((await uno('select count(*)::int n from movimiento_stock')).n, antes, 'ningún intento dejó movimientos');
});

// ---------------------------------------------------------------------------
await prueba('Existencias: total y saldo por depósito, búsqueda, stock mínimo con aviso, sin servicios, y paginación', async () => {
  const lista = async (qs = '') => (await api('admin', 'GET', `/api/stock${qs}`)).cuerpo;
  const todo = await lista(); const pan = todo.datos.find((x) => x.codigo === 'ST-1'); igual([pan.total, pan.stock_minimo, pan.bajo_minimo], ['4.0000', null, false], 'pan'); igual(pan.por_deposito.map((x) => [x.deposito_id, x.saldo]).sort(), [[ids.dep1, '2.5000'], [ids.dep2, '1.5000']].sort(), 'por depósito');
  verdad(!todo.datos.some((x) => x.codigo === 'SV-1' || x.codigo === 'AJ-E'), 'ni servicios ni dados de baja'); igual((await lista('?q=pan')).datos.map((x) => x.codigo), ['ST-1'], 'búsqueda'); igual((await lista('?q=%25')).datos.length, 0, 'el % no es comodín');
  igual((await api('admin', 'PATCH', `/api/articulos/${ids.P}`, { cuerpo: { stock_minimo: '20' } })).cuerpo.stock_minimo, '20.0000', 'el mínimo se fija desde el artículo'); const bajo = await lista('?bajo_minimo=true'); igual(bajo.datos.map((x) => [x.codigo, x.bajo_minimo]), [['ST-1', true]], 'solo los que están bajo el mínimo');
  igual((await api('admin', 'PATCH', `/api/articulos/${ids.P}`, { cuerpo: { stock_minimo: null } })).cuerpo.stock_minimo, null, 'se puede quitar'); igual((await api('admin', 'PATCH', `/api/articulos/${ids.P}`, { cuerpo: { stock_minimo: '-1' } })).estado, 422, 'no negativo');
  igual((await lista('?limite=1')).datos.length, 1, 'página'); verdad((await lista('?limite=1')).total >= 2, 'total'); igual((await api('admin', 'GET', '/api/stock', { empresa: MT })).cuerpo.total, 0, 'otra empresa: nada'); igual((await api('otro', 'GET', '/api/stock', { empresa: AJENA })).cuerpo.total, 0, 'otro estudio: nada');
});
await prueba('Movimientos: libro con filtros, el más nuevo primero, con los de las facturas y su número de comprobante', async () => {
  const mov = async (qs = '') => (await api('admin', 'GET', `/api/stock/movimientos${qs}`)).cuerpo;
  const todos = await mov(); verdad(todos.total >= 8, 'total'); verdad(todos.datos.every((m, i, a) => i === 0 || a[i - 1].id > m.id), 'orden descendente');
  const del = await mov(`?articulo_id=${ids.A}`); igual(del.datos.map((m) => [m.tipo, m.cantidad]), [['venta', '-2.0000'], ['inventario', '10.0000']], 'artículo con la factura emitida'); verdad(/^A 0001-\d{8}$/.test(del.datos[0].comprobante), `comprobante: ${del.datos[0].comprobante}`); igual(del.datos[1].comprobante, null, 'el inventario no tiene comprobante');
  igual((await mov(`?articulo_id=${ids.P}&tipo=transferencia_salida`)).datos.map((m) => m.cantidad), ['-1.5000'], 'por tipo'); igual((await mov(`?deposito_id=${ids.dep2}`)).datos.length, 1, 'por depósito'); igual((await mov('?desde=2999-01-01')).total, 0, 'por fecha');
  const m = (await mov(`?articulo_id=${ids.P}&tipo=ajuste`)).datos.find((x) => x.motivo === 'Merma por vencimiento'); igual([m.articulo, m.deposito, m.cantidad], ['Pan lactal', 'Depósito central', '-3.5000'], 'con nombres y motivo');
  for (const qs of ['?tipo=inventado', '?desde=ayer', '?articulo_id=abc']) igual((await api('admin', 'GET', `/api/stock/movimientos${qs}`)).estado, 422, qs);
  igual((await api('admin', 'GET', '/api/stock/movimientos', { empresa: MT })).cuerpo.total, 0, 'otra empresa: nada');
});
await prueba('Facturación y stock juntos: un bien con stock se vende hasta donde alcanza y la venta descuenta del depósito', async () => {
  const cli = await api('admin', 'POST', '/api/clientes', { cuerpo: { tipo_documento: 'DNI', nro_documento: '27345118', razon_social: 'Marta Gómez', condicion_iva_codigo: 5 } });
  await api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: ids.B, deposito_id: ids.dep1, tipo: 'ingreso', cantidad: '3', motivo: 'Compra inicial' } });
  const venta = (n, deposito = ids.dep1) => api('admin', 'POST', '/api/ventas/facturas', { cuerpo: { tercero_id: cli.cuerpo.id, items: [{ articulo_id: ids.B, cantidad: n, ...(deposito ? { deposito_id: deposito } : {}) }] } });
  const sinDeposito = await venta('1', null); igual([sinDeposito.estado, sinDeposito.cuerpo.error.campos['items[0].deposito_id']], [422, 'indicá de qué depósito sale la mercadería'], 'con más de un depósito hay que decir de cuál sale');
  igual((await venta('4')).cuerpo.error.codigo, 'stock_insuficiente', 'más de lo que hay'); igual((await venta('3')).estado, 201, 'lo que hay'); igual(await saldo(ids.B, ids.dep1), 0, 'quedó en cero');
  igual((await venta('1')).cuerpo.error.codigo, 'stock_insuficiente', 'sin stock'); await api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: ids.B, deposito_id: ids.dep1, tipo: 'ingreso', cantidad: '1', motivo: 'Reposición' } }); igual((await venta('1')).estado, 201, 'repuesto, vuelve a vender');
});
await prueba('Base de datos: el libro de stock sigue siendo de solo agregar y la trazabilidad de todo lo hecho está íntegra', async () => {
  let msg = ''; try { await q('update movimiento_stock set cantidad = 99 where id = (select max(id) from movimiento_stock)'); } catch (e) { msg = e.message; } verdad(/solo agregar/i.test(msg), `no se edita: ${msg}`);
  msg = ''; try { await q('delete from movimiento_stock where id = (select max(id) from movimiento_stock)'); } catch (e) { msg = e.message; } verdad(/solo agregar/i.test(msg), `no se borra: ${msg}`);
  igual((await uno(`select count(*)::int n from evento where categoria = 'stock' and usuario_id is null`)).n, 0, 'todos los eventos de stock tienen autor');
  for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena del estudio ${e}`);
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
