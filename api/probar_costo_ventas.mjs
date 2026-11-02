// Pruebas del costo de ventas automático (inventario permanente): activarlo crea las cuentas, un remito de salida o una factura sin remito asientan el costo de lo que sale (Costo de ventas contra
// Mercaderías) al costo vigente, anular o devolver lo asienta al revés AL COSTO CON EL QUE SALIÓ, lo anterior a activar no se revierte, y las compras de bienes van a Mercaderías.
// Con --pg pasan por el adaptador de producción.
// Uso:  node api/probar_costo_ventas.mjs [--pg]
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
const SESION = { admin: token('sub-admin'), consulta: token('sub-consulta'), auxiliar: token('sub-auxiliar') };
async function api(quien, metodo, ruta, { cuerpo, empresa = RI } = {}) {
  const t = SESION[quien] ?? quien;
  const r = await fetch(srv.base + ruta, { method: metodo, headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(empresa ? { 'X-Empresa-Id': String(empresa) } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const texto = await r.text(); let json = null; try { json = texto ? JSON.parse(texto) : null; } catch (e) { /* no JSON */ }
  return { estado: r.status, cuerpo: json };
}
var RI = S.empresas.ri.id; const DEP = S.empresas.ri.deposito;
let MERC = '?';                                                                                    // código de Mercaderías: en la semilla 1.1.4 ya es Bancos, así que se crea con otro
const ids = {}, hoy = new Date().toISOString().slice(0, 10);
const stockDe = async (articuloId, dep = DEP) => Number((await uno('select coalesce(sum(cantidad), 0)::text s from movimiento_stock where articulo_id = $1 and deposito_id = $2', [articuloId, dep])).s);
const lineas = async (asientoId) => (await q(`select c.codigo, l.debe::text d, l.haber::text h from asiento_linea l join plan_cuenta c on c.id = l.cuenta_id where l.asiento_id = $1 order by c.codigo`, [asientoId])).map((l) => `${l.codigo} ${Number(l.d) > 0 ? 'D ' + Number(l.d) : 'H ' + Number(l.h)}`);
const asientosCosto = async (tipo, origenId) => q(`select id, descripcion, estado from asiento where origen_tipo = $1 and origen_id = $2 order by id`, [tipo, origenId]);
const nAsientosCosto = async () => (await uno(`select count(*)::int n from asiento where origen_tipo in ('costo_remito', 'costo_comprobante')`)).n;
const saldoCuenta = async (codigo) => Number((await uno(`select coalesce(sum(l.debe - l.haber), 0)::text s from asiento_linea l join asiento a on a.id = l.asiento_id and a.estado = 'contabilizado' join plan_cuenta c on c.id = l.cuenta_id where c.empresa_id = $1 and c.codigo = $2`, [RI, codigo])).s);

const cli = async (doc, nombre, cond = 1) => (await api('admin', 'POST', '/api/clientes', { cuerpo: { tipo_documento: 'CUIT', nro_documento: doc, razon_social: nombre, condicion_iva_codigo: cond } })).cuerpo;
const art = async (codigo, nombre, extra = {}) => { const r = await api('admin', 'POST', '/api/articulos', { cuerpo: { codigo, nombre, alicuota_venta: '21', ...extra } }); if (r.estado !== 201) throw new Error(`${codigo}: ${JSON.stringify(r.cuerpo)}`); return r.cuerpo; };
const lista = (await api('admin', 'GET', '/api/listas-precio')).cuerpo.datos[0].id;
const C1 = await cli(cuitConDigito('3070811222'), 'Distribuidora Sur SRL');
const PAN = await art('PAN', 'Pan lactal', { lista_id: lista, precio_neto: '100', costo: '60' });
const LECHE = await art('LECHE', 'Leche x litro', { lista_id: lista, precio_neto: '50', costo: '30' });
const SINC = await art('SINC', 'Artículo sin costo', { lista_id: lista, precio_neto: '80' });
const SERV = await art('SERV', 'Servicio de entrega', { tipo: 'servicio', lista_id: lista, precio_neto: '1000' });
for (const [a, n] of [[PAN, '100'], [LECHE, '50'], [SINC, '50']]) await api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: a.id, deposito_id: DEP, tipo: 'ingreso', cantidad: n, motivo: 'Inventario inicial' } });

