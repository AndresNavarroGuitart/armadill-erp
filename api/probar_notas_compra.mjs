// Pruebas de notas de crédito y de débito de proveedores: carga con verificación del total, vínculo con la factura que acreditan (mismo proveedor y letra),
// aplicación a su saldo (y después a otra factura si sobra), devolución de mercadería, asiento invertido, libro de IVA, notas de débito que se pagan,
// anulación (con stock y aplicaciones) y cruces con informes. Con --pg pasan por el adaptador de producción.
// Uso:  node api/probar_notas_compra.mjs [--pg]
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
const nota = (clase, cuerpo, o = {}) => api(o.quien ?? 'admin', 'POST', '/api/compras/notas', { cuerpo: clase === undefined ? cuerpo : { clase, ...cuerpo }, empresa: o.empresa });
const calcN = (clase, cuerpo) => api('admin', 'POST', '/api/compras/notas/calcular', { cuerpo: clase === undefined ? cuerpo : { clase, ...cuerpo } });
const aplicar = (id, cuerpo, quien = 'admin') => api(quien, 'POST', `/api/compras/notas/${id}/aplicar`, { cuerpo });
const baseNC = (origen, extra = {}) => ({ comprobante_origen_id: origen, tercero_id: P1.id, letra: 'A', punto_venta: 4, numero: 77, fecha: hoy, total: '484', items: [{ articulo_id: PAN.id, cantidad: '4', precio_unitario: '100', devuelve_stock: true }], ...extra });
const saldoComp = async (id) => (await uno('select saldo::text s from v_saldo_comprobante where comprobante_id = $1', [id])).s;
const campoN = (r, k) => r.cuerpo?.error?.campos?.[k];
const servicio = (numero, total, neto, extra = {}) => ({ tercero_id: P1.id, letra: 'A', punto_venta: 4, numero, fecha: hoy, total, items: [{ descripcion: 'Servicio', cantidad: '1', precio_unitario: neto }], ...extra });
const libro = async (desde = hoy, hasta = hoy) => (await api('admin', 'GET', `/api/informes/libro-iva-compras?desde=${desde}&hasta=${hasta}`)).cuerpo;

const F1 = (await cargar(base())).cuerpo;                                                  // 1812,50: 10 de pan (stock 10) + flete + percepción
if (!F1?.id) throw new Error('datos de partida: ' + JSON.stringify(F1).slice(0, 300));
const costoPan = await costoDe(PAN.id);

