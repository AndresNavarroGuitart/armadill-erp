// Pruebas del cierre de ejercicio: previa con lo que impide o avisa, asiento de cierre contra Resultados no asignados, períodos cerrados, ejercicio siguiente,
// informes antes y después (el resultado del año se sigue viendo), reapertura y los límites (ejercicio anterior abierto, movimientos en el siguiente).
// Con --pg pasan por el adaptador de producción (pg + migrador) contra PGlite por socket.
// Uso:  node api/probar_ejercicios.mjs [--pg]
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

// --- datos de partida: dos ejercicios anteriores (el de hace dos años sin movimientos) y el del año pasado con una compra y una venta
const Y = Number(hoy.slice(0, 4)), anterior = `${Y - 1}`;
const crearEj = async (anio) => (await uno('select fn_crear_ejercicio($1, $2, $3) id', [RI, `${anio}-01-01`, `${anio}-12-31`])).id;
const EJ_2 = await crearEj(Y - 2), EJ_1 = await crearEj(Y - 1);
const EJ = (await uno(`select id from ejercicio where empresa_id = $1 and desde = $2`, [RI, `${Y}-01-01`])).id;
const cuenta = async (codigo) => (await uno('select id from plan_cuenta where empresa_id = $1 and codigo = $2', [RI, codigo])).id;
const compra = (await api('admin', 'POST', '/api/compras/facturas', { cuerpo: { tercero_id: P1.id, letra: 'A', punto_venta: 4, numero: 10, fecha: `${anterior}-06-15`, total: '1815', items: [{ descripcion: 'Servicios', cantidad: '1', precio_unitario: '1500', alicuota: '21' }] } }));
if (compra.estado !== 201) throw new Error('compra del año pasado: ' + JSON.stringify(compra.cuerpo));
const manual = async (fecha, descripcion, lineas) => {                                          // un asiento a mano, como lo cargaría un contador
  const a = await uno(`insert into asiento (empresa_id, ejercicio_id, fecha, descripcion, origen_tipo) values ($1, fn_ejercicio_de($1, $2::date), $2, $3, 'manual') returning id`, [RI, fecha, descripcion]);
  for (const [codigo, debe, haber] of lineas) await q('insert into asiento_linea (empresa_id, asiento_id, cuenta_id, debe, haber) values ($1,$2,$3,$4,$5)', [RI, a.id, await cuenta(codigo), debe, haber]);
  await q(`update asiento set estado = 'contabilizado' where id = $1`, [a.id]); return a.id;
};
await manual(`${anterior}-06-20`, 'Venta del año pasado', [['1.1.1', 5000, 0], ['4.1.1', 0, 5000]]);
const ej = (quien, metodo, ruta, cuerpo) => api(quien, metodo, ruta, { cuerpo });
const cerrar = (id, quien = 'admin', cuerpo = { confirmar: true }) => ej(quien, 'POST', `/api/ejercicios/${id}/cerrar`, cuerpo);
const reabrir = (id, motivo = 'Faltaba cargar una factura', quien = 'admin') => ej(quien, 'POST', `/api/ejercicios/${id}/reabrir`, motivo === null ? {} : { motivo });
const previa = async (id) => (await api('admin', 'GET', `/api/ejercicios/${id}/cierre`)).cuerpo;
const filasAsiento = async (id) => (await q(`select c.codigo, l.debe::text d, l.haber::text h from asiento_linea l join plan_cuenta c on c.id = l.cuenta_id where l.asiento_id = $1 order by c.codigo`, [id])).map((l) => `${l.codigo} ${Number(l.d) > 0 ? 'D ' + Number(l.d) : 'H ' + Number(l.h)}`);
const estados = async (desde, hasta) => (await api('admin', 'GET', `/api/informes/estados-contables?desde=${desde}&hasta=${hasta}`)).cuerpo;
const balance = async (desde, hasta) => (await api('admin', 'GET', `/api/informes/balance?desde=${desde}&hasta=${hasta}`)).cuerpo;
const campoE = (r, k) => r.cuerpo?.error?.campos?.[k];

