// Pruebas de conciliación bancaria: importar el extracto (borrador, repetido, validaciones), cerrarlo (saldo y continuidad que verifica la base), coincidencias sugeridas, conciliar n a n, deshacer,
// registrar desde la línea del extracto lo que solo está en el banco (comisiones, impuestos, intereses) con su asiento, movimientos sueltos y el estado de la cuenta. Con --pg pasan por el adaptador de producción.
// Uso:  node api/probar_conciliacion.mjs [--pg]
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

const transf = (tercero, comp, importe) => cobrar({ tercero_id: tercero, imputaciones: [{ comprobante_id: comp, importe }], medios: [{ medio: 'transferencia', cuenta_bancaria_id: BANCO.id, importe }] });
const extracto = (cuerpo, o = {}) => api(o.quien ?? 'admin', 'POST', '/api/conciliacion/extractos', { cuerpo: { cuenta_bancaria_id: BANCO.id, ...cuerpo } });
const verExt = async (id) => (await api('admin', 'GET', `/api/conciliacion/extractos/${id}`)).cuerpo;
const estado = async () => (await api('admin', 'GET', '/api/conciliacion/cuentas')).cuerpo.datos.find((x) => x.id === BANCO.id);
const pend = async (dias) => (await api('admin', 'GET', `/api/conciliacion/cuentas/${BANCO.id}/pendientes${dias === undefined ? '' : `?dias=${dias}`}`)).cuerpo;
const mov = (cuerpo, o = {}) => api(o.quien ?? 'admin', 'POST', '/api/conciliacion/movimientos', { cuerpo });
const cuentaContable = async (codigo) => (await uno('select id from plan_cuenta where empresa_id = $1 and codigo = $2', [RI, codigo])).id;
const num = (x) => Number(x);
const linX = async (asientoId) => (await q(`select c.codigo, l.debe::text d, l.haber::text h from asiento_linea l join plan_cuenta c on c.id = l.cuenta_id where l.asiento_id = $1 order by c.codigo, l.id`, [asientoId])).map((l) => `${l.codigo} ${num(l.d) > 0 ? 'D ' + num(l.d) : 'H ' + num(l.h)}`);