// ---------------------------------------------------------------------------
await prueba('Permisos: cargar y aplicar notas pide compras.cargar; la consulta y el auxiliar miran pero no tocan', async () => {
  for (const quien of ['auxiliar', 'consulta']) {
    igual((await nota('nota_credito', baseNC(F1.id), { quien })).estado, 403, `${quien} no carga`); igual((await api(quien, 'POST', '/api/compras/notas/calcular', { cuerpo: { clase: 'nota_credito', ...baseNC(F1.id) } })).estado, 403, `${quien} no calcula`); igual((await aplicar(F1.id, {}, quien)).estado, 403, `${quien} no aplica`);
  }
  igual((await api('consulta', 'GET', `/api/compras/facturas/${F1.id}`)).estado, 200, 'pero la consulta ve el comprobante');
});
await prueba('Nota de crédito con devolución de mercadería: sale del depósito, se aplica a la factura, el asiento va al revés y el costo no cambia', async () => {
  const antes = (await uno('select count(*)::int n from comprobante')).n;
  const prev = await calcN('nota_credito', baseNC(F1.id)); igual(prev.estado, 200, JSON.stringify(prev.cuerpo));
  igual([prev.cuerpo.clase, prev.cuerpo.total_calculado, prev.cuerpo.coincide, prev.cuerpo.origen.etiqueta, prev.cuerpo.origen.saldo, prev.cuerpo.items[0].devuelve_stock, prev.cuerpo.tipo_comprobante_codigo], ['nota_credito', '484.00', true, 'Factura A 0004-00001234', '1812.50', true, 3], 'cálculo previo');
  igual((await uno('select count(*)::int n from comprobante')).n, antes, 'calcular no escribe');
  const r = await nota('nota_credito', baseNC(F1.id)); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.nc1 = r.cuerpo.id;
  igual([r.cuerpo.clase, r.cuerpo.tipo, r.cuerpo.imp_total, r.cuerpo.estado, r.cuerpo.origen.numero_formateado, r.cuerpo.saldo], ['nota_credito', 'Nota de Crédito A', '484.00', 'confirmado', '0004-00001234', '0.00'], 'la nota');
  igual([await stockDe(PAN.id), await saldoComp(F1.id), await saldoProv(P1.id), await costoDe(PAN.id)], [6, '1328.50', '1328.50', costoPan], 'stock 6, factura y proveedor con 484 menos, costo igual');
  igual(await lineas(r.cuerpo.asiento_id), ['1.1.5 H 84', '2.1.1 D 484', '5.1.1 H 400'], 'asiento invertido: proveedores / compras e IVA crédito');
  const d = await detalle(F1.id); igual([d.notas.map((n) => [n.tipo, n.imp_total]), d.acciones.nota_credito], [[['Nota de Crédito A', '484.00']], null], 'la factura la ve y se puede seguir acreditando');
  const mv = await q(`select tipo, cantidad::text c from movimiento_stock where comprobante_item_id = $1`, [r.cuerpo.items[0].id]); igual(mv.map((m) => [m.tipo, Number(m.c)]), [['devolucion_compra', -4]], 'movimiento de stock');
  const l = await libro(); igual([l.filas.length, l.filas.find((f) => f.tipo.startsWith('Nota')).total, l.totales.neto_gravado, l.totales.iva_total], [2, '-484.00', '1100.00', '178.50'], 'libro de IVA compras: la nota resta');
  const e = await ultimoEvento('Cargó Nota de crédito%'); igual([e.accion, e.categoria], ['Cargó Nota de crédito A 0004-00000077 de Molinos del Sur SA', 'comprobantes'], 'rastro'); verdad(/acredita Factura A 0004-00001234 \(aplicó \$ 484\.00\)/.test(e.detalle) && /devolvió mercadería/.test(e.detalle), e.detalle);
  const cc = (await api('admin', 'GET', `/api/proveedores/${P1.id}/cuenta-corriente`)).cuerpo; igual([cc.saldo, cc.movimientos.at(-1).detalle, cc.movimientos.at(-1).importe], ['1328.50', 'Nota de Crédito A 0004-00000077', '-484.00'], 'cuenta corriente');
});
await prueba('Validaciones de una nota de crédito: factura de origen, letra, fechas, mercadería, total y duplicados', async () => {
  const F2 = (await cargar(servicio(1300, '1210', '1000'))).cuerpo, FP2 = (await cargar({ ...servicio(1, '1210', '1000'), tercero_id: P2.id })).cuerpo, F3 = (await cargar(servicio(1301, '121', '100'))).cuerpo;
  ids.FP2 = FP2.id;
  igual((await anular(F3.id)).estado, 200, 'una factura anulada para probar'); ids.F2 = F2.id;
    igual(campoN(await calcN('nota_credito', baseNC(999999)), 'comprobante_origen_id'), 'la factura no existe', 'inexistente');
  igual(campoN(await calcN('nota_credito', baseNC(FP2.id)), 'comprobante_origen_id'), 'la factura es de otro proveedor', 'otro proveedor');
  igual(campoN(await calcN('nota_credito', baseNC(ids.nc1)), 'comprobante_origen_id'), 'solo se acredita una factura o una nota de débito', 'no se acredita una nota de crédito');
  igual(campoN(await calcN('nota_credito', baseNC(F3.id)), 'comprobante_origen_id'), 'la factura está anulada: no hay nada que acreditar', 'factura anulada');
  igual(campoN(await calcN('nota_credito', baseNC(F1.id, { letra: 'B' })), 'comprobante_origen_id'), 'la nota tiene que ser de la misma letra que la factura (A)', 'letra');
  const ayer = new Date(Date.now() - 864e5).toISOString().slice(0, 10); igual(campoN(await calcN('nota_credito', baseNC(F1.id, { fecha: ayer })), 'fecha'), 'la nota no puede ser anterior a la factura que acredita', 'fecha anterior');
  igual(campoN(await calcN('nota_credito', baseNC(F1.id, { fecha: '2999-01-01' })), 'fecha'), 'la fecha de la nota de crédito no puede ser futura', 'fecha futura');
  igual(campoN(await calcN('nota_credito', baseNC(F1.id, { items: [{ articulo_id: FLETE.id, cantidad: '1', precio_unitario: '100', devuelve_stock: true }], total: '110.50' })), 'items[0].devuelve_stock'), 'solo se devuelve mercadería de un artículo con control de stock', 'un gasto no se devuelve');
  igual(campoN(await calcN('nota_credito', baseNC(F1.id, { items: [{ articulo_id: PAN.id, cantidad: '7', precio_unitario: '100', devuelve_stock: true }] })), 'items[0].cantidad'), 'no hay tanta mercadería en el depósito para devolver (hay 6)', 'más de lo que hay');
  const mal = await nota('nota_credito', baseNC(F1.id, { total: '500' })); igual([mal.estado, /el total calculado es \$ 484\.00 y la factura dice \$ 500/.test(campoN(mal, 'total'))], [422, true], 'el total tiene que coincidir');
  igual((await nota('nota_credito', { ...baseNC(F1.id), numero: 78, total: '121', items: [{ descripcion: 'Bonificación', cantidad: '1', precio_unitario: '100' }] })).estado, 201, 'sin mercadería ni stock: va'); igual(await stockDe(PAN.id), 6, 'y no tocó el stock');
  igual((await nota('nota_credito', { ...baseNC(F1.id), numero: 78, total: '121', items: [{ descripcion: 'Bonificación', cantidad: '1', precio_unitario: '100' }] })).estado, 409, 'el número del proveedor no se repite');
  igual(campoN(await nota('nota_debito', { ...baseNC(F1.id), numero: 5 }), 'comprobante_origen_id'), 'no es un campo que se pueda enviar', 'la nota de débito no lleva origen');
  igual(campoN(await nota(undefined, { ...baseNC(F1.id) }), 'clase'), 'tiene que ser nota_credito o nota_debito', 'sin clase'); igual(campoN(await nota('factura', { ...baseNC(F1.id) }), 'clase'), 'tiene que ser nota_credito o nota_debito', 'una factura no va por acá');
  igual(campoN(await nota('nota_credito', baseNC(F1.id, { tercero_id: P3.id, numero: 9 })), 'tercero_id'), 'una nota de crédito A necesita que el proveedor tenga CUIT', 'proveedor sin CUIT');
});
await prueba('Una nota mayor que el saldo de su factura: lo que sobra queda a favor y se aplica después a otra factura', async () => {
  const sobra = await nota('nota_credito', { ...servicio(80, '1815', '1500'), comprobante_origen_id: ids.F2 }); igual(sobra.estado, 201, JSON.stringify(sobra.cuerpo)); ids.nc3 = sobra.cuerpo.id;
  verdad(sobra.cuerpo.avisos.some((a) => /supera el saldo de Factura A 0004-00001300 \(\$ 1210\.00\)/.test(a)), JSON.stringify(sobra.cuerpo.avisos)); igual([await saldoComp(ids.F2), sobra.cuerpo.saldo], ['0.00', '605.00'], 'la factura se saldó y a la nota le quedan 605');
  const baseA = { factura_id: F1.id, importe: '100' };
  igual(campoN(await aplicar(ids.nc3, { factura_id: 999999, importe: '10' }), 'factura_id'), 'la factura no existe', 'inexistente'); igual(campoN(await aplicar(ids.nc3, { factura_id: ids.F2, importe: '10' }), 'factura_id'), 'Factura A 0004-00001300 no tiene saldo', 'sin saldo');
  const otra = (await cargar({ ...servicio(2, '121', '100'), tercero_id: P2.id })).cuerpo; igual(campoN(await aplicar(ids.nc3, { factura_id: otra.id, importe: '10' }), 'factura_id'), 'la factura es de otro proveedor', 'otro proveedor');
  igual(campoN(await aplicar(ids.nc3, { ...baseA, importe: '700' }), 'importe'), 'a la nota le quedan $ 605.00', 'más que el saldo de la nota'); igual((await aplicar(ids.nc3, { ...baseA, importe: '0' })).estado, 422, 'cero no vale'); igual((await aplicar(ids.nc3, { factura_id: F1.id }, 'admin')).estado, 422, 'sin importe');
  const ok = await aplicar(ids.nc3, { factura_id: F1.id, importe: '605' }); igual([ok.estado, ok.cuerpo.saldo, await saldoComp(F1.id)], [200, '0.00', '602.50'], JSON.stringify(ok.cuerpo)); // 1812,50 - 484 - 121 (bonificación) - 605
  igual(campoN(await aplicar(ids.nc3, baseA), 'factura_id'), 'la nota ya está aplicada a esa factura: no se puede aplicar dos veces', 'una vez por factura'); igual((await ultimoEvento('Aplicó %')).detalle, '$ 605 a Factura A 0004-00001234', 'rastro');
  igual((await aplicar(F1.id, baseA)).estado, 404, 'aplicar algo que no es una nota de crédito');
});
await prueba('Nota de crédito sin factura de origen (una bonificación): se carga, queda a favor del proveedor y se aplica después a una factura', async () => {
  const sin = { tercero_id: P1.id, letra: 'B', punto_venta: 4, numero: 90, fecha: hoy, total: '100', items: [{ descripcion: 'Bonificación por volumen', cantidad: '1', precio_unitario: '100' }] };
  const antes = await saldoProv(P1.id), prev = await calcN('nota_credito', sin); igual(prev.estado, 200, JSON.stringify(prev.cuerpo)); verdad(prev.cuerpo.origen === null && prev.cuerpo.avisos.some((a) => /Sin factura de origen/.test(a)), JSON.stringify(prev.cuerpo.avisos));
  const r = await nota('nota_credito', sin); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.ncSin = r.cuerpo.id; igual([r.cuerpo.origen, r.cuerpo.saldo, r.cuerpo.imp_total], [null, '100.00', '100.00'], 'sin origen y entera a favor');
  igual(Number(await saldoProv(P1.id)), Number(antes) - 100, 'el proveedor debe 100 menos'); igual(await lineas(r.cuerpo.asiento_id), ['2.1.1 D 100', '5.1.1 H 100'], 'asiento invertido');
  const mal = await nota('nota_credito', { ...sin, numero: 91, letra: 'A', comprobante_origen_id: ids.FP2 }); igual(campoN(mal, 'comprobante_origen_id'), 'la factura es de otro proveedor', 'con origen valen las reglas de siempre');
  const sF1 = Number(await saldoComp(F1.id)), ap = await aplicar(ids.ncSin, { factura_id: F1.id, importe: '100' }); igual([ap.estado, ap.cuerpo.saldo], [200, '0.00'], JSON.stringify(ap.cuerpo)); igual(Number(await saldoComp(F1.id)), sF1 - 100, 'la factura recibió la aplicación');
  igual((await anular(ids.ncSin, 'Se cargó con otra letra')).estado, 200, 'se anula y deshace la aplicación');
});
await prueba('Nota de débito: es una deuda más (intereses, gastos) que se ve entre lo pendiente y se paga con una orden de pago', async () => {
  const nd = await nota('nota_debito', servicio(5, '121', '100', { items: [{ descripcion: 'Intereses por mora', cantidad: '1', precio_unitario: '100' }] })); igual(nd.estado, 201, JSON.stringify(nd.cuerpo)); ids.nd1 = nd.cuerpo.id;
  igual([nd.cuerpo.clase, nd.cuerpo.tipo, nd.cuerpo.imp_total, nd.cuerpo.saldo], ['nota_debito', 'Nota de Débito A', '121.00', '121.00'], 'la nota de débito'); igual(await lineas(nd.cuerpo.asiento_id), ['1.1.5 D 21', '2.1.1 H 121', '5.1.1 D 100'], 'asiento como una factura');
  igual(await saldoProv(P1.id), '723.50', 'el proveedor la debe'); // 602,50 + 121
  const pend = (await api('admin', 'GET', `/api/pagos/pendientes?tercero_id=${P1.id}`)).cuerpo; verdad(pend.datos.some((x) => x.id === ids.nd1 && x.tipo === 'Nota de Débito A' && x.saldo === '121.00'), JSON.stringify(pend.datos.map((x) => x.tipo)));
  const caja = (await api('admin', 'GET', '/api/tesoreria/cajas')).cuerpo.datos[0]; await q(`insert into movimiento_tesoreria (empresa_id, fecha, caja_id, importe, concepto) values ($1, $2, $3, 5000, 'saldo inicial')`, [RI, hoy, caja.id]);
  const op = await api('admin', 'POST', '/api/pagos', { cuerpo: { tercero_id: P1.id, imputaciones: [{ comprobante_id: ids.nd1, importe: '121' }], medios: [{ medio: 'efectivo', caja_id: caja.id, importe: '121' }] } }); igual(op.estado, 201, JSON.stringify(op.cuerpo)); ids.opNd = op.cuerpo.id;
  igual([await saldoComp(ids.nd1), await saldoProv(P1.id)], ['0.00', '602.50'], 'pagada'); const mal = await anular(ids.nd1); igual([mal.estado, /Tiene cobros imputados/.test(mal.cuerpo.error.mensaje)], [422, true], 'con un pago imputado no se anula');
  igual((await api('admin', 'POST', `/api/pagos/${ids.opNd}/anular`, { cuerpo: { motivo: 'Para probar' } })).estado, 200, 'anulo el pago');
  const l = await libro(); verdad(l.filas.some((f) => f.tipo === 'Nota de Débito A' && f.total === '121.00'), 'la nota de débito suma en el libro');
});
await prueba('Anular una nota de crédito: la mercadería vuelve al depósito, la factura recupera su saldo y el asiento se contrarresta; una factura con notas aplicadas no se anula', async () => {
  const bloqueo = await anular(F1.id); igual([bloqueo.estado, /Tiene notas de crédito aplicadas/.test(bloqueo.cuerpo.error.mensaje)], [422, true], 'la factura con notas no se anula');
  const antes = await saldoComp(F1.id); const a = await anular(ids.nc1, 'La cargamos con otro número'); igual(a.estado, 200, JSON.stringify(a.cuerpo));
  igual([a.cuerpo.estado, await stockDe(PAN.id), await saldoComp(F1.id)], ['anulado', 10, String((Number(antes) + 484).toFixed(2))], 'stock 10 otra vez y la factura recupera 484'); igual(await neteo(a.cuerpo.asiento_id), [], 'el asiento queda neteado');
  igual((await uno(`select count(*)::int n from comprobante_aplicacion where nota_id = $1`, [ids.nc1])).n, 0, 'la aplicación se deshizo'); igual((await anular(ids.nc1)).estado, 422, 'no se anula dos veces');
  const nueva = await nota('nota_credito', baseNC(F1.id, { numero: 77 })); igual(nueva.estado, 409, 'el número de una nota anulada no se vuelve a usar');
});
await prueba('Cruces: el libro de IVA, la deuda con el proveedor y el balance coinciden, y todo quedó con su rastro', async () => {
  const todo = (await api('admin', 'GET', `/api/informes/libro-iva-compras?desde=${hoy.slice(0, 4)}-01-01&hasta=${hoy}`)).cuerpo;
  const bal = (await api('admin', 'GET', `/api/informes/balance?desde=${hoy.slice(0, 4)}-01-01&hasta=${hoy}`)).cuerpo; igual([bal.totales.debe === bal.totales.haber, bal.avisos], [true, []], 'el balance cuadra');
  igual(Number(bal.filas.find((f) => f.codigo === '1.1.5').saldo_deudor), Number(todo.totales.iva_total), 'el IVA crédito del balance = el del libro');
  const deuda = (await api('admin', 'GET', '/api/informes/deuda-proveedores')).cuerpo; const fila = deuda.filas.find((f) => f.razon_social === 'Molinos del Sur SA'); igual([fila.saldo_neto, fila.saldo_neto === (await saldoProv(P1.id))], [await saldoProv(P1.id), true], 'la deuda por antigüedad coincide con el saldo del proveedor');
  igual((await api('admin', 'GET', `/api/compras/facturas/${F1.id}`, { empresa: MT })).estado, 404, 'otra empresa no la ve'); igual((await nota('nota_credito', baseNC(F1.id, { numero: 99 }), { empresa: MT })).estado >= 400, true, 'ni acredita sobre ella');
  verdad((await uno(`select count(*)::int n from evento where accion like 'Cargó Nota de%' or accion like 'Aplicó %' or accion like 'Anuló Nota de%'`)).n >= 5, 'rastro de notas');
  for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena ${e}`);
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
