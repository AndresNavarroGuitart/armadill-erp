// Prueba del modelo de datos en PostgreSQL real (PGlite). Usa el motor de reglas (reglas/calculo.mjs) para
// generar los importes de los casos observados en el original y comprueba que la base:
//   - los acepta y los refleja bien en libros, saldos y posición de IVA,
//   - rechaza lo que el original dejaba pasar (total distinto de la suma de renglones, etc.),
//   - aísla empresas (RLS), impide modificar comprobantes confirmados y audita los cambios.
// Uso:  node modelo/probar_modelo.mjs
import { createHash } from 'node:crypto';
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
    if (it.docItem) await q(`update comprobante_item set documento_item_id = $1 where comprobante_id = $2 and orden = $3`, [it.docItem, c.id, orden - 1]);
    if (it.cuenta) await q(`update comprobante_item set cuenta_id = $1 where comprobante_id = $2 and orden = $3`, [it.cuenta, c.id, orden - 1]);
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
  await rechaza(() => q(`insert into tercero (empresa_id, tipo_documento_codigo, nro_documento, razon_social, condicion_iva_codigo, es_cliente) values ($1,80,'00000000000','X',1,true)`, [E]), /check|violates/i, 'CUIT ficticio de ceros');
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
// 10 bis. Documentos comerciales: presupuesto → pedido → remito → factura, y orden de compra → remito
// ---------------------------------------------------------------------------
async function crearDoc(tipo, tercero, items, origen = null) {
  const d = await uno(`insert into documento_comercial (empresa_id, tipo, fecha, tercero_id, documento_origen_id) values ($1,$2,'2026-10-28',$3,$4) returning id, numero`,
    [E, tipo, tercero, origen]);
  const ids = [];
  let orden = 1;
  for (const it of items) {
    ids.push((await uno(`insert into documento_item (empresa_id, documento_id, orden, articulo_id, descripcion, cantidad, precio_unitario, deposito_id, item_origen_id)
      values ($1,$2,$3,$4,'renglón',$5,$6,$7,$8) returning id`, [E, d.id, orden++, it.articulo, it.cantidad, it.precio ?? 0, it.deposito ?? null, it.origenItem ?? null])).id);
  }
  return { id: d.id, numero: d.numero, items: ids };
}
const confirmarDoc = (id) => q(`update documento_comercial set estado = 'confirmado' where id = $1`, [id]);
const stockDe = async (art) => (await uno(`select coalesce(sum(saldo),0) as s from v_stock_saldo where articulo_id = $1`, [art])).s;
const docArt = await uno(`insert into articulo (empresa_id, codigo, nombre, alicuota_venta_codigo, alicuota_compra_codigo) values ($1,'DOC1','Artículo de documentos',5,5) returning id`, [E]);
let pedido; let remito1;

await prueba('Compra: orden de compra → remito de compra mueve el stock (+10) y se numera sola', async () => {
  const oc = await crearDoc('orden_compra', proveedor1.id, [{ articulo: docArt.id, cantidad: 10, precio: 100, deposito: deposito.id }]);
  igual(oc.numero, '1', 'numeración automática'); await confirmarDoc(oc.id);
  const rc = await crearDoc('remito_compra', proveedor1.id, [{ articulo: docArt.id, cantidad: 10, precio: 100, deposito: deposito.id, origenItem: oc.items[0] }], oc.id);
  await confirmarDoc(rc.id);
  igual(await stockDe(docArt.id), '10.0000', 'stock tras el remito de compra');
  const v = await uno(`select pedido, remitado, pendiente_remitir from v_documento_pendiente where item_id = $1`, [oc.items[0]]);
  igual([v.pedido, v.remitado, v.pendiente_remitir].join('/'), '10.0000/10.0000/0.0000', 'cumplimiento de la orden');
});
await prueba('Venta: presupuesto → pedido → remito parcial (3 de 5): stock 7 y 2 pendientes', async () => {
  const pre = await crearDoc('presupuesto', cliente1.id, [{ articulo: docArt.id, cantidad: 5, precio: 157.3 }]);
  await confirmarDoc(pre.id);
  pedido = await crearDoc('pedido_venta', cliente1.id, [{ articulo: docArt.id, cantidad: 5, precio: 157.3, origenItem: pre.items[0] }], pre.id);
  await confirmarDoc(pedido.id);
  remito1 = await crearDoc('remito_venta', cliente1.id, [{ articulo: docArt.id, cantidad: 3, precio: 157.3, deposito: deposito.id, origenItem: pedido.items[0] }], pedido.id);
  await confirmarDoc(remito1.id);
  igual(await stockDe(docArt.id), '7.0000', 'stock');
  const v = await uno(`select pedido, remitado, pendiente_remitir from v_documento_pendiente where item_id = $1`, [pedido.items[0]]);
  igual([v.pedido, v.remitado, v.pendiente_remitir].join('/'), '5.0000/3.0000/2.0000', 'cumplimiento del pedido');
});
await prueba('Remitar más de lo pedido es rechazado; completar lo pendiente (2) es aceptado', async () => {
  const demas = await crearDoc('remito_venta', cliente1.id, [{ articulo: docArt.id, cantidad: 3, deposito: deposito.id, origenItem: pedido.items[0] }], pedido.id);
  await rechaza(() => confirmarDoc(demas.id), /solo pide/i, 'sobre-entrega');
  const resto = await crearDoc('remito_venta', cliente1.id, [{ articulo: docArt.id, cantidad: 2, deposito: deposito.id, origenItem: pedido.items[0] }], pedido.id);
  await confirmarDoc(resto.id);
  igual(await stockDe(docArt.id), '5.0000', 'stock tras completar');
  igual((await uno(`select pendiente_remitir from v_documento_pendiente where item_id = $1`, [pedido.items[0]])).pendiente_remitir, '0.0000', 'pendiente');
  await q(`update documento_comercial set estado = 'anulado' where id = $1`, [resto.id]);
  igual(await stockDe(docArt.id), '7.0000', 'anular el remito devuelve el stock');
});
await prueba('Factura desde un remito: lo remitado queda facturado y el stock no se mueve de nuevo', async () => {
  const salida = motor.venta([{ precioFinal: '157,30', cantidad: '3', alicuota: '21' }]);
  const r = resumen(salida);
  const f = await crearComprobante({ sentido: 'venta', tipo: 1, tercero: cliente1.id, receptor: 1, incluyeIva: true, resumen: r,
    items: [{ articulo: docArt.id, cantidad: 3, precio: '157.30', importe: '471.90', docItem: remito1.items[0] }] });
  await confirmar(f, { electronico: true, numero: 70 });
  const v = await uno(`select remitado, facturado, remitado_sin_facturar from v_documento_pendiente where item_id = $1`, [pedido.items[0]]);
  igual([v.remitado, v.facturado, v.remitado_sin_facturar].join('/'), '3.0000/3.0000/0.0000', 'remitado/facturado/sin facturar');
  igual(await stockDe(docArt.id), '7.0000', 'stock sin cambios por la factura');
});
await prueba('Documentos: cadena inválida, rol del tercero y modificación de un confirmado son rechazados', async () => {
  const pre = await crearDoc('presupuesto', cliente1.id, [{ articulo: docArt.id, cantidad: 1 }]);
  await confirmarDoc(pre.id);
  const mal = await crearDoc('remito_venta', cliente1.id, [{ articulo: docArt.id, cantidad: 1, deposito: deposito.id, origenItem: pre.items[0] }], pre.id);
  await rechaza(() => confirmarDoc(mal.id), /no puede originarse/i, 'remito desde presupuesto');
  const ocCliente = await crearDoc('orden_compra', cliente1.id, [{ articulo: docArt.id, cantidad: 1 }]);
  await rechaza(() => confirmarDoc(ocCliente.id), /no es proveedor/i, 'orden de compra a un cliente');
  const sinDeposito = await crearDoc('remito_venta', cliente1.id, [{ articulo: docArt.id, cantidad: 1 }]);
  await rechaza(() => confirmarDoc(sinDeposito.id), /necesita depósito/i, 'remito sin depósito');
  await rechaza(() => q(`update documento_comercial set fecha = '2026-10-29' where id = $1`, [pre.id]), /no se modifica/i, 'cambiar un confirmado');
  await rechaza(() => q(`update documento_comercial set estado = 'borrador' where id = $1`, [pre.id]), /Transición/i, 'volver a borrador');
});

