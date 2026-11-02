// Pruebas de la factura de compra directo contra una orden de compra (sin remito): la factura es la recepción (ingresa el stock y actualiza el costo), la orden refleja lo recibido y facturado,
// el remito de entrada descuenta lo ya facturado, el tope total (remitos + facturas), las defensas de la base y las anulaciones. Con --pg pasan por el adaptador de producción.
// Uso:  node api/probar_factura_orden.mjs [--pg]
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
const cargar = (cuerpo, o = {}) => api(o.quien ?? 'admin', 'POST', '/api/compras/facturas', { cuerpo, empresa: o.empresa });
const calcular = (cuerpo, o = {}) => api('admin', 'POST', '/api/compras/facturas/calcular', { cuerpo, empresa: o.empresa });
const anular = (id, motivo = 'Se cargó dos veces por error', o = {}) => api(o.quien ?? 'admin', 'POST', `/api/compras/facturas/${id}/anular`, { cuerpo: motivo === null ? {} : { motivo }, empresa: o.empresa });
const detalle = async (id, empresa = RI) => (await api('admin', 'GET', `/api/compras/facturas/${id}`, { empresa })).cuerpo;
const ultimoEvento = (patron) => uno(`select usuario_id, empresa_id, categoria, accion, detalle from evento where accion like $1 order by id desc limit 1`, [patron]);
const stockDe = async (articuloId, dep = DEP) => Number((await uno('select coalesce(sum(cantidad), 0)::text s from movimiento_stock where articulo_id = $1 and deposito_id = $2', [articuloId, dep])).s);
const costoDe = async (articuloId) => (await api('admin', 'GET', `/api/articulos/${articuloId}`)).cuerpo.costo;
const saldoProv = async (id, empresa = RI) => (await api('admin', 'GET', `/api/proveedores/${id}`, { empresa })).cuerpo.saldo;
const lineas = async (asientoId) => (await q(`select c.codigo, l.debe::text d, l.haber::text h from asiento_linea l join plan_cuenta c on c.id = l.cuenta_id where l.asiento_id = $1 order by c.codigo`, [asientoId])).map((l) => `${l.codigo} ${Number(l.d) > 0 ? 'D ' + Number(l.d) : 'H ' + Number(l.h)}`);
const neteo = async (asientoId) => (await q(`select c.codigo from asiento_linea l join plan_cuenta c on c.id = l.cuenta_id where l.asiento_id in ($1, (select id from asiento where origen_tipo = 'contraasiento' and origen_id = $1)) group by c.codigo having sum(l.debe - l.haber) <> 0`, [asientoId]));

const prov = async (doc, nombre, tipo = 'CUIT', empresa = RI) => { const r = await api('admin', 'POST', '/api/proveedores', { empresa, cuerpo: { tipo_documento: tipo, nro_documento: doc, razon_social: nombre, condicion_iva_codigo: tipo === 'CUIL' ? 5 : 1 } }); if (r.estado !== 201) throw new Error(`proveedor ${nombre}: ${JSON.stringify(r.cuerpo)}`); return r.cuerpo; };
const art = async (codigo, nombre, extra = {}, empresa = RI) => { const r = await api('admin', 'POST', '/api/articulos', { empresa, cuerpo: { codigo, nombre, ...extra } }); if (r.estado !== 201) throw new Error(`${codigo}: ${JSON.stringify(r.cuerpo)}`); return r.cuerpo; };

const P1 = await prov(cuitConDigito('3070811222'), 'Molinos del Sur SA'), P2 = await prov(cuitConDigito('3071000000'), 'Transportes Rápidos SRL');
const PAN = await art('PAN', 'Harina 000 x 25 kg'), LECHE = await art('LECHE', 'Leche en polvo');
let nro = 1000;
const compra = (items, extra = {}) => {                                           // la factura trae el total del papel: neto + 21 % de IVA
  const neto = items.reduce((s, x) => s + Number(x.cantidad) * Number(x.precio_unitario), 0);
  return cargar({ tercero_id: P1.id, letra: 'A', punto_venta: 4, numero: ++nro, fecha: hoy, total: (neto * 1.21).toFixed(2), items, ...extra });
};
const orden = (cuerpo) => api('admin', 'POST', '/api/compras/ordenes', { cuerpo: { tercero_id: P1.id, fecha: hoy, confirmar: true, ...cuerpo } });
const verO = async (id) => (await api('admin', 'GET', `/api/compras/ordenes/${id}`)).cuerpo;
const remito = (cuerpo) => api('admin', 'POST', '/api/compras/remitos', { cuerpo });
const anularO = (id) => api('admin', 'POST', `/api/compras/ordenes/${id}/anular`, { cuerpo: { motivo: 'Se canceló el pedido' } });
const anularR = (id) => api('admin', 'POST', `/api/compras/remitos/${id}/anular`, { cuerpo: { motivo: 'Llegó de más' } });
const pendientes = async (prov_ = P1.id, empresa = RI) => (await api('admin', 'GET', `/api/compras/ordenes/pendientes-facturar?tercero_id=${prov_}`, { empresa })).cuerpo.datos;
const campoF = (r, k) => r.cuerpo?.error?.campos?.[k];
const O1 = (await orden({ items: [{ articulo_id: PAN.id, cantidad: '10', precio_unitario: '100' }, { descripcion: 'Flete a depósito', cantidad: '1', precio_unitario: '500' }] })).cuerpo;
if (!O1?.id) throw new Error('orden de partida: ' + JSON.stringify(O1));
const [itPan, itFlete] = O1.items.map((i) => i.id);

