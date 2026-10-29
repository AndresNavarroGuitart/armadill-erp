// Notas de crédito y de débito de proveedores: se cargan igual que una factura (letra, número del proveedor, renglones, total del papel). La de crédito acredita
// una factura (o una nota de débito) del mismo proveedor y letra (si el proveedor la manda sin factura, como una bonificación, queda a favor), se aplica a su saldo (lo que sobra queda a favor y se puede aplicar a otra después) y, si se
// pide, devuelve mercadería al proveedor (sale del depósito); la de débito es una deuda más, que se paga en una orden de pago. No tocan el costo del artículo.
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
const TIPOS = { factura: TIPO, nota_credito: { A: 3, B: 8, C: 13, M: 53 }, nota_debito: { A: 2, B: 7, C: 12, M: 52 } };
const NOMBRE = { factura: { de: 'la factura', una: 'una factura', etiqueta: 'Factura' }, nota_credito: { de: 'la nota de crédito', una: 'una nota de crédito', etiqueta: 'Nota de crédito' }, nota_debito: { de: 'la nota de débito', una: 'una nota de débito', etiqueta: 'Nota de débito' } };
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

/** La nota de crédito exige la factura que acredita y puede devolver mercadería renglón por renglón. */
const esquemaDe = (clase) => (clase === 'nota_credito'
  ? { ...ESQUEMA, comprobante_origen_id: { tipo: 'entero', min: 1 }, items: { ...ESQUEMA.items, elemento: { ...ESQUEMA.items.elemento, devuelve_stock: { tipo: 'booleano' } } } }
  : ESQUEMA);

