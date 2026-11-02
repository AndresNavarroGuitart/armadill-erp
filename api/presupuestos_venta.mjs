// Presupuestos de venta: la cotización que se le da a un cliente (presupuesto → pedido → remito de salida → factura). El presupuesto NO mueve stock, no reserva mercadería ni genera cobro
// o asiento: deja asentado qué se ofrece, a quién, a qué precio y hasta cuándo vale. Se guarda como borrador (editable) o ya emitido; emitido no se modifica: se anula y se hace otro.
// Cuando el cliente acepta se hace un pedido contra el presupuesto (cada renglón apunta al suyo y, sumando los pedidos confirmados, no se pide más de lo presupuestado: lo impone la base).
// Vive en documento_comercial (modelo 13); `vencimiento` es la fecha hasta la que vale. Un presupuesto vencido no se convierte en pedido.
import { validar } from './validar.mjs';
import { ErrorApi, invalido, noEncontrado } from './errores.mjs';
import { numeroFormateado } from './ventas.mjs';
import { precioVigente } from './articulos.mjs';
import { dec, mul, texto } from '../reglas/calculo.mjs';

const hoyISO = () => new Date().toISOString().slice(0, 10);
const PUNTO = 1;
const VALIDEZ_DIAS = 15;
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ESQUEMA = {
  tercero_id: { tipo: 'entero', min: 1, requerido: true }, fecha: { tipo: 'fecha' }, valido_hasta: { tipo: 'fecha', nulo: true }, lista_id: { tipo: 'entero', min: 1 }, observaciones: { tipo: 'texto', max: 500, nulo: true }, confirmar: { tipo: 'booleano' },
  items: { tipo: 'lista', min: 1, max: 100, requerido: true, elemento: {
    articulo_id: { tipo: 'entero', min: 1, requerido: true }, descripcion: { tipo: 'texto', max: 200 }, cantidad: { tipo: 'importe', min: 0.0001, max: 99999999, requerido: true },
    precio_unitario: { tipo: 'importe', min: 0, max: 999999999999 },
  } },
};

/* Todo lo que se decide ANTES de escribir; devuelve el cálculo para mostrarlo en la previa. */
async function preparar(c, cuerpo) {
  const { valor: d } = validar(ESQUEMA, cuerpo), errores = {}, avisos = [], hoy = hoyISO(), fecha = d.fecha ?? hoy;
  const tercero = await c.uno('select id, razon_social, es_cliente, activo, lista_precio_id from tercero where id = $1', [d.tercero_id]);
  if (!tercero || !tercero.es_cliente) throw invalido({ tercero_id: 'el cliente no existe' });
  if (!tercero.activo) errores.tercero_id = 'el cliente está dado de baja';
  if (fecha > hoy) errores.fecha = 'la fecha del presupuesto no puede ser futura';
  else if (fecha < `${Number(hoy.slice(0, 4)) - 3}${hoy.slice(4)}`) errores.fecha = 'la fecha del presupuesto es de hace más de 3 años';
  const validoHasta = 'valido_hasta' in d ? d.valido_hasta : sumarDias(fecha, VALIDEZ_DIAS);          // sin indicarlo vale 15 días; con null no vence
  if (validoHasta && validoHasta < fecha) errores.valido_hasta = 'no puede ser anterior a la fecha del presupuesto';
  let listaId = d.lista_id ?? tercero.lista_precio_id;
  if (!listaId) listaId = (await c.uno('select id from lista_precio order by orden, id limit 1'))?.id ?? null;
  const items = [];
  for (const [i, it] of d.items.entries()) {
    const k = `items[${i}].`;
    const a = await c.uno('select id, nombre, tipo, activo from articulo where id = $1', [it.articulo_id]);
    if (!a) { errores[k + 'articulo_id'] = 'el artículo no existe'; continue; }
    if (!a.activo) { errores[k + 'articulo_id'] = 'el artículo está dado de baja'; continue; }
    if (a.tipo === 'gasto') { errores[k + 'articulo_id'] = 'un artículo de tipo gasto no se vende'; continue; }
    const precio = texto(dec(it.precio_unitario ?? (listaId ? await precioVigente(c, a.id, listaId, fecha) : null) ?? '0'), 4);
    items.push({ articuloId: a.id, descripcion: it.descripcion ?? a.nombre, cantidad: it.cantidad, precio, importe: texto(mul(dec(it.cantidad), dec(precio))) });
  }
  if (Object.keys(errores).length) throw invalido(errores);
  if (items.some((x) => dec(x.precio) === 0n)) avisos.push('Hay renglones sin precio: el presupuesto queda sin valorizar en esos renglones.');
  if (validoHasta && validoHasta < hoy) avisos.push('La fecha de validez ya pasó: el presupuesto nace vencido.');
  return { d, tercero, fecha, items, total: texto(items.reduce((s, x) => s + dec(x.importe), 0n)), avisos, validoHasta: validoHasta ?? null };
}

