// Pruebas de la factura de compra contra un remito de entrada: toma los renglones que ya llegaron, los valoriza y genera la deuda SIN volver a ingresar el stock, actualiza el costo
// con el precio de la factura, no deja facturar más de lo que llegó, se refleja en el remito y en la orden, y al anular la factura todo vuelve. Con --pg pasan por el adaptador de producción.
// Uso:  node api/probar_factura_remito.mjs [--pg]
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
const remito = (cuerpo) => api('admin', 'POST', '/api/compras/remitos', { cuerpo });
const verR = async (id) => (await api('admin', 'GET', `/api/compras/remitos/${id}`)).cuerpo;
const verO = async (id) => (await api('admin', 'GET', `/api/compras/ordenes/${id}`)).cuerpo;
const pendientes = async (tercero = P1.id, empresa = RI) => (await api('admin', 'GET', `/api/compras/remitos/pendientes-facturar?tercero_id=${tercero}`, { empresa })).cuerpo.datos;
const factura = (cuerpo, extra = {}) => cargar({ tercero_id: P1.id, letra: 'A', punto_venta: 4, fecha: hoy, ...cuerpo }, extra);
const nota = (clase, cuerpo) => api('admin', 'POST', '/api/compras/notas', { cuerpo: { clase, ...cuerpo } });
const campoF = (r, k) => r.cuerpo?.error?.campos?.[k];
const movs = async () => (await uno('select count(*)::int n from movimiento_stock')).n;
const OC = (await api('admin', 'POST', '/api/compras/ordenes', { cuerpo: { tercero_id: P1.id, fecha: hoy, items: [{ articulo_id: PAN.id, cantidad: '10', precio_unitario: '100' }], confirmar: true } })).cuerpo;
const R1 = (await remito({ orden_id: OC.id, numero_externo: '0003-00000100', items: [{ item_origen_id: OC.items[0].id, cantidad: '10' }], confirmar: true })).cuerpo;
if (!R1?.id) throw new Error('remito de partida: ' + JSON.stringify(R1));
const it1 = R1.items[0].id;

