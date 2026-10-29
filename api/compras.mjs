// Facturas de compra: se cargan los datos de la factura del proveedor (su letra, punto de venta y número) con sus renglones; el sistema calcula,
// compara con el TOTAL que dice el papel (si no coincide, no se carga), registra el asiento, ingresa la mercadería al depósito y actualiza el costo.
//   - Factura A (y M) a una empresa responsable inscripta: el IVA se discrimina y va al crédito fiscal.
//   - B, C (y A/M recibidas por una empresa que no es responsable inscripta): no hay crédito fiscal, el IVA es parte del costo: todo va como "no gravado".
//   - El número del proveedor no se repite (lo impone la base): cargar dos veces la misma factura da un error claro.
import { validar } from './validar.mjs';
import { ErrorApi, invalido } from './errores.mjs';
import { calcularVenta, CODIGO_ALICUOTA } from './calculo_venta.mjs';
import { numeroFormateado, listarComprobantes } from './ventas.mjs';
import { detalleComprobante } from './anulaciones.mjs';
import { dec, mul, redondear, texto } from '../reglas/calculo.mjs';

const hoyISO = () => new Date().toISOString().slice(0, 10);
const TIPO = { A: 1, B: 6, C: 11, M: 51 };
const PCT_DE_CODIGO = Object.fromEntries(Object.entries(CODIGO_ALICUOTA).map(([pct, cod]) => [cod, pct]));
const ALICUOTAS = Object.keys(CODIGO_ALICUOTA);
const TRIBUTOS = ['percepcion_iva', 'percepcion_iibb', 'percepcion_ganancias', 'percepcion_suss', 'impuesto_interno', 'impuesto_municipal', 'otro'];
const TOLERANCIA = dec('0.01');
const SALTO_DE_COSTO = 0.15;                                   // el prototipo avisaba cuando el costo se aparta más de 15 % del último

const ESQUEMA = {
  tercero_id: { tipo: 'entero', min: 1, requerido: true },
  letra: { tipo: 'enum', valores: Object.keys(TIPO), requerido: true },
  punto_venta: { tipo: 'entero', min: 1, max: 99999, requerido: true },
  numero: { tipo: 'entero', min: 1, max: 99999999, requerido: true },
  fecha: { tipo: 'fecha', requerido: true }, fecha_vto_pago: { tipo: 'fecha' }, observaciones: { tipo: 'texto', max: 500 },
  total: { tipo: 'importe', min: 0, max: 999999999999, requerido: true },
  items: { tipo: 'lista', min: 1, max: 100, requerido: true, elemento: {
    articulo_id: { tipo: 'entero', min: 1 }, descripcion: { tipo: 'texto', max: 200 }, cantidad: { tipo: 'importe', min: 0.0001, max: 99999999, requerido: true },
    precio_unitario: { tipo: 'importe', min: 0, max: 999999999999, requerido: true }, desc_pct: { tipo: 'porcentaje' },
    tratamiento: { tipo: 'enum', valores: ['gravado', 'exento', 'no_gravado'] }, alicuota: { tipo: 'enum', valores: ALICUOTAS },
    cuenta_id: { tipo: 'entero', min: 1 }, deposito_id: { tipo: 'entero', min: 1 },
  } },
  tributos: { tipo: 'lista', max: 20, elemento: {
    tipo: { tipo: 'enum', valores: TRIBUTOS, requerido: true }, jurisdiccion_codigo: { tipo: 'entero', min: 1, max: 32767 }, descripcion: { tipo: 'texto', max: 100 }, importe: { tipo: 'importe', min: 0.01, max: 999999999999, requerido: true },
  } },
};