// ---------------------------------------------------------------------------
await prueba('Permisos: todos miran la conciliación; importar, conciliar y registrar movimientos lo hacen el administrador y el contador', async () => {
  for (const q_ of ['admin', 'auxiliar', 'consulta']) igual((await api(q_, 'GET', '/api/conciliacion/cuentas')).estado, 200, `${q_} ve las cuentas`);
  for (const q_ of ['auxiliar', 'consulta']) for (const [m, r, c] of [['POST', '/api/conciliacion/extractos', {}], ['POST', '/api/conciliacion/conciliar', {}], ['POST', '/api/conciliacion/sugerencias/aceptar', {}], ['POST', '/api/conciliacion/movimientos', {}], ['POST', '/api/conciliacion/extractos/1/cerrar', {}], ['DELETE', '/api/conciliacion/extractos/1', undefined], ['POST', '/api/conciliacion/1/deshacer', {}]])
    igual((await api(q_, m, r, { cuerpo: c })).estado, 403, `${q_} no puede ${m} ${r}`);
  const de = (n) => (S.roles?.[n] ?? null); const permisos = (await q(`select r.nombre, array_agg(rp.permiso_clave) p from rol r join rol_permiso rp on rp.rol_id = r.id where rp.permiso_clave = 'conciliacion.gestionar' group by r.nombre order by r.nombre`)).map((x) => x.nombre); igual(permisos, ['Administrador', 'Contador'], 'el permiso lo tienen administrador y contador'); void de;
  igual((await api('admin', 'GET', '/api/conciliacion/cuentas', { empresa: MT })).cuerpo.datos.some((x) => x.id === BANCO.id), false, 'otra empresa no ve la cuenta');
});
await prueba('Importar un extracto: queda en borrador con sus líneas ordenadas; avisa si no cierra; no se importa dos veces; valida todo', async () => {
  for (const [m, i] of [[1000, 'a'], [500, 'b'], [250, 'c']]) igual((await transf(m === 250 ? C1.id : C1.id, m === 250 ? F2.id : F1.id, String(m))).estado, 201, `cobro ${i}`);
  const lineas = [{ fecha: dias(-1), descripcion: 'Transferencia recibida SUR SRL', referencia: 'TR-001', importe: '1000' }, { fecha: dias(-2), descripcion: 'Deposito', importe: '250' }, { fecha: dias(-1), descripcion: 'Transferencia recibida', importe: '500' },
    { fecha: dias(-1), descripcion: 'Comisión mantenimiento de cuenta', importe: '-35.50' }, { fecha: dias(-1), descripcion: 'Impuesto ley 25413 débito', importe: '-7.20' }];
  const buenos = { desde: dias(-10), hasta: dias(-1), saldo_inicial: '100', saldo_final: '1807.30', nombre_archivo: 'extracto-octubre.csv', lineas };
  const r = await extracto(buenos); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.E1 = r.cuerpo.id;
  igual([r.cuerpo.estado, r.cuerpo.lineas, r.cuerpo.conciliadas, r.cuerpo.cierra, r.cuerpo.avisos, r.cuerpo.detalle.map((l) => l.orden), r.cuerpo.detalle[0].fecha], ['borrador', 5, 0, true, [], [1, 2, 3, 4, 5], dias(-2)], JSON.stringify(r.cuerpo));
  const rep = await extracto(buenos); igual([rep.estado, rep.cuerpo.error.codigo], [409, 'extracto_repetido'], 'el mismo extracto no se importa dos veces');
  const mal = await extracto({ ...buenos, saldo_final: '1800', nombre_archivo: 'x.csv' }); igual(mal.estado, 201, JSON.stringify(mal.cuerpo)); verdad(mal.cuerpo.avisos.some((a) => /saldo final no es el inicial más las líneas \(diferencia de \$ -7.30\)/.test(a)), 'avisa que no cierra: ' + mal.cuerpo.avisos); igual(mal.cuerpo.cierra, false, 'cierra = falso');
  const cerrar = await api('admin', 'POST', `/api/conciliacion/extractos/${mal.cuerpo.id}/cerrar`, { cuerpo: {} }); igual(cerrar.estado, 422, 'no se cierra uno que no cierra: ' + JSON.stringify(cerrar.cuerpo)); verdad(/saldo final/.test(cerrar.cuerpo.error.mensaje), cerrar.cuerpo.error.mensaje);
  igual((await api('admin', 'DELETE', `/api/conciliacion/extractos/${mal.cuerpo.id}`)).estado, 200, 'el borrador se borra');
  const fuera = await extracto({ ...buenos, nombre_archivo: 'y.csv', lineas: [{ fecha: dias(-30), importe: '5' }] }); igual([fuera.estado, campo(fuera, 'lineas[0].fecha')], [422, `tiene que estar entre ${buenos.desde} y ${buenos.hasta}`], JSON.stringify(fuera.cuerpo));
  igual(campo(await extracto({ ...buenos, nombre_archivo: 'z.csv', lineas: [{ fecha: hoy, importe: '0' }] }), 'lineas[0].importe'), 'no puede ser cero', 'sin importes en cero'); igual((await extracto({ ...buenos, cuenta_bancaria_id: 999999 })).estado, 422, 'cuenta inexistente');
  igual(campo(await extracto({ ...buenos, hasta: dias(5), nombre_archivo: 'w.csv' }), 'hasta'), 'el extracto no puede terminar en el futuro', 'no termina en el futuro'); igual(campo(await extracto({ ...buenos, desde: hoy, hasta: dias(-3), nombre_archivo: 'v.csv' }), 'hasta'), 'no puede ser anterior a "desde"', 'rango');
  igual((await extracto({ ...buenos, lineas: [] })).estado, 422, 'sin líneas'); igual((await extracto({ ...buenos }, { empresa: undefined })).estado, 409, 'repetido otra vez');
});
await prueba('Cerrar el extracto: la base verifica el saldo y que continúe el anterior; uno cerrado no se borra', async () => {
  const c = await api('admin', 'POST', `/api/conciliacion/extractos/${ids.E1}/cerrar`, { cuerpo: {} }); igual([c.estado, c.cuerpo.estado, c.cuerpo.acciones], [200, 'cerrado', { cerrar: false, borrar: false }], JSON.stringify(c.cuerpo));
  igual((await api('admin', 'POST', `/api/conciliacion/extractos/${ids.E1}/cerrar`, { cuerpo: {} })).estado, 422, 'no se cierra dos veces'); igual((await api('admin', 'DELETE', `/api/conciliacion/extractos/${ids.E1}`)).estado, 422, 'cerrado no se borra');
  const sig = await extracto({ desde: dias(-40), hasta: dias(-20), saldo_inicial: '0', saldo_final: '100', nombre_archivo: 'viejo.csv', lineas: [{ fecha: dias(-30), descripcion: 'Saldo anterior sin conciliar', importe: '100' }] }); igual(sig.estado, 201, JSON.stringify(sig.cuerpo));
  const c2 = await api('admin', 'POST', `/api/conciliacion/extractos/${sig.cuerpo.id}/cerrar`, { cuerpo: {} }); igual(c2.estado, 200, 'uno anterior que cierra bien: ' + JSON.stringify(c2.cuerpo));
  const salto = await extracto({ desde: dias(-19), hasta: dias(-12), saldo_inicial: '999', saldo_final: '1000', nombre_archivo: 'salto.csv', lineas: [{ fecha: dias(-15), importe: '1' }] }); igual(salto.estado, 201, JSON.stringify(salto.cuerpo));
  const c3 = await api('admin', 'POST', `/api/conciliacion/extractos/${salto.cuerpo.id}/cerrar`, { cuerpo: {} }); igual(c3.estado, 422, 'el saldo inicial no continúa al anterior'); verdad(/no continúa/.test(c3.cuerpo.error.mensaje) || /saldo/.test(c3.cuerpo.error.mensaje), c3.cuerpo.error.mensaje); await api('admin', 'DELETE', `/api/conciliacion/extractos/${salto.cuerpo.id}`);
  ids.Evieja = sig.cuerpo.id; const l = (await api('admin', 'GET', `/api/conciliacion/extractos?cuenta_bancaria_id=${BANCO.id}`)).cuerpo.datos; igual(l.map((x) => x.estado).sort(), ['cerrado', 'cerrado'], 'el listado');
});
await prueba('Pendientes y estado de la cuenta: coincidencias sugeridas 1 a 1 y la diferencia entre el banco y los libros queda explicada', async () => {
  const p = await pend(); igual([p.lineas.length, p.movimientos.length, p.sugerencias.length], [6, 3, 3], JSON.stringify(p.sugerencias)); verdad(p.movimientos.every((m) => /^Recibo/.test(m.comprobante)), 'los movimientos traen su recibo');
  igual((await pend(1)).sugerencias.length, 2, 'con 1 día de tolerancia el depósito de anteayer no coincide'); igual((await api('admin', 'GET', `/api/conciliacion/cuentas/${BANCO.id}/pendientes?dias=99`)).estado, 422, 'dias fuera de rango'); igual((await api('admin', 'GET', '/api/conciliacion/cuentas/999999/pendientes')).estado, 404, 'cuenta inexistente');
  const e = await estado(); igual([e.saldo_banco, num(e.saldo_libros), e.movimientos_pendientes, e.lineas_pendientes, num(e.no_explicada)], ['1807.30', 1750, 3, 6, 0], JSON.stringify(e)); igual(num(e.diferencia_total), 57.3, 'el banco tiene 57,30 más que los libros (los 100 del saldo anterior sin conciliar, menos 42,70 de gastos)');
});
await prueba('Aceptar las coincidencias sugeridas concilia solo lo seguro; deshacer una conciliación libera las dos puntas', async () => {
  const a = await api('admin', 'POST', '/api/conciliacion/sugerencias/aceptar', { cuerpo: { cuenta_bancaria_id: BANCO.id } }); igual([a.estado, a.cuerpo.conciliaciones], [200, 3], JSON.stringify(a.cuerpo)); ids.concil = a.cuerpo.ids;
  const p = await pend(); igual([p.lineas.map((l) => l.importe).sort(), p.movimientos.length, p.sugerencias.length], [['-35.50', '-7.20', '100.00'].sort(), 0, 0], 'quedan la comisión, el impuesto y el extracto viejo: ' + JSON.stringify(p.lineas));
  igual((await api('admin', 'POST', '/api/conciliacion/sugerencias/aceptar', { cuerpo: { cuenta_bancaria_id: BANCO.id } })).cuerpo.conciliaciones, 0, 'una segunda vez no hay nada que aceptar');
  const h = (await api('admin', 'GET', `/api/conciliacion/cuentas/${BANCO.id}/historial`)).cuerpo.datos; igual(h.length, 3, 'historial'); verdad(h.every((x) => x.lineas === 1 && x.movimientos === 1), 'cada una 1 a 1');
  const d = await api('admin', 'POST', `/api/conciliacion/${ids.concil[0]}/deshacer`, { cuerpo: {} }); igual([d.estado, d.cuerpo.estado], [200, 'deshecha'], JSON.stringify(d.cuerpo)); igual((await pend()).movimientos.length, 1, 'el movimiento vuelve a estar pendiente');
  igual((await api('admin', 'POST', `/api/conciliacion/${ids.concil[0]}/deshacer`, { cuerpo: {} })).estado, 422, 'no se deshace dos veces'); igual((await api('admin', 'POST', '/api/conciliacion/999999/deshacer', { cuerpo: {} })).estado, 404, 'inexistente');
  const otra = await api('admin', 'POST', '/api/conciliacion/sugerencias/aceptar', { cuerpo: { cuenta_bancaria_id: BANCO.id } }); igual(otra.cuerpo.conciliaciones, 1, 'se vuelve a conciliar');
});
await prueba('Conciliar a mano, n a n: la base exige que ambos lados sumen igual y que las líneas sean de un extracto cerrado de esa cuenta', async () => {
  igual((await transf(C1.id, F2.id, '300')).estado, 201, 'cobro de 300'); igual((await transf(C1.id, F2.id, '200')).estado, 201, 'cobro de 200');
  const e2 = await extracto({ desde: hoy, hasta: hoy, saldo_inicial: '1807.30', saldo_final: '2307.30', nombre_archivo: 'nov.csv', lineas: [{ fecha: hoy, descripcion: 'Dos transferencias juntas', importe: '500' }] }); igual(e2.estado, 201, JSON.stringify(e2.cuerpo));
  const borr = (await pend()).lineas.length; const sinCerrar = await api('admin', 'POST', '/api/conciliacion/conciliar', { cuerpo: { cuenta_bancaria_id: BANCO.id, lineas: [{ id: e2.cuerpo.detalle[0].id }], movimientos: [{ id: (await pend()).movimientos[0].id }] } }); igual(sinCerrar.estado, 422, 'una línea de un extracto en borrador no se concilia: ' + JSON.stringify(sinCerrar.cuerpo)); verdad(/no está en un extracto cerrado/.test(sinCerrar.cuerpo.error.mensaje), sinCerrar.cuerpo.error.mensaje);
  igual((await api('admin', 'POST', `/api/conciliacion/extractos/${e2.cuerpo.id}/cerrar`, { cuerpo: {} })).estado, 200, 'se cierra'); const p = await pend(); const lin500 = p.lineas.find((l) => l.importe === '500.00' || num(l.importe) === 500 && l.extracto_id === e2.cuerpo.id), m300 = p.movimientos.find((m) => num(m.importe) === 300), m200 = p.movimientos.find((m) => num(m.importe) === 200); verdad(lin500 && m300 && m200, 'están las tres puntas: ' + borr);
  const mal = await api('admin', 'POST', '/api/conciliacion/conciliar', { cuerpo: { cuenta_bancaria_id: BANCO.id, lineas: [{ id: lin500.id }], movimientos: [{ id: m300.id }] } }); igual(mal.estado, 422, 'no suman igual'); verdad(/No concilia: el extracto suma 500(\.0+)? y los libros 300(\.0+)?/.test(mal.cuerpo.error.mensaje), mal.cuerpo.error.mensaje);
  const ok = await api('admin', 'POST', '/api/conciliacion/conciliar', { cuerpo: { cuenta_bancaria_id: BANCO.id, lineas: [{ id: lin500.id }], movimientos: [{ id: m300.id }, { id: m200.id }] } }); igual([ok.estado, ok.cuerpo.lineas, ok.cuerpo.movimientos, num(ok.cuerpo.importe)], [201, 1, 2, 500], JSON.stringify(ok.cuerpo)); ids.n2 = ok.cuerpo.id;
  igual((await api('admin', 'POST', '/api/conciliacion/conciliar', { cuerpo: { cuenta_bancaria_id: BANCO.id, lineas: [{ id: lin500.id }], movimientos: [{ id: m200.id }] } })).estado, 422, 'ya conciliadas'); igual((await api('admin', 'POST', '/api/conciliacion/conciliar', { cuerpo: { cuenta_bancaria_id: BANCO.id, lineas: [], movimientos: [] } })).estado, 422, 'faltan lados');
  igual((await api('admin', 'POST', '/api/conciliacion/conciliar', { cuerpo: { cuenta_bancaria_id: 999999, lineas: [{ id: 1 }], movimientos: [{ id: 1 }] } })).estado, 404, 'cuenta inexistente');
});
await prueba('Lo que solo está en el banco: la comisión y el impuesto se registran desde la línea con su asiento y se concilian en el mismo paso; el banco y los libros quedan iguales', async () => {
  const gasto = await cuentaContable('5.1.1'), grupo = (await uno(`insert into plan_cuenta (empresa_id, codigo, nombre, tipo, imputable) values ($1, '9', 'Grupo que no se imputa', 'egreso', false) returning id`, [RI])).id; const p = await pend();
  const com = p.lineas.find((l) => num(l.importe) === -35.5), imp = p.lineas.find((l) => num(l.importe) === -7.2); verdad(com && imp, 'están las líneas');
  igual((await mov({ linea_id: com.id, concepto: 'Comisión', cuenta_contable_id: 999999 })).estado, 422, 'la cuenta contable tiene que existir');
  const noImp = await mov({ linea_id: com.id, concepto: 'Comisión', cuenta_contable_id: grupo }); igual(noImp.estado, 422, 'una cuenta que no es imputable no sirve: ' + JSON.stringify(noImp.cuerpo)); verdad(/no existe o no es imputable/.test(noImp.cuerpo.error.mensaje), noImp.cuerpo.error.mensaje);
  igual((await mov({ linea_id: com.id, importe: '-10', concepto: 'Comisión', cuenta_contable_id: gasto })).estado, 422, 'con una línea no se indica el importe');
  const r = await mov({ linea_id: com.id, concepto: 'Comisión de mantenimiento de cuenta', cuenta_contable_id: gasto }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); igual([num(r.cuerpo.movimiento.importe), r.cuerpo.movimiento.fecha, r.cuerpo.conciliacion.lineas, r.cuerpo.conciliacion.movimientos], [-35.5, dias(-1), 1, 1], JSON.stringify(r.cuerpo));
  igual(await linX(r.cuerpo.movimiento.asiento_id), ['1.1.4 H 35.5', '5.1.1 D 35.5'], 'asiento: gasto / banco'); igual((await mov({ linea_id: com.id, concepto: 'Otra vez', cuenta_contable_id: gasto })).estado, 422, 'la línea ya está conciliada');
  const r2 = await mov({ linea_id: imp.id, cuenta_contable_id: gasto }); igual(r2.estado, 201, 'sin concepto usa la descripción del banco: ' + JSON.stringify(r2.cuerpo)); igual(r2.cuerpo.movimiento.concepto, 'Impuesto ley 25413 débito', 'concepto del banco');
  const viejo = (await pend()).lineas; igual(viejo.length, 1, 'queda solo la línea del extracto viejo'); const rv = await mov({ linea_id: viejo[0].id, concepto: 'Interés a favor', cuenta_contable_id: await cuentaContable('4.1.1') }); igual(rv.estado, 201, JSON.stringify(rv.cuerpo)); igual(await linX(rv.cuerpo.movimiento.asiento_id), ['1.1.4 D 100', '4.1.1 H 100'], 'un movimiento a favor: banco / ingreso');
  const e = await estado(); igual([num(e.diferencia_total), num(e.pendiente_banco), num(e.pendiente_libros), num(e.no_explicada), e.movimientos_pendientes, e.lineas_pendientes], [0.0, 0, 0, 0, 0, 0], 'el banco y los libros quedan iguales: ' + JSON.stringify(e)); igual(num(e.saldo_banco), num(e.saldo_libros), 'mismo saldo');
});
await prueba('Un movimiento suelto del banco (sin extracto): se registra con su asiento, queda pendiente y las fechas y el período se controlan', async () => {
  const gasto = await cuentaContable('5.1.1'); const r = await mov({ cuenta_bancaria_id: BANCO.id, fecha: hoy, importe: '-18.90', concepto: 'Gasto bancario no informado', cuenta_contable_id: gasto }); igual(r.estado, 201, JSON.stringify(r.cuerpo)); igual([r.cuerpo.conciliacion, r.cuerpo.movimiento.conciliacion_id], [null, null], 'queda sin conciliar');
  igual(await linX(r.cuerpo.movimiento.asiento_id), ['1.1.4 H 18.9', '5.1.1 D 18.9'], 'asiento');
  const e = await estado(); igual([num(e.pendiente_libros), num(e.no_explicada), e.movimientos_pendientes], [-18.9, 0, 1], 'el movimiento sin conciliar explica la diferencia: ' + JSON.stringify(e));
  igual((await mov({ cuenta_bancaria_id: BANCO.id, importe: '-1', concepto: 'Prueba con fecha de hoy', cuenta_contable_id: gasto })).estado, 201, 'la fecha por defecto es hoy');
  const fut = await mov({ cuenta_bancaria_id: BANCO.id, fecha: dias(3), importe: '-1', concepto: 'Prueba', cuenta_contable_id: gasto }); igual(fut.estado, 422, 'fecha futura'); verdad(/fecha no puede ser futura/.test(fut.cuerpo.error.mensaje), fut.cuerpo.error.mensaje);
  igual((await mov({ cuenta_bancaria_id: BANCO.id, importe: '0', concepto: 'Prueba', cuenta_contable_id: gasto })).estado, 422, 'importe cero'); igual(campo(await mov({ concepto: 'Prueba', cuenta_contable_id: gasto }), 'cuenta_bancaria_id'), 'es obligatoria (o indicá la línea del extracto)', 'sin cuenta ni línea'); igual((await mov({ cuenta_bancaria_id: BANCO.id, importe: '-1', concepto: 'x', cuenta_contable_id: gasto })).estado, 422, 'concepto muy corto');
  const viejo = await mov({ cuenta_bancaria_id: BANCO.id, fecha: '2001-01-01', importe: '-1', concepto: 'Prueba', cuenta_contable_id: gasto }); igual(viejo.estado, 422, 'sin período abierto: ' + JSON.stringify(viejo.cuerpo));
  verdad((await uno(`select count(*)::int n from evento where categoria = 'tesoreria' and entidad_tabla in ('extracto_bancario', 'conciliacion', 'movimiento_tesoreria')`)).n >= 6, 'rastro de los pasos');
  for (const e_ of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e_])).v, null, `cadena ${e_}`);
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