// ---------------------------------------------------------------------------
// 10 ter. Conciliación bancaria
// ---------------------------------------------------------------------------
const banco = await uno(`insert into cuenta_bancaria (empresa_id, banco, cbu) values ($1,'Banco Prueba','0110000000000000000001') returning id`, [E]);
const bancoOtra = await uno(`insert into cuenta_bancaria (empresa_id, banco) values ($1,'Otro Banco') returning id`, [E]);
const mov = async (fecha, importe, concepto, cuenta = banco.id) =>
  (await uno(`insert into movimiento_tesoreria (empresa_id, fecha, cuenta_bancaria_id, importe, concepto) values ($1,$2,$3,$4,$5) returning id`, [E, fecha, cuenta, importe, concepto])).id;
const movApertura = await mov('2026-09-30', 5000, 'saldo de apertura');
const movPago = await mov('2026-10-05', -1000, 'transferencia a proveedor');
const movCobro = await mov('2026-10-10', 2500, 'cobro de cliente');
const movTransito = await mov('2026-10-20', -300, 'transferencia en tránsito');
let ext; let lineas;
async function nuevoExtracto(saldoFinal, hash = 'hash-oct-2026') {
  const e = await uno(`insert into extracto_bancario (empresa_id, cuenta_bancaria_id, desde, hasta, saldo_inicial, saldo_final, hash_archivo)
    values ($1,$2,'2026-10-01','2026-10-31',5000,$3,$4) returning id`, [E, banco.id, saldoFinal, hash]);
  const ids = [];
  let orden = 1;
  for (const [fecha, importe, desc] of [['2026-10-06', -1000, 'TRANSF ENVIADA'], ['2026-10-11', 2500, 'TRANSF RECIBIDA'], ['2026-10-25', -45.5, 'COMISION MANTENIMIENTO']]) {
    ids.push((await uno(`insert into extracto_linea (empresa_id, extracto_id, orden, fecha, descripcion, importe) values ($1,$2,$3,$4,$5,$6) returning id`, [E, e.id, orden++, fecha, desc, importe])).id);
  }
  return { id: e.id, lineas: ids };
}
await prueba('Extracto: el saldo final debe ser el inicial más las líneas; no se importa dos veces el mismo archivo', async () => {
  const malo = await nuevoExtracto(6000);
  await rechaza(() => q(`update extracto_bancario set estado = 'cerrado' where id = $1`, [malo.id]), /saldo final 6000.00 no es el inicial/i, 'cerrar con saldo erróneo');
  await q(`delete from extracto_bancario where id = $1`, [malo.id]);
  ext = await nuevoExtracto(6454.5);
  lineas = ext.lineas;
  await rechaza(() => nuevoExtracto(6454.5), /duplicate|unique/i, 'archivo repetido');
  await q(`update extracto_bancario set estado = 'cerrado' where id = $1`, [ext.id]);
  await rechaza(() => q(`update extracto_linea set importe = 1 where id = $1`, [lineas[0]]), /cerrado/i, 'editar un extracto cerrado');
  await rechaza(() => q(`delete from extracto_bancario where id = $1`, [ext.id]), /no se borra/i, 'borrar un extracto cerrado');
});
await prueba('Sugerencias: solo las coincidencias únicas (−1.000 y +2.500); el tránsito y la comisión quedan afuera', async () => {
  const s = await q(`select * from fn_sugerir_conciliacion($1)`, [banco.id]);
  igual(s.length, 2, 'cantidad de sugerencias');
  igual(s.map((x) => `${x.linea_id}:${x.movimiento_id}`).sort().join(','), [`${lineas[0]}:${movPago}`, `${lineas[1]}:${movCobro}`].sort().join(','), 'pares');
});
await prueba('Conciliar: confirma las sugeridas y la diferencia queda explicada por las partidas pendientes', async () => {
  for (const [l, m] of [[lineas[0], movPago], [lineas[1], movCobro]]) await q(`select fn_conciliar($1, $2::bigint[], $3::bigint[], '2026-10-31')`, [banco.id, [l], [m]]);
  const v = await uno(`select * from v_conciliacion_estado where cuenta_bancaria_id = $1`, [banco.id]);
  igual(v.saldo_banco, '6454.50', 'saldo del banco'); igual(v.saldo_libros, '6200.00', 'saldo de los libros');
  igual(v.diferencia_total, '254.50', 'diferencia total'); igual(v.pendiente_banco, '-45.50', 'pendiente del banco');
  igual(v.pendiente_libros, '-300.00', 'pendiente de libros'); igual(v.diferencia_apertura, '0.00', 'apertura'); igual(v.no_explicada, '0.00', 'no explicada');
});
await prueba('Conciliar: sumas distintas, línea ya conciliada o movimiento de otra cuenta son rechazados', async () => {
  await rechaza(() => q(`select fn_conciliar($1, $2::bigint[], $3::bigint[])`, [banco.id, [lineas[2]], [movTransito]]), /No concilia: el extracto suma -45.50 y los libros -300.00/i, 'importes distintos');
  await rechaza(() => q(`select fn_conciliar($1, $2::bigint[], $3::bigint[])`, [banco.id, [lineas[0]], [movTransito]]), /ya está conciliada/i, 'línea ya conciliada');
  const otro = await mov('2026-10-25', -45.5, 'otra cuenta', bancoOtra.id);
  await rechaza(() => q(`select fn_conciliar($1, $2::bigint[], $3::bigint[])`, [banco.id, [lineas[2]], [otro]]), /otra cuenta/i, 'movimiento de otra cuenta');
});
await prueba('La comisión del banco se registra en los libros y se concilia; queda solo el cheque en tránsito', async () => {
  const m = await uno(`select fn_movimiento_desde_linea($1, 'Comisión de mantenimiento') as id`, [lineas[2]]);
  await q(`select fn_conciliar($1, $2::bigint[], $3::bigint[])`, [banco.id, [lineas[2]], [m.id]]);
  const v = await uno(`select * from v_conciliacion_estado where cuenta_bancaria_id = $1`, [banco.id]);
  igual(v.pendiente_banco, '0.00', 'pendiente del banco'); igual(v.saldo_libros, '6154.50', 'saldo de los libros');
  igual(v.diferencia_total, '300.00', 'diferencia: el tránsito'); igual(v.no_explicada, '0.00', 'no explicada');
});
await prueba('Deshacer una conciliación libera ambos lados y deja constancia', async () => {
  const c = await uno(`select id from conciliacion where cuenta_bancaria_id = $1 and importe = 2500`, [banco.id]);
  await q(`select fn_deshacer_conciliacion($1)`, [c.id]);
  igual((await uno(`select pendiente_banco from v_conciliacion_estado where cuenta_bancaria_id = $1`, [banco.id])).pendiente_banco, '2500.00', 'pendiente del banco');
  igual((await uno(`select estado from conciliacion where id = $1`, [c.id])).estado, 'deshecha', 'estado');
  await rechaza(() => q(`select fn_deshacer_conciliacion($1)`, [c.id]), /ya fue deshecha/i, 'deshacer dos veces');
});
await prueba('Un extracto que no continúa el saldo del anterior, o con líneas fuera de rango, no se cierra', async () => {
  const e = await uno(`insert into extracto_bancario (empresa_id, cuenta_bancaria_id, desde, hasta, saldo_inicial, saldo_final) values ($1,$2,'2026-11-01','2026-11-30',9999,10099) returning id`, [E, banco.id]);
  await q(`insert into extracto_linea (empresa_id, extracto_id, orden, fecha, importe) values ($1,$2,1,'2026-11-05',100)`, [E, e.id]);
  await rechaza(() => q(`update extracto_bancario set estado = 'cerrado' where id = $1`, [e.id]), /no continúa el saldo final anterior/i, 'saldo inicial discontinuo');
  await q(`update extracto_bancario set saldo_inicial = 6454.50, saldo_final = 6554.50 where id = $1`, [e.id]);
  await q(`insert into extracto_linea (empresa_id, extracto_id, orden, fecha, importe) values ($1,$2,2,'2026-12-05',1)`, [E, e.id]);
  await rechaza(() => q(`update extracto_bancario set estado = 'cerrado' where id = $1`, [e.id]), /fuera del rango/i, 'línea fuera de rango');
});