/* Todo lo que se decide ANTES de escribir. `exigirTotal` es false en el cálculo previo: ahí se muestra la diferencia en vez de fallar. */
export async function prepararCompra(c, ctx, cuerpo, { exigirTotal }) {
  const { valor: d } = validar(ESQUEMA, cuerpo);
  const errores = {}, avisos = [], hoy = hoyISO();
  const tercero = await c.uno('select id, razon_social, tipo_documento_codigo, condicion_pago_dias, es_proveedor, activo from tercero where id = $1', [d.tercero_id]);
  if (!tercero || !tercero.es_proveedor) throw invalido({ tercero_id: 'el proveedor no existe' });
  if (!tercero.activo) errores.tercero_id = 'el proveedor está dado de baja';
  const emisor = ctx.empresa.condicionIvaCodigo, discrimina = ['A', 'M'].includes(d.letra) && emisor === 1;
  if (['A', 'M'].includes(d.letra) && Number(tercero.tipo_documento_codigo) !== 80) errores.tercero_id = `una factura ${d.letra} necesita que el proveedor tenga CUIT`;
  if (!discrimina) avisos.push(['A', 'M'].includes(d.letra) ? 'Esta empresa no es responsable inscripta: el IVA no se toma como crédito fiscal, forma parte del costo.' : `En una factura ${d.letra} el IVA no se discrimina: el importe completo va al costo, sin crédito fiscal.`);

  if (d.fecha > hoy) errores.fecha = 'la fecha de la factura no puede ser futura';
  else if (d.fecha < `${Number(hoy.slice(0, 4)) - 3}${hoy.slice(4)}`) errores.fecha = 'la fecha de la factura es de hace más de 3 años';
  else {
    const periodo = (await c.uno('select fn_periodo_aceptado($1, $2) p', [ctx.empresaId, d.fecha])).p;
    if (periodo !== 'ok') errores.fecha = { sin_periodo: 'no hay un período contable abierto para esa fecha', cerrado: 'el período de esa fecha está cerrado', vencido: 'el período de esa fecha ya venció' }[periodo];
  }
  if (d.fecha_vto_pago && d.fecha_vto_pago < d.fecha) errores.fecha_vto_pago = 'no puede ser anterior a la fecha de la factura';

  const depositos = await c.consultar('select id from deposito where activo order by id');
  const items = [];
  for (const [i, it] of d.items.entries()) {
    const a = it.articulo_id ? await c.uno('select id, codigo, nombre, tipo, activo, controla_stock, tratamiento_iva_compra, alicuota_compra_codigo from articulo where id = $1', [it.articulo_id]) : null;
    if (it.articulo_id && !a) { errores[`items[${i}].articulo_id`] = 'el artículo no existe'; continue; }
    if (a && !a.activo) { errores[`items[${i}].articulo_id`] = 'el artículo está dado de baja'; continue; }
    const descripcion = it.descripcion ?? a?.nombre;
    if (!descripcion) { errores[`items[${i}].descripcion`] = 'indicá un artículo o una descripción'; continue; }
    let tratamiento = 'no_gravado', alicuota;
    if (discrimina) {
      tratamiento = it.tratamiento ?? a?.tratamiento_iva_compra ?? 'gravado';
      if (tratamiento === 'gravado') alicuota = it.alicuota ?? (a?.alicuota_compra_codigo != null ? PCT_DE_CODIGO[a.alicuota_compra_codigo] : undefined) ?? '21';
      else if (it.alicuota) errores[`items[${i}].alicuota`] = `un renglón ${tratamiento === 'exento' ? 'exento' : 'no gravado'} no lleva alícuota`;
    }
    if (it.cuenta_id && !(await c.uno('select 1 x from plan_cuenta where id = $1 and imputable and activa', [it.cuenta_id]))) errores[`items[${i}].cuenta_id`] = 'la cuenta no existe o no es imputable';
    const ingresaStock = !!a?.controla_stock;
    let depositoId = null;
    if (ingresaStock) {
      depositoId = it.deposito_id ?? (depositos.length === 1 ? depositos[0].id : null);
      if (!depositoId) errores[`items[${i}].deposito_id`] = 'indicá en qué depósito entra la mercadería';
      else if (!depositos.some((x) => x.id === depositoId)) errores[`items[${i}].deposito_id`] = 'el depósito no existe o está dado de baja';
    }
    items.push({ articulo: a, articuloId: a?.id ?? null, descripcion, cantidad: it.cantidad, precio: it.precio_unitario, descPct: it.desc_pct ?? '0', tratamiento, alicuota, cuentaId: it.cuenta_id ?? null, depositoId, ingresaStock });
  }

  const tributos = [];
  for (const [i, t] of (d.tributos ?? []).entries()) {
    if (t.tipo === 'percepcion_iibb' && !t.jurisdiccion_codigo) errores[`tributos[${i}].jurisdiccion_codigo`] = 'una percepción de ingresos brutos necesita su jurisdicción';
    else if (t.jurisdiccion_codigo && !(await c.uno('select 1 x from arca_jurisdiccion where codigo = $1', [t.jurisdiccion_codigo]))) errores[`tributos[${i}].jurisdiccion_codigo`] = 'la jurisdicción no existe';
    tributos.push(t);
  }
  if (Object.keys(errores).length) throw invalido(errores);

  const calculo = calcularVenta(items.map((x) => ({ cantidad: x.cantidad, precio: x.precio, descPct: x.descPct, tratamiento: x.tratamiento, alicuota: x.alicuota })), { descPiePct: '0' });
  const impTrib = tributos.reduce((s, t) => s + dec(t.importe), 0n), totalCalculado = dec(calculo.impTotal) + impTrib, informado = dec(d.total);
  const diferencia = informado - totalCalculado, coincide = (diferencia < 0n ? -diferencia : diferencia) <= TOLERANCIA;
  if (!coincide && exigirTotal) throw invalido({ total: `el total calculado es $ ${texto(totalCalculado)} y la factura dice $ ${d.total}: revisá los precios, cantidades, alícuotas o percepciones` });
  if (!coincide) avisos.push(`El total calculado ($ ${texto(totalCalculado)}) no coincide con el de la factura ($ ${d.total}): diferencia de $ ${texto(diferencia)}.`);

  // Costo: se avisa si se aparta mucho del último costo conocido.
  for (const x of items.filter((y) => y.articuloId && y.articulo.tipo !== 'gasto')) {
    const ultimo = (await c.uno('select costo::text k from articulo_costo where articulo_id = $1 order by fecha desc, id desc limit 1', [x.articuloId]))?.k;
    x.costoNuevo = texto(redondear(mul(dec(x.precio), dec('1') - mul(dec(x.descPct), dec('0.01'))), 4), 4);
    if (ultimo && Number(ultimo) > 0 && Math.abs(Number(x.costoNuevo) / Number(ultimo) - 1) > SALTO_DE_COSTO) avisos.push(`El costo de ${x.descripcion} cambia ${Math.round((Number(x.costoNuevo) / Number(ultimo) - 1) * 100)} % respecto del último ($ ${Number(ultimo)} → $ ${Number(x.costoNuevo)}).`);
  }
  const vto = d.fecha_vto_pago ?? (tercero.condicion_pago_dias > 0 ? new Date(new Date(d.fecha + 'T12:00:00Z').getTime() + tercero.condicion_pago_dias * 864e5).toISOString().slice(0, 10) : null);
  return { d, tercero, discrimina, items, tributos, calculo, impTrib: texto(impTrib), totalCalculado: texto(totalCalculado), diferencia: texto(diferencia), coincide, avisos, tipoCodigo: TIPO[d.letra], vto };
}

