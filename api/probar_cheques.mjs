// Pruebas de cheques: se reciben en un cobro (cartera de terceros) o se emiten en un pago (propios); se depositan, acreditan, rechazan, endosan y debitan,
// con su asiento, el movimiento del banco y su historial; al anular un cobro o un pago el cheque vuelve atrás solo si todavía no siguió su camino.
// Se cruzan los saldos contables (valores a depositar, cheques a pagar) contra la cartera. Con --pg pasan por el adaptador de producción.
// Uso:  node api/probar_cheques.mjs [--pg]
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

// --- más datos: una segunda compra, un banco, y atajos
const FC2 = (await api('admin', 'POST', '/api/compras/facturas', { cuerpo: { tercero_id: P1.id, letra: 'A', punto_venta: 4, numero: 1235, fecha: hoy, total: '1210', items: [{ descripcion: 'Otros servicios', cantidad: '1', precio_unitario: '1000', alicuota: '21' }] } })).cuerpo;
const BANCO = (await api('admin', 'POST', '/api/tesoreria/bancos', { cuerpo: { banco: 'Banco Nación', numero_cuenta: '1234/5' } })).cuerpo;
if (!FC2?.id || !BANCO?.id) throw new Error(`datos de partida: ${JSON.stringify({ FC2, BANCO }).slice(0, 300)}`);
const dias = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const cheque = (numero, extra = {}) => ({ numero, banco: 'Banco Galicia', ...extra });
const cobroCheque = (tercero, comp, importe, ch, o = {}) => cobrar({ tercero_id: tercero, imputaciones: [{ comprobante_id: comp, importe }], medios: [{ medio: 'cheque', importe, cheque: ch }] }, o);
const pasar = (quien, id, accion, cuerpo = {}) => api(quien, 'POST', `/api/cheques/${id}/${accion}`, { cuerpo });
const verCheque = async (id) => (await api('admin', 'GET', `/api/cheques/${id}`)).cuerpo;
const asientoDe = async (origen, id) => (await uno(`select id from asiento where origen_tipo = $1 and origen_id = $2 order by id desc limit 1`, [origen, id]))?.id;
const lin = async (asientoId) => (await q(`select c.codigo, l.debe::text d, l.haber::text h from asiento_linea l join plan_cuenta c on c.id = l.cuenta_id where l.asiento_id = $1 order by c.codigo, l.id`, [asientoId])).map((l) => `${l.codigo} ${Number(l.d) > 0 ? 'D' : 'H'} ${Math.round(Number(l.d) + Number(l.h))}`);
const balance = async (codigo) => (await api('admin', 'GET', `/api/informes/balance?desde=${hoy.slice(0, 4)}-01-01&hasta=${hoy}`)).cuerpo.filas.find((f) => f.codigo === codigo);
const campo = (r, k) => r.cuerpo?.error?.campos?.[k];

