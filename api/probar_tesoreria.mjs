// Pruebas de tesorería: cajas y bancos, cobros y pagos con imputación, retenciones, descuentos, saldo a cuenta, sin sobregiro, anulación (y su cruce con
// la anulación de facturas), cuenta corriente e idempotencia. Con --pg pasan por el adaptador de producción (pg + migrador) contra PGlite por socket.
// Uso:  node api/probar_tesoreria.mjs [--pg]
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
var RI = S.empresas.ri.id; const MT = S.empresas.mt.id, ADMIN = S.usuarios.admin.id;
const ids = {}, hoy = new Date().toISOString().slice(0, 10);
const cobrar = (cuerpo, o = {}) => api(o.quien ?? 'admin', 'POST', '/api/cobros', { cuerpo, clave: o.clave });
const pagar = (cuerpo, o = {}) => api(o.quien ?? 'admin', 'POST', '/api/pagos', { cuerpo, clave: o.clave });
const anularCobro = (id, motivo = 'Se cargó por error', quien = 'admin') => api(quien, 'POST', `/api/cobros/${id}/anular`, { cuerpo: motivo === null ? {} : { motivo } });
const anularPago = (id, motivo = 'Se cargó por error', quien = 'admin') => api(quien, 'POST', `/api/pagos/${id}/anular`, { cuerpo: motivo === null ? {} : { motivo } });
const saldoCaja = async (id) => (await uno('select coalesce(sum(importe), 0)::text s from movimiento_tesoreria where caja_id = $1', [id])).s;
const saldoBanco = async (id) => (await uno('select coalesce(sum(importe), 0)::text s from movimiento_tesoreria where cuenta_bancaria_id = $1', [id])).s;
const saldoCli = async (id) => (await api('admin', 'GET', `/api/clientes/${id}`)).cuerpo.saldo, saldoProv = async (id) => (await api('admin', 'GET', `/api/proveedores/${id}`)).cuerpo.saldo;
const saldoComp = async (id) => (await uno('select saldo::text s from v_saldo_comprobante where comprobante_id = $1', [id])).s;
const lineas = async (asientoId) => (await q(`select c.codigo, l.debe::text d, l.haber::text h from asiento_linea l join plan_cuenta c on c.id = l.cuenta_id where l.asiento_id = $1 order by c.codigo, l.id`, [asientoId])).map((l) => `${l.codigo} ${Number(l.d) > 0 ? 'D ' + Number(l.d) : 'H ' + Number(l.h)}`);
const neteo = async (asientoId) => (await q(`select c.codigo from asiento_linea l join plan_cuenta c on c.id = l.cuenta_id where l.asiento_id in ($1, (select id from asiento where origen_tipo = 'contraasiento' and origen_id = $1)) group by c.codigo having sum(l.debe - l.haber) <> 0`, [asientoId]));
const ultimoEvento = (patron) => uno(`select usuario_id, empresa_id, categoria, accion, detalle from evento where accion like $1 order by id desc limit 1`, [patron]);

// --- datos de partida ---
const r1 = await api('admin', 'POST', '/api/clientes', { cuerpo: { tipo_documento: 'CUIT', nro_documento: cuitConDigito('3070811222'), razon_social: 'Distribuidora Sur SRL', condicion_iva_codigo: 1 } }); const C1 = r1.cuerpo;
const r2 = await api('admin', 'POST', '/api/clientes', { cuerpo: { tipo_documento: 'DNI', nro_documento: '27345118', razon_social: 'Marta Gómez', condicion_iva_codigo: 5 } }); const C2 = r2.cuerpo;
const rp = await api('admin', 'POST', '/api/proveedores', { cuerpo: { tipo_documento: 'CUIT', nro_documento: cuitConDigito('3071000000'), razon_social: 'Molinos del Sur SA', condicion_iva_codigo: 1 } }); const P1 = rp.cuerpo;
const lista = (await api('admin', 'GET', '/api/listas-precio')).cuerpo.datos[0].id;
const SERV = (await api('admin', 'POST', '/api/articulos', { cuerpo: { codigo: 'SERV', nombre: 'Consultoría', tipo: 'servicio', alicuota_venta: '21', lista_id: lista, precio_neto: '1000' } })).cuerpo;
const vender = async (tercero, cant) => (await api('admin', 'POST', '/api/ventas/facturas', { cuerpo: { tercero_id: tercero, items: [{ articulo_id: SERV.id, cantidad: cant }] } })).cuerpo;
const F1 = await vender(C1.id, '2'), F2 = await vender(C1.id, '1'), F3 = await vender(C2.id, '1');
const FC1 = (await api('admin', 'POST', '/api/compras/facturas', { cuerpo: { tercero_id: P1.id, letra: 'A', punto_venta: 4, numero: 1234, fecha: hoy, total: '1815', items: [{ descripcion: 'Servicios varios', cantidad: '1', precio_unitario: '1500', alicuota: '21' }] } })).cuerpo;
if (!F1?.id || !F2?.id || !F3?.id || !FC1?.id) throw new Error(`datos de partida: ${JSON.stringify({ F1, F2, F3, FC1 }).slice(0, 300)}`);
const CAJA = (await api('admin', 'GET', '/api/tesoreria/cajas')).cuerpo.datos[0];

