// Pruebas de informes contables: libros de IVA (con notas de crédito y comprobantes anulados), posición de IVA, balance de sumas y saldos, mayor, diario,
// estados contables, antigüedad de deuda, retenciones y la descarga a CSV. Se cruzan contra otras fuentes (saldos de caja, libro de IVA) para que no
// dependan de un solo cálculo. Con --pg pasan por el adaptador de producción (pg + migrador) contra PGlite por socket.
// Uso:  node api/probar_informes.mjs [--pg]
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
const inf = (quien, nombre, consulta = '', o = {}) => api(quien, 'GET', `/api/informes/${nombre}${consulta ? `?${consulta}` : ''}`, o);
const hoyRango = `desde=${hoy}&hasta=${hoy}`;
const csv = async (nombre, consulta = '', t = SESION.admin, empresa = RI) => {
  const r = await fetch(`${srv.base}/api/informes/${nombre}?${consulta ? `${consulta}&` : ''}formato=csv`, { headers: { Authorization: `Bearer ${t}`, 'X-Empresa-Id': String(empresa) } });
  const buf = Buffer.from(await r.arrayBuffer());                                  // fetch().text() se come el BOM: se mira en los bytes
  return { estado: r.status, tipo: r.headers.get('content-type'), disposicion: r.headers.get('content-disposition'), bom: buf.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), texto: buf.toString('utf8').replace(/^﻿/, '') };
};
const fila = (r, codigo) => r.cuerpo.filas.find((f) => f.codigo === codigo);
const sumaDe = (xs) => xs.reduce((s, x) => s + Math.round(Number(x) * 100), 0) / 100;

// --- movimientos: ventas (F1 2420, F2 1210, F3 1210), una nota de crédito sobre F2, una factura anulada (F3), una compra (1815), un cobro y un pago con retenciones
const NC2 = (await api('admin', 'POST', '/api/ventas/notas-credito', { cuerpo: { comprobante_origen_id: F2.id, motivo: 'Devolución total' } })).cuerpo;
const anuladaF3 = await api('admin', 'POST', `/api/comprobantes/${F3.id}/anular`, { cuerpo: { motivo: 'Se facturó por error' } });
const COBRO = (await cobrar({ tercero_id: C1.id, imputaciones: [{ comprobante_id: F1.id, importe: '2000' }], medios: [{ medio: 'efectivo', caja_id: CAJA.id, importe: '1900' }], retenciones: [{ tipo: 'iibb', jurisdiccion_codigo: 902, importe: '100', certificado_numero: 'R-0001', certificado_fecha: hoy }] })).cuerpo;
const PAGO = (await pagar({ tercero_id: P1.id, imputaciones: [{ comprobante_id: FC1.id, importe: '1000' }], medios: [{ medio: 'efectivo', caja_id: CAJA.id, importe: '950' }], retenciones: [{ tipo: 'ganancias', importe: '50', certificado_numero: 'G-0001', certificado_fecha: hoy }] })).cuerpo;
if (!NC2?.id || anuladaF3.estado !== 200 || !COBRO?.id || !PAGO?.id) throw new Error(`datos de partida: ${JSON.stringify({ NC2, anuladaF3, COBRO, PAGO }).slice(0, 400)}`);