export async function calcularCompra(c, ctx, cuerpo) {
  const p = await prepararCompra(c, ctx, cuerpo, { exigirTotal: false }), k = p.calculo;
  return {
    letra: p.d.letra, tipo_comprobante_codigo: p.tipoCodigo, proveedor: { id: p.tercero.id, razon_social: p.tercero.razon_social }, fecha: p.d.fecha, discrimina_iva: p.discrimina,
    items: p.items.map((x, i) => ({ descripcion: x.descripcion, cantidad: x.cantidad, precio_unitario: x.precio, tratamiento: x.tratamiento, alicuota: x.alicuota ?? null, importe_renglon: k.items[i].importeRenglon, ingresa_stock: x.ingresaStock })),
    ivas: k.ivas.map((v) => ({ alicuota: v.alicuota, base_imponible: v.base, importe_iva: v.iva })), imp_neto: k.impNeto, imp_iva: k.impIva, imp_tot_conc: k.impTotConc, imp_op_ex: k.impOpEx, imp_trib: p.impTrib,
    total_calculado: p.totalCalculado, total_informado: p.d.total, diferencia: p.diferencia, coincide: p.coincide, avisos: p.avisos,
  };
}

export async function cargarCompra(c, ctx, cuerpo) {
  const p = await prepararCompra(c, ctx, cuerpo, { exigirTotal: true }), k = p.calculo, d = p.d;
  if (await c.uno('select 1 x from comprobante where sentido = $1 and tercero_id = $2 and tipo_comprobante_codigo = $3 and punto_venta = $4 and numero = $5', ['compra', p.tercero.id, p.tipoCodigo, d.punto_venta, d.numero]))
    throw new ErrorApi(409, 'duplicado', `Ya está cargada la factura ${d.letra} ${numeroFormateado(d.punto_venta, d.numero)} de ${p.tercero.razon_social} (aunque esté anulada, su número no se vuelve a usar).`);
  const total = texto(dec(k.impTotal) + dec(p.impTrib));
  const cab = await c.uno(`insert into comprobante (empresa_id, sentido, tipo_comprobante_codigo, punto_venta, numero, fecha, tercero_id, concepto_codigo, fecha_vto_pago, moneda, cotizacion, precios_incluyen_iva,
      desc_pie_pct, imp_desc_pie, imp_neto, imp_iva, imp_tot_conc, imp_op_ex, imp_trib, imp_total, observaciones, creado_por)
    values ($1,'compra',$2,$3,$4,$5,$6,1,$7,'PES',1,false,0,0,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
    [ctx.empresaId, p.tipoCodigo, d.punto_venta, d.numero, d.fecha, p.tercero.id, p.vto, k.impNeto, k.impIva, k.impTotConc, k.impOpEx, p.impTrib, total, d.observaciones ?? null, ctx.usuarioId]);
  const idsItems = [];
  for (const [i, x] of p.items.entries()) {
    const r = await c.uno(`insert into comprobante_item (empresa_id, comprobante_id, orden, articulo_id, descripcion, cantidad, precio_unitario, desc_pct, tratamiento_iva, alicuota_codigo, importe_renglon, cuenta_id, deposito_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [ctx.empresaId, cab.id, i + 1, x.articuloId, x.descripcion, x.cantidad, x.precio, texto(mul(dec(x.descPct), dec('0.01')), 4), x.tratamiento, x.tratamiento === 'gravado' ? CODIGO_ALICUOTA[x.alicuota] : null, k.items[i].importeRenglon, x.cuentaId, x.depositoId]);
    idsItems.push(r.id);
  }
  for (const v of k.ivas) await c.consultar('insert into comprobante_iva (empresa_id, comprobante_id, alicuota_codigo, base_imponible, importe_iva) values ($1,$2,$3,$4,$5)', [ctx.empresaId, cab.id, v.codigo, v.base, v.iva]);
  for (const t of p.tributos) await c.consultar('insert into comprobante_tributo (empresa_id, comprobante_id, tipo, jurisdiccion_codigo, descripcion, importe) values ($1,$2,$3,$4,$5,$6)', [ctx.empresaId, cab.id, t.tipo, t.jurisdiccion_codigo ?? null, t.descripcion ?? null, t.importe]);
  await c.consultar(`update comprobante set estado = 'confirmado' where id = $1`, [cab.id]);          // la base verifica los importes, el período y el proveedor, y genera el asiento
  for (const [i, x] of p.items.entries()) {
    if (x.ingresaStock) await c.consultar(`insert into movimiento_stock (empresa_id, fecha, articulo_id, deposito_id, cantidad, tipo, comprobante_item_id, costo_unitario) values ($1,$2,$3,$4,$5,'compra',$6,$7)`, [ctx.empresaId, d.fecha, x.articuloId, x.depositoId, x.cantidad, idsItems[i], x.costoNuevo]);
    if (x.costoNuevo) await c.consultar(`insert into articulo_costo (empresa_id, articulo_id, fecha, costo, origen, comprobante_id) values ($1,$2,$3,$4,'compra',$5)`, [ctx.empresaId, x.articuloId, d.fecha, x.costoNuevo, cab.id]);
  }
  const cbte = await detalleComprobante(c, cab.id);
  await c.consultar(`select fn_registrar_evento('comprobantes', $1, $2, 'ok', $3, 'comprobante', $4)`,
    [`Cargó Factura ${d.letra} ${numeroFormateado(d.punto_venta, d.numero)} de ${p.tercero.razon_social}`, `$ ${cbte.imp_total}${p.items.some((x) => x.ingresaStock) ? ' · ingresó mercadería al stock' : ''}`, ctx.empresaId, cab.id]);
  return { comprobante: cbte, avisos: p.avisos };
}

export const listarCompras = (c, q) => listarComprobantes(c, { ...q, sentido: 'compra' });

export async function listarJurisdicciones(c) { return { datos: await c.consultar('select codigo, nombre from arca_jurisdiccion order by nombre') }; }

/* Cuentas imputables para clasificar un gasto en un renglón sin artículo. */
export async function listarCuentas(c, { q, limite = 50 } = {}) {
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 200), patron = q ? `%${String(q).replace(/[\\%_]/g, '\\$&').slice(0, 60)}%` : null;
  return { datos: await c.consultar(`select id, codigo, nombre, tipo from plan_cuenta where imputable and activa and ($1::text is null or nombre ilike $1 or codigo ilike $1) order by codigo limit ${lim}`, [patron]) };
}
