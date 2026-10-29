// Pruebas de facturas de compra: carga con verificación del total, IVA discriminado o no según la letra, percepciones, asiento, libro de IVA,
// ingreso de stock y costo, duplicados, anulación (con stock, costo y pagos) y aislamiento. Con --pg pasan por el adaptador de producción.
// Uso:  node api/probar_compras.mjs [--pg]
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

// ---------------------------------------------------------------------------
await prueba('Permisos: compras.ver / cargar / anular (Administrador y Contador todo; Auxiliar y Consulta solo ver); lo de compras no se mezcla con ventas', async () => {
  const roles = (await api('admin', 'GET', '/api/estudio/roles')).cuerpo.datos, de = (n) => roles.find((r) => r.nombre === n).permisos;
  igual(['Administrador', 'Contador', 'Auxiliar', 'Consulta'].map((n) => ['compras.ver', 'compras.cargar', 'compras.anular'].map((p) => de(n).includes(p))), [[true, true, true], [true, true, true], [true, false, false], [true, false, false]], 'quién tiene qué');
  igual((await api('consulta', 'GET', '/api/compras/facturas')).estado, 200, 'la consulta ve'); igual((await cargar(base(), { quien: 'auxiliar' })).cuerpo.error.codigo, 'sin_permiso', 'el auxiliar no carga'); igual((await api('consulta', 'POST', '/api/compras/facturas/calcular', { cuerpo: base() })).estado, 403, 'ni calcula');
  igual((await api('consulta', 'GET', '/api/plan-cuentas')).estado, 200, 'el plan de cuentas lo ve quien ve compras');
});

