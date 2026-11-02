// Pruebas de pedidos de venta: borrador y confirmación (sin mover ni reservar stock), validaciones, remito de salida contra el pedido (renglón de origen, precio del pedido, tope por lo
// que falta entregar, cumplimiento parcial y total), facturación de lo remitido y anulaciones en cadena. Con --pg pasan por el adaptador de producción.
// Uso:  node api/probar_pedidos_venta.mjs [--pg]
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
await api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: LECHE.id, deposito_id: DEP, tipo: 'ingreso', cantidad: '3', motivo: 'Inventario inicial' } });

// --- atajos
const pedido = (cuerpo, o = {}) => api(o.quien ?? 'admin', 'POST', '/api/ventas/pedidos', { cuerpo, empresa: o.empresa });
const verP = async (id, empresa = RI) => (await api('admin', 'GET', `/api/ventas/pedidos/${id}`, { empresa })).cuerpo;
const remito = (cuerpo) => api('admin', 'POST', '/api/ventas/remitos', { cuerpo });
const verR = async (id) => (await api('admin', 'GET', `/api/ventas/remitos/${id}`)).cuerpo;
const anularR = (id, motivo = 'Se entregó por error') => api('admin', 'POST', `/api/ventas/remitos/${id}/anular`, { cuerpo: { motivo } });
const anularP = (id, motivo = 'El cliente canceló') => api('admin', 'POST', `/api/ventas/pedidos/${id}/anular`, { cuerpo: { motivo } });
const factura = (cuerpo) => api('admin', 'POST', '/api/ventas/facturas', { cuerpo: { tercero_id: C1.id, fecha: hoy, ...cuerpo } });