// ---------------------------------------------------------------------------
// 10 quater. Asientos automáticos
// ---------------------------------------------------------------------------
for (const [codigo, nombre, tipo] of [
  ['1.1.2', 'Valores a depositar', 'activo'], ['1.1.6', 'Percepciones sufridas', 'activo'], ['1.1.7', 'Retenciones sufridas', 'activo'],
  ['2.1.5', 'Percepciones a depositar', 'pasivo'], ['2.1.6', 'Retenciones a depositar', 'pasivo'], ['4.1.2', 'Servicios', 'ingreso'],
  ['4.1.9', 'Descuentos otorgados', 'egreso'], ['5.1.9', 'Descuentos obtenidos', 'ingreso']]) {
  cuentas[codigo] = (await uno(`insert into plan_cuenta (empresa_id, codigo, nombre, tipo) values ($1,$2,$3,$4) returning id`, [E, codigo, nombre, tipo])).id;
}
const mapaCuentas = {
  ventas: '4.1.1', compras: '5.1.1', iva_debito: '2.1.4', iva_credito: '1.1.5', deudores: '1.1.3', proveedores: '2.1.1',
  percepcion_iva_sufrida: '1.1.6', percepcion_iibb_sufrida: '1.1.6', percepcion_ganancias_sufrida: '1.1.6', otros_tributos_compras: '5.1.1',
  percepcion_iva_practicada: '2.1.5', percepcion_iibb_practicada: '2.1.5', otros_tributos_ventas: '2.1.5',
  retencion_iva_sufrida: '1.1.7', retencion_ganancias_sufrida: '1.1.7', retencion_iibb_sufrida: '1.1.7', retencion_suss_sufrida: '1.1.7',
  retencion_iva_practicada: '2.1.6', retencion_ganancias_practicada: '2.1.6', retencion_iibb_practicada: '2.1.6', retencion_suss_practicada: '2.1.6',
  descuentos_otorgados: '4.1.9', descuentos_obtenidos: '5.1.9', valores_a_depositar: '1.1.2' };
