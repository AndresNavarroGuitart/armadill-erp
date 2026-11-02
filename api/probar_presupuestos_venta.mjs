// Pruebas de presupuestos de venta: borrador y emisión (validez, situación vigente/vencido/aceptado), validaciones, pedido contra el presupuesto (renglón de origen, precio, tope por lo
// presupuestado, aceptación parcial y total), la defensa de la base, y la cadena presupuesto → pedido → remito → factura con sus anulaciones. Con --pg pasan por el adaptador de producción.
// Uso:  node api/probar_presupuestos_venta.mjs [--pg]
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
const dia = (n) => { const d = new Date(hoy + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ultimoEvento = (patron) => uno(`select usuario_id, empresa_id, categoria, accion, detalle from evento where accion like $1 order by id desc limit 1`, [patron]);
const stockDe = async (articuloId, dep = DEP) => Number((await uno('select coalesce(sum(cantidad), 0)::text s from movimiento_stock where articulo_id = $1 and deposito_id = $2', [articuloId, dep])).s);
const movs = async () => (await uno('select count(*)::int n from movimiento_stock')).n;
const campoF = (r, k) => r.cuerpo?.error?.campos?.[k];

const cli = async (doc, nombre, cond = 1, tipo = 'CUIT', empresa = RI) => (await api('admin', 'POST', '/api/clientes', { empresa, cuerpo: { tipo_documento: tipo, nro_documento: doc, razon_social: nombre, condicion_iva_codigo: cond } })).cuerpo;
const art = async (codigo, nombre, extra = {}, empresa = RI) => { const r = await api('admin', 'POST', '/api/articulos', { empresa, cuerpo: { codigo, nombre, alicuota_venta: '21', ...extra } }); if (r.estado !== 201) throw new Error(`${codigo}: ${JSON.stringify(r.cuerpo)}`); return r.cuerpo; };
const lista = (await api('admin', 'GET', '/api/listas-precio')).cuerpo.datos[0].id;
const C1 = await cli(cuitConDigito('3070811222'), 'Distribuidora Sur SRL'), C2 = await cli(cuitConDigito('3071000000'), 'Kiosco Norte SRL');
const prov = (await api('admin', 'POST', '/api/proveedores', { cuerpo: { tipo_documento: 'CUIT', nro_documento: cuitConDigito('3070811999'), razon_social: 'Solo Proveedor SA', condicion_iva_codigo: 1 } })).cuerpo;
const PAN = await art('PAN', 'Pan lactal', { alicuota_venta: '10.5', lista_id: lista, precio_neto: '100' });
const LECHE = await art('LECHE', 'Leche x litro', { lista_id: lista, precio_neto: '50' });
const SERV = await art('SERV', 'Servicio de entrega', { tipo: 'servicio', lista_id: lista, precio_neto: '1000' });
const GASTO = await art('GAS', 'Gasto interno', { tipo: 'gasto' });
await api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: PAN.id, deposito_id: DEP, tipo: 'ingreso', cantidad: '100', motivo: 'Inventario inicial' } });
await api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: LECHE.id, deposito_id: DEP, tipo: 'ingreso', cantidad: '30', motivo: 'Inventario inicial' } });

// --- atajos
const presup = (cuerpo, o = {}) => api(o.quien ?? 'admin', 'POST', '/api/ventas/presupuestos', { cuerpo, empresa: o.empresa });
const verQ = async (id, empresa = RI) => (await api('admin', 'GET', `/api/ventas/presupuestos/${id}`, { empresa })).cuerpo;
const anularQ = (id, motivo = 'El cliente no lo aceptó') => api('admin', 'POST', `/api/ventas/presupuestos/${id}/anular`, { cuerpo: { motivo } });
const pedido = (cuerpo) => api('admin', 'POST', '/api/ventas/pedidos', { cuerpo });
const verP = async (id) => (await api('admin', 'GET', `/api/ventas/pedidos/${id}`)).cuerpo;
const anularP = (id, motivo = 'El cliente canceló') => api('admin', 'POST', `/api/ventas/pedidos/${id}/anular`, { cuerpo: { motivo } });
const remito = (cuerpo) => api('admin', 'POST', '/api/ventas/remitos', { cuerpo });
const factura = (cuerpo) => api('admin', 'POST', '/api/ventas/facturas', { cuerpo: { tercero_id: C1.id, fecha: hoy, ...cuerpo } });

