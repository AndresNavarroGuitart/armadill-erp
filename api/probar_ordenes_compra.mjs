// Pruebas de órdenes de compra: borrador y emisión, validaciones, numeración, que no muevan stock ni generen deuda, cumplimiento contra un remito de entrada,
// anulación (y lo que la impide), listado con filtros y aislamiento. Con --pg pasan por el adaptador de producción.
// Uso:  node api/probar_ordenes_compra.mjs [--pg]
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
const orden = (cuerpo, o = {}) => api(o.quien ?? 'admin', 'POST', '/api/compras/ordenes', { cuerpo, empresa: o.empresa });
const calcO = (cuerpo) => api('admin', 'POST', '/api/compras/ordenes/calcular', { cuerpo });
const verO = async (id, empresa = RI) => api('admin', 'GET', `/api/compras/ordenes/${id}`, { empresa });
const baseO = (extra = {}) => ({ tercero_id: P1.id, fecha: hoy, entrega_prevista: hoy, items: [{ articulo_id: PAN.id, cantidad: '10', precio_unitario: '100' }, { descripcion: 'Flete a destino', cantidad: '1', precio_unitario: '500' }], confirmar: true, ...extra });
const campoO = (r, k) => r.cuerpo?.error?.campos?.[k];
const cuenta = async (tabla) => (await uno(`select count(*)::int n from ${tabla}`)).n;