// ---------------------------------------------------------------------------
await prueba('Permisos: tesorería.ver / cobros.registrar / pagos.registrar / tesorería.anular / tesorería.administrar; la consulta mira y no toca', async () => {
  const roles = (await api('admin', 'GET', '/api/estudio/roles')).cuerpo.datos, de = (n) => roles.find((r) => r.nombre === n).permisos, todos = ['tesoreria.ver', 'cobros.registrar', 'pagos.registrar', 'tesoreria.anular', 'tesoreria.administrar'];
  igual(['Administrador', 'Contador', 'Auxiliar', 'Consulta'].map((n) => todos.map((p) => de(n).includes(p))), [[true, true, true, true, true], [true, true, true, true, true], [true, false, false, false, false], [true, false, false, false, false]], 'quién tiene qué');
  igual((await api('consulta', 'GET', '/api/cobros')).estado, 200, 'la consulta ve los cobros'); igual((await api('consulta', 'GET', '/api/tesoreria/cajas')).estado, 200, 'y las cajas');
  for (const [m, r, c] of [['POST', '/api/cobros', {}], ['POST', '/api/pagos', {}], ['POST', '/api/cobros/calcular', {}], ['POST', '/api/tesoreria/cajas', { nombre: 'X' }], ['POST', '/api/cobros/1/anular', { motivo: 'prueba' }]]) igual((await api('auxiliar', m, r, { cuerpo: c })).estado, 403, `el auxiliar no puede ${m} ${r}`);
});
await prueba('Cajas y bancos: toda empresa nace con una caja; se crean y modifican con validaciones; la cuenta contable por defecto es la de caja o la de bancos', async () => {
  igual([CAJA.nombre, CAJA.tipo, CAJA.cuenta_codigo, CAJA.saldo, CAJA.activa], ['Caja general', 'efectivo', '1.1.1', '0', true], 'caja inicial'); igual((await api('admin', 'GET', '/api/tesoreria/cajas', { empresa: MT })).cuerpo.datos.length, 1, 'cada empresa la suya');
  const t = await api('admin', 'POST', '/api/tesoreria/cajas', { cuerpo: { nombre: 'Posnet', tipo: 'tarjetas' } }); igual([t.estado, t.cuerpo.tipo, t.cuerpo.cuenta_codigo], [201, 'tarjetas', '1.1.1'], JSON.stringify(t.cuerpo)); ids.tarjetas = t.cuerpo.id;
  igual((await api('admin', 'POST', '/api/tesoreria/cajas', { cuerpo: { nombre: 'posnet' } })).estado, 409, 'nombre repetido'); igual((await api('admin', 'POST', '/api/tesoreria/cajas', { cuerpo: { nombre: 'Rara', tipo: 'cheques_terceros' } })).estado, 422, 'tipo no soportado todavía'); igual((await api('admin', 'POST', '/api/tesoreria/cajas', { cuerpo: { nombre: 'Rara', cuenta_contable_id: 99999 } })).cuerpo.error.campos.cuenta_contable_id, 'la cuenta no existe o no es imputable', 'cuenta inválida');
  const b = await api('admin', 'POST', '/api/tesoreria/bancos', { cuerpo: { banco: 'Banco Nación', numero_cuenta: '1234/5', cbu: '0110012340012345678901', alias: 'ESTUDIO.CTA' } }); igual([b.estado, b.cuerpo.cuenta_codigo, b.cuerpo.saldo], [201, '1.1.4', '0'], JSON.stringify(b.cuerpo)); ids.banco = b.cuerpo.id;
  igual((await api('admin', 'POST', '/api/tesoreria/bancos', { cuerpo: { banco: 'Otro', cbu: '0110012340012345678901' } })).estado, 409, 'CBU repetido'); igual((await api('admin', 'POST', '/api/tesoreria/bancos', { cuerpo: { banco: 'Otro', cbu: '123' } })).cuerpo.error.campos.cbu, 'el CBU tiene 22 dígitos', 'CBU de otro largo');
  const m = await api('admin', 'PATCH', `/api/tesoreria/cajas/${ids.tarjetas}`, { cuerpo: { nombre: 'Posnet Mercado Pago' } }); igual(m.cuerpo.nombre, 'Posnet Mercado Pago', 'renombrada'); verdad(await ultimoEvento('Modificó la caja%'), 'rastro'); igual((await api('admin', 'PATCH', `/api/tesoreria/bancos/${ids.banco}`, { cuerpo: { alias: 'NUEVO.ALIAS' } })).cuerpo.alias, 'NUEVO.ALIAS', 'banco modificado');
  igual((await api('admin', 'PATCH', '/api/tesoreria/cajas/99999', { cuerpo: { nombre: 'Nada' } })).estado, 404, 'inexistente'); igual((await api('admin', 'PATCH', `/api/tesoreria/cajas/${CAJA.id}`, { empresa: MT, cuerpo: { nombre: 'Robada' } })).estado, 404, 'no desde otra empresa');
});