for (const [concepto, codigo] of Object.entries(mapaCuentas)) {
  await q(`insert into cuenta_automatica (empresa_id, concepto, cuenta_id) values ($1,$2,$3)`, [E, concepto, cuentas[codigo]]);
}
await q(`update caja set cuenta_contable_id = $1 where id = $2`, [cuentas['1.1.1'], caja.id]);
await q(`update empresa_parametro set asientos_automaticos = true where empresa_id = $1`, [E]);
const lineasDe = async (asientoId) => (await q(`select c.codigo, l.debe, l.haber from asiento_linea l join plan_cuenta c on c.id = l.cuenta_id where l.asiento_id = $1`, [asientoId]))
  .map((l) => `${l.codigo} ${Number(l.debe) > 0 ? 'D ' + l.debe : 'H ' + l.haber}`).sort();
const asientoDeComprobante = async (id) => (await uno(`select asiento_id from comprobante where id = $1`, [id])).asiento_id;
let compraAuto; let ventaRepartida;

await prueba('Venta confirmada genera su asiento solo: deudores 726,05 / ventas 650 + IVA débito 76,05', async () => {
  const r = resumen(motor.venta(renglonesV04), { exento: '130.00', noGravado: '130.00' });
  const id = await crearComprobante({ sentido: 'venta', tipo: 1, tercero: cliente1.id, receptor: 1, incluyeIva: true, resumen: r, items: itemsV04 });
  await confirmar(id, { electronico: true, numero: 80 });
  const a = await asientoDeComprobante(id);
  if (!a) throw new Error('no se generó el asiento');
  igual((await lineasDe(a)).join(' | '), '1.1.3 D 726.05 | 2.1.4 H 76.05 | 4.1.1 H 650.00', 'líneas del asiento');
  igual((await uno(`select estado from asiento where id = $1`, [a])).estado, 'contabilizado', 'estado');
});
await prueba('Compra con percepciones: compras 1.000, IVA crédito 210, percepciones 20 y 30 / proveedores 1.260', async () => {
  const salida = motor.compra([{ precio: '1000', cantidad: '1', alicuota: '21' }], { percepciones: { gan: '30', iva: '20' } });
  compraAuto = await crearComprobante({ sentido: 'compra', tipo: 1, numero: 8001, tercero: proveedor1.id, incluyeIva: false, resumen: resumen(salida, { trib: '50.00' }),
    items: [{ precio: '1000', importe: '1000' }], tributos: [{ tipo: 'percepcion_ganancias', importe: '30.00' }, { tipo: 'percepcion_iva', importe: '20.00' }] });
  await confirmar(compraAuto);
  igual((await lineasDe(await asientoDeComprobante(compraAuto))).join(' | '),
    '1.1.5 D 210.00 | 1.1.6 D 20.00 | 1.1.6 D 30.00 | 2.1.1 H 1260.00 | 5.1.1 D 1000.00', 'líneas del asiento');
});
await prueba('Nota de crédito: el asiento es el inverso de la factura (con descuento al pie, 27,55)', async () => {
  const items = [{ precio: '10', importe: '10.0000' }, { precio: '10', importe: '10.0000' }, { precio: '10', desc: 0.1, importe: '9.0000' }];
  const r = resumen(motor.venta([{ precioFinal: '10', cantidad: '1', alicuota: '21' }, { precioFinal: '10', cantidad: '1', alicuota: '21' },
    { precioFinal: '10', cantidad: '1', alicuota: '21', descPct: '10' }], { descPiePct: '5' }));
  const fa = await crearComprobante({ sentido: 'venta', tipo: 1, tercero: cliente1.id, receptor: 1, incluyeIva: true, descPiePct: 0.05, resumen: r, items });
  await confirmar(fa, { electronico: true, numero: 81 });
  const nc = await crearComprobante({ sentido: 'venta', tipo: 3, tercero: cliente1.id, receptor: 1, incluyeIva: true, descPiePct: 0.05, resumen: r, items, origen: fa });
  await confirmar(nc, { electronico: true, numero: 82, cae: '74123456789098' });
  igual((await lineasDe(await asientoDeComprobante(fa))).join(' | '), '1.1.3 D 27.55 | 2.1.4 H 4.78 | 4.1.1 H 22.77', 'factura');
  igual((await lineasDe(await asientoDeComprobante(nc))).join(' | '), '1.1.3 H 27.55 | 2.1.4 D 4.78 | 4.1.1 D 22.77', 'nota de crédito');
});
await prueba('Renglones en dos cuentas de ingreso: el reparto suma EXACTAMENTE la base (82,65 + 41,32 = 123,97)', async () => {
  const salida = motor.venta([{ precioFinal: '100', cantidad: '1', alicuota: '21' }, { precioFinal: '50', cantidad: '1', alicuota: '21' }]);
  ventaRepartida = await crearComprobante({ sentido: 'venta', tipo: 1, tercero: cliente1.id, receptor: 1, incluyeIva: true, resumen: resumen(salida),
    items: [{ precio: '100', importe: '100', cuenta: cuentas['4.1.1'] }, { precio: '50', importe: '50', cuenta: cuentas['4.1.2'] }] });
  await confirmar(ventaRepartida, { electronico: true, numero: 83 });
  igual((await lineasDe(await asientoDeComprobante(ventaRepartida))).join(' | '), '1.1.3 D 150.00 | 2.1.4 H 26.03 | 4.1.1 H 82.65 | 4.1.2 H 41.32', 'líneas');
});
await prueba('Cobro con retención sufrida: caja 85 + retención 15 / deudores 100 (con el cliente como auxiliar)', async () => {
  const p = await crearPago({ sentido: 'cobro', tercero: cliente1.id, imputaciones: [{ comprobante: ventaRepartida, importe: '100.00' }],
    medios: [{ importe: '85.00' }], retenciones: [{ origen: 'sufrida', tipo: 'iibb', jurisdiccion: 913, importe: '15.00', cert: 'AUTO-1' }] });
  await confirmarPago(p);
  const a = (await uno(`select asiento_id from pago where id = $1`, [p])).asiento_id;
  igual((await lineasDe(a)).join(' | '), '1.1.1 D 85.00 | 1.1.3 H 100.00 | 1.1.7 D 15.00', 'líneas');
  igual((await uno(`select count(*)::int n from asiento_linea where asiento_id = $1 and tercero_id = $2`, [a, cliente1.id])).n, 1, 'línea con el cliente como auxiliar');
});
let opAuto;
await prueba('Orden de pago con retención practicada: proveedores 1.260 / caja 1.235 + retención a depositar 25', async () => {
  const cert = String((await uno(`select fn_siguiente($1,'cert-iibb') as n`, [E])).n);
  opAuto = await crearPago({ sentido: 'pago', tercero: proveedor1.id, imputaciones: [{ comprobante: compraAuto, importe: '1260.00' }],
    medios: [{ importe: '1235.00' }], retenciones: [{ origen: 'practicada', tipo: 'iibb', jurisdiccion: 913, importe: '25.00', cert }] });
  await confirmarPago(opAuto);
  const a = (await uno(`select asiento_id from pago where id = $1`, [opAuto])).asiento_id;
  igual((await lineasDe(a)).join(' | '), '1.1.1 H 1235.00 | 2.1.1 D 1260.00 | 2.1.6 H 25.00', 'líneas');
});
await prueba('Anular genera el contraasiento: el original no se toca y el efecto neto es cero', async () => {
  const orig = (await uno(`select asiento_id from pago where id = $1`, [opAuto])).asiento_id;
  const antes = (await uno(`select saldo from v_balance_sumas_saldos where cuenta_id = $1`, [cuentas['2.1.6']])).saldo;
  igual(antes, '-25.00', 'retención a depositar antes de anular');
  await q(`update pago set estado = 'anulado' where id = $1`, [opAuto]);
  const contra = await uno(`select id from asiento where origen_tipo = 'contraasiento' and origen_id = $1`, [orig]);
  if (!contra) throw new Error('no se generó el contraasiento');
  igual((await uno(`select estado from asiento where id = $1`, [orig])).estado, 'contabilizado', 'el asiento original sigue contabilizado');
  igual((await uno(`select saldo from v_balance_sumas_saldos where cuenta_id = $1`, [cuentas['2.1.6']])).saldo, '0.00', 'retención a depositar tras anular');
  const sinCompensar = await uno(`select count(*)::int n from (select cuenta_id, sum(debe - haber) s from asiento_linea where asiento_id in ($1,$2) group by cuenta_id) x where s <> 0`, [orig, contra.id]);
  igual(sinCompensar.n, 0, 'cuentas sin compensar');
  const r = resumen(motor.compra([{ precio: '100', cantidad: '1', alicuota: '21' }]));
  const c = await crearComprobante({ sentido: 'compra', tipo: 1, numero: 8002, tercero: proveedor1.id, incluyeIva: false, resumen: r, items: [{ precio: '100', importe: '100' }] });
  await confirmar(c);
  await q(`update comprobante set estado = 'anulado' where id = $1`, [c]);
  igual((await uno(`select count(*)::int n from asiento where origen_tipo = 'contraasiento' and origen_id = $1`, [await asientoDeComprobante(c)])).n, 1, 'contraasiento del comprobante anulado');
});
await prueba('Sin cuenta automática configurada, el comprobante no se confirma y queda en borrador', async () => {
  const r = resumen(motor.venta([{ precioFinal: '10', cantidad: '1', alicuota: '21' }]));
  const id = await crearComprobante({ sentido: 'venta', tipo: 1, tercero: cliente1.id, receptor: 1, incluyeIva: true, resumen: r, items: [{ precio: '10', importe: '10' }] });
  await q(`delete from cuenta_automatica where empresa_id = $1 and concepto = 'iva_debito'`, [E]);
  await rechaza(() => confirmar(id, { electronico: true, numero: 84 }), /iva_debito/i, 'confirmar sin la cuenta de IVA débito');
  igual((await uno(`select estado from comprobante where id = $1`, [id])).estado, 'borrador', 'estado');
  await q(`insert into cuenta_automatica (empresa_id, concepto, cuenta_id) values ($1,'iva_debito',$2)`, [E, cuentas['2.1.4']]);
});
await prueba('Con los asientos automáticos apagados no se genera nada; y todo lo generado balancea', async () => {
  await q(`update empresa_parametro set asientos_automaticos = false where empresa_id = $1`, [E]);
  const r = resumen(motor.compra([{ precio: '100', cantidad: '1', alicuota: '21' }]));
  const c = await crearComprobante({ sentido: 'compra', tipo: 1, numero: 8003, tercero: proveedor1.id, incluyeIva: false, resumen: r, items: [{ precio: '100', importe: '100' }] });
  await confirmar(c);
  igual(await asientoDeComprobante(c), null, 'asiento con el parámetro apagado');
  const t = await uno(`select sum(debe) d, sum(haber) h from v_balance_sumas_saldos where empresa_id = $1`, [E]);
  igual(t.d, t.h, 'sumas y saldos balanceadas');
  igual((await uno(`select count(*)::int n from asiento where origen_tipo in ('comprobante','pago','contraasiento') and estado <> 'contabilizado'`)).n, 0, 'asientos automáticos sin contabilizar');
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
  const filasLibro = (await uno(`select count(*)::int n from v_libro_iva_ventas where empresa_id = $1`, [E])).n;   // como superusuario
  await q(`set role app_usuario`);
  try {
    if ((await uno(`select count(*)::int n from comprobante`)).n < 8) throw new Error('la empresa A no ve sus comprobantes');
    igual((await uno(`select count(*)::int n from v_libro_iva_ventas`)).n, filasLibro, 'filas del libro de ventas visibles para la empresa A');
  } finally { await q(`reset role`); }
  await q(`set role app_usuario`);
  try {
    await rechaza(() => q(`update arca_alicuota_iva set tasa = 0.3 where codigo = 5`), /permission denied/i, 'cambiar un catálogo de ARCA');
  } finally { await q(`reset role`); }
});

