// Pedidos de venta: lo que un cliente pide antes de que se entregue (pedido → remito de salida → factura). El pedido NO mueve stock, no reserva mercadería ni genera cobro o asiento:
// deja asentado qué se pidió, a quién, a qué precio y para cuándo. Se guarda como borrador (editable) o ya confirmado; confirmado no se modifica: se anula y se hace otro.
// Vive en documento_comercial (modelo 13), que impone las reglas de fondo (cliente, renglones, estados y que un documento confirmado no se toque). El cumplimiento
// (remitido, facturado, pendiente de remitir) se deriva de v_documento_pendiente. Puede nacer de un presupuesto (cada renglón apunta al suyo, no se pide más de lo presupuestado); el remito contra un pedido no puede entregar más de lo que falta (también lo impone la base).
import { validar } from './validar.mjs';
import { ErrorApi, invalido, noEncontrado } from './errores.mjs';
import { numeroFormateado } from './ventas.mjs';
import { precioVigente } from './articulos.mjs';
import { dec, mul, texto } from '../reglas/calculo.mjs';

const hoyISO = () => new Date().toISOString().slice(0, 10);
const PUNTO = 1;
const ESQUEMA = {
  presupuesto_id: { tipo: 'entero', min: 1 }, tercero_id: { tipo: 'entero', min: 1 }, fecha: { tipo: 'fecha' }, entrega_prevista: { tipo: 'fecha', nulo: true }, lista_id: { tipo: 'entero', min: 1 }, observaciones: { tipo: 'texto', max: 500, nulo: true }, confirmar: { tipo: 'booleano' },
  items: { tipo: 'lista', min: 1, max: 100, requerido: true, elemento: {
    item_origen_id: { tipo: 'entero', min: 1 }, articulo_id: { tipo: 'entero', min: 1 }, descripcion: { tipo: 'texto', max: 200 }, cantidad: { tipo: 'importe', min: 0.0001, max: 99999999, requerido: true },
    precio_unitario: { tipo: 'importe', min: 0, max: 999999999999 }, deposito_id: { tipo: 'entero', min: 1 },
  } },
};

