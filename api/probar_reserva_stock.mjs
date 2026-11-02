// Pruebas de la reserva de stock por pedido: un pedido confirmado aparta lo que no entregó (el físico no se mueve y baja el disponible), las entregas y facturas sin pedido no toman lo reservado
// para otros, entregar o facturar contra el pedido usa su propia reserva, anular libera, la reserva estricta de la empresa y el stock negativo permitido. Con --pg pasan por el adaptador de producción.
// Uso:  node api/probar_reserva_stock.mjs [--pg]
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
var RI = S.empresas.ri.id; const MT = S.empresas.mt.id, ADMIN = S.usuarios.admin.id, DEP = S.empresas.ri.deposito;
const ids = {}, hoy = new Date().toISOString().slice(0, 10);
const stockDe = async (articuloId, dep = DEP) => Number((await uno('select coalesce(sum(cantidad), 0)::text s from movimiento_stock where articulo_id = $1 and deposito_id = $2', [articuloId, dep])).s);
const campoF = (r, k) => r.cuerpo?.error?.campos?.[k];
const num = (x) => Number(x);

const cli = async (doc, nombre, cond = 1, tipo = 'CUIT', empresa = RI) => (await api('admin', 'POST', '/api/clientes', { empresa, cuerpo: { tipo_documento: tipo, nro_documento: doc, razon_social: nombre, condicion_iva_codigo: cond } })).cuerpo;
const art = async (codigo, nombre, extra = {}, empresa = RI) => { const r = await api('admin', 'POST', '/api/articulos', { empresa, cuerpo: { codigo, nombre, alicuota_venta: '21', ...extra } }); if (r.estado !== 201) throw new Error(`${codigo}: ${JSON.stringify(r.cuerpo)}`); return r.cuerpo; };
const lista = (await api('admin', 'GET', '/api/listas-precio')).cuerpo.datos[0].id;
const C1 = await cli(cuitConDigito('3070811222'), 'Distribuidora Sur SRL'), C2 = await cli(cuitConDigito('3071000000'), 'Kiosco Norte SRL');
const PAN = await art('PAN', 'Pan lactal', { alicuota_venta: '10.5', lista_id: lista, precio_neto: '100' });
const LECHE = await art('LECHE', 'Leche x litro', { lista_id: lista, precio_neto: '50' });
const SERV = await art('SERV', 'Servicio de entrega', { tipo: 'servicio', lista_id: lista, precio_neto: '1000' });
await api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: PAN.id, deposito_id: DEP, tipo: 'ingreso', cantidad: '100', motivo: 'Inventario inicial' } });
await api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: LECHE.id, deposito_id: DEP, tipo: 'ingreso', cantidad: '20', motivo: 'Inventario inicial' } });

// --- atajos
const pedido = (cuerpo, o = {}) => api(o.quien ?? 'admin', 'POST', '/api/ventas/pedidos', { cuerpo: { tercero_id: C1.id, confirmar: true, ...cuerpo }, empresa: o.empresa });
const verP = async (id) => (await api('admin', 'GET', `/api/ventas/pedidos/${id}`)).cuerpo;
const remito = (cuerpo) => api('admin', 'POST', '/api/ventas/remitos', { cuerpo: { tercero_id: C1.id, ...cuerpo } });
const factura = (cuerpo, tercero = C1.id) => api('admin', 'POST', '/api/ventas/facturas', { cuerpo: { tercero_id: tercero, fecha: hoy, ...cuerpo } });
const anularP = (id) => api('admin', 'POST', `/api/ventas/pedidos/${id}/anular`, { cuerpo: { motivo: 'El cliente canceló' } });
const anularR = (id) => api('admin', 'POST', `/api/ventas/remitos/${id}/anular`, { cuerpo: { motivo: 'Se entregó por error' } });
const existencia = async (articulo) => (await api('admin', 'GET', `/api/stock?q=${articulo.codigo}`)).cuerpo.datos.find((x) => x.articulo_id === articulo.id);
const reservas = async (articulo) => (await api('admin', 'GET', `/api/stock/reservas?articulo_id=${articulo.id}`)).cuerpo.datos;

