// Pruebas de anulaciones y notas de crédito: contraasiento, stock, saldo del cliente, aplicación de la nota a la factura, acreditación parcial y
// total, límites (no se acredita más de lo facturado, no se anula lo que tiene cobros o notas) y las reglas que impone la base.
// Con --pg pasan por el adaptador de producción (pg + migrador) contra PGlite por socket.
// Uso:  node api/probar_anulaciones.mjs [--pg]
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
async function api(quien, metodo, ruta, { cuerpo, empresa = RI, clave } = {}) {
  const t = SESION[quien] ?? quien;
  const r = await fetch(srv.base + ruta, { method: metodo, headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(empresa ? { 'X-Empresa-Id': String(empresa) } : {}), ...(clave ? { 'Idempotency-Key': clave } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const texto = await r.text(); let json = null; try { json = texto ? JSON.parse(texto) : null; } catch (e) { /* no JSON */ }
  return { estado: r.status, cuerpo: json };
}
var RI = S.empresas.ri.id; const MT = S.empresas.mt.id, ADMIN = S.usuarios.admin.id, DEP = S.empresas.ri.deposito;
const ids = {};
const ultimoEvento = (patron) => uno(`select usuario_id, empresa_id, categoria, accion, detalle, resultado from evento where accion like $1 order by id desc limit 1`, [patron]);
const saldoCliente = async (id, empresa = RI) => (await api('admin', 'GET', `/api/clientes/${id}`, { empresa })).cuerpo.saldo;
const stockDe = async (articuloId, depositoId = DEP) => Number((await uno('select coalesce(sum(cantidad), 0)::text s from movimiento_stock where articulo_id = $1 and deposito_id = $2', [articuloId, depositoId])).s);
const emitir = (cuerpo, empresa = RI) => api('admin', 'POST', '/api/ventas/facturas', { cuerpo, empresa });
const nota = (cuerpo, o = {}) => api('admin', 'POST', '/api/ventas/notas-credito', { cuerpo, ...o });
const anular = (id, motivo = 'Error de carga', quien = 'admin', empresa = RI) => api(quien, 'POST', `/api/comprobantes/${id}/anular`, { cuerpo: motivo === null ? {} : { motivo }, empresa });
const detalle = async (id, empresa = RI) => (await api('admin', 'GET', `/api/comprobantes/${id}`, { empresa })).cuerpo;
/* Todo asiento de un comprobante y su contraasiento: por cuenta tiene que quedar en cero. */
const neteo = async (asientoId) => (await q(`select c.codigo, sum(l.debe - l.haber)::text neto from asiento_linea l join plan_cuenta c on c.id = l.cuenta_id
  where l.asiento_id in ($1, (select id from asiento where origen_tipo = 'contraasiento' and origen_id = $1)) group by c.codigo having sum(l.debe - l.haber) <> 0`, [asientoId]));

// --- datos de partida ---
const cli = async (doc, nombre, cond = 1, tipo = 'CUIT', empresa = RI) => (await api('admin', 'POST', '/api/clientes', { empresa, cuerpo: { tipo_documento: tipo, nro_documento: doc, razon_social: nombre, condicion_iva_codigo: cond } })).cuerpo;
const art = async (codigo, nombre, extra, empresa = RI) => { const r = await api('admin', 'POST', '/api/articulos', { empresa, cuerpo: { codigo, nombre, ...(extra.tratamiento_iva_venta === 'exento' ? {} : { alicuota_venta: '21' }), ...extra } }); if (r.estado !== 201) throw new Error(`${codigo}: ${JSON.stringify(r.cuerpo)}`); return r.cuerpo; };
const lista = (await api('admin', 'GET', '/api/listas-precio')).cuerpo.datos[0].id;
const C1 = await cli(cuitConDigito('3070811222'), 'Distribuidora Sur SRL'), C2 = await cli('27345118', 'Marta Gómez', 5, 'DNI');
const SERV = await art('SERV', 'Servicio de consultoría', { tipo: 'servicio', lista_id: lista, precio_neto: '1000' }), PAN = await art('PAN', 'Pan lactal', { alicuota_venta: '10.5', lista_id: lista, precio_neto: '100' });
const EXE = await art('SEG', 'Seguro', { tipo: 'servicio', tratamiento_iva_venta: 'exento', lista_id: lista, precio_neto: '500' });
await api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: PAN.id, deposito_id: DEP, tipo: 'ingreso', cantidad: '100', motivo: 'Inventario inicial' } });