// ---------------------------------------------------------------------------
await prueba('Permisos: ver ejercicios lo tienen todos los roles; cerrar y reabrir, el administrador y el contador', async () => {
  const roles = (await api('admin', 'GET', '/api/estudio/roles')).cuerpo.datos, de = (n, p) => roles.find((r) => r.nombre === n).permisos.includes(p);
  igual(['Administrador', 'Contador', 'Auxiliar', 'Consulta'].map((n) => [de(n, 'ejercicios.ver'), de(n, 'ejercicios.cerrar')]), [[true, true], [true, true], [true, false], [true, false]], 'quién tiene qué');
  igual((await api('consulta', 'GET', '/api/ejercicios')).estado, 200, 'la consulta mira'); igual((await cerrar(EJ_1, 'auxiliar')).estado, 403, 'el auxiliar no cierra'); igual((await reabrir(EJ_1, 'x y z', 'consulta')).estado, 403, 'la consulta no reabre');
});
await prueba('Listado: cada ejercicio con su estado, períodos y resultado (sin contar un asiento de cierre)', async () => {
  const r = (await api('admin', 'GET', '/api/ejercicios')).cuerpo.datos; igual(r.map((e) => e.desde), [`${Y}-01-01`, `${Y - 1}-01-01`, `${Y - 2}-01-01`], 'del más nuevo al más viejo');
  const e1 = r.find((e) => e.id === EJ_1); igual([e1.cerrado, e1.periodos, e1.periodos_abiertos, e1.asientos, e1.resultado, e1.cerrado_por], [false, 12, 12, 2, '3500.00', null], 'el del año pasado');
  igual((await api('admin', 'GET', '/api/ejercicios', { empresa: MT })).cuerpo.datos.map((e) => e.id).includes(EJ_1), false, 'cada empresa los suyos');
});
await prueba('Previa del cierre: lo que impide (año en curso, ejercicio anterior abierto, borradores) y lo que va a pasar', async () => {
  const actual = await previa(EJ); verdad(actual.bloqueos.some((b) => /termina el 31\/12\/\d{4}: no se puede cerrar antes/.test(b)), JSON.stringify(actual.bloqueos)); verdad(actual.bloqueos.some((b) => /Primero hay que cerrar el ejercicio anterior/.test(b)), 'anterior abierto'); igual(actual.puede_cerrar, false, 'no se puede');
  const p1 = await previa(EJ_1); verdad(p1.bloqueos.some((b) => b.startsWith('Primero hay que cerrar el ejercicio anterior (el que empieza el 01/01/')), JSON.stringify(p1.bloqueos));
  const p2 = await previa(EJ_2); igual([p2.puede_cerrar, p2.cuentas_a_saldar, p2.resultado], [true, 0, '0.00'], 'el vacío se puede cerrar'); verdad(p2.avisos.some((a) => /no tiene ingresos ni egresos: se cierra sin asiento/.test(a)) && p2.avisos.some((a) => /Se cerrarán 12 períodos/.test(a)), JSON.stringify(p2.avisos));
  const b = await uno(`insert into asiento (empresa_id, ejercicio_id, fecha, descripcion) values ($1, $2, $3, 'borrador') returning id`, [RI, EJ_2, `${Y - 2}-03-01`]); const pb = await previa(EJ_2); verdad(pb.bloqueos.some((x) => /Hay 1 asiento en borrador/.test(x)), JSON.stringify(pb.bloqueos));
  igual((await cerrar(EJ_2)).estado, 422, 'con un borrador no cierra'); await q('delete from asiento where id = $1', [b.id]);
  igual((await api('admin', 'GET', '/api/ejercicios/999999/cierre')).estado, 404, 'inexistente'); igual((await api('admin', 'GET', `/api/ejercicios/${EJ_1}/cierre`, { empresa: MT })).estado, 404, 'ni el de otra empresa');
});
await prueba('Cerrar sin movimientos: no genera asiento, cierra sus períodos y habilita el siguiente', async () => {
  igual(campoE(await cerrar(EJ_2, 'admin', {}), 'confirmar'), 'es obligatorio', 'hay que confirmar'); igual(campoE(await cerrar(EJ_2, 'admin', { confirmar: false }), 'confirmar'), 'tiene que confirmarse', 'confirmar: false');
  const r = await cerrar(EJ_2); igual(r.estado, 200, JSON.stringify(r.cuerpo)); igual([r.cuerpo.cerrado, r.cuerpo.asiento_cierre_id, r.cuerpo.periodos_abiertos, r.cuerpo.cerrado_en != null], [true, null, 0, true], 'cerrado sin asiento'); verdad(typeof r.cuerpo.cerrado_por === 'string', 'con quién lo cerró');
  igual((await cerrar(EJ_2)).cuerpo.error.mensaje, 'El ejercicio ya está cerrado.', 'no dos veces');
});
await prueba('Cerrar un ejercicio con movimientos: el asiento salda ingresos y egresos contra Resultados no asignados, y el ejercicio queda cerrado', async () => {
  const p = await previa(EJ_1); igual([p.puede_cerrar, p.ingresos, p.egresos, p.resultado, p.cuentas_a_saldar, p.destino], [true, '5000.00', '1500.00', '3500.00', 2, 'Ganancia: va al haber de Resultados no asignados.'], JSON.stringify(p));
  const r = await cerrar(EJ_1); igual(r.estado, 200, JSON.stringify(r.cuerpo)); const e = r.cuerpo; ids.cierre1 = e.asiento_cierre_id;
  igual([e.cerrado, e.periodos_abiertos, e.resultado], [true, 0, '3500.00'], 'cerrado, sin períodos abiertos, el resultado sigue visible');
  igual(await filasAsiento(e.asiento_cierre_id), ['3.2.1 H 3500', '4.1.1 D 5000', '5.1.1 H 1500'], 'asiento de cierre'); const a = await uno('select fecha::text f, origen_tipo o, origen_id, estado from asiento where id = $1', [e.asiento_cierre_id]); igual([a.f, a.o, Number(a.origen_id), a.estado], [`${Y - 1}-12-31`, 'cierre', EJ_1, 'contabilizado'], 'fechado el último día');
  const compraTarde = await api('admin', 'POST', '/api/compras/facturas', { cuerpo: { tercero_id: P1.id, letra: 'A', punto_venta: 4, numero: 11, fecha: `${anterior}-07-01`, total: '121', items: [{ descripcion: 'Tarde', cantidad: '1', precio_unitario: '100', alicuota: '21' }] } });
  igual([compraTarde.estado, campoE(compraTarde, 'fecha')], [422, 'el período de esa fecha está cerrado'], 'ya no se carga nada con fecha del ejercicio cerrado');
  igual((await uno(`select count(*)::int n from periodo where empresa_id = $1 and desde >= $2 and hasta <= $3 and estado = 'cerrado'`, [RI, `${Y - 1}-01-01`, `${Y - 1}-12-31`])).n, 12, 'los 12 períodos cerrados');
  const evento = await uno(`select accion, detalle, categoria from evento where accion like 'Cerró el ejercicio%' order by id desc limit 1`); igual([evento.categoria, evento.accion, evento.detalle], ['contabilidad', `Cerró el ejercicio 01/01/${Y - 1} al 31/12/${Y - 1}`, 'resultado $ 3500.00 · asiento de cierre generado'], 'rastro');
});
await prueba('Informes con el año cerrado: el resultado se sigue viendo, el patrimonio recibe la ganancia y el ejercicio siguiente arranca de cero', async () => {
  const er = await estados(`${Y - 1}-01-01`, `${Y - 1}-12-31`);
  igual([er.resultados.total_ingresos, er.resultados.total_egresos, er.resultados.resultado], ['5000.00', '1500.00', '3500.00'], 'el estado de resultados del año cerrado muestra el año, no el cierre');
  igual([er.situacion.resultados_acumulados, er.situacion.patrimonio_neto.map((f) => [f.codigo, f.importe]), er.situacion.diferencia], ['0.00', [['3.2.1', '3500.00']], '0.00'], 'al cierre la ganancia está en Resultados no asignados y la situación cuadra');
  const b1 = await balance(`${Y - 1}-01-01`, `${Y - 1}-12-31`); igual([b1.totales.debe === b1.totales.haber, b1.totales.saldo_deudor === b1.totales.saldo_acreedor, b1.avisos], [true, true, []], 'balance del año cerrado cuadra'); igual(b1.filas.find((f) => f.codigo === '4.1.1').saldo_acreedor, '5000.00', 'las ventas del año, sin el asiento de cierre');
  const b = await balance(`${Y}-01-01`, hoy); igual([b.totales.debe === b.totales.haber, b.totales.saldo_deudor === b.totales.saldo_acreedor, b.avisos], [true, true, []], 'balance del año siguiente cuadra');
  const rna = b.filas.find((f) => f.codigo === '3.2.1'); igual([rna.saldo_anterior, rna.saldo_acreedor], ['-3500.00', '3500.00'], 'Resultados no asignados arrastra la ganancia'); igual(b.filas.some((f) => f.codigo === '4.1.1' || f.codigo === '5.1.1'), false, 'ingresos y egresos arrancan de cero');
  const actual = await estados(`${Y}-01-01`, hoy); igual([actual.resultados.resultado, actual.situacion.resultados_acumulados, actual.situacion.diferencia], ['0.00', '0.00', '0.00'], 'este año todavía no tiene resultados y la situación cuadra');
  const mayor = (await api('admin', 'GET', `/api/informes/mayor?cuenta_id=${await cuenta('3.2.1')}&desde=${Y - 1}-01-01&hasta=${Y - 1}-12-31`)).cuerpo; igual(mayor.filas.map((f) => [f.haber, f.descripcion.startsWith('Cierre del ejercicio')]), [['3500.00', true]], 'el mayor sí muestra el asiento de cierre');
  const dia = (await api('admin', 'GET', `/api/informes/diario?desde=${Y - 1}-12-31&hasta=${Y - 1}-12-31`)).cuerpo; igual(dia.total, 1, 'y el diario también');
});
await prueba('Reabrir: anula el asiento de cierre y vuelve a abrir los períodos; se puede cargar lo que faltaba y cerrar de nuevo', async () => {
  igual(campoE(await reabrir(EJ_1, null), 'motivo'), 'es obligatorio', 'pide el motivo'); igual((await reabrir(EJ)).cuerpo.error.mensaje, 'El ejercicio no está cerrado.', 'uno abierto no se reabre');
  igual((await reabrir(EJ_2)).cuerpo.error.mensaje, 'Primero hay que reabrir el ejercicio siguiente', 'se reabre de atrás para adelante');
  const r = await reabrir(EJ_1); igual(r.estado, 200, JSON.stringify(r.cuerpo)); igual([r.cuerpo.cerrado, r.cuerpo.asiento_cierre_id, r.cuerpo.periodos_abiertos], [false, null, 12], 'reabierto');
  igual((await uno('select estado from asiento where id = $1', [ids.cierre1])).estado, 'anulado', 'el asiento de cierre queda anulado'); const er = await estados(`${Y - 1}-01-01`, `${Y - 1}-12-31`); igual([er.resultados.resultado, er.situacion.resultados_acumulados, er.situacion.diferencia], ['3500.00', '3500.00', '0.00'], 'sin cierre, el resultado vuelve a ser acumulado');
  const falto = await api('admin', 'POST', '/api/compras/facturas', { cuerpo: { tercero_id: P1.id, letra: 'A', punto_venta: 4, numero: 11, fecha: `${anterior}-07-01`, total: '121', items: [{ descripcion: 'Faltaba', cantidad: '1', precio_unitario: '100', alicuota: '21' }] } }); igual(falto.estado, 201, 'ahora sí entra: ' + JSON.stringify(falto.cuerpo));
  const otra = await cerrar(EJ_1); igual(otra.estado, 200, JSON.stringify(otra.cuerpo)); igual(await filasAsiento(otra.cuerpo.asiento_cierre_id), ['3.2.1 H 3400', '4.1.1 D 5000', '5.1.1 H 1600'], 'el nuevo cierre incluye lo que faltaba'); ids.cierre1 = otra.cuerpo.asiento_cierre_id;
  const e = await estados(`${Y - 1}-01-01`, `${Y - 1}-12-31`); igual([e.resultados.resultado, e.situacion.resultados_acumulados, e.situacion.diferencia], ['3400.00', '0.00', '0.00'], 'el asiento anulado no cuenta');
  igual((await uno(`select count(*)::int n from evento where accion like 'Reabrió el ejercicio%'`)).n, 1, 'rastro de la reapertura');
});
await prueba('Con movimientos en el ejercicio siguiente ya no se reabre el anterior, y el año en curso no se cierra antes de tiempo', async () => {
  const F = await vender(C1.id, '1'); verdad(F?.id, 'una venta de este año: ' + JSON.stringify(F));
  const r = await reabrir(EJ_1); igual([r.estado, r.cuerpo.error.mensaje], [422, 'El ejercicio siguiente ya tiene movimientos: este no se puede reabrir'], JSON.stringify(r.cuerpo));
  const c = await cerrar(EJ); igual([c.estado, /termina el 31\/12\/\d{4}: no se puede cerrar antes de esa fecha/.test(c.cuerpo.error.mensaje)], [422, true], JSON.stringify(c.cuerpo));
  const er = await estados(`${Y}-01-01`, hoy); igual([er.resultados.resultado, er.situacion.resultados_acumulados, er.situacion.diferencia], ['1000.00', '1000.00', '0.00'], 'las ventas de este año se suman aparte, sobre un patrimonio con la ganancia del año pasado'); igual(er.situacion.patrimonio_neto.map((f) => [f.codigo, f.importe]), [['3.2.1', '3400.00']], 'RNA');
});
await prueba('Reglas de la base: no se cierra uno futuro ni uno inexistente, y en un ejercicio cerrado no entra un asiento', async () => {
  const mensaje = async (sql, p) => { try { await q(sql, p); return ''; } catch (e) { return e.message; } };
  verdad(/termina el 31\/12\/\d{4}: no se puede cerrar antes de esa fecha/.test(await mensaje('select fn_cerrar_ejercicio($1)', [EJ])), 'el futuro'); verdad(/El ejercicio no existe/.test(await mensaje('select fn_cerrar_ejercicio(999999)')), 'inexistente'); verdad(/ya está cerrado/.test(await mensaje('select fn_cerrar_ejercicio($1)', [EJ_1])), 'ya cerrado');
  const a = await uno(`insert into asiento (empresa_id, ejercicio_id, fecha, descripcion) values ($1, $2, $3, 'tarde') returning id`, [RI, EJ_1, `${Y - 1}-05-05`]);
  await q('insert into asiento_linea (empresa_id, asiento_id, cuenta_id, debe, haber) values ($1,$2,$3,10,0), ($1,$2,$4,0,10)', [RI, a.id, await cuenta('1.1.1'), await cuenta('4.1.1')]);
  verdad(/período no aceptado \(cerrado\)/.test(await mensaje(`update asiento set estado = 'contabilizado' where id = $1`, [a.id])), 'un asiento con fecha de un período cerrado no se contabiliza'); await q('delete from asiento where id = $1', [a.id]);
  igual((await uno(`select count(*)::int n from cuenta_automatica where empresa_id = $1 and concepto = 'resultados_no_asignados'`, [MT])).n, 1, 'la otra empresa también tiene su cuenta de resultados');
});
await prueba('Trazabilidad: lo que se cerró y reabrió quedó registrado y la cadena sigue íntegra', async () => {
  verdad((await uno(`select count(*)::int n from evento where accion like 'Cerró el ejercicio%'`)).n >= 3, 'tres cierres (con el vacío y el segundo)'); igual((await uno(`select count(*)::int n from evento where categoria = 'contabilidad' and entidad_tabla = 'ejercicio'`)).n >= 4, true, 'con su entidad');
  for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena ${e}`);
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