// ---------------------------------------------------------------------------
await prueba('Cálculo previo: muestra el total calculado contra el de la factura, la diferencia y los avisos, y no guarda nada', async () => {
  const bien = await calcular(base()); igual(bien.estado, 200, JSON.stringify(bien.cuerpo)); igual([bien.cuerpo.total_calculado, bien.cuerpo.coincide, bien.cuerpo.diferencia, bien.cuerpo.discrimina_iva], ['1812.50', true, '0.00', true], 'coincide');
  igual([bien.cuerpo.imp_neto, bien.cuerpo.imp_iva, bien.cuerpo.imp_trib, bien.cuerpo.ivas.map((v) => [v.alicuota, v.base_imponible, v.importe_iva])], ['1500.00', '262.50', '50.00', [['21', '1000.00', '210.00'], ['10.5', '500.00', '52.50']]], 'importes');
  igual(bien.cuerpo.items.map((i) => i.ingresa_stock), [true, false], 'solo la mercadería ingresa al stock');
  const mal = await calcular(base({ total: '1900' })); igual([mal.estado, mal.cuerpo.coincide, mal.cuerpo.diferencia], [200, false, '87.50'], 'no coincide: se muestra, no se rechaza'); verdad(mal.cuerpo.avisos.some((a) => /no coincide/.test(a)), 'con su aviso');
  igual((await uno(`select count(*)::int n from comprobante where sentido = 'compra'`)).n, 0, 'no se guardó nada');
});
await prueba('Cargar una factura A: IVA discriminado, percepción, asiento, saldo del proveedor, libro de IVA, ingreso de stock y costo', async () => {
  const r = await cargar(base()); igual(r.estado, 201, JSON.stringify(r.cuerpo)); const f = r.cuerpo; ids.f1 = f.id;
  igual([f.tipo, f.numero_formateado, f.estado, f.imp_neto, f.imp_iva, f.imp_trib, f.imp_total], ['Factura A', '0004-00001234', 'confirmado', '1500.00', '262.50', '50.00', '1812.50'], 'la factura');
  igual(f.ivas.map((v) => [v.alicuota, v.base_imponible, v.importe_iva]), [['21', '1000.00', '210.00'], ['10.5', '500.00', '52.50']], 'IVA por alícuota');
  igual(await lineas(f.asiento.id), ['1.1.5 D 262.5', '1.1.6 D 50', '2.1.1 H 1812.5', '5.1.1 D 1500'], 'asiento: compras, IVA crédito y percepción al debe; el proveedor al haber');
  igual(await saldoProv(P1.id), '1812.50', 'debemos al proveedor'); const libro = await uno(`select iva_21::text i21, iva_10_5::text i105, neto_gravado::text neto from v_libro_iva where comprobante_id = $1`, [f.id]); igual([libro.i21, libro.i105, libro.neto], ['210.00', '52.50', '1500.00'], 'libro de IVA compras');
  igual(await stockDe(PAN.id), 10, 'ingresó la mercadería'); const mov = await uno(`select tipo, costo_unitario::text c, comprobante_item_id is not null as enlazado from movimiento_stock where articulo_id = $1`, [PAN.id]); igual([mov.tipo, mov.c, mov.enlazado], ['compra', '100.0000', true], 'movimiento con su costo');
  igual(await costoDe(PAN.id), '100.0000', 'el costo del artículo es el de la compra'); igual(await costoDe(FLETE.id), null, 'un gasto no lleva costo de reposición');
  const ev = await ultimoEvento('Cargó Factura%'); igual([ev.categoria, ev.usuario_id, ev.empresa_id], ['comprobantes', ADMIN, RI], 'evento'); verdad(/Factura A 0004-00001234 de Molinos del Sur SA/.test(ev.accion) && /ingresó mercadería/.test(ev.detalle), `${ev.accion} / ${ev.detalle}`);
  igual((await detalle(f.id)).cliente, 'Molinos del Sur SA', 'el detalle trae al proveedor'); igual((await api('admin', 'GET', '/api/compras/facturas')).cuerpo.datos.map((x) => x.id), [f.id], 'figura en la lista');
});
await prueba('Lo de compras y lo de ventas no se mezclan: cada lista y cada detalle responde solo por lo suyo', async () => {
  igual((await api('admin', 'GET', '/api/comprobantes')).cuerpo.total, 0, 'la lista de ventas no trae compras'); igual((await api('admin', 'GET', '/api/comprobantes?sentido=compra')).cuerpo.total, 0, 'ni pidiéndolas');
  igual((await api('admin', 'GET', `/api/comprobantes/${ids.f1}`)).estado, 404, 'una compra no se abre como venta'); igual((await api('admin', 'POST', `/api/comprobantes/${ids.f1}/anular`, { cuerpo: { motivo: 'Intento por la ruta de ventas' } })).estado, 404, 'ni se anula por esa ruta');
  const fv = (await api('admin', 'POST', '/api/ventas/facturas', { cuerpo: { tercero_id: CLI.id, items: [{ articulo_id: PAN.id, cantidad: '2', precio_unitario: '300', deposito_id: DEP }] } })).cuerpo; ids.venta = fv.id;
  igual((await api('admin', 'GET', `/api/compras/facturas/${fv.id}`)).estado, 404, 'una venta no se abre como compra'); igual((await anular(fv.id)).estado, 404, 'ni se anula por la ruta de compras'); igual((await api('admin', 'GET', '/api/compras/facturas')).cuerpo.total, 1, 'la lista de compras sigue con una');
});
await prueba('El total tiene que coincidir con el de la factura (con 1 centavo de tolerancia), y el número del proveedor no se repite', async () => {
  const x = await cargar(base({ numero: 1235, total: '1812.00' })); igual(x.estado, 422, 'no coincide'); verdad(/total calculado es \$ 1812.50 y la factura dice \$ 1812.00/.test(x.cuerpo.error.campos.total), x.cuerpo.error.campos.total);
  igual((await uno(`select count(*)::int n from comprobante where sentido = 'compra'`)).n, 1, 'no se guardó');
  igual((await cargar(base({ numero: 1235, total: '1812.51' }))).estado, 201, 'un centavo de diferencia se tolera');
  const dup = await cargar(base()); igual([dup.estado, dup.cuerpo.error.codigo], [409, 'duplicado'], 'la misma factura'); verdad(/Ya está cargada la factura A 0004-00001234 de Molinos del Sur SA/.test(dup.cuerpo.error.mensaje), dup.cuerpo.error.mensaje);
  igual((await cargar(base({ tercero_id: P2.id }))).estado, 201, 'el mismo número de otro proveedor sí'); igual((await cargar(base({ letra: 'M', numero: 1234 }))).estado, 201, 'la misma numeración con otra letra sí');
});
await prueba('Factura B o C: el IVA no se discrimina, no hay crédito fiscal y todo va al costo; una empresa que no es responsable inscripta tampoco toma crédito de una A', async () => {
  const b = await cargar({ tercero_id: P2.id, letra: 'B', punto_venta: 2, numero: 77, fecha: hoy, total: '1210', items: [{ descripcion: 'Servicio de reparación', cantidad: '1', precio_unitario: '1210' }] }); igual(b.estado, 201, JSON.stringify(b.cuerpo));
  igual([b.cuerpo.tipo, b.cuerpo.imp_neto, b.cuerpo.imp_iva, b.cuerpo.imp_tot_conc, b.cuerpo.imp_total], ['Factura B', '0.00', '0.00', '1210.00', '1210.00'], 'todo como no gravado'); igual(await lineas(b.cuerpo.asiento.id), ['2.1.1 H 1210', '5.1.1 D 1210'], 'sin IVA crédito'); verdad(b.cuerpo.avisos.some((a) => /no se discrimina/.test(a)), 'avisa');
  const c = await calcular({ tercero_id: P2.id, letra: 'C', punto_venta: 3, numero: 5, fecha: hoy, total: '500', items: [{ descripcion: 'Mantenimiento', cantidad: '1', precio_unitario: '500', tratamiento: 'gravado', alicuota: '21' }] }); igual([c.cuerpo.discrimina_iva, c.cuerpo.imp_iva, c.cuerpo.items[0].tratamiento], [false, '0.00', 'no_gravado'], 'una C ignora la alícuota que se le pida');
  const provMT = await prov(cuitConDigito('3070811222'), 'Proveedor de la Espiga', 'CUIT', MT), artMT = await art('HAR', 'Harina', { controla_stock: false }, MT);
  const m = await cargar({ tercero_id: provMT.id, letra: 'A', punto_venta: 1, numero: 10, fecha: hoy, total: '1210', items: [{ articulo_id: artMT.id, cantidad: '1', precio_unitario: '1000' }] }, { empresa: MT });
  igual(m.estado, 422, 'si se carga el precio sin IVA no cierra con el total de la factura'); verdad(/total calculado es \$ 1000.00/.test(m.cuerpo.error.campos.total), m.cuerpo.error.campos.total);
  const m2 = await cargar({ tercero_id: provMT.id, letra: 'A', punto_venta: 1, numero: 10, fecha: hoy, total: '1210', items: [{ articulo_id: artMT.id, cantidad: '1', precio_unitario: '1210' }] }, { empresa: MT });
  igual(m2.estado, 201, JSON.stringify(m2.cuerpo)); igual([m2.cuerpo.imp_iva, m2.cuerpo.imp_tot_conc, await lineas(m2.cuerpo.asiento.id)], ['0.00', '1210.00', ['2.1.1 H 1210', '5.1.1 D 1210']], 'el IVA es costo: se carga el precio con IVA'); verdad(m2.cuerpo.avisos.some((a) => /no es responsable inscripta/.test(a)), 'avisa');
});