// ---------------------------------------------------------------------------
await prueba('Permisos: anular exige ventas.anular (Administrador y Contador); emitir una nota exige ventas.emitir', async () => {
  const roles = (await api('admin', 'GET', '/api/estudio/roles')).cuerpo.datos, de = (n) => roles.find((r) => r.nombre === n).permisos;
  igual(['Administrador', 'Contador', 'Auxiliar', 'Consulta'].map((n) => de(n).includes('ventas.anular')), [true, true, false, false], 'quién lo tiene');
  const f = (await emitir({ tercero_id: C1.id, items: [{ articulo_id: SERV.id, cantidad: '1' }] })).cuerpo; ids.permisos = f.id;
  for (const quien of ['auxiliar', 'consulta']) igual((await anular(f.id, 'Prueba de permiso', quien)).cuerpo.error.codigo, 'sin_permiso', `${quien} no anula`);
  igual((await api('consulta', 'POST', '/api/ventas/notas-credito', { cuerpo: { comprobante_origen_id: f.id, motivo: 'Prueba' } })).estado, 403, 'la consulta no emite notas');
  igual((await api('auxiliar', 'POST', '/api/ventas/notas-credito/calcular', { cuerpo: { comprobante_origen_id: f.id, motivo: 'Prueba de permiso' } })).estado, 200, 'quien emite facturas puede emitir notas');
});