// ---------------------------------------------------------------------------
await prueba('Lo que se puede facturar de los remitos: renglones con lo que llegó, lo ya facturado y lo que falta, por proveedor', async () => {
  const p = await pendientes(); igual(p.length, 1, JSON.stringify(p)); igual([p[0].remito, p[0].numero_externo, p[0].descripcion, Number(p[0].llego), Number(p[0].facturado), Number(p[0].facturable), p[0].item_id], ['0001-00000001', '0003-00000100', 'Harina 000 x 25 kg', 10, 0, 10, it1], 'el renglón del remito');
  igual((await pendientes(P2.id)).length, 0, 'otro proveedor: nada'); igual((await api('admin', 'GET', '/api/compras/remitos/pendientes-facturar')).estado, 422, 'pide el proveedor'); igual((await api('consulta', 'GET', `/api/compras/remitos/pendientes-facturar?tercero_id=${P1.id}`)).estado, 200, 'la consulta mira');
  igual((await pendientes(P1.id, MT)).length, 0, 'otra empresa: nada');
});
await prueba('Facturar un remito: la factura valoriza y genera la deuda, pero el stock no vuelve a entrar; el costo toma el precio de la factura', async () => {
  const antes = await movs(), saldo = await saldoProv(P1.id);
  const cuerpo = { numero: 500, total: '1331', items: [{ documento_item_id: it1, cantidad: '10', precio_unitario: '110' }] };
  const previa = await api('admin', 'POST', '/api/compras/facturas/calcular', { cuerpo: { tercero_id: P1.id, letra: 'A', punto_venta: 4, fecha: hoy, ...cuerpo } });
  igual([previa.estado, previa.cuerpo.items[0].ingresa_stock, previa.cuerpo.items[0].remito, previa.cuerpo.total_calculado, previa.cuerpo.coincide], [200, false, 'Remito 0001-00000001', '1331.00', true], JSON.stringify(previa.cuerpo)); verdad(previa.cuerpo.avisos.some((a) => /ya ingresó al stock con ese remito/.test(a)), JSON.stringify(previa.cuerpo.avisos));
  const r = await factura(cuerpo); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.f1 = r.cuerpo.id;
  igual([await movs(), await stockDe(PAN.id)], [antes, 10], 'no hay movimientos nuevos: el stock sigue en 10 (no 20)'); igual(Number(await costoDe(PAN.id)), 110, 'el costo es el de la factura (110), no el del remito (100)');
  igual(await lineas(r.cuerpo.asiento_id), ['1.1.5 D 231', '2.1.1 H 1331', '5.1.1 D 1100'], 'asiento de una compra común'); igual(Number(await saldoProv(P1.id)) - Number(saldo), 1331, 'la deuda sube 1331');
  const rem = await verR(R1.id); igual([Number(rem.items[0].facturado), rem.facturas.map((f) => [f.tipo, f.numero_formateado])], [10, [['Factura A', '0004-00000500']]], JSON.stringify(rem.facturas));
  const o = await verO(OC.id); igual([Number(o.items[0].recibido), Number(o.items[0].facturado), Number(o.items[0].pendiente)], [10, 10, 0], 'la orden muestra recibido y facturado'); igual((await pendientes()).length, 0, 'ya no queda nada por facturar');
  const e = await ultimoEvento('Cargó Factura%'); verdad(/facturó mercadería de Remito 0001-00000001/.test(e.detalle), e.detalle);
  igual((await uno('select documento_item_id from comprobante_item where comprobante_id = $1', [ids.f1])).documento_item_id, it1, 'el renglón queda vinculado'); 
});
await prueba('Facturar de a partes: no se factura más de lo que llegó, sumando todas las facturas del renglón', async () => {
  const R2 = (await remito({ tercero_id: P1.id, numero_externo: '0003-00000101', items: [{ articulo_id: PAN.id, cantidad: '6', precio_unitario: '100' }], confirmar: true })).cuerpo; ids.R2 = R2.id; const it2 = R2.items[0].id; igual(await stockDe(PAN.id), 16, 'llegaron 6 más');
  const a = await factura({ numero: 501, total: '484', items: [{ documento_item_id: it2, cantidad: '4', precio_unitario: '100' }] }); igual(a.estado, 201, JSON.stringify(a.cuerpo)); ids.f2 = a.cuerpo.id;
  const pend = await pendientes(); igual(pend.map((x) => [Number(x.facturado), Number(x.facturable)]), [[4, 2]], 'quedan 2 por facturar');
  const mal = await factura({ numero: 502, total: '363', items: [{ documento_item_id: it2, cantidad: '3', precio_unitario: '100' }] }); igual([mal.estado, campoF(mal, 'items[0].cantidad')], [422, 'del remito solo se pueden facturar 2 (llegaron 6, ya se facturaron 4)'], JSON.stringify(mal.cuerpo));
  const ok = await factura({ numero: 502, total: '242', items: [{ documento_item_id: it2, cantidad: '2', precio_unitario: '100' }] }); igual(ok.estado, 201, JSON.stringify(ok.cuerpo)); ids.f3 = ok.cuerpo.id;
  igual(campoF(await factura({ numero: 503, total: '121', items: [{ documento_item_id: it2, cantidad: '1', precio_unitario: '100' }] }), 'items[0].cantidad'), 'ese renglón del remito ya está facturado por completo', 'ya no hay más'); igual(await stockDe(PAN.id), 16, 'el stock no se movió por las facturas');
});
await prueba('Validaciones: el renglón tiene que ser de un remito confirmado del mismo proveedor y del mismo artículo, y no repetirse', async () => {
  const base = (items) => ({ numero: 600, total: '121', items });
  const RP2 = (await remito({ tercero_id: P2.id, items: [{ articulo_id: PAN.id, cantidad: '1', precio_unitario: '1' }], confirmar: true })).cuerpo;
  igual(campoF(await factura(base([{ documento_item_id: RP2.items[0].id, cantidad: '1', precio_unitario: '100' }])), 'items[0].documento_item_id'), 'el remito es de otro proveedor', 'de otro proveedor');
  const RB = (await remito({ tercero_id: P1.id, items: [{ articulo_id: PAN.id, cantidad: '1', precio_unitario: '1' }] })).cuerpo; igual(campoF(await factura(base([{ documento_item_id: RB.items[0].id, cantidad: '1', precio_unitario: '100' }])), 'items[0].documento_item_id'), 'el remito no está confirmado', 'borrador');
  await api('admin', 'DELETE', `/api/compras/remitos/${RB.id}`);
  const RA = (await remito({ tercero_id: P1.id, items: [{ articulo_id: PAN.id, cantidad: '1', precio_unitario: '1' }], confirmar: true })).cuerpo; await api('admin', 'POST', `/api/compras/remitos/${RA.id}/anular`, { cuerpo: { motivo: 'Se cargó mal' } });
  igual(campoF(await factura(base([{ documento_item_id: RA.items[0].id, cantidad: '1', precio_unitario: '100' }])), 'items[0].documento_item_id'), 'el remito está anulado', 'anulado');
  igual(campoF(await factura(base([{ documento_item_id: 999999, cantidad: '1', precio_unitario: '100' }])), 'items[0].documento_item_id'), 'el renglón del remito no existe', 'inexistente'); igual(campoF(await factura(base([{ documento_item_id: OC.items[0].id, cantidad: '1', precio_unitario: '100' }])), 'items[0].documento_item_id'), 'el renglón del remito no existe', 'un renglón de una orden no es de un remito');
  const R3 = (await remito({ tercero_id: P1.id, items: [{ articulo_id: PAN.id, cantidad: '5', precio_unitario: '100' }], confirmar: true })).cuerpo; const it3 = R3.items[0].id; ids.R3 = R3.id;
  igual(campoF(await factura(base([{ documento_item_id: it3, articulo_id: FLETE.id, cantidad: '1', precio_unitario: '100' }])), 'items[0].articulo_id'), 'no es el artículo del remito', 'otro artículo');
  igual(campoF(await factura({ numero: 601, total: '242', items: [{ documento_item_id: it3, cantidad: '1', precio_unitario: '100' }, { documento_item_id: it3, cantidad: '1', precio_unitario: '100' }] }), 'items[1].documento_item_id'), 'ese renglón del remito está repetido', 'repetido');
  igual(campoF(await nota('nota_credito', { ...base([{ documento_item_id: it3, cantidad: '1', precio_unitario: '100' }]), comprobante_origen_id: ids.f1 }), 'items[0].documento_item_id'), 'no es un campo que se pueda enviar', 'una nota no toma renglones de un remito');
  igual(await stockDe(PAN.id), 22, 'solo los remitos movieron stock');
});
await prueba('Anular una factura de remito: el stock queda como estaba, el remito recupera lo facturable; con la factura vigente el remito no se anula', async () => {
  const bloqueo = await api('admin', 'POST', `/api/compras/remitos/${R1.id}/anular`, { cuerpo: { motivo: 'Para probar' } }); igual([bloqueo.estado, bloqueo.cuerpo.error.mensaje], [422, 'El remito ya tiene facturas cargadas: anulá primero esas facturas.'], JSON.stringify(bloqueo.cuerpo));
  const stock = await stockDe(PAN.id), n = await movs(); const a = await anular(ids.f1); igual(a.estado, 200, JSON.stringify(a.cuerpo)); igual([await stockDe(PAN.id), await movs()], [stock, n], 'anular la factura no toca el stock del remito');
  igual((await pendientes()).map((x) => [x.remito, Number(x.facturable)]).filter((x) => x[0] === '0001-00000001'), [['0001-00000001', 10]], 'el remito vuelve a poder facturarse'); igual(Number((await verR(R1.id)).items[0].facturado), 0, 'el remito no figura facturado'); igual(Number((await verO(OC.id)).items[0].facturado), 0, 'ni la orden');
  const c = await factura({ numero: 510, total: '1210', items: [{ documento_item_id: it1, cantidad: '10', precio_unitario: '100' }] }); igual(c.estado, 201, 'se puede facturar de nuevo'); ids.f1b = c.cuerpo.id;
  igual((await anular(ids.f1b)).estado, 200, 'y anular'); const r = await api('admin', 'POST', `/api/compras/remitos/${R1.id}/anular`, { cuerpo: { motivo: 'Llegó de más' } }); igual([r.estado, r.cuerpo.estado, await stockDe(PAN.id)], [200, 'anulado', stock - 10], JSON.stringify(r.cuerpo));
});
await prueba('Sin vínculo todo sigue igual: una factura común ingresa su stock; y la base impide facturar de más aunque se salteen las validaciones', async () => {
  const antes = await stockDe(PAN.id); const c = await factura({ numero: 700, total: '242', items: [{ articulo_id: PAN.id, cantidad: '2', precio_unitario: '100' }] }); igual([c.estado, await stockDe(PAN.id)], [201, antes + 2], 'la factura común ingresa 2');
  const mensaje = async (sql, p) => { try { await q(sql, p); return ''; } catch (e) { return e.message; } };
  // un renglón de la factura 2 con más cantidad que lo que llegó, con las guardas de migración apagadas dentro de una sola transacción
  verdad(/se factura 7(.0+)? de un renglón de remito donde llegó 6/.test(await mensaje(`do $$ begin perform set_config('app.migracion', 'on', true); update comprobante_item set cantidad = 5 where comprobante_id = ${ids.f2}; perform fn_verificar_factura_remito(${ids.f2}); end $$`)), 'el trigger de la base rechaza la sobre-facturación');
  verdad(/no es el mismo artículo/.test(await mensaje(`do $$ begin perform set_config('app.migracion', 'on', true); update comprobante_item set articulo_id = ${FLETE.id} where comprobante_id = ${ids.f2}; perform fn_verificar_factura_remito(${ids.f2}); end $$`)), 'ni el cambio de artículo');
  verdad(/no es un remito de entrada confirmado del mismo proveedor/.test(await mensaje(`do $$ begin perform set_config('app.migracion', 'on', true); update comprobante set tercero_id = ${P2.id} where id = ${ids.f2}; perform fn_verificar_factura_remito(${ids.f2}); end $$`)), 'ni el proveedor');
});
await prueba('Trazabilidad: la cadena sigue íntegra', async () => {
  for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena ${e}`);
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