// ---------------------------------------------------------------------------
await prueba('Validaciones campo por campo: proveedor, fecha, período, renglones, cuentas, depósitos y percepciones', async () => {
  const mal = async (extra, campo, texto) => { const x = await cargar(base({ numero: 5000 + Math.floor(Math.random() * 4000), ...extra })); igual(x.estado, 422, `${campo}: ${JSON.stringify(x.cuerpo)}`); verdad(campo in x.cuerpo.error.campos, `${campo} en ${JSON.stringify(x.cuerpo.error.campos)}`); if (texto) verdad(texto.test(x.cuerpo.error.campos[campo]), `${campo}: ${x.cuerpo.error.campos[campo]}`); };
  await mal({ tercero_id: CLI.id }, 'tercero_id', /proveedor no existe/); await mal({ tercero_id: 99999 }, 'tercero_id'); await mal({ tercero_id: P3.id, letra: 'A' }, 'tercero_id', /necesita que el proveedor tenga CUIT/);
  await mal({ fecha: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) }, 'fecha', /futura/); await mal({ fecha: '2020-01-01' }, 'fecha', /más de 3 años/); await mal({ fecha: '2026-13-40' }, 'fecha'); await mal({ fecha_vto_pago: '2000-01-01' }, 'fecha_vto_pago');
  await mal({ letra: 'Z' }, 'letra'); await mal({ punto_venta: 0 }, 'punto_venta'); await mal({ numero: 'abc' }, 'numero'); await mal({ total: undefined }, 'total'); await mal({ items: [] }, 'items'); await mal({ otro: 1 }, 'otro');
  await mal({ items: [{ cantidad: '1', precio_unitario: '10' }] }, 'items[0].descripcion', /artículo o una descripción/); await mal({ items: [{ articulo_id: 99999, cantidad: '1', precio_unitario: '10' }] }, 'items[0].articulo_id', /no existe/);
  await mal({ items: [{ descripcion: 'x', cantidad: '0', precio_unitario: '10' }] }, 'items[0].cantidad'); await mal({ items: [{ descripcion: 'x', cantidad: '1' }] }, 'items[0].precio_unitario'); await mal({ items: [{ descripcion: 'x', cantidad: '1', precio_unitario: '10', cuenta_id: 99999 }] }, 'items[0].cuenta_id', /no existe o no es imputable/);
  await mal({ items: [{ descripcion: 'x', cantidad: '1', precio_unitario: '10', tratamiento: 'exento', alicuota: '21' }] }, 'items[0].alicuota', /no lleva alícuota/); await mal({ items: [{ descripcion: 'x', cantidad: '1', precio_unitario: '10', desc_pct: '150' }] }, 'items[0].desc_pct');
  await mal({ tributos: [{ tipo: 'percepcion_iibb', importe: '10' }] }, 'tributos[0].jurisdiccion_codigo', /necesita su jurisdicción/); await mal({ tributos: [{ tipo: 'percepcion_iibb', jurisdiccion_codigo: 999, importe: '10' }] }, 'tributos[0].jurisdiccion_codigo', /no existe/); await mal({ tributos: [{ tipo: 'percepcion_iibb', jurisdiccion_codigo: 55555, importe: '10' }] }, 'tributos[0].jurisdiccion_codigo'); await mal({ tributos: [{ tipo: 'inventado', importe: '10' }] }, 'tributos[0].tipo');
  await q(`update periodo set estado = 'cerrado' where empresa_id = $1 and current_date between desde and hasta`, [RI]); await mal({}, 'fecha', /cerrado/); await q(`update periodo set estado = 'abierto' where empresa_id = $1`, [RI]);
  await q(`update tercero set activo = false where id = $1`, [P2.id]); await mal({ tercero_id: P2.id }, 'tercero_id', /dado de baja/); await q(`update tercero set activo = true where id = $1`, [P2.id]);
  igual((await uno(`select count(*)::int n from comprobante where sentido = 'compra' and empresa_id = $1`, [RI])).n, 5, 'ninguna de las rechazadas dejó nada guardado');
});
await prueba('Con más de un depósito hay que decir en cuál entra la mercadería; y una cuenta propia en un renglón reparte el gasto', async () => {
  const dep2 = (await api('admin', 'POST', '/api/depositos', { cuerpo: { nombre: 'Sucursal Norte' } })).cuerpo.id;
  const sin = await cargar(base({ numero: 6001 })); igual([sin.estado, sin.cuerpo.error.campos['items[0].deposito_id']], [422, 'indicá en qué depósito entra la mercadería'], 'sin depósito');
  igual((await cargar(base({ numero: 6001, items: [{ articulo_id: PAN.id, cantidad: '10', precio_unitario: '100', deposito_id: 99999 }, base().items[1]] }))).cuerpo.error.campos['items[0].deposito_id'], 'el depósito no existe o está dado de baja', 'depósito inexistente');
  const antes = await stockDe(PAN.id, dep2), cuenta = (await api('admin', 'GET', '/api/plan-cuentas?q=descuentos obtenidos')).cuerpo.datos[0];
  const ok = await cargar(base({ numero: 6001, items: [{ articulo_id: PAN.id, cantidad: '10', precio_unitario: '100', deposito_id: dep2 }, { articulo_id: FLETE.id, cantidad: '1', precio_unitario: '500', cuenta_id: cuenta.id }] })); igual(ok.estado, 201, JSON.stringify(ok.cuerpo)); ids.dos = ok.cuerpo.id;
  igual(await stockDe(PAN.id, dep2), antes + 10, 'entró en el depósito elegido'); verdad((await lineas(ok.cuerpo.asiento.id)).includes('5.1.9 D 500'), 'el gasto del flete fue a la cuenta que se eligió');
  await api('admin', 'PATCH', `/api/depositos/${dep2}`, { cuerpo: { nombre: 'Sucursal Norte' } }); ids.dep2 = dep2;
});
await prueba('Costo: el de cada artículo es el de la última compra; si cambia más de 15 % se avisa, y el stock lleva el costo de cada ingreso', async () => {
  const r = await cargar(base({ numero: 7001, total: '2417.50', items: [{ articulo_id: PAN.id, cantidad: '10', precio_unitario: '150', desc_pct: '0', deposito_id: DEP }, base().items[1]] })); igual(r.estado, 201, JSON.stringify(r.cuerpo)); ids.f3 = r.cuerpo.id;
  verdad(r.cuerpo.avisos.some((a) => /Harina 000 x 25 kg cambia 50 % respecto del último \(\$ 100 → \$ 150\)/.test(a)), `avisos: ${r.cuerpo.avisos}`); igual(await costoDe(PAN.id), '150.0000', 'costo actualizado');
  const d = await cargar(base({ numero: 7002, total: '1909.30', items: [{ articulo_id: PAN.id, cantidad: '10', precio_unitario: '120', desc_pct: '10', deposito_id: DEP }, base().items[1]] })); igual(d.estado, 201, JSON.stringify(d.cuerpo)); ids.f4 = d.cuerpo.id; verdad(/108/.test((await q(`select costo_unitario::text c from movimiento_stock where comprobante_item_id = (select id from comprobante_item where comprobante_id = $1 and orden = 1)`, [d.cuerpo.id]))[0].c), 'el costo del ingreso es el neto con el descuento (120 − 10 % = 108)');
});

