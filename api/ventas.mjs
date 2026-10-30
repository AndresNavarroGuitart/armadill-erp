// Factura de venta SIN conexión a ARCA todavía: la letra se elige sola (como en el prototipo), el cálculo es exacto, el número sale de la
// numeración interna del punto de venta, y al confirmar la base genera el asiento. La emisión electrónica (CAE) se agrega después y
// reemplaza solo el paso "numerar y confirmar": todo lo demás queda igual.
import { createHash } from 'node:crypto';
import { validar } from './validar.mjs';
import { ErrorApi, invalido, noEncontrado } from './errores.mjs';
import { calcularVenta, CODIGO_ALICUOTA } from './calculo_venta.mjs';
import { precioVigente } from './articulos.mjs';
import { dec, mul, texto } from '../reglas/calculo.mjs';

const TIPO_COMPROBANTE = { A: 1, B: 6, C: 11 };
const RECEPTOR_CON_FACTURA_A = new Set([1, 6, 13, 16]);        // responsable inscripto y monotributistas: ARCA les emite A
const EMISOR_FACTURA_C = new Set([4, 6, 13, 16]);              // exento y monotributistas
const hoyISO = () => new Date().toISOString().slice(0, 10);
const dias = (a, b) => Math.round((new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / 864e5);
export const numeroFormateado = (pv, n) => `${String(pv).padStart(4, '0')}-${String(n).padStart(8, '0')}`;

const ESQUEMA = {
  tercero_id: { tipo: 'entero', min: 1, requerido: true },
  punto_venta: { tipo: 'entero', min: 1, max: 99999 },
  fecha: { tipo: 'fecha' },
  concepto: { tipo: 'entero', min: 1, max: 3 },
  fecha_servicio_desde: { tipo: 'fecha' }, fecha_servicio_hasta: { tipo: 'fecha' }, fecha_vto_pago: { tipo: 'fecha' },
  lista_id: { tipo: 'entero', min: 1 },
  desc_pie_pct: { tipo: 'porcentaje' },
  observaciones: { tipo: 'texto', max: 500 },
  items: { tipo: 'lista', min: 1, max: 100, requerido: true, elemento: {
    articulo_id: { tipo: 'entero', min: 1 },
    documento_item_id: { tipo: 'entero', min: 1 },            // un renglón puede tomar mercadería de un remito de salida: ya salió del depósito con el remito
    descripcion: { tipo: 'texto', max: 200 },
    cantidad: { tipo: 'importe', min: 0.0001, max: 99999999, requerido: true },
    precio_unitario: { tipo: 'importe', min: 0, max: 999999999999 },
    desc_pct: { tipo: 'porcentaje' },
    deposito_id: { tipo: 'entero', min: 1 },
  } },
};

/* Todo lo que se decide ANTES de escribir: validación, tipo de comprobante, precios y cálculo. Lo usan el cálculo previo y la emisión. */
export async function prepararFactura(c, ctx, cuerpo) {
  const { valor: d } = validar(ESQUEMA, cuerpo);
  const errores = {}, avisos = [], fecha = d.fecha ?? hoyISO(), concepto = d.concepto ?? 1;

  const emisor = ctx.empresa.condicionIvaCodigo;
  if (!(emisor === 1 || EMISOR_FACTURA_C.has(emisor))) throw new ErrorApi(422, 'condicion_empresa', 'La condición de la empresa frente al IVA no permite emitir facturas.');
  const tercero = await c.uno('select id, razon_social, tipo_documento_codigo, nro_documento, condicion_iva_codigo, lista_precio_id, limite_credito::text limite, es_cliente, activo from tercero where id = $1', [d.tercero_id]);
  if (!tercero || !tercero.es_cliente) throw invalido({ tercero_id: 'el cliente no existe' });
  if (!tercero.activo) throw invalido({ tercero_id: 'el cliente está dado de baja' });

  /* La letra no se elige: sale de quién emite y a quién (igual que en el prototipo). */
  const letra = EMISOR_FACTURA_C.has(emisor) ? 'C' : RECEPTOR_CON_FACTURA_A.has(Number(tercero.condicion_iva_codigo)) ? 'A' : 'B';
  if (letra === 'A' && Number(tercero.tipo_documento_codigo) !== 80) errores.tercero_id = 'una factura A necesita que el cliente tenga CUIT';

  if (Math.abs(dias(fecha, hoyISO())) > 10) errores.fecha = 'la fecha del comprobante se aparta más de 10 días de hoy [A verificar el plazo vigente en ARCA]';
  if (concepto !== 1) {
    for (const k of ['fecha_servicio_desde', 'fecha_servicio_hasta', 'fecha_vto_pago']) if (!d[k]) errores[k] = 'es obligatoria cuando la factura incluye servicios';
    if (d.fecha_servicio_desde && d.fecha_servicio_hasta && d.fecha_servicio_desde > d.fecha_servicio_hasta) errores.fecha_servicio_hasta = 'no puede ser anterior a la fecha "desde"';
  }
  const periodo = (await c.uno('select fn_periodo_aceptado($1, $2) p', [ctx.empresaId, fecha])).p;
  if (periodo !== 'ok') errores.fecha = { sin_periodo: 'no hay un período contable abierto para esa fecha', cerrado: 'el período de esa fecha está cerrado', vencido: 'el período de esa fecha ya venció' }[periodo];

  const pvs = await c.consultar('select id, numero, sistema from punto_venta where activo order by numero');
  const internos = pvs.filter((p) => ['interno', 'preimpresa'].includes(p.sistema));          // sin indicarlo, vale el único punto de venta que hoy se puede usar
  const pv = d.punto_venta ? pvs.find((p) => p.numero === d.punto_venta) : internos.length === 1 ? internos[0] : null;
  if (!pv) errores.punto_venta = d.punto_venta ? 'el punto de venta no existe o está inactivo' : 'indicá el punto de venta';
  else if (!['interno', 'preimpresa'].includes(pv.sistema)) throw new ErrorApi(409, 'arca_pendiente', 'La emisión electrónica por ARCA todavía no está conectada: usá un punto de venta interno.');

  let listaId = d.lista_id ?? tercero.lista_precio_id;
  if (!listaId) listaId = (await c.uno('select id from lista_precio order by orden, id limit 1'))?.id ?? null;
  const depositos = await c.consultar('select id from deposito where activo order by id');
  const items = [], remitosUsados = new Set();
  for (const [i, it] of d.items.entries()) {
    const campo = (k) => `items[${i}].${k}`;
    if (!it.articulo_id && !it.documento_item_id) { errores[campo('articulo_id')] = 'indicá el artículo'; continue; }
    let rem = null;
    if (it.documento_item_id) {                                                    // la factura valoriza lo que ya se entregó con el remito, pero no vuelve a descontarlo del stock
      rem = await c.uno(`select di.id, di.articulo_id, di.cantidad::text as entregado, di.precio_unitario::text as precio, d.estado, d.tipo, d.tercero_id, d.punto_venta, d.numero,
          coalesce((select sum(x.cantidad) from comprobante_item x join comprobante k on k.id = x.comprobante_id and k.estado in ('confirmado', 'autorizado') where x.documento_item_id = di.id), 0)::text as facturado
        from documento_item di join documento_comercial d on d.id = di.documento_id where di.id = $1`, [it.documento_item_id]);
      if (!rem || rem.tipo !== 'remito_venta') { errores[campo('documento_item_id')] = 'el renglón del remito no existe'; continue; }
      if (rem.tercero_id !== tercero.id) { errores[campo('documento_item_id')] = 'el remito es de otro cliente'; continue; }
      if (rem.estado !== 'confirmado') { errores[campo('documento_item_id')] = rem.estado === 'anulado' ? 'el remito está anulado' : 'el remito no está confirmado'; continue; }
      if (remitosUsados.has(rem.id)) { errores[campo('documento_item_id')] = 'ese renglón del remito está repetido'; continue; }
      remitosUsados.add(rem.id);
      if (it.articulo_id && it.articulo_id !== rem.articulo_id) { errores[campo('articulo_id')] = 'no es el artículo del remito'; continue; }
      const facturable = dec(rem.entregado) - dec(rem.facturado), cantidad = (x) => texto(dec(x), 4).replace(/\.?0+$/, '');
      if (dec(it.cantidad) > facturable) { errores[campo('cantidad')] = facturable <= 0n ? 'ese renglón del remito ya está facturado por completo' : `del remito solo se pueden facturar ${cantidad(texto(facturable, 4))} (se entregaron ${cantidad(rem.entregado)}, ya se facturaron ${cantidad(rem.facturado)})`; continue; }
    }
    const a = await c.uno('select id, nombre, tipo, activo, tratamiento_iva_venta, alicuota_venta_codigo, controla_stock, cuenta_venta_id from articulo where id = $1', [rem ? rem.articulo_id : it.articulo_id]);
    if (!a) { errores[campo('articulo_id')] = 'el artículo no existe'; continue; }
    if (!a.activo) errores[campo('articulo_id')] = 'el artículo está dado de baja';
    if (a.tipo === 'gasto') errores[campo('articulo_id')] = 'un artículo de tipo gasto no se vende';
    let precio = it.precio_unitario;
    if (precio === undefined && rem && dec(rem.precio) > 0n) precio = texto(dec(rem.precio), 4);          // el precio acordado en el remito
    if (precio === undefined) {
      precio = listaId ? await precioVigente(c, a.id, listaId, fecha) : null;
      if (precio === null) errores[campo('precio_unitario')] = 'el artículo no tiene precio en la lista del cliente: indicá el precio';
    }
    let alicuota = null;
    if (a.tratamiento_iva_venta === 'gravado') {
      const t = (await c.uno('select tasa from arca_alicuota_iva where codigo = $1', [a.alicuota_venta_codigo])).tasa;
      alicuota = String(Number((Number(t) * 100).toFixed(4)));
    }
    const sinIva = letra === 'C';
    let deposito = null;
    if (a.controla_stock && !rem) { deposito = it.deposito_id ?? (depositos.length === 1 ? depositos[0].id : null); if (!deposito) errores[campo('deposito_id')] = 'indicá de qué depósito sale la mercadería'; else if (!depositos.some((x) => x.id === deposito)) errores[campo('deposito_id')] = 'el depósito no existe o está inactivo'; }
    items.push({ articuloId: a.id, nombre: a.nombre, descripcion: it.descripcion ?? a.nombre, cantidad: it.cantidad, precio, descPct: it.desc_pct ?? '0', cuentaId: a.cuenta_venta_id, controlaStock: a.controla_stock && !rem, depositoId: deposito, remitoItemId: rem?.id ?? null,
      tratamiento: sinIva ? 'gravado' : a.tratamiento_iva_venta, alicuota: sinIva ? '0' : alicuota });
  }
  if (Object.keys(errores).length) throw invalido(errores);

  const calculo = calcularVenta(items.map((x) => ({ cantidad: x.cantidad, precio: x.precio, descPct: x.descPct, tratamiento: x.tratamiento, alicuota: x.alicuota })), { descPiePct: d.desc_pie_pct ?? '0' });
  if (dec(calculo.impTotal) <= 0n) throw invalido({ items: 'el total de la factura tiene que ser mayor que cero' });
  const saldo = Number((await c.uno(`select coalesce((select saldo from v_saldo_tercero where tercero_id = $1 and rol = 'cliente'), 0)::text s`, [tercero.id])).s);
  if (Number(tercero.limite) > 0 && saldo + Number(calculo.impTotal) > Number(tercero.limite)) avisos.push(`Con esta factura el cliente supera su límite de crédito (${tercero.limite}).`);
  if (items.some((x) => x.remitoItemId)) avisos.push('La mercadería tomada de un remito ya salió del depósito con ese remito: la factura no la vuelve a descontar.');
  return { d, fecha, concepto, letra, tipoCodigo: TIPO_COMPROBANTE[letra], tercero, pv, items, calculo, avisos, listaId };
}

function presentarPrevia(p) {
  return { letra: p.letra, tipo_comprobante_codigo: p.tipoCodigo, punto_venta: p.pv.numero, fecha: p.fecha, cliente: { id: p.tercero.id, razon_social: p.tercero.razon_social, condicion_iva_codigo: Number(p.tercero.condicion_iva_codigo) },
    items: p.items.map((x, i) => ({ articulo_id: x.articuloId, descripcion: x.descripcion, cantidad: x.cantidad, precio_unitario: x.precio, desc_pct: x.descPct, importe_renglon: p.calculo.items[i].importeRenglon, del_remito: !!x.remitoItemId })),
    ivas: p.calculo.ivas.map((v) => ({ alicuota: v.alicuota, base_imponible: v.base, importe_iva: v.iva })),
    imp_neto: p.calculo.impNeto, imp_iva: p.calculo.impIva, imp_tot_conc: p.calculo.impTotConc, imp_op_ex: p.calculo.impOpEx, imp_desc_pie: p.calculo.impDescPie, imp_total: p.calculo.impTotal, avisos: p.avisos };
}
export async function calcularFactura(c, ctx, cuerpo) { return presentarPrevia(await prepararFactura(c, ctx, cuerpo)); }

export async function leerComprobante(c, id) {
  const f = await c.uno(`select c.id, c.sentido, c.tipo_comprobante_codigo, t.descripcion tipo, t.letra, c.punto_venta, c.numero, c.fecha::text fecha, c.tercero_id, te.razon_social cliente, c.condicion_iva_receptor_codigo,
      c.concepto_codigo, c.fecha_servicio_desde::text fecha_servicio_desde, c.fecha_servicio_hasta::text fecha_servicio_hasta, c.fecha_vto_pago::text fecha_vto_pago, c.moneda, c.desc_pie_pct::text desc_pie_pct,
      c.imp_desc_pie::text imp_desc_pie, c.imp_neto::text imp_neto, c.imp_iva::text imp_iva, c.imp_tot_conc::text imp_tot_conc, c.imp_op_ex::text imp_op_ex, c.imp_trib::text imp_trib, c.imp_total::text imp_total,
      c.estado, c.cae, c.asiento_id, c.observaciones, c.creado_por, c.creado_en, c.comprobante_origen_id, c.motivo_anulacion, c.anulado_en, c.anulado_por
    from comprobante c join arca_tipo_comprobante t on t.codigo = c.tipo_comprobante_codigo join tercero te on te.id = c.tercero_id where c.id = $1`, [id]);
  if (!f) throw noEncontrado('El comprobante');
  const items = await c.consultar(`select i.id, i.orden, i.item_origen_id, i.articulo_id, i.descripcion, i.cantidad::text cantidad, i.precio_unitario::text precio_unitario, i.desc_pct::text desc_pct, i.tratamiento_iva, i.alicuota_codigo, i.importe_renglon::text importe_renglon
    from comprobante_item i where i.comprobante_id = $1 order by i.orden`, [id]);
  const ivas = await c.consultar(`select a.tasa * 100 as alicuota_pct, v.alicuota_codigo, v.base_imponible::text base_imponible, v.importe_iva::text importe_iva from comprobante_iva v join arca_alicuota_iva a on a.codigo = v.alicuota_codigo where v.comprobante_id = $1 order by a.tasa desc`, [id]);
  const asiento = f.asiento_id ? await c.uno('select id, numero, estado from asiento where id = $1', [f.asiento_id]) : null;
  return { ...f, numero_formateado: f.numero == null ? null : numeroFormateado(f.punto_venta, f.numero), items, ivas: ivas.map((v) => ({ alicuota: String(Number(v.alicuota_pct)), codigo: v.alicuota_codigo, base_imponible: v.base_imponible, importe_iva: v.importe_iva })), asiento };
}

export async function listarComprobantes(c, { sentido = 'venta', estado, tercero_id, desde, hasta, limite = 50, desplazamiento = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 100), des = Math.max(Number(desplazamiento) || 0, 0), errores = {};
  if (!['venta', 'compra'].includes(sentido)) errores.sentido = 'tiene que ser venta o compra';
  if (estado && !['borrador', 'confirmado', 'autorizado', 'rechazado', 'anulado'].includes(estado)) errores.estado = 'estado inválido';
  for (const [k, v] of Object.entries({ desde, hasta })) if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errores[k] = 'tiene que ser una fecha aaaa-mm-dd';
  if (tercero_id && !/^\d{1,15}$/.test(String(tercero_id))) errores.tercero_id = 'tiene que ser un número';
  if (Object.keys(errores).length) throw invalido(errores);
  const params = [sentido, estado || null, tercero_id ? Number(tercero_id) : null, desde || null, hasta || null];
  const filtros = 'c.sentido = $1 and ($2::text is null or c.estado = $2) and ($3::bigint is null or c.tercero_id = $3) and ($4::date is null or c.fecha >= $4) and ($5::date is null or c.fecha <= $5)';
  const filas = await c.consultar(`select c.id, t.letra, t.descripcion tipo, c.punto_venta, c.numero, c.fecha::text fecha, c.tercero_id, te.razon_social cliente, c.imp_total::text imp_total, c.estado, c.cae
    from comprobante c join arca_tipo_comprobante t on t.codigo = c.tipo_comprobante_codigo join tercero te on te.id = c.tercero_id where ${filtros} order by c.fecha desc, c.id desc limit ${lim} offset ${des}`, params);
  const total = (await c.uno(`select count(*)::int n from comprobante c where ${filtros}`, params)).n;
  return { datos: filas.map((f) => ({ ...f, numero_formateado: f.numero == null ? null : numeroFormateado(f.punto_venta, f.numero) })), total, limite: lim, desplazamiento: des };
}

/* Emite: guarda, numera, confirma (la base verifica el comprobante y genera el asiento), descuenta stock y deja el rastro en la trazabilidad. */
export async function emitirFactura(c, ctx, cuerpo, { claveIdempotencia } = {}) {
  const huella = createHash('sha256').update(JSON.stringify(cuerpo ?? null)).update(String(ctx.usuarioId)).digest('hex');
  if (claveIdempotencia) {
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(claveIdempotencia)) throw invalido({ 'Idempotency-Key': 'tiene que tener entre 8 y 100 caracteres (letras, números, . _ : -)' });
    const previo = await c.uno('select comprobante_id, huella from api_idempotencia where clave = $1', [claveIdempotencia]);
    if (previo) {
      if (previo.huella !== huella) throw new ErrorApi(422, 'clave_reutilizada', 'Esa clave de idempotencia ya se usó con otro pedido.');
      return { comprobante: await leerComprobante(c, previo.comprobante_id), repetido: true, avisos: [] };
    }
  }
  const p = await prepararFactura(c, ctx, cuerpo), k = p.calculo;
  const pie = texto(mul(dec(p.d.desc_pie_pct ?? '0'), dec('0.01')), 4);

  // Stock: se verifica ANTES de escribir para dar un mensaje claro (la base igual lo impide si alguien se salta esto).
  for (const it of p.items.filter((x) => x.controlaStock)) {
    const s = await c.uno('select coalesce(sum(cantidad), 0)::text s from movimiento_stock where articulo_id = $1 and deposito_id = $2', [it.articuloId, it.depositoId]);
    const permite = (await c.uno('select permite_stock_negativo p from empresa_parametro where empresa_id = $1', [ctx.empresaId]))?.p;
    if (!permite && Number(s.s) < Number(it.cantidad)) throw new ErrorApi(422, 'stock_insuficiente', `Stock insuficiente de ${it.nombre}: hay ${Number(s.s)} y se piden ${Number(it.cantidad)}.`);
  }

  const cab = await c.uno(`insert into comprobante (empresa_id, sentido, tipo_comprobante_codigo, punto_venta, fecha, tercero_id, condicion_iva_receptor_codigo, concepto_codigo, fecha_servicio_desde, fecha_servicio_hasta,
      fecha_vto_pago, moneda, cotizacion, precios_incluyen_iva, desc_pie_pct, imp_desc_pie, imp_neto, imp_iva, imp_tot_conc, imp_op_ex, imp_trib, imp_total, observaciones, creado_por)
    values ($1,'venta',$2,$3,$4,$5,$6,$7,$8,$9,$10,'PES',1,false,$11,$12,$13,$14,$15,$16,0,$17,$18,$19) returning id`,
    [ctx.empresaId, p.tipoCodigo, p.pv.numero, p.fecha, p.tercero.id, p.tercero.condicion_iva_codigo, p.concepto, p.d.fecha_servicio_desde ?? null, p.d.fecha_servicio_hasta ?? null, p.d.fecha_vto_pago ?? null,
     pie, k.impDescPie, k.impNeto, k.impIva, k.impTotConc, k.impOpEx, k.impTotal, p.d.observaciones ?? null, ctx.usuarioId]);
  const idsItems = [];
  for (const [i, it] of p.items.entries()) {
    const r = await c.uno(`insert into comprobante_item (empresa_id, comprobante_id, orden, articulo_id, descripcion, cantidad, precio_unitario, desc_pct, tratamiento_iva, alicuota_codigo, importe_renglon, cuenta_id, deposito_id, documento_item_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
      [ctx.empresaId, cab.id, i + 1, it.articuloId, it.descripcion, it.cantidad, it.precio, texto(mul(dec(it.descPct), dec('0.01')), 4), it.tratamiento, it.tratamiento === 'gravado' ? CODIGO_ALICUOTA[it.alicuota] : null, k.items[i].importeRenglon, it.cuentaId, it.depositoId, it.remitoItemId]);
    idsItems.push(r.id);
  }
  for (const v of k.ivas) await c.consultar('insert into comprobante_iva (empresa_id, comprobante_id, alicuota_codigo, base_imponible, importe_iva) values ($1,$2,$3,$4,$5)', [ctx.empresaId, cab.id, v.codigo, v.base, v.iva]);

  const numero = (await c.uno('select fn_siguiente($1, $2) n', [ctx.empresaId, `cbte-${p.tipoCodigo}-${p.pv.numero}`])).n;
  await c.consultar(`update comprobante set numero = $2, estado = 'confirmado' where id = $1`, [cab.id, numero]);          // acá la base verifica el comprobante y genera el asiento
  for (const [i, it] of p.items.entries()) if (it.controlaStock) {
    await c.consultar(`insert into movimiento_stock (empresa_id, fecha, articulo_id, deposito_id, cantidad, tipo, comprobante_item_id) values ($1,$2,$3,$4,$5,'venta',$6)`, [ctx.empresaId, p.fecha, it.articuloId, it.depositoId, '-' + it.cantidad, idsItems[i]]);
  }
  const cbte = await leerComprobante(c, cab.id);
  await c.consultar(`select fn_registrar_evento('comprobantes', $1, $2, 'ok', $3, 'comprobante', $4)`,
    [`Emitió Factura ${p.letra} ${cbte.numero_formateado}`, `${p.tercero.razon_social} · $ ${cbte.imp_total} · numeración interna (sin CAE)`, ctx.empresaId, cab.id]);
  if (claveIdempotencia) await c.consultar('insert into api_idempotencia (empresa_id, clave, usuario_id, huella, comprobante_id) values ($1,$2,$3,$4,$5)', [ctx.empresaId, claveIdempotencia, ctx.usuarioId, huella, cab.id]);
  return { comprobante: cbte, repetido: false, avisos: p.avisos };
}
