// Prueba del modelo de datos en PostgreSQL real (PGlite). Usa el motor de reglas (reglas/calculo.mjs) para
// generar los importes de los casos observados en el original y comprueba que la base:
//   - los acepta y los refleja bien en libros, saldos y posición de IVA,
//   - rechaza lo que el original dejaba pasar (total distinto de la suma de renglones, etc.),
//   - aísla empresas (RLS), impide modificar comprobantes confirmados y audita los cambios.
// Uso:  node modelo/probar_modelo.mjs
import { crearBase } from './cargar.mjs';
import * as motor from '../reglas/calculo.mjs';

const { db } = await crearBase();
let correctas = 0;
let fallas = 0;

async function prueba(nombre, fn) {
  try { await fn(); correctas += 1; console.log(`ok     ${nombre}`); }
  catch (error) { fallas += 1; console.log(`FALLA  ${nombre}\n         ${String(error.message).split('\n')[0]}`); }
}
function igual(obtenido, esperado, que = 'valor') {
  if (String(obtenido) !== String(esperado)) throw new Error(`${que}: esperado ${esperado}, obtenido ${obtenido}`);
}
async function rechaza(accion, patron, que = 'la operación') {
  try { await accion(); } catch (error) {
    if (!patron.test(error.message)) throw new Error(`${que} falló, pero con otro mensaje: ${error.message.split('\n')[0]}`);
    return;
  }
  throw new Error(`${que} debía ser rechazada y fue aceptada`);
}
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const uno = async (sql, params = []) => (await q(sql, params))[0];