// ---------------------------------------------------------------------------
await prueba('Anular una factura: conserva su número, contrarresta el asiento, deja en cero el saldo del cliente y queda el motivo y el rastro', async () => {
  const f = (await emitir({ tercero_id: C1.id, items: [{ articulo_id: SERV.id, cantidad: '2' }] })).cuerpo; ids.f1 = f.id;
  const saldoAntes = await saldoCliente(C1.id); igual(f.imp_total, '2420.00', 'total de la factura');
  const d0 = await detalle(f.id); igual([d0.acciones.anular, d0.acciones.nota_credito], [null, null], 'se ofrece anular y acreditar');
  const sinMotivo = await anular(f.id, null); igual([sinMotivo.estado, 'motivo' in sinMotivo.cuerpo.error.campos], [422, true], 'el motivo es obligatorio'); igual((await anular(f.id, 'ab')).estado, 422, 'motivo muy corto');
  const r = await anular(f.id, 'Se facturó al cliente equivocado'); igual(r.estado, 200, JSON.stringify(r.cuerpo));
  igual([r.cuerpo.estado, r.cuerpo.numero_formateado, r.cuerpo.anulacion.motivo, r.cuerpo.anulacion.por], ['anulado', f.numero_formateado, 'Se facturó al cliente equivocado', 'Andrés (administrador)'], 'anulada, con su número y su motivo');
  verdad(r.cuerpo.anulacion.en, 'con fecha'); igual(r.cuerpo.acciones.anular, 'Ya está anulado.', 'ya no se ofrece'); igual(r.cuerpo.acciones.nota_credito, 'Está anulada: no hay nada que acreditar.', 'ni acreditar');
  igual(await neteo(f.asiento.id), [], 'el asiento y su contraasiento se anulan entre sí, cuenta por cuenta'); igual((await q(`select count(*)::int n from asiento where origen_tipo = 'contraasiento' and origen_id = $1`, [f.asiento.id]))[0].n, 1, 'un solo contraasiento');
  igual(await saldoCliente(C1.id), (Number(saldoAntes) - 2420).toFixed(2), 'el saldo del cliente ya no la incluye');
  const ev = await ultimoEvento('Anuló %'); igual([ev.categoria, ev.usuario_id, ev.empresa_id, ev.resultado], ['comprobantes', ADMIN, RI, 'ok'], 'evento'); verdad(/Se facturó al cliente equivocado/.test(ev.detalle) && /Factura A 0001-/.test(ev.accion), `${ev.accion} / ${ev.detalle}`);
  igual((await anular(f.id)).cuerpo.error.codigo, 'no_se_puede_anular', 'una anulada no se anula dos veces'); igual((await api('admin', 'GET', '/api/comprobantes?estado=anulado')).cuerpo.datos.map((x) => x.id), [f.id], 'figura entre las anuladas');
  verdad(/está anulado/.test((await nota({ comprobante_origen_id: f.id, motivo: 'No corresponde' })).cuerpo.error.campos.comprobante_origen_id), 'tampoco se acredita');
});
await prueba('Anular una factura con mercadería devuelve el stock al depósito; el libro registra la anulación como devolución', async () => {
  const antes = await stockDe(PAN.id);
  const f = (await emitir({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '10' }, { articulo_id: SERV.id, cantidad: '1' }] })).cuerpo;
  igual(await stockDe(PAN.id), antes - 10, 'la venta descontó');
  const r = await anular(f.id, 'Pedido cancelado por el cliente'); igual(r.estado, 200, JSON.stringify(r.cuerpo)); igual(await stockDe(PAN.id), antes, 'volvió');
  const mov = (await api('admin', 'GET', `/api/stock/movimientos?articulo_id=${PAN.id}&limite=2`)).cuerpo.datos; igual([mov[0].tipo, mov[0].cantidad, mov[1].tipo, mov[1].cantidad], ['devolucion_venta', '10.0000', 'venta', '-10.0000'], 'venta y devolución en el libro'); verdad(/Anulación de Factura A 0001-\d{8}/.test(mov[0].motivo), mov[0].motivo);
  igual(await neteo(f.asiento.id), [], 'asiento neteado'); igual((await ultimoEvento('Anuló %')).detalle.includes('devolvió 1 movimientos de stock'), true, 'el rastro dice que movió stock');
});
await prueba('No se anula con CAE (se corrige con nota de crédito), con el período cerrado, ni lo de otra empresa', async () => {
  const f = (await emitir({ tercero_id: C1.id, items: [{ articulo_id: SERV.id, cantidad: '1' }] })).cuerpo;
  await q(`update comprobante set estado = 'autorizado', cae = '70123456789012', cae_vencimiento = current_date + 10 where id = $1`, [f.id]);        // lo que dejaría ARCA al autorizar
  const a = await anular(f.id); igual([a.estado, a.cuerpo.error.codigo], [422, 'autorizado_no_se_anula'], 'con CAE'); verdad(/nota de crédito/.test(a.cuerpo.error.mensaje), a.cuerpo.error.mensaje);
  const d = await detalle(f.id); verdad(/CAE/.test(d.acciones.anular) && d.acciones.nota_credito === null, 'la pantalla no ofrece anular pero sí acreditar'); ids.autorizada = f.id;
  const g = (await emitir({ tercero_id: C1.id, items: [{ articulo_id: SERV.id, cantidad: '1' }] })).cuerpo;
  await q(`update periodo set estado = 'cerrado' where empresa_id = $1 and current_date between desde and hasta`, [RI]);
  const c = await anular(g.id); igual([c.estado, c.cuerpo.error.codigo], [422, 'periodo_no_abierto'], 'período cerrado'); igual((await detalle(g.id)).estado, 'confirmado', 'sigue como estaba');
  await q(`update periodo set estado = 'abierto' where empresa_id = $1`, [RI]); igual((await anular(g.id, 'Reintento con el período abierto')).estado, 200, 'abierto, se anula');
  igual((await anular(g.id, 'Desde otra empresa', 'admin', MT)).estado, 404, 'otra empresa: no existe'); igual((await anular(999999)).estado, 404, 'inexistente');
  let msg = ''; try { await q(`update comprobante set estado = 'anulado' where id = $1`, [f.id]); } catch (e) { msg = e.message; } verdad(/Transición de estado no permitida/.test(msg), `la base también lo impide: ${msg}`);
});

