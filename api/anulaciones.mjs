// Anular comprobantes y emitir notas de crédito.
//   - Un comprobante confirmado SIN CAE se puede anular: conserva su número, la base genera el contraasiento (el asiento original no se toca)
//     y el stock que movió vuelve a su lugar. Uno AUTORIZADO por ARCA no se anula: se corrige con una nota de crédito (la base también lo impide).
//   - Una nota de crédito acredita renglones de una factura (todo lo que quede por acreditar, o las cantidades que se elijan), al mismo precio y con
//     las mismas alícuotas y descuentos de la factura; se aplica a su saldo y, si se pide, devuelve la mercadería al depósito de donde salió.
//   - No se anula lo que tiene cobros o notas aplicadas (la base lo impide; acá se avisa antes con un mensaje claro).
import { createHash } from 'node:crypto';
import { validar } from './validar.mjs';
import { ErrorApi, invalido, noEncontrado } from './errores.mjs';
import { calcularVenta, CODIGO_ALICUOTA } from './calculo_venta.mjs';
import { leerComprobante, numeroFormateado } from './ventas.mjs';
import { contabilizarCosto } from './costo_ventas.mjs';
import { dec, mul, texto } from '../reglas/calculo.mjs';

const hoyISO = () => new Date().toISOString().slice(0, 10);
const dias = (a, b) => Math.round((new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / 864e5);
const CODIGO_NOTA = { A: 3, B: 8, C: 13 };                                         // nota de crédito de cada letra
const PCT_DE_CODIGO = Object.fromEntries(Object.entries(CODIGO_ALICUOTA).map(([pct, cod]) => [cod, pct]));
const USABLES = ['interno', 'preimpresa'];
const cant = (x) => texto(dec(x), 4).replace(/\.?0+$/, '');

/* ---------- lo que se puede hacer con un comprobante (para que la pantalla ofrezca solo eso, con la razón de lo que no) ---------- */
async function dependientes(c, id) {
  const cobros = (await c.uno(`select count(*)::int n from pago_imputacion i join pago p on p.id = i.pago_id and p.estado = 'confirmado' where i.comprobante_id = $1`, [id])).n;
  const notas = (await c.consultar(`select n.id from comprobante_aplicacion a join comprobante n on n.id = a.nota_id where a.factura_id = $1 and n.estado in ('confirmado','autorizado')`, [id])).length;
  const aplicada = (await c.uno('select count(*)::int n from comprobante_aplicacion where nota_id = $1', [id])).n;
  return { cobros, notas, aplicada };
}
function razonNoAnular(f, dep) {
  if (f.estado === 'anulado') return 'Ya está anulado.';
  if (f.estado === 'autorizado') return 'Tiene CAE de ARCA: no se anula, se corrige con una nota de crédito.';
  if (f.estado !== 'confirmado') return `Un comprobante ${f.estado} no se anula.`;
  if (dep.cobros) return 'Tiene cobros imputados: anulá primero esos recibos.';
  if (dep.notas) return 'Tiene notas de crédito aplicadas: anulá primero esas notas.';
  return null;
}

/* El comprobante completo, con lo que hace falta para decidir qué hacer con él. */
export async function detalleComprobante(c, id, { sentido } = {}) {
  const f = await leerComprobante(c, id);
  if (sentido && f.sentido !== sentido) throw noEncontrado('El comprobante');
  const dep = await dependientes(c, id);
  const clase = (await c.uno('select clase, signo from arca_tipo_comprobante where codigo = $1', [f.tipo_comprobante_codigo]));
  const acreditados = await c.consultar(`select i.item_origen_id as id, sum(i.cantidad)::text as cantidad from comprobante_item i join comprobante n on n.id = i.comprobante_id and n.estado in ('confirmado','autorizado')
    where i.item_origen_id = any($1::bigint[]) group by i.item_origen_id`, [f.items.map((i) => i.id)]);
  const items = f.items.map((i) => { const a = acreditados.find((x) => x.id === i.id)?.cantidad ?? '0'; return { ...i, acreditado: a, por_acreditar: texto(dec(i.cantidad) - dec(a), 4) }; });
  const origen = f.comprobante_origen_id ? await c.uno(`select c.id, t.descripcion tipo, c.punto_venta, c.numero from comprobante c join arca_tipo_comprobante t on t.codigo = c.tipo_comprobante_codigo where c.id = $1`, [f.comprobante_origen_id]) : null;
  const notas = await c.consultar(`select n.id, t.descripcion tipo, n.punto_venta, n.numero, n.imp_total::text imp_total, n.estado from comprobante n join arca_tipo_comprobante t on t.codigo = n.tipo_comprobante_codigo where n.comprobante_origen_id = $1 order by n.id`, [id]);
  const saldo = (await c.uno('select saldo::text s from v_saldo_comprobante where comprobante_id = $1', [id]))?.s ?? null;
  const anuladoPor = f.anulado_por ? (await c.uno('select nombre from usuario where id = $1', [f.anulado_por]))?.nombre : null;
  let razonNota = null;
  if (!['factura', 'nota_debito'].includes(clase.clase)) razonNota = `Solo se acredita una factura o una nota de débito ${f.sentido === 'venta' ? 'de venta' : 'de proveedor'}.`;
  else if (!['confirmado', 'autorizado'].includes(f.estado)) razonNota = f.estado === 'anulado' ? 'Está anulada: no hay nada que acreditar.' : `Un comprobante ${f.estado} no se acredita.`;
  else if (f.sentido === 'venta' && items.every((i) => dec(i.por_acreditar) <= 0n)) razonNota = 'Ya está acreditada por completo.';
  const { comprobante_origen_id, anulado_por, ...resto } = f;
  return {
    ...resto, clase: clase.clase, items, saldo, anulacion: f.estado === 'anulado' ? { motivo: f.motivo_anulacion, en: f.anulado_en, por: anuladoPor } : null,
    origen: origen ? { id: origen.id, tipo: origen.tipo, numero_formateado: numeroFormateado(origen.punto_venta, origen.numero) } : null,
    notas: notas.map((n) => ({ id: n.id, tipo: n.tipo, numero_formateado: n.numero == null ? null : numeroFormateado(n.punto_venta, n.numero), imp_total: n.imp_total, estado: n.estado })),
    acciones: { anular: razonNoAnular(f, dep), nota_credito: razonNota },
  };
}

/* ---------- anular ---------- */
const INVERSO = { venta: 'devolucion_venta', devolucion_venta: 'venta', compra: 'devolucion_compra', devolucion_compra: 'compra' };
export async function anularComprobante(c, ctx, id, cuerpo, { sentido = 'venta' } = {}) {
  const { valor: d } = validar({ motivo: { tipo: 'texto', min: 3, max: 200, requerido: true } }, cuerpo);
  const f = await c.uno(`select c.id, c.sentido, c.estado, c.numero, c.punto_venta, c.imp_total::text total, t.descripcion tipo, t.clase, te.razon_social cliente
    from comprobante c join arca_tipo_comprobante t on t.codigo = c.tipo_comprobante_codigo join tercero te on te.id = c.tercero_id where c.id = $1 for update of c`, [id]);
  if (!f || f.sentido !== sentido) throw noEncontrado('El comprobante');
  const dep = await dependientes(c, id), razon = razonNoAnular(f, dep);
  if (razon) throw new ErrorApi(422, f.estado === 'autorizado' ? 'autorizado_no_se_anula' : 'no_se_puede_anular', razon);
  const periodo = (await c.uno('select fn_periodo_aceptado($1, $2) p', [ctx.empresaId, hoyISO()])).p;
  if (periodo !== 'ok') throw new ErrorApi(422, 'periodo_no_abierto', 'El período de hoy no está abierto: no se puede registrar el contraasiento de la anulación.');
  const etiqueta = `${f.tipo} ${numeroFormateado(f.punto_venta, f.numero)}`;

  // Stock: cada movimiento que hizo el comprobante se contrarresta (una venta vuelve como devolución; una devolución de nota, como venta).
  const movs = await c.consultar(`select m.articulo_id, m.deposito_id, m.cantidad::text cantidad, m.tipo, fn_costo_a_revertir(m.id)::text costo, a.nombre from movimiento_stock m join comprobante_item i on i.id = m.comprobante_item_id join articulo a on a.id = m.articulo_id
    where i.comprobante_id = $1 and m.tipo = any($2::text[]) order by m.id`, [id, Object.keys(INVERSO)]);
  const permite = (await c.uno('select permite_stock_negativo p from empresa_parametro where empresa_id = $1', [ctx.empresaId]))?.p;
  for (const m of movs.filter((x) => dec(x.cantidad) > 0n)) {              // lo que había entrado (devoluciones de una nota) tiene que seguir estando para poder sacarlo
    const saldo = (await c.uno('select coalesce(sum(cantidad), 0)::text s from movimiento_stock where articulo_id = $1 and deposito_id = $2', [m.articulo_id, m.deposito_id])).s;
    if (!permite && dec(saldo) < dec(m.cantidad)) throw new ErrorApi(422, 'stock_insuficiente', `No se puede anular: la mercadería que ${f.clase === 'nota_credito' ? 'devolvió esta nota' : 'ingresó con esta compra'} (${cant(m.cantidad)} de ${m.nombre}) ya no está en el depósito (hay ${cant(saldo)}).`);
  }
  // La nota aplicada a una factura: se deshace la aplicación (la factura recupera su saldo).
  const desaplicadas = f.clase === 'nota_credito' ? await c.consultar('delete from comprobante_aplicacion where nota_id = $1 returning factura_id', [id]) : [];
  await c.consultar(`update comprobante set estado = 'anulado', motivo_anulacion = $2, anulado_en = now(), anulado_por = $3 where id = $1`, [id, d.motivo, ctx.usuarioId]);      // acá la base genera el contraasiento
  const idsCosto = [];
  for (const m of movs) {                                                                          // lo que salió al cliente (o volvió) se contrarresta al MISMO costo con el que se movió
    const r = await c.uno(`insert into movimiento_stock (empresa_id, fecha, articulo_id, deposito_id, cantidad, tipo, motivo, costo_unitario) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [ctx.empresaId, hoyISO(), m.articulo_id, m.deposito_id, texto(-dec(m.cantidad), 4), INVERSO[m.tipo], `Anulación de ${etiqueta}`.slice(0, 200), f.sentido === 'venta' ? m.costo : null]);
    idsCosto.push(r.id);
  }
  if (f.sentido === 'venta') await contabilizarCosto(c, idsCosto, { origenTipo: 'costo_comprobante', origenId: id, descripcion: `Anulación del costo de ventas · ${etiqueta}`, fecha: hoyISO() });
  if (f.sentido === 'compra') await revertirCostos(c, ctx, id);
  return { comprobante: await detalleComprobante(c, id), etiqueta, cliente: f.cliente, total: f.total, motivo: d.motivo, stock: movs.length, desaplicadas: desaplicadas.length };
}

/* Si el costo de un artículo era el de esta compra, vuelve al anterior (se agrega un registro nuevo: el historial no se edita). */
async function revertirCostos(c, ctx, id) {
  const articulos = await c.consultar('select distinct articulo_id from articulo_costo where comprobante_id = $1', [id]);
  for (const { articulo_id } of articulos) {
    const ultimo = await c.uno('select comprobante_id from articulo_costo where articulo_id = $1 order by fecha desc, id desc limit 1', [articulo_id]);
    // el anterior que siga vigente (el de otra compra ya anulada no vale)
    const previo = ultimo?.comprobante_id === id ? await c.uno(`select k.costo::text costo from articulo_costo k left join comprobante cc on cc.id = k.comprobante_id where k.articulo_id = $1 and k.comprobante_id is distinct from $2 and (cc.id is null or cc.estado <> 'anulado') order by k.fecha desc, k.id desc limit 1`, [articulo_id, id]) : null;
    if (previo) await c.consultar(`insert into articulo_costo (empresa_id, articulo_id, fecha, costo, origen) values ($1, $2, $3, $4, 'ajuste')`, [ctx.empresaId, articulo_id, hoyISO(), previo.costo]);
  }
}

/* ---------- nota de crédito ---------- */
const ESQUEMA_NOTA = {
  comprobante_origen_id: { tipo: 'entero', min: 1, requerido: true },
  motivo: { tipo: 'texto', min: 3, max: 200, requerido: true },
  fecha: { tipo: 'fecha' },
  devolver_stock: { tipo: 'booleano' },
  items: { tipo: 'lista', min: 1, max: 100, elemento: { item_id: { tipo: 'entero', min: 1, requerido: true }, cantidad: { tipo: 'importe', min: 0.0001, max: 99999999, requerido: true } } },
};

async function prepararNota(c, ctx, cuerpo) {
  const { valor: d } = validar(ESQUEMA_NOTA, cuerpo);
  const errores = {}, avisos = [], fecha = d.fecha ?? hoyISO();
  const o = await c.uno(`select c.id, c.sentido, c.estado, c.numero, c.punto_venta, c.fecha::text fecha, c.tercero_id, c.condicion_iva_receptor_codigo, c.concepto_codigo, c.fecha_servicio_desde::text fsd, c.fecha_servicio_hasta::text fsh, c.fecha_vto_pago::text fvp,
      c.desc_pie_pct::text desc_pie, c.imp_total::text total, t.descripcion tipo, t.letra, t.clase, te.razon_social cliente
    from comprobante c join arca_tipo_comprobante t on t.codigo = c.tipo_comprobante_codigo join tercero te on te.id = c.tercero_id where c.id = $1`, [d.comprobante_origen_id]);
  if (!o) throw invalido({ comprobante_origen_id: 'la factura no existe' });
  if (o.sentido !== 'venta' || !['factura', 'nota_debito'].includes(o.clase)) throw invalido({ comprobante_origen_id: 'solo se acredita una factura o una nota de débito de venta' });
  if (!['confirmado', 'autorizado'].includes(o.estado)) throw invalido({ comprobante_origen_id: o.estado === 'anulado' ? 'el comprobante está anulado: no hay nada que acreditar' : `un comprobante ${o.estado} no se acredita` });
  if (!CODIGO_NOTA[o.letra]) throw new ErrorApi(422, 'letra_no_soportada', `Todavía no se emiten notas de crédito para comprobantes de letra ${o.letra}.`);
  const etiquetaOrigen = `${o.tipo} ${numeroFormateado(o.punto_venta, o.numero)}`;

  const renglones = await c.consultar(`select i.id, i.orden, i.articulo_id, i.descripcion, i.cantidad::text cantidad, i.precio_unitario::text precio, i.desc_pct::text desc_pct, i.tratamiento_iva, i.alicuota_codigo, i.deposito_id, i.cuenta_id,
      (select coalesce(sum(n.cantidad), 0)::text from comprobante_item n join comprobante nc on nc.id = n.comprobante_id and nc.estado in ('confirmado','autorizado') where n.item_origen_id = i.id) as acreditado,
      coalesce((select m.deposito_id from movimiento_stock m where m.comprobante_item_id = i.id and m.tipo = 'venta' order by m.id limit 1),
        (select di.deposito_id from documento_item di join documento_comercial dd on dd.id = di.documento_id and dd.tipo = 'remito_venta' and dd.estado = 'confirmado' join articulo a on a.id = di.articulo_id and a.controla_stock
          where di.id = i.documento_item_id)) as deposito_stock          -- de donde salió la mercadería: por la propia factura o, si venía de un remito, por el remito
    from comprobante_item i where i.comprobante_id = $1 order by i.orden`, [o.id]);
  const pendiente = (r) => dec(r.cantidad) - dec(r.acreditado);
  let elegidos;
  if (d.items === undefined) {
    elegidos = renglones.filter((r) => pendiente(r) > 0n).map((r) => ({ r, cantidad: texto(pendiente(r), 4) }));
    if (!elegidos.length) throw new ErrorApi(422, 'ya_acreditada', `${etiquetaOrigen} ya está acreditada por completo.`);
  } else {
    const vistos = new Set(); elegidos = [];
    d.items.forEach((it, i) => {
      const r = renglones.find((x) => x.id === it.item_id);
      if (!r) { errores[`items[${i}].item_id`] = 'el renglón no pertenece a la factura'; return; }
      if (vistos.has(r.id)) { errores[`items[${i}].item_id`] = 'ese renglón está repetido'; return; }
      vistos.add(r.id);
      if (dec(it.cantidad) > pendiente(r)) errores[`items[${i}].cantidad`] = pendiente(r) <= 0n ? 'ese renglón ya está acreditado por completo' : `se puede acreditar hasta ${cant(texto(pendiente(r), 4))}`;
      elegidos.push({ r, cantidad: it.cantidad });
    });
  }
  if (fecha < o.fecha) errores.fecha = 'la nota no puede ser anterior a la factura que acredita';
  if (Math.abs(dias(fecha, hoyISO())) > 10) errores.fecha = 'la fecha del comprobante se aparta más de 10 días de hoy [A verificar el plazo vigente en ARCA]';
  const periodo = (await c.uno('select fn_periodo_aceptado($1, $2) p', [ctx.empresaId, fecha])).p;
  if (periodo !== 'ok') errores.fecha = { sin_periodo: 'no hay un período contable abierto para esa fecha', cerrado: 'el período de esa fecha está cerrado', vencido: 'el período de esa fecha ya venció' }[periodo];
  if (Object.keys(errores).length) throw invalido(errores);
  const pv = await c.uno('select numero, sistema from punto_venta where activo and numero = $1', [o.punto_venta]);
  if (!pv) throw invalido({ comprobante_origen_id: 'el punto de venta de la factura ya no está activo' });
  if (!USABLES.includes(pv.sistema)) throw new ErrorApi(409, 'arca_pendiente', 'La emisión electrónica por ARCA todavía no está conectada: la nota se emite por un punto de venta interno.');

  const calculo = calcularVenta(elegidos.map(({ r, cantidad }) => ({
    cantidad, precio: r.precio, descPct: texto(mul(dec(r.desc_pct), dec('100')), 4), tratamiento: r.tratamiento_iva, alicuota: r.alicuota_codigo != null ? PCT_DE_CODIGO[r.alicuota_codigo] : undefined,
  })), { descPiePct: texto(mul(dec(o.desc_pie), dec('100')), 4) });
  const devolverStock = d.devolver_stock ?? true;
  const lineas = elegidos.map((e, i) => ({ ...e, importeRenglon: calculo.items[i].importeRenglon, devuelve: devolverStock && e.r.deposito_stock != null }));
  const saldo = (await c.uno('select saldo::text s from v_saldo_comprobante where comprobante_id = $1', [o.id]))?.s ?? '0';
  if (dec(calculo.impTotal) > dec(saldo)) avisos.push(dec(saldo) <= 0n ? 'La factura ya está saldada: la nota queda como saldo a favor del cliente.' : `La nota supera el saldo de la factura ($ ${saldo}): la diferencia queda como saldo a favor del cliente.`);
  return { d, o, etiquetaOrigen, fecha, tipoCodigo: CODIGO_NOTA[o.letra], letra: o.letra, pv, lineas, calculo, avisos, saldo, devolverStock };
}

const previaNota = (p) => ({
  letra: p.letra, tipo_comprobante_codigo: p.tipoCodigo, punto_venta: p.pv.numero, fecha: p.fecha, origen: { id: p.o.id, etiqueta: p.etiquetaOrigen, total: p.o.total }, cliente: { id: p.o.tercero_id, razon_social: p.o.cliente },
  items: p.lineas.map((l) => ({ item_id: l.r.id, descripcion: l.r.descripcion, cantidad: l.cantidad, precio_unitario: l.r.precio, importe_renglon: l.importeRenglon, devuelve_stock: l.devuelve })),
  ivas: p.calculo.ivas.map((v) => ({ alicuota: v.alicuota, base_imponible: v.base, importe_iva: v.iva })), imp_neto: p.calculo.impNeto, imp_iva: p.calculo.impIva, imp_tot_conc: p.calculo.impTotConc, imp_op_ex: p.calculo.impOpEx,
  imp_desc_pie: p.calculo.impDescPie, imp_total: p.calculo.impTotal, saldo_factura: p.saldo, avisos: p.avisos,
});
export async function calcularNota(c, ctx, cuerpo) { return previaNota(await prepararNota(c, ctx, cuerpo)); }

export async function emitirNota(c, ctx, cuerpo, { claveIdempotencia } = {}) {
  const huella = createHash('sha256').update(JSON.stringify(cuerpo ?? null)).update(String(ctx.usuarioId)).digest('hex');
  if (claveIdempotencia) {
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(claveIdempotencia)) throw invalido({ 'Idempotency-Key': 'tiene que tener entre 8 y 100 caracteres (letras, números, . _ : -)' });
    const previo = await c.uno('select comprobante_id, huella from api_idempotencia where clave = $1', [claveIdempotencia]);
    if (previo) {
      if (previo.huella !== huella) throw new ErrorApi(422, 'clave_reutilizada', 'Esa clave de idempotencia ya se usó con otro pedido.');
      return { comprobante: await detalleComprobante(c, previo.comprobante_id), repetido: true, avisos: [] };
    }
  }
  const p = await prepararNota(c, ctx, cuerpo), k = p.calculo, o = p.o;
  const cab = await c.uno(`insert into comprobante (empresa_id, sentido, tipo_comprobante_codigo, punto_venta, fecha, tercero_id, condicion_iva_receptor_codigo, concepto_codigo, fecha_servicio_desde, fecha_servicio_hasta,
      fecha_vto_pago, moneda, cotizacion, precios_incluyen_iva, desc_pie_pct, imp_desc_pie, imp_neto, imp_iva, imp_tot_conc, imp_op_ex, imp_trib, imp_total, observaciones, creado_por, comprobante_origen_id)
    values ($1,'venta',$2,$3,$4,$5,$6,$7,$8,$9,$10,'PES',1,false,$11,$12,$13,$14,$15,$16,0,$17,$18,$19,$20) returning id`,
    [ctx.empresaId, p.tipoCodigo, p.pv.numero, p.fecha, o.tercero_id, o.condicion_iva_receptor_codigo, o.concepto_codigo, o.fsd, o.fsh, o.fvp, o.desc_pie, k.impDescPie, k.impNeto, k.impIva, k.impTotConc, k.impOpEx, k.impTotal, p.d.motivo, ctx.usuarioId, o.id]);
  const idsItems = [];
  for (const [i, l] of p.lineas.entries()) {
    const r = await c.uno(`insert into comprobante_item (empresa_id, comprobante_id, orden, articulo_id, descripcion, cantidad, precio_unitario, desc_pct, tratamiento_iva, alicuota_codigo, importe_renglon, cuenta_id, deposito_id, item_origen_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
      [ctx.empresaId, cab.id, i + 1, l.r.articulo_id, l.r.descripcion, l.cantidad, l.r.precio, l.r.desc_pct, l.r.tratamiento_iva, l.r.alicuota_codigo, k.items[i].importeRenglon, l.r.cuenta_id, l.r.deposito_id, l.r.id]);
    idsItems.push(r.id);
  }
  for (const v of k.ivas) await c.consultar('insert into comprobante_iva (empresa_id, comprobante_id, alicuota_codigo, base_imponible, importe_iva) values ($1,$2,$3,$4,$5)', [ctx.empresaId, cab.id, v.codigo, v.base, v.iva]);
  const numero = (await c.uno('select fn_siguiente($1, $2) n', [ctx.empresaId, `cbte-${p.tipoCodigo}-${p.pv.numero}`])).n;
  await c.consultar(`update comprobante set numero = $2, estado = 'confirmado' where id = $1`, [cab.id, numero]);       // la base verifica la nota (letra, origen, cantidades) y genera el asiento invertido
  // Mercadería: vuelve al depósito de donde salió.
  const idsCosto = [];
  for (const [i, l] of p.lineas.entries()) if (l.devuelve) {
    idsCosto.push((await c.uno(`insert into movimiento_stock (empresa_id, fecha, articulo_id, deposito_id, cantidad, tipo, comprobante_item_id, motivo) values ($1,$2,$3,$4,$5,'devolucion_venta',$6,$7) returning id`,
      [ctx.empresaId, p.fecha, l.r.articulo_id, l.r.deposito_stock, l.cantidad, idsItems[i], `Devolución por nota de crédito sobre ${p.etiquetaOrigen}`.slice(0, 200)])).id);
  }
  await contabilizarCosto(c, idsCosto, { origenTipo: 'costo_comprobante', origenId: cab.id, descripcion: `Costo de ventas · devolución de mercadería (nota sobre ${p.etiquetaOrigen})`, fecha: p.fecha });
  // Se aplica a la factura hasta donde alcance su saldo; si sobra, queda como saldo a favor del cliente.
  const aplicar = dec(k.impTotal) < dec(p.saldo) ? k.impTotal : p.saldo;
  if (dec(aplicar) > 0n) await c.consultar('insert into comprobante_aplicacion (empresa_id, nota_id, factura_id, importe, fecha) values ($1,$2,$3,$4,$5)', [ctx.empresaId, cab.id, o.id, aplicar, p.fecha]);
  const cbte = await detalleComprobante(c, cab.id);
  await c.consultar(`select fn_registrar_evento('comprobantes', $1, $2, 'ok', $3, 'comprobante', $4)`,
    [`Emitió ${cbte.tipo} ${cbte.numero_formateado}`, `${o.cliente} · $ ${cbte.imp_total} · acredita ${p.etiquetaOrigen} · motivo: ${p.d.motivo}`, ctx.empresaId, cab.id]);
  if (claveIdempotencia) await c.consultar('insert into api_idempotencia (empresa_id, clave, usuario_id, huella, comprobante_id) values ($1,$2,$3,$4,$5)', [ctx.empresaId, claveIdempotencia, ctx.usuarioId, huella, cab.id]);
  return { comprobante: cbte, repetido: false, avisos: p.avisos };
}