/* Todo lo que se decide ANTES de escribir. `exigirTotal` es false en el cálculo previo: ahí se muestra la diferencia en vez de fallar. */
export async function prepararCompra(c, ctx, cuerpo, { exigirTotal, clase = 'factura' }) {
  const { valor: d } = validar(esquemaDe(clase), cuerpo);
  const errores = {}, avisos = [], hoy = hoyISO();
  const tercero = await c.uno('select id, razon_social, tipo_documento_codigo, condicion_pago_dias, es_proveedor, activo from tercero where id = $1', [d.tercero_id]);
  if (!tercero || !tercero.es_proveedor) throw invalido({ tercero_id: 'el proveedor no existe' });
  if (!tercero.activo) errores.tercero_id = 'el proveedor está dado de baja';
  const emisor = ctx.empresa.condicionIvaCodigo, discrimina = ['A', 'M'].includes(d.letra) && emisor === 1;
  if (['A', 'M'].includes(d.letra) && Number(tercero.tipo_documento_codigo) !== 80) errores.tercero_id = `${NOMBRE[clase].una} ${d.letra} necesita que el proveedor tenga CUIT`;
  if (!discrimina) avisos.push(['A', 'M'].includes(d.letra) ? 'Esta empresa no es responsable inscripta: el IVA no se toma como crédito fiscal, forma parte del costo.' : `En ${NOMBRE[clase].una} ${d.letra} el IVA no se discrimina: el importe completo va al costo, sin crédito fiscal.`);

  if (d.fecha > hoy) errores.fecha = `la fecha de ${NOMBRE[clase].de} no puede ser futura`;
  else if (d.fecha < `${Number(hoy.slice(0, 4)) - 3}${hoy.slice(4)}`) errores.fecha = `la fecha de ${NOMBRE[clase].de} es de hace más de 3 años`;
  else {
    const periodo = (await c.uno('select fn_periodo_aceptado($1, $2) p', [ctx.empresaId, d.fecha])).p;
    if (periodo !== 'ok') errores.fecha = { sin_periodo: 'no hay un período contable abierto para esa fecha', cerrado: 'el período de esa fecha está cerrado', vencido: 'el período de esa fecha ya venció' }[periodo];
  }
  if (d.fecha_vto_pago && d.fecha_vto_pago < d.fecha) errores.fecha_vto_pago = `no puede ser anterior a la fecha de ${NOMBRE[clase].de}`;

  let origen = null, saldoOrigen = null;
  if (clase === 'nota_credito' && d.comprobante_origen_id) {
    origen = await c.uno(`select c.id, c.estado, c.sentido, c.tercero_id, c.fecha::text as fecha, c.punto_venta, c.numero, t.letra, t.clase, t.descripcion as tipo from comprobante c
      join arca_tipo_comprobante t on t.codigo = c.tipo_comprobante_codigo where c.id = $1`, [d.comprobante_origen_id]);
    if (!origen || origen.sentido !== 'compra') errores.comprobante_origen_id = 'la factura no existe';
    else if (origen.tercero_id !== tercero.id) errores.comprobante_origen_id = 'la factura es de otro proveedor';
    else if (!['factura', 'nota_debito'].includes(origen.clase)) errores.comprobante_origen_id = 'solo se acredita una factura o una nota de débito';
    else if (!['confirmado', 'autorizado'].includes(origen.estado)) errores.comprobante_origen_id = origen.estado === 'anulado' ? 'la factura está anulada: no hay nada que acreditar' : `un comprobante ${origen.estado} no se acredita`;
    else if (origen.letra !== d.letra) errores.comprobante_origen_id = `la nota tiene que ser de la misma letra que la factura (${origen.letra})`;
    else {
      origen.etiqueta = `${origen.tipo} ${numeroFormateado(origen.punto_venta, origen.numero)}`;
      saldoOrigen = (await c.uno('select saldo::text s from v_saldo_comprobante where comprobante_id = $1', [origen.id]))?.s ?? '0';
      if (d.fecha < origen.fecha) errores.fecha = 'la nota no puede ser anterior a la factura que acredita';
    }
  }
  if (clase === 'nota_credito' && !d.comprobante_origen_id) avisos.push('Sin factura de origen: la nota queda a favor del proveedor hasta que la apliques a una factura.');
  const permiteNegativo = (await c.uno('select permite_stock_negativo p from empresa_parametro where empresa_id = $1', [ctx.empresaId]))?.p;
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
    const controla = !!a?.controla_stock, ingresaStock = clase === 'factura' && controla, devuelveStock = clase === 'nota_credito' && it.devuelve_stock === true && controla;
    if (it.devuelve_stock === true && !controla) errores[`items[${i}].devuelve_stock`] = 'solo se devuelve mercadería de un artículo con control de stock';
    let depositoId = null;
    if (ingresaStock || devuelveStock) {
      depositoId = it.deposito_id ?? (depositos.length === 1 ? depositos[0].id : null);
      if (!depositoId) errores[`items[${i}].deposito_id`] = 'indicá en qué depósito entra la mercadería';
      else if (!depositos.some((x) => x.id === depositoId)) errores[`items[${i}].deposito_id`] = 'el depósito no existe o está dado de baja';
      else if (devuelveStock && !permiteNegativo) {
        const hay = (await c.uno('select coalesce(sum(cantidad), 0)::text s from movimiento_stock where articulo_id = $1 and deposito_id = $2', [a.id, depositoId])).s;
        if (dec(hay) < dec(it.cantidad)) errores[`items[${i}].cantidad`] = `no hay tanta mercadería en el depósito para devolver (hay ${texto(dec(hay), 4).replace(/\.?0+$/, '')})`;
      }
    }
    items.push({ articulo: a, articuloId: a?.id ?? null, descripcion, cantidad: it.cantidad, precio: it.precio_unitario, descPct: it.desc_pct ?? '0', tratamiento, alicuota, cuentaId: it.cuenta_id ?? null, depositoId, ingresaStock, devuelveStock });
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
  if (origen && saldoOrigen != null && informado > dec(saldoOrigen)) avisos.push(dec(saldoOrigen) <= 0n ? `${origen.etiqueta} no tiene saldo: la nota queda como saldo a favor con el proveedor.` : `La nota supera el saldo de ${origen.etiqueta} ($ ${saldoOrigen}): la diferencia queda a favor con el proveedor.`);
  if (!coincide) avisos.push(`El total calculado ($ ${texto(totalCalculado)}) no coincide con el de la factura ($ ${d.total}): diferencia de $ ${texto(diferencia)}.`);

  // Costo: se avisa si se aparta mucho del último costo conocido.
  for (const x of (clase === 'factura' ? items : []).filter((y) => y.articuloId && y.articulo.tipo !== 'gasto')) {
    const ultimo = (await c.uno('select costo::text k from articulo_costo where articulo_id = $1 order by fecha desc, id desc limit 1', [x.articuloId]))?.k;
    x.costoNuevo = texto(redondear(mul(dec(x.precio), dec('1') - mul(dec(x.descPct), dec('0.01'))), 4), 4);
    if (ultimo && Number(ultimo) > 0 && Math.abs(Number(x.costoNuevo) / Number(ultimo) - 1) > SALTO_DE_COSTO) avisos.push(`El costo de ${x.descripcion} cambia ${Math.round((Number(x.costoNuevo) / Number(ultimo) - 1) * 100)} % respecto del último ($ ${Number(ultimo)} → $ ${Number(x.costoNuevo)}).`);
  }
  const vto = d.fecha_vto_pago ?? (tercero.condicion_pago_dias > 0 ? new Date(new Date(d.fecha + 'T12:00:00Z').getTime() + tercero.condicion_pago_dias * 864e5).toISOString().slice(0, 10) : null);
  return { d, tercero, discrimina, items, tributos, calculo, impTrib: texto(impTrib), totalCalculado: texto(totalCalculado), diferencia: texto(diferencia), coincide, avisos, tipoCodigo: TIPOS[clase][d.letra], vto, clase, origen, saldoOrigen };
}