// ---------------------------------------------------------------------------
await prueba('Nota de crédito total: copia lo facturado con sus alícuotas y descuentos, da EXACTAMENTE los mismos importes, se aplica a la factura y deja todo en cero', async () => {
  const items = [{ articulo_id: SERV.id, cantidad: '3', desc_pct: '10' }, { articulo_id: PAN.id, cantidad: '12', precio_unitario: '48.17' }, { articulo_id: EXE.id, cantidad: '1' }];
  const f = (await emitir({ tercero_id: C1.id, items, desc_pie_pct: '5' })).cuerpo; ids.f2 = f.id; const sc0 = await saldoCliente(C1.id), stock0 = await stockDe(PAN.id);
  const prev = await api('admin', 'POST', '/api/ventas/notas-credito/calcular', { cuerpo: { comprobante_origen_id: f.id, motivo: 'Devolución total' } }); igual(prev.estado, 200, JSON.stringify(prev.cuerpo)); igual(prev.cuerpo.items.map((i) => i.devuelve_stock), [false, true, false], 'solo lo que salió de un depósito vuelve a él');
  igual((await detalle(f.id)).notas, [], 'el cálculo previo no guardó nada');
  const r = await nota({ comprobante_origen_id: f.id, motivo: 'Devolución total' }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); const n = r.cuerpo; ids.n2 = n.id;
  igual([n.tipo, n.letra, n.estado, n.origen.id, /^0001-0000000\d$/.test(n.numero_formateado)], ['Nota de Crédito A', 'A', 'confirmado', f.id, true], 'tipo y origen');
  for (const k of ['imp_neto', 'imp_iva', 'imp_tot_conc', 'imp_op_ex', 'imp_desc_pie', 'imp_total']) igual(n[k], f[k], `${k}: igual a la factura`);
  igual(n.ivas.map((v) => [v.alicuota, v.base_imponible, v.importe_iva]), f.ivas.map((v) => [v.alicuota, v.base_imponible, v.importe_iva]), 'IVA por alícuota idéntico'); igual(n.items.map((i) => [i.cantidad, i.precio_unitario, i.importe_renglon]), f.items.map((i) => [i.cantidad, i.precio_unitario, i.importe_renglon]), 'renglones idénticos');
  igual(n.items.map((i) => i.item_origen_id), (await detalle(f.id)).items.map((i) => i.id), 'cada renglón apunta al que acredita');
  const fd = await detalle(f.id); igual([fd.saldo, fd.items.every((i) => Number(i.por_acreditar) === 0), fd.acciones.nota_credito, fd.notas.map((x) => x.id)], ['0.00', true, 'Ya está acreditada por completo.', [n.id]], 'la factura queda saldada y acreditada'); igual(await saldoCliente(C1.id), (Number(sc0) - Number(f.imp_total)).toFixed(2), 'baja el saldo del cliente');
  igual(await stockDe(PAN.id), stock0 + 12, 'la mercadería volvió al depósito'); const mov = await uno(`select tipo, comprobante_item_id is not null as enlazado from movimiento_stock where articulo_id = $1 order by id desc limit 1`, [PAN.id]); igual([mov.tipo, mov.enlazado], ['devolucion_venta', true], 'devolución enlazada al renglón de la nota');
  const asiento = await q(`select c.codigo, l.debe::text d, l.haber::text h from asiento_linea l join plan_cuenta c on c.id = l.cuenta_id where l.asiento_id = $1 order by c.codigo`, [n.asiento.id]); const fa = await q(`select c.codigo, l.debe::text d, l.haber::text h from asiento_linea l join plan_cuenta c on c.id = l.cuenta_id where l.asiento_id = $1 order by c.codigo`, [f.asiento.id]);
  igual(asiento.map((l) => [l.codigo, l.d, l.h]), fa.map((l) => [l.codigo, l.h, l.d]), 'el asiento de la nota es el de la factura con los lados invertidos'); verdad((await uno('select abs(sum(debe) - sum(haber))::text d from asiento_linea where asiento_id = $1', [n.asiento.id])).d === '0.00', 'balancea');
  const ev = await ultimoEvento('Emitió Nota de Crédito%'); verdad(/acredita Factura A 0001-\d{8} · motivo: Devolución total/.test(ev.detalle), ev.detalle);
  const otra = await nota({ comprobante_origen_id: f.id, motivo: 'Otra vez' }); igual([otra.estado, otra.cuerpo.error.codigo], [422, 'ya_acreditada'], 'no se acredita dos veces');
});
await prueba('Anular una nota de crédito: deshace la aplicación, vuelve a sacar la mercadería y la factura recupera su saldo; una factura con notas no se anula', async () => {
  const f = await detalle(ids.f2), stock0 = await stockDe(PAN.id), sc0 = await saldoCliente(C1.id);
  const bloq = await anular(ids.f2, 'Intento con nota aplicada'); igual([bloq.estado, bloq.cuerpo.error.codigo], [422, 'no_se_puede_anular'], 'la factura con una nota vigente no se anula'); verdad(/notas de crédito aplicadas/.test(bloq.cuerpo.error.mensaje), bloq.cuerpo.error.mensaje); verdad(/notas de crédito/.test(f.acciones.anular), 'la pantalla lo explica');
  let msg = ''; try { await q(`update comprobante set estado = 'anulado' where id = $1`, [ids.f2]); } catch (e) { msg = e.message; } verdad(/notas de crédito aplicadas/.test(msg), `la base también: ${msg}`);
  const r = await anular(ids.n2, 'La nota se emitió por error'); igual(r.estado, 200, JSON.stringify(r.cuerpo)); igual(r.cuerpo.estado, 'anulado', 'anulada');
  const fd = await detalle(ids.f2); igual([fd.saldo, Number(fd.items[0].por_acreditar) > 0, fd.acciones.nota_credito, fd.notas.map((x) => x.estado)], [f.imp_total, true, null, ['anulado']], 'la factura vuelve a deber y a poder acreditarse'); igual(await saldoCliente(C1.id), (Number(sc0) + Number(f.imp_total)).toFixed(2), 'el saldo del cliente también');
  igual(await stockDe(PAN.id), stock0 - 12, 'la mercadería que había vuelto sale otra vez'); igual(await neteo(ids.n2 && (await detalle(ids.n2)).asiento.id), [], 'la nota y su contraasiento se netean');
  const n2 = await nota({ comprobante_origen_id: ids.f2, motivo: 'Ahora sí, la correcta' }); igual(n2.estado, 201, JSON.stringify(n2.cuerpo)); ids.n2b = n2.cuerpo.id;
  const nuevamente = await anular(ids.n2b, 'Se deshace de nuevo'); igual(nuevamente.estado, 200, 'se puede anular la nota nueva'); const g = await anular(ids.f2, 'Ahora la factura sin notas vigentes'); igual(g.estado, 200, JSON.stringify(g.cuerpo));
  igual(await neteo((await detalle(ids.f2)).asiento.id), [], 'factura anulada y neteada'); igual(await saldoCliente(C1.id), (Number(sc0)).toFixed(2), 'el saldo del cliente vuelve a lo anterior (sin la factura ni sus notas)');
});
await prueba('No se anula una nota de crédito si la mercadería que devolvió ya no está; ni se acredita más de lo facturado', async () => {
  const f = (await emitir({ tercero_id: C1.id, items: [{ articulo_id: PAN.id, cantidad: '20' }] })).cuerpo, n = (await nota({ comprobante_origen_id: f.id, motivo: 'Devolución de todo' })).cuerpo;
  await api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: PAN.id, deposito_id: DEP, tipo: 'conteo', cantidad: '5', motivo: 'Conteo: se vendió y se perdió mercadería' } });
  const r = await anular(n.id, 'Intento de anular la nota'); igual([r.estado, r.cuerpo.error.codigo], [422, 'stock_insuficiente'], 'la mercadería ya no está'); verdad(/ya no está en el depósito/.test(r.cuerpo.error.mensaje), r.cuerpo.error.mensaje); igual((await detalle(n.id)).estado, 'confirmado', 'la nota sigue vigente');
  await api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: PAN.id, deposito_id: DEP, tipo: 'conteo', cantidad: '200', motivo: 'Reposición para seguir probando' } });
});