export async function calcularPresupuesto(c, cuerpo) {
  const p = await preparar(c, cuerpo);
  return { cliente: { id: p.tercero.id, razon_social: p.tercero.razon_social }, fecha: p.fecha, valido_hasta: p.validoHasta, items: p.items.map((x) => ({ descripcion: x.descripcion, cantidad: x.cantidad, precio_unitario: x.precio, importe: x.importe })), total: p.total, avisos: p.avisos };
}

async function insertarItems(c, ctx, id, items) {
  for (const [i, x] of items.entries()) await c.consultar('insert into documento_item (empresa_id, documento_id, orden, articulo_id, descripcion, cantidad, precio_unitario) values ($1,$2,$3,$4,$5,$6,$7)', [ctx.empresaId, id, i + 1, x.articuloId, x.descripcion, x.cantidad, x.precio]);
}

export async function crearPresupuesto(c, ctx, cuerpo) {
  const p = await preparar(c, cuerpo);
  const cab = await c.uno(`insert into documento_comercial (empresa_id, tipo, punto_venta, fecha, vencimiento, tercero_id, observaciones, creado_por) values ($1,'presupuesto',$2,$3,$4,$5,$6,$7) returning id`,
    [ctx.empresaId, PUNTO, p.fecha, p.validoHasta, p.tercero.id, p.d.observaciones ?? null, ctx.usuarioId]);
  await insertarItems(c, ctx, cab.id, p.items);
  if (p.d.confirmar) await c.consultar(`update documento_comercial set estado = 'confirmado' where id = $1`, [cab.id]);
  return { presupuesto: await detallePresupuesto(c, cab.id), avisos: p.avisos };
}

/* Un borrador se reemplaza entero (cabecera y renglones); uno emitido no se toca. */
export async function modificarPresupuesto(c, ctx, id, cuerpo) {
  const antes = await leer(c, id);
  if (antes.estado !== 'borrador') throw new ErrorApi(422, 'no_se_modifica', `El presupuesto está ${antes.estado}: no se modifica. Anulalo y cargá otro.`);
  const p = await preparar(c, cuerpo);
  await c.consultar('update documento_comercial set fecha = $2, vencimiento = $3, tercero_id = $4, observaciones = $5 where id = $1', [id, p.fecha, p.validoHasta, p.tercero.id, p.d.observaciones ?? null]);
  await c.consultar('delete from documento_item where documento_id = $1', [id]);
  await insertarItems(c, ctx, id, p.items);
  if (p.d.confirmar) await c.consultar(`update documento_comercial set estado = 'confirmado' where id = $1`, [id]);
  return { presupuesto: await detallePresupuesto(c, id), avisos: p.avisos };
}

export async function confirmarPresupuesto(c, ctx, id) {
  const antes = await leer(c, id);
  if (antes.estado !== 'borrador') throw new ErrorApi(422, 'no_se_puede_emitir', antes.estado === 'confirmado' ? 'El presupuesto ya está emitido.' : `Un presupuesto ${antes.estado} no se emite.`);
  await c.consultar(`update documento_comercial set estado = 'confirmado' where id = $1`, [id]);
  return detallePresupuesto(c, id);
}

export async function anularPresupuesto(c, ctx, id, cuerpo) {
  const { valor: d } = validar({ motivo: { tipo: 'texto', min: 3, max: 200, requerido: true } }, cuerpo);
  const antes = await leer(c, id);
  if (antes.estado === 'anulado') throw new ErrorApi(422, 'no_se_puede_anular', 'Ya está anulado.');
  if (antes.estado === 'borrador') throw new ErrorApi(422, 'no_se_puede_anular', 'Un borrador no se anula: se borra.');
  const hijos = await c.uno(`select count(*)::int n from documento_comercial where documento_origen_id = $1 and estado <> 'anulado'`, [id]);
  if (hijos.n > 0) throw new ErrorApi(422, 'no_se_puede_anular', 'El presupuesto ya tiene pedidos: anulá primero esos pedidos.');
  await c.consultar(`update documento_comercial set estado = 'anulado', observaciones = left(coalesce(observaciones || E'\\n', '') || 'Anulado: ' || $2, 500) where id = $1`, [id, d.motivo]);
  return { presupuesto: await detallePresupuesto(c, id), motivo: d.motivo };
}

export async function borrarPresupuesto(c, ctx, id) {
  const antes = await leer(c, id);
  if (antes.estado !== 'borrador') throw new ErrorApi(422, 'no_se_puede_borrar', 'Solo se borra un borrador: un presupuesto emitido se anula.');
  await c.consultar('delete from documento_comercial where id = $1', [id]);
  return { ...antes, numero_formateado: numeroFormateado(antes.punto_venta, antes.numero) };
}