/* Todo lo que se decide ANTES de escribir; devuelve el cálculo para mostrarlo en la previa. */
async function preparar(c, cuerpo) {
  const { valor: d } = validar(ESQUEMA, cuerpo), errores = {}, avisos = [], hoy = hoyISO(), fecha = d.fecha ?? hoy;
  let presupuesto = null;
  if (d.presupuesto_id) {
    presupuesto = await c.uno(`select id, estado, tercero_id, fecha::text as fecha, vencimiento::text as valido_hasta from documento_comercial where id = $1 and tipo = 'presupuesto'`, [d.presupuesto_id]);
    if (!presupuesto) throw invalido({ presupuesto_id: 'el presupuesto no existe' });
    if (presupuesto.estado !== 'confirmado') errores.presupuesto_id = presupuesto.estado === 'borrador' ? 'el presupuesto todavía es un borrador: hay que emitirlo' : 'el presupuesto está anulado';
    else if (presupuesto.valido_hasta && presupuesto.valido_hasta < hoy) errores.presupuesto_id = `el presupuesto venció el ${presupuesto.valido_hasta}`;
    if (d.tercero_id && d.tercero_id !== presupuesto.tercero_id) errores.tercero_id = 'no es el cliente del presupuesto';
  } else if (!d.tercero_id) throw invalido({ tercero_id: 'es obligatorio (o indicá el presupuesto)' });
  const tercero = await c.uno('select id, razon_social, es_cliente, activo, lista_precio_id from tercero where id = $1', [presupuesto?.tercero_id ?? d.tercero_id]);
  if (!tercero || !tercero.es_cliente) throw invalido({ tercero_id: 'el cliente no existe' });
  if (!tercero.activo) errores.tercero_id = 'el cliente está dado de baja';
  if (fecha > hoy) errores.fecha = 'la fecha del pedido no puede ser futura';
  else if (fecha < `${Number(hoy.slice(0, 4)) - 3}${hoy.slice(4)}`) errores.fecha = 'la fecha del pedido es de hace más de 3 años';
  if (presupuesto && fecha < presupuesto.fecha) errores.fecha = 'el pedido no puede ser anterior al presupuesto';
  if (d.entrega_prevista && d.entrega_prevista < fecha) errores.entrega_prevista = 'no puede ser anterior a la fecha del pedido';
  let listaId = d.lista_id ?? tercero.lista_precio_id;
  if (!listaId) listaId = (await c.uno('select id from lista_precio order by orden, id limit 1'))?.id ?? null;
  const depositos = await c.consultar('select id from deposito where activo order by id');
  const origen = presupuesto ? await c.consultar(`select di.id, di.articulo_id, di.descripcion, di.precio_unitario::text as precio,
      di.cantidad - coalesce((select sum(x.cantidad) from documento_item x join documento_comercial p on p.id = x.documento_id and p.estado = 'confirmado' and p.tipo = 'pedido_venta' where x.item_origen_id = di.id), 0) as pendiente
      from documento_item di where di.documento_id = $1`, [presupuesto.id]) : [];
  const items = [], usados = new Set();
  for (const [i, it] of d.items.entries()) {
    const k = `items[${i}].`;
    let o = null;
    if (presupuesto) {
      if (!it.item_origen_id) { errores[k + 'item_origen_id'] = 'indicá qué renglón del presupuesto se pide'; continue; }
      o = origen.find((x) => x.id === it.item_origen_id);
      if (!o) { errores[k + 'item_origen_id'] = 'el renglón no es de ese presupuesto'; continue; }
      if (usados.has(o.id)) { errores[k + 'item_origen_id'] = 'ese renglón está repetido'; continue; }
      usados.add(o.id);
      if (dec(it.cantidad) > dec(o.pendiente)) { errores[k + 'cantidad'] = dec(o.pendiente) <= 0n ? 'ese renglón ya se pidió completo' : `solo se pueden pedir ${texto(dec(o.pendiente), 4).replace(/\.?0+$/, '')} más`; continue; }
    } else if (it.item_origen_id) { errores[k + 'item_origen_id'] = 'sin presupuesto no hay renglón de origen'; continue; }
    const articuloId = o ? o.articulo_id : it.articulo_id;
    if (!articuloId) { errores[k + 'articulo_id'] = 'indicá el artículo'; continue; }
    const a = await c.uno('select id, nombre, tipo, activo, controla_stock from articulo where id = $1', [articuloId]);
    if (!a) { errores[k + 'articulo_id'] = 'el artículo no existe'; continue; }
    if (!a.activo) { errores[k + 'articulo_id'] = 'el artículo está dado de baja'; continue; }
    if (a.tipo === 'gasto') { errores[k + 'articulo_id'] = 'un artículo de tipo gasto no se vende'; continue; }
    let depositoId = it.deposito_id ?? null;
    if (depositoId && !depositos.some((x) => x.id === depositoId)) { errores[k + 'deposito_id'] = 'el depósito no existe o está dado de baja'; continue; }
    if (!depositoId && a.controla_stock && depositos.length === 1) depositoId = depositos[0].id;
    const precio = texto(dec(it.precio_unitario ?? (o && dec(o.precio) > 0n ? o.precio : null) ?? (listaId ? await precioVigente(c, a.id, listaId, fecha) : null) ?? '0'), 4);
    items.push({ origenId: o?.id ?? null, articuloId: a.id, descripcion: o ? o.descripcion : it.descripcion ?? a.nombre, cantidad: it.cantidad, precio, depositoId, importe: texto(mul(dec(it.cantidad), dec(precio))), controlaStock: a.controla_stock });
  }
  if (Object.keys(errores).length) throw invalido(errores);
  if (items.some((x) => dec(x.precio) === 0n)) avisos.push('Hay renglones sin precio: el pedido queda sin valorizar en esos renglones.');
  // el pedido no reserva stock, pero avisa si hoy no alcanza para cumplirlo
  for (const x of items.filter((y) => y.controlaStock && y.depositoId)) {
    const hay = (await c.uno('select coalesce(sum(cantidad), 0)::text s from movimiento_stock where articulo_id = $1 and deposito_id = $2', [x.articuloId, x.depositoId])).s;
    if (dec(hay) < dec(x.cantidad)) avisos.push(`Hoy no hay stock suficiente de ${x.descripcion} (hay ${texto(dec(hay), 4).replace(/\.?0+$/, '')}): el pedido no reserva mercadería.`);
  }
  if (presupuesto) { const faltan = origen.filter((x) => !usados.has(x.id) && dec(x.pendiente) > 0n).length; if (faltan) avisos.push(`Quedan ${faltan} renglón${faltan === 1 ? '' : 'es'} del presupuesto sin pedir en este pedido.`); }
  return { d, tercero, presupuesto, fecha, items, total: texto(items.reduce((s, x) => s + dec(x.importe), 0n)), avisos, entrega: d.entrega_prevista ?? null };
}