// ---------------------------------------------------------------------------
await prueba('Nota de crédito parcial: acredita las cantidades que se piden, a precio y descuento de la factura, y lleva la cuenta de lo que queda', async () => {
  const f = (await emitir({ tercero_id: C2.id, items: [{ articulo_id: PAN.id, cantidad: '10', desc_pct: '10' }] })).cuerpo; ids.f3 = f.id; const orig = (await detalle(f.id)).items[0];
  igual(f.letra, 'B', 'a un consumidor final'); const stock0 = await stockDe(PAN.id);
  const calc = await api('admin', 'POST', '/api/ventas/notas-credito/calcular', { cuerpo: { comprobante_origen_id: f.id, motivo: 'Dos unidades dañadas', items: [{ item_id: orig.id, cantidad: '3' }] } });
  igual([calc.cuerpo.letra, calc.cuerpo.items[0].importe_renglon, calc.cuerpo.imp_total], ['B', '270.0000', '298.35'], '3 × 100 con 10 % de descuento = 270 + IVA 10,5 % = 298,35');
  const r1 = await nota({ comprobante_origen_id: f.id, motivo: 'Dos unidades dañadas', items: [{ item_id: orig.id, cantidad: '3' }] }); igual([r1.estado, r1.cuerpo.tipo, r1.cuerpo.imp_total], [201, 'Nota de Crédito B', '298.35'], JSON.stringify(r1.cuerpo));
  const d1 = await detalle(f.id); igual([d1.items[0].acreditado, d1.items[0].por_acreditar, d1.saldo], ['3.0000', '7.0000', (Number(f.imp_total) - 298.35).toFixed(2)], 'acreditado, por acreditar y saldo'); igual(await stockDe(PAN.id), stock0 + 3, 'volvieron 3');
  const mal = async (items, campo, texto) => { const x = await nota({ comprobante_origen_id: f.id, motivo: 'Prueba de límites', items }); igual(x.estado, 422, JSON.stringify(x.cuerpo)); verdad(texto.test(x.cuerpo.error.campos[campo]), `${campo}: ${x.cuerpo.error.campos[campo]}`); };
  await mal([{ item_id: orig.id, cantidad: '8' }], 'items[0].cantidad', /hasta 7/); await mal([{ item_id: 99999, cantidad: '1' }], 'items[0].item_id', /no pertenece/); await mal([{ item_id: orig.id, cantidad: '1' }, { item_id: orig.id, cantidad: '1' }], 'items[1].item_id', /repetido/);
  await mal([{ item_id: orig.id, cantidad: '0' }], 'items[0].cantidad', /al menos|mayor|0,0001|0.0001/);
  const r2 = await nota({ comprobante_origen_id: f.id, motivo: 'Sin devolver mercadería', devolver_stock: false, items: [{ item_id: orig.id, cantidad: '2' }] }); igual(r2.estado, 201, 'otra parcial'); igual(await stockDe(PAN.id), stock0 + 3, 'sin devolver_stock no se toca el stock');
  const r3 = await nota({ comprobante_origen_id: f.id, motivo: 'El resto' }); igual([r3.estado, r3.cuerpo.items[0].cantidad], [201, '5.0000'], 'sin items acredita lo que queda'); igual(Number(r1.cuerpo.imp_total) + Number(r2.cuerpo.imp_total) + Number(r3.cuerpo.imp_total) <= Number(f.imp_total) + 0.02, true, 'entre todas no pasan de lo facturado (salvo centavos de redondeo)');
  igual((await detalle(f.id)).acciones.nota_credito, 'Ya está acreditada por completo.', 'completa');
});
await prueba('Nota de crédito: cada letra usa la suya (C para el monotributo), exige fecha, período y punto de venta válidos, y no se acredita una nota', async () => {
  const cliMT = await cli(cuitConDigito('3070811222'), 'Cliente de la Espiga', 1, 'CUIT', MT), artMT = await art('PAN-MT', 'Pan', { controla_stock: false, lista_id: (await api('admin', 'GET', '/api/listas-precio', { empresa: MT })).cuerpo.datos[0].id, precio_neto: '1000' }, MT);
  const fc = (await emitir({ tercero_id: cliMT.id, items: [{ articulo_id: artMT.id, cantidad: '2' }] }, MT)).cuerpo; igual(fc.letra, 'C', 'factura C');
  const nc = await nota({ comprobante_origen_id: fc.id, motivo: 'Descuento posterior' }, { empresa: MT }); igual([nc.estado, nc.cuerpo.tipo, nc.cuerpo.imp_iva, nc.cuerpo.imp_total], [201, 'Nota de Crédito C', '0.00', '2000.00'], JSON.stringify(nc.cuerpo));
  const f = (await emitir({ tercero_id: C1.id, items: [{ articulo_id: SERV.id, cantidad: '1' }] })).cuerpo;
  const err = async (extra, campo) => { const x = await nota({ comprobante_origen_id: f.id, motivo: 'Prueba de validación', ...extra }); igual(x.estado, 422, `${campo}: ${JSON.stringify(x.cuerpo)}`); verdad(campo in x.cuerpo.error.campos, `${campo} en ${JSON.stringify(x.cuerpo.error.campos)}`); };
  await err({ fecha: '2000-01-01' }, 'fecha'); await err({ fecha: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) }, 'fecha'); await err({ motivo: 'ab' }, 'motivo'); await err({ comprobante_origen_id: undefined }, 'comprobante_origen_id'); await err({ otro: 1 }, 'otro');
  await q(`update periodo set estado = 'cerrado' where empresa_id = $1 and current_date between desde and hasta`, [RI]); await err({}, 'fecha'); await q(`update periodo set estado = 'abierto' where empresa_id = $1`, [RI]);
  const sobreNota = await nota({ comprobante_origen_id: ids.n2b, motivo: 'Acreditar una nota' }); igual(sobreNota.cuerpo.error.campos.comprobante_origen_id, 'solo se acredita una factura o una nota de débito de venta', 'una nota anulada'); const notaVigente = (await nota({ comprobante_origen_id: f.id, motivo: 'Una vigente' })).cuerpo;
  igual((await nota({ comprobante_origen_id: notaVigente.id, motivo: 'Acreditar una nota' })).cuerpo.error.campos.comprobante_origen_id, 'solo se acredita una factura o una nota de débito de venta', 'una nota de crédito no se acredita');
  igual((await nota({ comprobante_origen_id: f.id, motivo: 'De otra empresa' }, { empresa: MT })).cuerpo.error.campos.comprobante_origen_id, 'la factura no existe', 'la factura de otra empresa no existe');
  await q(`update punto_venta set sistema = 'ws_factura' where empresa_id = $1 and numero = 1`, [RI]); const pv = await nota({ comprobante_origen_id: ids.autorizada, motivo: 'Punto de venta electrónico' }); await q(`update punto_venta set sistema = 'interno' where empresa_id = $1 and numero = 1`, [RI]);
  igual([pv.estado, pv.cuerpo.error.codigo], [409, 'arca_pendiente'], 'por ARCA todavía no');
  const sobreAut = await nota({ comprobante_origen_id: ids.autorizada, motivo: 'Corrige una factura con CAE' }); igual([sobreAut.estado, sobreAut.cuerpo.tipo], [201, 'Nota de Crédito A'], 'una factura con CAE se corrige con una nota');
});
await prueba('Idempotencia de las notas: un reintento no emite dos veces', async () => {
  const f = (await emitir({ tercero_id: C1.id, items: [{ articulo_id: SERV.id, cantidad: '2' }] })).cuerpo, cuerpo = { comprobante_origen_id: f.id, motivo: 'Por un doble clic' };
  const a = await nota(cuerpo, { clave: 'nc-prueba-0001-xyz' }), b = await nota(cuerpo, { clave: 'nc-prueba-0001-xyz' });
  igual([a.estado, b.estado, b.cuerpo.repetido, b.cuerpo.id === a.cuerpo.id], [201, 200, true, true], 'misma clave, mismo pedido'); igual((await detalle(f.id)).notas.length, 1, 'una sola nota');
  igual((await nota({ ...cuerpo, motivo: 'Otro motivo distinto' }, { clave: 'nc-prueba-0001-xyz' })).cuerpo.error.codigo, 'clave_reutilizada', 'misma clave, otro pedido'); igual((await nota(cuerpo, { clave: 'corta' })).estado, 422, 'clave inválida');
});