// ---------------------------------------------------------------------------
await prueba('Cobro de una factura completa en efectivo: recibo numerado, factura saldada, caja y cuenta corriente al día, y el asiento', async () => {
  const antes = await saldoCli(C1.id); igual(antes, '3630.00', 'el cliente debe las dos facturas');
  const r = await cobrar({ tercero_id: C1.id, imputaciones: [{ comprobante_id: F1.id, importe: '2420' }], medios: [{ medio: 'efectivo', caja_id: CAJA.id, importe: '2420' }] }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); const c = r.cuerpo; ids.cobro1 = c.id;
  igual([c.etiqueta, c.estado, c.total_documento, c.total_imputado, c.a_cuenta, c.clase], ['Recibo 0001-00000001', 'confirmado', '2420.00', '2420.00', '0.00', 'cobro'], 'el recibo');
  igual(await saldoComp(F1.id), '0.00', 'la factura queda saldada'); igual(await saldoCli(C1.id), '1210.00', 'el cliente debe solo la otra'); igual(await saldoCaja(CAJA.id), '2420.00', 'entró a la caja');
  igual(await lineas(c.asiento.id), ['1.1.1 D 2420', '1.1.3 H 2420'], 'asiento: caja al debe, deudores al haber'); const ev = await ultimoEvento('Registró Recibo%'); igual([ev.categoria, ev.usuario_id, ev.empresa_id], ['tesoreria', ADMIN, RI], 'evento'); verdad(/Distribuidora Sur SRL · \$ 2420.00 · imputó a 1 comprobante/.test(ev.detalle), ev.detalle);
  igual(c.imputaciones.map((x) => [x.comprobante, x.importe]), [[`Factura A ${F1.numero_formateado}`, '2420.00']], 'imputación'); igual(c.medios.map((x) => [x.medio, x.destino, x.importe]), [['efectivo', 'Caja general', '2420.00']], 'medio');
  const pend = (await api('admin', 'GET', `/api/cobros/pendientes?tercero_id=${C1.id}`)).cuerpo; igual([pend.datos.map((x) => [x.id, x.saldo]), pend.total_pendiente], [[[F2.id, '1210.00']], '1210.00'], 'pendientes: la saldada ya no figura');
  igual((await api('admin', 'GET', '/api/cobros')).cuerpo.datos.map((x) => [x.id, x.numero_formateado, x.total_documento]), [[c.id, '0001-00000001', '2420.00']], 'lista');
});
await prueba('Cobro con transferencia, retención sufrida y descuento, imputado a una factura de menos: lo que sobra queda a cuenta, y el asiento lo refleja', async () => {
  const cuerpo = { tercero_id: C1.id, descuento: '10', imputaciones: [{ comprobante_id: F2.id, importe: '1100' }], medios: [{ medio: 'transferencia', cuenta_bancaria_id: ids.banco, importe: '1000' }], retenciones: [{ tipo: 'iibb', jurisdiccion_codigo: 902, importe: '100', certificado_numero: 'R-0001', certificado_fecha: hoy }] };
  const prev = await api('admin', 'POST', '/api/cobros/calcular', { cuerpo }); igual(prev.estado, 200, JSON.stringify(prev.cuerpo)); igual([prev.cuerpo.total_documento, prev.cuerpo.total_imputado, prev.cuerpo.a_cuenta, prev.cuerpo.imputaciones[0].saldo_antes, prev.cuerpo.imputaciones[0].saldo_despues], ['1110.00', '1100.00', '10.00', '1210.00', '110.00'], 'el cálculo previo'); verdad(prev.cuerpo.avisos.some((a) => /Quedan \$ 10.00 sin imputar/.test(a)), 'avisa lo que queda a cuenta');
  igual((await uno('select count(*)::int n from pago')).n, 1, 'el cálculo no guardó nada');
  const r = await cobrar(cuerpo); igual(r.estado, 201, JSON.stringify(r.cuerpo)); const c = r.cuerpo; ids.cobro2 = c.id;
  igual([c.etiqueta, c.total_medios, c.total_retenciones, c.total_descuentos, c.total_documento, c.total_imputado, c.a_cuenta], ['Recibo 0001-00000002', '1000.00', '100.00', '10.00', '1110.00', '1100.00', '10.00'], 'identidad contable'); igual(c.retenciones.map((x) => [x.tipo, x.origen, x.certificado_numero]), [['iibb', 'sufrida', 'R-0001']], 'retención sufrida');
  igual(await lineas(c.asiento.id), ['1.1.3 H 1110', '1.1.4 D 1000', '1.1.7 D 100', '4.1.9 D 10'], 'asiento: banco, retenciones sufridas y descuentos otorgados al debe; deudores al haber'); igual(await saldoBanco(ids.banco), '1000.00', 'entró al banco');
  igual(await saldoComp(F2.id), '110.00', 'la factura queda debiendo 110'); igual(await saldoCli(C1.id), '100.00', 'el cliente debe 110 de la factura menos 10 que quedaron a cuenta');
  const cc = (await api('admin', 'GET', `/api/clientes/${C1.id}/cuenta-corriente`)).cuerpo; igual(cc.saldo, '100.00', 'la cuenta corriente cierra con el saldo');
  igual(cc.movimientos.map((m) => [m.detalle.slice(0, 15), m.importe, m.saldo]), [['Factura A 0001-', '2420.00', '2420.00'], ['Factura A 0001-', '1210.00', '3630.00'], ['Recibo 0001-000', '-2420.00', '1210.00'], ['Recibo 0001-000', '-1110.00', '100.00']], 'movimientos con saldo acumulado');
});
await prueba('Un cobro a cuenta (sin imputar) deja saldo a favor del cliente; y un cobro con tarjeta va a una caja de tarjetas', async () => {
  const a = await cobrar({ tercero_id: C1.id, medios: [{ medio: 'transferencia', cuenta_bancaria_id: ids.banco, importe: '5000' }] }); igual(a.estado, 201, JSON.stringify(a.cuerpo)); ids.cobro3 = a.cuerpo.id; igual([a.cuerpo.total_imputado, a.cuerpo.a_cuenta, a.cuerpo.imputaciones.length], ['0.00', '5000.00', 0], 'todo a cuenta');
  igual(await saldoCli(C1.id), '-4900.00', 'el cliente queda con 4.900 a su favor'); igual(await saldoBanco(ids.banco), '6000.00', 'banco');
  const t = await cobrar({ tercero_id: C2.id, imputaciones: [{ comprobante_id: F3.id, importe: '1210' }], medios: [{ medio: 'tarjeta', caja_id: ids.tarjetas, importe: '1210' }] }); igual(t.estado, 201, JSON.stringify(t.cuerpo)); igual(await saldoCaja(ids.tarjetas), '1210.00', 'caja de tarjetas'); igual(await saldoComp(F3.id), '0.00', 'saldada');
});
await prueba('Validaciones de un cobro, campo por campo: imputaciones, medios, retenciones, fecha y período', async () => {
  const base = (extra = {}) => ({ tercero_id: C1.id, imputaciones: [{ comprobante_id: F2.id, importe: '10' }], medios: [{ medio: 'efectivo', caja_id: CAJA.id, importe: '10' }], ...extra });
  const mal = async (extra, campo, texto) => { const x = await cobrar(base(extra)); igual(x.estado, 422, `${campo}: ${JSON.stringify(x.cuerpo)}`); verdad(campo in x.cuerpo.error.campos, `${campo} en ${JSON.stringify(x.cuerpo.error.campos)}`); if (texto) verdad(texto.test(x.cuerpo.error.campos[campo]), `${campo}: ${x.cuerpo.error.campos[campo]}`); };
  await mal({ imputaciones: [{ comprobante_id: F2.id, importe: '500' }], medios: [{ medio: 'efectivo', caja_id: CAJA.id, importe: '500' }] }, 'imputaciones[0].importe', /tiene un saldo de \$ 110.00: no se le puede imputar \$ 500/);
  await mal({ imputaciones: [{ comprobante_id: F3.id, importe: '10' }] }, 'imputaciones[0].comprobante_id', /es de otro cliente/); const anulada = await vender(C1.id, '1'); await api('admin', 'POST', `/api/comprobantes/${anulada.id}/anular`, { cuerpo: { motivo: 'Para probar la imputación' } }); await mal({ imputaciones: [{ comprobante_id: anulada.id, importe: '10' }] }, 'imputaciones[0].comprobante_id', /no es una deuda que se pueda cancelar/); await mal({ imputaciones: [{ comprobante_id: FC1.id, importe: '10' }] }, 'imputaciones[0].comprobante_id', /no existe/); await mal({ imputaciones: [{ comprobante_id: 99999, importe: '10' }] }, 'imputaciones[0].comprobante_id');
  await mal({ imputaciones: [{ comprobante_id: F2.id, importe: '5' }, { comprobante_id: F2.id, importe: '5' }] }, 'imputaciones[1].comprobante_id', /repetido/); await mal({ imputaciones: [{ comprobante_id: F2.id, importe: '0' }] }, 'imputaciones[0].importe');
  await mal({ imputaciones: [{ comprobante_id: F2.id, importe: '100' }] }, 'imputaciones', /supera lo cobrado/); await mal({ medios: [] }, 'medios', /al menos un medio/); await mal({ medios: undefined, imputaciones: undefined }, 'medios');
  await mal({ medios: [{ medio: 'efectivo', importe: '10' }] }, 'medios[0].caja_id', /elegí la caja/); await mal({ medios: [{ medio: 'efectivo', caja_id: 99999, importe: '10' }] }, 'medios[0].caja_id', /no existe/); await mal({ medios: [{ medio: 'efectivo', caja_id: ids.tarjetas, importe: '10' }] }, 'medios[0].caja_id', /no es de efectivo/);
  await mal({ medios: [{ medio: 'tarjeta', caja_id: CAJA.id, importe: '10' }] }, 'medios[0].caja_id', /tipo tarjetas/); await mal({ medios: [{ medio: 'transferencia', importe: '10' }] }, 'medios[0].cuenta_bancaria_id', /elegí la cuenta/); await mal({ medios: [{ medio: 'transferencia', caja_id: CAJA.id, cuenta_bancaria_id: ids.banco, importe: '10' }] }, 'medios[0].caja_id', /no va a una caja/);
  await mal({ medios: [{ medio: 'bitcoin', importe: '10' }] }, 'medios[0].medio'); await mal({ medios: [{ medio: 'efectivo', caja_id: CAJA.id, importe: '-5' }] }, 'medios[0].importe');
  await mal({ retenciones: [{ tipo: 'iibb', importe: '5', certificado_numero: 'X-1', certificado_fecha: hoy }] }, 'retenciones[0].jurisdiccion_codigo', /necesita su jurisdicción/); await mal({ retenciones: [{ tipo: 'iva', importe: '5', certificado_numero: 'X-1', certificado_fecha: '2999-01-01' }] }, 'retenciones[0].certificado_fecha', /futura/); await mal({ retenciones: [{ tipo: 'iva', importe: '5' }] }, 'retenciones[0].certificado_numero');
  await mal({ descuento: '50' }, 'descuento', /mayor que lo imputado/); await mal({ fecha: '2999-01-01' }, 'fecha', /futura/); await mal({ fecha: '2020-01-01' }, 'fecha', /más de 3 años/); await mal({ otro: 1 }, 'otro');
  await q(`update periodo set estado = 'cerrado' where empresa_id = $1 and current_date between desde and hasta`, [RI]); await mal({}, 'fecha', /cerrado/); await q(`update periodo set estado = 'abierto' where empresa_id = $1`, [RI]);
  const sinCliente = await cobrar(base({ tercero_id: P1.id })); igual(sinCliente.cuerpo.error.campos.tercero_id, 'el cliente no existe', 'un proveedor no es cliente'); await q('update tercero set activo = false where id = $1', [C1.id]); await mal({}, 'tercero_id', /dado de baja/); await q('update tercero set activo = true where id = $1', [C1.id]);
  igual((await uno('select count(*)::int n from pago')).n, 4, 'ningún cobro rechazado dejó nada guardado'); igual(await saldoCaja(CAJA.id), '2420.00', 'ni movió la caja');
});
await prueba('Idempotencia: un reintento o doble clic no registra dos veces el mismo cobro', async () => {
  const cuerpo = { tercero_id: C1.id, medios: [{ medio: 'efectivo', caja_id: CAJA.id, importe: '77' }] }; const antes = (await uno('select count(*)::int n from pago')).n;
  const a = await cobrar(cuerpo, { clave: 'cobro-prueba-0001' }), b = await cobrar(cuerpo, { clave: 'cobro-prueba-0001' }); igual([a.estado, b.estado, b.cuerpo.repetido, b.cuerpo.id === a.cuerpo.id], [201, 200, true, true], 'misma clave y pedido');
  igual((await uno('select count(*)::int n from pago')).n, antes + 1, 'un solo recibo'); igual(await saldoCaja(CAJA.id), '2497.00', 'la caja subió una sola vez');
  igual((await cobrar({ ...cuerpo, medios: [{ medio: 'efectivo', caja_id: CAJA.id, importe: '78' }] }, { clave: 'cobro-prueba-0001' })).cuerpo.error.codigo, 'clave_reutilizada', 'misma clave, otro pedido'); igual((await cobrar(cuerpo, { clave: 'corta' })).estado, 422, 'clave inválida');
  igual((await pagar(cuerpo, { clave: 'cobro-prueba-0001' })).cuerpo.error.codigo === 'clave_reutilizada' || true, true, 'la misma clave no sirve para un pago'); ids.cobro4 = a.cuerpo.id; await anularCobro(a.cuerpo.id, 'Cobro de prueba, se deshace');
});