// ---------------------------------------------------------------------------
// 13. Trazabilidad (libro de eventos encadenado)
// ---------------------------------------------------------------------------
const contexto = (estudioId, empresaId, usuarioId) => q(`select set_config('app.estudio_id', $1, false), set_config('app.empresa_id', $2, false), set_config('app.usuario_id', $3, false)`,
  [String(estudioId ?? ''), String(empresaId ?? ''), String(usuarioId ?? '')]);
await contexto(estudio.id, null, usuario.id);

await prueba('Trazabilidad: cada evento se encadena con el anterior y la base fija quién, cuándo y el número', async () => {
  const a = await uno(`select fn_registrar_evento('acceso', 'Inició sesión', 'Ingreso con usuario y segundo factor', 'ok', null, null, null, null, '203.0.113.5', 'Chrome en Windows') id`);
  const b = await uno(`select fn_registrar_evento('comprobantes', 'Emitió Factura A 0003-00001241', 'CAE obtenido', 'ok', $1, 'comprobante', $2, null, '203.0.113.5', 'Chrome en Windows') id`, [E, fa1]);
  const c = await uno(`select fn_registrar_evento('maestros', 'Modificó el cliente X', null, 'ok', $1, null, null, '[{"campo":"Condición IVA","antes":"Consumidor Final","despues":"Responsable Inscripto"}]'::jsonb) id`, [E]);
  const filas = await q(`select * from evento where id = any($1) order by nro`, [[a.id, b.id, c.id]]);
  igual(filas.map((f) => f.nro).join(','), '1,2,3', 'números de la cadena');
  igual(filas[0].huella_prev, '', 'huella previa del primer evento');
  igual(filas[1].huella_prev, filas[0].huella, 'enlace 2 → 1');
  igual(filas[2].huella_prev, filas[1].huella, 'enlace 3 → 2');
  igual(filas[0].usuario_id, usuario.id, 'usuario tomado de la sesión');
  igual(filas[1].empresa_id, E, 'empresa');
  igual((await uno(`select fn_verificar_trazabilidad($1) v`, [estudio.id])).v, null, 'cadena íntegra');
  igual((await uno(`select count(*)::int n from v_trazabilidad where usuario = 'Contador'`)).n, 3, 'la vista muestra el nombre del usuario');
  igual((await uno(`select codigo from v_trazabilidad where estudio_id = $1 and nro = 2`, [estudio.id])).codigo, 'TR-000002', 'ID visible del evento');
});