// ---------------------------------------------------------------------------
await prueba('Cobros: una factura cobrada no se anula (se avisa y la base lo impide); una nota mayor que el saldo deja saldo a favor', async () => {
  const f = (await emitir({ tercero_id: C2.id, items: [{ articulo_id: SERV.id, cantidad: '1' }] })).cuerpo;
  const caja = await uno(`insert into caja (empresa_id, nombre, cuenta_contable_id) values ($1, 'Caja de pruebas', (select id from plan_cuenta where empresa_id = $1 and codigo = '1.1.1')) returning id`, [RI]);
  const pago = await uno(`insert into pago (empresa_id, sentido, fecha, tercero_id, total_medios, total_imputado, numero) values ($1, 'cobro', current_date, $2, 800, 800, 1) returning id`, [RI, C2.id]);
  await q(`insert into pago_medio (empresa_id, pago_id, medio, caja_id, importe) values ($1, $2, 'efectivo', $3, 800)`, [RI, pago.id, caja.id]); await q(`insert into pago_imputacion (empresa_id, pago_id, comprobante_id, importe) values ($1, $2, $3, 800)`, [RI, pago.id, f.id]);
  await q(`update pago set estado = 'confirmado' where id = $1`, [pago.id]);
  const d = await detalle(f.id); igual(d.saldo, (Number(f.imp_total) - 800).toFixed(2), 'cobrada en parte'); verdad(/cobros imputados/.test(d.acciones.anular), d.acciones.anular);
  const r = await anular(f.id, 'Intento con un cobro'); igual([r.estado, r.cuerpo.error.codigo], [422, 'no_se_puede_anular'], 'avisa'); let msg = ''; try { await q(`update comprobante set estado = 'anulado' where id = $1`, [f.id]); } catch (e) { msg = e.message; } verdad(/cobros o pagos imputados/.test(msg), `la base: ${msg}`);
  const n = await nota({ comprobante_origen_id: f.id, motivo: 'Devolución total de una factura cobrada en parte' }); igual(n.estado, 201, JSON.stringify(n.cuerpo)); verdad(n.cuerpo.avisos.some((a) => /saldo a favor/.test(a)), `aviso: ${n.cuerpo.avisos}`);
  const nd = await detalle(n.cuerpo.id); igual([nd.saldo, (await detalle(f.id)).saldo], [(Number(f.imp_total) - Number((await uno('select importe::text i from comprobante_aplicacion where nota_id = $1', [n.cuerpo.id])).i)).toFixed(2), '0.00'], 'la nota se aplica hasta el saldo de la factura y el resto queda a favor');
});

await prueba('La trazabilidad de todo lo anulado y acreditado está completa y la cadena sigue íntegra', async () => {
  igual((await uno(`select count(*)::int n from evento where categoria = 'comprobantes' and accion like 'Anuló %'`)).n >= 5, true, 'anulaciones registradas'); igual((await uno(`select count(*)::int n from evento where accion like 'Emitió Nota de Crédito%'`)).n >= 8, true, 'notas registradas');
  igual((await uno(`select count(*)::int n from evento where categoria = 'comprobantes' and usuario_id is null`)).n, 0, 'todas con autor'); for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena ${e}`);
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
