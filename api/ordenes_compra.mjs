// Órdenes de compra: lo que se le pide a un proveedor antes de que llegue la mercadería o el servicio. Es el primer eslabón del circuito de compras
// (orden de compra → remito de entrada → factura): la orden NO mueve stock ni genera deuda ni asiento; solo deja asentado qué se pidió, a quién, a qué precio y para cuándo.
// Se guarda como borrador (editable) o ya emitida; emitida no se modifica: se anula y se hace otra. El documento vive en la tabla documento_comercial (modelo 13), que impone las
// reglas de fondo: tercero proveedor, renglones, estados y que un documento emitido no se toque. El cumplimiento (recibido, facturado, pendiente) se deriva de v_documento_pendiente.
import { validar } from './validar.mjs';
import { ErrorApi, invalido, noEncontrado } from './errores.mjs';
import { numeroFormateado } from './ventas.mjs';
import { dec, mul, texto } from '../reglas/calculo.mjs';

const hoyISO = () => new Date().toISOString().slice(0, 10);
const PUNTO = 1;
const ESQUEMA = {
  tercero_id: { tipo: 'entero', min: 1, requerido: true }, fecha: { tipo: 'fecha' }, entrega_prevista: { tipo: 'fecha', nulo: true }, observaciones: { tipo: 'texto', max: 500, nulo: true }, confirmar: { tipo: 'booleano' },
  items: { tipo: 'lista', min: 1, max: 100, requerido: true, elemento: {
    articulo_id: { tipo: 'entero', min: 1 }, descripcion: { tipo: 'texto', max: 200 }, cantidad: { tipo: 'importe', min: 0.0001, max: 99999999, requerido: true },
    precio_unitario: { tipo: 'importe', min: 0, max: 999999999999, requerido: true }, deposito_id: { tipo: 'entero', min: 1 },
  } },
};
const importeRenglon = (cantidad, precio) => texto(mul(dec(cantidad), dec(precio)));

/* Todo lo que se decide ANTES de escribir; devuelve el cálculo para mostrarlo en la previa. */
async function preparar(c, cuerpo) {
  const { valor: d } = validar(ESQUEMA, cuerpo), errores = {}, avisos = [], hoy = hoyISO(), fecha = d.fecha ?? hoy;
  const tercero = await c.uno('select id, razon_social, es_proveedor, activo from tercero where id = $1', [d.tercero_id]);
  if (!tercero || !tercero.es_proveedor) throw invalido({ tercero_id: 'el proveedor no existe' });
  if (!tercero.activo) errores.tercero_id = 'el proveedor está dado de baja';
  if (fecha > hoy) errores.fecha = 'la fecha de la orden no puede ser futura';
  else if (fecha < `${Number(hoy.slice(0, 4)) - 3}${hoy.slice(4)}`) errores.fecha = 'la fecha de la orden es de hace más de 3 años';
  if (d.entrega_prevista && d.entrega_prevista < fecha) errores.entrega_prevista = 'no puede ser anterior a la fecha de la orden';
  const depositos = await c.consultar('select id from deposito where activo order by id');
  const items = [];
  for (const [i, it] of d.items.entries()) {
    const k = `items[${i}].`;
    const a = it.articulo_id ? await c.uno('select id, codigo, nombre, activo, controla_stock from articulo where id = $1', [it.articulo_id]) : null;
    if (it.articulo_id && !a) { errores[k + 'articulo_id'] = 'el artículo no existe'; continue; }
    if (a && !a.activo) { errores[k + 'articulo_id'] = 'el artículo está dado de baja'; continue; }
    const descripcion = it.descripcion ?? a?.nombre;
    if (!descripcion) { errores[k + 'descripcion'] = 'indicá un artículo o una descripción'; continue; }
    let depositoId = it.deposito_id ?? null;
    if (depositoId && !depositos.some((x) => x.id === depositoId)) errores[k + 'deposito_id'] = 'el depósito no existe o está dado de baja';
    else if (!depositoId && a?.controla_stock && depositos.length === 1) depositoId = depositos[0].id;
    items.push({ articuloId: a?.id ?? null, descripcion, cantidad: it.cantidad, precio: it.precio_unitario, depositoId, importe: importeRenglon(it.cantidad, it.precio_unitario), controlaStock: !!a?.controla_stock });
  }
  if (Object.keys(errores).length) throw invalido(errores);
  if (items.some((x) => x.controlaStock && !x.depositoId)) avisos.push('Hay mercadería sin depósito de destino: se define cuando se recibe.');
  if (items.some((x) => dec(x.precio) === 0n)) avisos.push('Hay renglones sin precio: la orden queda sin valorizar en esos renglones.');
  const total = texto(items.reduce((s, x) => s + dec(x.importe), 0n));
  return { d, tercero, fecha, items, total, avisos, entrega: d.entrega_prevista ?? null };
}