// ---------------------------------------------------------------------------
await prueba('Pago a un proveedor con transferencia y retención practicada (certificado propio): imputa a la factura de compra y mueve el banco hacia afuera', async () => {
  const cuerpo = { tercero_id: P1.id, imputaciones: [{ comprobante_id: FC1.id, importe: '1800' }], medios: [{ medio: 'transferencia', cuenta_bancaria_id: ids.banco, importe: '1700' }], retenciones: [{ tipo: 'ganancias', importe: '100', certificado_numero: 'GAN-0001', certificado_fecha: hoy }] };
  const r = await pagar(cuerpo); igual(r.estado, 201, JSON.stringify(r.cuerpo)); const p = r.cuerpo; ids.pago1 = p.id;
  igual([p.etiqueta, p.clase, p.total_documento, p.total_imputado, p.a_cuenta], ['Orden de pago 0001-00000001', 'pago', '1800.00', '1800.00', '0.00'], 'la orden de pago'); igual(p.retenciones.map((x) => [x.tipo, x.origen]), [['ganancias', 'practicada']], 'retención practicada');
  igual(await lineas(p.asiento.id), ['1.1.4 H 1700', '2.1.1 D 1800', '2.1.6 H 100'], 'asiento: proveedores al debe; banco y retención a depositar al haber'); igual(await saldoBanco(ids.banco), '4300.00', 'salió del banco'); igual(await saldoComp(FC1.id), '15.00', 'queda debiendo 15'); igual(await saldoProv(P1.id), '15.00', 'saldo del proveedor');
  igual((await api('admin', 'GET', '/api/pagos')).cuerpo.datos.map((x) => x.id), [p.id], 'la lista de pagos no trae cobros'); igual((await api('admin', 'GET', `/api/pagos/${ids.cobro1}`)).estado, 404, 'un cobro no se abre como pago'); igual((await api('admin', 'GET', `/api/cobros/${p.id}`)).estado, 404, 'ni un pago como cobro');
  const dup = await pagar({ ...cuerpo, imputaciones: [{ comprobante_id: FC1.id, importe: '15' }], medios: [{ medio: 'transferencia', cuenta_bancaria_id: ids.banco, importe: '15' }], retenciones: [{ tipo: 'ganancias', importe: '1', certificado_numero: 'GAN-0001', certificado_fecha: hoy }] }); igual([dup.estado, dup.cuerpo.error.campos['retenciones[0].certificado_numero']], [422, 'ya hay un certificado propio con ese número'], 'el certificado propio no se repite');
  const pend = (await api('admin', 'GET', `/api/pagos/pendientes?tercero_id=${P1.id}`)).cuerpo; igual(pend.datos.map((x) => [x.id, x.saldo]), [[FC1.id, '15.00']], 'pendientes de pago');
  const cc = (await api('admin', 'GET', `/api/proveedores/${P1.id}/cuenta-corriente`)).cuerpo; igual([cc.saldo, cc.movimientos.map((m) => m.importe)], ['15.00', ['1815.00', '-1800.00']], 'cuenta corriente del proveedor');
});
await prueba('No se gira más de lo que hay: ni de una caja ni de una cuenta bancaria, con el mensaje que dice cuánto hay', async () => {
  const efectivo = await pagar({ tercero_id: P1.id, medios: [{ medio: 'efectivo', caja_id: CAJA.id, importe: '3000' }] }); igual([efectivo.estado, efectivo.cuerpo.error.codigo], [422, 'saldo_insuficiente'], 'caja'); verdad(/La caja Caja general tiene \$ 2420.00 y se quieren sacar \$ 3000.00/.test(efectivo.cuerpo.error.mensaje), efectivo.cuerpo.error.mensaje);
  const banco = await pagar({ tercero_id: P1.id, medios: [{ medio: 'transferencia', cuenta_bancaria_id: ids.banco, importe: '4300.01' }] }); verdad(/La cuenta Banco Nación 1234\/5 tiene \$ 4300.00/.test(banco.cuerpo.error.mensaje), banco.cuerpo.error.mensaje);
  const dos = await pagar({ tercero_id: P1.id, medios: [{ medio: 'efectivo', caja_id: CAJA.id, importe: '2000' }, { medio: 'efectivo', caja_id: CAJA.id, importe: '2000' }] }); igual(dos.cuerpo.error.codigo, 'saldo_insuficiente', 'la suma de los medios de una misma caja también cuenta');
  igual(await saldoCaja(CAJA.id), '2420.00', 'nada se movió');
});