// ---------------------------------------------------------------------------
await prueba('Permisos: informes.ver lo tienen los cuatro roles; sin sesión o de otra empresa no se ve nada', async () => {
  const roles = (await api('admin', 'GET', '/api/estudio/roles')).cuerpo.datos;
  igual(['Administrador', 'Contador', 'Auxiliar', 'Consulta'].map((n) => roles.find((r) => r.nombre === n).permisos.includes('informes.ver')), [true, true, true, true], 'quién tiene informes.ver');
  for (const quien of ['consulta', 'auxiliar']) igual((await inf(quien, 'libro-iva-ventas', hoyRango)).estado, 200, `${quien} mira`);
  igual((await inf('', 'libro-iva-ventas')).estado, 401, 'sin sesión'); igual((await inf('admin', 'inexistente')).estado, 404, 'informe inexistente');
  const ajena = await inf('admin', 'libro-iva-ventas', hoyRango, { empresa: MT }); igual([ajena.estado, ajena.cuerpo.filas.length], [200, 0], 'otra empresa: lo suyo, que está vacío');
});
await prueba('Libro de IVA ventas: suma lo vendido, la nota de crédito entra en negativo y la factura anulada no figura (pero se avisa)', async () => {
  const r = (await inf('admin', 'libro-iva-ventas', hoyRango)).cuerpo, tipos = r.filas.map((f) => `${f.tipo}|${f.total}`);
  igual(r.filas.length, 3, JSON.stringify(tipos)); verdad(r.filas.some((f) => f.total === '2420.00'), 'F1'); verdad(r.filas.some((f) => f.total === '-1210.00'), 'la nota de crédito va en negativo');
  igual([r.totales.neto_gravado, r.totales.iva_21, r.totales.iva_total, r.totales.total], ['2000.00', '420.00', '420.00', '2420.00'], 'totales: F1 + F2 − NC');
  verdad(r.avisos.length === 1 && /1 comprobante anulado/.test(r.avisos[0]), JSON.stringify(r.avisos)); igual(r.cantidad, 3, 'cantidad');
  verdad(r.filas.every((f) => /^\d{4}-\d{8}$/.test(f.numero_formateado)), 'numeración con formato'); verdad(r.filas.every((f, i, a) => !i || a[i - 1].fecha <= f.fecha), 'ordenado por fecha');
  igual((await inf('admin', 'libro-iva-ventas', 'desde=2020-01-01&hasta=2020-01-31')).cuerpo.filas.length, 0, 'otro mes: vacío');
});
await prueba('Libro de IVA compras y posición de IVA: el crédito fiscal sale de la compra y el saldo descuenta las retenciones de IVA', async () => {
  const c = (await inf('admin', 'libro-iva-compras', hoyRango)).cuerpo;
  igual([c.filas.length, c.totales.neto_gravado, c.totales.iva_21, c.totales.total, c.filas[0].numero_formateado], [1, '1500.00', '315.00', '1815.00', '0004-00001234'], 'la compra con el número del proveedor');
  const p = (await inf('admin', 'posicion-iva', `desde=${hoy.slice(0, 7)}-01&hasta=${hoy}`)).cuerpo;
  igual(p.filas.length, 1, 'un mes'); igual([p.filas[0].debito, p.filas[0].credito, p.filas[0].saldo_tecnico, p.filas[0].saldo], ['420.00', '315.00', '105.00', '105.00'], 'débito 420 − crédito 315 (la retención de IIBB no es de IVA)');
});
await prueba('Balance de sumas y saldos: debe = haber, saldos deudores = acreedores, y coincide con las cajas y con el IVA de los libros', async () => {
  const b = await inf('admin', 'balance', hoyRango), r = b.cuerpo;
  igual(b.estado, 200, JSON.stringify(b.cuerpo));
  igual(r.totales.debe, r.totales.haber, 'debe = haber'); igual(r.totales.saldo_deudor, r.totales.saldo_acreedor, 'deudores = acreedores'); igual(r.avisos, [], 'sin avisos');
  const caja = fila(b, '1.1.1'), deb = fila(b, '2.1.4'), cred = fila(b, '1.1.5');
  igual(caja.saldo_final, '950.00', 'la cuenta Caja'); igual(Number(await saldoCaja(CAJA.id)), 950, 'coincide con el saldo de la caja');
  igual([deb.saldo_acreedor, cred.saldo_deudor], ['420.00', '315.00'], 'IVA débito y crédito = libros');
  verdad(r.filas.every((f, i, a) => !i || a[i - 1].codigo <= f.codigo), 'ordenado por código');
  const futuro = (await inf('admin', 'balance', 'desde=2030-01-01&hasta=2030-12-31')).cuerpo;
  igual([futuro.filas.length > 0, futuro.totales.debe], [true, '0.00'], 'un período futuro: sin movimientos pero con el saldo que se arrastra');
  const arrastre = futuro.filas.find((f) => f.codigo === '1.1.1'); igual([arrastre.saldo_anterior, arrastre.saldo_final], [caja.saldo_final, caja.saldo_final], 'el saldo anterior es el final del período previo');
  igual(futuro.filas.find((f) => f.codigo === '4.1.1')?.saldo_anterior ?? '0.00', '0.00', 'las cuentas de resultado empiezan de cero con el ejercicio nuevo');
});
await prueba('Libro mayor: saldo corrido, saldo anterior y final que coinciden con el balance; exige la cuenta', async () => {
  const cuenta = (await uno(`select id from plan_cuenta where empresa_id = $1 and codigo = '1.1.1'`, [RI])).id, b = await inf('admin', 'balance', hoyRango);
  const m = await inf('admin', 'mayor', `cuenta_id=${cuenta}&${hoyRango}`), r = m.cuerpo; igual(m.estado, 200, JSON.stringify(r));
  igual([r.cuenta.codigo, r.saldo_anterior, r.filas.length], ['1.1.1', '0.00', 2], 'dos movimientos: el cobro y el pago'); igual(r.filas.map((f) => f.saldo), ['1900.00', '950.00'], 'saldo corrido');
  igual([r.totales.debe, r.totales.haber, r.totales.saldo_final], ['1900.00', '950.00', fila(b, '1.1.1').saldo_final], 'totales y saldo final = balance');
  verdad(/^Recibo/.test(r.filas[0].descripcion) && /^Orden de pago/.test(r.filas[1].descripcion), JSON.stringify(r.filas.map((f) => f.descripcion)));
  igual((await inf('admin', 'mayor', hoyRango)).cuerpo.error.campos.cuenta_id, 'elegí la cuenta', 'sin cuenta'); igual((await inf('admin', 'mayor', `cuenta_id=999999&${hoyRango}`)).estado, 404, 'cuenta inexistente');
  const sig = await inf('admin', 'mayor', `cuenta_id=${cuenta}&desde=2030-01-01&hasta=2030-01-31`); igual([sig.cuerpo.saldo_anterior, sig.cuerpo.filas.length, sig.cuerpo.totales.saldo_final], ['950.00', 0, '950.00'], 'el saldo se arrastra');
  const ventas = (await uno(`select id from plan_cuenta where empresa_id = $1 and codigo = '4.1.1'`, [RI])).id; igual((await inf('admin', 'mayor', `cuenta_id=${ventas}&desde=2030-01-01&hasta=2030-01-31`)).cuerpo.saldo_anterior, '0.00', 'resultado: empieza de cero');
  igual((await inf('admin', 'mayor', `cuenta_id=${cuenta}&${hoyRango}`, { empresa: MT })).estado, 404, 'la cuenta de otra empresa no se ve');
});
await prueba('Libro diario: todos los asientos contabilizados, cada uno balanceado, con paginado', async () => {
  const r = (await inf('admin', 'diario', hoyRango)).cuerpo, esperado = (await uno(`select count(*)::int n from asiento where estado = 'contabilizado' and empresa_id = $1 and fecha = $2`, [RI, hoy])).n;
  igual(r.total, esperado, 'cantidad de asientos'); verdad(r.total >= 6, `hay asientos: ${r.total}`);
  for (const a of r.filas) igual(sumaDe(a.lineas.map((l) => l.debe)), sumaDe(a.lineas.map((l) => l.haber)), `asiento ${a.numero} balanceado`);
  igual(r.totales.debe, r.totales.haber, 'debe = haber');
  const pag = (await inf('admin', 'diario', `${hoyRango}&limite=2&desplazamiento=2`)).cuerpo; igual([pag.filas.length, pag.total, pag.filas[0].numero], [2, esperado, r.filas[2].numero], 'segunda página');
  igual((await inf('admin', 'diario', 'desde=2020-01-01&hasta=2020-01-02')).cuerpo.total, 0, 'sin asientos ese día');
});
await prueba('Estados contables: ingresos y egresos del período, y la situación patrimonial cuadra (activo = pasivo + patrimonio + resultados)', async () => {
  const e = await inf('admin', 'estados-contables', `desde=${hoy.slice(0, 4)}-01-01&hasta=${hoy}`), r = e.cuerpo; igual(e.estado, 200, JSON.stringify(r));
  igual(r.situacion.diferencia, '0.00', 'cuadra'); igual(r.avisos.some((a) => /no coinciden/.test(a)), false, 'sin aviso de descuadre');
  igual(r.resultados.resultado, (sumaDe([r.resultados.total_ingresos]) - sumaDe([r.resultados.total_egresos])).toFixed(2), 'resultado = ingresos − egresos');
  igual(r.resultados.ingresos.find((f) => f.codigo === '4.1.1').importe, '2000.00', 'ventas netas: F1 + F2 − nota de crédito (F3 anulada compensa)');
  igual(r.resultados.egresos.find((f) => f.codigo === '5.1.1').importe, '1500.00', 'compras netas');
  igual(r.situacion.resultados_acumulados, r.resultados.resultado, 'este año es el único: lo acumulado es el resultado'); igual(r.situacion.activo.find((f) => f.codigo === '1.1.1').importe, '950.00', 'la caja');
  const antes = (await inf('admin', 'estados-contables', 'desde=2020-01-01&hasta=2020-12-31')).cuerpo; igual([antes.resultados.resultado, antes.situacion.total_activo, antes.situacion.diferencia], ['0.00', '0.00', '0.00'], 'antes de operar: todo en cero');
});
await prueba('Deuda por antigüedad: lo que se debe por cliente y por proveedor, en tramos, y lo no aplicado', async () => {
  const cl = (await inf('admin', 'deuda-clientes')).cuerpo;
  igual(cl.filas.map((f) => [f.razon_social, f.deuda]), [['Distribuidora Sur SRL', '420.00']], 'cliente con deuda: F1 2420 − 2000 cobrados; F2 saldada por la nota; F3 anulada');
  igual([cl.filas[0].a_vencer, cl.filas[0].vencido_1_30, cl.filas[0].saldo_neto, cl.filas[0].sin_aplicar], ['420.00', '0.00', '420.00', '0.00'], 'tramos y neto'); igual(cl.totales.deuda, '420.00', 'total');
  const pr = (await inf('admin', 'deuda-proveedores')).cuerpo; igual(pr.filas.map((f) => [f.razon_social, f.deuda, f.saldo_neto]), [['Molinos del Sur SA', '815.00', '815.00']], 'proveedor: 1815 − 1000');
  // vencimientos: una factura vencida hace 45 días cae en el tramo 31-60
  await q(`update comprobante set fecha_vto_pago = current_date - 45 where id = $1`, [F1.id]);
  const v = (await inf('admin', 'deuda-clientes')).cuerpo.filas[0]; igual([v.a_vencer, v.vencido_31_60, v.deuda], ['0.00', '420.00', '420.00'], 'vencida hace 45 días');
  await q(`update comprobante set fecha_vto_pago = current_date - 120 where id = $1`, [F1.id]); igual((await inf('admin', 'deuda-clientes')).cuerpo.filas[0].vencido_mas_90, '420.00', 'más de 90');
  await q(`update comprobante set fecha_vto_pago = null where id = $1`, [F1.id]);
  igual((await inf('admin', 'deuda-clientes', '', { empresa: MT })).cuerpo.filas.length, 0, 'otra empresa');
});
await prueba('Retenciones: sufridas y practicadas con su certificado, filtros y resumen por impuesto', async () => {
  const r = (await inf('admin', 'retenciones', hoyRango)).cuerpo;
  igual(r.filas.map((f) => [f.origen, f.tipo, f.certificado_numero, f.importe, f.comprobante.slice(0, 6)]), [['sufrida', 'iibb', 'R-0001', '100.00', 'Recibo'], ['practicada', 'ganancias', 'G-0001', '50.00', 'Orden ']], 'las dos');
  igual(r.filas[0].jurisdiccion != null, true, 'la jurisdicción de IIBB'); igual(r.totales.importe, '150.00', 'total'); igual(r.resumen.map((x) => [x.origen, x.tipo, x.cantidad, x.importe]), [['sufrida', 'iibb', 1, '100.00'], ['practicada', 'ganancias', 1, '50.00']], 'resumen');
  igual((await inf('admin', 'retenciones', `${hoyRango}&origen=sufrida`)).cuerpo.filas.length, 1, 'solo sufridas'); igual((await inf('admin', 'retenciones', `${hoyRango}&tipo=iva`)).cuerpo.filas.length, 0, 'solo IVA');
  igual((await inf('admin', 'retenciones', `${hoyRango}&origen=otra`)).cuerpo.error.campos.origen, 'tiene que ser sufrida o practicada', 'origen inválido');
  await anularPago(PAGO.id); igual((await inf('admin', 'retenciones', hoyRango)).cuerpo.filas.length, 1, 'un pago anulado ya no cuenta');
});
await prueba('Validaciones de fechas: formato, orden y valores por defecto', async () => {
  igual((await inf('admin', 'libro-iva-ventas', 'desde=ayer')).cuerpo.error.campos.desde, 'tiene que ser una fecha (aaaa-mm-dd)', 'formato'); igual((await inf('admin', 'balance', 'desde=2026-02-30&hasta=2026-03-01')).estado, 422, 'fecha inexistente');
  igual((await inf('admin', 'libro-iva-compras', 'desde=2026-05-10&hasta=2026-05-01')).cuerpo.error.campos.hasta, 'no puede ser anterior a la fecha de inicio', 'orden');
  const d = (await inf('admin', 'libro-iva-ventas')).cuerpo; igual([d.desde, d.hasta], [`${hoy.slice(0, 8)}01`, hoy], 'por defecto: lo que va del mes');
});
await prueba('CSV: se descarga con BOM, importes negativos como números, y queda constancia en la trazabilidad', async () => {
  const r = await csv('libro-iva-ventas', hoyRango); igual(r.estado, 200, r.texto.slice(0, 200)); verdad(/text\/csv/.test(r.tipo), r.tipo); verdad(/attachment; filename="libro-iva-ventas-/.test(r.disposicion), r.disposicion);
  verdad(r.bom && r.texto.startsWith('Fecha,Tipo,Número,Razón social'), r.texto.slice(0, 60)); const lineasCsv = r.texto.trim().split('\r\n'); igual(lineasCsv.length, 1 + 3 + 1, 'encabezado + 3 + totales');
  verdad(lineasCsv.some((l) => l.endsWith(',-1210.00')) && !lineasCsv.some((l) => l.includes("'-1210")), 'el negativo sigue siendo número'); verdad(lineasCsv.at(-1).startsWith('Totales,') && lineasCsv.at(-1).endsWith(',2420.00'), lineasCsv.at(-1));
  const e = await ultimoEvento('Exportó el informe%'); igual([e.categoria, e.accion, e.empresa_id], ['contabilidad', 'Exportó el informe Libro de IVA ventas a CSV', RI], JSON.stringify(e));
  const d = await csv('diario', hoyRango); verdad(d.bom && d.texto.startsWith('Fecha,Asiento,Descripción,Código,Cuenta,Detalle,Debe,Haber'), d.texto.slice(0, 80)); verdad(d.texto.trim().split('\r\n').length > 6, 'una fila por línea de asiento');
  const ec = await csv('estados-contables', `desde=${hoy.slice(0, 4)}-01-01&hasta=${hoy}`); verdad(/Resultado del período,,,/.test(ec.texto) && /Total activo/.test(ec.texto), ec.texto.slice(0, 200));
  igual((await csv('libro-iva-ventas', 'desde=malo')).estado, 422, 'filtros inválidos también en CSV'); igual((await csv('libro-iva-ventas', hoyRango, 'basura')).estado, 401, 'sin sesión');
  igual((await api('admin', 'GET', '/api/informes/cuentas?q=caja')).cuerpo.datos.some((c) => c.codigo === '1.1.1'), true, 'catálogo de cuentas para el mayor');
});
await prueba('Los informes no escriben nada: el mismo informe dos veces da lo mismo y la cadena de trazabilidad sigue íntegra', async () => {
  const a = JSON.stringify((await inf('admin', 'balance', hoyRango)).cuerpo), b = JSON.stringify((await inf('admin', 'balance', hoyRango)).cuerpo); igual(a, b, 'estable');
  igual((await uno(`select count(*)::int n from evento where accion like 'Exportó el informe%'`)).n >= 3, true, 'cada descarga dejó rastro'); for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena ${e}`);
});

// ---------------------------------------------------------------------------
// --- planillas fiscales: una compra con percepción de Ingresos Brutos
const FCP = (await api('admin', 'POST', '/api/compras/facturas', { cuerpo: { tercero_id: P1.id, letra: 'A', punto_venta: 4, numero: 2000, fecha: hoy, total: '1260', items: [{ descripcion: 'Servicio', cantidad: '1', precio_unitario: '1000', alicuota: '21' }], tributos: [{ tipo: 'percepcion_iibb', jurisdiccion_codigo: 902, importe: '50' }] } })).cuerpo;
if (!FCP?.id) throw new Error('compra con percepción: ' + JSON.stringify(FCP).slice(0, 300));
await prueba('Planilla de IVA ventas (comprobantes): códigos de ARCA, documento y montos con la nota de crédito en negativo; coincide con el libro', async () => {
  const p = (await inf('admin', 'iva-ventas-detalle', hoyRango)).cuerpo, libroV = (await inf('admin', 'libro-iva-ventas', hoyRango)).cuerpo;
  igual(p.filas.length, 3, 'tres comprobantes'); const f1 = p.filas.find((f) => f.total === '2420.00'), nc = p.filas.find((f) => f.total === '-1210.00');
  igual([f1.tipo_comprobante_codigo, f1.tipo_documento_codigo, f1.punto_venta, /^\d{8}$/.test(f1.numero), f1.moneda, f1.cant_alicuotas, f1.neto_gravado, f1.iva_total], [1, 80, '0001', true, 'PES', 1, '2000.00', '420.00'], 'una factura A');
  igual([nc.tipo_comprobante_codigo, nc.neto_gravado, nc.iva_total], [3, '-1000.00', '-210.00'], 'la nota de crédito A (código 3), en negativo');
  igual([p.totales.total, p.totales.neto_gravado, p.totales.iva_total], [libroV.totales.total, libroV.totales.neto_gravado, libroV.totales.iva_total], 'los mismos totales que el libro'); verdad(p.avisos.some((a) => /no es el archivo de importación oficial/.test(a)), 'avisa que no es el formato oficial');
  igual((await inf('admin', 'iva-ventas-detalle', hoyRango, { empresa: MT })).cuerpo.filas.length, 0, 'otra empresa');
});
await prueba('Planilla de IVA (alícuotas): una fila por comprobante y alícuota, con su código de ARCA, y suma lo mismo que el libro', async () => {
  const a = (await inf('admin', 'iva-ventas-alicuotas', hoyRango)).cuerpo, libroV = (await inf('admin', 'libro-iva-ventas', hoyRango)).cuerpo;
  igual(a.filas.map((f) => [f.alicuota_codigo, f.alicuota]).every(([c, n]) => c === 5 && n === '21 %'), true, 'todo al 21 %'); igual(a.filas.length, 3, 'tres filas'); igual(a.filas.find((f) => f.iva === '-210.00').neto_gravado, '-1000.00', 'la nota resta');
  igual([a.totales.neto_gravado, a.totales.iva], [libroV.totales.neto_gravado, libroV.totales.iva_21], 'coincide con el libro');
  const c = (await inf('admin', 'iva-compras-alicuotas', hoyRango)).cuerpo, libroC = (await inf('admin', 'libro-iva-compras', hoyRango)).cuerpo; igual([c.filas.length, c.totales.iva], [2, libroC.totales.iva_21], 'compras: dos facturas al 21 %'); verdad(c.avisos.length === 2, 'con su aviso sobre los comprobantes sin IVA');
  const d = (await inf('admin', 'iva-compras-detalle', hoyRango)).cuerpo, fp = d.filas.find((f) => f.total === '1260.00'); igual([d.filas.length, fp.percepcion_iibb, fp.tipo_comprobante_codigo, fp.punto_venta, fp.numero], [2, '50.00', 1, '0004', '00002000'], 'la compra con su percepción de IIBB y el número del proveedor');
  igual(d.totales.percepcion_iibb, '50.00', 'total de percepciones');
});
await prueba('Percepciones: las sufridas salen de las compras, con jurisdicción, proveedor y comprobante; filtros y resumen', async () => {
  const r = (await inf('admin', 'percepciones', hoyRango)).cuerpo, f = r.filas[0];
  igual(r.filas.length, 1, 'una'); igual([f.origen, f.impuesto, f.importe, f.tipo_documento_codigo, f.comprobante, f.razon_social], ['sufrida', 'Ingresos Brutos', '50.00', 80, 'Factura A 0004-00002000', 'Molinos del Sur SA'], JSON.stringify(f)); verdad(f.jurisdiccion, 'con su jurisdicción');
  igual(r.resumen.map((x) => [x.origen, x.impuesto, x.cantidad, x.importe]), [['sufrida', 'Ingresos Brutos', 1, '50.00']], 'resumen'); igual(r.totales.importe, '50.00', 'total');
  igual((await inf('admin', 'percepciones', `${hoyRango}&origen=practicada`)).cuerpo.filas.length, 0, 'ninguna practicada'); igual((await inf('admin', 'percepciones', `${hoyRango}&impuesto=iva`)).cuerpo.filas.length, 0, 'ninguna de IVA'); igual((await inf('admin', 'percepciones', `${hoyRango}&impuesto=iibb&origen=sufrida`)).cuerpo.filas.length, 1, 'filtro que coincide');
  igual((await inf('admin', 'percepciones', `${hoyRango}&origen=x`)).cuerpo.error.campos.origen, 'tiene que ser sufrida o practicada', 'origen inválido'); igual((await inf('admin', 'percepciones', `${hoyRango}&impuesto=x`)).cuerpo.error.campos.impuesto, 'tiene que ser iva, iibb, ganancias o suss', 'impuesto inválido');
  igual((await inf('admin', 'percepciones', hoyRango, { empresa: MT })).cuerpo.filas.length, 0, 'otra empresa');
  const ret = (await inf('admin', 'retenciones', hoyRango)).cuerpo.filas[0]; igual([ret.tipo_documento_codigo, 'regimen' in ret], [80, true], 'las retenciones ahora traen el tipo de documento y el régimen (vacío si el pago no lo indicó)');
});
await prueba('Las planillas se descargan a CSV con sus encabezados, el total, y queda constancia', async () => {
  const d = await csv('iva-compras-detalle', hoyRango); igual(d.estado, 200, d.texto.slice(0, 120)); verdad(d.bom && d.texto.startsWith('Fecha,Tipo (código ARCA),Tipo,Punto de venta,Número,Tipo doc. (código ARCA),Documento,Razón social,Moneda,Cotización,Total'), d.texto.slice(0, 160));
  const filas = d.texto.trim().split('\r\n'); igual(filas.length, 1 + 2 + 1, 'encabezado, dos facturas y totales'); verdad(filas.at(-1).startsWith('Totales,'), 'con su fila de totales');
  const p = await csv('percepciones', hoyRango); verdad(p.texto.startsWith('Fecha,Origen,Impuesto,Jurisdicción,Persona,Tipo doc. (código ARCA),Documento,Comprobante,Base imponible,Alícuota,Importe') && /Ingresos Brutos/.test(p.texto), p.texto.slice(0, 200));
  igual((await ultimoEvento('Exportó el informe Percepciones%')).accion, 'Exportó el informe Percepciones a CSV', 'rastro'); igual((await csv('iva-ventas-alicuotas', 'desde=malo')).estado, 422, 'fechas inválidas');
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