// ---------------------------------------------------------------------------
await prueba('Un pedido confirmado reserva lo que todavía no entregó; el stock físico no se mueve y el disponible baja', async () => {
  const antes = await existencia(PAN); igual([num(antes.total), num(antes.reservado), num(antes.disponible)], [100, 0, 100], JSON.stringify(antes));
  const b = (await pedido({ confirmar: false, items: [{ articulo_id: PAN.id, cantidad: '10' }] })).cuerpo; igual(num((await existencia(PAN)).reservado), 0, 'un borrador no reserva'); await api('admin', 'DELETE', `/api/ventas/pedidos/${b.id}`);
  const r = await pedido({ items: [{ articulo_id: PAN.id, cantidad: '30' }, { articulo_id: SERV.id, cantidad: '1' }] }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.P1 = r.cuerpo.id; ids.itP1 = r.cuerpo.items[0].id;
  const e = await existencia(PAN); igual([num(e.total), num(e.reservado), num(e.disponible), await stockDe(PAN.id)], [100, 30, 70, 100], JSON.stringify(e));
  const d = await verP(ids.P1); igual([d.items.map((i) => num(i.reservado)), d.items.map((i) => num(i.pendiente))], [[30, 0], [30, 1]], 'el pedido muestra su reserva (el servicio no reserva): ' + JSON.stringify(d.items));
  const lst = await reservas(PAN); igual(lst.map((x) => [x.pedido_numero, x.cliente, num(x.reservado)]), [[d.numero_formateado, 'Distribuidora Sur SRL', 30]], JSON.stringify(lst)); igual((await api('admin', 'GET', '/api/stock/reservas?articulo_id=x')).estado, 422, 'filtro inválido');
  igual((await api('consulta', 'GET', '/api/stock/reservas')).estado, 200, 'la consulta ve las reservas');
});
await prueba('Una entrega o una factura SIN pedido no puede tomar lo reservado para otros; lo que sobra sí', async () => {
  const mal = await remito({ items: [{ articulo_id: PAN.id, cantidad: '75' }] }); igual([mal.estado, campoF(mal, 'items[0].cantidad')], [422, 'hay 100 de Pan lactal pero 30 están reservados para pedidos de clientes: quedan 70 disponibles'], JSON.stringify(mal.cuerpo));
  const sumado = await remito({ items: [{ articulo_id: PAN.id, cantidad: '40' }, { articulo_id: PAN.id, cantidad: '40' }] }); igual([sumado.estado, campoF(sumado, 'items[1].cantidad')?.startsWith('hay 100 de Pan lactal pero 30')], [422, true], 'los renglones se suman: ' + JSON.stringify(sumado.cuerpo));
  const f = await factura({ items: [{ articulo_id: PAN.id, cantidad: '71' }] }, C2.id); igual([f.estado, f.cuerpo.error.codigo], [422, 'stock_reservado'], JSON.stringify(f.cuerpo)); verdad(/No se puede facturar: hay 100 de Pan lactal pero 30 están reservados/.test(f.cuerpo.error.mensaje), f.cuerpo.error.mensaje);
  igual(await stockDe(PAN.id), 100, 'nada se movió');
  const ok = await remito({ items: [{ articulo_id: PAN.id, cantidad: '70' }], confirmar: true }); igual(ok.estado, 201, 'lo disponible (70) sí se entrega: ' + JSON.stringify(ok.cuerpo)); ids.Rsin = ok.cuerpo.id;
  const e = await existencia(PAN); igual([num(e.total), num(e.reservado), num(e.disponible)], [30, 30, 0], 'queda solo lo reservado: ' + JSON.stringify(e));
  const un = await factura({ items: [{ articulo_id: PAN.id, cantidad: '1' }] }, C2.id); igual([un.estado, un.cuerpo.error.codigo], [422, 'stock_reservado'], 'ni una unidad más: ' + JSON.stringify(un.cuerpo));
  const bor = (await remito({ items: [{ articulo_id: LECHE.id, cantidad: '5' }] })).cuerpo; const p2 = await pedido({ items: [{ articulo_id: LECHE.id, cantidad: '18' }] }); igual(p2.estado, 201, JSON.stringify(p2.cuerpo)); ids.P2 = p2.cuerpo.id;
  const conf = await api('admin', 'POST', `/api/ventas/remitos/${bor.id}/confirmar`, { cuerpo: {} }); igual([conf.estado, conf.cuerpo.error.codigo], [422, 'stock_reservado'], 'un borrador cargado antes tampoco la toma al confirmarse: ' + JSON.stringify(conf.cuerpo)); await api('admin', 'DELETE', `/api/ventas/remitos/${bor.id}`);
});
await prueba('Entregar contra el pedido usa su propia reserva: la reserva baja con cada entrega y se libera cuando se cumple', async () => {
  const r = await remito({ pedido_id: ids.P1, items: [{ item_origen_id: ids.itP1, cantidad: '12' }], confirmar: true }); igual(r.estado, 201, 'se entrega aunque el disponible sea 0: ' + JSON.stringify(r.cuerpo)); ids.R1 = r.cuerpo.id;
  const e = await existencia(PAN); igual([num(e.total), num(e.reservado), num(e.disponible)], [18, 18, 0], 'entregó 12 de los 30 reservados: ' + JSON.stringify(e)); igual(num((await verP(ids.P1)).items[0].reservado), 18, 'el pedido ve lo que le queda reservado');
  const mas = await remito({ pedido_id: ids.P1, items: [{ item_origen_id: ids.itP1, cantidad: '19' }] }); igual(campoF(mas, 'items[0].cantidad'), 'solo falta entregar 18', 'no se entrega más que lo reservado');
  const r2 = await remito({ pedido_id: ids.P1, items: [{ item_origen_id: ids.itP1, cantidad: '18' }], confirmar: true }); igual(r2.estado, 201, JSON.stringify(r2.cuerpo)); ids.R2 = r2.cuerpo.id;
  const e2 = await existencia(PAN); igual([num(e2.total), num(e2.reservado), num(e2.disponible)], [0, 0, 0], 'cumplido: ya no reserva nada'); igual((await reservas(PAN)).length, 0, 'no quedan reservas');
  igual((await anularR(ids.R2)).estado, 200, 'anular la entrega devuelve la mercadería'); const e3 = await existencia(PAN); igual([num(e3.total), num(e3.reservado), num(e3.disponible)], [18, 18, 0], 'y la reserva: ' + JSON.stringify(e3));
});
await prueba('Facturar directo contra el pedido consume su reserva sin chocar con ella; anular el pedido la libera', async () => {
  const f = await factura({ items: [{ documento_item_id: ids.itP1, cantidad: '8' }] }); igual(f.estado, 201, 'la factura del propio pedido usa su reserva: ' + JSON.stringify(f.cuerpo)); ids.F1 = f.cuerpo.id;
  const e = await existencia(PAN); igual([num(e.total), num(e.reservado), num(e.disponible)], [10, 10, 0], JSON.stringify(e));
  const a = await anularP(ids.P1); igual(a.estado, 422, 'con una factura vigente el pedido no se anula'); igual((await api('admin', 'POST', `/api/comprobantes/${ids.F1}/anular`, { cuerpo: { motivo: 'Error de carga' } })).estado, 200, 'se anula la factura'); igual((await anularR(ids.R1)).estado, 200, 'y la primera entrega');
  const e1 = await existencia(PAN); igual([num(e1.total), num(e1.reservado)], [30, 30], 'vuelven 8 + 12 a existencia y a reserva: ' + JSON.stringify(e1));
  igual((await anularP(ids.P1)).estado, 200, 'se anula el pedido'); const e2 = await existencia(PAN); igual([num(e2.total), num(e2.reservado), num(e2.disponible)], [30, 0, 30], 'la reserva se libera: ' + JSON.stringify(e2));
  const libre = await remito({ items: [{ articulo_id: PAN.id, cantidad: '30' }] }); igual(libre.estado, 201, 'ahora se puede entregar todo sin pedido: ' + JSON.stringify(libre.cuerpo)); await api('admin', 'DELETE', `/api/ventas/remitos/${libre.cuerpo.id}`);
});
await prueba('Pedido sin stock suficiente: por defecto se confirma, reserva igual y avisa; con reserva estricta no se confirma', async () => {
  const antes = await existencia(LECHE); igual([num(antes.total), num(antes.reservado), num(antes.disponible)], [20, 18, 2], 'la leche ya tiene 18 reservados por el pedido P2: ' + JSON.stringify(antes));
  const p = await pedido({ items: [{ articulo_id: LECHE.id, cantidad: '10' }] }); igual(p.estado, 201, JSON.stringify(p.cuerpo)); ids.P3 = p.cuerpo.id; verdad(p.cuerpo.avisos.some((a) => /Hoy no alcanza el stock de Leche x litro: hoy hay 2 disponibles de Leche x litro \(20 en los depósitos y 18 reservados para otros pedidos\)\. El pedido reserva igual todo lo que pide y queda en espera/.test(a)), 'avisa: ' + JSON.stringify(p.cuerpo.avisos));
  const e = await existencia(LECHE); igual([num(e.reservado), num(e.disponible)], [28, -8], 'reserva de más (en espera): ' + JSON.stringify(e));
  await q('update empresa_parametro set pedido_reserva_estricta = true where empresa_id = $1', [RI]);
  const rechazo = await pedido({ items: [{ articulo_id: LECHE.id, cantidad: '3' }] }); igual([rechazo.estado, campoF(rechazo, 'items[0].cantidad')], [422, 'no hay disponible para reservar: hoy hay 0 disponibles de Leche x litro (20 en los depósitos y 28 reservados para otros pedidos)'], JSON.stringify(rechazo.cuerpo));
  const borr = await pedido({ confirmar: false, items: [{ articulo_id: LECHE.id, cantidad: '3' }] }); igual(borr.estado, 201, 'un borrador se guarda igual'); const c = await api('admin', 'POST', `/api/ventas/pedidos/${borr.cuerpo.id}/confirmar`, { cuerpo: {} }); igual([c.estado, c.cuerpo.error.codigo], [422, 'sin_disponible'], 'y no se confirma después: ' + JSON.stringify(c.cuerpo)); await api('admin', 'DELETE', `/api/ventas/pedidos/${borr.cuerpo.id}`);
  const servicio = await pedido({ items: [{ articulo_id: SERV.id, cantidad: '50' }] }); igual(servicio.estado, 201, 'un servicio no tiene stock que reservar: ' + JSON.stringify(servicio.cuerpo));
  await q('update empresa_parametro set pedido_reserva_estricta = false where empresa_id = $1', [RI]); igual((await anularP(ids.P3)).estado, 200, 'se anula el pedido en espera'); igual(num((await existencia(LECHE)).reservado), 18, 'queda la reserva del otro');
});
await prueba('Con stock negativo permitido, la reserva no frena una entrega sin pedido; la reserva es por empresa y la base la calcula sola', async () => {
  await q('update empresa_parametro set permite_stock_negativo = true where empresa_id = $1', [RI]);
  const r = await remito({ items: [{ articulo_id: LECHE.id, cantidad: '15' }], confirmar: true }); igual(r.estado, 201, 'la empresa acepta stock negativo: ' + JSON.stringify(r.cuerpo)); await anularR(r.cuerpo.id); await q('update empresa_parametro set permite_stock_negativo = false where empresa_id = $1', [RI]);
  igual((await api('admin', 'GET', '/api/stock/reservas', { empresa: MT })).cuerpo.datos.length, 0, 'otra empresa no ve estas reservas');
  igual((await uno('select count(*)::int n from v_stock_reservado where articulo_id = $1', [LECHE.id])).n, 1, 'la vista suma por artículo'); igual(num((await uno('select reservado::text r from v_stock_reservado where articulo_id = $1', [LECHE.id])).r), 18, 'y coincide con el pedido P2');
  igual((await anularP(ids.P2)).estado, 200, 'se anula P2'); igual((await uno('select count(*)::int n from v_stock_reservado')).n, 0, 'sin pedidos pendientes no hay reservas (solo los de servicios, que no reservan)');
});
await prueba('Trazabilidad: la cadena sigue íntegra', async () => {
  for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena ${e}`);
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
