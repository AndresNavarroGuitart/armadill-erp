// Pruebas de ECHEQ (cheque electrónico, carga manual sin conexión al banco): código único, carácter y cruzado, aceptación previa a depositar o entregar, no a la orden que no se endosa,
// ECHEQ propio, anulación que libera el código y las defensas de la base. Con --pg pasan por el adaptador de producción.
// Uso:  node api/probar_echeq.mjs [--pg]
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

const eche = (codigo, extra = {}) => cheque(`E${codigo}`, { es_echeq: true, echeq_codigo: codigo, ...extra });
const entregar = (chequeId, importe = '100') => pagar({ tercero_id: P1.id, imputaciones: [{ comprobante_id: FC1.id, importe }], medios: [{ medio: 'cheque', importe, cheque_id: chequeId }] });
const chequeDelCobro = async (r) => (await uno('select cheque_id from pago_medio where pago_id = $1', [r.cuerpo.id])).cheque_id;
const msg = async (sql) => { try { await q(sql); return ''; } catch (e) { return e.message; } };

// ---------------------------------------------------------------------------
await prueba('Cobro con un ECHEQ: queda en cartera pendiente de aceptación, con su código, y no se puede depositar ni entregar hasta aceptarlo', async () => {
  const r = await cobroCheque(C1.id, F2.id, '100', eche('ECH-0001')); igual(r.estado, 201, JSON.stringify(r.cuerpo)); verdad(r.cuerpo.avisos.some((a) => /ECHEQ E?ECH-0001 queda pendiente de aceptación/.test(a)), 'avisa: ' + r.cuerpo.avisos);
  ids.e1 = await chequeDelCobro(r); const ch = await verCheque(ids.e1);
  igual([ch.es_echeq, ch.echeq_codigo, ch.caracter, ch.cruzado, ch.aceptado_en, ch.estado, ch.acciones], [true, 'ECH-0001', 'a_la_orden', false, null, 'en_cartera', ['aceptar']], JSON.stringify(ch));
  const dep = await pasar('admin', ids.e1, 'depositar', { cuenta_bancaria_id: BANCO.id }); igual([dep.estado, dep.cuerpo.error.codigo], [422, 'echeq_sin_aceptar'], JSON.stringify(dep.cuerpo));
  const ent = await entregar(ids.e1); igual([ent.estado, campo(ent, 'medios[0].cheque_id')], [422, 'el ECHEQ EECH-0001 todavía no fue aceptado: aceptalo antes de entregarlo'], JSON.stringify(ent.cuerpo));
  verdad(/todavía no fue aceptado: no se puede depositar hasta aceptarlo/.test(await msg(`update cheque set estado = 'depositado' where id = ${ids.e1}`)), 'la base también lo impide al depositar');
  verdad(/todavía no fue aceptado: no se puede entregar hasta aceptarlo/.test(await msg(`update cheque set estado = 'entregado' where id = ${ids.e1}`)), 'y al entregar'); igual((await verCheque(ids.e1)).estado, 'en_cartera', 'sigue en cartera');
});
await prueba('Aceptar el ECHEQ: queda aceptado con su fecha y su rastro; después se deposita y se acredita como cualquier cheque; no se acepta dos veces ni sin permiso', async () => {
  for (const q_ of ['auxiliar', 'consulta']) igual((await pasar(q_, ids.e1, 'aceptar')).estado, 403, `${q_} no acepta`);
  const a = await pasar('admin', ids.e1, 'aceptar'); igual(a.estado, 200, JSON.stringify(a.cuerpo)); igual([a.cuerpo.aceptado_en, a.cuerpo.estado, a.cuerpo.acciones], [hoy, 'en_cartera', ['depositar']], JSON.stringify(a.cuerpo));
  igual(a.cuerpo.eventos.at(-1).nota, 'Aceptó el ECHEQ', 'queda en el historial'); const e = await ultimoEvento('Aceptó el ECHEQ%'); igual([e.categoria, e.detalle.includes('Banco Galicia')], ['tesoreria', true], JSON.stringify(e));
  const otra = await pasar('admin', ids.e1, 'aceptar'); igual([otra.estado, otra.cuerpo.error.codigo], [422, 'ya_aceptado'], JSON.stringify(otra.cuerpo));
  verdad(/no se vuelve a aceptar ni se desacepta/.test(await msg(`update cheque set aceptado_en = null where id = ${ids.e1}`)), 'la base no deja desaceptar');
  const d = await pasar('admin', ids.e1, 'depositar', { cuenta_bancaria_id: BANCO.id }); igual([d.estado, d.cuerpo.estado], [200, 'depositado'], JSON.stringify(d.cuerpo)); igual((await pasar('admin', ids.e1, 'acreditar')).cuerpo.estado, 'acreditado', 'se acredita');
  const comun = await cobroCheque(C1.id, F2.id, '50', cheque('99001')); const cc = await verCheque(await chequeDelCobro(comun)); igual([cc.es_echeq, cc.acciones.includes('aceptar'), cc.acciones.includes('depositar')], [false, false, true], 'un cheque de papel no se acepta');
  igual((await pasar('admin', cc.id, 'aceptar')).cuerpo.error.codigo, 'no_es_echeq', 'aceptar un cheque de papel no tiene sentido');
});
await prueba('ECHEQ ya aceptado al recibirlo: entra listo para usar y se puede entregar a un proveedor; uno "no a la orden" se deposita pero no se endosa', async () => {
  const r = await cobroCheque(C1.id, F2.id, '100', eche('ECH-0002', { aceptado: true })); igual(r.estado, 201, JSON.stringify(r.cuerpo)); verdad(!r.cuerpo.avisos.some((a) => /pendiente de aceptación/.test(a)), 'sin aviso de aceptación');
  const id = await chequeDelCobro(r); const ch = await verCheque(id); igual([ch.aceptado_en, ch.acciones], [hoy, ['depositar']], JSON.stringify(ch));
  const ent = await entregar(id); igual(ent.estado, 201, JSON.stringify(ent.cuerpo)); igual((await verCheque(id)).estado, 'entregado', 'el endoso lo entrega'); ids.e2 = id;
  const n = await cobroCheque(C1.id, F2.id, '100', eche('ECH-0003', { aceptado: true, caracter: 'no_a_la_orden', cruzado: true })); igual(n.estado, 201, JSON.stringify(n.cuerpo)); ids.e3 = await chequeDelCobro(n);
  const c3 = await verCheque(ids.e3); igual([c3.caracter, c3.cruzado], ['no_a_la_orden', true], JSON.stringify(c3));
  const mal = await entregar(ids.e3); igual([mal.estado, campo(mal, 'medios[0].cheque_id')], [422, 'el ECHEQ EECH-0003 es no a la orden: no se endosa a un tercero (se transmite por cesión)'], JSON.stringify(mal.cuerpo));
  verdad(/es no a la orden: no se endosa/.test(await msg(`update cheque set estado = 'entregado' where id = ${ids.e3}`)), 'la base también lo impide');
  igual((await pasar('admin', ids.e3, 'depositar', { cuenta_bancaria_id: BANCO.id })).cuerpo.estado, 'depositado', 'sí se deposita');
});
await prueba('Validaciones: el código es obligatorio y no se repite (ni dentro del pedido ni contra la cartera), y los datos del ECHEQ exigen marcarlo como tal', async () => {
  const sin = await cobroCheque(C1.id, F2.id, '100', cheque('7001', { es_echeq: true })); igual([sin.estado, campo(sin, 'medios[0].cheque.echeq_codigo')], [422, 'es obligatorio: es el código que da el banco'], JSON.stringify(sin.cuerpo));
  const corto = await cobroCheque(C1.id, F2.id, '100', eche('AB')); igual(sin.estado === 422 && corto.estado, 422, 'código muy corto: ' + JSON.stringify(corto.cuerpo));
  const rep = await cobroCheque(C1.id, F2.id, '100', eche('ECH-0001')); igual([rep.estado, campo(rep, 'medios[0].cheque.echeq_codigo')], [422, 'ya hay un ECHEQ con ese código'], JSON.stringify(rep.cuerpo)); igual(campo(rep, 'medios[0].cheque.echeq_codigo') !== undefined, true, 'repetido contra la cartera');
  const doble = await cobrar({ tercero_id: C1.id, imputaciones: [{ comprobante_id: F2.id, importe: '100' }], medios: [{ medio: 'cheque', importe: '50', cheque: eche('ECH-0009') }, { medio: 'cheque', importe: '50', cheque: eche('ECH-0009', { numero: 'otro' }) }] });
  igual([doble.estado, campo(doble, 'medios[1].cheque.echeq_codigo')], [422, 'ya hay un ECHEQ con ese código'], 'repetido dentro del mismo cobro: ' + JSON.stringify(doble.cuerpo));
  const suelto = await cobroCheque(C1.id, F2.id, '100', cheque('7002', { echeq_codigo: 'ECH-X1' })); igual([suelto.estado, campo(suelto, 'medios[0].cheque.es_echeq')], [422, 'marcá que es un ECHEQ para cargar su código, carácter o aceptación'], JSON.stringify(suelto.cuerpo));
  verdad(/los datos del ECHEQ \(código, carácter, cruzado\) no se modifican/.test(await msg(`update cheque set echeq_codigo = 'OTRO-123' where id = ${ids.e1}`)), 'el código no se cambia después');
  const mc = await msg(`update cheque set aceptado_en = current_date where id = (select id from cheque where not es_echeq limit 1)`); verdad(/cheque_echeq_coherente/.test(mc), 'un cheque de papel no puede figurar aceptado: ' + mc);
  verdad(/cheque_echeq_unico/.test(await msg(`insert into cheque (empresa_id, origen, numero, banco, importe, estado, es_echeq, echeq_codigo) values (${RI}, 'tercero', 'Z1', 'Banco X', 10, 'en_cartera', true, 'ecH-0001')`)), 'la base impide el código repetido sin importar mayúsculas');
});
await prueba('ECHEQ propio: se emite en un pago con su código, queda emitido y el banco lo debita; "aceptado" no aplica; el código es único también entre propios y de terceros', async () => {
  const pago = (ch, extra = {}) => pagar({ tercero_id: P1.id, imputaciones: [{ comprobante_id: FC1.id, importe: '100' }], medios: [{ medio: 'cheque', importe: '100', cuenta_bancaria_id: BANCO.id, cheque: ch, ...extra }] });
  const r = await pago({ numero: '0005', es_echeq: true, echeq_codigo: 'ECH-P-01', cruzado: true }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); verdad(!r.cuerpo.avisos.some((a) => /pendiente de aceptación/.test(a)), 'no pide aceptación');
  const id = await chequeDelCobro(r); const ch = await verCheque(id); igual([ch.origen, ch.estado, ch.es_echeq, ch.echeq_codigo, ch.cruzado, ch.aceptado_en, ch.acciones], ['propio', 'emitido', true, 'ECH-P-01', true, null, ['debitar']], JSON.stringify(ch));
  const acep = await pago({ numero: '0006', es_echeq: true, echeq_codigo: 'ECH-P-02', aceptado: true }); igual([acep.estado, campo(acep, 'medios[0].cheque.aceptado')], [422, 'solo un ECHEQ que se recibe se acepta'], JSON.stringify(acep.cuerpo));
  const dup = await pago({ numero: '0007', es_echeq: true, echeq_codigo: 'ech-0001' }); igual([dup.estado, campo(dup, 'medios[0].cheque.echeq_codigo')], [422, 'ya hay un ECHEQ con ese código'], 'el código de un tercero ya está tomado: ' + JSON.stringify(dup.cuerpo));
  const d = await pasar('admin', id, 'debitar'); igual([d.estado, d.cuerpo.estado], [200, 'cobrado'], JSON.stringify(d.cuerpo));
});
await prueba('Anular el cobro libera el código del ECHEQ; el listado filtra y busca por ECHEQ', async () => {
  const r = await cobroCheque(C2.id, F3.id, '100', eche('ECH-0100')); igual(r.estado, 201, JSON.stringify(r.cuerpo)); const id = await chequeDelCobro(r);
  const l = (await api('admin', 'GET', '/api/cheques?echeq=true')).cuerpo; verdad(l.datos.length >= 4 && l.datos.every((x) => x.es_echeq), 'el filtro trae solo ECHEQ: ' + l.datos.length); const sin = (await api('admin', 'GET', '/api/cheques?echeq=false')).cuerpo; verdad(sin.datos.every((x) => !x.es_echeq), 'y el contrario solo papel');
  igual((await api('admin', 'GET', '/api/cheques?q=ECH-0100')).cuerpo.datos.map((x) => x.id), [id], 'se busca por código'); igual((await api('admin', 'GET', '/api/cheques?echeq=quizás')).estado, 422, 'valor inválido');
  igual((await anularCobro(r.cuerpo.id)).estado, 200, 'anula el cobro'); igual((await verCheque(id)).estado, 'anulado', 'el cheque queda anulado');
  const de_nuevo = await cobroCheque(C2.id, F3.id, '100', eche('ECH-0100')); igual(de_nuevo.estado, 201, 'el código vuelve a estar disponible: ' + JSON.stringify(de_nuevo.cuerpo));
});
await prueba('Trazabilidad: la cadena sigue íntegra', async () => {
  for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena ${e}`);
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
