// Pruebas de remitos de entrada: contra una orden de compra (parcial, completo, sobre-entrega) o sueltos, borrador y confirmación, stock que entra y vuelve a salir al anular,
// número del proveedor, cumplimiento de la orden y aislamiento. Con --pg pasan por el adaptador de producción.
// Uso:  node api/probar_remitos_compra.mjs [--pg]
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
const P1 = await prov(cuitConDigito('3070811222'), 'Molinos del Sur SA'), P2 = await prov(cuitConDigito('3071000000'), 'Transportes Rápidos SRL'), P3 = await prov(cuitConDigito('2027333444'), 'Persona Física (CUIL)', 'CUIL');
const PAN = await art('PAN', 'Harina 000 x 25 kg'), FLETE = await art('FLETE', 'Flete', { tipo: 'gasto', alicuota_compra: '10.5' });
const rCli = await api('admin', 'POST', '/api/clientes', { cuerpo: { tipo_documento: 'DNI', nro_documento: '27345118', razon_social: 'Marta Gómez', condicion_iva_codigo: 5 } }); if (rCli.estado !== 201) throw new Error('cliente: ' + JSON.stringify(rCli.cuerpo)); const CLI = rCli.cuerpo;
const base = (extra = {}) => ({ tercero_id: P1.id, letra: 'A', punto_venta: 4, numero: 1234, fecha: hoy, total: '1812.50',
  items: [{ articulo_id: PAN.id, cantidad: '10', precio_unitario: '100' }, { articulo_id: FLETE.id, cantidad: '1', precio_unitario: '500' }], tributos: [{ tipo: 'percepcion_iibb', jurisdiccion_codigo: 902, importe: '50' }], ...extra });

// --- atajos
const remito = (cuerpo, o = {}) => api(o.quien ?? 'admin', 'POST', '/api/compras/remitos', { cuerpo, empresa: o.empresa });
const calcR = (cuerpo) => api('admin', 'POST', '/api/compras/remitos/calcular', { cuerpo });
const verR = (id, empresa = RI) => api('admin', 'GET', `/api/compras/remitos/${id}`, { empresa });
const verO = async (id) => (await api('admin', 'GET', `/api/compras/ordenes/${id}`)).cuerpo;
const campoR = (r, k) => r.cuerpo?.error?.campos?.[k];
const cuenta = async (tabla) => (await uno(`select count(*)::int n from ${tabla}`)).n;
const hace = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const OC = (await api('admin', 'POST', '/api/compras/ordenes', { cuerpo: { tercero_id: P1.id, fecha: hoy, items: [{ articulo_id: PAN.id, cantidad: '10', precio_unitario: '100' }, { descripcion: 'Flete a destino', cantidad: '1', precio_unitario: '500' }], confirmar: true } })).cuerpo;
if (!OC?.id) throw new Error('orden de partida: ' + JSON.stringify(OC));
const [itPan, itFlete] = OC.items;