export async function calcularOrden(c, cuerpo) {
  const p = await preparar(c, cuerpo);
  return { proveedor: { id: p.tercero.id, razon_social: p.tercero.razon_social }, fecha: p.fecha, entrega_prevista: p.entrega, items: p.items.map((x) => ({ descripcion: x.descripcion, cantidad: x.cantidad, precio_unitario: x.precio, importe: x.importe })), total: p.total, avisos: p.avisos };
}

async function insertarItems(c, ctx, id, items) {
  for (const [i, x] of items.entries()) await c.consultar('insert into documento_item (empresa_id, documento_id, orden, articulo_id, descripcion, cantidad, precio_unitario, deposito_id) values ($1,$2,$3,$4,$5,$6,$7,$8)', [ctx.empresaId, id, i + 1, x.articuloId, x.descripcion, x.cantidad, x.precio, x.depositoId]);
}

export async function crearOrden(c, ctx, cuerpo) {
  const p = await preparar(c, cuerpo);
  const cab = await c.uno(`insert into documento_comercial (empresa_id, tipo, punto_venta, fecha, vencimiento, tercero_id, observaciones, creado_por) values ($1,'orden_compra',$2,$3,$4,$5,$6,$7) returning id`,
    [ctx.empresaId, PUNTO, p.fecha, p.entrega, p.tercero.id, p.d.observaciones ?? null, ctx.usuarioId]);
  await insertarItems(c, ctx, cab.id, p.items);
  if (p.d.confirmar) await c.consultar(`update documento_comercial set estado = 'confirmado' where id = $1`, [cab.id]);          // la base verifica proveedor y renglones
  return { orden: await detalleOrden(c, cab.id), avisos: p.avisos, p };
}

/* Un borrador se reemplaza entero (cabecera y renglones); uno emitido no se toca. */
export async function modificarOrden(c, ctx, id, cuerpo) {
  const antes = await leer(c, id);
  if (antes.estado !== 'borrador') throw new ErrorApi(422, 'no_se_modifica', `La orden está ${antes.estado}: no se modifica. Anulala y cargá otra.`);
  const p = await preparar(c, cuerpo);
  await c.consultar('update documento_comercial set fecha = $2, vencimiento = $3, tercero_id = $4, observaciones = $5 where id = $1', [id, p.fecha, p.entrega, p.tercero.id, p.d.observaciones ?? null]);
  await c.consultar('delete from documento_item where documento_id = $1', [id]);
  await insertarItems(c, ctx, id, p.items);
  if (p.d.confirmar) await c.consultar(`update documento_comercial set estado = 'confirmado' where id = $1`, [id]);
  return { orden: await detalleOrden(c, id), avisos: p.avisos, p };
}

export async function confirmarOrden(c, ctx, id) {
  const antes = await leer(c, id);
  if (antes.estado !== 'borrador') throw new ErrorApi(422, 'no_se_puede_emitir', antes.estado === 'confirmado' ? 'La orden ya está emitida.' : `Una orden ${antes.estado} no se emite.`);
  await c.consultar(`update documento_comercial set estado = 'confirmado' where id = $1`, [id]);
  return detalleOrden(c, id);
}

export async function anularOrden(c, ctx, id, cuerpo) {
  const { valor: d } = validar({ motivo: { tipo: 'texto', min: 3, max: 200, requerido: true } }, cuerpo);
  const antes = await leer(c, id);
  if (antes.estado === 'anulado') throw new ErrorApi(422, 'no_se_puede_anular', 'Ya está anulada.');
  if (antes.estado === 'borrador') throw new ErrorApi(422, 'no_se_puede_anular', 'Un borrador no se anula: se borra.');
  const hijos = await c.uno(`select count(*)::int n from documento_comercial where documento_origen_id = $1 and estado <> 'anulado'`, [id]);
  const facturas = await c.uno(`select count(*)::int n from comprobante_item ci join comprobante cb on cb.id = ci.comprobante_id and cb.estado in ('confirmado', 'autorizado')
    where ci.documento_item_id in (select id from documento_item where documento_id = $1)`, [id]);
  if (hijos.n > 0) throw new ErrorApi(422, 'no_se_puede_anular', 'La orden ya tiene remitos de entrada: anulá primero esos remitos.');
  if (facturas.n > 0) throw new ErrorApi(422, 'no_se_puede_anular', 'La orden ya tiene facturas cargadas: anulá primero esas facturas.');
  await c.consultar(`update documento_comercial set estado = 'anulado', observaciones = left(coalesce(observaciones || E'\\n', '') || 'Anulada: ' || $2, 500) where id = $1`, [id, d.motivo]);
  return { orden: await detalleOrden(c, id), motivo: d.motivo };
}

export async function borrarOrden(c, ctx, id) {
  const antes = await leer(c, id);
  if (antes.estado !== 'borrador') throw new ErrorApi(422, 'no_se_puede_borrar', 'Solo se borra un borrador: una orden emitida se anula.');
  await c.consultar('delete from documento_comercial where id = $1', [id]);
  return { ...antes, numero_formateado: numeroFormateado(antes.punto_venta, antes.numero) };
}