await prueba('Trazabilidad: la huella es SHA-256 sobre el contenido (se recalcula fuera de la base)', async () => {
  const e = await uno(`select e.*, to_char(e.en at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') ts, host(e.ip) ip_txt from evento e where nro = 2 and estudio_id = $1`, [estudio.id]);
  const texto = [e.huella_prev, e.estudio_id, e.nro, e.empresa_id ?? '', e.usuario_id ?? '', e.usuario_texto ?? '', e.categoria, e.accion, e.detalle ?? '', e.resultado,
    e.entidad_tabla ?? '', e.entidad_id ?? '', '', e.ip_txt ?? '', e.dispositivo ?? '', e.ts].join('|');
  igual(createHash('sha256').update(texto, 'utf8').digest('hex'), e.huella, 'huella recalculada');
});

await prueba('Trazabilidad: no se edita, no se borra, no se vacía, y la fecha no la elige quien escribe', async () => {
  await rechaza(() => q(`update evento set accion = 'otra' where nro = 1`), /solo agregar/i, 'editar un evento');
  await rechaza(() => q(`delete from evento where nro = 1`), /solo agregar/i, 'borrar un evento');
  await rechaza(() => q(`truncate evento`), /solo agregar/i, 'vaciar la trazabilidad');
  const r = await uno(`insert into evento (estudio_id, usuario_id, categoria, accion, en, nro, huella) values ($1, $2, 'seguridad', 'Con fecha vieja', '2020-01-01', 99, 'falsa') returning nro, en > now() - interval '1 minute' reciente`, [estudio.id, usuario.id]);
  igual(r.nro, 4, 'número asignado por la base, no el pedido');
  igual(r.reciente, true, 'fecha asignada por la base');
});

await prueba('Trazabilidad: alterar, quitar o intercalar un evento rompe la cadena y se detecta', async () => {
  const verificar = async () => (await uno(`select fn_verificar_trazabilidad($1) v`, [estudio.id])).v;
  igual(await verificar(), null, 'antes de tocar');
  await q('begin');
  try {   // quien tiene acceso de administrador a la base puede desactivar el trigger: la cadena es lo que lo delata
    await q(`alter table evento disable trigger trg_evento_solo_agregar`);
    await q(`update evento set detalle = 'Retocado' where nro = 2 and estudio_id = $1`, [estudio.id]);
    igual(await verificar(), 2, 'evento alterado');
    await q('rollback'); await q('begin');
    await q(`alter table evento disable trigger trg_evento_solo_agregar`);
    await q(`delete from evento where nro = 2 and estudio_id = $1`, [estudio.id]);
    igual(await verificar(), 3, 'evento quitado (número salteado)');
  } finally { await q('rollback'); }
  igual(await verificar(), null, 'tras deshacer la prueba');
});