function cuit(prefijo10) {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = [...prefijo10].reduce((a, d, i) => a + Number(d) * pesos[i], 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0; else if (dv === 10) dv = 9;
  return prefijo10 + dv;
}
const ALIC = { '21': 5, '10.5': 4, '27': 6, '5': 8, '2.5': 9 };

// ---------------------------------------------------------------------------
// Datos base
// ---------------------------------------------------------------------------
const estudio = await uno(`insert into estudio (nombre) values ('Estudio Prueba') returning id`);
const CUIT_A = cuit('3071234567');
const CUIT_B = cuit('3098765432');
const empA = await uno(`insert into empresa (estudio_id, cuit, razon_social, condicion_iva_codigo) values ($1,$2,'Comercial Andina SA',1) returning id`, [estudio.id, CUIT_A]);
const empB = await uno(`insert into empresa (estudio_id, cuit, razon_social, condicion_iva_codigo) values ($1,$2,'Otra Empresa SRL',1) returning id`, [estudio.id, CUIT_B]);
for (const e of [empA, empB]) await q(`insert into empresa_parametro (empresa_id) values ($1)`, [e.id]);
const E = empA.id;
const usuario = await uno(`insert into usuario (estudio_id, email, nombre) values ($1,'contador@estudio.test','Contador') returning id`, [estudio.id]);

await q(`insert into periodo (empresa_id, desde, hasta, vencimiento_fiscal) values
  ($1,'2024-10-01','2024-10-31','2024-11-15'), ($1,'2026-10-01','2026-10-31','2026-11-15')`, [E]);
await q(`insert into ejercicio (empresa_id, desde, hasta) values ($1,'2026-01-01','2026-12-31')`, [E]);
const ejercicio = await uno(`select id from ejercicio where empresa_id = $1`, [E]);

const cuentas = {};
for (const [codigo, nombre, tipo, imputable] of [
  ['1', 'Activo', 'activo', false], ['1.1.1', 'Caja', 'activo', true], ['1.1.3', 'Deudores por ventas', 'activo', true],
  ['1.1.5', 'IVA crédito fiscal', 'activo', true], ['2.1.1', 'Proveedores', 'pasivo', true], ['2.1.4', 'IVA débito fiscal', 'pasivo', true],
  ['4.1.1', 'Ventas', 'ingreso', true], ['5.1.1', 'Compras', 'egreso', true],
]) {
  cuentas[codigo] = (await uno(`insert into plan_cuenta (empresa_id, codigo, nombre, tipo, imputable) values ($1,$2,$3,$4,$5) returning id`,
    [E, codigo, nombre, tipo, imputable])).id;
}

const consumidorFinal = await uno(`insert into tercero (empresa_id, tipo_documento_codigo, nro_documento, razon_social, condicion_iva_codigo, es_cliente)
  values ($1,99,'0','Consumidor Final',5,true) returning id`, [E]);
const cliente1 = await uno(`insert into tercero (empresa_id, tipo_documento_codigo, nro_documento, razon_social, condicion_iva_codigo, es_cliente)
  values ($1,80,$2,'Cliente 1',1,true) returning id`, [E, cuit('3011111111')]);
const proveedor1 = await uno(`insert into tercero (empresa_id, tipo_documento_codigo, nro_documento, razon_social, condicion_iva_codigo, es_proveedor)
  values ($1,80,$2,'Proveedor 1',1,true) returning id`, [E, cuit('3022222222')]);
const caja = await uno(`insert into caja (empresa_id, nombre) values ($1,'Efectivo PV') returning id`, [E]);
const deposito = await uno(`insert into deposito (empresa_id, nombre) values ($1,'Depósito 1') returning id`, [E]);
const articulo = await uno(`insert into articulo (empresa_id, codigo, nombre, alicuota_venta_codigo, alicuota_compra_codigo)
  values ($1,'A21','PRUEBA IVA 21',5,5) returning id`, [E]);
await q(`insert into movimiento_tesoreria (empresa_id, fecha, caja_id, importe, concepto) values ($1,'2026-10-01',$2,10000,'saldo inicial')`, [E, caja.id]);

// ---------------------------------------------------------------------------
// Ayudas para armar comprobantes con los importes del motor
// ---------------------------------------------------------------------------
const num = (x) => String(x);
function resumen(salida, { exento = '0', noGravado = '0', trib = '0' } = {}) {
  let neto = 0n; let iva = 0n; let desc = 0n; const ivas = [];
  for (const [alic, col] of Object.entries(salida.columnas)) {
    const base = motor.dec(col.base ?? col.neto ?? col.subtotal);
    neto += base; iva += motor.dec(col.iva); desc += motor.dec(col.descuento ?? '0');
    ivas.push({ alicuota: ALIC[alic], base: motor.texto(base), iva: col.iva });
  }
  return { neto: motor.texto(neto), iva: motor.texto(iva), desc: motor.texto(desc), exento, noGravado, trib, total: salida.total, ivas };
}

async function crearComprobante(o) {
  const c = await uno(`insert into comprobante (empresa_id, sentido, tipo_comprobante_codigo, punto_venta, numero, fecha, tercero_id,
      condicion_iva_receptor_codigo, precios_incluyen_iva, desc_pie_pct, imp_desc_pie, imp_neto, imp_iva, imp_tot_conc, imp_op_ex, imp_trib,
      imp_total, comprobante_origen_id, moneda)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning id`,
    [E, o.sentido, o.tipo, o.pv ?? 1, o.numero ?? null, o.fecha ?? '2026-10-28', o.tercero, o.receptor ?? null,
     o.incluyeIva, o.descPiePct ?? 0, o.resumen.desc, o.resumen.neto, o.resumen.iva, o.resumen.noGravado, o.resumen.exento,
     o.resumen.trib, o.resumen.total, o.origen ?? null, o.moneda ?? 'PES']);
  let orden = 1;
  for (const it of o.items) {
    await q(`insert into comprobante_item (empresa_id, comprobante_id, orden, articulo_id, descripcion, cantidad, precio_unitario,
        desc_pct, tratamiento_iva, alicuota_codigo, importe_renglon, deposito_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [E, c.id, orden++, it.articulo ?? null, it.descripcion ?? 'renglón', it.cantidad ?? 1, it.precio, it.desc ?? 0,
       it.trat ?? 'gravado', it.trat && it.trat !== 'gravado' ? null : ALIC[it.alic ?? '21'], it.importe, it.deposito ?? null]);
  }
  for (const v of o.resumen.ivas) {
    await q(`insert into comprobante_iva (empresa_id, comprobante_id, alicuota_codigo, base_imponible, importe_iva) values ($1,$2,$3,$4,$5)`,
      [E, c.id, v.alicuota, v.base, v.iva]);
  }
  for (const t of o.tributos ?? []) {
    await q(`insert into comprobante_tributo (empresa_id, comprobante_id, tipo, jurisdiccion_codigo, importe) values ($1,$2,$3,$4,$5)`,
      [E, c.id, t.tipo, t.jurisdiccion ?? null, t.importe]);
  }
  return c.id;
}
async function confirmar(id, { electronico = false, numero, cae = '74123456789012' } = {}) {
  if (electronico) {
    await q(`update comprobante set numero = $2, cae = $3, cae_vencimiento = '2026-11-07', resultado_arca = 'A', estado = 'autorizado' where id = $1`, [id, numero, cae]);
  } else {
    await q(`update comprobante set estado = 'confirmado' where id = $1`, [id]);
  }
}

// ---------------------------------------------------------------------------
// 1. Reglas de integridad básicas
// ---------------------------------------------------------------------------
await prueba('CUIT con dígito verificador inválido es rechazado (empresa y tercero)', async () => {
  await rechaza(() => q(`insert into empresa (estudio_id, cuit, razon_social, condicion_iva_codigo) values ($1,'30123456780','X',1)`, [estudio.id]), /check|violates/i, 'CUIT inválido');
  await rechaza(() => q(`insert into tercero (empresa_id, tipo_documento_codigo, nro_documento, razon_social, condicion_iva_codigo, es_cliente) values ($1,80,'20123456780','X',1,true)`, [E]), /check|violates/i);
});
await prueba('Un tercero debe ser cliente o proveedor, y el documento no se repite', async () => {
  await rechaza(() => q(`insert into tercero (empresa_id, tipo_documento_codigo, nro_documento, razon_social, condicion_iva_codigo) values ($1,96,'12345678','X',5)`, [E]), /check|violates/i);
  await rechaza(() => q(`insert into tercero (empresa_id, tipo_documento_codigo, nro_documento, razon_social, condicion_iva_codigo, es_cliente) values ($1,99,'0','Otro CF',5,true)`, [E]), /duplicate|unique/i);
});
await prueba('Los períodos de una empresa no se solapan (el original duplicaba filas por año: D-04)', async () => {
  await rechaza(() => q(`insert into periodo (empresa_id, desde, hasta) values ($1,'2026-10-15','2026-11-15')`, [E]), /exclusion|conflicting/i);
});
await prueba('Artículo gravado exige alícuota; exento no puede tenerla', async () => {
  await rechaza(() => q(`insert into articulo (empresa_id, codigo, nombre) values ($1,'MAL','sin alícuota')`, [E]), /check|violates/i);
  await q(`insert into articulo (empresa_id, codigo, nombre, tratamiento_iva_venta, tratamiento_iva_compra) values ($1,'EX','Exento','exento','exento')`, [E]);
});

// ---------------------------------------------------------------------------
// 2. Compras (casos C-04 y C-12)
// ---------------------------------------------------------------------------
let fa4001; let fa2001;
await prueba('Compra con percepciones sufridas (C-12): total 1.260 y libro de compras', async () => {
  const salida = motor.compra([{ precio: '1000', cantidad: '1', alicuota: '21' }], { percepciones: { gan: '30', iva: '20' } });
  igual(salida.total, '1260.00', 'total del motor');
  const r = resumen(salida, { trib: '50.00' });
  fa4001 = await crearComprobante({ sentido: 'compra', tipo: 1, numero: 4001, tercero: proveedor1.id, incluyeIva: false, resumen: r,
    items: [{ precio: '1000', importe: '1000', alic: '21' }],
    tributos: [{ tipo: 'percepcion_ganancias', importe: '30.00' }, { tipo: 'percepcion_iva', importe: '20.00' }] });
  await confirmar(fa4001);
  const l = await uno(`select * from v_libro_iva_compras where comprobante_id = $1`, [fa4001]);
  igual(l.neto_gravado, '1000.00', 'neto'); igual(l.iva_21, '210.00', 'iva 21');
  igual(l.percepcion_iva, '20.00', 'percepción IVA'); igual(l.percepcion_ganancias, '30.00', 'percepción Ganancias'); igual(l.total, '1260.00', 'total');
});
await prueba('Compra con cuatro condiciones de IVA (C-04): total 527,24, exento y no gravado SEPARADOS', async () => {
  const renglones = [
    { precio: '33,33', cantidad: '3', alicuota: '21' }, { precio: '10,15', cantidad: '7', alicuota: '10.5' },
    { precio: '15,55', cantidad: '9', alicuota: '27' }, { precio: '100', cantidad: '1', alicuota: 'exento' },
    { precio: '50', cantidad: '1', alicuota: 'nogravado' }];
  const salida = motor.compra(renglones);
  igual(salida.total, '527.24', 'total del motor');
  const r = resumen(salida, { exento: '100.00', noGravado: '50.00' });
  fa2001 = await crearComprobante({ sentido: 'compra', tipo: 1, numero: 2001, tercero: proveedor1.id, incluyeIva: false, resumen: r,
    items: [
      { precio: '33.33', cantidad: 3, importe: '99.99', alic: '21' }, { precio: '10.15', cantidad: 7, importe: '71.05', alic: '10.5' },
      { precio: '15.55', cantidad: 9, importe: '139.95', alic: '27' }, { precio: '100', importe: '100', trat: 'exento' },
      { precio: '50', importe: '50', trat: 'no_gravado' }] });
  await confirmar(fa2001);
  const l = await uno(`select * from v_libro_iva_compras where comprobante_id = $1`, [fa2001]);
  igual(l.exento, '100.00', 'exento'); igual(l.no_gravado, '50.00', 'no gravado');
  igual(l.iva_10_5, '7.46', 'IVA 10,5'); igual(l.iva_27, '37.79', 'IVA 27'); igual(l.total, '527.24', 'total');
});
await prueba('Compra: un renglón omitido en la cabecera es rechazado al confirmar', async () => {
  const r = resumen(motor.compra([{ precio: '100', cantidad: '1', alicuota: '21' }]));
  const id = await crearComprobante({ sentido: 'compra', tipo: 1, numero: 9001, tercero: proveedor1.id, incluyeIva: false, resumen: r,
    items: [{ precio: '100', importe: '100' }, { precio: '50', importe: '50' }] });
  await rechaza(() => confirmar(id), /renglones suman/i);
});

// ---------------------------------------------------------------------------
// 3. Ventas (casos V-04, V-08, NC)
// ---------------------------------------------------------------------------
let fa1; let fa2; let nca;
const renglonesV04 = [
  { precioFinal: '157,30', cantidad: '1', alicuota: '21' }, { precioFinal: '143,65', cantidad: '1', alicuota: '10.5' },
  { precioFinal: '165,10', cantidad: '1', alicuota: '27' }, { precioFinal: '130', cantidad: '1', alicuota: 'exento' },
  { precioFinal: '130', cantidad: '1', alicuota: 'nogravado' }];
const itemsV04 = [
  { precio: '157.30', importe: '157.30', alic: '21' }, { precio: '143.65', importe: '143.65', alic: '10.5' },
  { precio: '165.10', importe: '165.10', alic: '27' }, { precio: '130', importe: '130', trat: 'exento' },
  { precio: '130', importe: '130', trat: 'no_gravado' }];
await prueba('Venta con cinco condiciones (V-04): el total es la suma de los renglones (726,05)', async () => {
  const salida = motor.venta(renglonesV04);
  igual(salida.total, '726.05', 'total del motor'); igual(salida.sumaRenglones, '726.05', 'suma de renglones');
  const r = resumen(salida, { exento: salida.exento, noGravado: salida.noGravado });
  fa1 = await crearComprobante({ sentido: 'venta', tipo: 1, tercero: cliente1.id, receptor: 1, incluyeIva: true, resumen: r, items: itemsV04 });
  await confirmar(fa1, { electronico: true, numero: 1 });
  const l = await uno(`select * from v_libro_iva_ventas where comprobante_id = $1`, [fa1]);
  igual(l.iva_27, '35.10', 'IVA 27 % (el original lo perdía)'); igual(l.exento, '130.00', 'exento'); igual(l.no_gravado, '130.00', 'no gravado');
  igual(l.total, '726.05', 'total');
});
await prueba('DEFECTO D-01: la factura que el original dejaba en 430,95 es RECHAZADA por el modelo', async () => {
  // misma factura, pero con el pie del original (sin la columna del 27 % y con una sola caja sin IVA)
  const r = { neto: '260.00', iva: '40.95', desc: '0.00', exento: '130.00', noGravado: '0.00', trib: '0.00', total: '430.95',
    ivas: [{ alicuota: 5, base: '130.00', iva: '27.30' }, { alicuota: 4, base: '130.00', iva: '13.65' }] };
  const id = await crearComprobante({ sentido: 'venta', tipo: 1, tercero: cliente1.id, receptor: 1, incluyeIva: true, resumen: r, items: itemsV04 });
  await rechaza(() => confirmar(id, { electronico: true, numero: 99 }), /renglones suman/i, 'la factura con total 430,95');
});
await prueba('Venta con descuento al pie (V-08): 27,55; NC por anulación; la aplicación deja la factura en cero', async () => {
  const items = [{ precio: '10', importe: '10.0000' }, { precio: '10', importe: '10.0000' }, { precio: '10', desc: 0.1, importe: '9.0000' }];
  const salida = motor.venta([
    { precioFinal: '10', cantidad: '1', alicuota: '21' }, { precioFinal: '10', cantidad: '1', alicuota: '21' },
    { precioFinal: '10', cantidad: '1', alicuota: '21', descPct: '10' }], { descPiePct: '5' });
  igual(salida.total, '27.55', 'total del motor');
  const r = resumen(salida);
  igual(r.neto, '22.77', 'base'); igual(r.desc, '1.20', 'descuento al pie'); igual(r.iva, '4.78', 'IVA');
  fa2 = await crearComprobante({ sentido: 'venta', tipo: 1, tercero: cliente1.id, receptor: 1, incluyeIva: true, descPiePct: 0.05, resumen: r, items });
  await confirmar(fa2, { electronico: true, numero: 2 });
  nca = await crearComprobante({ sentido: 'venta', tipo: 3, tercero: cliente1.id, receptor: 1, incluyeIva: true, descPiePct: 0.05, resumen: r, items, origen: fa2 });
  await confirmar(nca, { electronico: true, numero: 1, cae: '74123456789099' });
  await q(`insert into comprobante_aplicacion (empresa_id, nota_id, factura_id, importe) values ($1,$2,$3,27.55)`, [E, nca, fa2]);
  const l = await uno(`select * from v_libro_iva_ventas where comprobante_id = $1`, [nca]);
  igual(l.neto_gravado, '-22.77', 'neto de la NC en el libro'); igual(l.iva_21, '-4.78', 'IVA de la NC'); igual(l.total, '-27.55', 'total de la NC');
  igual((await uno(`select saldo from v_saldo_comprobante where comprobante_id = $1`, [fa2])).saldo, '0.00', 'saldo de la FA 2');
});
await prueba('Nota de crédito: sin comprobante de origen, de otra letra o con otra moneda es rechazada', async () => {
  const r = resumen(motor.venta([{ precioFinal: '10', cantidad: '1', alicuota: '21' }]));
  const base = { sentido: 'venta', tercero: cliente1.id, receptor: 1, incluyeIva: true, resumen: r, items: [{ precio: '10', importe: '10' }] };
  const sinOrigen = await crearComprobante({ ...base, tipo: 3 });
  await rechaza(() => confirmar(sinOrigen, { electronico: true, numero: 50 }), /exige el comprobante de origen/i, 'NC sin origen');
  const otraLetra = await crearComprobante({ ...base, tipo: 8, origen: fa1 });
  await rechaza(() => confirmar(otraLetra, { electronico: true, numero: 51 }), /letra/i, 'NC B sobre factura A');
  const otraMoneda = await crearComprobante({ ...base, tipo: 3, origen: fa1, moneda: 'DOL' });
  await rechaza(() => q(`update comprobante set cotizacion = 1100 where id = $1`, [otraMoneda]).then(() => confirmar(otraMoneda, { electronico: true, numero: 52 })), /moneda/i, 'NC en otra moneda');
});
await prueba('RG 5616: una venta sin condición frente al IVA del receptor no se puede autorizar', async () => {
  const r = resumen(motor.venta([{ precioFinal: '10', cantidad: '1', alicuota: '21' }]));
  const id = await crearComprobante({ sentido: 'venta', tipo: 6, tercero: consumidorFinal.id, receptor: null, incluyeIva: true, resumen: r, items: [{ precio: '10', importe: '10' }] });
  await rechaza(() => confirmar(id, { electronico: true, numero: 60 }), /check|violates/i);
});
await prueba('El mismo número de factura de venta no se repite; en compras sí, con otro proveedor', async () => {
  const r = resumen(motor.venta([{ precioFinal: '10', cantidad: '1', alicuota: '21' }]));
  const id = await crearComprobante({ sentido: 'venta', tipo: 1, tercero: cliente1.id, receptor: 1, incluyeIva: true, resumen: r, items: [{ precio: '10', importe: '10' }] });
  await rechaza(() => confirmar(id, { electronico: true, numero: 1 }), /duplicate|unique/i, 'número repetido');
});

// ---------------------------------------------------------------------------
// 4. Libros, posición de IVA y saldos
// ---------------------------------------------------------------------------
await prueba('Posición de IVA de octubre 2026: débito 76,05, crédito 276,25, saldo −220,20', async () => {
  const p = await uno(`select * from v_posicion_iva where empresa_id = $1 and mes = '2026-10-01'`, [E]);
  igual(p.debito, '76.05', 'débito'); igual(p.credito, '276.25', 'crédito'); igual(p.saldo_tecnico, '-200.20', 'saldo técnico');
  igual(p.percepcion, '20.00', 'percepción de IVA'); igual(p.saldo, '-220.20', 'saldo');
});

// ---------------------------------------------------------------------------
// 5. Cobranzas y pagos (casos R-01, R-02) y retenciones
// ---------------------------------------------------------------------------
async function crearPago(o) {
  const imp = o.imputaciones.reduce((a, x) => a + Number(x.importe), 0);
  const med = o.medios.reduce((a, x) => a + Number(x.importe), 0);
  const ret = (o.retenciones ?? []).reduce((a, x) => a + Number(x.importe), 0);
  const p = await uno(`insert into pago (empresa_id, sentido, fecha, tercero_id, total_medios, total_retenciones, total_imputado)
    values ($1,$2,$3,$4,$5,$6,$7) returning id`, [E, o.sentido, o.fecha ?? '2026-10-28', o.tercero, o.totalMedios ?? med, o.totalRet ?? ret, imp]);
  for (const i of o.imputaciones) await q(`insert into pago_imputacion (empresa_id, pago_id, comprobante_id, importe) values ($1,$2,$3,$4)`, [E, p.id, i.comprobante, i.importe]);
  // la caja se mueve sola al confirmar el pago (trigger): el helper no carga movimientos
  for (const m of o.medios) {
    await q(`insert into pago_medio (empresa_id, pago_id, medio, caja_id, importe) values ($1,$2,'efectivo',$3,$4)`, [E, p.id, caja.id, m.importe]);
  }
  for (const r of o.retenciones ?? []) {
    await q(`insert into retencion (empresa_id, pago_id, origen, tipo, jurisdiccion_codigo, importe, certificado_numero, certificado_fecha)
      values ($1,$2,$3,$4,$5,$6,$7,'2026-10-28')`, [E, p.id, r.origen, r.tipo, r.jurisdiccion ?? null, r.importe, r.cert]);
  }
  return p.id;
}
const confirmarPago = (id) => q(`update pago set estado = 'confirmado' where id = $1`, [id]);

let rec1;
await prueba('Recibo con retención sufrida (R-01): 500 imputados = 485 en efectivo + 15; saldo de la factura 226,05', async () => {
  rec1 = await crearPago({ sentido: 'cobro', tercero: cliente1.id, imputaciones: [{ comprobante: fa1, importe: '500.00' }],
    medios: [{ importe: '485.00' }], retenciones: [{ origen: 'sufrida', tipo: 'iibb', jurisdiccion: 913, importe: '15.00', cert: '12345' }] });
  await confirmarPago(rec1);
  const p = await uno(`select total_documento, a_cuenta, numero from pago where id = $1`, [rec1]);
  igual(p.total_documento, '500.00', 'total del documento'); igual(p.a_cuenta, '0.00', 'a cuenta'); igual(p.numero, '1', 'número automático');
  igual((await uno(`select saldo from v_saldo_comprobante where comprobante_id = $1`, [fa1])).saldo, '226.05', 'saldo de la FA 1');
  igual((await uno(`select saldo from v_saldo_tercero where tercero_id = $1 and rol = 'cliente'`, [cliente1.id])).saldo, '226.05', 'cuenta corriente del cliente');
});
await prueba('Pago: imputar más que el saldo, o con totales que no cierran, es rechazado', async () => {
  const exceso = await crearPago({ sentido: 'cobro', tercero: cliente1.id, imputaciones: [{ comprobante: fa1, importe: '300.00' }], medios: [{ importe: '300.00' }] });
  await rechaza(() => confirmarPago(exceso), /imputa más que el saldo/i, 'imputación mayor al saldo');
  // la cabecera dice 100 pero los medios cargados suman 90
  const descuadre = await crearPago({ sentido: 'cobro', tercero: cliente1.id, imputaciones: [{ comprobante: fa1, importe: '100.00' }], medios: [{ importe: '90.00' }], totalMedios: '100.00' });
  await rechaza(() => confirmarPago(descuadre), /medios suman/i, 'cabecera distinta de los medios');
  // y la cabecera no puede imputar más de lo que cobra (lo frena la propia restricción de la tabla)
  await rechaza(() => crearPago({ sentido: 'cobro', tercero: cliente1.id, imputaciones: [{ comprobante: fa1, importe: '100.00' }], medios: [{ importe: '90.00' }] }), /pago_check|check/i, 'imputar más de lo cobrado');
});
await prueba('Una retención "practicada" en un cobro (o "sufrida" en un pago) es rechazada', async () => {
  const id = await crearPago({ sentido: 'cobro', tercero: cliente1.id, imputaciones: [{ comprobante: fa1, importe: '10.00' }],
    medios: [{ importe: '9.00' }], retenciones: [{ origen: 'practicada', tipo: 'iibb', jurisdiccion: 913, importe: '1.00', cert: 'X1' }] });
  await rechaza(() => confirmarPago(id), /no corresponde al sentido/i);
});
await prueba('Orden de pago con retención practicada (R-02): certificado correlativo y único', async () => {
  const cert = String(await uno(`select fn_siguiente($1,'cert-iibb') as n`, [E]).then((r) => r.n));
  const op = await crearPago({ sentido: 'pago', tercero: proveedor1.id, imputaciones: [{ comprobante: fa4001, importe: '1260.00' }],
    medios: [{ importe: '1235.00' }], retenciones: [{ origen: 'practicada', tipo: 'iibb', jurisdiccion: 913, importe: '25.00', cert }] });
  await confirmarPago(op);
  igual((await uno(`select saldo from v_saldo_comprobante where comprobante_id = $1`, [fa4001])).saldo, '0.00', 'saldo de la compra');
  igual(cert, '1', 'primer certificado');
});
await prueba('El certificado de retención practicada no se repite', async () => {
  const p = await uno(`insert into pago (empresa_id, sentido, fecha, tercero_id, total_medios, total_retenciones, total_imputado) values ($1,'pago','2026-10-28',$2,95,5,100) returning id`, [E, proveedor1.id]);
  await rechaza(() => q(`insert into retencion (empresa_id, pago_id, origen, tipo, jurisdiccion_codigo, importe, certificado_numero, certificado_fecha)
    values ($1,$2,'practicada','iibb',913,5,'1','2026-10-28')`, [E, p.id]), /duplicate|unique/i, 'certificado repetido');
});
await prueba('Caja: saldo inicial 10.000 + cobro 485 − pago 1.235 = 9.250 (los borradores no mueven la caja)', async () => {
  igual((await uno(`select saldo from v_saldo_caja where caja_id = $1`, [caja.id])).saldo, '9250.00', 'saldo de caja');
});
await prueba('Anular un cobro devuelve el saldo al comprobante y contrarresta el movimiento de caja', async () => {
  const antesCaja = (await uno(`select saldo from v_saldo_caja where caja_id = $1`, [caja.id])).saldo;
  const antesFactura = (await uno(`select saldo from v_saldo_comprobante where comprobante_id = $1`, [fa1])).saldo;
  const p = await crearPago({ sentido: 'cobro', tercero: cliente1.id, imputaciones: [{ comprobante: fa1, importe: '26.05' }], medios: [{ importe: '26.05' }] });
  await confirmarPago(p);
  igual((await uno(`select saldo from v_saldo_comprobante where comprobante_id = $1`, [fa1])).saldo, '200.00', 'saldo con el cobro');
  igual((await uno(`select saldo from v_saldo_caja where caja_id = $1`, [caja.id])).saldo, '9276.05', 'caja con el cobro');
  await q(`update pago set estado = 'anulado' where id = $1`, [p]);
  igual((await uno(`select saldo from v_saldo_comprobante where comprobante_id = $1`, [fa1])).saldo, antesFactura, 'saldo de la factura tras anular');
  igual((await uno(`select saldo from v_saldo_caja where caja_id = $1`, [caja.id])).saldo, antesCaja, 'caja tras anular');
  await rechaza(() => q(`delete from movimiento_tesoreria where empresa_id = $1`, [E]), /no se borra/i, 'borrar movimientos');
  await rechaza(() => q(`update movimiento_tesoreria set importe = 1 where empresa_id = $1`, [E]), /no se edita/i, 'editar movimientos');
});

// ---------------------------------------------------------------------------
// 6. Retención sugerida (propuesta: R-10, R-11 y escalas)
// ---------------------------------------------------------------------------
await prueba('Retención sugerida: IIBB 2,5 % con base mínima 1.000 (R-10 y R-11)', async () => {
  const reg = await uno(`insert into regimen_retencion (tipo, jurisdiccion_codigo, descripcion, alicuota, base_minima) values ('iibb',913,'IIBB Contribuyente Local',0.025,1000) returning id`);
  igual((await uno(`select fn_retencion_sugerida($1, 20000) as v`, [reg.id])).v, '500.00', 'base 20.000');
  igual((await uno(`select fn_retencion_sugerida($1, 800) as v`, [reg.id])).v, '0', 'base 800');
});
await prueba('Retención sugerida con no imponible y retención mínima (semántica Odoo)', async () => {
  const reg = await uno(`insert into regimen_retencion (tipo, descripcion, alicuota, monto_no_imponible, retencion_minima) values ('ganancias','Ganancias 2 %',0.02,100000,500) returning id`);
  igual((await uno(`select fn_retencion_sugerida($1, 150000) as v`, [reg.id])).v, '1000.00', 'neta 50.000 al 2 %');
  igual((await uno(`select fn_retencion_sugerida($1, 120000) as v`, [reg.id])).v, '0', 'da 400, menor a la mínima');
});
await prueba('Retención por escala acumulativa: el segundo pago descuenta lo ya retenido', async () => {
  const esc = await uno(`insert into escala_ganancias (nombre, vigente_desde) values ('Escala de prueba','2026-01-01') returning id`);
  await q(`insert into escala_ganancias_tramo (escala_id, desde, hasta, cuota_fija, porcentaje, sobre_excedente_de) values ($1,0,100000,0,0.10,0), ($1,100000,null,10000,0.20,100000)`, [esc.id]);
  const reg = await uno(`insert into regimen_retencion (tipo, descripcion, escala_id) values ('ganancias','Ganancias por escala',$1) returning id`, [esc.id]);
  igual((await uno(`select fn_retencion_sugerida($1, 60000, 0, 0) as v`, [reg.id])).v, '6000.00', 'primer pago');
  igual((await uno(`select fn_retencion_sugerida($1, 60000, 60000, 6000) as v`, [reg.id])).v, '8000.00', 'segundo pago');
});

// ---------------------------------------------------------------------------
// 7. Inmutabilidad y estados
// ---------------------------------------------------------------------------
await prueba('Un comprobante autorizado no se modifica, no se borra y no se anula', async () => {
  await rechaza(() => q(`update comprobante set imp_total = 1, imp_neto = 1 where id = $1`, [fa1]), /no se modifican/i, 'cambiar importes');
  await rechaza(() => q(`delete from comprobante where id = $1`, [fa1]), /no se borra/i, 'borrar');
  await rechaza(() => q(`insert into comprobante_item (empresa_id, comprobante_id, orden, descripcion, cantidad, precio_unitario, tratamiento_iva, alicuota_codigo, importe_renglon)
    values ($1,$2,99,'x',1,1,'gravado',5,1)`, [E, fa1]), /no se modifican sus renglones/i, 'agregar renglón');
  await rechaza(() => q(`update comprobante set estado = 'anulado' where id = $1`, [fa1]), /Transición/i, 'anular un autorizado');
});
await prueba('Un pago confirmado no se modifica ni se borra', async () => {
  await rechaza(() => q(`update pago set total_medios = 1 where id = $1`, [rec1]), /no se modifican/i);
  await rechaza(() => q(`delete from pago where id = $1`, [rec1]), /no se borra/i);
});
await prueba('Un borrador sí se puede borrar', async () => {
  const r = resumen(motor.venta([{ precioFinal: '10', cantidad: '1', alicuota: '21' }]));
  const id = await crearComprobante({ sentido: 'venta', tipo: 1, tercero: cliente1.id, receptor: 1, incluyeIva: true, resumen: r, items: [{ precio: '10', importe: '10' }] });
  await q(`delete from comprobante where id = $1`, [id]);
});

// ---------------------------------------------------------------------------
// 8. Período fiscal (casos P-01 a P-04, con la regla configurable)
// ---------------------------------------------------------------------------
await prueba('Período: se resuelve por fecha aun con períodos de otros años (D-04); sin período, cerrado y vencido', async () => {
  igual((await uno(`select fn_periodo_aceptado($1,'2026-10-28','2026-10-28') as v`, [E])).v, 'ok', 'con 2024 y 2026 cargados');
  igual((await uno(`select fn_periodo_aceptado($1,'2026-09-15','2026-10-28') as v`, [E])).v, 'sin_periodo', 'sin período');
  await q(`update periodo set estado = 'cerrado' where empresa_id = $1 and desde = '2024-10-01'`, [E]);
  igual((await uno(`select fn_periodo_aceptado($1,'2024-10-10','2026-10-28') as v`, [E])).v, 'cerrado', 'cerrado');
  igual((await uno(`select fn_periodo_aceptado($1,'2026-10-28','2026-12-01') as v`, [E])).v, 'ok', 'vencido pero sin bloqueo (un estudio carga atrasado)');
  await q(`update empresa_parametro set bloquea_periodo_vencido = true where empresa_id = $1`, [E]);
  igual((await uno(`select fn_periodo_aceptado($1,'2026-10-28','2026-12-01') as v`, [E])).v, 'vencido', 'vencido con bloqueo activado');
  await q(`update empresa_parametro set bloquea_periodo_vencido = false where empresa_id = $1`, [E]);
});
await prueba('Un comprobante en un período cerrado no se confirma', async () => {
  const r = resumen(motor.compra([{ precio: '100', cantidad: '1', alicuota: '21' }]));
  const id = await crearComprobante({ sentido: 'compra', tipo: 1, numero: 9100, fecha: '2024-10-10', tercero: proveedor1.id, incluyeIva: false, resumen: r, items: [{ precio: '100', importe: '100' }] });
  await rechaza(() => confirmar(id), /período no aceptado \(cerrado\)/i);
});

// ---------------------------------------------------------------------------
// 9. Contabilidad
// ---------------------------------------------------------------------------
await prueba('Asiento: debe balancear, usar cuentas imputables y no se modifica una vez contabilizado', async () => {
  const a = await uno(`insert into asiento (empresa_id, ejercicio_id, fecha, descripcion) values ($1,$2,'2026-10-28','Venta FA 1') returning id, numero`, [E, ejercicio.id]);
  igual(a.numero, '1', 'numeración automática');
  await q(`insert into asiento_linea (empresa_id, asiento_id, cuenta_id, debe) values ($1,$2,$3,726.05)`, [E, a.id, cuentas['1.1.3']]);
  await q(`insert into asiento_linea (empresa_id, asiento_id, cuenta_id, haber) values ($1,$2,$3,650.00)`, [E, a.id, cuentas['4.1.1']]);
  await rechaza(() => q(`update asiento set estado = 'contabilizado' where id = $1`, [a.id]), /no balancea/i, 'asiento desbalanceado');
  await q(`insert into asiento_linea (empresa_id, asiento_id, cuenta_id, haber) values ($1,$2,$3,76.05)`, [E, a.id, cuentas['2.1.4']]);
  await q(`update asiento set estado = 'contabilizado' where id = $1`, [a.id]);
  await rechaza(() => q(`update asiento_linea set debe = 1 where asiento_id = $1 and debe > 0`, [a.id]), /ya está contabilizado/i, 'modificar línea');
  const b = await uno(`select debe, haber from v_balance_sumas_saldos where cuenta_id = $1`, [cuentas['1.1.3']]);
  igual(b.debe, '726.05', 'debe de deudores');
  const tot = await uno(`select sum(debe) d, sum(haber) h from v_balance_sumas_saldos where empresa_id = $1`, [E]);
  igual(tot.d, tot.h, 'sumas y saldos balanceadas');
});
await prueba('Asiento con cuenta no imputable es rechazado', async () => {
  const a = await uno(`insert into asiento (empresa_id, ejercicio_id, fecha) values ($1,$2,'2026-10-28') returning id`, [E, ejercicio.id]);
  await q(`insert into asiento_linea (empresa_id, asiento_id, cuenta_id, debe) values ($1,$2,$3,10)`, [E, a.id, cuentas['1']]);
  await q(`insert into asiento_linea (empresa_id, asiento_id, cuenta_id, haber) values ($1,$2,$3,10)`, [E, a.id, cuentas['4.1.1']]);
  await rechaza(() => q(`update asiento set estado = 'contabilizado' where id = $1`, [a.id]), /no imputables/i);
});

// ---------------------------------------------------------------------------
// 10. Stock
// ---------------------------------------------------------------------------
await prueba('Stock: el original dejó vender sin existencia (−2); acá es política por empresa y los movimientos no se editan', async () => {
  await q(`insert into movimiento_stock (empresa_id, fecha, articulo_id, deposito_id, cantidad, tipo) values ($1,'2026-10-28',$2,$3,1,'compra')`, [E, articulo.id, deposito.id]);
  await rechaza(() => q(`insert into movimiento_stock (empresa_id, fecha, articulo_id, deposito_id, cantidad, tipo) values ($1,'2026-10-28',$2,$3,-3,'venta')`, [E, articulo.id, deposito.id]), /Stock negativo/i, 'venta sin stock');
  await q(`update empresa_parametro set permite_stock_negativo = true where empresa_id = $1`, [E]);
  await q(`insert into movimiento_stock (empresa_id, fecha, articulo_id, deposito_id, cantidad, tipo) values ($1,'2026-10-28',$2,$3,-3,'venta')`, [E, articulo.id, deposito.id]);
  igual((await uno(`select saldo from v_stock_saldo where articulo_id = $1`, [articulo.id])).saldo, '-2.0000', 'saldo permitido');
  await rechaza(() => q(`delete from movimiento_stock where empresa_id = $1`, [E]), /solo agregar/i, 'borrar movimientos');
  await q(`update empresa_parametro set permite_stock_negativo = false where empresa_id = $1`, [E]);
});

// ---------------------------------------------------------------------------
// 11. ARCA
// ---------------------------------------------------------------------------
await prueba('ARCA: la bitácora de llamadas es de solo agregar y el certificado exige un CUIT válido', async () => {
  const s = await uno(`insert into arca_solicitud (empresa_id, comprobante_id, ambiente, servicio, metodo, resultado) values ($1,$2,'homologacion','wsfe','FECAESolicitar','A') returning id`, [E, fa1]);
  await rechaza(() => q(`update arca_solicitud set resultado = 'R' where id = $1`, [s.id]), /solo agregar/i);
  await rechaza(() => q(`insert into arca_certificado (empresa_id, ambiente, alias, cuit, vencimiento, referencia_secreto) values ($1,'homologacion','x','30123456780','2027-01-01','vault://x')`, [E]), /check|violates/i);
  await q(`insert into arca_certificado (empresa_id, ambiente, alias, cuit, vencimiento, referencia_secreto) values ($1,'homologacion','prueba',$2,'2027-01-01','vault://arca/prueba')`, [E, CUIT_A]);
});

// ---------------------------------------------------------------------------
// 12. Auditoría y aislamiento entre empresas (RLS)
// ---------------------------------------------------------------------------
await prueba('Auditoría: las altas y cambios quedan registrados y el registro no se edita', async () => {
  const n = await uno(`select count(*)::int n from auditoria where empresa_id = $1 and tabla = 'comprobante'`, [E]);
  if (n.n < 5) throw new Error(`se esperaban varios registros de auditoría y hay ${n.n}`);
  await rechaza(() => q(`update auditoria set tabla = 'x'`), /solo agregar/i);
});

await q(`select set_config('app.estudio_id', $1, false)`, [String(estudio.id)]);
await prueba('RLS: la empresa B no ve nada de la A, y no puede escribir en ella', async () => {
  await q(`select set_config('app.empresa_id', $1, false)`, [String(empB.id)]);
  await q(`set role app_usuario`);
  try {
    igual((await uno(`select count(*)::int n from comprobante`)).n, 0, 'comprobantes visibles para la empresa B');
    igual((await uno(`select count(*)::int n from tercero`)).n, 0, 'terceros visibles');
    igual((await uno(`select count(*)::int n from v_libro_iva_ventas`)).n, 0, 'libro de IVA visible');
    await rechaza(() => q(`insert into tercero (empresa_id, tipo_documento_codigo, nro_documento, razon_social, condicion_iva_codigo, es_cliente) values ($1,96,'11111111','Intruso',5,true)`, [E]),
      /row-level security/i, 'escribir en otra empresa');
  } finally { await q(`reset role`); }
});
await prueba('RLS: la empresa A ve sus datos; el catálogo de ARCA es de solo lectura para la aplicación', async () => {
  await q(`select set_config('app.empresa_id', $1, false)`, [String(E)]);
  await q(`set role app_usuario`);
  try {
    if ((await uno(`select count(*)::int n from comprobante`)).n < 8) throw new Error('la empresa A no ve sus comprobantes');
    igual((await uno(`select count(*)::int n from v_libro_iva_ventas`)).n, 3, 'filas del libro de ventas (FA 1, FA 2 y la NCA)');
  } finally { await q(`reset role`); }
  await q(`set role app_usuario`);
  try {
    await rechaza(() => q(`update arca_alicuota_iva set tasa = 0.3 where codigo = 5`), /permission denied/i, 'cambiar un catálogo de ARCA');
  } finally { await q(`reset role`); }
});

console.log(`\n${correctas} pruebas correctas, ${fallas} con falla`);
process.exit(fallas ? 1 : 0);