// ---------------------------------------------------------------------------
await prueba('Permisos y aislamiento: la consulta ve los pedidos pero no los carga ni los anula; otra empresa no los ve', async () => {
  igual((await api('consulta', 'GET', '/api/ventas/pedidos')).estado, 200, 'la consulta los ve');
  for (const [m, r, c] of [['POST', '/api/ventas/pedidos', { tercero_id: C1.id, items: [] }], ['POST', '/api/ventas/pedidos/calcular', {}], ['POST', '/api/ventas/pedidos/1/anular', { motivo: 'xxx' }], ['DELETE', '/api/ventas/pedidos/1', undefined]])
    igual((await api('consulta', m, r, { cuerpo: c })).estado, 403, `la consulta no puede ${m} ${r}`);
  igual((await api('admin', 'GET', '/api/ventas/pedidos', { empresa: MT })).cuerpo.total, 0, 'otra empresa: lista vacía');
  igual((await api('admin', 'GET', '/api/ventas/pedidos/999999')).estado, 404, 'inexistente');
});
await prueba('Calcular y guardar un borrador: precio de la lista, aviso si no hay stock, un borrador no mueve ni reserva stock; se modifica y se borra', async () => {
  const cuerpo = { tercero_id: C1.id, entrega_prevista: hoy, items: [{ articulo_id: PAN.id, cantidad: '10' }, { articulo_id: LECHE.id, cantidad: '4' }, { articulo_id: SERV.id, cantidad: '1', precio_unitario: '1200' }] };
  const previa = await api('admin', 'POST', '/api/ventas/pedidos/calcular', { cuerpo }); igual(previa.estado, 200, JSON.stringify(previa.cuerpo));
  igual([previa.cuerpo.items.map((x) => Number(x.precio_unitario)), Number(previa.cuerpo.total)], [[100, 50, 1200], 2400], JSON.stringify(previa.cuerpo)); verdad(previa.cuerpo.avisos.some((a) => /no alcanza el stock de Leche x litro: hoy hay 3 disponibles/.test(a)), 'avisa que falta stock: ' + previa.cuerpo.avisos);
  const antes = await movs(); const r = await pedido(cuerpo); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.b = r.cuerpo.id;
  igual([r.cuerpo.estado, r.cuerpo.numero_formateado, r.cuerpo.cliente, Number(r.cuerpo.total), r.cuerpo.acciones.anular, r.cuerpo.acciones.confirmar, r.cuerpo.acciones.remitir], ['borrador', '0001-00000001', 'Distribuidora Sur SRL', 2400, false, true, false], JSON.stringify(r.cuerpo));
  igual([await movs(), await stockDe(PAN.id)], [antes, 100], 'un borrador no mueve stock');
  const m = await api('admin', 'PUT', `/api/ventas/pedidos/${ids.b}`, { cuerpo: { tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '12', precio_unitario: '90' }] } }); igual([m.estado, Number(m.cuerpo.items[0].cantidad), Number(m.cuerpo.total)], [200, 12, 1080], JSON.stringify(m.cuerpo));
  const b = await api('admin', 'DELETE', `/api/ventas/pedidos/${ids.b}`); igual([b.estado, (await api('admin', 'GET', `/api/ventas/pedidos/${ids.b}`)).estado], [200, 404], 'se borra'); verdad((await ultimoEvento('Borró el borrador del pedido%')).detalle.includes('Distribuidora'), 'queda el rastro');
});
await prueba('Confirmar: queda el rastro, no mueve stock; uno confirmado no se modifica, no se borra ni se confirma otra vez', async () => {
  const antes = await movs();
  const r = await pedido({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '10' }, { articulo_id: SERV.id, cantidad: '2', precio_unitario: '1000' }], confirmar: true }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.P1 = r.cuerpo.id; ids.P1items = r.cuerpo.items.map((i) => i.id);
  igual([r.cuerpo.estado, await movs(), r.cuerpo.pendiente_de_remitir, r.cuerpo.acciones.remitir], ['confirmado', antes, true, true], 'no mueve stock'); const e = await ultimoEvento('Confirmó el pedido%'); igual([e.categoria, e.detalle], ['comprobantes', 'Distribuidora Sur SRL · $ 3000.00'], JSON.stringify(e));
  igual((await api('admin', 'PUT', `/api/ventas/pedidos/${ids.P1}`, { cuerpo: { tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '1' }] } })).estado, 422, 'no se modifica'); igual((await api('admin', 'DELETE', `/api/ventas/pedidos/${ids.P1}`)).estado, 422, 'no se borra');
  igual((await api('admin', 'POST', `/api/ventas/pedidos/${ids.P1}/confirmar`, { cuerpo: {} })).estado, 422, 'no se confirma dos veces');
  const b = (await pedido({ tercero_id: C1.id, items: [{ articulo_id: LECHE.id, cantidad: '1' }] })).cuerpo; const c = await api('admin', 'POST', `/api/ventas/pedidos/${b.id}/confirmar`, { cuerpo: {} }); igual([c.estado, c.cuerpo.estado], [200, 'confirmado'], 'confirmar un borrador'); ids.P2 = b.id;
});
await prueba('Validaciones: cliente, artículo, depósito, fechas y renglones', async () => {
  const mal = async (cuerpo, campo, texto_) => { const r = await pedido({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '1' }], ...cuerpo }); igual(r.estado, 422, `${campo}: ${JSON.stringify(r.cuerpo)}`); if (texto_) igual(campoF(r, campo), texto_, campo); };
  await mal({ tercero_id: prov.id }, 'tercero_id', 'el cliente no existe'); await mal({ tercero_id: 999999 }, 'tercero_id', 'el cliente no existe');
  await mal({ items: [{ articulo_id: 999999, cantidad: '1' }] }, 'items[0].articulo_id', 'el artículo no existe'); await mal({ items: [{ articulo_id: GASTO.id, cantidad: '1' }] }, 'items[0].articulo_id', 'un artículo de tipo gasto no se vende');
  await mal({ items: [{ articulo_id: PAN.id, cantidad: '1', deposito_id: 999999 }] }, 'items[0].deposito_id', 'el depósito no existe o está dado de baja'); await mal({ items: [{ cantidad: '1' }] }, 'items[0].articulo_id');
  await mal({ items: [{ articulo_id: PAN.id, cantidad: '0' }] }, 'items[0].cantidad'); await mal({ items: [] }, 'items'); await mal({ fecha: '2999-01-01' }, 'fecha', 'la fecha del pedido no puede ser futura'); await mal({ fecha: '2001-01-01' }, 'fecha', 'la fecha del pedido es de hace más de 3 años');
  await mal({ entrega_prevista: '2000-01-01' }, 'entrega_prevista', 'no puede ser anterior a la fecha del pedido');
  await q('update tercero set activo = false where id = $1', [C2.id]); await mal({ tercero_id: C2.id }, 'tercero_id', 'el cliente está dado de baja'); await q('update tercero set activo = true where id = $1', [C2.id]);
  igual((await pedido({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '1' }] }, { empresa: MT })).estado, 422, 'el cliente no es de esa empresa');
});
await prueba('Remito contra un pedido: cada renglón apunta al del pedido, toma su precio, y no se entrega más de lo que falta', async () => {
  const [pan, serv] = ids.P1items, stock = await stockDe(PAN.id);
  const mal = await remito({ pedido_id: ids.P1, items: [{ item_origen_id: pan, cantidad: '11' }] }); igual([mal.estado, campoF(mal, 'items[0].cantidad')], [422, 'solo falta entregar 10'], JSON.stringify(mal.cuerpo));
  igual(campoF(await remito({ pedido_id: ids.P1, items: [{ articulo_id: PAN.id, cantidad: '1' }] }), 'items[0].item_origen_id'), 'indicá qué renglón del pedido se entrega', 'sin renglón de origen');
  igual(campoF(await remito({ tercero_id: C1.id, items: [{ item_origen_id: pan, articulo_id: PAN.id, cantidad: '1' }] }), 'items[0].item_origen_id'), 'sin pedido no hay renglón de origen', 'origen sin pedido');
  igual(campoF(await remito({ pedido_id: ids.P1, tercero_id: C2.id, items: [{ item_origen_id: pan, cantidad: '1' }] }), 'tercero_id'), 'no es el cliente del pedido', 'otro cliente');
  igual(campoF(await remito({ pedido_id: ids.P1, items: [{ item_origen_id: ids.P1items[0] + 99999, cantidad: '1' }] }), 'items[0].item_origen_id'), 'el renglón no es de ese pedido', 'renglón ajeno');
  igual(campoF(await remito({ pedido_id: ids.P1, items: [{ item_origen_id: pan, cantidad: '1' }, { item_origen_id: pan, cantidad: '1' }] }), 'items[1].item_origen_id'), 'ese renglón está repetido', 'repetido');
  igual((await remito({ pedido_id: 999999, items: [{ item_origen_id: pan, cantidad: '1' }] })).estado, 422, 'pedido inexistente'); igual(await stockDe(PAN.id), stock, 'los rechazos no movieron stock');
  const previa = await api('admin', 'POST', '/api/ventas/remitos/calcular', { cuerpo: { pedido_id: ids.P1, items: [{ item_origen_id: pan, cantidad: '4' }] } }); verdad(previa.cuerpo.avisos.some((a) => /Quedan 1 renglón del pedido sin entregar/.test(a)), JSON.stringify(previa.cuerpo.avisos));
  const r = await remito({ pedido_id: ids.P1, items: [{ item_origen_id: pan, cantidad: '4' }], confirmar: true }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.R1 = r.cuerpo.id;
  igual([r.cuerpo.cliente, r.cuerpo.pedido.numero_formateado, Number(r.cuerpo.items[0].precio_unitario), r.cuerpo.items[0].item_origen_id, await stockDe(PAN.id)], ['Distribuidora Sur SRL', (await verP(ids.P1)).numero_formateado, 100, pan, stock - 4], JSON.stringify(r.cuerpo));
  const p = await verP(ids.P1); igual([p.items.map((i) => [Number(i.remitado), Number(i.pendiente)]), p.remitos.map((x) => [x.id, x.estado]), p.pendiente_de_remitir], [[[4, 6], [0, 2]], [[ids.R1, 'confirmado']], true], JSON.stringify(p.items));
  const mas = await remito({ pedido_id: ids.P1, items: [{ item_origen_id: pan, cantidad: '7' }] }); igual(campoF(mas, 'items[0].cantidad'), 'solo falta entregar 6', 'lo ya entregado se descuenta');
  const r2 = await remito({ pedido_id: ids.P1, items: [{ item_origen_id: pan, cantidad: '6' }, { item_origen_id: serv, cantidad: '2' }], confirmar: true }); igual(r2.estado, 201, JSON.stringify(r2.cuerpo)); ids.R2 = r2.cuerpo.id;
  const c = await verP(ids.P1); igual([c.pendiente_de_remitir, c.acciones.remitir, c.items.map((i) => Number(i.pendiente))], [false, false, [0, 0]], 'pedido cumplido');
  igual(campoF(await remito({ pedido_id: ids.P1, items: [{ item_origen_id: pan, cantidad: '1' }] }), 'items[0].cantidad'), 'ese renglón ya se entregó completo', 'ya no queda nada');
  igual([(await api('admin', 'GET', '/api/ventas/pedidos?pendiente=true')).cuerpo.datos.some((x) => x.id === ids.P1), (await api('admin', 'GET', '/api/ventas/pedidos?pendiente=false')).cuerpo.datos.some((x) => x.id === ids.P1)], [false, true], 'el filtro de pendientes');
  igual((await api('admin', 'GET', `/api/ventas/remitos?pedido_id=${ids.P1}`)).cuerpo.total, 2, 'los remitos del pedido');
});
await prueba('Pedido borrador o anulado no se remita; modificar un borrador de remito conserva el vínculo; la base impide entregar de más', async () => {
  const b = (await pedido({ tercero_id: C1.id, items: [{ articulo_id: LECHE.id, cantidad: '2' }] })).cuerpo;
  igual(campoF(await remito({ pedido_id: b.id, items: [{ item_origen_id: b.items[0].id, cantidad: '1' }] }), 'pedido_id'), 'el pedido todavía es un borrador: hay que confirmarlo', 'borrador'); await api('admin', 'DELETE', `/api/ventas/pedidos/${b.id}`);
  const x = (await pedido({ tercero_id: C1.id, items: [{ articulo_id: LECHE.id, cantidad: '2' }], confirmar: true })).cuerpo; await anularP(x.id);
  igual(campoF(await remito({ pedido_id: x.id, items: [{ item_origen_id: x.items[0].id, cantidad: '1' }] }), 'pedido_id'), 'el pedido está anulado', 'anulado');
  const P3 = (await pedido({ tercero_id: C1.id, items: [{ articulo_id: LECHE.id, cantidad: '2' }], confirmar: true })).cuerpo; ids.P3 = P3.id; const it = P3.items[0].id;
  const rb = (await remito({ pedido_id: P3.id, items: [{ item_origen_id: it, cantidad: '1' }] })).cuerpo; const m = await api('admin', 'PUT', `/api/ventas/remitos/${rb.id}`, { cuerpo: { pedido_id: P3.id, items: [{ item_origen_id: it, cantidad: '2' }] } });
  igual([m.estado, m.cuerpo.pedido.id, Number(m.cuerpo.items[0].cantidad)], [200, P3.id, 2], JSON.stringify(m.cuerpo)); await api('admin', 'DELETE', `/api/ventas/remitos/${rb.id}`);
  const rb2 = (await remito({ pedido_id: P3.id, items: [{ item_origen_id: it, cantidad: '1' }] })).cuerpo;
  const msg = async (sql) => { try { await q(sql); return ''; } catch (e) { return e.message; } };
  const mm = await msg(`do $$ begin update documento_item set cantidad = 5 where documento_id = ${rb2.id}; update documento_comercial set estado = 'confirmado' where id = ${rb2.id}; end $$`); verdad(/se remite 5(.0+)? y el documento de origen solo pide 2/.test(mm), 'la base impide la sobre-entrega: ' + mm);
  igual((await verR(rb2.id)).estado, 'borrador', 'quedó como estaba'); await api('admin', 'DELETE', `/api/ventas/remitos/${rb2.id}`);
});
await prueba('Facturar lo remitido: el pedido muestra lo facturado; anular remitos devuelve el pendiente; el pedido no se anula con remitos vigentes', async () => {
  const rem = await verR(ids.R1); const f = await factura({ items: [{ documento_item_id: rem.items[0].id, cantidad: '4' }] }); igual(f.estado, 201, JSON.stringify(f.cuerpo)); ids.F1 = f.cuerpo.id;
  const p = await verP(ids.P1); igual(p.items.map((i) => Number(i.facturado)), [4, 0], 'el pedido muestra lo facturado a través del remito');
  const bloqueo = await anularP(ids.P1); igual([bloqueo.estado, bloqueo.cuerpo.error.mensaje], [422, 'El pedido ya tiene remitos de salida: anulá primero esos remitos.'], JSON.stringify(bloqueo.cuerpo));
  igual((await anularR(ids.R1)).estado, 422, 'el remito facturado no se anula'); igual((await api('admin', 'POST', `/api/comprobantes/${ids.F1}/anular`, { cuerpo: { motivo: 'Error de carga' } })).estado, 200, 'anula la factura');
  const stock = await stockDe(PAN.id); igual((await anularR(ids.R2)).estado, 200, 'anula el remito 2'); igual((await anularR(ids.R1)).estado, 200, 'anula el remito 1'); igual(await stockDe(PAN.id), stock + 10, 'volvieron 10 al depósito');
  const q2 = await verP(ids.P1); igual([q2.items.map((i) => Number(i.pendiente)), q2.pendiente_de_remitir, q2.acciones.remitir], [[10, 2], true, true], 'el pedido vuelve a tener todo pendiente');
  const a = await anularP(ids.P1, 'El cliente canceló'); igual([a.estado, a.cuerpo.estado], [200, 'anulado'], JSON.stringify(a.cuerpo)); verdad((await ultimoEvento('Anuló el pedido%')).detalle.includes('motivo: El cliente canceló'), 'queda el rastro');
  igual((await anularP(ids.P1)).estado, 422, 'no se anula dos veces'); igual((await api('admin', 'POST', `/api/ventas/pedidos/${ids.P1}/anular`, { cuerpo: {} })).estado, 422, 'pide motivo');
  const bd = (await pedido({ tercero_id: C1.id, items: [{ articulo_id: LECHE.id, cantidad: '1' }] })).cuerpo; igual((await anularP(bd.id)).estado, 422, 'un borrador se borra'); await api('admin', 'DELETE', `/api/ventas/pedidos/${bd.id}`);
  igual((await api('admin', 'GET', '/api/ventas/pedidos?estado=anulado')).cuerpo.datos.some((x) => x.id === ids.P1), true, 'el filtro por estado'); igual((await api('admin', 'GET', `/api/ventas/pedidos?tercero_id=${C2.id}`)).cuerpo.total, 0, 'otro cliente: nada');
});
await prueba('Trazabilidad: la cadena sigue íntegra', async () => {
  for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena ${e}`);
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