// ---------------------------------------------------------------------------
await prueba('Permisos y aislamiento: la consulta ve los presupuestos pero no los carga ni los anula; otra empresa no los ve', async () => {
  igual((await api('consulta', 'GET', '/api/ventas/presupuestos')).estado, 200, 'la consulta los ve');
  for (const [m, r, c] of [['POST', '/api/ventas/presupuestos', { tercero_id: C1.id, items: [] }], ['POST', '/api/ventas/presupuestos/calcular', {}], ['POST', '/api/ventas/presupuestos/1/anular', { motivo: 'xxx' }], ['POST', '/api/ventas/presupuestos/1/emitir', {}], ['DELETE', '/api/ventas/presupuestos/1', undefined]])
    igual((await api('consulta', m, r, { cuerpo: c })).estado, 403, `la consulta no puede ${m} ${r}`);
  igual((await api('admin', 'GET', '/api/ventas/presupuestos', { empresa: MT })).cuerpo.total, 0, 'otra empresa: lista vacía');
  igual((await api('admin', 'GET', '/api/ventas/presupuestos/999999')).estado, 404, 'inexistente');
  igual((await api('admin', 'GET', '/api/ventas/presupuestos?situacion=rara')).estado, 422, 'situación inválida');
});
await prueba('Calcular y guardar un borrador: precio de la lista, validez de 15 días por defecto, no mueve stock; se modifica y se borra', async () => {
  const cuerpo = { tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '10' }, { articulo_id: SERV.id, cantidad: '1', precio_unitario: '1200' }] };
  const previa = await api('admin', 'POST', '/api/ventas/presupuestos/calcular', { cuerpo }); igual(previa.estado, 200, JSON.stringify(previa.cuerpo));
  igual([previa.cuerpo.items.map((x) => Number(x.precio_unitario)), Number(previa.cuerpo.total), previa.cuerpo.valido_hasta], [[100, 1200], 2200, dia(15)], JSON.stringify(previa.cuerpo));
  const antes = await movs(); const r = await presup(cuerpo); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.b = r.cuerpo.id;
  igual([r.cuerpo.estado, r.cuerpo.situacion, r.cuerpo.numero_formateado, r.cuerpo.cliente, Number(r.cuerpo.total), r.cuerpo.valido_hasta, r.cuerpo.acciones.anular, r.cuerpo.acciones.emitir, r.cuerpo.acciones.pedir], ['borrador', 'borrador', '0001-00000001', 'Distribuidora Sur SRL', 2200, dia(15), false, true, false], JSON.stringify(r.cuerpo));
  igual(await movs(), antes, 'un presupuesto no mueve stock');
  const sin = await presup({ ...cuerpo, valido_hasta: null }); igual([sin.estado, sin.cuerpo.valido_hasta], [201, null], 'con null no vence'); await api('admin', 'DELETE', `/api/ventas/presupuestos/${sin.cuerpo.id}`);
  const m = await api('admin', 'PUT', `/api/ventas/presupuestos/${ids.b}`, { cuerpo: { tercero_id: C1.id, valido_hasta: dia(30), items: [{ articulo_id: PAN.id, cantidad: '12', precio_unitario: '90' }] } }); igual([m.estado, Number(m.cuerpo.items[0].cantidad), Number(m.cuerpo.total), m.cuerpo.valido_hasta], [200, 12, 1080, dia(30)], JSON.stringify(m.cuerpo));
  const b = await api('admin', 'DELETE', `/api/ventas/presupuestos/${ids.b}`); igual([b.estado, (await api('admin', 'GET', `/api/ventas/presupuestos/${ids.b}`)).estado], [200, 404], 'se borra'); verdad((await ultimoEvento('Borró el borrador del presupuesto%')).detalle.includes('Distribuidora'), 'queda el rastro');
});
await prueba('Emitir: queda el rastro y la situación vigente; uno emitido no se modifica, no se borra ni se emite otra vez', async () => {
  const r = await presup({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '10' }, { articulo_id: LECHE.id, cantidad: '20' }], confirmar: true }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.Q1 = r.cuerpo.id; ids.Q1items = r.cuerpo.items.map((i) => i.id);
  igual([r.cuerpo.estado, r.cuerpo.situacion, r.cuerpo.acciones.pedir, r.cuerpo.items.map((i) => Number(i.pendiente))], ['confirmado', 'vigente', true, [10, 20]], JSON.stringify(r.cuerpo)); const e = await ultimoEvento('Emitió el presupuesto%'); igual([e.categoria, e.detalle], ['comprobantes', 'Distribuidora Sur SRL · $ 2000.00'], JSON.stringify(e));
  igual((await api('admin', 'PUT', `/api/ventas/presupuestos/${ids.Q1}`, { cuerpo: { tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '1' }] } })).estado, 422, 'no se modifica'); igual((await api('admin', 'DELETE', `/api/ventas/presupuestos/${ids.Q1}`)).estado, 422, 'no se borra');
  igual((await api('admin', 'POST', `/api/ventas/presupuestos/${ids.Q1}/emitir`, { cuerpo: {} })).estado, 422, 'no se emite dos veces');
  const b = (await presup({ tercero_id: C1.id, items: [{ articulo_id: LECHE.id, cantidad: '1' }] })).cuerpo; const c = await api('admin', 'POST', `/api/ventas/presupuestos/${b.id}/emitir`, { cuerpo: {} }); igual([c.estado, c.cuerpo.estado], [200, 'confirmado'], 'emitir un borrador'); ids.Q2 = b.id;
  const l = (await api('admin', 'GET', '/api/ventas/presupuestos?situacion=vigente')).cuerpo; igual(l.datos.map((x) => x.id).sort(), [ids.Q1, ids.Q2].sort(), 'el filtro por situación'); igual((await api('admin', 'GET', `/api/ventas/presupuestos?tercero_id=${C2.id}`)).cuerpo.total, 0, 'otro cliente: nada');
});
await prueba('Validaciones: cliente, artículo, fechas y renglones', async () => {
  const mal = async (cuerpo, campo, texto_) => { const r = await presup({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '1' }], ...cuerpo }); igual(r.estado, 422, `${campo}: ${JSON.stringify(r.cuerpo)}`); if (texto_) igual(campoF(r, campo), texto_, campo); };
  await mal({ tercero_id: prov.id }, 'tercero_id', 'el cliente no existe'); await mal({ tercero_id: 999999 }, 'tercero_id', 'el cliente no existe');
  await mal({ items: [{ articulo_id: 999999, cantidad: '1' }] }, 'items[0].articulo_id', 'el artículo no existe'); await mal({ items: [{ articulo_id: GASTO.id, cantidad: '1' }] }, 'items[0].articulo_id', 'un artículo de tipo gasto no se vende');
  await mal({ items: [{ articulo_id: PAN.id, cantidad: '0' }] }, 'items[0].cantidad'); await mal({ items: [] }, 'items'); await mal({ fecha: '2999-01-01' }, 'fecha', 'la fecha del presupuesto no puede ser futura'); await mal({ fecha: '2001-01-01' }, 'fecha', 'la fecha del presupuesto es de hace más de 3 años');
  await mal({ valido_hasta: '2000-01-01' }, 'valido_hasta', 'no puede ser anterior a la fecha del presupuesto');
  await q('update tercero set activo = false where id = $1', [C2.id]); await mal({ tercero_id: C2.id }, 'tercero_id', 'el cliente está dado de baja'); await q('update tercero set activo = true where id = $1', [C2.id]);
  igual((await presup({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '1' }] }, { empresa: MT })).estado, 422, 'el cliente no es de esa empresa');
});
await prueba('Pedido contra un presupuesto: cada renglón apunta al suyo, toma su precio y no se pide más de lo presupuestado', async () => {
  const [pan, leche] = ids.Q1items;
  const mal = await pedido({ presupuesto_id: ids.Q1, items: [{ item_origen_id: pan, cantidad: '11' }] }); igual([mal.estado, campoF(mal, 'items[0].cantidad')], [422, 'solo se pueden pedir 10 más'], JSON.stringify(mal.cuerpo));
  igual(campoF(await pedido({ presupuesto_id: ids.Q1, items: [{ articulo_id: PAN.id, cantidad: '1' }] }), 'items[0].item_origen_id'), 'indicá qué renglón del presupuesto se pide', 'sin renglón de origen');
  igual(campoF(await pedido({ tercero_id: C1.id, items: [{ item_origen_id: pan, articulo_id: PAN.id, cantidad: '1' }] }), 'items[0].item_origen_id'), 'sin presupuesto no hay renglón de origen', 'origen sin presupuesto');
  igual(campoF(await pedido({ presupuesto_id: ids.Q1, tercero_id: C2.id, items: [{ item_origen_id: pan, cantidad: '1' }] }), 'tercero_id'), 'no es el cliente del presupuesto', 'otro cliente');
  igual(campoF(await pedido({ presupuesto_id: ids.Q1, items: [{ item_origen_id: pan + 99999, cantidad: '1' }] }), 'items[0].item_origen_id'), 'el renglón no es de ese presupuesto', 'renglón ajeno');
  igual(campoF(await pedido({ presupuesto_id: ids.Q1, items: [{ item_origen_id: pan, cantidad: '1' }, { item_origen_id: pan, cantidad: '1' }] }), 'items[1].item_origen_id'), 'ese renglón está repetido', 'repetido'); igual((await pedido({ presupuesto_id: 999999, items: [{ item_origen_id: pan, cantidad: '1' }] })).estado, 422, 'presupuesto inexistente');
  const r = await pedido({ presupuesto_id: ids.Q1, items: [{ item_origen_id: pan, cantidad: '4' }], confirmar: true }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.P1 = r.cuerpo.id;
  verdad(r.cuerpo.avisos.some((a) => /Quedan 1 renglón del presupuesto sin pedir/.test(a)), JSON.stringify(r.cuerpo.avisos));
  igual([r.cuerpo.cliente, r.cuerpo.presupuesto.id, Number(r.cuerpo.items[0].precio_unitario), r.cuerpo.items[0].item_origen_id, r.cuerpo.items[0].descripcion], ['Distribuidora Sur SRL', ids.Q1, 100, pan, 'Pan lactal'], JSON.stringify(r.cuerpo));
  const q1 = await verQ(ids.Q1); igual([q1.situacion, q1.items.map((i) => [Number(i.pedido), Number(i.pendiente)]), q1.pedidos.map((x) => [x.id, x.estado]), q1.acciones.pedir], ['aceptado_parcial', [[4, 6], [0, 20]], [[ids.P1, 'confirmado']], true], JSON.stringify(q1.items));
  igual(campoF(await pedido({ presupuesto_id: ids.Q1, items: [{ item_origen_id: pan, cantidad: '7' }] }), 'items[0].cantidad'), 'solo se pueden pedir 6 más', 'lo ya pedido se descuenta');
  const p2 = await pedido({ presupuesto_id: ids.Q1, items: [{ item_origen_id: pan, cantidad: '6', precio_unitario: '95' }, { item_origen_id: leche, cantidad: '20' }], confirmar: true }); igual(p2.estado, 201, JSON.stringify(p2.cuerpo)); ids.P2 = p2.cuerpo.id; igual(Number(p2.cuerpo.items[0].precio_unitario), 95, 'el precio del presupuesto se puede cambiar');
  const c = await verQ(ids.Q1); igual([c.situacion, c.acciones.pedir, c.items.map((i) => Number(i.pendiente))], ['aceptado', false, [0, 0]], 'presupuesto aceptado por completo');
  igual(campoF(await pedido({ presupuesto_id: ids.Q1, items: [{ item_origen_id: pan, cantidad: '1' }] }), 'items[0].cantidad'), 'ese renglón ya se pidió completo', 'ya no queda nada');
  igual((await api('admin', 'GET', '/api/ventas/presupuestos?situacion=aceptado')).cuerpo.datos.some((x) => x.id === ids.Q1), true, 'el filtro por situación aceptado');
});
await prueba('Presupuesto borrador, anulado o vencido no se convierte en pedido; un borrador de pedido no cuenta; la base impide pedir de más', async () => {
  const b = (await presup({ tercero_id: C1.id, items: [{ articulo_id: LECHE.id, cantidad: '2' }] })).cuerpo;
  igual(campoF(await pedido({ presupuesto_id: b.id, items: [{ item_origen_id: b.items[0].id, cantidad: '1' }] }), 'presupuesto_id'), 'el presupuesto todavía es un borrador: hay que emitirlo', 'borrador'); await api('admin', 'DELETE', `/api/ventas/presupuestos/${b.id}`);
  const x = (await presup({ tercero_id: C1.id, items: [{ articulo_id: LECHE.id, cantidad: '2' }], confirmar: true })).cuerpo; await anularQ(x.id);
  igual(campoF(await pedido({ presupuesto_id: x.id, items: [{ item_origen_id: x.items[0].id, cantidad: '1' }] }), 'presupuesto_id'), 'el presupuesto está anulado', 'anulado');
  const v = await presup({ tercero_id: C1.id, fecha: dia(-20), valido_hasta: dia(-5), items: [{ articulo_id: LECHE.id, cantidad: '2' }], confirmar: true }); igual(v.estado, 201, JSON.stringify(v.cuerpo)); verdad(v.cuerpo.avisos.some((a) => /nace vencido/.test(a)), 'avisa que nace vencido');
  igual([v.cuerpo.situacion, v.cuerpo.acciones.pedir], ['vencido', false], 'vencido'); igual(campoF(await pedido({ presupuesto_id: v.cuerpo.id, items: [{ item_origen_id: v.cuerpo.items[0].id, cantidad: '1' }] }), 'presupuesto_id'), `el presupuesto venció el ${dia(-5)}`, 'vencido no se pide');
  igual((await api('admin', 'GET', '/api/ventas/presupuestos?situacion=vencido')).cuerpo.datos.some((y) => y.id === v.cuerpo.id), true, 'el filtro vencido'); ids.Qv = v.cuerpo.id;
  const Q3 = (await presup({ tercero_id: C1.id, items: [{ articulo_id: LECHE.id, cantidad: '2' }], confirmar: true })).cuerpo; ids.Q3 = Q3.id; const it = Q3.items[0].id;
  const pb = (await pedido({ presupuesto_id: Q3.id, items: [{ item_origen_id: it, cantidad: '2' }] })).cuerpo; igual([pb.estado, Number((await verQ(Q3.id)).items[0].pedido)], ['borrador', 0], 'un borrador de pedido no cuenta');
  const m = await api('admin', 'PUT', `/api/ventas/pedidos/${pb.id}`, { cuerpo: { presupuesto_id: Q3.id, items: [{ item_origen_id: it, cantidad: '1' }] } }); igual([m.estado, m.cuerpo.presupuesto.id, Number(m.cuerpo.items[0].cantidad)], [200, Q3.id, 1], 'modificar conserva el vínculo');
  await api('admin', 'POST', `/api/ventas/pedidos/${pb.id}/confirmar`, { cuerpo: {} });
  const pc = (await pedido({ presupuesto_id: Q3.id, items: [{ item_origen_id: it, cantidad: '1' }] })).cuerpo;
  const msg = async (sql) => { try { await q(sql); return ''; } catch (e) { return e.message; } };
  const mm = await msg(`do $$ begin update documento_item set cantidad = 5 where documento_id = ${pc.id}; update documento_comercial set estado = 'confirmado' where id = ${pc.id}; end $$`);
  verdad(/se pide 6(.0+)? y el documento de origen solo presupuestó 2/.test(mm), 'la base impide pedir de más: ' + mm); igual((await verP(pc.id)).estado, 'borrador', 'quedó como estaba'); await api('admin', 'DELETE', `/api/ventas/pedidos/${pc.id}`);
});
await prueba('Cadena completa: presupuesto → pedido → remito → factura; las anulaciones devuelven lo pendiente aguas arriba', async () => {
  const pedidoP2 = await verP(ids.P2); const stock = await stockDe(PAN.id);
  const r = await remito({ pedido_id: ids.P2, items: [{ item_origen_id: pedidoP2.items[0].id, cantidad: '6' }], confirmar: true }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.R1 = r.cuerpo.id; igual(await stockDe(PAN.id), stock - 6, 'el remito descuenta el stock');
  const f = await factura({ items: [{ documento_item_id: r.cuerpo.items[0].id, cantidad: '6' }] }); igual(f.estado, 201, JSON.stringify(f.cuerpo)); ids.F1 = f.cuerpo.id; igual(Number(f.cuerpo.items[0].precio_unitario), 95, 'la factura toma el precio del pedido (que cambió el del presupuesto)');
  const bloq = await anularQ(ids.Q1); igual([bloq.estado, bloq.cuerpo.error.mensaje], [422, 'El presupuesto ya tiene pedidos: anulá primero esos pedidos.'], JSON.stringify(bloq.cuerpo));
  igual((await anularP(ids.P2)).estado, 422, 'el pedido con remitos no se anula');
  igual((await api('admin', 'POST', `/api/comprobantes/${ids.F1}/anular`, { cuerpo: { motivo: 'Error de carga' } })).estado, 200, 'anula la factura'); igual((await api('admin', 'POST', `/api/ventas/remitos/${ids.R1}/anular`, { cuerpo: { motivo: 'Se entregó por error' } })).estado, 200, 'anula el remito'); igual(await stockDe(PAN.id), stock, 'vuelve la mercadería');
  igual((await anularP(ids.P2)).estado, 200, 'anula el pedido 2'); igual((await anularP(ids.P1)).estado, 200, 'anula el pedido 1');
  const q = await verQ(ids.Q1); igual([q.situacion, q.items.map((i) => Number(i.pendiente)), q.acciones.pedir], ['vigente', [10, 20], true], 'el presupuesto vuelve a estar pendiente de pedir');
  const a = await anularQ(ids.Q1, 'El cliente no lo aceptó'); igual([a.estado, a.cuerpo.estado, a.cuerpo.situacion], [200, 'anulado', 'anulado'], JSON.stringify(a.cuerpo)); verdad((await ultimoEvento('Anuló el presupuesto%')).detalle.includes('motivo: El cliente no lo aceptó'), 'queda el rastro');
  igual((await anularQ(ids.Q1)).estado, 422, 'no se anula dos veces'); igual((await api('admin', 'POST', `/api/ventas/presupuestos/${ids.Q1}/anular`, { cuerpo: {} })).estado, 422, 'pide motivo');
  const bd = (await presup({ tercero_id: C1.id, items: [{ articulo_id: LECHE.id, cantidad: '1' }] })).cuerpo; igual((await anularQ(bd.id)).estado, 422, 'un borrador se borra'); await api('admin', 'DELETE', `/api/ventas/presupuestos/${bd.id}`);
});
await prueba('Trazabilidad: la cadena sigue íntegra', async () => {
  for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena ${e}`);
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
