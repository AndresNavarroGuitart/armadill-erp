// Motor de referencia de las reglas de cálculo observadas en administraNET Gestión 4.
// Sin dependencias. Aritmética decimal exacta (enteros BigInt con 6 decimales).
// Cada función cita los casos de PRUEBAS_CAJA_NEGRA.md que la respaldan.

const ESCALA = 1_000_000n; // 6 decimales internos

/** Convierte "33,33", "33.33" o un número a decimal escalado. */
export function dec(valor) {
  if (typeof valor === 'bigint') return valor;
  let s = String(valor).trim();
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); // formato "1.234,56"
  const negativo = s.startsWith('-');
  const [entera, fraccion = ''] = s.replace('-', '').split('.');
  const f = (fraccion + '000000').slice(0, 6);
  const r = BigInt(entera || '0') * ESCALA + BigInt(f);
  return negativo ? -r : r;
}

export const mul = (a, b) => redondearEscala((a * b), ESCALA);
export const div = (a, b) => redondearEscala(a * ESCALA, b);

function redondearEscala(num, den) {
  // división entera con redondeo "half away from zero"
  const neg = (num < 0n) !== (den < 0n);
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const q = (2n * n + d) / (2n * d);
  return neg ? -q : q;
}

/** Redondea a `dec` decimales (half away from zero). */
export function redondear(a, decimales = 2) {
  const unidad = ESCALA / 10n ** BigInt(decimales);
  return redondearEscala(a, unidad) * unidad;
}

export function texto(a, decimales = 2) {
  const r = redondear(a, decimales);
  const neg = r < 0n;
  const abs = neg ? -r : r;
  const entera = abs / ESCALA;
  const frac = (abs % ESCALA).toString().padStart(6, '0').slice(0, decimales);
  return `${neg ? '-' : ''}${entera}${decimales ? '.' + frac : ''}`;
}

export const ALICUOTAS = { '21': dec('0.21'), '10.5': dec('0.105'), '27': dec('0.27'), '5': dec('0.05'), '2.5': dec('0.025') };
const SIN_IVA = new Set(['exento', 'nogravado']);
const uno = ESCALA;

// ---------------------------------------------------------------------------
// COMPRAS  (casos C-01 a C-08, FA de compra del 28/10/2026)
// ---------------------------------------------------------------------------
/**
 * renglón: { precio, cantidad, alicuota: '21'|'10.5'|'27'|'exento'|'nogravado', descPct?, bonifPct? }
 * opciones: { descPiePct? }
 * Reglas observadas:
 *  1. neto_renglón = precio × cantidad × (1 − desc) × (1 − bonif)   (encadenado, 4 decimales)
 *  2. subtotal_columna = Σ neto_renglón, redondeado a 2 decimales
 *  3. desc_pie = redondear(subtotal × %) por columna; base = subtotal − desc_pie
 *  4. IVA_columna = redondear(base × alícuota)  — se redondea por COLUMNA, no por renglón
 *  5. exento + no gravado se suman en una sola caja
 *  6. total = Σ base + Σ IVA + exento/no gravado
 */
export function compra(renglones, opciones = {}) {
  const descPie = dec(opciones.descPiePct ?? 0) / 100n; // 5 -> 0.05
  const columnas = {};
  let sinIva = 0n;
  for (const r of renglones) {
    const bruto = mul(dec(r.precio), dec(r.cantidad));
    const tras = mul(mul(bruto, uno - mul(dec(r.descPct ?? 0), dec('0.01'))), uno - mul(dec(r.bonifPct ?? 0), dec('0.01')));
    const neto = redondear(tras, 4);
    if (SIN_IVA.has(r.alicuota)) { sinIva += neto; continue; }
    columnas[r.alicuota] = (columnas[r.alicuota] ?? 0n) + neto;
  }
  const salida = { columnas: {}, exento: texto(redondear(sinIva, 2)) };
  let base = 0n, iva = 0n;
  for (const [alic, suma] of Object.entries(columnas)) {
    const subtotal = redondear(suma, 2);
    const desc = redondear(mul(subtotal, descPie), 2);
    const b = subtotal - desc;
    const i = redondear(mul(b, ALICUOTAS[alic]), 2);
    salida.columnas[alic] = { subtotal: texto(subtotal), descuento: texto(desc), base: texto(b), iva: texto(i) };
    base += b; iva += i;
  }
  salida.iva = texto(iva);
  // percepciones sufridas { gan, iva, ib }: se suman al total, NO a la base ni al IVA (caso C-12)
  const per = opciones.percepciones ?? {};
  const percepciones = ['gan', 'iva', 'ib'].reduce((a, k) => a + dec(per[k] ?? 0), 0n);
  salida.percepciones = texto(percepciones);
  salida.total = texto(base + iva + redondear(sinIva, 2) + percepciones);
  return salida;
}