const remito = (cuerpo) => api('admin', 'POST', '/api/ventas/remitos', { cuerpo: { tercero_id: C1.id, confirmar: true, ...cuerpo } });
const verR = async (id) => (await api('admin', 'GET', `/api/ventas/remitos/${id}`)).cuerpo;
const anularR = (id) => api('admin', 'POST', `/api/ventas/remitos/${id}/anular`, { cuerpo: { motivo: 'Se entregó por error' } });
const factura = (cuerpo) => api('admin', 'POST', '/api/ventas/facturas', { cuerpo: { tercero_id: C1.id, fecha: hoy, ...cuerpo } });
const anularF = (id) => api('admin', 'POST', `/api/comprobantes/${id}/anular`, { cuerpo: { motivo: 'Error de carga' } });
const nota = (origen, cuerpo) => api('admin', 'POST', '/api/ventas/notas-credito', { cuerpo: { comprobante_origen_id: origen, motivo: 'Devolución del cliente', ...cuerpo } });
const estado = async () => (await api('admin', 'GET', '/api/contabilidad/costo-ventas')).cuerpo;
const costoMov = async (articuloId, tipo) => (await uno(`select costo_unitario::text c from movimiento_stock where articulo_id = $1 and tipo = $2 order by id desc limit 1`, [articuloId, tipo]))?.c;