export async function calcularCompra(c, ctx, cuerpo, clase = 'factura') {
  const p = await prepararCompra(c, ctx, cuerpo, { exigirTotal: false, clase }), k = p.calculo;
  return {
    clase, origen: p.origen ? { id: p.origen.id, etiqueta: p.origen.etiqueta, saldo: p.saldoOrigen } : null, letra: p.d.letra, tipo_comprobante_codigo: p.tipoCodigo, proveedor: { id: p.tercero.id, razon_social: p.tercero.razon_social }, fecha: p.d.fecha, discrimina_iva: p.discrimina,
    items: p.items.map((x, i) => ({ descripcion: x.descripcion, cantidad: x.cantidad, precio_unitario: x.precio, tratamiento: x.tratamiento, alicuota: x.alicuota ?? null, importe_renglon: k.items[i].importeRenglon, ingresa_stock: x.ingresaStock, devuelve_stock: x.devuelveStock })),
    ivas: k.ivas.map((v) => ({ alicuota: v.alicuota, base_imponible: v.base, importe_iva: v.iva })), imp_neto: k.impNeto, imp_iva: k.impIva, imp_tot_conc: k.impTotConc, imp_op_ex: k.impOpEx, imp_trib: p.impTrib,
    total_calculado: p.totalCalculado, total_informado: p.d.total, diferencia: p.diferencia, coincide: p.coincide, avisos: p.avisos,
  };
}