// ---------------------------------------------------------------------------
await prueba('Permisos: cheques.gestionar lo tienen el administrador y el contador; todos los roles miran la cartera', async () => {
  const roles = (await api('admin', 'GET', '/api/estudio/roles')).cuerpo.datos, de = (n) => roles.find((r) => r.nombre === n).permisos.includes('cheques.gestionar');
  igual(['Administrador', 'Contador', 'Auxiliar', 'Consulta'].map(de), [true, true, false, false], 'quién gestiona');
  igual((await api('consulta', 'GET', '/api/cheques')).estado, 200, 'la consulta mira'); igual((await api('auxiliar', 'GET', '/api/cheques')).estado, 200, 'el auxiliar mira');
  for (const a of ['depositar', 'acreditar', 'rechazar', 'debitar']) igual((await pasar('auxiliar', 1, a)).estado, 403, `el auxiliar no puede ${a}`); igual((await pasar('consulta', 1, 'depositar')).estado, 403, 'la consulta tampoco');
  igual((await pasar('admin', 1, 'volar')).estado, 404, 'acción inexistente');
});
await prueba('Cobro con un cheque: queda en cartera, la factura se salda, la caja no se mueve y el asiento va a Valores a depositar', async () => {
  igual(await saldoCli(C1.id), '3630.00', 'antes');
  const r = await cobroCheque(C1.id, F1.id, '2420', cheque('00012345', { cuit_librador: cuitConDigito('3070811222'), fecha_emision: hoy, fecha_pago: hoy })); igual(r.estado, 201, JSON.stringify(r.cuerpo));
  ids.cobroCh1 = r.cuerpo.id; igual(r.cuerpo.medios.map((m) => [m.medio, m.importe, m.destino]), [['cheque', '2420.00', 'Cheque 00012345 · Banco Galicia']], 'el medio muestra el cheque');
  igual([await saldoComp(F1.id), await saldoCli(C1.id), Number(await saldoCaja(CAJA.id))], ['0.00', '1210.00', 0], 'factura saldada, caja sin tocar');
  ids.ch1 = r.cuerpo.medios[0].cheque_id; const ch = await verCheque(ids.ch1);
  igual([ch.estado, ch.origen, ch.importe, ch.tercero, ch.banco, ch.acciones, ch.diferido], ['en_cartera', 'tercero', '2420.00', 'Distribuidora Sur SRL', 'Banco Galicia', ['depositar'], false], 'el cheque');
  igual(ch.eventos.map((e) => [e.estado_anterior, e.estado_nuevo, e.nota]), [[null, 'en_cartera', `Recibido en ${r.cuerpo.etiqueta}`]], 'historial');
  igual(await lin(r.cuerpo.asiento.id), ['1.1.2 D 2420', '1.1.3 H 2420'], 'asiento: valores a depositar / deudores');
});
await prueba('Validaciones de un cheque recibido: datos, banco, duplicado, CUIT, fechas y combinaciones raras (sin escribir nada)', async () => {
  const calc = (medio) => api('admin', 'POST', '/api/cobros/calcular', { cuerpo: { tercero_id: C1.id, imputaciones: [], medios: [medio] } });
  igual(campo(await calc({ medio: 'cheque', importe: '100' }), 'medios[0].cheque'), 'ingresá los datos del cheque', 'sin datos');
  igual(campo(await calc({ medio: 'cheque', importe: '100', cheque: { numero: '9' } }), 'medios[0].cheque.banco'), 'es obligatorio', 'sin banco');
  igual(campo(await calc({ medio: 'cheque', cheque: cheque('9') }), 'medios[0].importe'), 'es obligatorio', 'sin importe');
  igual(campo(await calc({ medio: 'cheque', importe: '100', cheque: cheque('00012345') }), 'medios[0].cheque.numero'), 'ya hay un cheque de ese banco con ese número', 'duplicado');
  igual(campo(await calc({ medio: 'cheque', importe: '100', cheque: cheque('00012345', { banco: 'BANCO GALICIA' }) }), 'medios[0].cheque.numero'), 'ya hay un cheque de ese banco con ese número', 'duplicado sin mirar mayúsculas');
  igual((await calc({ medio: 'cheque', importe: '100', cheque: cheque('00012345', { banco: 'Banco Macro' }) })).estado, 200, 'mismo número de otro banco: va');
  igual(campo(await calc({ medio: 'cheque', importe: '100', cheque: cheque('9', { cuit_librador: '30111111111' }) }), 'medios[0].cheque.cuit_librador'), 'el CUIT no es válido', 'CUIT');
  igual(campo(await calc({ medio: 'cheque', importe: '100', cheque: cheque('9', { fecha_emision: hoy, fecha_pago: dias(-3) }) }), 'medios[0].cheque.fecha_pago'), 'no puede ser anterior a la fecha de emisión', 'pago antes de emisión');
  igual(campo(await calc({ medio: 'cheque', importe: '100', cheque: cheque('9', { fecha_emision: dias(2) }) }), 'medios[0].cheque.fecha_emision'), 'la fecha de emisión no puede ser futura', 'emisión futura');
  igual(campo(await calc({ medio: 'cheque', importe: '100', cheque_id: ids.ch1 }), 'medios[0].cheque_id'), 'en un cobro se recibe un cheque nuevo: ingresá sus datos', 'cheque_id en un cobro');
  igual(campo(await calc({ medio: 'cheque', importe: '100', cheque_id: ids.ch1, cheque: cheque('9') }), 'medios[0].cheque'), 'indicá un cheque de la cartera o los datos de uno nuevo, no los dos', 'los dos');
  igual(campo(await calc({ medio: 'cheque', importe: '100', cheque: cheque('9'), cuenta_bancaria_id: BANCO.id }), 'medios[0].cuenta_bancaria_id'), 'el cheque de un tercero no va a una cuenta: se elige al depositarlo', 'con cuenta');
  igual(campo(await calc({ medio: 'cheque', importe: '100', cheque: cheque('9'), caja_id: CAJA.id }), 'medios[0].caja_id'), 'un cheque no va a una caja', 'con caja');
  const dos = await api('admin', 'POST', '/api/cobros/calcular', { cuerpo: { tercero_id: C1.id, medios: [{ medio: 'cheque', importe: '1', cheque: cheque('77') }, { medio: 'cheque', importe: '2', cheque: cheque('77') }] } }); igual(campo(dos, 'medios[1].cheque.numero'), 'ya hay un cheque de ese banco con ese número', 'el mismo dos veces en un cobro');
  igual((await calc({ medio: 'cheque', importe: '100', cheque: cheque('9', { fecha_pago: dias(-60) }) })).cuerpo.avisos.some((a) => /más de 30 días/.test(a)), true, 'aviso de cheque vencido');
  igual((await uno('select count(*)::int n from cheque')).n, 1, 'calcular no escribe');
});
await prueba('Depositar: pide la cuenta, respeta el diferimiento y deja el cheque depositado (sin mover todavía el banco)', async () => {
  const dif = await cobroCheque(C1.id, F2.id, '1210', cheque('00099001', { fecha_emision: hoy, fecha_pago: dias(10) })); igual(dif.estado, 201, JSON.stringify(dif.cuerpo)); ids.ch2 = dif.cuerpo.medios[0].cheque_id; ids.cobroCh2 = dif.cuerpo.id;
  igual((await verCheque(ids.ch2)).diferido, true, 'es diferido');
  const d0 = await pasar('admin', ids.ch2, 'depositar', { cuenta_bancaria_id: BANCO.id }); igual([d0.estado, d0.cuerpo.error.mensaje.startsWith('Es un cheque diferido: se puede depositar desde el')], [422, true], JSON.stringify(d0.cuerpo));
  igual(campo(await pasar('admin', ids.ch1, 'depositar'), 'cuenta_bancaria_id'), 'elegí la cuenta bancaria donde se deposita', 'sin cuenta');
  igual((await pasar('admin', ids.ch1, 'depositar', { cuenta_bancaria_id: 99999 })).cuerpo.error.mensaje, 'Elegí la cuenta bancaria donde se deposita', 'cuenta inexistente');
  igual((await pasar('admin', ids.ch1, 'depositar', { cuenta_bancaria_id: BANCO.id, fecha: dias(1) })).cuerpo.error.mensaje, 'La fecha no puede ser futura', 'fecha futura');
  const ok = await pasar('admin', ids.ch1, 'depositar', { cuenta_bancaria_id: BANCO.id }); igual(ok.estado, 200, JSON.stringify(ok.cuerpo));
  igual([ok.cuerpo.estado, ok.cuerpo.cuenta_bancaria_id, ok.cuerpo.acciones], ['depositado', BANCO.id, ['acreditar', 'rechazar']], 'depositado'); igual(await saldoBanco(BANCO.id), '0', 'el banco todavía no recibió nada');
  igual((await pasar('admin', ids.ch1, 'depositar', { cuenta_bancaria_id: BANCO.id })).estado, 422, 'no se deposita dos veces');
  igual((await uno(`select count(*)::int n from evento where accion = 'Depositó el cheque 00012345'`)).n, 1, 'rastro en la trazabilidad');
});
await prueba('Acreditar: el banco recibe la plata, el asiento pasa de Valores a depositar al Banco, y el cobro ya no se puede anular', async () => {
  igual((await pasar('admin', ids.ch1, 'acreditar', { fecha: dias(-5) })).cuerpo.error.mensaje.startsWith('La fecha no puede ser anterior a la del último movimiento'), true, 'no antes del depósito');
  const a = await pasar('admin', ids.ch1, 'acreditar'); igual([a.estado, a.cuerpo.estado, a.cuerpo.acciones], [200, 'acreditado', []], JSON.stringify(a.cuerpo));
  igual(Number(await saldoBanco(BANCO.id)), 2420, 'el banco recibió 2420');
  igual(await lin(await asientoDe('cheque', ids.ch1)), ['1.1.2 H 2420', '1.1.4 D 2420'], 'asiento: banco / valores a depositar');
  igual((await api('admin', 'GET', '/api/tesoreria/movimientos?cuenta_bancaria_id=' + BANCO.id)).cuerpo.datos.map((m) => [m.importe, m.concepto]), [['2420.00', 'Cheque 00012345 acreditado']], 'movimiento del banco');
  igual((await pasar('admin', ids.ch1, 'acreditar')).estado, 422, 'no dos veces'); igual((await pasar('admin', ids.ch1, 'rechazar', { motivo: 'sin fondos' })).estado, 422, 'uno acreditado no rebota');
  const an = await anularCobro(ids.cobroCh1); igual([an.estado, /ya está acreditado/.test(an.cuerpo.error.mensaje)], [422, true], JSON.stringify(an.cuerpo));
  igual((await verCheque(ids.ch1)).eventos.map((e) => e.estado_nuevo), ['en_cartera', 'depositado', 'acreditado'], 'historial completo');
});
await prueba('Rechazar: el cheque rebota, la deuda vuelve al cliente (saldo, cuenta corriente y asiento) y queda marcado', async () => {
  const c3 = await cobroCheque(C2.id, F3.id, '1210', cheque('00055555', { fecha_pago: hoy })); igual(c3.estado, 201, JSON.stringify(c3.cuerpo)); ids.ch3 = c3.cuerpo.medios[0].cheque_id; ids.cobroCh3 = c3.cuerpo.id;
  igual((await pasar('admin', ids.ch3, 'rechazar', { motivo: 'Sin fondos' })).estado, 422, 'no se rechaza uno que no se depositó');
  await pasar('admin', ids.ch3, 'depositar', { cuenta_bancaria_id: BANCO.id });
  igual(campo(await pasar('admin', ids.ch3, 'rechazar'), 'motivo'), 'indicá el motivo del rechazo', 'pide el motivo'); igual(campo(await pasar('admin', ids.ch3, 'rechazar', { motivo: 'x' }), 'motivo'), 'tiene que tener al menos 3 caracteres', 'motivo corto');
  igual(await saldoCli(C2.id), '0.00', 'antes del rechazo');
  const r = await pasar('admin', ids.ch3, 'rechazar', { motivo: 'Sin fondos' }); igual([r.estado, r.cuerpo.estado, r.cuerpo.acciones], [200, 'rechazado', []], JSON.stringify(r.cuerpo));
  igual(await saldoCli(C2.id), '1210.00', 'el cliente vuelve a deber'); igual(await lin(await asientoDe('cheque', ids.ch3)), ['1.1.2 H 1210', '1.1.3 D 1210'], 'asiento: deudores / valores a depositar');
  const cc = (await api('admin', 'GET', `/api/clientes/${C2.id}/cuenta-corriente`)).cuerpo; igual([cc.saldo, cc.movimientos.at(-1).detalle, cc.movimientos.at(-1).importe], ['1210.00', 'Cheque 00055555 (Banco Galicia) rechazado', '1210.00'], 'cuenta corriente');
  igual((await verCheque(ids.ch3)).eventos.at(-1).nota, 'Sin fondos', 'el motivo queda en el historial'); igual(Number(await saldoBanco(BANCO.id)), 2420, 'el banco no recibió nada de este');
  const an = await anularCobro(ids.cobroCh3); igual([an.estado, /ya está rechazado/.test(an.cuerpo.error.mensaje)], [422, true], 'el cobro de un cheque rechazado no se anula');
  // una persona que paga a cuenta lo cancela
  const pago = await cobrar({ tercero_id: C2.id, medios: [{ medio: 'efectivo', caja_id: CAJA.id, importe: '1210' }] }); igual(pago.estado, 201, JSON.stringify(pago.cuerpo)); igual(await saldoCli(C2.id), '0.00', 'cancelado con un cobro a cuenta');
});
await prueba('Endosar: un cheque de la cartera paga a un proveedor (sale de la cartera y del asiento); al anular el pago vuelve', async () => {
  const bad = (m) => api('admin', 'POST', '/api/pagos/calcular', { cuerpo: { tercero_id: P1.id, imputaciones: [{ comprobante_id: FC1.id, importe: '1210' }], medios: [m] } });
  igual(campo(await bad({ medio: 'cheque', cheque_id: 999999 }), 'medios[0].cheque_id'), 'el cheque no existe', 'inexistente');
  igual(/no está en la cartera \(está acreditado\)/.test(campo(await bad({ medio: 'cheque', cheque_id: ids.ch1 }), 'medios[0].cheque_id')), true, 'uno acreditado no se entrega');
  igual(campo(await bad({ medio: 'cheque', cheque_id: ids.ch2, importe: '1000' }), 'medios[0].importe'), 'el cheque es de $ 1210.00: se entrega entero', 'se entrega entero');
  igual(campo(await bad({ medio: 'cheque' }), 'medios[0].cheque'), 'elegí un cheque de la cartera o ingresá los datos de uno propio', 'sin cheque');
  const dosVeces = await api('admin', 'POST', '/api/pagos/calcular', { cuerpo: { tercero_id: P1.id, medios: [{ medio: 'cheque', cheque_id: ids.ch2 }, { medio: 'cheque', cheque_id: ids.ch2 }] } }); igual(campo(dosVeces, 'medios[1].cheque_id'), 'ese cheque está repetido', 'repetido');
  const p = await pagar({ tercero_id: P1.id, imputaciones: [{ comprobante_id: FC1.id, importe: '1210' }], medios: [{ medio: 'cheque', cheque_id: ids.ch2 }] }); igual(p.estado, 201, JSON.stringify(p.cuerpo)); ids.pagoEndoso = p.cuerpo.id;
  igual([p.cuerpo.medios[0].importe, p.cuerpo.medios[0].destino, await saldoComp(FC1.id)], ['1210.00', 'Cheque 00099001 · Banco Galicia', '605.00'], 'el pago toma el importe del cheque');
  const ch = await verCheque(ids.ch2); igual([ch.estado, ch.acciones, ch.eventos.at(-1).nota.startsWith('Entregado en Orden de pago')], ['entregado', [], true], 'entregado');
  igual(await lin(p.cuerpo.asiento.id), ['1.1.2 H 1210', '2.1.1 D 1210'], 'asiento: proveedores / valores a depositar'); igual(Number(await saldoCaja(CAJA.id)), 1210, 'la caja (solo lo del cobro a cuenta) no se tocó');
  igual((await pasar('admin', ids.ch2, 'depositar', { cuenta_bancaria_id: BANCO.id, fecha: hoy })).estado, 422, 'uno entregado no se deposita');
  const an = await anularPago(ids.pagoEndoso); igual(an.estado, 200, JSON.stringify(an.cuerpo));
  const v = await verCheque(ids.ch2); igual([v.estado, v.acciones, v.eventos.at(-1).nota.startsWith('Vuelve a la cartera')], ['en_cartera', ['depositar'], true], 'vuelve a la cartera'); igual(await saldoComp(FC1.id), '1815.00', 'la compra vuelve a deberse');
});
await prueba('Cheque propio: se emite en un pago (Cheques a pagar), el banco lo debita después y el asiento pasa al Banco', async () => {
  const bad = (m) => api('admin', 'POST', '/api/pagos/calcular', { cuerpo: { tercero_id: P1.id, imputaciones: [{ comprobante_id: FC1.id, importe: '1815' }], medios: [m] } });
  igual(campo(await bad({ medio: 'cheque', importe: '1815', cheque: { numero: '5001' } }), 'medios[0].cuenta_bancaria_id'), 'elegí la cuenta bancaria del cheque', 'sin cuenta');
  igual(campo(await bad({ medio: 'cheque', importe: '1815', cuenta_bancaria_id: 9999, cheque: { numero: '5001' } }), 'medios[0].cuenta_bancaria_id'), 'la cuenta bancaria no existe', 'cuenta inexistente');
  const p = await pagar({ tercero_id: P1.id, imputaciones: [{ comprobante_id: FC1.id, importe: '1815' }], medios: [{ medio: 'cheque', importe: '1815', cuenta_bancaria_id: BANCO.id, cheque: { numero: '5001', fecha_pago: hoy } }] }); igual(p.estado, 201, JSON.stringify(p.cuerpo));
  ids.pagoProp = p.cuerpo.id; ids.chP = p.cuerpo.medios[0].cheque_id; igual(p.cuerpo.medios[0].destino, 'Cheque propio 5001 · Banco Nación', 'destino');
  const ch = await verCheque(ids.chP); igual([ch.origen, ch.estado, ch.cuenta_banco, ch.acciones, ch.eventos[0].nota.startsWith('Emitido en Orden de pago')], ['propio', 'emitido', 'Banco Nación', ['debitar'], true], 'emitido');
  igual(await lin(p.cuerpo.asiento.id), ['2.1.1 D 1815', '2.1.7 H 1815'], 'asiento: proveedores / cheques a pagar'); igual(Number(await saldoBanco(BANCO.id)), 2420, 'el banco todavía no se movió');
  igual(campo(await bad({ medio: 'cheque', importe: '1815', cuenta_bancaria_id: BANCO.id, cheque: { numero: '5001' } }), 'medios[0].cheque.numero'), 'ya emitiste un cheque con ese número de esa cuenta', 'número repetido');
  igual((await pasar('admin', ids.chP, 'acreditar')).estado, 422, 'uno propio no se acredita'); igual((await pasar('admin', ids.chP, 'depositar', { cuenta_bancaria_id: BANCO.id })).estado, 422, 'ni se deposita');
  const d = await pasar('admin', ids.chP, 'debitar'); igual([d.estado, d.cuerpo.estado], [200, 'cobrado'], JSON.stringify(d.cuerpo));
  igual(Number(await saldoBanco(BANCO.id)), 605, 'el banco pagó 1815'); igual(await lin(await asientoDe('cheque', ids.chP)), ['1.1.4 H 1815', '2.1.7 D 1815'], 'asiento: cheques a pagar / banco');
  const an = await anularPago(ids.pagoProp); igual([an.estado, /el banco lo debitó/.test(an.cuerpo.error.mensaje)], [422, true], 'no se anula un pago con un cheque debitado');
});
await prueba('Cheque propio diferido: el banco no lo debita antes de su fecha; si se anula el pago, el cheque se anula y su número queda libre', async () => {
  const p = await pagar({ tercero_id: P1.id, imputaciones: [{ comprobante_id: FC2.id, importe: '1210' }], medios: [{ medio: 'cheque', importe: '1210', cuenta_bancaria_id: BANCO.id, cheque: { numero: '5002', fecha_emision: hoy, fecha_pago: dias(5) } }] }); igual(p.estado, 201, JSON.stringify(p.cuerpo));
  const id = p.cuerpo.medios[0].cheque_id; const d = await pasar('admin', id, 'debitar'); igual([d.estado, d.cuerpo.error.mensaje.startsWith('El cheque es de pago diferido: el banco lo puede debitar desde el')], [422, true], JSON.stringify(d.cuerpo));
  const an = await anularPago(p.cuerpo.id); igual(an.estado, 200, JSON.stringify(an.cuerpo)); const v = await verCheque(id); igual([v.estado, v.eventos.at(-1).nota.startsWith('Anulación de Orden de pago')], ['anulado', true], 'anulado');
  const otra = await pagar({ tercero_id: P1.id, imputaciones: [{ comprobante_id: FC2.id, importe: '1210' }], medios: [{ medio: 'cheque', importe: '1210', cuenta_bancaria_id: BANCO.id, cheque: { numero: '5002' } }] }); igual(otra.estado, 201, 'el número quedó libre: ' + JSON.stringify(otra.cuerpo));
  await anularPago(otra.cuerpo.id);
});
await prueba('Anular un cobro con un cheque que sigue en cartera lo anula y libera el banco y el número', async () => {
  const F4 = await vender(C2.id, '1'); ids.F4 = F4.id;
  const c4 = await cobroCheque(C2.id, F4.id, '1210', cheque('00077777')); igual(c4.estado, 201, JSON.stringify(c4.cuerpo)); const id = c4.cuerpo.medios[0].cheque_id;
  const an = await anularCobro(c4.cuerpo.id); igual(an.estado, 200, JSON.stringify(an.cuerpo)); const v = await verCheque(id); igual([v.estado, v.acciones, v.eventos.at(-1).estado_nuevo], ['anulado', [], 'anulado'], 'anulado');
  const otra = await cobroCheque(C2.id, F4.id, '1210', cheque('00077777')); igual(otra.estado, 201, 'se puede volver a ingresar'); ids.ch4 = otra.cuerpo.medios[0].cheque_id; ids.cobroCh4 = otra.cuerpo.id;
});
await prueba('Reglas de la base: no se saltean estados, las fechas no son futuras y los cheques no se repiten', async () => {
  const falla = async (sql, p, patron, que) => { let msg = ''; try { await q(sql, p); } catch (e) { msg = e.message; } if (!patron.test(msg)) throw new Error(`${que}: esperaba ${patron}, obtuve "${msg}"`); };
  await falla("select fn_cheque_pasar($1, 'acreditar', current_date)", [ids.ch4], /Solo se acredita un cheque depositado/, 'acreditar sin depositar');
  await falla("select fn_cheque_pasar($1, 'debitar', current_date)", [ids.ch4], /Solo se debita un cheque propio emitido/, 'debitar uno de un tercero');
  await falla("select fn_cheque_pasar($1, 'depositar', current_date + 1, $2)", [ids.ch4, BANCO.id], /fecha no puede ser futura/, 'fecha futura');
  await falla("select fn_cheque_pasar($1, 'transformar', current_date)", [ids.ch4], /Acción desconocida/, 'acción desconocida');
  await falla("select fn_cheque_pasar(999999, 'depositar', current_date, $1)", [BANCO.id], /El cheque no existe/, 'cheque inexistente');
  await falla("insert into cheque (empresa_id, origen, numero, banco, importe, estado) values ($1, 'tercero', '00012345', 'banco galicia', 10, 'en_cartera')", [RI], /duplicate key|cheque_tercero_unico/, 'duplicado de tercero');
  await falla("insert into cheque (empresa_id, origen, numero, importe, cuenta_bancaria_id, estado) values ($1, 'propio', '5001', 10, $2, 'emitido')", [RI, BANCO.id], /duplicate key|cheque_propio_unico/, 'duplicado propio');
  await falla("update cheque set estado = 'cobrado' where id = $1", [ids.ch4], /check constraint/, 'un cheque de tercero no está cobrado');
  igual((await pasar('admin', ids.ch4, 'depositar', { cuenta_bancaria_id: BANCO.id, fecha: hoy })).estado, 200, 'sigue andando');
});
await prueba('Cartera: listado con filtros y resumen, detalle con historial, otra empresa no ve nada', async () => {
  const todos = (await api('admin', 'GET', '/api/cheques?limite=100')).cuerpo; verdad(todos.total >= 6, `total ${todos.total}`);
  const en = (await api('admin', 'GET', '/api/cheques?estado=en_cartera')).cuerpo; igual(en.datos.map((c) => c.numero), ['00099001'], 'en cartera'); igual(en.datos[0].diferido, true, 'diferido');
  igual((await api('admin', 'GET', '/api/cheques?origen=propio')).cuerpo.datos.every((c) => c.origen === 'propio'), true, 'propios');
  igual((await api('admin', 'GET', '/api/cheques?q=galicia&estado=acreditado')).cuerpo.datos.map((c) => c.numero), ['00012345'], 'búsqueda por banco');
  igual((await api('admin', 'GET', '/api/cheques?q=Distribuidora')).cuerpo.datos.every((c) => c.tercero === 'Distribuidora Sur SRL'), true, 'búsqueda por persona'); igual((await api('admin', 'GET', `/api/cheques?tercero_id=${C2.id}`)).cuerpo.datos.length >= 2, true, 'por persona');
  igual((await api('admin', 'GET', `/api/cheques?desde=${dias(8)}&hasta=${dias(12)}`)).cuerpo.datos.map((c) => c.numero), ['00099001'], 'por fecha de cobro'); igual((await api('admin', 'GET', '/api/cheques?limite=2&desplazamiento=1')).cuerpo.datos.length, 2, 'paginado');
  const res = en.resumen.find((r) => r.origen === 'tercero' && r.estado === 'en_cartera'); igual([res.cantidad, res.importe], [1, '1210.00'], 'resumen'); igual(campo(await api('admin', 'GET', '/api/cheques?estado=raro'), 'estado').startsWith('tiene que ser uno de'), true, 'estado inválido');
  const d = (await api('admin', 'GET', `/api/cheques/${ids.ch3}`)).cuerpo; igual(d.eventos.map((e) => e.estado_nuevo), ['en_cartera', 'depositado', 'rechazado'], 'historial'); igual(d.eventos[0].comprobante.startsWith('Recibo 0001-'), true, 'con su recibo');
  igual([(await api('admin', 'GET', '/api/cheques', { empresa: MT })).cuerpo.total, (await api('admin', 'GET', `/api/cheques/${ids.ch1}`, { empresa: MT })).estado, (await api('admin', 'POST', `/api/cheques/${ids.ch2}/depositar`, { cuerpo: { cuenta_bancaria_id: BANCO.id }, empresa: MT })).estado], [0, 404, 404], 'otra empresa');
});
await prueba('Cruce contable: Valores a depositar = cheques en cartera y depositados; Cheques a pagar = propios emitidos; la cadena de trazabilidad sigue íntegra', async () => {
  const esperado = (await uno(`select coalesce(sum(importe), 0)::text s from cheque where origen = 'tercero' and estado in ('en_cartera', 'depositado')`)).s, valores = await balance('1.1.2');
  igual(Number(valores?.saldo_deudor ?? 0), Number(esperado), 'valores a depositar'); const aPagar = (await uno(`select coalesce(sum(importe), 0)::text s from cheque where origen = 'propio' and estado = 'emitido'`)).s;
  igual(Number((await balance('2.1.7'))?.saldo_acreedor ?? 0), Number(aPagar), 'cheques a pagar');
  const bruto = await api('admin', 'GET', `/api/informes/balance?desde=${hoy.slice(0, 4)}-01-01&hasta=${hoy}`); igual([bruto.cuerpo.totales.debe === bruto.cuerpo.totales.haber, bruto.cuerpo.avisos], [true, []], 'el balance cuadra');
  verdad((await uno(`select count(*)::int n from evento where categoria = 'tesoreria' and entidad_tabla = 'cheque'`)).n >= 6, 'rastro de los pasos del cheque');
  for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena ${e}`);
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