// ---------------------------------------------------------------------------
await prueba('Permisos: ver los remitos lo hacen todos; cargarlos, compras.cargar; anularlos, compras.anular', async () => {
  igual((await api('consulta', 'GET', '/api/compras/remitos')).estado, 200, 'la consulta mira');
  for (const quien of ['auxiliar', 'consulta']) {
    igual((await remito({ orden_id: OC.id, items: [{ item_origen_id: itPan.id, cantidad: '1' }], confirmar: true }, { quien })).estado, 403, `${quien} no carga`);
    for (const [m, r] of [['POST', '/api/compras/remitos/calcular'], ['PUT', '/api/compras/remitos/1'], ['POST', '/api/compras/remitos/1/confirmar'], ['DELETE', '/api/compras/remitos/1'], ['POST', '/api/compras/remitos/1/anular']]) igual((await api(quien, m, r, { cuerpo: {} })).estado, 403, `${quien}: ${m} ${r}`);
  }
});
await prueba('Recibir una parte de la orden: entra al stock a su precio, la orden muestra lo recibido y lo que falta, y no hay deuda ni asiento', async () => {
  const asientos = await cuenta('asiento'), comprobantes = await cuenta('comprobante'), saldo = await saldoProv(P1.id);
  const previa = await calcR({ orden_id: OC.id, items: [{ item_origen_id: itPan.id, cantidad: '4' }] }); igual(previa.estado, 200, JSON.stringify(previa.cuerpo)); igual([previa.cuerpo.total, previa.cuerpo.items[0].mueve_stock], ['400.00', true], 'previa'); verdad(previa.cuerpo.avisos.some((a) => /Quedan 1 renglón de la orden sin recibir/.test(a)), JSON.stringify(previa.cuerpo.avisos));
  const r = await remito({ orden_id: OC.id, numero_externo: '0003-00004512', fecha: hoy, items: [{ item_origen_id: itPan.id, cantidad: '4' }], observaciones: 'Llegó en pallets', confirmar: true }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); const x = r.cuerpo; ids.rem1 = x.id;
  igual([x.numero_formateado, x.estado, x.numero_externo, x.proveedor, x.total, x.orden.numero_formateado, x.items[0].mueve_stock, x.items[0].deposito_id], ['0001-00000001', 'confirmado', '0003-00004512', 'Molinos del Sur SA', '400.00', OC.numero_formateado, true, DEP], JSON.stringify(x));
  igual(await stockDe(PAN.id), 4, 'entraron 4'); const mv = await uno(`select tipo, cantidad::text c, costo_unitario::text k from movimiento_stock where documento_item_id = $1`, [x.items[0].id]); igual([mv.tipo, Number(mv.c), Number(mv.k)], ['compra', 4, 100], 'movimiento a costo 100');
  const o = await verO(OC.id), pan = o.items.find((i) => i.articulo_id === PAN.id); igual([pan.recibido, pan.pendiente, o.pendiente_de_recibir, o.remitos.map((m) => [m.numero_formateado, m.numero_externo, m.estado])], ['4.0000', '6.0000', true, [['0001-00000001', '0003-00004512', 'confirmado']]], JSON.stringify(o.remitos));
  igual([await cuenta('asiento'), await cuenta('comprobante'), await saldoProv(P1.id)], [asientos, comprobantes, saldo], 'ni asiento, ni factura, ni deuda');
  const e = await ultimoEvento('Recibió mercadería con el remito%'); igual([e.accion, e.categoria], ['Recibió mercadería con el remito 0001-00000001', 'stock'], 'rastro');
  igual((await api('admin', 'GET', `/api/compras/ordenes?pendiente=true`)).cuerpo.datos.map((m) => m.id), [OC.id], 'la orden sigue en pendientes');
});
await prueba('Completar la orden: el segundo remito (con el servicio) cierra lo pendiente y los servicios no tocan el stock', async () => {
  const r = await remito({ orden_id: OC.id, numero_externo: '0003-00004530', items: [{ item_origen_id: itPan.id, cantidad: '6' }, { item_origen_id: itFlete.id, cantidad: '1' }], confirmar: true }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.rem2 = r.cuerpo.id;
  igual([r.cuerpo.items.map((i) => i.mueve_stock), r.cuerpo.total], [[true, false], '1100.00'], JSON.stringify(r.cuerpo.items)); igual(await stockDe(PAN.id), 10, 'ahora hay 10');
  const o = await verO(OC.id); igual([o.items.map((i) => [Number(i.recibido), Number(i.pendiente)]), o.pendiente_de_recibir, o.remitos.length], [[[10, 0], [1, 0]], false, 2], JSON.stringify(o.items));
  igual((await api('admin', 'GET', '/api/compras/ordenes?pendiente=true')).cuerpo.total, 0, 'ya no está pendiente'); igual((await api('admin', 'GET', '/api/compras/ordenes?pendiente=false')).cuerpo.datos.map((m) => m.id), [OC.id], 'está en las recibidas por completo');
  const de = await remito({ orden_id: OC.id, items: [{ item_origen_id: itPan.id, cantidad: '1' }] }); igual(campoR(de, 'items[0].cantidad'), 'ese renglón ya se recibió completo', 'ya no hay nada para recibir');
});
await prueba('Validaciones: sobre-entrega, renglones de la orden, orden y proveedor, fechas y número repetido', async () => {
  const OC2 = (await api('admin', 'POST', '/api/compras/ordenes', { cuerpo: { tercero_id: P1.id, fecha: hoy, items: [{ articulo_id: PAN.id, cantidad: '5', precio_unitario: '100' }, { descripcion: 'Bolsas', cantidad: '2', precio_unitario: '10' }], confirmar: true } })).cuerpo; ids.oc2 = OC2.id; const [p2, b2] = OC2.items;
  igual(campoR(await calcR({ orden_id: OC2.id, items: [{ item_origen_id: p2.id, cantidad: '6' }] }), 'items[0].cantidad'), 'solo faltan recibir 5', 'más de lo pedido');
  igual(campoR(await calcR({ orden_id: OC2.id, items: [{ item_origen_id: itPan.id, cantidad: '1' }] }), 'items[0].item_origen_id'), 'el renglón no es de esa orden', 'renglón de otra orden');
  igual(campoR(await calcR({ orden_id: OC2.id, items: [{ item_origen_id: p2.id, cantidad: '1' }, { item_origen_id: p2.id, cantidad: '1' }] }), 'items[1].item_origen_id'), 'ese renglón está repetido', 'repetido');
  igual(campoR(await calcR({ orden_id: OC2.id, items: [{ cantidad: '1' }] }), 'items[0].item_origen_id'), 'indicá qué renglón de la orden se recibe', 'con orden hay que decir el renglón');
  igual(campoR(await calcR({ tercero_id: P1.id, items: [{ item_origen_id: p2.id, descripcion: 'x', cantidad: '1' }] }), 'items[0].item_origen_id'), 'sin orden de compra no hay renglón de origen', 'sin orden no hay origen');
  igual(campoR(await calcR({ orden_id: OC2.id, tercero_id: P2.id, items: [{ item_origen_id: p2.id, cantidad: '1' }] }), 'tercero_id'), 'no es el proveedor de la orden', 'otro proveedor'); igual(campoR(await calcR({ items: [{ descripcion: 'x', cantidad: '1' }] }), 'tercero_id'), 'es obligatorio (o indicá la orden de compra)', 'sin proveedor ni orden');
  igual(campoR(await calcR({ orden_id: 999999, items: [{ item_origen_id: p2.id, cantidad: '1' }] }), 'orden_id'), 'la orden de compra no existe', 'orden inexistente'); const bor = await api('admin', 'POST', '/api/compras/ordenes', { cuerpo: { tercero_id: P1.id, items: [{ descripcion: 'x', cantidad: '1', precio_unitario: '1' }] } });
  igual(campoR(await calcR({ orden_id: bor.cuerpo.id, items: [{ item_origen_id: bor.cuerpo.items[0].id, cantidad: '1' }] }), 'orden_id'), 'la orden todavía es un borrador: hay que emitirla', 'una orden en borrador no se recibe'); await api('admin', 'DELETE', `/api/compras/ordenes/${bor.cuerpo.id}`);
  igual(campoR(await calcR({ orden_id: OC2.id, fecha: hace(5), items: [{ item_origen_id: p2.id, cantidad: '1' }] }), 'fecha'), 'el remito no puede ser anterior a la orden de compra', 'antes que la orden'); igual(campoR(await calcR({ orden_id: OC2.id, fecha: '2999-01-01', items: [{ item_origen_id: p2.id, cantidad: '1' }] }), 'fecha'), 'la fecha del remito no puede ser futura', 'futuro');
  igual(campoR(await calcR({ orden_id: OC2.id, numero_externo: '0003-00004512', items: [{ item_origen_id: p2.id, cantidad: '1' }] }), 'numero_externo'), 'ya hay un remito de ese proveedor con ese número', 'el mismo papel no se carga dos veces');
  igual(campoR(await calcR({ orden_id: OC2.id, numero_externo: '0003-00004512'.toLowerCase(), tercero_id: undefined, items: [{ item_origen_id: p2.id, cantidad: '1' }] }), 'numero_externo'), 'ya hay un remito de ese proveedor con ese número', 'tampoco con otras mayúsculas');
  igual((await remito({ orden_id: OC2.id, items: [{ item_origen_id: p2.id, cantidad: '1', deposito_id: 999999 }] })).cuerpo.error.campos['items[0].deposito_id'], 'el depósito no existe o está dado de baja', 'depósito inexistente'); igual((await calcR({ orden_id: OC2.id, items: [{ item_origen_id: p2.id, cantidad: '0' }] })).estado, 422, 'cantidad cero');
  igual(await stockDe(PAN.id), 10, 'ninguna validación movió stock');
});
await prueba('Remito sin orden: mercadería suelta de un proveedor, con el costo del último ingreso si no se indica precio', async () => {
  const r = await remito({ tercero_id: P2.id, numero_externo: 'R-77', items: [{ articulo_id: PAN.id, cantidad: '3', precio_unitario: '120' }, { descripcion: 'Descarga', cantidad: '1' }], confirmar: true }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.rem3 = r.cuerpo.id;
  igual([r.cuerpo.orden, r.cuerpo.proveedor, r.cuerpo.total, await stockDe(PAN.id)], [null, 'Transportes Rápidos SRL', '360.00', 13], JSON.stringify(r.cuerpo)); igual((await api('admin', 'GET', `/api/compras/remitos?orden_id=${OC.id}`)).cuerpo.total, 2, 'los de la orden no incluyen el suelto');
  igual((await remito({ tercero_id: P2.id, numero_externo: 'r-77', items: [{ descripcion: 'x', cantidad: '1' }] })).estado, 422, 'el número se compara sin mayúsculas'); igual((await remito({ tercero_id: P1.id, numero_externo: 'R-77', items: [{ descripcion: 'x', cantidad: '1' }] })).estado, 201, 'otro proveedor puede tener el mismo número'); await api('admin', 'DELETE', `/api/compras/remitos/${(await api('admin', 'GET', '/api/compras/remitos?q=R-77&tercero_id=' + P1.id)).cuerpo.datos[0].id}`);
  igual(campoR(await remito({ tercero_id: CLI.id, items: [{ descripcion: 'x', cantidad: '1' }] }), 'tercero_id'), 'el proveedor no existe', 'un cliente no es proveedor');
});
await prueba('Borrador: se guarda sin mover stock, se modifica, se confirma o se borra; la base impide recibir de más aunque haya dos borradores', async () => {
  const [p2] = (await verO(ids.oc2)).items; const stock0 = await stockDe(PAN.id);
  const a = await remito({ orden_id: ids.oc2, items: [{ item_origen_id: p2.id, cantidad: '3' }] }); igual([a.estado, a.cuerpo.estado, a.cuerpo.acciones.modificar, await stockDe(PAN.id)], [201, 'borrador', true, stock0], JSON.stringify(a.cuerpo));
  const m = await api('admin', 'PUT', `/api/compras/remitos/${a.cuerpo.id}`, { cuerpo: { orden_id: ids.oc2, numero_externo: 'B-1', items: [{ item_origen_id: p2.id, cantidad: '4' }] } }); igual([m.estado, m.cuerpo.items[0].cantidad, m.cuerpo.numero_externo], [200, '4.0000', 'B-1'], JSON.stringify(m.cuerpo));
  const b = await remito({ orden_id: ids.oc2, items: [{ item_origen_id: p2.id, cantidad: '4' }] }); igual(b.estado, 201, 'otro borrador de lo mismo');
  const ca = await api('admin', 'POST', `/api/compras/remitos/${a.cuerpo.id}/confirmar`, { cuerpo: {} }); igual([ca.estado, ca.cuerpo.estado, await stockDe(PAN.id)], [200, 'confirmado', stock0 + 4], JSON.stringify(ca.cuerpo)); ids.remB = a.cuerpo.id;
  const cb = await api('admin', 'POST', `/api/compras/remitos/${b.cuerpo.id}/confirmar`, { cuerpo: {} }); igual([cb.estado, cb.cuerpo.error.codigo, /solo pide/.test(cb.cuerpo.error.mensaje)], [422, 'regla_de_negocio', true], JSON.stringify(cb.cuerpo)); igual(await stockDe(PAN.id), stock0 + 4, 'el segundo no entró');
  igual((await api('admin', 'PUT', `/api/compras/remitos/${a.cuerpo.id}`, { cuerpo: { orden_id: ids.oc2, items: [{ item_origen_id: p2.id, cantidad: '1' }] } })).estado, 422, 'uno confirmado no se modifica'); igual((await api('admin', 'DELETE', `/api/compras/remitos/${a.cuerpo.id}`)).estado, 422, 'ni se borra'); igual((await api('admin', 'POST', `/api/compras/remitos/${a.cuerpo.id}/confirmar`, { cuerpo: {} })).cuerpo.error.mensaje, 'El remito ya está confirmado.', 'ni se confirma otra vez');
  const del = await api('admin', 'DELETE', `/api/compras/remitos/${b.cuerpo.id}`); igual([del.estado, (await verR(b.cuerpo.id)).estado], [200, 404], 'un borrador se borra'); igual((await api('admin', 'POST', `/api/compras/remitos/${a.cuerpo.id}/anular`, { cuerpo: { motivo: 'xx' } })).estado, 422, 'motivo corto');
});
await prueba('Anular un remito: el stock vuelve a salir, la orden recupera lo pendiente, y no se deja si la mercadería ya no está o hay facturas', async () => {
  const stock0 = await stockDe(PAN.id), antes = (await verO(ids.oc2)).items.find((i) => i.articulo_id === PAN.id);
  await q(`insert into movimiento_stock (empresa_id, fecha, articulo_id, deposito_id, cantidad, tipo, motivo) values ($1, $2, $3, $4, $5, 'ajuste', 'Consumo de prueba')`, [RI, hoy, PAN.id, DEP, -(stock0 - 1)]);
  const mal = await api('admin', 'POST', `/api/compras/remitos/${ids.remB}/anular`, { cuerpo: { motivo: 'Se cargó mal' } }); igual([mal.estado, mal.cuerpo.error.codigo, /ya no está en el depósito \(hay 1\)/.test(mal.cuerpo.error.mensaje)], [422, 'stock_insuficiente', true], JSON.stringify(mal.cuerpo));
  await q(`insert into movimiento_stock (empresa_id, fecha, articulo_id, deposito_id, cantidad, tipo, motivo) values ($1, $2, $3, $4, $5, 'ajuste', 'Se devuelve')`, [RI, hoy, PAN.id, DEP, stock0 - 1]);
  igual(campoR(await api('admin', 'POST', `/api/compras/remitos/${ids.remB}/anular`, { cuerpo: {} }), 'motivo'), 'es obligatorio', 'pide el motivo');
  const ok = await api('admin', 'POST', `/api/compras/remitos/${ids.remB}/anular`, { cuerpo: { motivo: 'Se cargó mal' } }); igual([ok.estado, ok.cuerpo.estado, /Anulado: Se cargó mal/.test(ok.cuerpo.observaciones), await stockDe(PAN.id)], [200, 'anulado', true, stock0 - 4], JSON.stringify(ok.cuerpo));
  const despues = (await verO(ids.oc2)).items.find((i) => i.articulo_id === PAN.id); igual([antes.recibido, despues.recibido, despues.pendiente], ['4.0000', '0', '5.0000'], 'la orden vuelve a faltar todo');
  igual((await api('admin', 'POST', `/api/compras/remitos/${ids.remB}/anular`, { cuerpo: { motivo: 'otra vez' } })).cuerpo.error.mensaje, 'Ya está anulado.', 'no dos veces'); igual((await api('admin', 'POST', `/api/compras/remitos/${ids.remB}/anular`, { cuerpo: { motivo: 'xyz abc' }, empresa: MT })).estado, 404, 'ni desde otra empresa');
  igual((await verR(ids.rem1)).cuerpo.acciones.anular, true, 'uno confirmado se puede anular');
});
await prueba('Listado y trazabilidad: filtros por estado, proveedor, orden, número del proveedor y fechas; cada empresa ve los suyos; todo con su rastro', async () => {
  const todos = (await api('admin', 'GET', '/api/compras/remitos?limite=100')).cuerpo; verdad(todos.total >= 4, `total ${todos.total}`); verdad(todos.datos.every((r, i, a) => !i || a[i - 1].fecha >= r.fecha), 'los más nuevos primero');
  igual((await api('admin', 'GET', '/api/compras/remitos?estado=anulado')).cuerpo.datos.map((r) => r.id), [ids.remB], 'anulados'); igual((await api('admin', 'GET', `/api/compras/remitos?tercero_id=${P2.id}`)).cuerpo.datos.map((r) => r.numero_externo), ['R-77'], 'por proveedor');
  igual((await api('admin', 'GET', '/api/compras/remitos?q=0003-00004530')).cuerpo.datos.map((r) => r.id), [ids.rem2], 'por número del proveedor'); igual((await api('admin', 'GET', `/api/compras/remitos?orden_id=${OC.id}&estado=confirmado`)).cuerpo.total, 2, 'por orden');
  igual((await api('admin', 'GET', `/api/compras/remitos?desde=${hoy}&hasta=${hoy}&limite=2&desplazamiento=1`)).cuerpo.datos.length, 2, 'paginado'); igual((await api('admin', 'GET', '/api/compras/remitos?desde=2020-01-01&hasta=2020-01-31')).cuerpo.total, 0, 'otro mes'); igual((await api('admin', 'GET', '/api/compras/remitos?estado=raro')).estado, 422, 'estado inválido');
  igual([(await api('admin', 'GET', '/api/compras/remitos', { empresa: MT })).cuerpo.total, (await verR(ids.rem1, MT)).estado], [0, 404], 'otra empresa');
  verdad((await uno(`select count(*)::int n from evento where accion like '%remito%' and categoria in ('stock', 'comprobantes')`)).n >= 8, 'rastro de cada paso'); igual((await uno(`select count(*)::int n from evento where accion like '%remito%' and usuario_id is null`)).n, 0, 'con la persona');
  for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena ${e}`);
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
