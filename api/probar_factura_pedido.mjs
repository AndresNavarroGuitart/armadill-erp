// Pruebas de la factura de venta directo contra un pedido (sin remito): la factura toma el precio del pedido y ENTREGA (descuenta el stock), el pedido refleja entregado y facturado,
// el remito contra el pedido descuenta lo ya facturado, el tope total (remitos + facturas) y las defensas de la base, y las anulaciones. Con --pg pasan por el adaptador de producción.
// Uso:  node api/probar_factura_pedido.mjs [--pg]
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
const saldoCli = async (id, empresa = RI) => (await api('admin', 'GET', `/api/clientes/${id}`, { empresa })).cuerpo.saldo;
const campoF = (r, k) => r.cuerpo?.error?.campos?.[k];

const cli = async (doc, nombre, cond = 1, tipo = 'CUIT', empresa = RI) => (await api('admin', 'POST', '/api/clientes', { empresa, cuerpo: { tipo_documento: tipo, nro_documento: doc, razon_social: nombre, condicion_iva_codigo: cond } })).cuerpo;
const art = async (codigo, nombre, extra = {}, empresa = RI) => { const r = await api('admin', 'POST', '/api/articulos', { empresa, cuerpo: { codigo, nombre, alicuota_venta: '21', ...extra } }); if (r.estado !== 201) throw new Error(`${codigo}: ${JSON.stringify(r.cuerpo)}`); return r.cuerpo; };
const lista = (await api('admin', 'GET', '/api/listas-precio')).cuerpo.datos[0].id;
const C1 = await cli(cuitConDigito('3070811222'), 'Distribuidora Sur SRL'), C2 = await cli(cuitConDigito('3071000000'), 'Kiosco Norte SRL');
const PAN = await art('PAN', 'Pan lactal', { alicuota_venta: '10.5', lista_id: lista, precio_neto: '100' });
const LECHE = await art('LECHE', 'Leche x litro', { lista_id: lista, precio_neto: '50' });
const SERV = await art('SERV', 'Servicio de entrega', { tipo: 'servicio', lista_id: lista, precio_neto: '1000' });
await api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: PAN.id, deposito_id: DEP, tipo: 'ingreso', cantidad: '100', motivo: 'Inventario inicial' } });
await api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: LECHE.id, deposito_id: DEP, tipo: 'ingreso', cantidad: '30', motivo: 'Inventario inicial' } });

// --- atajos
const pedido = (cuerpo) => api('admin', 'POST', '/api/ventas/pedidos', { cuerpo });
const verP = async (id) => (await api('admin', 'GET', `/api/ventas/pedidos/${id}`)).cuerpo;
const remito = (cuerpo) => api('admin', 'POST', '/api/ventas/remitos', { cuerpo });
const factura = (cuerpo, tercero = C1.id) => api('admin', 'POST', '/api/ventas/facturas', { cuerpo: { tercero_id: tercero, fecha: hoy, ...cuerpo } });
const anularF = (id) => api('admin', 'POST', `/api/comprobantes/${id}/anular`, { cuerpo: { motivo: 'Error de carga' } });
const anularR = (id) => api('admin', 'POST', `/api/ventas/remitos/${id}/anular`, { cuerpo: { motivo: 'Se entregó por error' } });
const anularP = (id) => api('admin', 'POST', `/api/ventas/pedidos/${id}/anular`, { cuerpo: { motivo: 'El cliente canceló' } });
const pendientes = async (cliente = C1.id, empresa = RI) => (await api('admin', 'GET', `/api/ventas/pedidos/pendientes-facturar?tercero_id=${cliente}`, { empresa })).cuerpo.datos;
const P1 = (await pedido({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '10' }, { articulo_id: SERV.id, cantidad: '1' }], confirmar: true })).cuerpo;
if (!P1?.id) throw new Error('pedido de partida: ' + JSON.stringify(P1));
const [itPan, itServ] = P1.items.map((i) => i.id);