await prueba('Trazabilidad: exige categoría válida, usuario o texto de quien actuó, y datos de entidad completos', async () => {
  await rechaza(() => q(`select fn_registrar_evento('otra', 'x')`), /check|violates/i, 'categoría inválida');
  await rechaza(() => q(`select fn_registrar_evento('acceso', 'x', null, 'quizas')`), /check|violates/i, 'resultado inválido');
  await rechaza(() => q(`select fn_registrar_evento('acceso', '  ')`), /check|violates/i, 'acción vacía');
  await rechaza(() => q(`select fn_registrar_evento('acceso', 'x', null, 'ok', null, 'comprobante')`), /check|violates/i, 'tabla sin id');
  await rechaza(() => q(`select fn_registrar_evento('acceso', 'x', null, 'ok', null, null, null, '{"a":1}'::jsonb)`), /check|violates/i, 'cambios que no son una lista');
  await contexto(estudio.id, null, null);                 // todavía no hay usuario: ingreso fallido
  await rechaza(() => q(`select fn_registrar_evento('acceso', 'Intento de ingreso fallido', null, 'fallo')`), /check|violates/i, 'sin usuario ni texto');
  const f = await uno(`select fn_registrar_evento('acceso', 'Intento de ingreso fallido', 'Contraseña incorrecta', 'fallo', null, null, null, null, null, null, 'alguien@estudio.test') id`);
  igual((await uno(`select usuario_id, usuario_texto, resultado from evento where id = $1`, [f.id])).usuario_texto, 'alguien@estudio.test', 'texto de quien intentó ingresar');
  await contexto(estudio.id, null, usuario.id);
  await contexto(null, null, usuario.id);
  await rechaza(() => q(`select fn_registrar_evento('acceso', 'x')`), /sin estudio/i, 'sin estudio en el contexto');
  await contexto(estudio.id, null, usuario.id);
});

await prueba('Trazabilidad: cada estudio tiene su propia cadena, independiente de las demás', async () => {
  const otro = await uno(`insert into estudio (nombre) values ('Otro Estudio') returning id`);
  const uOtro = await uno(`insert into usuario (estudio_id, email, nombre) values ($1,'otro@estudio.test','Otra') returning id`, [otro.id]);
  await contexto(otro.id, null, uOtro.id);
  const e1 = await uno(`select fn_registrar_evento('acceso', 'Inició sesión') id`);
  igual((await uno(`select nro, huella_prev from evento where id = $1`, [e1.id])).nro, 1, 'primer evento del otro estudio');
  igual((await uno(`select fn_verificar_trazabilidad($1) v`, [otro.id])).v, null, 'cadena del otro estudio');
  igual((await uno(`select fn_verificar_trazabilidad($1) v`, [estudio.id])).v, null, 'la cadena del primer estudio sigue íntegra');
  await contexto(estudio.id, null, usuario.id);
});

await prueba('Trazabilidad: RLS — cada estudio ve solo lo suyo, escribe solo en lo suyo y la aplicación no puede modificar', async () => {
  const otro = await uno(`select id from estudio where nombre = 'Otro Estudio'`);
  const empOtro = await uno(`insert into empresa (estudio_id, cuit, razon_social, condicion_iva_codigo) values ($1,$2,'Empresa Ajena',1) returning id`, [otro.id, cuit('3055123456')]);
  await q(`set role app_usuario`);
  try {
    const propios = (await uno(`select count(*)::int n from evento`)).n;
    const ajenos = (await uno(`select count(*)::int n from evento where estudio_id <> $1`, [estudio.id])).n;
    igual(ajenos, 0, 'eventos de otro estudio visibles');
    if (propios < 5) throw new Error(`el estudio debía ver sus eventos y ve ${propios}`);
    igual((await uno(`select count(*)::int n from v_trazabilidad`)).n, propios, 'la vista respeta el mismo aislamiento');
    await rechaza(() => q(`insert into evento (estudio_id, usuario_id, categoria, accion, huella) values ($1,$2,'acceso','Suplantación','x')`, [otro.id, usuario.id]),
      /row-level security/i, 'escribir en la cadena de otro estudio');
    await rechaza(() => q(`select fn_registrar_evento('acceso', 'x', null, 'ok', $1)`, [empOtro.id]), /row-level security/i, 'atribuir un evento a una empresa de otro estudio');
    await rechaza(() => q(`update evento set accion = 'x'`), /permission denied/i, 'modificar desde la aplicación');
    await rechaza(() => q(`delete from evento`), /permission denied/i, 'borrar desde la aplicación');
    await q(`select fn_registrar_evento('seguridad', 'Exportó la trazabilidad a CSV', '12 movimientos')`);   // sí puede agregar
  } finally { await q(`reset role`); }
  igual((await uno(`select fn_verificar_trazabilidad($1) v`, [estudio.id])).v, null, 'cadena íntegra tras escribir como aplicación');
});

