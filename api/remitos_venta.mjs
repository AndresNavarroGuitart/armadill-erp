// Remitos de salida: la mercadería que se entregó al cliente, sin presupuesto ni pedido por ahora. Al confirmarlo la base descuenta el stock del depósito y al anularlo lo devuelve;
// no genera cobro ni asiento: eso lo hace la factura (que toma renglones del remito y no vuelve a descontar). El precio del renglón es el acordado (el de la lista del cliente si no se indica)
// y es el que la factura propone al tomar el renglón. No se entrega más de lo que hay, salvo que la empresa permita stock negativo.
import { validar } from './validar.mjs';
import { ErrorApi, invalido, noEncontrado } from './errores.mjs';
import { numeroFormateado } from './ventas.mjs';
import { precioVigente } from './articulos.mjs';
import { dec, mul, texto } from '../reglas/calculo.mjs';
import { existenciaYReservado, textoReservado, chocaConReservas } from './reservas.mjs';
import { avisoSinCosto } from './costo_ventas.mjs';

const hoyISO = () => new Date().toISOString().slice(0, 10);
const PUNTO = 1;
const cant = (x) => texto(dec(x), 4).replace(/\.?0+$/, '');
const ESQUEMA = {
  pedido_id: { tipo: 'entero', min: 1 }, tercero_id: { tipo: 'entero', min: 1 }, fecha: { tipo: 'fecha' }, lista_id: { tipo: 'entero', min: 1 }, observaciones: { tipo: 'texto', max: 500, nulo: true }, confirmar: { tipo: 'booleano' },
  items: { tipo: 'lista', min: 1, max: 100, requerido: true, elemento: {
    item_origen_id: { tipo: 'entero', min: 1 }, articulo_id: { tipo: 'entero', min: 1 }, descripcion: { tipo: 'texto', max: 200 }, cantidad: { tipo: 'importe', min: 0.0001, max: 99999999, requerido: true },
    precio_unitario: { tipo: 'importe', min: 0, max: 999999999999 }, deposito_id: { tipo: 'entero', min: 1 },
  } },
};