/* ====================== lectura ====================== */
const CAB = `select d.id, d.punto_venta, d.numero, d.fecha::text as fecha, d.vencimiento::text as entrega_prevista, d.estado, d.observaciones, d.tercero_id, te.razon_social as proveedor, d.creado_en,
    coalesce((select sum(round(i.cantidad * i.precio_unitario, 2)) from documento_item i where i.documento_id = d.id), 0)::text as total
  from documento_comercial d join tercero te on te.id = d.tercero_id where d.tipo = 'orden_compra'`;
async function leer(c, id) { const f = await c.uno(`${CAB} and d.id = $1`, [id]); if (!f) throw noEncontrado('La orden de compra'); return f; }

export async function detalleOrden(c, id) {
  const f = await leer(c, id);
  const items = await c.consultar(`select i.id, i.orden, i.articulo_id, i.descripcion, i.cantidad::text as cantidad, i.precio_unitario::text as precio_unitario, round(i.cantidad * i.precio_unitario, 2)::text as importe, i.deposito_id, dp.nombre as deposito,
      coalesce(v.remitado, 0)::text as recibido, coalesce(v.facturado, 0)::text as facturado, coalesce(v.pendiente_remitir, i.cantidad)::text as pendiente
    from documento_item i left join deposito dp on dp.id = i.deposito_id left join v_documento_pendiente v on v.item_id = i.id where i.documento_id = $1 order by i.orden`, [id]);
  const remitos = (await c.consultar(`select d.id, d.punto_venta, d.numero, d.numero_externo, d.fecha::text as fecha, d.estado from documento_comercial d where d.documento_origen_id = $1 and d.tipo = 'remito_compra' order by d.id`, [id]))
    .map(({ punto_venta, numero, ...r }) => ({ ...r, numero_formateado: numeroFormateado(punto_venta, numero) }));
  const { punto_venta, numero, ...resto } = f;
  const pendiente = f.estado === 'confirmado' && items.some((i) => dec(i.pendiente) > 0n);
  return { ...resto, numero_formateado: numeroFormateado(punto_venta, numero), items, remitos, pendiente_de_recibir: pendiente, total: texto(dec(f.total)),
    acciones: { modificar: f.estado === 'borrador', emitir: f.estado === 'borrador', borrar: f.estado === 'borrador', anular: f.estado === 'confirmado' } };
}

/* `pendiente=true`: emitidas a las que todavía les falta recibir algo; `pendiente=false`: emitidas ya recibidas por completo. */
export async function listarOrdenes(c, { estado, tercero_id, desde, hasta, pendiente, limite = 50, desplazamiento = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 100), des = Math.max(Number(desplazamiento) || 0, 0), errores = {};
  if (estado && !['borrador', 'confirmado', 'anulado'].includes(estado)) errores.estado = 'tiene que ser borrador, confirmado o anulado';
  if (tercero_id && !/^\d{1,15}$/.test(String(tercero_id))) errores.tercero_id = 'tiene que ser un número';
  for (const [k, v] of [['desde', desde], ['hasta', hasta]]) if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errores[k] = 'tiene que ser una fecha (aaaa-mm-dd)';
  if (pendiente && !['true', 'false'].includes(String(pendiente))) errores.pendiente = 'tiene que ser true o false';
  if (Object.keys(errores).length) throw invalido(errores);
  const filtros = `($1::text is null or d.estado = $1) and ($2::bigint is null or d.tercero_id = $2) and ($3::date is null or d.fecha >= $3) and ($4::date is null or d.fecha <= $4)
    and ($5::boolean is null or (d.estado = 'confirmado' and $5 = exists (select 1 from v_documento_pendiente v where v.documento_id = d.id and v.pendiente_remitir > 0)))`;
  const p = [estado || null, tercero_id ? Number(tercero_id) : null, desde || null, hasta || null, pendiente === undefined || pendiente === '' ? null : String(pendiente) === 'true'];
  const filas = await c.consultar(`${CAB} and ${filtros} order by d.fecha desc, d.id desc limit ${lim} offset ${des}`, p);
  const total = (await c.uno(`select count(*)::int n from documento_comercial d where d.tipo = 'orden_compra' and ${filtros}`, p)).n;
  const pend = filas.length ? await c.consultar(`select documento_id, sum(pendiente_remitir)::text as pendiente from v_documento_pendiente where documento_id = any($1::bigint[]) group by documento_id`, [filas.map((f) => f.id)]) : [];
  return { datos: filas.map(({ punto_venta, numero, ...f }) => ({ ...f, numero_formateado: numeroFormateado(punto_venta, numero), total: texto(dec(f.total)), pendiente_de_recibir: f.estado === 'confirmado' && dec(pend.find((x) => x.documento_id === f.id)?.pendiente ?? '0') > 0n })), total, limite: lim, desplazamiento: des };
}