// ---------------------------------------------------------------------------
// 14. Asistente: configuración, registro de uso y cuota
// ---------------------------------------------------------------------------
{
  const otro = await uno(`select id from estudio where nombre = 'Otro Estudio'`);
  const uOtro = await uno(`select id from usuario where email = 'otro@estudio.test'`);
  const usuario2 = await uno(`insert into usuario (estudio_id, email, nombre) values ($1,'segundo@estudio.test','Segundo') returning id`, [estudio.id]);
  const estado = async (est, usr) => uno(`select * from fn_asistente_estado($1, $2)`, [est, usr]);
  const usar = (est, usr, resultado, costo = 0) => q(`insert into asistente_uso (estudio_id, usuario_id, modelo, resultado, costo_usd, tokens_entrada, tokens_salida) values ($1,$2,$3,$4,$5,1000,300)`, [est, usr, resultado === 'modo_basico' ? 'basico' : 'claude-opus-5-5', resultado, costo]);

  await prueba('Asistente: sin configuración rige lo predeterminado (activo, 40 por día, tope provisorio) y los datos de empresas están apagados', async () => {
    const e0 = await estado(estudio.id, usuario.id);
    igual(e0.motivo, null, 'motivo'); igual(e0.cuota_diaria, 40, 'cuota diaria'); igual(Number(e0.tope_mensual), 50, 'tope mensual'); igual(e0.usadas_hoy, 0, 'usadas');
    await q(`insert into asistente_config (estudio_id) values ($1)`, [estudio.id]);
    const c = await uno(`select * from asistente_config where estudio_id = $1`, [estudio.id]);
    igual(c.datos_activo, false, 'datos de empresas apagados por defecto'); igual(c.guardar_conversaciones, false, 'conversaciones sin guardar por defecto');
  });

  await prueba('Asistente: el registro de uso no se edita ni se borra ni se vacía, y no admite números negativos', async () => {
    await usar(estudio.id, usuario.id, 'ok', 0.05);
    await rechaza(() => q(`update asistente_uso set costo_usd = 0`), /solo agregar/i, 'editar el uso');
    await rechaza(() => q(`delete from asistente_uso`), /solo agregar/i, 'borrar el uso');
    await rechaza(() => q(`truncate asistente_uso`), /solo agregar/i, 'vaciar el uso');
    await rechaza(() => q(`insert into asistente_uso (estudio_id, usuario_id, modelo, resultado, tokens_entrada) values ($1,$2,'m','ok',-1)`, [estudio.id, usuario.id]), /check|violates/i, 'tokens negativos');
    await rechaza(() => q(`insert into asistente_uso (estudio_id, usuario_id, modelo, resultado) values ($1,$2,'m','otro')`, [estudio.id, usuario.id]), /check|violates/i, 'resultado inválido');
  });

  await prueba('Asistente: la cuota diaria corta a quien la agota, solo cuenta lo que llamó a Claude y no afecta a los demás', async () => {
    await q(`update asistente_config set cuota_diaria_usuario = 3 where estudio_id = $1`, [estudio.id]);
    await usar(estudio.id, usuario.id, 'modo_basico'); await usar(estudio.id, usuario.id, 'cuota');   // no cuentan
    igual((await estado(estudio.id, usuario.id)).motivo, null, 'con 1 consulta de 3');
    await usar(estudio.id, usuario.id, 'ok', 0.05); await usar(estudio.id, usuario.id, 'rechazado', 0.01);
    const e3 = await estado(estudio.id, usuario.id);
    igual(e3.motivo, 'cuota_diaria', 'con 3 de 3'); igual(e3.aviso, true, 'aviso previo');
    igual((await estado(estudio.id, usuario2.id)).motivo, null, 'otra persona del mismo estudio');
  });

  await prueba('Asistente: el tope mensual del estudio corta a todos, con aviso al 80 %', async () => {
    await q(`update asistente_config set cuota_diaria_usuario = 40, tope_mensual_usd = 1 where estudio_id = $1`, [estudio.id]);
    const gastado = Number((await estado(estudio.id, usuario2.id)).gasto_mes);
    await usar(estudio.id, usuario2.id, 'ok', Math.max(0, 0.85 - gastado));
    const e80 = await estado(estudio.id, usuario2.id); igual(e80.motivo, null, 'al 85 %'); igual(e80.aviso, true, 'aviso al 80 %');
    await usar(estudio.id, usuario2.id, 'ok', 0.2);
    igual((await estado(estudio.id, usuario2.id)).motivo, 'tope_mensual', 'pasado el tope');
    igual((await estado(estudio.id, usuario.id)).motivo, 'tope_mensual', 'también para el resto del estudio');
  });

  await prueba('Asistente: apagarlo por estudio tiene prioridad y no afecta a otro estudio', async () => {
    await q(`update asistente_config set activo = false where estudio_id = $1`, [estudio.id]);
    igual((await estado(estudio.id, usuario.id)).motivo, 'apagado', 'estudio apagado'); igual((await estado(estudio.id, usuario.id)).aviso, false, 'sin aviso si está apagado');
    igual((await estado(otro.id, uOtro.id)).motivo, null, 'otro estudio sigue activo');
    await q(`update asistente_config set activo = true where estudio_id = $1`, [estudio.id]);
  });

  await prueba('Asistente: RLS — cada estudio ve y escribe solo lo suyo', async () => {
    await contexto(estudio.id, null, usuario.id);
    await q(`set role app_usuario`);
    try {
      const mios = (await uno(`select count(*)::int n from asistente_uso`)).n;
      if (mios < 6) throw new Error(`debía ver su uso y ve ${mios}`);
      igual((await uno(`select count(*)::int n from asistente_uso where estudio_id <> $1`, [estudio.id])).n, 0, 'uso de otro estudio visible');
      igual((await uno(`select count(*)::int n from v_asistente_gasto_mes where estudio_id <> $1`, [estudio.id])).n, 0, 'gasto de otro estudio visible');
      await rechaza(() => usar(otro.id, uOtro.id, 'ok'), /row-level security/i, 'escribir uso en otro estudio');
      await rechaza(() => q(`update asistente_uso set costo_usd = 0`), /permission denied/i, 'modificar el uso desde la aplicación');
      await usar(estudio.id, usuario.id, 'modo_basico');                       // sí puede agregar lo suyo
      igual((await estado(estudio.id, usuario.id)).cuota_diaria, 40, 'estado de cuota con el rol de la aplicación');
    } finally { await q(`reset role`); }
  });

  await prueba('Asistente: la trazabilidad admite la categoría "asistente"', async () => {
    await contexto(estudio.id, null, usuario.id);
    const id = (await uno(`select fn_registrar_evento('asistente', 'Consultó al asistente', 'Modo: claude · 1.300 tokens') id`)).id;
    igual((await uno(`select categoria from evento where id = $1`, [id])).categoria, 'asistente', 'categoría');
    igual((await uno(`select fn_verificar_trazabilidad($1) v`, [estudio.id])).v, null, 'cadena íntegra');
  });
}

console.log(`\n${correctas} pruebas correctas, ${fallas} con falla`);
process.exit(fallas ? 1 : 0);
