// Remitos de entrada: la mercadería que llegó, contra una orden de compra o suelta. Al confirmarlo la base ingresa el stock al depósito (a su precio como costo del ingreso) y
// al anularlo lo vuelve a sacar; no genera deuda ni asiento: eso lo hace la factura. Con una orden, cada renglón apunta al renglón pedido y no se recibe más de lo que falta
// (lo impone la base). El número del remito del proveedor (el del papel) se guarda aparte y no se repite para el mismo proveedor.
import { validar } from './validar.mjs';
import { ErrorApi, invalido, noEncontrado } from './errores.mjs';
import { numeroFormateado } from './ventas.mjs';
import { dec, mul, texto } from '../reglas/calculo.mjs';

const hoyISO = () => new Date().toISOString().slice(0, 10);
const PUNTO = 1;
const cant = (x) => texto(dec(x), 4).replace(/\.?0+$/, '');
const ESQUEMA = {
  orden_id: { tipo: 'entero', min: 1 }, tercero_id: { tipo: 'entero', min: 1 }, fecha: { tipo: 'fecha' }, numero_externo: { tipo: 'texto', min: 1, max: 30, nulo: true }, observaciones: { tipo: 'texto', max: 500, nulo: true }, confirmar: { tipo: 'booleano' },
  items: { tipo: 'lista', min: 1, max: 100, requerido: true, elemento: {
    item_origen_id: { tipo: 'entero', min: 1 }, articulo_id: { tipo: 'entero', min: 1 }, descripcion: { tipo: 'texto', max: 200 }, cantidad: { tipo: 'importe', min: 0.0001, max: 99999999, requerido: true },
    precio_unitario: { tipo: 'importe', min: 0, max: 999999999999 }, deposito_id: { tipo: 'entero', min: 1 },
  } },
};