// ---------------------------------------------------------------------------
await prueba('Anular una compra: contraasiento, el stock vuelve a salir, el saldo del proveedor y el costo vuelven a lo anterior; conserva su número', async () => {
  const antesCosto = await costoDe(PAN.id), antesSaldo = await saldoProv(P1.id), antesStock = await stockDe(PAN.id);
  const sinMotivo = await anular(ids.f3, null); igual(sinMotivo.estado, 422, 'motivo obligatorio'); igual((await anular(ids.f3, 'Se cargó dos veces por error', { quien: 'auxiliar' })).cuerpo.error.codigo, 'sin_permiso', 'sin permiso');
  const r = await anular(ids.f3, 'La factura era de otro proveedor'); igual(r.estado, 200, JSON.stringify(r.cuerpo)); igual([r.cuerpo.estado, r.cuerpo.numero_formateado, r.cuerpo.anulacion.motivo], ['anulado', '0004-00007001', 'La factura era de otro proveedor'], 'anulada con su número');
  igual(await neteo(r.cuerpo.asiento.id), [], 'asiento y contraasiento neteados'); igual(await stockDe(PAN.id), antesStock - 10, 'la mercadería sale del stock'); igual(await saldoProv(P1.id), (Number(antesSaldo) - 2417.5).toFixed(2), 'el saldo del proveedor baja');
  igual(await costoDe(PAN.id), '108.0000', 'se anuló una compra que NO era la última: el costo sigue siendo el de la última vigente (108)');
  const mov = (await api('admin', 'GET', `/api/stock/movimientos?articulo_id=${PAN.id}&limite=1`)).cuerpo.datos[0]; igual([mov.tipo, mov.cantidad], ['devolucion_compra', '-10.0000'], 'queda como devolución de compra'); verdad(/Anulación de Factura A 0004-00007001/.test(mov.motivo), mov.motivo);
  igual((await ultimoEvento('Anuló %')).detalle.includes('La factura era de otro proveedor'), true, 'rastro'); igual((await anular(ids.f3)).cuerpo.error.codigo, 'no_se_puede_anular', 'ya anulada');
  const dup = await cargar(base({ numero: 7001, total: '2417.50', items: [{ articulo_id: PAN.id, cantidad: '10', precio_unitario: '150', deposito_id: DEP }, base().items[1]] })); igual(dup.estado, 409, 'el número de una anulada no se reutiliza');
  const u = await anular(ids.f4, 'La última también era un error'); igual(u.estado, 200, JSON.stringify(u.cuerpo)); igual(await costoDe(PAN.id), '100.0000', 'al anular la última, el costo vuelve al de la última compra vigente (100): no al de una compra ya anulada');
  void antesCosto;
});
await prueba('No se anula una compra si la mercadería que ingresó ya se vendió, si tiene pagos imputados, ni con el período cerrado', async () => {
  const f = (await cargar(base({ numero: 8001, total: '1812.50', items: [{ articulo_id: PAN.id, cantidad: '10', precio_unitario: '100', deposito_id: DEP }, base().items[1]] }))).cuerpo;
  const stock = await stockDe(PAN.id); await api('admin', 'POST', '/api/ventas/facturas', { cuerpo: { tercero_id: CLI.id, items: [{ articulo_id: PAN.id, cantidad: String(stock), precio_unitario: '300', deposito_id: DEP }] } });
  const a = await anular(f.id, 'Intento con la mercadería ya vendida'); igual([a.estado, a.cuerpo.error.codigo], [422, 'stock_insuficiente'], 'ya se vendió'); verdad(/ingresó con esta compra/.test(a.cuerpo.error.mensaje), a.cuerpo.error.mensaje); igual((await detalle(f.id)).estado, 'confirmado', 'sigue vigente');
  await api('admin', 'POST', '/api/stock/ajustes', { cuerpo: { articulo_id: PAN.id, deposito_id: DEP, tipo: 'ingreso', cantidad: '100', motivo: 'Reposición para seguir probando' } });
  const caja = await uno(`insert into caja (empresa_id, nombre, cuenta_contable_id) values ($1, 'Caja de pruebas', (select id from plan_cuenta where empresa_id = $1 and codigo = '1.1.1')) returning id`, [RI]);
  const pago = await uno(`insert into pago (empresa_id, sentido, fecha, tercero_id, total_medios, total_imputado, numero) values ($1, 'pago', current_date, $2, 800, 800, 1) returning id`, [RI, P1.id]);
  await q(`insert into pago_medio (empresa_id, pago_id, medio, caja_id, importe) values ($1, $2, 'efectivo', $3, 800)`, [RI, pago.id, caja.id]); await q(`insert into pago_imputacion (empresa_id, pago_id, comprobante_id, importe) values ($1, $2, $3, 800)`, [RI, pago.id, f.id]); await q(`update pago set estado = 'confirmado' where id = $1`, [pago.id]);
  const p = await anular(f.id, 'Intento con un pago imputado'); igual([p.estado, p.cuerpo.error.codigo], [422, 'no_se_puede_anular'], 'con un pago'); verdad(/pagos imputados|cobros imputados/.test(p.cuerpo.error.mensaje), p.cuerpo.error.mensaje); igual((await detalle(f.id)).saldo, '1012.50', 'saldo después del pago');
  const g = (await cargar(base({ numero: 8002, total: '1812.50', items: [{ articulo_id: PAN.id, cantidad: '10', precio_unitario: '100', deposito_id: DEP }, base().items[1]] }))).cuerpo;
  await q(`update periodo set estado = 'cerrado' where empresa_id = $1 and current_date between desde and hasta`, [RI]); igual((await anular(g.id)).cuerpo.error.codigo, 'periodo_no_abierto', 'período cerrado'); await q(`update periodo set estado = 'abierto' where empresa_id = $1`, [RI]);
  igual((await anular(g.id, 'Desde otra empresa', { empresa: MT })).estado, 404, 'otra empresa');
});
await prueba('Plan de cuentas: solo cuentas imputables, con búsqueda; y cada empresa ve las suyas; las jurisdicciones para las percepciones', async () => {
  const j = (await api('admin', 'GET', '/api/catalogos/jurisdicciones')).cuerpo.datos; verdad(j.length >= 20 && j.some((x) => x.codigo === 902 && x.nombre === 'Buenos Aires'), 'jurisdicciones'); igual((await api(null, 'GET', '/api/catalogos/jurisdicciones')).estado, 401, 'con sesión');
  const todas = (await api('admin', 'GET', '/api/plan-cuentas')).cuerpo.datos; verdad(todas.length >= 14 && todas.every((x) => x.codigo && x.nombre && x.tipo), 'lista'); igual((await api('admin', 'GET', '/api/plan-cuentas?q=iva')).cuerpo.datos.map((x) => x.codigo), ['1.1.5', '2.1.4'], 'búsqueda');
  igual((await api('admin', 'GET', '/api/plan-cuentas?q=%25')).cuerpo.datos.length, 0, 'el % no es comodín'); const ctas = (await api('admin', 'GET', '/api/plan-cuentas', { empresa: MT })).cuerpo.datos; verdad(!ctas.some((x) => todas.some((y) => y.id === x.id)), 'cada empresa, las suyas');
});
await prueba('Aislamiento y trazabilidad: lo cargado en una empresa no se ve en otra, y todo queda registrado con la cadena íntegra', async () => {
  igual((await api('admin', 'GET', '/api/compras/facturas', { empresa: MT })).cuerpo.total, 1, 'la otra empresa ve solo lo suyo'); igual((await api('admin', 'GET', `/api/compras/facturas/${ids.f1}`, { empresa: MT })).estado, 404, 'ni abre lo ajeno');
  igual((await uno(`select count(*)::int n from evento where accion like 'Cargó Factura%'`)).n >= 8, true, 'cargas registradas'); igual((await uno(`select count(*)::int n from evento where categoria = 'comprobantes' and usuario_id is null`)).n, 0, 'todas con autor');
  for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena ${e}`);
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