// ---------------------------------------------------------------------------
// VENTAS  (casos V-01 a V-09; precios con IVA incluido)
// ---------------------------------------------------------------------------
/**
 * renglón: { precioFinal, cantidad, alicuota, descPct? }   (precioFinal incluye IVA)
 * Reglas observadas:
 *  1. final_renglón = precioFinal × cantidad × (1 − desc)   (4 decimales)
 *  2. F_columna = Σ final_renglón (2 decimales);  neto = redondear(F / (1 + alícuota))
 *  3. sin descuento al pie:  IVA = F − neto   (29,00 -> 23,97 + 5,03)
 *  4. con descuento al pie:  desc = redondear(neto × %);  base = neto − desc;  IVA = redondear(base × alícuota)
 *  5. total = Σ base + Σ IVA + exento + no gravado
 * NOTA: el original solo tiene columnas 21 %, 10,5 % y una caja de exento; aquí
 * se soportan todas (ver defectos D-01 y D-02 en la especificación).
 */
export function venta(renglones, opciones = {}) {
  const descPie = dec(opciones.descPiePct ?? 0) / 100n;
  const finales = {};
  let exento = 0n, noGravado = 0n;
  for (const r of renglones) {
    const f = redondear(mul(mul(dec(r.precioFinal), dec(r.cantidad)), uno - mul(dec(r.descPct ?? 0), dec('0.01'))), 4);
    if (r.alicuota === 'exento') exento += f;
    else if (r.alicuota === 'nogravado') noGravado += f;
    else finales[r.alicuota] = (finales[r.alicuota] ?? 0n) + f;
  }
  const salida = { columnas: {} };
  let base = 0n, iva = 0n;
  for (const [alic, suma] of Object.entries(finales)) {
    const F = redondear(suma, 2);
    const neto = redondear(div(F, uno + ALICUOTAS[alic]), 2);
    let i, desc = 0n, b = neto;
    if (descPie === 0n) {
      i = F - neto;
    } else {
      desc = redondear(mul(neto, descPie), 2);
      b = neto - desc;
      i = redondear(mul(b, ALICUOTAS[alic]), 2);
    }
    salida.columnas[alic] = { final: texto(F), neto: texto(neto), descuento: texto(desc), base: texto(b), iva: texto(i) };
    base += b; iva += i;
  }
  const ex = redondear(exento, 2), ng = redondear(noGravado, 2);
  salida.exento = texto(ex);
  salida.noGravado = texto(ng);
  salida.iva = texto(iva);
  salida.total = texto(base + iva + ex + ng);
  salida.sumaRenglones = texto(redondear(Object.values(finales).reduce((a, x) => a + x, 0n) + exento + noGravado, 2));
  return salida;
}

/** Desglose de un total final con IVA incluido (Factura B / consumidor final en el libro). */
export function desglosar(totalFinal, alicuota = '21') {
  const F = redondear(dec(totalFinal), 2);
  const neto = redondear(div(F, uno + ALICUOTAS[alicuota]), 2);
  return { neto: texto(neto), iva: texto(F - neto), total: texto(F) };
}

// ---------------------------------------------------------------------------
// DÓLAR  (caso C-10)
// ---------------------------------------------------------------------------
/** precio_pesos = precio_USD × cotización del día. IVA y pie se calculan en pesos. */
export function aPesos(precioUsd, cotizacion) {
  return texto(redondear(mul(dec(precioUsd), dec(cotizacion)), 2));
}

// ---------------------------------------------------------------------------
// COBRANZAS Y PAGOS  (casos S-02, R-01, R-04)
// ---------------------------------------------------------------------------
/** Identidad de recibos y órdenes de pago: imputado = medios + retenciones + descuentos. */
export function recibo({ imputado, retenciones = [], descuento = 0, saldoComprobante }) {
  const ret = retenciones.reduce((a, x) => a + dec(x), 0n);
  const cobro = dec(imputado) - ret - dec(descuento);
  const salida = { retenciones: texto(ret), mediosDeCobro: texto(cobro), total: texto(dec(imputado)) };
  if (saldoComprobante !== undefined) {
    const saldo = dec(saldoComprobante) - dec(imputado);
    salida.saldoComprobante = texto(saldo);
    salida.estado = saldo === 0n ? 'Canc' : 'N/Canc';
  }
  return salida;
}

