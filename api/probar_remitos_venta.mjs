// Pruebas de remitos de salida (venta): borrador y confirmación, stock que sale y vuelve al anular, tope por lo que hay, y la factura de venta contra el remito (toma cantidad y precio,
// no vuelve a descontar el stock, no factura más de lo entregado) con las defensas de la base. Con --pg pasan por el adaptador de producción.
// Uso:  node api/probar_remitos_venta.mjs [--pg]
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
const saldoCli = async (id, empresa = RI) => (await api('admin', 'GET', `/api/clientes/${id}`, { empresa })).cuerpo.saldo;
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
const SINPRECIO = await art('SINP', 'Sin precio en lista', {});
const GASTO = await art('GAS', 'Gasto interno', { tipo: 'gasto' });
for (const a of [PAN, LECHE, SINPRECIO]) await api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: a.id, deposito_id: DEP, tipo: 'ingreso', cantidad: a === PAN ? '100' : '20', motivo: 'Inventario inicial' } });

// --- atajos
const remito = (cuerpo, o = {}) => api(o.quien ?? 'admin', 'POST', '/api/ventas/remitos', { cuerpo, empresa: o.empresa });
const verR = async (id, empresa = RI) => (await api('admin', 'GET', `/api/ventas/remitos/${id}`, { empresa })).cuerpo;
const pendientes = async (cliente = C1.id, empresa = RI) => (await api('admin', 'GET', `/api/ventas/remitos/pendientes-facturar?tercero_id=${cliente}`, { empresa })).cuerpo.datos;
const factura = (cuerpo, o = {}) => api(o.quien ?? 'admin', 'POST', '/api/ventas/facturas', { cuerpo: { tercero_id: C1.id, fecha: hoy, ...cuerpo }, empresa: o.empresa });
const anularF = (id, motivo = 'Error de carga') => api('admin', 'POST', `/api/comprobantes/${id}/anular`, { cuerpo: { motivo } });
const anularR = (id, motivo = 'Se entregó por error') => api('admin', 'POST', `/api/ventas/remitos/${id}/anular`, { cuerpo: { motivo } });