// ---------------------------------------------------------------------------
await prueba('Apagado por defecto: la salida lleva su costo en el movimiento pero no genera asiento de costo; activarlo exige los asientos automáticos y el permiso', async () => {
  const e = await estado(); igual([e.activo, e.asientos_automaticos, e.cuenta_costo_ventas, e.cuenta_mercaderias, e.articulos_sin_costo], [false, true, null, null, 1], JSON.stringify(e));
  const r = await remito({ items: [{ articulo_id: PAN.id, cantidad: '5' }] }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.R0 = r.cuerpo.id;
  igual([await nAsientosCosto(), (await verR(ids.R0)).asientos_costo, await costoMov(PAN.id, 'venta')], [0, [], '60.0000'], 'sin asiento; el movimiento sí lleva el costo vigente');
  igual((await api('consulta', 'PUT', '/api/contabilidad/costo-ventas', { cuerpo: { activo: true } })).estado, 403, 'la consulta no configura'); igual((await api('auxiliar', 'PUT', '/api/contabilidad/costo-ventas', { cuerpo: { activo: true } })).estado, 403, 'el auxiliar tampoco');
  igual((await api('consulta', 'GET', '/api/contabilidad/costo-ventas')).estado, 200, 'la consulta lo ve');
  await q('update empresa_parametro set asientos_automaticos = false where empresa_id = $1', [RI]);
  const sin = await api('admin', 'PUT', '/api/contabilidad/costo-ventas', { cuerpo: { activo: true } }); igual(sin.estado, 422, JSON.stringify(sin.cuerpo)); verdad(/asientos automáticos/.test(sin.cuerpo.error.mensaje), sin.cuerpo.error.mensaje);
  await q('update empresa_parametro set asientos_automaticos = true where empresa_id = $1', [RI]);
  igual((await api('admin', 'PUT', '/api/contabilidad/costo-ventas', { cuerpo: {} })).estado, 422, 'falta activo');
});

await prueba('Activarlo crea las cuentas Mercaderías (en un código libre: 1.1.4 ya es Bancos) y Costo de mercaderías vendidas (5.1.2), queda en la trazabilidad y repetirlo no cambia nada', async () => {
  const r = await api('admin', 'PUT', '/api/contabilidad/costo-ventas', { cuerpo: { activo: true } }); igual(r.estado, 200, JSON.stringify(r.cuerpo));
  MERC = r.cuerpo.cuenta_mercaderias.codigo; igual([r.cuerpo.activo, r.cuerpo.cambio, MERC !== '1.1.4', r.cuerpo.cuenta_mercaderias.nombre, r.cuerpo.cuenta_costo_ventas.codigo], [true, true, true, 'Mercaderías', '5.1.2'], JSON.stringify(r.cuerpo));
  igual((await uno(`select nombre from plan_cuenta where empresa_id = $1 and codigo = '1.1.4'`, [RI])).nombre, 'Bancos', 'Bancos queda como estaba');
  const otra = await api('admin', 'PUT', '/api/contabilidad/costo-ventas', { cuerpo: { activo: true } }); igual([otra.cuerpo.activo, otra.cuerpo.cambio], [true, false], 'idempotente');
  igual((await uno(`select count(*)::int n from plan_cuenta where empresa_id = $1 and nombre in ('Mercaderías', 'Costo de mercaderías vendidas')`, [RI])).n, 2, 'las cuentas no se duplican');
  verdad((await uno(`select count(*)::int n from evento where accion = 'Activó el costo de ventas automático'`)).n === 1, 'un solo evento');
});

await prueba('Remito de salida: al confirmarlo asienta el costo de lo que sale (Costo de ventas contra Mercaderías) y el detalle muestra el asiento', async () => {
  const antes = await nAsientosCosto();
  const r = await remito({ items: [{ articulo_id: PAN.id, cantidad: '10' }, { articulo_id: LECHE.id, cantidad: '4' }, { articulo_id: SERV.id, cantidad: '1' }] }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.R1 = r.cuerpo.id;
  const a = await asientosCosto('costo_remito', ids.R1); igual(a.length, 1, 'un asiento'); igual(a[0].estado, 'contabilizado', 'contabilizado'); verdad(/^Costo de ventas · Remito 0001-\d{8}$/.test(a[0].descripcion), a[0].descripcion);
  igual(await lineas(a[0].id), [MERC + ' H 720', '5.1.2 D 720'], '10 × 60 + 4 × 30 = 720');
  const d = await verR(ids.R1); igual(d.asientos_costo.map((x) => [x.id, x.importe]), [[a[0].id, '720.00']], 'el detalle del remito lo muestra'); igual(await nAsientosCosto(), antes + 1, 'uno solo');
  igual([await costoMov(PAN.id, 'venta'), await costoMov(LECHE.id, 'venta')], ['60.0000', '30.0000'], 'costo grabado en cada movimiento (el servicio no mueve stock)');
  igual([await saldoCuenta('5.1.2'), await saldoCuenta(MERC)], [720, -720], 'saldos');
});

await prueba('Un remito en borrador no asienta nada: lo hace al confirmarse, con el costo de ese día', async () => {
  const antes = await nAsientosCosto();
  const b = await remito({ confirmar: false, items: [{ articulo_id: LECHE.id, cantidad: '2' }] }); igual(b.estado, 201, JSON.stringify(b.cuerpo)); igual(await nAsientosCosto(), antes, 'borrador: nada');
  const c = await api('admin', 'POST', `/api/ventas/remitos/${b.cuerpo.id}/confirmar`, { cuerpo: {} }); igual(c.estado, 200, JSON.stringify(c.cuerpo));
  const a = await asientosCosto('costo_remito', b.cuerpo.id); igual(a.length, 1, 'ahora sí'); igual(await lineas(a[0].id), [MERC + ' H 60', '5.1.2 D 60'], '2 × 30');
});

await prueba('Anular un remito lo asienta al revés AL COSTO CON EL QUE SALIÓ (aunque el costo haya cambiado), y el neto queda en cero', async () => {
  await api('admin', 'PATCH', `/api/articulos/${PAN.id}`, { cuerpo: { costo: '70' } });
  const r = await remito({ items: [{ articulo_id: PAN.id, cantidad: '1' }] }); ids.R2 = r.cuerpo.id; igual(await costoMov(PAN.id, 'venta'), '70.0000', 'el costo nuevo rige para lo que sale desde ahora');
  const x = await anularR(ids.R1); igual(x.estado, 200, JSON.stringify(x.cuerpo));
  const a = await asientosCosto('costo_remito', ids.R1); igual(a.length, 2, 'el original y el de la anulación'); verdad(/^Anulación del costo de ventas/.test(a[1].descripcion), a[1].descripcion);
  igual(await lineas(a[1].id), [MERC + ' D 720', '5.1.2 H 720'], 'al costo original (60), no al vigente (70)'); igual(await costoMov(PAN.id, 'devolucion_venta'), '60.0000', 'la devolución lleva el costo original');
  igual((await verR(ids.R1)).asientos_costo.map((y) => y.importe), ['720.00', '720.00'], 'el detalle muestra los dos');
});

await prueba('Lo que salió ANTES de activar no se revierte: no tiene asiento de costo, su anulación tampoco', async () => {
  const antes = await nAsientosCosto(), x = await anularR(ids.R0); igual(x.estado, 200, JSON.stringify(x.cuerpo));
  igual(await nAsientosCosto(), antes, 'sin asiento nuevo'); igual(await costoMov(PAN.id, 'devolucion_venta'), '0.0000', 'costo cero: nunca se asentó');
});

await prueba('Factura sin remito: asienta el costo de lo que sale; anularla lo asienta al revés; una factura contra remito no asienta de nuevo (ya lo hizo el remito)', async () => {
  const f = await factura({ items: [{ articulo_id: PAN.id, cantidad: '3' }, { articulo_id: LECHE.id, cantidad: '2' }] }); igual(f.estado, 201, JSON.stringify(f.cuerpo)); ids.F1 = f.cuerpo.id;
  const a = await asientosCosto('costo_comprobante', ids.F1); igual(a.length, 1, 'uno'); verdad(/^Costo de ventas · Factura [ABC] 0001-\d{8}$/.test(a[0].descripcion), a[0].descripcion); igual(await lineas(a[0].id), [MERC + ' H 270', '5.1.2 D 270'], '3 × 70 + 2 × 30');
  const x = await anularF(ids.F1); igual(x.estado, 200, JSON.stringify(x.cuerpo)); const b = await asientosCosto('costo_comprobante', ids.F1); igual(b.length, 2, 'y el de la anulación'); igual(await lineas(b[1].id), [MERC + ' D 270', '5.1.2 H 270'], 'al revés');
  const antes = await nAsientosCosto(), rm = await remito({ items: [{ articulo_id: LECHE.id, cantidad: '3' }] }); ids.R3 = rm.cuerpo.id; igual(await nAsientosCosto(), antes + 1, 'el remito asienta');
  const fr = await factura({ items: [{ documento_item_id: (await verR(ids.R3)).items[0].id, cantidad: '3' }] }); igual(fr.estado, 201, JSON.stringify(fr.cuerpo)); igual(await nAsientosCosto(), antes + 1, 'facturarlo no vuelve a asentar el costo');
  ids.FR = fr.cuerpo.id;
});

await prueba('Nota de crédito con devolución de mercadería: el costo vuelve al que tenía lo vendido (no al vigente); sin devolver la mercadería no hay costo que revertir', async () => {
  const f = await factura({ items: [{ articulo_id: PAN.id, cantidad: '4' }] }); ids.F2 = f.cuerpo.id; const item = f.cuerpo.items[0].id;
  await api('admin', 'PATCH', `/api/articulos/${PAN.id}`, { cuerpo: { costo: '90' } });
  const n = await nota(ids.F2, { items: [{ item_id: item, cantidad: '3' }] }); igual(n.estado, 201, JSON.stringify(n.cuerpo)); ids.N1 = n.cuerpo.id;
  const a = await asientosCosto('costo_comprobante', ids.N1); igual(a.length, 1, 'la nota asienta'); igual(await lineas(a[0].id), [MERC + ' D 210', '5.1.2 H 210'], '3 × 70 (lo que costaba cuando salió), no 90');
  const antes = await nAsientosCosto(), s = await nota(ids.F2, { devolver_stock: false, items: [{ item_id: item, cantidad: '1' }] }); igual(s.estado, 201, JSON.stringify(s.cuerpo)); igual(await nAsientosCosto(), antes, 'sin devolver mercadería no hay costo');
  const x = await anularF(ids.N1); igual(x.estado, 200, JSON.stringify(x.cuerpo)); const b = await asientosCosto('costo_comprobante', ids.N1); igual(b.length, 2, 'anular la nota'); igual(await lineas(b[1].id), [MERC + ' H 210', '5.1.2 D 210'], 'la mercadería vuelve a salir al mismo costo');
});

await prueba('Un artículo sin costo cargado avisa y no genera costo; mezclado con otros, asienta solo lo que tiene costo', async () => {
  const antes = await nAsientosCosto();
  const calc = await api('admin', 'POST', '/api/ventas/remitos/calcular', { cuerpo: { tercero_id: C1.id, items: [{ articulo_id: SINC.id, cantidad: '2' }] } }); igual(calc.estado, 200, JSON.stringify(calc.cuerpo)); verdad(calc.cuerpo.avisos.some((a) => /Sin costo cargado: Artículo sin costo/.test(a)), JSON.stringify(calc.cuerpo.avisos));
  const solo = await remito({ items: [{ articulo_id: SINC.id, cantidad: '2' }] }); igual(solo.estado, 201, JSON.stringify(solo.cuerpo)); igual(await nAsientosCosto(), antes, 'sin costo no hay asiento');
  const mix = await remito({ items: [{ articulo_id: SINC.id, cantidad: '2' }, { articulo_id: LECHE.id, cantidad: '1' }] }); const a = await asientosCosto('costo_remito', mix.cuerpo.id); igual(await lineas(a[0].id), [MERC + ' H 30', '5.1.2 D 30'], 'solo la leche');
  igual((await estado()).articulos_sin_costo, 1, 'el estado cuenta los artículos sin costo');
});

await prueba('Con la opción activa las compras de bienes con stock van a Mercaderías (no a Compras) y un gasto sigue en Compras', async () => {
  const P = (await api('admin', 'POST', '/api/proveedores', { cuerpo: { tipo_documento: 'CUIT', nro_documento: cuitConDigito('3071000000'), razon_social: 'Molinos del Sur SA', condicion_iva_codigo: 1 } })).cuerpo;
  const FLETE = await art('FLETE', 'Flete', { tipo: 'gasto', alicuota_compra: '21' });
  const r = await api('admin', 'POST', '/api/compras/facturas', { cuerpo: { tercero_id: P.id, letra: 'A', punto_venta: 4, numero: 501, fecha: hoy, total: '847.00', items: [{ articulo_id: PAN.id, cantidad: '5', precio_unitario: '100' }, { articulo_id: FLETE.id, cantidad: '1', precio_unitario: '200' }] } });
  igual(r.estado, 201, JSON.stringify(r.cuerpo)); igual((await lineas(r.cuerpo.asiento.id)).sort(), ['1.1.5 D 147', '2.1.1 H 847', '5.1.1 D 200', MERC + ' D 500'].sort(), 'mercadería a Mercaderías, flete a Compras');
});

await prueba('Desactivarlo: lo que sale después no asienta costo; las cuentas y lo ya asentado quedan', async () => {
  const antes = await nAsientosCosto(), sCmv = await saldoCuenta('5.1.2');
  const r = await api('admin', 'PUT', '/api/contabilidad/costo-ventas', { cuerpo: { activo: false } }); igual([r.estado, r.cuerpo.activo, r.cuerpo.cambio], [200, false, true], JSON.stringify(r.cuerpo));
  const x = await remito({ items: [{ articulo_id: PAN.id, cantidad: '1' }] }); igual(x.estado, 201, JSON.stringify(x.cuerpo)); igual([await nAsientosCosto(), await saldoCuenta('5.1.2')], [antes, sCmv], 'nada nuevo');
  const compra = await api('admin', 'POST', '/api/compras/facturas', { cuerpo: { tercero_id: (await uno(`select id from tercero where razon_social = 'Molinos del Sur SA'`)).id, letra: 'A', punto_venta: 4, numero: 502, fecha: hoy, total: '121.00', items: [{ articulo_id: PAN.id, cantidad: '1', precio_unitario: '100' }] } });
  igual(await lineas(compra.cuerpo.asiento.id), ['1.1.5 D 21', '2.1.1 H 121', '5.1.1 D 100'], 'las compras vuelven a Compras');
  igual((await estado()).cuenta_costo_ventas.codigo, '5.1.2', 'las cuentas siguen asignadas');
});

await prueba('Activarlo no toma una cuenta que ya tiene otro uso: si 1.1.4 es Bancos, Mercaderías va a otra cuenta; y si ya hay una cuenta Mercaderías, la usa', async () => {
  const MT = S.empresas.mt.id; await q(`insert into plan_cuenta (empresa_id, codigo, nombre, tipo) values ($1, '1.1.4', 'Bancos', 'activo'), ($1, '5.1.2', 'Gastos varios', 'egreso') on conflict (empresa_id, codigo) do nothing`, [MT]);
  await q('select fn_activar_costo_ventas($1, true)', [MT]);
  const cta = async (c) => uno(`select p.codigo, p.nombre from cuenta_automatica a join plan_cuenta p on p.id = a.cuenta_id where a.empresa_id = $1 and a.concepto = $2`, [MT, c]);
  const m = await cta('mercaderias'), k = await cta('costo_ventas'); igual([m.nombre, m.codigo !== '1.1.4', k.nombre, k.codigo !== '5.1.2'], ['Mercaderías', true, 'Costo de mercaderías vendidas', true], JSON.stringify([m, k]));
  igual((await uno(`select nombre from plan_cuenta where empresa_id = $1 and codigo = '1.1.4'`, [MT])).nombre, 'Bancos', 'Bancos queda como estaba');
  await q('select fn_activar_costo_ventas($1, false)', [MT]); await q(`delete from cuenta_automatica where empresa_id = $1 and concepto in ('mercaderias', 'costo_ventas')`, [MT]);
  await q('select fn_activar_costo_ventas($1, true)', [MT]); igual((await cta('mercaderias')).codigo, m.codigo, 'la segunda vez reutiliza la cuenta Mercaderías que ya creó');
  await q('select fn_activar_costo_ventas($1, false)', [MT]);
});

await prueba('Aislamiento y trazabilidad: la otra empresa no tiene el costo de ventas activado ni sus asientos, y la cadena sigue íntegra', async () => {
  const MT = S.empresas.mt.id; igual((await uno('select costo_ventas_automatico a from empresa_parametro where empresa_id = $1', [MT])).a, false, 'la otra empresa sigue apagada');
  igual((await uno(`select count(*)::int n from asiento where empresa_id = $1 and origen_tipo in ('costo_remito', 'costo_comprobante')`, [MT])).n, 0, 'sin asientos de costo');
  for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena ${e}`);
  for (const a of await q(`select a.id from asiento a where a.empresa_id = $1 and a.estado = 'contabilizado'`, [RI])) { const t = await uno('select sum(debe) d, sum(haber) h from asiento_linea where asiento_id = $1', [a.id]); if (Number(t.d) !== Number(t.h)) throw new Error('asiento desbalanceado ' + a.id); }
});

console.log(`\n${correctas} pruebas correctas, ${fallas} con falla`);
await srv.cerrar(); await cerrarBase();
process.exit(fallas ? 1 : 0);