/** PROPUESTA de la réplica (no es lo que hace el original, que deja el importe a mano). */
export function retencionSugerida(base, porcentaje, minimo = 0) {
  const b = dec(base);
  if (b < dec(minimo)) return texto(0n);
  return texto(redondear(mul(b, dec(porcentaje) / 100n), 2));
}

// ---------------------------------------------------------------------------
// LIBROS Y POSICIÓN DE IVA  (casos L-01 a L-05)
// ---------------------------------------------------------------------------
/** Posición de IVA = débito (ventas, netas de NC) − crédito (compras). */
export function posicionIva({ ivaVentas = [], ivaCompras = [], retencion = 0, percepcion = 0 }) {
  const suma = (xs) => xs.reduce((a, x) => a + dec(x), 0n);
  const debito = suma(ivaVentas), credito = suma(ivaCompras);
  const tecnico = debito - credito;
  return {
    debito: texto(debito), credito: texto(credito), saldoTecnico: texto(tecnico),
    saldo: texto(tecnico - dec(retencion) - dec(percepcion)),
  };
}

/** Una nota de crédito entra en el libro con signo negativo en todas las columnas. */
export function filaLibro(tipo, { subtotal, iva, total }) {
  const signo = tipo.startsWith('NC') ? -1n : 1n;
  return { subtotal: texto(signo * dec(subtotal)), iva: texto(signo * dec(iva)), total: texto(signo * dec(total)) };
}

// ---------------------------------------------------------------------------
// SALDOS  (casos S-01 a S-03)
// ---------------------------------------------------------------------------
/** Saldo de cuenta corriente: facturas y ND suman; NC y recibos restan. */
export function saldoCuenta(movimientos) {
  let s = 0n;
  for (const m of movimientos) {
    const v = dec(m.importe);
    s += ['FA', 'FB', 'FC', 'ND'].includes(m.tipo) ? v : -v;
  }
  return texto(s);
}

// ---------------------------------------------------------------------------
// STOCK Y DEVOLUCIONES  (casos T-01, S-03, S-04, S-05)
// ---------------------------------------------------------------------------
/** Stock = Σ compras − Σ ventas + Σ devoluciones de venta (puede quedar negativo). */
export function stock(movimientos) {
  let s = dec(0);
  for (const m of movimientos) {
    const c = dec(m.cantidad);
    s += ['compra', 'devolucionVenta'].includes(m.tipo) ? c : -c;
  }
  return texto(s, 0);
}

/** NC por devolución parcial: recalcula el pie de venta con la cantidad devuelta. */
export function devolucionParcial(precioFinal, cantidadDevuelta, alicuota = '21') {
  return venta([{ precioFinal, cantidad: cantidadDevuelta, alicuota }]);
}

/** Pago mixto: la suma de los medios debe igualar el total. */
export function pagoMixto(total, medios) {
  const suma = medios.reduce((a, x) => a + dec(x), 0n);
  const saldo = dec(total) - suma;
  return { suma: texto(suma), saldo: texto(saldo), valido: saldo === 0n };
}

// ---------------------------------------------------------------------------
// PERÍODO FISCAL  (hallazgo del 28/10/2026)
// ---------------------------------------------------------------------------
/**
 * Regla propuesta para la réplica: se resuelve por FECHA (no por mes).
 * Un comprobante se acepta si existe un período que contenga la fecha, no esté
 * anulado, esté abierto, y su vencimiento fiscal sea >= hoy.
 * (El original toma la primera fila del mes y falla cuando hay filas de años distintos.)
 */
export function periodoAceptado(fecha, periodos, hoy) {
  const p = periodos.find((x) => !x.anulado && x.inicio <= fecha && fecha <= x.fin);
  if (!p) return { aceptado: false, motivo: 'sin_periodo' };
  if (!p.abierto) return { aceptado: false, motivo: 'cerrado' };
  if (p.vencimiento < hoy) return { aceptado: false, motivo: 'vencido' };
  return { aceptado: true, motivo: 'ok' };
}