// ---------------------------------------------------------------------------
await prueba('Permisos y aislamiento: la consulta ve los remitos pero no los carga ni los anula; otra empresa no los ve', async () => {
  igual((await api('consulta', 'GET', '/api/ventas/remitos')).estado, 200, 'la consulta los ve');
  for (const [m, r, c] of [['POST', '/api/ventas/remitos', { tercero_id: C1.id, items: [] }], ['POST', '/api/ventas/remitos/calcular', {}], ['POST', '/api/ventas/remitos/1/anular', { motivo: 'xxx' }], ['DELETE', '/api/ventas/remitos/1', undefined]])
    igual((await api('consulta', m, r, { cuerpo: c })).estado, 403, `la consulta no puede ${m} ${r}`);
  igual((await api('admin', 'GET', '/api/ventas/remitos', { empresa: MT })).cuerpo.total, 0, 'otra empresa: lista vacía');
  igual((await api('admin', 'GET', '/api/ventas/remitos/pendientes-facturar')).estado, 422, 'pide el cliente');
  igual((await api('admin', 'GET', '/api/ventas/remitos/999999')).estado, 404, 'inexistente');
});
await prueba('Calcular y guardar un borrador: el precio sale de la lista, no mueve stock y se puede modificar y borrar', async () => {
  const previa = await api('admin', 'POST', '/api/ventas/remitos/calcular', { cuerpo: { tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '10' }, { articulo_id: SERV.id, cantidad: '1' }] } });
  igual(previa.estado, 200, JSON.stringify(previa.cuerpo)); igual([previa.cuerpo.items.map((x) => [Number(x.precio_unitario), Number(x.importe), x.mueve_stock]), Number(previa.cuerpo.total)], [[[100, 1000, true], [1000, 1000, false]], 2000], JSON.stringify(previa.cuerpo));
  const antes = await movs();
  const r = await remito({ tercero_id: C1.id, observaciones: 'Entrega en depósito', items: [{ articulo_id: PAN.id, cantidad: '10' }] }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.b = r.cuerpo.id;
  igual([r.cuerpo.estado, r.cuerpo.numero_formateado, r.cuerpo.cliente, Number(r.cuerpo.total), r.cuerpo.acciones.anular, r.cuerpo.acciones.confirmar], ['borrador', '0001-00000001', 'Distribuidora Sur SRL', 1000, false, true], JSON.stringify(r.cuerpo));
  igual([await movs(), await stockDe(PAN.id)], [antes, 100], 'un borrador no mueve stock');
  const m = await api('admin', 'PUT', `/api/ventas/remitos/${ids.b}`, { cuerpo: { tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '12', precio_unitario: '90' }] } }); igual([m.estado, Number(m.cuerpo.items[0].cantidad), Number(m.cuerpo.total)], [200, 12, 1080], JSON.stringify(m.cuerpo));
  const b = await api('admin', 'DELETE', `/api/ventas/remitos/${ids.b}`); igual([b.estado, (await api('admin', 'GET', `/api/ventas/remitos/${ids.b}`)).estado], [200, 404], 'se borra');
  verdad((await ultimoEvento('Borró el borrador del remito%')).detalle.includes('Distribuidora'), 'queda el rastro');
});
await prueba('Confirmar: la mercadería sale del depósito y el rastro lo cuenta; un confirmado no se modifica ni se borra', async () => {
  const r = await remito({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '10' }, { articulo_id: SERV.id, cantidad: '1' }], confirmar: true }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.R1 = r.cuerpo.id;
  igual([r.cuerpo.estado, await stockDe(PAN.id)], ['confirmado', 90], 'salen 10 (el servicio no mueve stock)');
  const mov = (await api('admin', 'GET', `/api/stock/movimientos?articulo_id=${PAN.id}&limite=1`)).cuerpo.datos[0]; igual([mov.tipo, Number(mov.cantidad)], ['venta', -10], JSON.stringify(mov));
  const e = await ultimoEvento('Entregó mercadería%'); igual([e.categoria, e.detalle], ['stock', 'Distribuidora Sur SRL'], JSON.stringify(e));
  igual((await api('admin', 'PUT', `/api/ventas/remitos/${ids.R1}`, { cuerpo: { tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '1' }] } })).estado, 422, 'no se modifica'); igual((await api('admin', 'DELETE', `/api/ventas/remitos/${ids.R1}`)).estado, 422, 'no se borra');
  igual((await api('admin', 'POST', `/api/ventas/remitos/${ids.R1}/confirmar`, { cuerpo: {} })).estado, 422, 'no se confirma dos veces');
  const b = (await remito({ tercero_id: C1.id, items: [{ articulo_id: LECHE.id, cantidad: '5' }] })).cuerpo; const c = await api('admin', 'POST', `/api/ventas/remitos/${b.id}/confirmar`, { cuerpo: {} }); igual([c.estado, c.cuerpo.estado, await stockDe(LECHE.id)], [200, 'confirmado', 15], 'confirmar un borrador'); ids.R2 = b.id;
});
await prueba('No se entrega más de lo que hay: ni en un renglón, ni sumando renglones, ni al confirmar un borrador cargado antes', async () => {
  const antes = await stockDe(PAN.id), n = await movs();
  const uno_ = await remito({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '91' }] }); igual([uno_.estado, campoF(uno_, 'items[0].cantidad')], [422, 'no hay tanta mercadería en el depósito (hay 90 de Pan lactal)'], JSON.stringify(uno_.cuerpo));
  const dos = await remito({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '50' }, { articulo_id: PAN.id, cantidad: '50' }] }); igual([dos.estado, campoF(dos, 'items[1].cantidad')], [422, 'no hay tanta mercadería en el depósito (hay 90 de Pan lactal)'], 'los renglones se suman');
  const b = (await remito({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '80' }] })).cuerpo; const otro = (await remito({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '80' }], confirmar: true })).cuerpo; igual(otro.estado, 'confirmado', 'el primero sale');
  const c = await api('admin', 'POST', `/api/ventas/remitos/${b.id}/confirmar`, { cuerpo: {} }); igual([c.estado, c.cuerpo.error.codigo], [422, 'stock_insuficiente'], 'al confirmar ya no alcanza'); verdad(/hay 10 y se entregan 80/.test(c.cuerpo.error.mensaje), c.cuerpo.error.mensaje);
  await api('admin', 'DELETE', `/api/ventas/remitos/${b.id}`); await anularR(otro.id, 'Para probar'); igual([await stockDe(PAN.id), antes, n >= 0], [antes, antes, true], 'el stock quedó como estaba');
  await q('update empresa_parametro set permite_stock_negativo = true where empresa_id = $1', [RI]);
  const neg = await remito({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '95' }], confirmar: true }); igual([neg.estado, await stockDe(PAN.id)], [201, -5], 'con stock negativo permitido se entrega igual'); await anularR(neg.cuerpo.id, 'Para probar'); await q('update empresa_parametro set permite_stock_negativo = false where empresa_id = $1', [RI]);
});
await prueba('Validaciones: cliente, artículo, depósito, fecha y renglones', async () => {
  const mal = async (cuerpo, campo, texto_) => { const r = await remito({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '1' }], ...cuerpo }); igual(r.estado, 422, `${campo}: ${JSON.stringify(r.cuerpo)}`); if (texto_) igual(campoF(r, campo), texto_, campo); };
  await mal({ tercero_id: prov.id }, 'tercero_id', 'el cliente no existe'); await mal({ tercero_id: 999999 }, 'tercero_id', 'el cliente no existe');
  await mal({ items: [{ articulo_id: 999999, cantidad: '1' }] }, 'items[0].articulo_id', 'el artículo no existe'); await mal({ items: [{ articulo_id: GASTO.id, cantidad: '1' }] }, 'items[0].articulo_id', 'un artículo de tipo gasto no se entrega');
  await mal({ items: [{ articulo_id: PAN.id, cantidad: '1', deposito_id: 999999 }] }, 'items[0].deposito_id', 'el depósito no existe o está dado de baja');
  await mal({ items: [{ articulo_id: PAN.id, cantidad: '0' }] }, 'items[0].cantidad'); await mal({ items: [] }, 'items'); await mal({ fecha: '2999-01-01' }, 'fecha', 'la fecha del remito no puede ser futura');
  await mal({ fecha: '2001-01-01' }, 'fecha', 'la fecha del remito es de hace más de 3 años');
  await q('update tercero set activo = false where id = $1', [C2.id]); await mal({ tercero_id: C2.id }, 'tercero_id', 'el cliente está dado de baja'); await q('update tercero set activo = true where id = $1', [C2.id]);
  igual((await remito({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '1' }] }, { empresa: MT })).estado, 422, 'el cliente no es de esa empresa');
  const sinP = await remito({ tercero_id: C1.id, items: [{ articulo_id: LECHE.id, cantidad: '1', precio_unitario: '0' }] }); igual(sinP.estado, 201, 'un remito sin precio se acepta'); verdad(sinP.cuerpo.avisos.some((a) => /sin precio/.test(a)), 'avisa que falta el precio'); await api('admin', 'DELETE', `/api/ventas/remitos/${sinP.cuerpo.id}`);
});
await prueba('Anular un remito: la mercadería vuelve al depósito; pide motivo; un borrador no se anula', async () => {
  const antes = await stockDe(LECHE.id);
  igual((await api('admin', 'POST', `/api/ventas/remitos/${ids.R2}/anular`, { cuerpo: {} })).estado, 422, 'pide motivo');
  const a = await anularR(ids.R2, 'El cliente no lo recibió'); igual([a.estado, a.cuerpo.estado, await stockDe(LECHE.id)], [200, 'anulado', antes + 5], JSON.stringify(a.cuerpo));
  const mov = (await api('admin', 'GET', `/api/stock/movimientos?articulo_id=${LECHE.id}&limite=1`)).cuerpo.datos[0]; igual([mov.tipo, Number(mov.cantidad)], ['devolucion_venta', 5], JSON.stringify(mov));
  igual((await anularR(ids.R2)).estado, 422, 'no se anula dos veces'); const b = (await remito({ tercero_id: C1.id, items: [{ articulo_id: LECHE.id, cantidad: '1' }] })).cuerpo; igual((await anularR(b.id)).estado, 422, 'un borrador se borra'); await api('admin', 'DELETE', `/api/ventas/remitos/${b.id}`);
  verdad((await ultimoEvento('Anuló el remito de salida%')).detalle.includes('motivo: El cliente no lo recibió'), 'queda el rastro');
  const l = (await api('admin', 'GET', '/api/ventas/remitos?estado=anulado')).cuerpo; igual(l.datos.some((x) => x.id === ids.R2), true, 'el filtro por estado lo encuentra'); igual((await api('admin', 'GET', `/api/ventas/remitos?tercero_id=${C2.id}`)).cuerpo.total, 0, 'otro cliente: nada');
});
await prueba('Lo que se puede facturar: renglones con lo entregado, lo ya facturado y lo que falta, por cliente', async () => {
  const NR1 = (await verR(ids.R1)).numero_formateado; const p = await pendientes(); igual(p.map((x) => [x.remito, x.descripcion, Number(x.entregado), Number(x.facturado), Number(x.facturable), Number(x.precio)]), [[NR1, 'Pan lactal', 10, 0, 10, 100], [NR1, 'Servicio de entrega', 1, 0, 1, 1000]], JSON.stringify(p));
  igual((await pendientes(C2.id)).length, 0, 'otro cliente: nada'); igual((await pendientes(C1.id, MT)).length, 0, 'otra empresa: nada');
});
await prueba('Facturar un remito: la factura toma cantidad y precio del remito, genera la cuenta corriente y NO vuelve a descontar el stock', async () => {
  const [pan, serv] = (await verR(ids.R1)).items; ids.itPan = pan.id; ids.itServ = serv.id;
  const antes = await movs(), saldo = Number(await saldoCli(C1.id)), stock = await stockDe(PAN.id);
  const previa = await api('admin', 'POST', '/api/ventas/facturas/calcular', { cuerpo: { tercero_id: C1.id, fecha: hoy, items: [{ documento_item_id: pan.id, cantidad: '10' }] } });
  igual([previa.estado, previa.cuerpo.items[0].del_remito, Number(previa.cuerpo.items[0].precio_unitario), Number(previa.cuerpo.imp_neto), Number(previa.cuerpo.imp_total)], [200, true, 100, 1000, 1105], JSON.stringify(previa.cuerpo)); verdad(previa.cuerpo.avisos.some((a) => /no la vuelve a descontar/.test(a)), 'avisa que no descuenta');
  const r = await factura({ items: [{ documento_item_id: pan.id, cantidad: '10' }] }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.F1 = r.cuerpo.id;
  igual([await movs(), await stockDe(PAN.id)], [antes, stock], 'no hay movimientos nuevos: el stock no se descuenta dos veces'); igual(Number(await saldoCli(C1.id)) - saldo, 1105, 'el cliente debe 1105');
  igual((await uno('select documento_item_id from comprobante_item where comprobante_id = $1', [ids.F1])).documento_item_id, pan.id, 'el renglón queda vinculado');
  const rem = await verR(ids.R1); igual([Number(rem.items[0].facturado), Number(rem.items[1].facturado), rem.facturas.map((f) => [f.tipo, f.numero_formateado])], [10, 0, [['Factura A', r.cuerpo.numero_formateado]]], JSON.stringify(rem.facturas));
  igual((await pendientes()).map((x) => x.descripcion), ['Servicio de entrega'], 'queda el servicio por facturar');
  const mixta = await factura({ items: [{ documento_item_id: serv.id, cantidad: '1', precio_unitario: '1200' }, { articulo_id: LECHE.id, cantidad: '2' }] }); igual(mixta.estado, 201, JSON.stringify(mixta.cuerpo)); ids.F2 = mixta.cuerpo.id;
  igual([Number(mixta.cuerpo.imp_neto), await stockDe(LECHE.id)], [1300, 18], 'el precio del remito se puede cambiar; el renglón común sí descuenta stock (20 − 2)');
  igual((await pendientes()).length, 0, 'todo facturado');
});
await prueba('Facturar de a partes y validaciones: no se factura más de lo entregado, y el renglón es del mismo cliente, confirmado y sin repetir', async () => {
  const R3 = (await remito({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '6' }], confirmar: true })).cuerpo; ids.R3 = R3.id; const it3 = R3.items[0].id;
  const a = await factura({ items: [{ documento_item_id: it3, cantidad: '4' }] }); igual(a.estado, 201, JSON.stringify(a.cuerpo)); ids.F3 = a.cuerpo.id;
  igual((await pendientes()).map((x) => [Number(x.facturado), Number(x.facturable)]), [[4, 2]], 'quedan 2');
  const mas = await factura({ items: [{ documento_item_id: it3, cantidad: '3' }] }); igual([mas.estado, campoF(mas, 'items[0].cantidad')], [422, 'del remito solo se pueden facturar 2 (se entregaron 6, ya se facturaron 4)'], JSON.stringify(mas.cuerpo));
  const ok = await factura({ items: [{ documento_item_id: it3, cantidad: '2' }] }); igual(ok.estado, 201, JSON.stringify(ok.cuerpo)); ids.F4 = ok.cuerpo.id;
  igual(campoF(await factura({ items: [{ documento_item_id: it3, cantidad: '1' }] }), 'items[0].cantidad'), 'ese renglón del remito ya está facturado por completo', 'ya no hay más');
  const R4 = (await remito({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '3' }], confirmar: true })).cuerpo; const it4 = R4.items[0].id;
  igual(campoF(await factura({ tercero_id: C2.id, items: [{ documento_item_id: it4, cantidad: '1' }] }), 'items[0].documento_item_id'), 'el remito es de otro cliente', 'de otro cliente');
  const RB = (await remito({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '1' }] })).cuerpo; igual(campoF(await factura({ items: [{ documento_item_id: RB.items[0].id, cantidad: '1' }] }), 'items[0].documento_item_id'), 'el remito no está confirmado', 'borrador'); await api('admin', 'DELETE', `/api/ventas/remitos/${RB.id}`);
  const RA = (await remito({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '1' }], confirmar: true })).cuerpo; await anularR(RA.id, 'Se cargó mal');
  igual(campoF(await factura({ items: [{ documento_item_id: RA.items[0].id, cantidad: '1' }] }), 'items[0].documento_item_id'), 'el remito está anulado', 'anulado');
  igual(campoF(await factura({ items: [{ documento_item_id: 999999, cantidad: '1' }] }), 'items[0].documento_item_id'), 'el renglón del remito no existe', 'inexistente');
  igual(campoF(await factura({ items: [{ documento_item_id: it4, articulo_id: LECHE.id, cantidad: '1' }] }), 'items[0].articulo_id'), 'no es el artículo del remito', 'otro artículo');
  igual(campoF(await factura({ items: [{ documento_item_id: it4, cantidad: '1' }, { documento_item_id: it4, cantidad: '1' }] }), 'items[1].documento_item_id'), 'ese renglón del remito está repetido', 'repetido');
  igual(campoF(await factura({ items: [{ cantidad: '1' }] }), 'items[0].articulo_id'), 'indicá el artículo', 'sin artículo ni remito');
  const sinCompra = await api('admin', 'POST', '/api/compras/facturas/calcular', { cuerpo: { tercero_id: prov.id, letra: 'A', punto_venta: 4, numero: 1, fecha: hoy, total: '121', items: [{ documento_item_id: it4, cantidad: '1', precio_unitario: '100' }] } }); igual(sinCompra.estado, 422, 'una compra no toma renglones de un remito de venta');
  ids.R4 = R4.id; ids.it4 = it4;
});
await prueba('Anular una factura de remito: el stock queda como estaba y el remito vuelve a poder facturarse; con la factura vigente el remito no se anula', async () => {
  const bloqueo = await anularR(ids.R1); igual([bloqueo.estado, bloqueo.cuerpo.error.mensaje], [422, 'El remito ya tiene facturas emitidas: anulá primero esas facturas.'], JSON.stringify(bloqueo.cuerpo));
  const stock = await stockDe(PAN.id), n = await movs(), saldo = Number(await saldoCli(C1.id)); const a = await anularF(ids.F1); igual(a.estado, 200, JSON.stringify(a.cuerpo));
  igual([await stockDe(PAN.id), await movs()], [stock, n], 'anular la factura no toca el stock: la mercadería sigue entregada'); igual(Math.round(saldo - Number(await saldoCli(C1.id))), 1105, 'baja la deuda');
  const nr1 = (await verR(ids.R1)).numero_formateado; igual((await pendientes()).filter((x) => x.descripcion === 'Pan lactal' && x.remito === nr1).map((x) => Number(x.facturable)), [10], 'el remito vuelve a poder facturarse'); igual(Number((await verR(ids.R1)).items[0].facturado), 0, 'no figura facturado');
  const c = await factura({ items: [{ documento_item_id: ids.itPan, cantidad: '10' }] }); igual(c.estado, 201, 'se puede facturar de nuevo'); ids.F1b = c.cuerpo.id;
  igual((await anularF(ids.F1b)).estado, 200, 'y anular'); igual((await anularF(ids.F2)).estado, 200, 'la mixta también');
  const r = await anularR(ids.R1); igual([r.estado, r.cuerpo.estado, await stockDe(PAN.id)], [200, 'anulado', stock + 10], 'sin facturas vigentes el remito se anula y la mercadería vuelve');
});
await prueba('Sin vínculo todo sigue igual y la base impide facturar de más aunque se salteen las validaciones', async () => {
  const antes = await stockDe(LECHE.id); const c = await factura({ items: [{ articulo_id: LECHE.id, cantidad: '3' }] }); igual([c.estado, await stockDe(LECHE.id)], [201, antes - 3], 'la factura común descuenta 3');
  const mensaje = async (sql) => { try { await q(sql); return ''; } catch (e) { return e.message; } };
  verdad(/se factura 7(.0+)? de un renglón de remito donde se entregó 6/.test(await mensaje(`do $$ begin perform set_config('app.migracion', 'on', true); update comprobante_item set cantidad = 5 where comprobante_id = ${ids.F3}; perform fn_verificar_factura_remito(${ids.F3}); end $$`)), 'más de lo entregado');
  verdad(/no es el mismo artículo/.test(await mensaje(`do $$ begin perform set_config('app.migracion', 'on', true); update comprobante_item set articulo_id = ${LECHE.id} where comprobante_id = ${ids.F3}; perform fn_verificar_factura_remito(${ids.F3}); end $$`)), 'otro artículo');
  verdad(/no es un remito de salida confirmado del mismo cliente/.test(await mensaje(`do $$ begin perform set_config('app.migracion', 'on', true); update comprobante set tercero_id = ${C2.id} where id = ${ids.F3}; perform fn_verificar_factura_remito(${ids.F3}); end $$`)), 'otro cliente');
});
await prueba('Nota de crédito sobre una factura de remito: la mercadería vuelve al depósito del que salió con el remito', async () => {
  const Rm = (await remito({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '8' }], confirmar: true })).cuerpo; const stock = await stockDe(PAN.id);
  const f = await factura({ items: [{ documento_item_id: Rm.items[0].id, cantidad: '8' }] }); igual(f.estado, 201, JSON.stringify(f.cuerpo)); igual(await stockDe(PAN.id), stock, 'facturar el remito no mueve stock'); const item = f.cuerpo.items[0].id;
  const nota = (cuerpo) => api('admin', 'POST', '/api/ventas/notas-credito', { cuerpo: { comprobante_origen_id: f.cuerpo.id, motivo: 'Devolución del cliente', ...cuerpo } });
  const previa = await api('admin', 'POST', '/api/ventas/notas-credito/calcular', { cuerpo: { comprobante_origen_id: f.cuerpo.id, motivo: 'Devolución del cliente', items: [{ item_id: item, cantidad: '3' }] } }); igual([previa.estado, previa.cuerpo.items[0].devuelve_stock], [200, true], 'la previa avisa que devuelve: ' + JSON.stringify(previa.cuerpo));
  const n1 = await nota({ items: [{ item_id: item, cantidad: '3' }] }); igual(n1.estado, 201, JSON.stringify(n1.cuerpo)); igual(await stockDe(PAN.id), stock + 3, 'vuelven 3 al depósito');
  const mov = (await api('admin', 'GET', `/api/stock/movimientos?articulo_id=${PAN.id}&limite=1`)).cuerpo.datos[0]; igual([mov.tipo, Number(mov.cantidad), mov.deposito_id], ['devolucion_venta', 3, DEP], JSON.stringify(mov));
  const sin = await nota({ devolver_stock: false, items: [{ item_id: item, cantidad: '2' }] }); igual(sin.estado, 201, JSON.stringify(sin.cuerpo)); igual(await stockDe(PAN.id), stock + 3, 'con devolver_stock en falso (la merca no vuelve) no cambia');
  const resto = await nota({}); igual(resto.estado, 201, JSON.stringify(resto.cuerpo)); igual(await stockDe(PAN.id), stock + 3 + 3, 'lo que faltaba acreditar (3) también vuelve');
  igual((await anularF(n1.cuerpo.id)).estado, 200, 'anular la nota'); igual(await stockDe(PAN.id), stock + 3, 'la mercadería de esa nota vuelve a salir');
  const bloqueada = await anularF(f.cuerpo.id); igual(bloqueada.estado, 422, 'una factura con notas aplicadas no se anula: el remito tampoco'); igual((await anularR(Rm.id)).estado, 422, 'el remito facturado no se anula');
});
await prueba('Trazabilidad: la cadena sigue íntegra', async () => {
  for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena ${e}`);
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