// ---------------------------------------------------------------------------
await prueba('Permisos: ver las órdenes lo hacen todos; cargarlas, compras.cargar; anularlas, compras.anular', async () => {
  igual((await api('consulta', 'GET', '/api/compras/ordenes')).estado, 200, 'la consulta mira');
  for (const quien of ['auxiliar', 'consulta']) {
    igual((await orden(baseO(), { quien })).estado, 403, `${quien} no carga`); igual((await api(quien, 'POST', '/api/compras/ordenes/calcular', { cuerpo: baseO() })).estado, 403, `${quien} no calcula`);
    for (const [m, r] of [['PUT', '/api/compras/ordenes/1'], ['POST', '/api/compras/ordenes/1/emitir'], ['DELETE', '/api/compras/ordenes/1'], ['POST', '/api/compras/ordenes/1/anular']]) igual((await api(quien, m, r, { cuerpo: {} })).estado, 403, `${quien}: ${m} ${r}`);
  }
});
await prueba('Previa: muestra el total y los avisos sin guardar nada', async () => {
  const antes = await cuenta('documento_comercial'), r = await calcO(baseO({ items: [{ articulo_id: PAN.id, cantidad: '10', precio_unitario: '100' }, { descripcion: 'A definir', cantidad: '2', precio_unitario: '0' }] })); igual(r.estado, 200, JSON.stringify(r.cuerpo));
  igual([r.cuerpo.total, r.cuerpo.items.map((i) => i.importe), r.cuerpo.proveedor.razon_social], ['1000.00', ['1000.00', '0.00'], 'Molinos del Sur SA'], 'importes'); verdad(r.cuerpo.avisos.some((a) => /sin precio/.test(a)), JSON.stringify(r.cuerpo.avisos));
  igual(await cuenta('documento_comercial'), antes, 'no guarda');
});
await prueba('Emitir una orden: queda numerada y emitida, con su total, y no mueve stock ni genera deuda ni asiento', async () => {
  const stock = await cuenta('movimiento_stock'), asientos = await cuenta('asiento'), compr = await cuenta('comprobante'), saldo = await saldoProv(P1.id);
  const r = await orden(baseO({ observaciones: 'Entregar por la tarde' })); igual(r.estado, 201, JSON.stringify(r.cuerpo)); const o = r.cuerpo; ids.oc1 = o.id;
  igual([o.numero_formateado, o.estado, o.total, o.proveedor, o.entrega_prevista, o.observaciones, o.pendiente_de_recibir], ['0001-00000001', 'confirmado', '1500.00', 'Molinos del Sur SA', hoy, 'Entregar por la tarde', true], JSON.stringify(o));
  igual(o.items.map((i) => [i.descripcion, i.cantidad, i.importe, i.recibido, i.facturado, i.pendiente]), [['Harina 000 x 25 kg', '10.0000', '1000.00', '0', '0', '10.0000'], ['Flete a destino', '1.0000', '500.00', '0', '0', '1.0000']], 'renglones');
  igual([o.items[0].deposito_id, o.items[1].deposito_id], [DEP, null], 'la mercadería con un solo depósito lo toma; el servicio no lleva'); igual([o.acciones.anular, o.acciones.modificar, o.acciones.emitir, o.acciones.borrar], [true, false, false, false], 'emitida: solo se anula');
  igual([await cuenta('movimiento_stock'), await cuenta('asiento'), await cuenta('comprobante'), await saldoProv(P1.id)], [stock, asientos, compr, saldo], 'nada de stock, asiento, comprobante ni deuda');
  const e = await ultimoEvento('Emitió la orden de compra%'); igual([e.accion, e.categoria], ['Emitió la orden de compra 0001-00000001', 'comprobantes'], 'rastro');
  const dos = await orden(baseO()); igual(dos.cuerpo.numero_formateado, '0001-00000002', 'la numeración sigue'); ids.oc2 = dos.cuerpo.id;
});
await prueba('Borrador: se guarda, se modifica entero, se emite o se borra; una emitida no se toca', async () => {
  const b = await orden(baseO({ confirmar: false })); igual([b.estado, b.cuerpo.estado, b.cuerpo.acciones.modificar, b.cuerpo.acciones.borrar], [201, 'borrador', true, true], JSON.stringify(b.cuerpo)); const id = b.cuerpo.id;
  const m = await api('admin', 'PUT', `/api/compras/ordenes/${id}`, { cuerpo: baseO({ confirmar: false, items: [{ descripcion: 'Bolsas', cantidad: '3', precio_unitario: '50' }], observaciones: 'Cambió el pedido' }) });
  igual([m.estado, m.cuerpo.total, m.cuerpo.items.length, m.cuerpo.observaciones, m.cuerpo.estado], [200, '150.00', 1, 'Cambió el pedido', 'borrador'], JSON.stringify(m.cuerpo));
  const e = await api('admin', 'POST', `/api/compras/ordenes/${id}/emitir`, { cuerpo: {} }); igual([e.estado, e.cuerpo.estado, e.cuerpo.numero_formateado === b.cuerpo.numero_formateado], [200, 'confirmado', true], 'emitida con el mismo número'); igual((await api('admin', 'POST', `/api/compras/ordenes/${id}/emitir`, { cuerpo: {} })).cuerpo.error.mensaje, 'La orden ya está emitida.', 'no dos veces');
  const mal = await api('admin', 'PUT', `/api/compras/ordenes/${id}`, { cuerpo: baseO() }); igual([mal.estado, /no se modifica/.test(mal.cuerpo.error.mensaje)], [422, true], 'una emitida no se modifica'); igual((await api('admin', 'DELETE', `/api/compras/ordenes/${id}`)).estado, 422, 'ni se borra');
  const b2 = await orden(baseO({ confirmar: false })); const del = await api('admin', 'DELETE', `/api/compras/ordenes/${b2.cuerpo.id}`); igual([del.estado, (await verO(b2.cuerpo.id)).estado], [200, 404], 'un borrador se borra'); igual((await api('admin', 'POST', `/api/compras/ordenes/${b2.cuerpo.id}/anular`, { cuerpo: { motivo: 'xx yy' } })).estado, 404, 'y ya no está');
  const b3 = await orden(baseO({ confirmar: false })); igual((await api('admin', 'POST', `/api/compras/ordenes/${b3.cuerpo.id}/anular`, { cuerpo: { motivo: 'No va' } })).cuerpo.error.mensaje, 'Un borrador no se anula: se borra.', 'un borrador no se anula'); await api('admin', 'DELETE', `/api/compras/ordenes/${b3.cuerpo.id}`);
});
await prueba('Validaciones: proveedor, fechas, renglones, artículos y depósitos', async () => {
  igual(campoO(await calcO(baseO({ tercero_id: CLI.id })), 'tercero_id'), 'el proveedor no existe', 'un cliente no es proveedor'); igual(campoO(await calcO(baseO({ tercero_id: 999999 })), 'tercero_id'), 'el proveedor no existe', 'inexistente');
  await api('admin', 'PATCH', `/api/proveedores/${P2.id}`, { cuerpo: { activo: false } }); igual(campoO(await calcO(baseO({ tercero_id: P2.id })), 'tercero_id'), 'el proveedor está dado de baja', 'dado de baja'); await api('admin', 'PATCH', `/api/proveedores/${P2.id}`, { cuerpo: { activo: true } });
  igual(campoO(await calcO(baseO({ fecha: '2999-01-01' })), 'fecha'), 'la fecha de la orden no puede ser futura', 'fecha futura'); igual(campoO(await calcO(baseO({ fecha: '2001-01-01' })), 'fecha'), 'la fecha de la orden es de hace más de 3 años', 'muy vieja');
  igual(campoO(await calcO(baseO({ entrega_prevista: '2000-01-01' })), 'entrega_prevista'), 'no puede ser anterior a la fecha de la orden', 'entrega antes que la orden');
  igual(campoO(await calcO(baseO({ items: [] })), 'items'), 'tiene que tener al menos 1 elemento', 'sin renglones'); igual(campoO(await calcO(baseO({ items: [{ articulo_id: PAN.id, cantidad: '0', precio_unitario: '1' }] })), 'items[0].cantidad'), 'tiene que ser al menos 0.0001', 'cantidad cero');
  igual(campoO(await calcO(baseO({ items: [{ articulo_id: 999999, cantidad: '1', precio_unitario: '1' }] })), 'items[0].articulo_id'), 'el artículo no existe', 'artículo inexistente'); igual(campoO(await calcO(baseO({ items: [{ cantidad: '1', precio_unitario: '1' }] })), 'items[0].descripcion'), 'indicá un artículo o una descripción', 'sin descripción');
  igual(campoO(await calcO(baseO({ items: [{ articulo_id: PAN.id, cantidad: '1', precio_unitario: '1', deposito_id: 999999 }] })), 'items[0].deposito_id'), 'el depósito no existe o está dado de baja', 'depósito inexistente'); igual((await calcO(baseO({ items: [{ descripcion: 'x', cantidad: '1', precio_unitario: '-5' }] }))).estado, 422, 'precio negativo');
  igual((await orden(baseO({ campo_raro: 1 }))).cuerpo.error.campos.campo_raro, 'no es un campo que se pueda enviar', 'campos desconocidos');
});
await prueba('Cumplimiento: un remito de entrada (cargado en la base) se ve como recibido y deja lo que falta; con remitos la orden no se anula', async () => {
  const it = (await verO(ids.oc2)).cuerpo.items, pan = it.find((i) => i.articulo_id === PAN.id);
  const rem = await uno(`insert into documento_comercial (empresa_id, tipo, fecha, tercero_id, documento_origen_id) values ($1, 'remito_compra', $2, $3, $4) returning id`, [RI, hoy, P1.id, ids.oc2]);
  await q(`insert into documento_item (empresa_id, documento_id, orden, articulo_id, descripcion, cantidad, precio_unitario, deposito_id, item_origen_id) values ($1,$2,1,$3,'Harina',4,100,$4,$5)`, [RI, rem.id, PAN.id, DEP, pan.id]);
  await q(`update documento_comercial set estado = 'confirmado' where id = $1`, [rem.id]);
  const o = (await verO(ids.oc2)).cuerpo, p = o.items.find((i) => i.articulo_id === PAN.id); igual([p.recibido, p.pendiente, o.pendiente_de_recibir], ['4.0000', '6.0000', true], JSON.stringify(p)); igual(await stockDe(PAN.id), 4, 'el remito sí mueve stock');
  const a = await api('admin', 'POST', `/api/compras/ordenes/${ids.oc2}/anular`, { cuerpo: { motivo: 'Cambió el plan' } }); igual([a.estado, a.cuerpo.error.mensaje], [422, 'La orden ya tiene remitos de entrada: anulá primero esos remitos.'], JSON.stringify(a.cuerpo));
  await q(`update documento_comercial set estado = 'anulado' where id = $1`, [rem.id]); igual(await stockDe(PAN.id), 0, 'al anular el remito el stock vuelve'); igual((await api('admin', 'POST', `/api/compras/ordenes/${ids.oc2}/anular`, { cuerpo: { motivo: 'Cambió el plan' } })).estado, 200, 'sin remitos vigentes, se anula');
});
await prueba('Anular una orden: pide el motivo, la deja anulada con su rastro y no se vuelve a anular', async () => {
  igual(campoO(await api('admin', 'POST', `/api/compras/ordenes/${ids.oc1}/anular`, { cuerpo: {} }), 'motivo'), 'es obligatorio', 'pide el motivo'); igual(campoO(await api('admin', 'POST', `/api/compras/ordenes/${ids.oc1}/anular`, { cuerpo: { motivo: 'x' } }), 'motivo'), 'tiene que tener al menos 3 caracteres', 'motivo corto');
  const a = await api('admin', 'POST', `/api/compras/ordenes/${ids.oc1}/anular`, { cuerpo: { motivo: 'El proveedor no tiene stock' } }); igual([a.estado, a.cuerpo.estado, /Anulada: El proveedor no tiene stock/.test(a.cuerpo.observaciones), a.cuerpo.pendiente_de_recibir, a.cuerpo.acciones.anular], [200, 'anulado', true, false, false], JSON.stringify(a.cuerpo));
  igual((await api('admin', 'POST', `/api/compras/ordenes/${ids.oc1}/anular`, { cuerpo: { motivo: 'otra vez' } })).cuerpo.error.mensaje, 'Ya está anulada.', 'no dos veces'); igual((await api('admin', 'POST', `/api/compras/ordenes/${ids.oc1}/anular`, { cuerpo: { motivo: 'xyz abc' }, empresa: MT })).estado, 404, 'ni desde otra empresa');
  const e = await ultimoEvento('Anuló la orden de compra%'); igual([e.accion, /motivo: El proveedor no tiene stock/.test(e.detalle)], ['Anuló la orden de compra 0001-00000001', true], 'rastro');
});
await prueba('Listado: filtros por estado, proveedor, fechas y pendiente de recibir, con paginado; cada empresa ve las suyas', async () => {
  const b = await orden(baseO({ confirmar: false })), otra = await orden(baseO({ tercero_id: P2.id })); verdad(b.cuerpo.id && otra.cuerpo.id, 'más órdenes');
  const todas = (await api('admin', 'GET', '/api/compras/ordenes?limite=100')).cuerpo; igual(todas.total, 5, 'cinco (dos anuladas, un borrador, dos emitidas)'); verdad(todas.datos.every((o, i, a) => !i || a[i - 1].fecha >= o.fecha), 'las más nuevas primero');
  igual((await api('admin', 'GET', '/api/compras/ordenes?estado=borrador')).cuerpo.datos.map((o) => o.estado), ['borrador'], 'borradores'); igual((await api('admin', 'GET', '/api/compras/ordenes?estado=anulado')).cuerpo.total, 2, 'anuladas'); igual((await api('admin', 'GET', `/api/compras/ordenes?tercero_id=${P2.id}`)).cuerpo.datos.map((o) => o.proveedor), ['Transportes Rápidos SRL'], 'por proveedor');
  igual((await api('admin', 'GET', '/api/compras/ordenes?pendiente=true')).cuerpo.datos.map((o) => [o.estado, o.pendiente_de_recibir]), [['confirmado', true], ['confirmado', true]], 'pendientes de recibir: las emitidas con algo por recibir'); igual((await api('admin', 'GET', '/api/compras/ordenes?pendiente=false')).cuerpo.total, 0, 'pendiente=false: las emitidas ya recibidas por completo (todavía ninguna)');
  igual((await api('admin', 'GET', `/api/compras/ordenes?desde=${hoy}&hasta=${hoy}&limite=2&desplazamiento=1`)).cuerpo.datos.length, 2, 'paginado'); igual((await api('admin', 'GET', '/api/compras/ordenes?desde=2020-01-01&hasta=2020-01-31')).cuerpo.total, 0, 'otro mes'); igual((await api('admin', 'GET', '/api/compras/ordenes?estado=raro')).estado, 422, 'estado inválido');
  igual([(await api('admin', 'GET', '/api/compras/ordenes', { empresa: MT })).cuerpo.total, (await verO(ids.oc1, MT)).estado], [0, 404], 'otra empresa'); igual((await api('admin', 'GET', '/api/compras/ordenes', { empresa: MT })).estado, 200, 'su listado vacío');
});
await prueba('Trazabilidad: todo lo que se hizo con las órdenes quedó registrado y la cadena sigue íntegra', async () => {
  verdad((await uno(`select count(*)::int n from evento where accion like '%la orden de compra%'`)).n >= 8, 'rastro de cada paso'); igual((await uno(`select count(*)::int n from evento where accion like '%la orden de compra%' and usuario_id is null`)).n, 0, 'siempre con la persona');
  for (const e of [S.estudios.e1, S.estudios.e2]) igual((await uno('select fn_verificar_trazabilidad($1) v', [e])).v, null, `cadena ${e}`);
});

await srv.cerrar();
await cerrarBase();
console.log(`\n${correctas} pruebas correctas, ${fallas} con falla${MODO_PG ? ' (adaptador pg)' : ''}`);
process.exit(fallas ? 1 : 0);