async function preparar(c, cuerpo, idPropio = null) {
  const { valor: d } = validar(ESQUEMA, cuerpo), errores = {}, avisos = [], hoy = hoyISO(), fecha = d.fecha ?? hoy;
  let orden = null, tercero;
  if (d.orden_id) {
    orden = await c.uno(`select id, estado, tercero_id, fecha::text as fecha, punto_venta, numero from documento_comercial where id = $1 and tipo = 'orden_compra'`, [d.orden_id]);
    if (!orden) throw invalido({ orden_id: 'la orden de compra no existe' });
    if (orden.estado !== 'confirmado') errores.orden_id = orden.estado === 'borrador' ? 'la orden todavía es un borrador: hay que emitirla' : 'la orden está anulada';
    if (d.tercero_id && d.tercero_id !== orden.tercero_id) errores.tercero_id = 'no es el proveedor de la orden';
  } else if (!d.tercero_id) throw invalido({ tercero_id: 'es obligatorio (o indicá la orden de compra)' });
  tercero = await c.uno('select id, razon_social, es_proveedor, activo from tercero where id = $1', [orden?.tercero_id ?? d.tercero_id]);
  if (!tercero || !tercero.es_proveedor) throw invalido({ tercero_id: 'el proveedor no existe' });
  if (!tercero.activo) errores.tercero_id = 'el proveedor está dado de baja';
  if (fecha > hoy) errores.fecha = 'la fecha del remito no puede ser futura';
  else if (fecha < `${Number(hoy.slice(0, 4)) - 3}${hoy.slice(4)}`) errores.fecha = 'la fecha del remito es de hace más de 3 años';
  else if (orden && fecha < orden.fecha) errores.fecha = 'el remito no puede ser anterior a la orden de compra';
  if (d.numero_externo && await c.uno(`select 1 x from documento_comercial where tipo = 'remito_compra' and tercero_id = $1 and lower(numero_externo) = lower($2) and estado <> 'anulado' and id is distinct from $3`, [tercero.id, d.numero_externo, idPropio]))
    errores.numero_externo = 'ya hay un remito de ese proveedor con ese número';

  const depositos = await c.consultar('select id from deposito where activo order by id');
  const origen = orden ? await c.consultar(`select di.id, di.articulo_id, di.descripcion, di.precio_unitario::text as precio, di.deposito_id, coalesce(v.pendiente_remitir, di.cantidad) as pendiente
      from documento_item di left join v_documento_pendiente v on v.item_id = di.id where di.documento_id = $1`, [orden.id]) : [];
  const usados = new Set(), items = [];
  for (const [i, it] of d.items.entries()) {
    const k = `items[${i}].`;
    let o = null;
    if (orden) {
      if (!it.item_origen_id) { errores[k + 'item_origen_id'] = 'indicá qué renglón de la orden se recibe'; continue; }
      o = origen.find((x) => x.id === it.item_origen_id);
      if (!o) { errores[k + 'item_origen_id'] = 'el renglón no es de esa orden'; continue; }
      if (usados.has(o.id)) { errores[k + 'item_origen_id'] = 'ese renglón está repetido'; continue; }
      usados.add(o.id);
      if (dec(it.cantidad) > dec(o.pendiente)) errores[k + 'cantidad'] = dec(o.pendiente) <= 0n ? 'ese renglón ya se recibió completo' : `solo faltan recibir ${cant(o.pendiente)}`;
    } else if (it.item_origen_id) { errores[k + 'item_origen_id'] = 'sin orden de compra no hay renglón de origen'; continue; }
    const articuloId = o ? o.articulo_id : it.articulo_id ?? null;
    const a = articuloId ? await c.uno('select a.id, a.nombre, a.activo, a.controla_stock, (select k.costo::text from articulo_costo k where k.articulo_id = a.id order by k.fecha desc, k.id desc limit 1) as costo_actual from articulo a where a.id = $1', [articuloId]) : null;
    if (articuloId && !a) { errores[k + 'articulo_id'] = 'el artículo no existe'; continue; }
    if (a && !a.activo) { errores[k + 'articulo_id'] = 'el artículo está dado de baja'; continue; }
    const descripcion = o ? o.descripcion : it.descripcion ?? a?.nombre;
    if (!descripcion) { errores[k + 'descripcion'] = 'indicá un artículo o una descripción'; continue; }
    let depositoId = it.deposito_id ?? o?.deposito_id ?? null;
    if (depositoId && !depositos.some((x) => x.id === depositoId)) { errores[k + 'deposito_id'] = 'el depósito no existe o está dado de baja'; continue; }
    if (!depositoId && a?.controla_stock) { if (depositos.length === 1) depositoId = depositos[0].id; else errores[k + 'deposito_id'] = 'indicá en qué depósito entra la mercadería'; }
    const precio = it.precio_unitario ?? o?.precio ?? (a?.costo_actual ? texto(dec(a.costo_actual), 4) : '0');
    items.push({ origenId: o?.id ?? null, articuloId, descripcion, cantidad: it.cantidad, precio, depositoId, controlaStock: !!a?.controla_stock, importe: texto(mul(dec(it.cantidad), dec(precio))) });
  }
  if (Object.keys(errores).length) throw invalido(errores);
  if (!items.some((x) => x.controlaStock)) avisos.push('Ningún renglón lleva control de stock: el remito no mueve existencias.');
  if (orden) { const faltan = origen.filter((x) => !usados.has(x.id) && dec(x.pendiente) > 0n).length; if (faltan) avisos.push(`Quedan ${faltan} renglón${faltan === 1 ? '' : 'es'} de la orden sin recibir en este remito.`); }
  return { d, orden, tercero, fecha, items, avisos, total: texto(items.reduce((s, x) => s + dec(x.importe), 0n)) };
}

export async function calcularRemito(c, cuerpo) {
  const p = await preparar(c, cuerpo);
  return { proveedor: { id: p.tercero.id, razon_social: p.tercero.razon_social }, fecha: p.fecha, items: p.items.map((x) => ({ descripcion: x.descripcion, cantidad: x.cantidad, precio_unitario: x.precio, importe: x.importe, mueve_stock: x.controlaStock })), total: p.total, avisos: p.avisos };
}