async function preparar(c, ctx, cuerpo) {
  const { valor: d } = validar(ESQUEMA, cuerpo), errores = {}, avisos = [], hoy = hoyISO(), fecha = d.fecha ?? hoy;
  let pedido = null;
  if (d.pedido_id) {
    pedido = await c.uno(`select id, estado, tercero_id, fecha::text as fecha, punto_venta, numero from documento_comercial where id = $1 and tipo = 'pedido_venta'`, [d.pedido_id]);
    if (!pedido) throw invalido({ pedido_id: 'el pedido no existe' });
    if (pedido.estado !== 'confirmado') errores.pedido_id = pedido.estado === 'borrador' ? 'el pedido todavía es un borrador: hay que confirmarlo' : 'el pedido está anulado';
    if (d.tercero_id && d.tercero_id !== pedido.tercero_id) errores.tercero_id = 'no es el cliente del pedido';
  } else if (!d.tercero_id) throw invalido({ tercero_id: 'es obligatorio (o indicá el pedido)' });
  const tercero = await c.uno('select id, razon_social, es_cliente, activo, lista_precio_id from tercero where id = $1', [pedido?.tercero_id ?? d.tercero_id]);
  if (!tercero || !tercero.es_cliente) throw invalido({ tercero_id: 'el cliente no existe' });
  if (!tercero.activo) errores.tercero_id = 'el cliente está dado de baja';
  if (fecha > hoy) errores.fecha = 'la fecha del remito no puede ser futura';
  else if (fecha < `${Number(hoy.slice(0, 4)) - 3}${hoy.slice(4)}`) errores.fecha = 'la fecha del remito es de hace más de 3 años';
  else if (pedido && fecha < pedido.fecha) errores.fecha = 'el remito no puede ser anterior al pedido';

  let listaId = d.lista_id ?? tercero.lista_precio_id;
  if (!listaId) listaId = (await c.uno('select id from lista_precio order by orden, id limit 1'))?.id ?? null;
  const depositos = await c.consultar('select id from deposito where activo order by id');
  const permiteNegativo = (await c.uno('select permite_stock_negativo p from empresa_parametro where empresa_id = $1', [ctx.empresaId]))?.p;
  const origen = pedido ? await c.consultar(`select di.id, di.articulo_id, di.descripcion, di.precio_unitario::text as precio, di.deposito_id, coalesce(v.pendiente_remitir, di.cantidad) as pendiente
      from documento_item di left join v_documento_pendiente v on v.item_id = di.id where di.documento_id = $1`, [pedido.id]) : [];
  const items = [], pedidoStock = new Map(), usados = new Set(), totalArt = new Map();
  for (const [i, it] of d.items.entries()) {
    const k = `items[${i}].`;
    let o = null;
    if (pedido) {
      if (!it.item_origen_id) { errores[k + 'item_origen_id'] = 'indicá qué renglón del pedido se entrega'; continue; }
      o = origen.find((x) => x.id === it.item_origen_id);
      if (!o) { errores[k + 'item_origen_id'] = 'el renglón no es de ese pedido'; continue; }
      if (usados.has(o.id)) { errores[k + 'item_origen_id'] = 'ese renglón está repetido'; continue; }
      usados.add(o.id);
      if (dec(it.cantidad) > dec(o.pendiente)) { errores[k + 'cantidad'] = dec(o.pendiente) <= 0n ? 'ese renglón ya se entregó completo' : `solo falta entregar ${cant(o.pendiente)}`; continue; }
    } else if (it.item_origen_id) { errores[k + 'item_origen_id'] = 'sin pedido no hay renglón de origen'; continue; }
    const articuloId = o ? o.articulo_id : it.articulo_id;
    if (!articuloId) { errores[k + 'articulo_id'] = 'indicá el artículo'; continue; }
    const a = await c.uno('select id, nombre, tipo, activo, controla_stock from articulo where id = $1', [articuloId]);
    if (!a) { errores[k + 'articulo_id'] = 'el artículo no existe'; continue; }
    if (!a.activo) { errores[k + 'articulo_id'] = 'el artículo está dado de baja'; continue; }
    if (a.tipo === 'gasto') { errores[k + 'articulo_id'] = 'un artículo de tipo gasto no se entrega'; continue; }
    let depositoId = it.deposito_id ?? o?.deposito_id ?? null;
    if (depositoId && !depositos.some((x) => x.id === depositoId)) { errores[k + 'deposito_id'] = 'el depósito no existe o está dado de baja'; continue; }
    if (!depositoId && a.controla_stock) { if (depositos.length === 1) depositoId = depositos[0].id; else { errores[k + 'deposito_id'] = 'indicá de qué depósito sale la mercadería'; continue; } }
    if (a.controla_stock && !permiteNegativo) {                                          // lo que ya se pidió en otros renglones del mismo remito también cuenta
      const clave = `${a.id}/${depositoId}`, antes = pedidoStock.get(clave) ?? 0n, hay = (await c.uno('select coalesce(sum(cantidad), 0)::text s from movimiento_stock where articulo_id = $1 and deposito_id = $2', [a.id, depositoId])).s;
      pedidoStock.set(clave, antes + dec(it.cantidad));
      if (dec(hay) < antes + dec(it.cantidad)) { errores[k + 'cantidad'] = `no hay tanta mercadería en el depósito (hay ${cant(hay)} de ${a.nombre})`; continue; }
      if (!o) {                                                                          // una entrega sin pedido no puede tomar lo que otros pedidos tienen reservado
        const acum = (totalArt.get(a.id) ?? 0n) + dec(it.cantidad); totalArt.set(a.id, acum);
        const est = await existenciaYReservado(c, a.id);
        if (est.reservado > 0n && est.existencia - est.reservado < acum) { errores[k + 'cantidad'] = textoReservado(a.nombre, est); continue; }
      }
    }
    const precio = it.precio_unitario ?? (o && dec(o.precio) > 0n ? o.precio : null) ?? (listaId ? await precioVigente(c, a.id, listaId, fecha) : null) ?? '0';
    items.push({ origenId: o?.id ?? null, articuloId: a.id, descripcion: o ? o.descripcion : it.descripcion ?? a.nombre, cantidad: it.cantidad, precio: texto(dec(precio), 4), depositoId, controlaStock: !!a.controla_stock, importe: texto(mul(dec(it.cantidad), dec(precio))) });
  }
  if (Object.keys(errores).length) throw invalido(errores);
  if (!items.some((x) => x.controlaStock)) avisos.push('Ningún renglón lleva control de stock: el remito no mueve existencias.');
  if (pedido) { const faltan = origen.filter((x) => !usados.has(x.id) && dec(x.pendiente) > 0n).length; if (faltan) avisos.push(`Quedan ${faltan} renglón${faltan === 1 ? '' : 'es'} del pedido sin entregar en este remito.`); }
  if (items.some((x) => dec(x.precio) === 0n)) avisos.push('Hay renglones sin precio: la factura te va a pedir indicarlo.');
  const sinCosto = await avisoSinCosto(c, ctx, items.filter((x) => x.controlaStock).map((x) => x.articuloId));
  if (sinCosto) avisos.push(sinCosto);
  return { d, tercero, pedido, fecha, items, avisos, total: texto(items.reduce((s, x) => s + dec(x.importe), 0n)) };
}