export async function cargarCompra(c, ctx, cuerpo, clase = 'factura') {
  const p = await prepararCompra(c, ctx, cuerpo, { exigirTotal: true, clase }), k = p.calculo, d = p.d;
  if (await c.uno('select 1 x from comprobante where sentido = $1 and tercero_id = $2 and tipo_comprobante_codigo = $3 and punto_venta = $4 and numero = $5', ['compra', p.tercero.id, p.tipoCodigo, d.punto_venta, d.numero]))
    throw new ErrorApi(409, 'duplicado', `Ya está cargada ${NOMBRE[clase].de} ${d.letra} ${numeroFormateado(d.punto_venta, d.numero)} de ${p.tercero.razon_social} (aunque esté anulada, su número no se vuelve a usar).`);
  const total = texto(dec(k.impTotal) + dec(p.impTrib));
  const cab = await c.uno(`insert into comprobante (empresa_id, sentido, tipo_comprobante_codigo, punto_venta, numero, fecha, tercero_id, concepto_codigo, fecha_vto_pago, moneda, cotizacion, precios_incluyen_iva,
      desc_pie_pct, imp_desc_pie, imp_neto, imp_iva, imp_tot_conc, imp_op_ex, imp_trib, imp_total, observaciones, creado_por, comprobante_origen_id)
    values ($1,'compra',$2,$3,$4,$5,$6,1,$7,'PES',1,false,0,0,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
    [ctx.empresaId, p.tipoCodigo, d.punto_venta, d.numero, d.fecha, p.tercero.id, p.vto, k.impNeto, k.impIva, k.impTotConc, k.impOpEx, p.impTrib, total, d.observaciones ?? null, ctx.usuarioId, p.origen?.id ?? null]);
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
  for (const [i, x] of p.items.entries()) if (x.devuelveStock) {                    // la mercadería sale hacia el proveedor
    await c.consultar(`insert into movimiento_stock (empresa_id, fecha, articulo_id, deposito_id, cantidad, tipo, comprobante_item_id, motivo) values ($1,$2,$3,$4,$5,'devolucion_compra',$6,$7)`,
      [ctx.empresaId, d.fecha, x.articuloId, x.depositoId, texto(-dec(x.cantidad), 4), idsItems[i], `Devolución al proveedor por ${NOMBRE[clase].de} ${d.letra} ${numeroFormateado(d.punto_venta, d.numero)}`.slice(0, 200)]);
  }
  let aplicado = '0.00';                                                             // se aplica a la factura hasta donde alcance su saldo; lo que sobra queda a favor
  if (p.origen && dec(p.saldoOrigen) > 0n) {
    aplicado = texto(dec(total) < dec(p.saldoOrigen) ? dec(total) : dec(p.saldoOrigen));
    await c.consultar('insert into comprobante_aplicacion (empresa_id, nota_id, factura_id, importe, fecha) values ($1,$2,$3,$4,$5)', [ctx.empresaId, cab.id, p.origen.id, aplicado, d.fecha]);
  }
  const cbte = await detalleComprobante(c, cab.id);
  await c.consultar(`select fn_registrar_evento('comprobantes', $1, $2, 'ok', $3, 'comprobante', $4)`,
    [`Cargó ${NOMBRE[clase].etiqueta} ${d.letra} ${numeroFormateado(d.punto_venta, d.numero)} de ${p.tercero.razon_social}`, `$ ${cbte.imp_total}${p.items.some((x) => x.ingresaStock) ? ' · ingresó mercadería al stock' : ''}${p.items.some((x) => x.devuelveStock) ? ' · devolvió mercadería al proveedor' : ''}${p.origen ? ` · acredita ${p.origen.etiqueta}${aplicado !== '0.00' ? ` (aplicó $ ${aplicado})` : ''}` : ''}`, ctx.empresaId, cab.id]);
  return { comprobante: cbte, avisos: p.avisos };
}

/* ---------- notas de crédito y de débito: el cuerpo trae la `clase` ---------- */
const CLASES_NOTA = ['nota_credito', 'nota_debito'];
function separarClase(cuerpo) {
  const { clase, ...resto } = cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo) ? cuerpo : {};
  if (!CLASES_NOTA.includes(clase)) throw invalido({ clase: 'tiene que ser nota_credito o nota_debito' });
  return { clase, resto };
}
export const calcularNotaCompra = (c, ctx, cuerpo) => { const { clase, resto } = separarClase(cuerpo); return calcularCompra(c, ctx, resto, clase); };
export const cargarNotaCompra = (c, ctx, cuerpo) => { const { clase, resto } = separarClase(cuerpo); return cargarCompra(c, ctx, resto, clase); };

/* Aplica lo que le quedó a favor a una nota de crédito (porque superaba el saldo de su factura) a otra factura o nota de débito del mismo proveedor. */
export async function aplicarNotaCompra(c, ctx, notaId, cuerpo) {
  const { valor: d } = validar({ factura_id: { tipo: 'entero', min: 1, requerido: true }, importe: { tipo: 'importe', min: 0.01, max: 999999999999, requerido: true } }, cuerpo);
  const info = (id) => c.uno(`select c.id, c.estado, c.sentido, c.tercero_id, c.punto_venta, c.numero, t.clase, t.descripcion as tipo, coalesce(v.saldo, 0)::text as saldo
    from comprobante c join arca_tipo_comprobante t on t.codigo = c.tipo_comprobante_codigo left join v_saldo_comprobante v on v.comprobante_id = c.id where c.id = $1`, [id]);
  const n = await info(notaId);
  if (!n || n.sentido !== 'compra' || n.clase !== 'nota_credito') throw new ErrorApi(404, 'no_encontrado', 'La nota de crédito no existe.');
  if (!['confirmado', 'autorizado'].includes(n.estado)) throw new ErrorApi(422, 'no_se_puede_aplicar', `Una nota ${n.estado} no se aplica.`);
  const f = await info(d.factura_id), errores = {};
  if (!f || f.sentido !== 'compra') errores.factura_id = 'la factura no existe';
  else if (f.tercero_id !== n.tercero_id) errores.factura_id = 'la factura es de otro proveedor';
  else if (!['factura', 'nota_debito'].includes(f.clase) || !['confirmado', 'autorizado'].includes(f.estado)) errores.factura_id = 'solo se aplica a una factura o una nota de débito confirmada';
  else if (dec(f.saldo) <= 0n) errores.factura_id = `${f.tipo} ${numeroFormateado(f.punto_venta, f.numero)} no tiene saldo`;
  else if (await c.uno('select 1 x from comprobante_aplicacion where nota_id = $1 and factura_id = $2', [n.id, f.id])) errores.factura_id = 'la nota ya está aplicada a esa factura: no se puede aplicar dos veces';
  if (dec(n.saldo) <= 0n) errores.importe = 'la nota no tiene saldo a favor para aplicar';
  else if (dec(d.importe) > dec(n.saldo)) errores.importe = `a la nota le quedan $ ${n.saldo}`;
  else if (f && !errores.factura_id && dec(d.importe) > dec(f.saldo)) errores.importe = `la factura tiene un saldo de $ ${f.saldo}`;
  if (Object.keys(errores).length) throw invalido(errores);
  await c.consultar('insert into comprobante_aplicacion (empresa_id, nota_id, factura_id, importe, fecha) values ($1,$2,$3,$4,$5)', [ctx.empresaId, n.id, f.id, d.importe, hoyISO()]);
  const etiqueta = `${n.tipo} ${numeroFormateado(n.punto_venta, n.numero)}`, destino = `${f.tipo} ${numeroFormateado(f.punto_venta, f.numero)}`;
  await c.consultar(`select fn_registrar_evento('comprobantes', $1, $2, 'ok', $3, 'comprobante', $4)`, [`Aplicó ${etiqueta}`, `$ ${d.importe} a ${destino}`, ctx.empresaId, n.id]);
  return { comprobante: await detalleComprobante(c, n.id), etiqueta, destino, importe: d.importe };
}

export const listarCompras = (c, q) => listarComprobantes(c, { ...q, sentido: 'compra' });

export async function listarJurisdicciones(c) { return { datos: await c.consultar('select codigo, nombre from arca_jurisdiccion order by nombre') }; }

/* Cuentas imputables para clasificar un gasto en un renglón sin artículo. */
export async function listarCuentas(c, { q, limite = 50 } = {}) {
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 200), patron = q ? `%${String(q).replace(/[\\%_]/g, '\\$&').slice(0, 60)}%` : null;
  return { datos: await c.consultar(`select id, codigo, nombre, tipo from plan_cuenta where imputable and activa and ($1::text is null or nombre ilike $1 or codigo ilike $1) order by codigo limit ${lim}`, [patron]) };
}