/* ====================== lectura ====================== */
const CAB = `select d.id, d.punto_venta, d.numero, d.fecha::text as fecha, d.vencimiento::text as valido_hasta, d.estado, d.observaciones, d.tercero_id, te.razon_social as cliente, d.creado_en,
    coalesce((select sum(round(i.cantidad * i.precio_unitario, 2)) from documento_item i where i.documento_id = d.id), 0)::text as total,
    coalesce((select sum(i.cantidad) from documento_item i where i.documento_id = d.id), 0)::text as cantidad_total,
    coalesce((select sum(x.cantidad) from documento_item x join documento_comercial p on p.id = x.documento_id and p.estado = 'confirmado' and p.tipo = 'pedido_venta' where x.item_origen_id in (select id from documento_item where documento_id = d.id)), 0)::text as cantidad_pedida,
    exists (select 1 from documento_comercial p where p.documento_origen_id = d.id and p.estado <> 'anulado') as tiene_pedidos
  from documento_comercial d join tercero te on te.id = d.tercero_id where d.tipo = 'presupuesto'`;
async function leer(c, id) { const f = await c.uno(`${CAB} and d.id = $1`, [id]); if (!f) throw noEncontrado('El presupuesto'); return f; }

/* La situación que ve la persona: vigente / vencido / aceptado (se pidió todo) / aceptado parcial, además de borrador y anulado. */
function situacion(f) {
  if (f.estado !== 'confirmado') return f.estado;
  const pedida = dec(f.cantidad_pedida), total = dec(f.cantidad_total);
  if (total > 0n && pedida >= total) return 'aceptado';
  if (pedida > 0n) return 'aceptado_parcial';
  return f.valido_hasta && f.valido_hasta < hoyISO() ? 'vencido' : 'vigente';
}
const dar = ({ punto_venta, numero, cantidad_total, cantidad_pedida, tiene_pedidos, ...f }) => ({ ...f, numero_formateado: numeroFormateado(punto_venta, numero), total: texto(dec(f.total)), situacion: situacion({ ...f, cantidad_total, cantidad_pedida }) });

export async function detallePresupuesto(c, id) {
  const f = dar(await leer(c, id));
  const items = await c.consultar(`select i.id, i.orden, i.articulo_id, i.descripcion, i.cantidad::text as cantidad, i.precio_unitario::text as precio_unitario, round(i.cantidad * i.precio_unitario, 2)::text as importe,
      coalesce((select sum(x.cantidad) from documento_item x join documento_comercial p on p.id = x.documento_id and p.estado = 'confirmado' and p.tipo = 'pedido_venta' where x.item_origen_id = i.id), 0)::text as pedido
    from documento_item i where i.documento_id = $1 order by i.orden`, [id]);
  const pedidos = (await c.consultar(`select d.id, d.punto_venta, d.numero, d.fecha::text as fecha, d.estado from documento_comercial d where d.documento_origen_id = $1 and d.tipo = 'pedido_venta' order by d.id`, [id]))
    .map(({ punto_venta, numero, ...r }) => ({ ...r, numero_formateado: numeroFormateado(punto_venta, numero) }));
  const lleno = items.map((i) => ({ ...i, pendiente: texto(dec(i.cantidad) - dec(i.pedido), 4) }));
  const puedePedir = f.estado === 'confirmado' && f.situacion !== 'vencido' && lleno.some((i) => dec(i.pendiente) > 0n);
  return { ...f, items: lleno, pedidos, acciones: { modificar: f.estado === 'borrador', emitir: f.estado === 'borrador', borrar: f.estado === 'borrador', anular: f.estado === 'confirmado', pedir: puedePedir } };
}

/* `situacion`: borrador | vigente | vencido | aceptado_parcial | aceptado | anulado. */
const SITUACIONES = ['borrador', 'vigente', 'vencido', 'aceptado_parcial', 'aceptado', 'anulado'];
export async function listarPresupuestos(c, { situacion: sit, tercero_id, desde, hasta, limite = 50, desplazamiento = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 100), des = Math.max(Number(desplazamiento) || 0, 0), errores = {};
  if (sit && !SITUACIONES.includes(sit)) errores.situacion = `tiene que ser ${SITUACIONES.join(', ')}`;
  if (tercero_id && !/^\d{1,15}$/.test(String(tercero_id))) errores.tercero_id = 'tiene que ser un número';
  for (const [k, v] of [['desde', desde], ['hasta', hasta]]) if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errores[k] = 'tiene que ser una fecha (aaaa-mm-dd)';
  if (Object.keys(errores).length) throw invalido(errores);
  const filtros = `($1::bigint is null or d.tercero_id = $1) and ($2::date is null or d.fecha >= $2) and ($3::date is null or d.fecha <= $3)`;
  const p = [tercero_id ? Number(tercero_id) : null, desde || null, hasta || null];
  // la situación se deriva (vencido, aceptado...), así que se filtra después de calcularla
  const todas = (await c.consultar(`${CAB} and ${filtros} order by d.fecha desc, d.id desc limit 2000`, p)).map(dar).filter((f) => !sit || f.situacion === sit);
  return { datos: todas.slice(des, des + lim), total: todas.length, limite: lim, desplazamiento: des };
}