export async function calcularRemitoVenta(c, ctx, cuerpo) {
  const p = await preparar(c, ctx, cuerpo);
  return { cliente: { id: p.tercero.id, razon_social: p.tercero.razon_social }, fecha: p.fecha, items: p.items.map((x) => ({ descripcion: x.descripcion, cantidad: x.cantidad, precio_unitario: x.precio, importe: x.importe, mueve_stock: x.controlaStock })), total: p.total, avisos: p.avisos };
}

async function insertarItems(c, ctx, id, items) {
  for (const [i, x] of items.entries()) await c.consultar('insert into documento_item (empresa_id, documento_id, orden, articulo_id, descripcion, cantidad, precio_unitario, deposito_id, item_origen_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [ctx.empresaId, id, i + 1, x.articuloId, x.descripcion, x.cantidad, x.precio, x.depositoId, x.origenId]);
}

export async function crearRemitoVenta(c, ctx, cuerpo) {
  const p = await preparar(c, ctx, cuerpo);
  const cab = await c.uno(`insert into documento_comercial (empresa_id, tipo, punto_venta, fecha, tercero_id, documento_origen_id, observaciones, creado_por) values ($1,'remito_venta',$2,$3,$4,$5,$6,$7) returning id`,
    [ctx.empresaId, PUNTO, p.fecha, p.tercero.id, p.pedido?.id ?? null, p.d.observaciones ?? null, ctx.usuarioId]);
  await insertarItems(c, ctx, cab.id, p.items);
  if (p.d.confirmar) await c.consultar(`update documento_comercial set estado = 'confirmado' where id = $1`, [cab.id]);          // la base verifica y descuenta el stock
  return { remito: await detalleRemitoVenta(c, cab.id), avisos: p.avisos };
}

export async function modificarRemitoVenta(c, ctx, id, cuerpo) {
  const antes = await leer(c, id);
  if (antes.estado !== 'borrador') throw new ErrorApi(422, 'no_se_modifica', `El remito está ${antes.estado}: no se modifica. Anulalo y cargá otro.`);
  const p = await preparar(c, ctx, cuerpo);
  await c.consultar('update documento_comercial set fecha = $2, tercero_id = $3, documento_origen_id = $4, observaciones = $5 where id = $1', [id, p.fecha, p.tercero.id, p.pedido?.id ?? null, p.d.observaciones ?? null]);
  await c.consultar('delete from documento_item where documento_id = $1', [id]);
  await insertarItems(c, ctx, id, p.items);
  if (p.d.confirmar) await c.consultar(`update documento_comercial set estado = 'confirmado' where id = $1`, [id]);
  return { remito: await detalleRemitoVenta(c, id), avisos: p.avisos };
}

export async function confirmarRemitoVenta(c, ctx, id) {
  const antes = await leer(c, id);
  if (antes.estado !== 'borrador') throw new ErrorApi(422, 'no_se_puede_confirmar', antes.estado === 'confirmado' ? 'El remito ya está confirmado.' : `Un remito ${antes.estado} no se confirma.`);
  const permite = (await c.uno('select permite_stock_negativo p from empresa_parametro where empresa_id = $1', [ctx.empresaId]))?.p;
  if (!permite) {
    const filas = await c.consultar(`select a.nombre, sum(i.cantidad)::text as pide, coalesce((select sum(m.cantidad) from movimiento_stock m where m.articulo_id = i.articulo_id and m.deposito_id = i.deposito_id), 0)::text as hay
      from documento_item i join articulo a on a.id = i.articulo_id and a.controla_stock where i.documento_id = $1 group by a.nombre, i.articulo_id, i.deposito_id`, [id]);
    const f = filas.find((x) => dec(x.hay) < dec(x.pide));
    if (f) throw new ErrorApi(422, 'stock_insuficiente', `Stock insuficiente de ${f.nombre}: hay ${cant(f.hay)} y se entregan ${cant(f.pide)}.`);
  }
  const sinPedido = !(await c.uno('select documento_origen_id from documento_comercial where id = $1', [id])).documento_origen_id;
  if (!permite && sinPedido) {                                                          // un borrador sin pedido tampoco puede dejar sin mercadería a los pedidos que la tienen reservada
    const pedidas = new Map();
    for (const r of await c.consultar(`select i.articulo_id, a.nombre, sum(i.cantidad)::text as cant from documento_item i join articulo a on a.id = i.articulo_id and a.controla_stock where i.documento_id = $1 group by i.articulo_id, a.nombre`, [id])) pedidas.set(r.articulo_id, { cantidad: dec(r.cant), nombre: r.nombre });
    const choque = await chocaConReservas(c, pedidas);
    if (choque) throw new ErrorApi(422, 'stock_reservado', `No se puede entregar: ${textoReservado(choque.nombre, choque.estado)}.`);
  }
  await c.consultar(`update documento_comercial set estado = 'confirmado' where id = $1`, [id]);
  return detalleRemitoVenta(c, id);
}

export async function anularRemitoVenta(c, ctx, id, cuerpo) {
  const { valor: d } = validar({ motivo: { tipo: 'texto', min: 3, max: 200, requerido: true } }, cuerpo);
  const antes = await leer(c, id);
  if (antes.estado === 'anulado') throw new ErrorApi(422, 'no_se_puede_anular', 'Ya está anulado.');
  if (antes.estado === 'borrador') throw new ErrorApi(422, 'no_se_puede_anular', 'Un borrador no se anula: se borra.');
  const facturado = await c.uno(`select count(*)::int n from comprobante_item ci join comprobante cb on cb.id = ci.comprobante_id and cb.estado in ('confirmado', 'autorizado') where ci.documento_item_id in (select id from documento_item where documento_id = $1)`, [id]);
  if (facturado.n > 0) throw new ErrorApi(422, 'no_se_puede_anular', 'El remito ya tiene facturas emitidas: anulá primero esas facturas.');
  const movs = (await c.uno(`select count(*)::int n from movimiento_stock where documento_item_id in (select id from documento_item where documento_id = $1)`, [id])).n;
  await c.consultar(`update documento_comercial set estado = 'anulado', observaciones = left(coalesce(observaciones || E'\\n', '') || 'Anulado: ' || $2, 500) where id = $1`, [id, d.motivo]);       // la base devuelve la mercadería al depósito
  return { remito: await detalleRemitoVenta(c, id), motivo: d.motivo, stock: movs };
}

export async function borrarRemitoVenta(c, ctx, id) {
  const antes = await leer(c, id);
  if (antes.estado !== 'borrador') throw new ErrorApi(422, 'no_se_puede_borrar', 'Solo se borra un borrador: un remito confirmado se anula.');
  await c.consultar('delete from documento_comercial where id = $1', [id]);
  return { ...antes, numero_formateado: numeroFormateado(antes.punto_venta, antes.numero) };
}

/* ====================== lectura ====================== */
const CAB = `select d.id, d.punto_venta, d.numero, d.fecha::text as fecha, d.estado, d.observaciones, d.tercero_id, te.razon_social as cliente, d.documento_origen_id as pedido_id, pe.punto_venta as pe_pv, pe.numero as pe_numero, d.creado_en,
    coalesce((select sum(round(i.cantidad * i.precio_unitario, 2)) from documento_item i where i.documento_id = d.id), 0)::text as total
  from documento_comercial d join tercero te on te.id = d.tercero_id left join documento_comercial pe on pe.id = d.documento_origen_id where d.tipo = 'remito_venta'`;
async function leer(c, id) { const f = await c.uno(`${CAB} and d.id = $1`, [id]); if (!f) throw noEncontrado('El remito'); return f; }
const dar = ({ punto_venta, numero, pe_pv, pe_numero, ...f }) => ({ ...f, numero_formateado: numeroFormateado(punto_venta, numero), pedido: f.pedido_id ? { id: f.pedido_id, numero_formateado: numeroFormateado(pe_pv, pe_numero) } : null, total: texto(dec(f.total)) });

export async function detalleRemitoVenta(c, id) {
  const f = dar(await leer(c, id));
  const items = await c.consultar(`select i.id, i.orden, i.articulo_id, i.descripcion, i.cantidad::text as cantidad, i.precio_unitario::text as precio_unitario, round(i.cantidad * i.precio_unitario, 2)::text as importe, i.deposito_id, dp.nombre as deposito, i.item_origen_id,
      (a.controla_stock is true) as mueve_stock
    from documento_item i left join deposito dp on dp.id = i.deposito_id left join articulo a on a.id = i.articulo_id where i.documento_id = $1 order by i.orden`, [id]);
  const facturado = items.length ? await c.consultar(`select ci.documento_item_id as id, sum(ci.cantidad)::text as cantidad from comprobante_item ci join comprobante cb on cb.id = ci.comprobante_id and cb.estado in ('confirmado', 'autorizado') where ci.documento_item_id = any($1::bigint[]) group by ci.documento_item_id`, [items.map((i) => i.id)]) : [];
  const facturas = items.length ? await c.consultar(`select distinct cb.id, t.descripcion as tipo, cb.punto_venta, cb.numero from comprobante_item ci join comprobante cb on cb.id = ci.comprobante_id and cb.estado in ('confirmado', 'autorizado') join arca_tipo_comprobante t on t.codigo = cb.tipo_comprobante_codigo
    where ci.documento_item_id = any($1::bigint[]) order by cb.id`, [items.map((i) => i.id)]) : [];
  const costo = await c.consultar(`select a.id, a.numero, a.fecha::text as fecha, a.descripcion, (select coalesce(sum(l.debe), 0)::text from asiento_linea l where l.asiento_id = a.id) as importe from asiento a where a.origen_tipo = 'costo_remito' and a.origen_id = $1 order by a.id`, [id]);
  return { ...f, asientos_costo: costo.map((x) => ({ ...x, importe: texto(dec(x.importe)) })), items: items.map((i) => ({ ...i, facturado: facturado.find((x) => x.id === i.id)?.cantidad ?? '0' })), facturas: facturas.map(({ punto_venta, numero, ...x }) => ({ ...x, numero_formateado: numeroFormateado(punto_venta, numero) })), acciones: { modificar: f.estado === 'borrador', confirmar: f.estado === 'borrador', borrar: f.estado === 'borrador', anular: f.estado === 'confirmado' } };
}

export async function listarRemitosVenta(c, { estado, tercero_id, pedido_id, desde, hasta, limite = 50, desplazamiento = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 100), des = Math.max(Number(desplazamiento) || 0, 0), errores = {};
  if (estado && !['borrador', 'confirmado', 'anulado'].includes(estado)) errores.estado = 'tiene que ser borrador, confirmado o anulado';
  for (const [k, v] of [['tercero_id', tercero_id], ['pedido_id', pedido_id]]) if (v && !/^\d{1,15}$/.test(String(v))) errores[k] = 'tiene que ser un número';
  for (const [k, v] of [['desde', desde], ['hasta', hasta]]) if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errores[k] = 'tiene que ser una fecha (aaaa-mm-dd)';
  if (Object.keys(errores).length) throw invalido(errores);
  const filtros = `($1::text is null or d.estado = $1) and ($2::bigint is null or d.tercero_id = $2) and ($3::date is null or d.fecha >= $3) and ($4::date is null or d.fecha <= $4) and ($5::bigint is null or d.documento_origen_id = $5)`;
  const p = [estado || null, tercero_id ? Number(tercero_id) : null, desde || null, hasta || null, pedido_id ? Number(pedido_id) : null];
  const filas = await c.consultar(`${CAB} and ${filtros} order by d.fecha desc, d.id desc limit ${lim} offset ${des}`, p);
  const total = (await c.uno(`select count(*)::int n from documento_comercial d where d.tipo = 'remito_venta' and ${filtros}`, p)).n;
  return { datos: filas.map(dar), total, limite: lim, desplazamiento: des };
}

/* Los renglones de remitos confirmados de un cliente a los que todavía les falta facturar algo (para armar la factura de venta). */
export async function pendientesDeFacturarVenta(c, { tercero_id } = {}) {
  if (!tercero_id || !/^\d{1,15}$/.test(String(tercero_id))) throw invalido({ tercero_id: 'indicá el cliente' });
  const filas = await c.consultar(`select * from (
      select d.id as remito_id, d.punto_venta, d.numero, d.fecha::text as fecha, i.id as item_id, i.orden, i.articulo_id, i.descripcion, i.cantidad::text as entregado, i.precio_unitario::text as precio,
             coalesce((select sum(ci.cantidad) from comprobante_item ci join comprobante cb on cb.id = ci.comprobante_id and cb.estado in ('confirmado', 'autorizado') where ci.documento_item_id = i.id), 0)::text as facturado
        from documento_item i join documento_comercial d on d.id = i.documento_id and d.tipo = 'remito_venta' and d.estado = 'confirmado' where d.tercero_id = $1) x
    where facturado::numeric < entregado::numeric order by fecha, remito_id, orden`, [Number(tercero_id)]);
  return { datos: filas.map(({ punto_venta, numero, ...f }) => ({ ...f, remito: numeroFormateado(punto_venta, numero), facturable: texto(dec(f.entregado) - dec(f.facturado), 4) })) };
}