// ---------------------------------------------------------------------------
await prueba('Lo que se puede facturar sin remito: renglones de órdenes emitidas con lo que falta recibir, por proveedor; los borradores no cuentan', async () => {
  const p = await pendientes(); igual(p.map((x) => [x.orden_numero, x.descripcion, Number(x.pedido), Number(x.recibido), Number(x.facturable), Number(x.precio)]), [[O1.numero_formateado, 'Harina 000 x 25 kg', 10, 0, 10, 100], [O1.numero_formateado, 'Flete a depósito', 1, 0, 1, 500]], JSON.stringify(p));
  igual((await pendientes(P2.id)).length, 0, 'otro proveedor: nada'); igual((await pendientes(P1.id, MT)).length, 0, 'otra empresa: nada'); igual((await api('admin', 'GET', '/api/compras/ordenes/pendientes-facturar')).estado, 422, 'pide el proveedor');
  const b = (await orden({ confirmar: false, items: [{ articulo_id: PAN.id, cantidad: '1', precio_unitario: '1' }] })).cuerpo; igual((await pendientes()).length, 2, 'un borrador no cuenta'); await api('admin', 'DELETE', `/api/compras/ordenes/${b.id}`);
});
await prueba('Facturar directo contra una orden: la factura es la RECEPCIÓN (ingresa el stock y actualiza el costo) y genera la deuda; la orden refleja lo recibido y lo facturado', async () => {
  const stock = await stockDe(PAN.id), saldo = Number(await saldoProv(P1.id));
  const items = [{ documento_item_id: itPan, cantidad: '4', precio_unitario: '110' }];
  const previa = await calcular({ tercero_id: P1.id, letra: 'A', punto_venta: 4, numero: 900, fecha: hoy, total: '532.40', items });
  igual([previa.estado, previa.cuerpo.items[0].ingresa_stock, previa.cuerpo.items[0].remito, previa.cuerpo.coincide], [200, true, `Orden ${O1.numero_formateado}`, true], JSON.stringify(previa.cuerpo)); verdad(previa.cuerpo.avisos.some((a) => /sin remito ingresa al stock con esta factura/.test(a)), 'avisa que recibe: ' + previa.cuerpo.avisos);
  const r = await compra(items); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.F1 = r.cuerpo.id;
  igual(await stockDe(PAN.id), stock + 4, 'ingresa 4 al stock'); igual(Number(await costoDe(PAN.id)), 110, 'el costo es el de la factura'); igual(Number(await saldoProv(P1.id)) - saldo, 532.4, 'la deuda sube 532,40');
  const mov = (await api('admin', 'GET', `/api/stock/movimientos?articulo_id=${PAN.id}&limite=1`)).cuerpo.datos[0]; igual([mov.tipo, Number(mov.cantidad)], ['compra', 4], JSON.stringify(mov));
  igual((await uno('select documento_item_id from comprobante_item where comprobante_id = $1', [ids.F1])).documento_item_id, itPan, 'el renglón queda vinculado');
  const o = await verO(O1.id); igual([o.items.map((i) => [Number(i.recibido), Number(i.facturado), Number(i.pendiente)]), o.facturas.map((f) => f.numero_formateado.length > 0), o.pendiente_de_recibir], [[[4, 4, 6], [0, 0, 1]], [true], true], JSON.stringify(o.items));
  igual((await pendientes()).map((x) => [x.descripcion, Number(x.facturable)]), [['Harina 000 x 25 kg', 6], ['Flete a depósito', 1]], 'quedan 6 de harina');
  const fl = await compra([{ documento_item_id: itFlete, cantidad: '1', precio_unitario: '500' }]); igual(fl.estado, 201, JSON.stringify(fl.cuerpo)); ids.F2 = fl.cuerpo.id; igual(await stockDe(PAN.id), stock + 4, 'un flete (sin artículo) no mueve stock');
});
await prueba('El remito de entrada contra la orden descuenta lo ya facturado directo; lo recibido (remitos + facturas) nunca supera lo pedido', async () => {
  const mal = await remito({ orden_id: O1.id, items: [{ item_origen_id: itPan, cantidad: '7' }] }); igual([mal.estado, campoF(mal, 'items[0].cantidad')], [422, 'solo faltan recibir 6'], JSON.stringify(mal.cuerpo));
  const stock = await stockDe(PAN.id); const r = await remito({ orden_id: O1.id, items: [{ item_origen_id: itPan, cantidad: '6' }], confirmar: true }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.R1 = r.cuerpo.id; igual(await stockDe(PAN.id), stock + 6, 'el remito recibe los 6 que faltaban');
  const o = await verO(O1.id); igual([Number(o.items[0].pendiente), Number(o.items[0].recibido), Number(o.items[0].facturado)], [0, 10, 4], JSON.stringify(o.items[0]));
  const mas = await compra([{ documento_item_id: itPan, cantidad: '1', precio_unitario: '100' }]); igual([mas.estado, campoF(mas, 'items[0].cantidad')], [422, 'ese renglón de la orden ya se recibió o facturó por completo'], JSON.stringify(mas.cuerpo));
  igual((await pendientes()).length, 0, 'no queda nada por facturar sin remito'); igual((await api('admin', 'GET', '/api/compras/ordenes?pendiente=true')).cuerpo.datos.some((x) => x.id === O1.id), false, 'la orden ya no falta recibir');
  const f = await compra([{ documento_item_id: r.cuerpo.items[0].id, cantidad: '6', precio_unitario: '100' }]); igual(f.estado, 201, JSON.stringify(f.cuerpo)); ids.F3 = f.cuerpo.id; igual(await stockDe(PAN.id), stock + 6, 'facturar el remito no vuelve a ingresar');
  igual(Number((await verO(O1.id)).items[0].facturado), 10, 'la orden figura facturada por completo (4 directo + 6 por el remito)');
});
await prueba('Validaciones: del mismo proveedor, orden emitida, sin repetir, mismo artículo, y cantidad dentro de lo pedido', async () => {
  const O2 = (await orden({ items: [{ articulo_id: LECHE.id, cantidad: '5', precio_unitario: '200' }, { articulo_id: PAN.id, cantidad: '3', precio_unitario: '100' }] })).cuerpo; const [itLeche, itPan2] = O2.items.map((i) => i.id);
  igual(campoF(await compra([{ documento_item_id: itLeche, cantidad: '1', precio_unitario: '200' }], { tercero_id: P2.id }), 'items[0].documento_item_id'), 'la orden es de otro proveedor', 'otro proveedor');
  const b = (await orden({ confirmar: false, items: [{ articulo_id: PAN.id, cantidad: '2', precio_unitario: '100' }] })).cuerpo; igual(campoF(await compra([{ documento_item_id: b.items[0].id, cantidad: '1', precio_unitario: '100' }]), 'items[0].documento_item_id'), 'la orden no está emitida', 'borrador'); await api('admin', 'DELETE', `/api/compras/ordenes/${b.id}`);
  const x = (await orden({ items: [{ articulo_id: PAN.id, cantidad: '2', precio_unitario: '100' }] })).cuerpo; await anularO(x.id); igual(campoF(await compra([{ documento_item_id: x.items[0].id, cantidad: '1', precio_unitario: '100' }]), 'items[0].documento_item_id'), 'la orden está anulada', 'anulada');
  igual(campoF(await compra([{ documento_item_id: itLeche, articulo_id: PAN.id, cantidad: '1', precio_unitario: '200' }]), 'items[0].articulo_id'), 'no es el artículo de la orden', 'otro artículo');
  igual(campoF(await compra([{ documento_item_id: itLeche, cantidad: '1', precio_unitario: '200' }, { documento_item_id: itLeche, cantidad: '1', precio_unitario: '200' }]), 'items[1].documento_item_id'), 'ese renglón de la orden está repetido', 'repetido');
  const sobra = await compra([{ documento_item_id: itLeche, cantidad: '6', precio_unitario: '200' }]); igual(campoF(sobra, 'items[0].cantidad'), 'de la orden solo se pueden facturar 5 sin remito (se pidieron 5, ya se recibieron 0 con remitos y se facturaron 0)', JSON.stringify(sobra.cuerpo));
  const ok = await compra([{ documento_item_id: itLeche, cantidad: '5', precio_unitario: '200' }]); igual(ok.estado, 201, JSON.stringify(ok.cuerpo)); ids.F4 = ok.cuerpo.id; igual(await stockDe(LECHE.id), 5, 'ingresó toda la leche'); ids.O2 = O2.id; ids.itPan2 = itPan2;
  const dep = await compra([{ documento_item_id: itPan2, cantidad: '1', precio_unitario: '100', deposito_id: 999999 }]); igual(campoF(dep, 'items[0].deposito_id'), 'el depósito no existe o está dado de baja', 'depósito inexistente');
});
await prueba('Anulaciones: la orden con facturas directas no se anula; anular la factura saca el stock y devuelve lo pendiente a la orden', async () => {
  const soloFactura = await anularO(ids.O2); igual([soloFactura.estado, soloFactura.cuerpo.error.mensaje], [422, 'La orden ya tiene facturas cargadas: anulá primero esas facturas.'], JSON.stringify(soloFactura.cuerpo));
  const conRemito = await anularO(O1.id); igual([conRemito.estado, conRemito.cuerpo.error.mensaje], [422, 'La orden ya tiene remitos de entrada: anulá primero esos remitos.'], JSON.stringify(conRemito.cuerpo));
  igual(Number((await verO(ids.O2)).items[0].pendiente), 0, 'a la leche no le falta nada');
  igual((await anular(ids.F4)).estado, 200, 'anula la factura de leche'); igual([await stockDe(LECHE.id), Number((await verO(ids.O2)).items[0].pendiente)], [0, 5], 'sale el stock y la orden vuelve a faltar 5');
  const stock = await stockDe(PAN.id); igual((await anular(ids.F1)).estado, 200, 'anula la factura directa de harina'); igual(await stockDe(PAN.id), stock - 4, 'salen 4 del stock'); igual((await anular(ids.F2)).estado, 200, 'y la del flete'); igual((await anular(ids.F3)).estado, 200, 'y la del remito');
  igual((await anularR(ids.R1)).estado, 200, 'anula el remito'); const o = await verO(O1.id); igual([o.items.map((i) => Number(i.pendiente)), o.facturas.length], [[10, 1], 0], 'la orden vuelve a estar pendiente');
  igual((await anularO(O1.id)).estado, 200, 'ahora sí se anula la orden');
});
await prueba('La base impide recibir de más aunque se salteen las validaciones: facturas contra la orden y remitos que se confirman después', async () => {
  const O3 = (await orden({ items: [{ articulo_id: PAN.id, cantidad: '10', precio_unitario: '100' }] })).cuerpo; const it = O3.items[0].id;
  const rb = (await remito({ orden_id: O3.id, items: [{ item_origen_id: it, cantidad: '6' }] })).cuerpo; const f = await compra([{ documento_item_id: it, cantidad: '6', precio_unitario: '100' }]); igual(f.estado, 201, JSON.stringify(f.cuerpo)); ids.F5 = f.cuerpo.id;
  const msg = async (sql) => { try { await q(sql); return ''; } catch (e) { return e.message; } };
  const m1 = await msg(`update documento_comercial set estado = 'confirmado' where id = ${rb.id}`); verdad(/se remite 12(.0+)? y el documento de origen solo pide 10/.test(m1), 'el remito que ya no cabe no se confirma: ' + m1); igual((await api('admin', 'GET', `/api/compras/remitos/${rb.id}`)).cuerpo.estado, 'borrador', 'queda borrador');
  await api('admin', 'DELETE', `/api/compras/remitos/${rb.id}`);
  const r2 = (await remito({ orden_id: O3.id, items: [{ item_origen_id: it, cantidad: '4' }], confirmar: true })).cuerpo; igual(r2.estado, 'confirmado', 'los 4 que faltan sí');
  const m2 = await msg(`do $$ begin perform set_config('app.migracion', 'on', true); update comprobante_item set cantidad = 9 where comprobante_id = ${ids.F5}; perform fn_verificar_factura_remito(${ids.F5}); end $$`); verdad(/se recibe 13(.0+)? \(remitos y facturas\) de un renglón de orden donde se pidió 10/.test(m2), 'la factura que ya no cabe: ' + m2);
  const m3 = await msg(`do $$ begin perform set_config('app.migracion', 'on', true); update comprobante set tercero_id = ${P2.id} where id = ${ids.F5}; perform fn_verificar_factura_remito(${ids.F5}); end $$`); verdad(/no es un remito de entrada confirmado del mismo proveedor/.test(m3), 'otro proveedor: ' + m3);
});
await prueba('Trazabilidad: la cadena sigue íntegra', async () => {
  for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena ${e}`);
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