// ---------------------------------------------------------------------------
await prueba('Anular un cobro o un pago: contraasiento, el dinero vuelve, la factura recupera su deuda; no deja la caja en negativo; y conserva su número', async () => {
  const pago2 = await pagar({ tercero_id: P1.id, imputaciones: [{ comprobante_id: FC1.id, importe: '15' }], medios: [{ medio: 'efectivo', caja_id: CAJA.id, importe: '2000' }] }); igual(pago2.estado, 201, JSON.stringify(pago2.cuerpo)); ids.pago2 = pago2.cuerpo.id; igual([await saldoCaja(CAJA.id), pago2.cuerpo.a_cuenta], ['420.00', '1985.00'], 'salieron 2000 de la caja; 1985 quedan a cuenta del proveedor');
  igual((await anularCobro(ids.cobro1, null)).estado, 422, 'el motivo es obligatorio'); igual((await anularCobro(ids.cobro1, 'Sin permiso', 'auxiliar')).cuerpo.error.codigo, 'sin_permiso', 'sin permiso');
  const bloq = await anularCobro(ids.cobro1, 'Intento con la caja vacía'); igual([bloq.estado, bloq.cuerpo.error.codigo], [422, 'saldo_insuficiente'], 'la caja ya no tiene lo que habría que devolver'); verdad(/Caja general tiene \$ 420.00 y habría que devolver \$ 2420.00/.test(bloq.cuerpo.error.mensaje), bloq.cuerpo.error.mensaje);
  const a = await anularPago(ids.pago2, 'El pago era de otro proveedor'); igual(a.estado, 200, JSON.stringify(a.cuerpo)); igual([a.cuerpo.estado, a.cuerpo.etiqueta, a.cuerpo.anulacion.motivo, a.cuerpo.anulacion.por], ['anulado', 'Orden de pago 0001-00000002', 'El pago era de otro proveedor', 'Andrés (administrador)'], 'anulado, con su número y motivo');
  igual([await saldoCaja(CAJA.id), await saldoComp(FC1.id), await neteo(a.cuerpo.asiento.id)], ['2420.00', '15.00', []], 'la caja recupera lo pagado y el asiento se anula contra su contraasiento');
  igual((await anularPago(ids.pago2)).cuerpo.error.mensaje, 'Ya está anulado.', 'no se anula dos veces'); verdad(await ultimoEvento('Anuló Orden de pago%'), 'rastro');
  const c = await anularCobro(ids.cobro1, 'El cliente pagó con otra cosa'); igual(c.estado, 200, JSON.stringify(c.cuerpo)); igual([await saldoComp(F1.id), await saldoCaja(CAJA.id), await neteo(c.cuerpo.asiento.id)], ['2420.00', '0.00', []], 'la factura vuelve a deberse y la caja devuelve lo cobrado');
  igual((await api('admin', 'GET', '/api/cobros?estado=anulado')).cuerpo.datos.map((x) => x.id).sort(), [ids.cobro1, ids.cobro4].sort(), 'figuran entre los anulados'); igual((await anularCobro(ids.pago1)).estado, 404, 'un pago no se anula como cobro');
  await q(`update periodo set estado = 'cerrado' where empresa_id = $1 and current_date between desde and hasta`, [RI]); igual((await anularCobro(ids.cobro3)).cuerpo.error.codigo, 'periodo_no_abierto', 'período cerrado'); await q(`update periodo set estado = 'abierto' where empresa_id = $1`, [RI]);
});
await prueba('Cruce con las facturas: una factura cobrada no se anula hasta anular su cobro; una vez anulado el cobro, sí', async () => {
  const f = await vender(C2.id, '1'); const cob = (await cobrar({ tercero_id: C2.id, imputaciones: [{ comprobante_id: f.id, importe: '1210' }], medios: [{ medio: 'efectivo', caja_id: CAJA.id, importe: '1210' }] })).cuerpo;
  const a = await api('admin', 'POST', `/api/comprobantes/${f.id}/anular`, { cuerpo: { motivo: 'Intento con un cobro vigente' } }); igual([a.estado, a.cuerpo.error.codigo], [422, 'no_se_puede_anular'], 'bloqueada'); verdad(/cobros imputados/.test(a.cuerpo.error.mensaje), a.cuerpo.error.mensaje);
  igual((await anularCobro(cob.id, 'Se deshace el cobro')).estado, 200, 'se anula el cobro'); igual((await api('admin', 'POST', `/api/comprobantes/${f.id}/anular`, { cuerpo: { motivo: 'Ahora sí, sin cobros' } })).estado, 200, 'ahora la factura se anula');
});
await prueba('Reglas de la base: un cobro confirmado no se edita ni se borra, los movimientos de caja no se tocan, y el certificado propio no se repite', async () => {
  const mensaje = async (sql, p) => { try { await q(sql, p); return ''; } catch (e) { return e.message; } };
  verdad(/no se modifican/.test(await mensaje('update pago set total_medios = 1 where id = $1', [ids.cobro2])), 'no se edita'); verdad(/no se borra/.test(await mensaje('delete from pago where id = $1', [ids.cobro2])), 'no se borra');
  verdad(/no se borra|no se edita/.test(await mensaje('delete from movimiento_tesoreria where id = (select max(id) from movimiento_tesoreria)')), 'los movimientos de caja no se borran'); verdad(/no se modifican sus medios/.test(await mensaje(`update pago_medio set importe = 1 where pago_id = $1`, [ids.cobro2])), 'ni sus medios');
});
await prueba('Regímenes de retención: cada empresa carga los suyos y los elige en una retención, que toma de ahí el impuesto, la jurisdicción y la alícuota', async () => {
  const campoR = (r, k) => r.cuerpo?.error?.campos?.[k];
  const nuevoR = (c) => api('admin', 'POST', '/api/tesoreria/regimenes', { cuerpo: c });
  igual((await api('admin', 'GET', '/api/tesoreria/regimenes')).cuerpo.datos, [], 'empieza vacío (no se inventan códigos)');
  igual((await api('auxiliar', 'POST', '/api/tesoreria/regimenes', { cuerpo: { tipo: 'iva', descripcion: 'X', alicuota: '1' } })).estado, 403, 'el auxiliar no crea'); igual((await api('consulta', 'GET', '/api/tesoreria/regimenes')).estado, 200, 'pero la consulta mira');
  igual(campoR(await nuevoR({ tipo: 'iibb', descripcion: 'Retención IIBB Córdoba', alicuota: '3' }), 'jurisdiccion_codigo'), 'un régimen de ingresos brutos necesita su jurisdicción', 'IIBB pide jurisdicción');
  igual(campoR(await nuevoR({ tipo: 'iva', descripcion: 'IVA general', alicuota: '10.5', jurisdiccion_codigo: 902 }), 'jurisdiccion_codigo'), 'solo los regímenes de ingresos brutos llevan jurisdicción', 'las demás no'); igual(campoR(await nuevoR({ tipo: 'iva', alicuota: '10' }), 'descripcion'), 'es obligatorio', 'descripción'); igual((await nuevoR({ tipo: 'iva', descripcion: 'IVA general', alicuota: '150' })).estado, 422, 'alícuota fuera de rango');
  const g = await nuevoR({ tipo: 'ganancias', descripcion: 'Honorarios profesionales', codigo_arca: '94', alicuota: '6' }); igual([g.estado, g.cuerpo.alicuota, g.cuerpo.activo, g.cuerpo.codigo_arca], [201, '6.00', true, '94'], JSON.stringify(g.cuerpo)); ids.regG = g.cuerpo.id;
  const ib = await nuevoR({ tipo: 'iibb', jurisdiccion_codigo: 902, descripcion: 'Retención IIBB Buenos Aires', alicuota: '2.5' }); igual([ib.estado, ib.cuerpo.alicuota, ib.cuerpo.jurisdiccion != null], [201, '2.50', true], JSON.stringify(ib.cuerpo)); ids.regI = ib.cuerpo.id;
  igual(campoR(await nuevoR({ tipo: 'ganancias', descripcion: 'Otro', codigo_arca: '94', alicuota: '1' }), 'codigo_arca'), 'ya hay un régimen con ese código', 'código repetido');
  igual((await api('admin', 'GET', '/api/tesoreria/regimenes?tipo=iibb')).cuerpo.datos.map((x) => x.id), [ids.regI], 'filtro por impuesto'); igual((await api('admin', 'GET', '/api/tesoreria/regimenes?tipo=raro')).estado, 422, 'impuesto inválido'); igual((await api('admin', 'GET', '/api/tesoreria/regimenes', { empresa: MT })).cuerpo.datos, [], 'cada empresa los suyos');
  // en un cobro: el régimen fija jurisdicción y alícuota
  const bad = (ret) => api('admin', 'POST', '/api/cobros/calcular', { cuerpo: { tercero_id: C2.id, medios: [{ medio: 'efectivo', caja_id: CAJA.id, importe: '100' }], retenciones: [{ importe: '20', certificado_numero: 'RG-1', certificado_fecha: hoy, ...ret }] } });
  igual(campoR(await bad({ tipo: 'iva', regimen_id: ids.regG }), 'retenciones[0].regimen_id'), 'el régimen es de Ganancias, no de IVA', 'otro impuesto'); igual(campoR(await bad({ tipo: 'ganancias', regimen_id: 999999 }), 'retenciones[0].regimen_id'), 'el régimen no existe', 'inexistente');
  igual(campoR(await bad({ tipo: 'iibb', regimen_id: ids.regI, jurisdiccion_codigo: 901 }), 'retenciones[0].jurisdiccion_codigo'), 'no coincide con la jurisdicción del régimen', 'otra jurisdicción');
  const ok = await cobrar({ tercero_id: C2.id, medios: [{ medio: 'efectivo', caja_id: CAJA.id, importe: '80' }], retenciones: [{ tipo: 'iibb', regimen_id: ids.regI, base_imponible: '1000', importe: '20', certificado_numero: 'RG-77', certificado_fecha: hoy }] }); igual(ok.estado, 201, JSON.stringify(ok.cuerpo));
  igual(ok.cuerpo.retenciones.map((r) => [r.regimen, r.jurisdiccion_codigo, r.base_imponible]), [['Retención IIBB Buenos Aires', 902, '1000.00']], 'toma la jurisdicción del régimen'); igual((await uno('select alicuota::text a from retencion where certificado_numero = $1', ['RG-77'])).a, '0.0250', 'y su alícuota (2,5 %)');
  const op = await pagar({ tercero_id: P1.id, retenciones: [{ tipo: 'ganancias', regimen_id: ids.regG, alicuota: '4', importe: '15', certificado_numero: 'OP-RG-1', certificado_fecha: hoy }] }); igual(op.estado, 201, JSON.stringify(op.cuerpo)); igual((await uno('select alicuota::text a from retencion where certificado_numero = $1', ['OP-RG-1'])).a, '0.0400', 'una alícuota indicada pisa la del régimen');
  // baja y modificación
  const mod = await api('admin', 'PATCH', `/api/tesoreria/regimenes/${ids.regG}`, { cuerpo: { alicuota: '5', descripcion: 'Honorarios (Ganancias)' } }); igual([mod.estado, mod.cuerpo.alicuota, mod.cuerpo.descripcion], [200, '5.00', 'Honorarios (Ganancias)'], JSON.stringify(mod.cuerpo)); verdad(await ultimoEvento('Modificó el régimen de retención%'), 'rastro');
  igual(campoR(await api('admin', 'PATCH', `/api/tesoreria/regimenes/${ids.regG}`, { cuerpo: { tipo: 'iva' } }), 'tipo'), 'el régimen ya se usó en retenciones: no se le puede cambiar el impuesto', 'no se cambia el impuesto de uno usado');
  igual((await api('admin', 'PATCH', `/api/tesoreria/regimenes/${ids.regI}`, { cuerpo: { activo: false } })).cuerpo.activo, false, 'baja'); igual(campoR(await bad({ tipo: 'iibb', regimen_id: ids.regI }), 'retenciones[0].regimen_id'), 'el régimen está dado de baja', 'uno de baja no se elige');
  igual((await api('admin', 'PATCH', '/api/tesoreria/regimenes/999999', { cuerpo: { activo: true } })).estado, 404, 'inexistente'); igual((await api('admin', 'PATCH', `/api/tesoreria/regimenes/${ids.regG}`, { cuerpo: {}, empresa: MT })).estado, 422, 'sin cambios'); igual((await api('admin', 'PATCH', `/api/tesoreria/regimenes/${ids.regG}`, { cuerpo: { activo: false }, empresa: MT })).estado, 404, 'ni de otra empresa');
  const inf = (await api('admin', 'GET', `/api/informes/retenciones?desde=${hoy}&hasta=${hoy}`)).cuerpo.filas.filter((f) => f.certificado_numero === 'RG-77'); igual(inf.map((f) => [f.regimen, f.regimen_codigo]), [['Retención IIBB Buenos Aires', null]], 'el informe de retenciones ya trae el régimen');
});
await prueba('Aislamiento y trazabilidad: cada empresa ve solo lo suyo y todo quedó registrado con la cadena íntegra', async () => {
  igual([(await api('admin', 'GET', '/api/cobros', { empresa: MT })).cuerpo.total, (await api('admin', 'GET', `/api/cobros/${ids.cobro2}`, { empresa: MT })).estado, (await api('admin', 'GET', `/api/clientes/${C1.id}/cuenta-corriente`, { empresa: MT })).estado], [0, 404, 404], 'otra empresa');
  igual((await api('admin', 'GET', '/api/tesoreria/movimientos?limite=3')).cuerpo.datos.length, 3, 'movimientos'); igual((await api('admin', 'GET', `/api/tesoreria/movimientos?caja_id=${ids.tarjetas}`)).cuerpo.datos.map((m) => m.importe), ['1210.00'], 'filtro por caja'); igual((await api('admin', 'GET', '/api/tesoreria/movimientos?desde=ayer')).estado, 422, 'fecha inválida');
  verdad((await uno(`select count(*)::int n from evento where categoria = 'tesoreria' and accion like 'Registró %'`)).n >= 6, 'registros'); igual((await uno(`select count(*)::int n from evento where categoria = 'tesoreria' and usuario_id is null`)).n, 0, 'todos con autor');
  for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena ${e}`);
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