export async function calcularPedido(c, cuerpo) {
  const p = await preparar(c, cuerpo);
  return { cliente: { id: p.tercero.id, razon_social: p.tercero.razon_social }, fecha: p.fecha, entrega_prevista: p.entrega, items: p.items.map((x) => ({ descripcion: x.descripcion, cantidad: x.cantidad, precio_unitario: x.precio, importe: x.importe })), total: p.total, avisos: p.avisos };
}

async function insertarItems(c, ctx, id, items) {
  for (const [i, x] of items.entries()) await c.consultar('insert into documento_item (empresa_id, documento_id, orden, articulo_id, descripcion, cantidad, precio_unitario, deposito_id, item_origen_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [ctx.empresaId, id, i + 1, x.articuloId, x.descripcion, x.cantidad, x.precio, x.depositoId, x.origenId]);
}

export async function crearPedido(c, ctx, cuerpo) {
  const p = await preparar(c, cuerpo);
  const cab = await c.uno(`insert into documento_comercial (empresa_id, tipo, punto_venta, fecha, vencimiento, tercero_id, documento_origen_id, observaciones, creado_por) values ($1,'pedido_venta',$2,$3,$4,$5,$6,$7,$8) returning id`,
    [ctx.empresaId, PUNTO, p.fecha, p.entrega, p.tercero.id, p.presupuesto?.id ?? null, p.d.observaciones ?? null, ctx.usuarioId]);
  await insertarItems(c, ctx, cab.id, p.items);
  if (p.d.confirmar) await c.consultar(`update documento_comercial set estado = 'confirmado' where id = $1`, [cab.id]);          // la base verifica cliente y renglones
  return { pedido: await detallePedido(c, cab.id), avisos: p.avisos };
}

/* Un borrador se reemplaza entero (cabecera y renglones); uno confirmado no se toca. */
export async function modificarPedido(c, ctx, id, cuerpo) {
  const antes = await leer(c, id);
  if (antes.estado !== 'borrador') throw new ErrorApi(422, 'no_se_modifica', `El pedido está ${antes.estado}: no se modifica. Anulalo y cargá otro.`);
  const p = await preparar(c, cuerpo);
  await c.consultar('update documento_comercial set fecha = $2, vencimiento = $3, tercero_id = $4, documento_origen_id = $5, observaciones = $6 where id = $1', [id, p.fecha, p.entrega, p.tercero.id, p.presupuesto?.id ?? null, p.d.observaciones ?? null]);
  await c.consultar('delete from documento_item where documento_id = $1', [id]);
  await insertarItems(c, ctx, id, p.items);
  if (p.d.confirmar) await c.consultar(`update documento_comercial set estado = 'confirmado' where id = $1`, [id]);
  return { pedido: await detallePedido(c, id), avisos: p.avisos };
}

export async function confirmarPedido(c, ctx, id) {
  const antes = await leer(c, id);
  if (antes.estado !== 'borrador') throw new ErrorApi(422, 'no_se_puede_confirmar', antes.estado === 'confirmado' ? 'El pedido ya está confirmado.' : `Un pedido ${antes.estado} no se confirma.`);
  await c.consultar(`update documento_comercial set estado = 'confirmado' where id = $1`, [id]);
  return detallePedido(c, id);
}

export async function anularPedido(c, ctx, id, cuerpo) {
  const { valor: d } = validar({ motivo: { tipo: 'texto', min: 3, max: 200, requerido: true } }, cuerpo);
  const antes = await leer(c, id);
  if (antes.estado === 'anulado') throw new ErrorApi(422, 'no_se_puede_anular', 'Ya está anulado.');
  if (antes.estado === 'borrador') throw new ErrorApi(422, 'no_se_puede_anular', 'Un borrador no se anula: se borra.');
  const hijos = await c.uno(`select count(*)::int n from documento_comercial where documento_origen_id = $1 and estado <> 'anulado'`, [id]);
  if (hijos.n > 0) throw new ErrorApi(422, 'no_se_puede_anular', 'El pedido ya tiene remitos de salida: anulá primero esos remitos.');
  const facturas = await c.uno(`select count(*)::int n from comprobante_item ci join comprobante cb on cb.id = ci.comprobante_id and cb.estado in ('confirmado', 'autorizado') where ci.documento_item_id in (select id from documento_item where documento_id = $1)`, [id]);
  if (facturas.n > 0) throw new ErrorApi(422, 'no_se_puede_anular', 'El pedido ya tiene facturas hechas contra él: anulá primero esas facturas.');
  await c.consultar(`update documento_comercial set estado = 'anulado', observaciones = left(coalesce(observaciones || E'\\n', '') || 'Anulado: ' || $2, 500) where id = $1`, [id, d.motivo]);
  return { pedido: await detallePedido(c, id), motivo: d.motivo };
}

export async function borrarPedido(c, ctx, id) {
  const antes = await leer(c, id);
  if (antes.estado !== 'borrador') throw new ErrorApi(422, 'no_se_puede_borrar', 'Solo se borra un borrador: un pedido confirmado se anula.');
  await c.consultar('delete from documento_comercial where id = $1', [id]);
  return { ...antes, numero_formateado: numeroFormateado(antes.punto_venta, antes.numero) };
}

/* ====================== lectura ====================== */
const CAB = `select d.id, d.punto_venta, d.numero, d.fecha::text as fecha, d.vencimiento::text as entrega_prevista, d.estado, d.observaciones, d.tercero_id, te.razon_social as cliente, d.documento_origen_id as presupuesto_id, pr.punto_venta as pr_pv, pr.numero as pr_numero, d.creado_en,
    coalesce((select sum(round(i.cantidad * i.precio_unitario, 2)) from documento_item i where i.documento_id = d.id), 0)::text as total
  from documento_comercial d join tercero te on te.id = d.tercero_id left join documento_comercial pr on pr.id = d.documento_origen_id where d.tipo = 'pedido_venta'`;
async function leer(c, id) { const f = await c.uno(`${CAB} and d.id = $1`, [id]); if (!f) throw noEncontrado('El pedido'); return f; }

export async function detallePedido(c, id) {
  const f = await leer(c, id);
  const items = await c.consultar(`select i.id, i.orden, i.articulo_id, i.descripcion, i.cantidad::text as cantidad, i.precio_unitario::text as precio_unitario, round(i.cantidad * i.precio_unitario, 2)::text as importe, i.deposito_id, dp.nombre as deposito, i.item_origen_id,
      coalesce(v.remitado, 0)::text as remitado, coalesce(v.facturado, 0)::text as facturado, coalesce(v.pendiente_remitir, i.cantidad)::text as pendiente
    from documento_item i left join deposito dp on dp.id = i.deposito_id left join v_documento_pendiente v on v.item_id = i.id where i.documento_id = $1 order by i.orden`, [id]);
  const remitos = (await c.consultar(`select d.id, d.punto_venta, d.numero, d.fecha::text as fecha, d.estado from documento_comercial d where d.documento_origen_id = $1 and d.tipo = 'remito_venta' order by d.id`, [id]))
    .map(({ punto_venta, numero, ...r }) => ({ ...r, numero_formateado: numeroFormateado(punto_venta, numero) }));
  const facturas = (await c.consultar(`select distinct cb.id, t.descripcion as tipo, cb.punto_venta, cb.numero from comprobante_item ci join comprobante cb on cb.id = ci.comprobante_id and cb.estado in ('confirmado', 'autorizado') join arca_tipo_comprobante t on t.codigo = cb.tipo_comprobante_codigo
    where ci.documento_item_id in (select id from documento_item where documento_id = $1) order by cb.id`, [id])).map(({ punto_venta, numero, ...x }) => ({ ...x, numero_formateado: numeroFormateado(punto_venta, numero) }));
  const { punto_venta, numero, pr_pv, pr_numero, ...resto } = f;
  const pendiente = f.estado === 'confirmado' && items.some((i) => dec(i.pendiente) > 0n);
  return { ...resto, numero_formateado: numeroFormateado(punto_venta, numero), presupuesto: f.presupuesto_id ? { id: f.presupuesto_id, numero_formateado: numeroFormateado(pr_pv, pr_numero) } : null, items, remitos, facturas, pendiente_de_remitir: pendiente, total: texto(dec(f.total)),
    acciones: { modificar: f.estado === 'borrador', confirmar: f.estado === 'borrador', borrar: f.estado === 'borrador', anular: f.estado === 'confirmado', remitir: pendiente } };
}

/* `pendiente=true`: confirmados a los que todavía les falta remitir algo; `pendiente=false`: confirmados ya remitidos por completo. */
export async function listarPedidos(c, { estado, tercero_id, desde, hasta, pendiente, limite = 50, desplazamiento = 0 } = {}) {
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
  const total = (await c.uno(`select count(*)::int n from documento_comercial d where d.tipo = 'pedido_venta' and ${filtros}`, p)).n;
  const pend = filas.length ? await c.consultar(`select documento_id, sum(pendiente_remitir)::text as pendiente from v_documento_pendiente where documento_id = any($1::bigint[]) group by documento_id`, [filas.map((f) => f.id)]) : [];
  return { datos: filas.map(({ punto_venta, numero, pr_pv, pr_numero, ...f }) => ({ ...f, numero_formateado: numeroFormateado(punto_venta, numero), presupuesto: f.presupuesto_id ? { id: f.presupuesto_id, numero_formateado: numeroFormateado(pr_pv, pr_numero) } : null, total: texto(dec(f.total)), pendiente_de_remitir: f.estado === 'confirmado' && dec(pend.find((x) => x.documento_id === f.id)?.pendiente ?? '0') > 0n })), total, limite: lim, desplazamiento: des };
}

/* Los renglones de pedidos confirmados de un cliente a los que todavía les falta entregar algo: se pueden facturar directo (sin remito), y esa factura entrega la mercadería. */
export async function pendientesDeFacturarPedidos(c, { tercero_id } = {}) {
  if (!tercero_id || !/^\d{1,15}$/.test(String(tercero_id))) throw invalido({ tercero_id: 'indicá el cliente' });
  const filas = await c.consultar(`select d.id as pedido_id, d.punto_venta, d.numero, d.fecha::text as fecha, i.id as item_id, i.orden, i.articulo_id, i.descripcion, i.cantidad::text as pedido, i.precio_unitario::text as precio,
      v.remitado::text as entregado, v.pendiente_remitir::text as facturable
    from v_documento_pendiente v join documento_item i on i.id = v.item_id join documento_comercial d on d.id = v.documento_id and d.tipo = 'pedido_venta'
   where v.tercero_id = $1 and v.pendiente_remitir > 0 order by d.fecha, d.id, i.orden`, [Number(tercero_id)]);
  return { datos: filas.map(({ punto_venta, numero, ...f }) => ({ ...f, pedido_numero: numeroFormateado(punto_venta, numero), facturable: texto(dec(f.facturable), 4) })) };
}