async function insertarItems(c, ctx, id, items) {
  for (const [i, x] of items.entries()) await c.consultar('insert into documento_item (empresa_id, documento_id, orden, articulo_id, descripcion, cantidad, precio_unitario, deposito_id, item_origen_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [ctx.empresaId, id, i + 1, x.articuloId, x.descripcion, x.cantidad, x.precio, x.depositoId, x.origenId]);
}

export async function crearRemito(c, ctx, cuerpo) {
  const p = await preparar(c, cuerpo);
  const cab = await c.uno(`insert into documento_comercial (empresa_id, tipo, punto_venta, fecha, tercero_id, documento_origen_id, numero_externo, observaciones, creado_por) values ($1,'remito_compra',$2,$3,$4,$5,$6,$7,$8) returning id`,
    [ctx.empresaId, PUNTO, p.fecha, p.tercero.id, p.orden?.id ?? null, p.d.numero_externo ?? null, p.d.observaciones ?? null, ctx.usuarioId]);
  await insertarItems(c, ctx, cab.id, p.items);
  if (p.d.confirmar) await c.consultar(`update documento_comercial set estado = 'confirmado' where id = $1`, [cab.id]);          // la base verifica la cadena y sobre-entrega, y mueve el stock
  return { remito: await detalleRemito(c, cab.id), avisos: p.avisos };
}

export async function modificarRemito(c, ctx, id, cuerpo) {
  const antes = await leer(c, id);
  if (antes.estado !== 'borrador') throw new ErrorApi(422, 'no_se_modifica', `El remito está ${antes.estado}: no se modifica. Anulalo y cargá otro.`);
  const p = await preparar(c, cuerpo, id);
  await c.consultar('update documento_comercial set fecha = $2, tercero_id = $3, documento_origen_id = $4, numero_externo = $5, observaciones = $6 where id = $1', [id, p.fecha, p.tercero.id, p.orden?.id ?? null, p.d.numero_externo ?? null, p.d.observaciones ?? null]);
  await c.consultar('delete from documento_item where documento_id = $1', [id]);
  await insertarItems(c, ctx, id, p.items);
  if (p.d.confirmar) await c.consultar(`update documento_comercial set estado = 'confirmado' where id = $1`, [id]);
  return { remito: await detalleRemito(c, id), avisos: p.avisos };
}

export async function confirmarRemito(c, ctx, id) {
  const antes = await leer(c, id);
  if (antes.estado !== 'borrador') throw new ErrorApi(422, 'no_se_puede_confirmar', antes.estado === 'confirmado' ? 'El remito ya está confirmado.' : `Un remito ${antes.estado} no se confirma.`);
  await c.consultar(`update documento_comercial set estado = 'confirmado' where id = $1`, [id]);
  return detalleRemito(c, id);
}

export async function anularRemito(c, ctx, id, cuerpo) {
  const { valor: d } = validar({ motivo: { tipo: 'texto', min: 3, max: 200, requerido: true } }, cuerpo);
  const antes = await leer(c, id);
  if (antes.estado === 'anulado') throw new ErrorApi(422, 'no_se_puede_anular', 'Ya está anulado.');
  if (antes.estado === 'borrador') throw new ErrorApi(422, 'no_se_puede_anular', 'Un borrador no se anula: se borra.');
  const facturado = await c.uno(`select count(*)::int n from comprobante_item ci join comprobante cb on cb.id = ci.comprobante_id and cb.estado in ('confirmado', 'autorizado') where ci.documento_item_id in (select id from documento_item where documento_id = $1)`, [id]);
  if (facturado.n > 0) throw new ErrorApi(422, 'no_se_puede_anular', 'El remito ya tiene facturas cargadas: anulá primero esas facturas.');
  const movs = await c.consultar(`select m.articulo_id, m.deposito_id, sum(m.cantidad)::text as cantidad, a.nombre from movimiento_stock m join articulo a on a.id = m.articulo_id
    where m.documento_item_id in (select id from documento_item where documento_id = $1) group by m.articulo_id, m.deposito_id, a.nombre`, [id]);
  const permite = (await c.uno('select permite_stock_negativo p from empresa_parametro where empresa_id = $1', [ctx.empresaId]))?.p;
  for (const m of movs) {                                                                  // lo que entró tiene que seguir en el depósito para poder sacarlo
    const saldo = (await c.uno('select coalesce(sum(cantidad), 0)::text s from movimiento_stock where articulo_id = $1 and deposito_id = $2', [m.articulo_id, m.deposito_id])).s;
    if (!permite && dec(saldo) < dec(m.cantidad)) throw new ErrorApi(422, 'stock_insuficiente', `No se puede anular: la mercadería que ingresó con este remito (${cant(m.cantidad)} de ${m.nombre}) ya no está en el depósito (hay ${cant(saldo)}).`);
  }
  await c.consultar(`update documento_comercial set estado = 'anulado', observaciones = left(coalesce(observaciones || E'\\n', '') || 'Anulado: ' || $2, 500) where id = $1`, [id, d.motivo]);       // la base devuelve el stock
  return { remito: await detalleRemito(c, id), motivo: d.motivo, stock: movs.length };
}

export async function borrarRemito(c, ctx, id) {
  const antes = await leer(c, id);
  if (antes.estado !== 'borrador') throw new ErrorApi(422, 'no_se_puede_borrar', 'Solo se borra un borrador: un remito confirmado se anula.');
  await c.consultar('delete from documento_comercial where id = $1', [id]);
  return { ...antes, numero_formateado: numeroFormateado(antes.punto_venta, antes.numero) };
}

/* ====================== lectura ====================== */
const CAB = `select d.id, d.punto_venta, d.numero, d.numero_externo, d.fecha::text as fecha, d.estado, d.observaciones, d.tercero_id, te.razon_social as proveedor, d.documento_origen_id as orden_id,
    oc.punto_venta as oc_pv, oc.numero as oc_numero, d.creado_en,
    coalesce((select sum(round(i.cantidad * i.precio_unitario, 2)) from documento_item i where i.documento_id = d.id), 0)::text as total
  from documento_comercial d join tercero te on te.id = d.tercero_id left join documento_comercial oc on oc.id = d.documento_origen_id where d.tipo = 'remito_compra'`;
async function leer(c, id) { const f = await c.uno(`${CAB} and d.id = $1`, [id]); if (!f) throw noEncontrado('El remito'); return f; }
const dar = ({ punto_venta, numero, oc_pv, oc_numero, ...f }) => ({ ...f, numero_formateado: numeroFormateado(punto_venta, numero), orden: f.orden_id ? { id: f.orden_id, numero_formateado: numeroFormateado(oc_pv, oc_numero) } : null, total: texto(dec(f.total)) });

export async function detalleRemito(c, id) {
  const f = dar(await leer(c, id));
  const items = await c.consultar(`select i.id, i.orden, i.articulo_id, i.descripcion, i.cantidad::text as cantidad, i.precio_unitario::text as precio_unitario, round(i.cantidad * i.precio_unitario, 2)::text as importe, i.deposito_id, dp.nombre as deposito, i.item_origen_id,
      (a.controla_stock is true) as mueve_stock
    from documento_item i left join deposito dp on dp.id = i.deposito_id left join articulo a on a.id = i.articulo_id where i.documento_id = $1 order by i.orden`, [id]);
  const facturado = items.length ? await c.consultar(`select ci.documento_item_id as id, sum(ci.cantidad)::text as cantidad from comprobante_item ci join comprobante cb on cb.id = ci.comprobante_id and cb.estado in ('confirmado', 'autorizado') where ci.documento_item_id = any($1::bigint[]) group by ci.documento_item_id`, [items.map((i) => i.id)]) : [];
  const facturas = items.length ? await c.consultar(`select distinct cb.id, t.descripcion as tipo, cb.punto_venta, cb.numero from comprobante_item ci join comprobante cb on cb.id = ci.comprobante_id and cb.estado in ('confirmado', 'autorizado') join arca_tipo_comprobante t on t.codigo = cb.tipo_comprobante_codigo
    where ci.documento_item_id = any($1::bigint[]) order by cb.id`, [items.map((i) => i.id)]) : [];
  return { ...f, items: items.map((i) => ({ ...i, facturado: facturado.find((x) => x.id === i.id)?.cantidad ?? '0' })), facturas: facturas.map(({ punto_venta, numero, ...x }) => ({ ...x, numero_formateado: numeroFormateado(punto_venta, numero) })), acciones: { modificar: f.estado === 'borrador', confirmar: f.estado === 'borrador', borrar: f.estado === 'borrador', anular: f.estado === 'confirmado' } };
}

export async function listarRemitos(c, { estado, tercero_id, orden_id, q, desde, hasta, limite = 50, desplazamiento = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 100), des = Math.max(Number(desplazamiento) || 0, 0), errores = {};
  if (estado && !['borrador', 'confirmado', 'anulado'].includes(estado)) errores.estado = 'tiene que ser borrador, confirmado o anulado';
  for (const [k, v] of [['tercero_id', tercero_id], ['orden_id', orden_id]]) if (v && !/^\d{1,15}$/.test(String(v))) errores[k] = 'tiene que ser un número';
  for (const [k, v] of [['desde', desde], ['hasta', hasta]]) if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errores[k] = 'tiene que ser una fecha (aaaa-mm-dd)';
  if (Object.keys(errores).length) throw invalido(errores);
  const patron = q ? `%${String(q).replace(/[\\%_]/g, '\\$&').slice(0, 40)}%` : null;
  const filtros = `($1::text is null or d.estado = $1) and ($2::bigint is null or d.tercero_id = $2) and ($3::bigint is null or d.documento_origen_id = $3) and ($4::date is null or d.fecha >= $4) and ($5::date is null or d.fecha <= $5) and ($6::text is null or d.numero_externo ilike $6)`;
  const p = [estado || null, tercero_id ? Number(tercero_id) : null, orden_id ? Number(orden_id) : null, desde || null, hasta || null, patron];
  const filas = await c.consultar(`${CAB} and ${filtros} order by d.fecha desc, d.id desc limit ${lim} offset ${des}`, p);
  const total = (await c.uno(`select count(*)::int n from documento_comercial d where d.tipo = 'remito_compra' and ${filtros}`, p)).n;
  return { datos: filas.map(dar), total, limite: lim, desplazamiento: des };
}

/* Los renglones de remitos confirmados de un proveedor a los que todavía les falta facturar algo (para armar la factura de compra). */
export async function pendientesDeFacturar(c, { tercero_id } = {}) {
  if (!tercero_id || !/^\d{1,15}$/.test(String(tercero_id))) throw invalido({ tercero_id: 'indicá el proveedor' });
  const filas = await c.consultar(`select * from (
      select d.id as remito_id, d.punto_venta, d.numero, d.numero_externo, d.fecha::text as fecha, i.id as item_id, i.orden, i.articulo_id, i.descripcion, i.cantidad::text as llego, i.precio_unitario::text as precio,
             coalesce((select sum(ci.cantidad) from comprobante_item ci join comprobante cb on cb.id = ci.comprobante_id and cb.estado in ('confirmado', 'autorizado') where ci.documento_item_id = i.id), 0)::text as facturado
        from documento_item i join documento_comercial d on d.id = i.documento_id and d.tipo = 'remito_compra' and d.estado = 'confirmado' where d.tercero_id = $1) x
    where facturado::numeric < llego::numeric order by fecha, remito_id, orden`, [Number(tercero_id)]);
  return { datos: filas.map(({ punto_venta, numero, ...f }) => ({ ...f, remito: numeroFormateado(punto_venta, numero), facturable: texto(dec(f.llego) - dec(f.facturado), 4) })) };
}