// ---------------------------------------------------------------------------
await prueba('Lo que se puede facturar sin remito: renglones de pedidos confirmados con lo que falta entregar, por cliente', async () => {
  const p = await pendientes(); igual(p.map((x) => [x.pedido_numero, x.descripcion, Number(x.pedido), Number(x.entregado), Number(x.facturable), Number(x.precio)]), [[P1.numero_formateado, 'Pan lactal', 10, 0, 10, 100], [P1.numero_formateado, 'Servicio de entrega', 1, 0, 1, 1000]], JSON.stringify(p));
  igual((await pendientes(C2.id)).length, 0, 'otro cliente: nada'); igual((await pendientes(C1.id, MT)).length, 0, 'otra empresa: nada'); igual((await api('admin', 'GET', '/api/ventas/pedidos/pendientes-facturar')).estado, 422, 'pide el cliente');
  const b = (await pedido({ tercero_id: C1.id, items: [{ articulo_id: LECHE.id, cantidad: '1' }] })).cuerpo; igual((await pendientes()).length, 2, 'un borrador no cuenta'); await api('admin', 'DELETE', `/api/ventas/pedidos/${b.id}`);
});
await prueba('Facturar directo contra un pedido: la factura toma el precio y ENTREGA (descuenta el stock); el pedido refleja lo entregado y lo facturado', async () => {
  const stock = await stockDe(PAN.id), saldo = Number(await saldoCli(C1.id));
  const previa = await api('admin', 'POST', '/api/ventas/facturas/calcular', { cuerpo: { tercero_id: C1.id, fecha: hoy, items: [{ documento_item_id: itPan, cantidad: '4' }] } });
  igual([previa.estado, previa.cuerpo.items[0].del_pedido, previa.cuerpo.items[0].del_remito, Number(previa.cuerpo.items[0].precio_unitario), Number(previa.cuerpo.imp_total)], [200, true, false, 100, 442], JSON.stringify(previa.cuerpo)); verdad(previa.cuerpo.avisos.some((a) => /sin remito sale del depósito con esta factura/.test(a)), 'avisa que entrega: ' + previa.cuerpo.avisos);
  const r = await factura({ items: [{ documento_item_id: itPan, cantidad: '4' }] }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.F1 = r.cuerpo.id;
  igual(await stockDe(PAN.id), stock - 4, 'descuenta 4 del stock'); igual(Number(await saldoCli(C1.id)) - saldo, 442, 'el cliente debe 442');
  const mov = (await api('admin', 'GET', `/api/stock/movimientos?articulo_id=${PAN.id}&limite=1`)).cuerpo.datos[0]; igual([mov.tipo, Number(mov.cantidad)], ['venta', -4], JSON.stringify(mov));
  igual((await uno('select documento_item_id from comprobante_item where comprobante_id = $1', [ids.F1])).documento_item_id, itPan, 'el renglón queda vinculado');
  const p = await verP(P1.id); igual([p.items.map((i) => [Number(i.remitado), Number(i.facturado), Number(i.pendiente)]), p.facturas.map((f) => [f.tipo, f.numero_formateado]), p.pendiente_de_remitir], [[[4, 4, 6], [0, 0, 1]], [['Factura A', r.cuerpo.numero_formateado]], true], JSON.stringify(p.items));
  igual((await pendientes()).map((x) => [x.descripcion, Number(x.facturable)]), [['Pan lactal', 6], ['Servicio de entrega', 1]], 'quedan 6 de pan');
  const serv = await factura({ items: [{ documento_item_id: itServ, cantidad: '1' }] }); igual(serv.estado, 201, JSON.stringify(serv.cuerpo)); ids.F2 = serv.cuerpo.id; igual(await stockDe(PAN.id), stock - 4, 'un servicio no mueve stock');
});
await prueba('El remito contra el pedido descuenta lo ya facturado directo; el total entregado (remitos + facturas) nunca supera lo pedido', async () => {
  const mal = await remito({ pedido_id: P1.id, items: [{ item_origen_id: itPan, cantidad: '7' }] }); igual([mal.estado, campoF(mal, 'items[0].cantidad')], [422, 'solo falta entregar 6'], JSON.stringify(mal.cuerpo));
  const stock = await stockDe(PAN.id); const r = await remito({ pedido_id: P1.id, items: [{ item_origen_id: itPan, cantidad: '6' }], confirmar: true }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.R1 = r.cuerpo.id; igual(await stockDe(PAN.id), stock - 6, 'el remito entrega los 6 restantes');
  const p = await verP(P1.id); igual([p.items[0].pendiente, Number(p.items[0].remitado), Number(p.items[0].facturado)], ['0.0000', 10, 4], JSON.stringify(p.items[0])); igual(Number(p.items[1].pendiente), 0, 'el servicio también');
  const mas = await factura({ items: [{ documento_item_id: itPan, cantidad: '1' }] }); igual([mas.estado, campoF(mas, 'items[0].cantidad')], [422, 'ese renglón del pedido ya se entregó o facturó por completo'], JSON.stringify(mas.cuerpo));
  igual((await pendientes()).length, 0, 'no queda nada por facturar sin remito'); igual((await api('admin', 'GET', '/api/ventas/pedidos?pendiente=true')).cuerpo.datos.some((x) => x.id === P1.id), false, 'el pedido ya no falta entregar');
  const f = await factura({ items: [{ documento_item_id: r.cuerpo.items[0].id, cantidad: '6' }] }); igual(f.estado, 201, JSON.stringify(f.cuerpo)); ids.F3 = f.cuerpo.id; igual(await stockDe(PAN.id), stock - 6, 'facturar el remito no vuelve a descontar');
  igual((await verP(P1.id)).items[0].facturado.replace(/\.0+$/, ''), '10', 'el pedido figura facturado por completo (4 directo + 6 por el remito)');
});
await prueba('Validaciones: del mismo cliente, pedido confirmado, sin repetir, mismo artículo y con stock suficiente', async () => {
  const P2 = (await pedido({ tercero_id: C1.id, items: [{ articulo_id: LECHE.id, cantidad: '40' }, { articulo_id: PAN.id, cantidad: '3' }], confirmar: true })).cuerpo; const [itLeche, itPan2] = P2.items.map((i) => i.id);
  igual(campoF(await factura({ items: [{ documento_item_id: itPan2, cantidad: '1' }] }, C2.id), 'items[0].documento_item_id'), 'el pedido es de otro cliente', 'otro cliente');
  const b = (await pedido({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '2' }] })).cuerpo; igual(campoF(await factura({ items: [{ documento_item_id: b.items[0].id, cantidad: '1' }] }), 'items[0].documento_item_id'), 'el pedido no está confirmado', 'borrador'); await api('admin', 'DELETE', `/api/ventas/pedidos/${b.id}`);
  const x = (await pedido({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '2' }], confirmar: true })).cuerpo; await anularP(x.id); igual(campoF(await factura({ items: [{ documento_item_id: x.items[0].id, cantidad: '1' }] }), 'items[0].documento_item_id'), 'el pedido está anulado', 'anulado');
  igual(campoF(await factura({ items: [{ documento_item_id: itPan2, articulo_id: LECHE.id, cantidad: '1' }] }), 'items[0].articulo_id'), 'no es el artículo del pedido', 'otro artículo');
  igual(campoF(await factura({ items: [{ documento_item_id: itPan2, cantidad: '1' }, { documento_item_id: itPan2, cantidad: '1' }] }), 'items[1].documento_item_id'), 'ese renglón del pedido está repetido', 'repetido');
  const sobra = await factura({ items: [{ documento_item_id: itPan2, cantidad: '4' }] }); igual(campoF(sobra, 'items[0].cantidad'), 'del pedido solo se pueden facturar 3 sin remito (se pidieron 3, ya se entregaron 0 con remitos y se facturaron 0)', JSON.stringify(sobra.cuerpo));
  const falta = await factura({ items: [{ documento_item_id: itLeche, cantidad: '40' }] }); igual([falta.estado, falta.cuerpo.error.codigo], [422, 'stock_insuficiente'], 'sin stock no se entrega: ' + JSON.stringify(falta.cuerpo)); igual(await stockDe(LECHE.id), 30, 'no se movió nada');
  const ok = await factura({ items: [{ documento_item_id: itLeche, cantidad: '30' }] }); igual(ok.estado, 201, JSON.stringify(ok.cuerpo)); ids.F4 = ok.cuerpo.id; igual(await stockDe(LECHE.id), 0, 'sale todo el stock'); ids.P2 = P2.id; ids.itLeche = itLeche; ids.itPan2 = itPan2;
});
await prueba('Anulaciones: el pedido con facturas directas no se anula; anular la factura devuelve el stock y lo pendiente al pedido', async () => {
  const bloqueo = await anularP(P1.id); igual([bloqueo.estado, bloqueo.cuerpo.error.mensaje], [422, 'El pedido ya tiene remitos de salida: anulá primero esos remitos.'], JSON.stringify(bloqueo.cuerpo));
  const soloFactura = await anularP(ids.P2); igual([soloFactura.estado, soloFactura.cuerpo.error.mensaje], [422, 'El pedido ya tiene facturas hechas contra él: anulá primero esas facturas.'], 'una factura directa también lo bloquea: ' + JSON.stringify(soloFactura.cuerpo));
  const stock = await stockDe(PAN.id); igual(Number((await verP(ids.P2)).items[0].pendiente), 10, 'a la leche le faltan 10 (se facturaron 30 de 40)');
  igual((await anularF(ids.F4)).estado, 200, 'anula la factura de leche'); igual(await stockDe(LECHE.id), 30, 'vuelve la mercadería');
  const q = await verP(ids.P2); igual([Number(q.items[0].pendiente), q.facturas.length], [40, 0], 'el pedido recupera lo pendiente: ' + JSON.stringify(q.items[0]));
  igual((await anularF(ids.F1)).estado, 200, 'anula la factura directa del pan'); igual(await stockDe(PAN.id), stock + 4, 'vuelven 4 al depósito'); igual((await anularF(ids.F2)).estado, 200, 'y la del servicio'); igual((await anularF(ids.F3)).estado, 200, 'y la del remito');
  igual((await anularR(ids.R1)).estado, 200, 'anula el remito'); igual(await stockDe(PAN.id), stock + 4 + 6, 'vuelve todo'); const pf = await verP(P1.id); igual([pf.items.map((i) => Number(i.pendiente)), pf.facturas.length], [[10, 1], 0], 'el pedido vuelve a estar pendiente');
  igual((await anularP(P1.id)).estado, 200, 'ahora sí se anula el pedido');
});
await prueba('La base impide entregar de más aunque se salteen las validaciones: facturas contra el pedido y remitos que se confirman después', async () => {
  const P3 = (await pedido({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '10' }], confirmar: true })).cuerpo; const it = P3.items[0].id;
  const rb = (await remito({ pedido_id: P3.id, items: [{ item_origen_id: it, cantidad: '6' }] })).cuerpo; const f = await factura({ items: [{ documento_item_id: it, cantidad: '6' }] }); igual(f.estado, 201, JSON.stringify(f.cuerpo)); ids.F5 = f.cuerpo.id;
  const msg = async (sql) => { try { await q(sql); return ''; } catch (e) { return e.message; } };
  const m1 = await msg(`update documento_comercial set estado = 'confirmado' where id = ${rb.id}`); verdad(/se remite 12(.0+)? y el documento de origen solo pide 10/.test(m1), 'el remito que ya no cabe no se confirma: ' + m1); igual((await api('admin', 'GET', `/api/ventas/remitos/${rb.id}`)).cuerpo.estado, 'borrador', 'queda borrador');
  await api('admin', 'DELETE', `/api/ventas/remitos/${rb.id}`);
  const r2 = (await remito({ pedido_id: P3.id, items: [{ item_origen_id: it, cantidad: '4' }], confirmar: true })).cuerpo; igual(r2.estado, 'confirmado', 'los 4 que faltan sí');
  const m2 = await msg(`do $$ begin perform set_config('app.migracion', 'on', true); update comprobante_item set cantidad = 9 where comprobante_id = ${ids.F5}; perform fn_verificar_factura_remito(${ids.F5}); end $$`); verdad(/se entrega 13(.0+)? \(remitos y facturas\) de un renglón de pedido donde se pidió 10/.test(m2), 'la factura que ya no cabe: ' + m2);
  const m3 = await msg(`do $$ begin perform set_config('app.migracion', 'on', true); update comprobante set tercero_id = ${C2.id} where id = ${ids.F5}; perform fn_verificar_factura_remito(${ids.F5}); end $$`); verdad(/no es un remito de salida confirmado del mismo cliente/.test(m3), 'otro cliente: ' + m3);
});
await prueba('Nota de crédito sobre una factura directa contra el pedido: devuelve la mercadería que la propia factura entregó', async () => {
  const P4 = (await pedido({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '5' }], confirmar: true })).cuerpo; const stock = await stockDe(PAN.id);
  const f = await factura({ items: [{ documento_item_id: P4.items[0].id, cantidad: '5' }] }); igual(f.estado, 201, JSON.stringify(f.cuerpo)); igual(await stockDe(PAN.id), stock - 5, 'la factura entrega');
  const n = await api('admin', 'POST', '/api/ventas/notas-credito', { cuerpo: { comprobante_origen_id: f.cuerpo.id, motivo: 'Devolución del cliente' } }); igual(n.estado, 201, JSON.stringify(n.cuerpo)); igual(await stockDe(PAN.id), stock, 'vuelven los 5 al depósito');
});
await prueba('Trazabilidad: la cadena sigue íntegra', async () => {
  for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena ${e}`);
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
