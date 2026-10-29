// Cálculo de una factura de venta con PRECIOS NETOS, con las mismas reglas que el motor de referencia (reglas/calculo.mjs, función
// compra) pero separando exento y no gravado, que ARCA informa en importes distintos (ImpOpEx e ImpTotConc).
// Aritmética decimal exacta (BigInt): nunca se usa punto flotante con dinero.
//   1. neto del renglón = precio × cantidad × (1 − descuento), redondeado a 4 decimales
//   2. subtotal de cada alícuota = Σ renglones, a 2 decimales
//   3. descuento al pie = subtotal × %, por alícuota; base = subtotal − descuento
//   4. IVA = base × alícuota, redondeado POR ALÍCUOTA (no por renglón)
//   5. total = Σ bases + Σ IVA + exento + no gravado   (y es exactamente la suma de sus partes)
import { dec, mul, redondear, texto } from '../reglas/calculo.mjs';

export const TASAS = { '0': dec('0'), '2.5': dec('0.025'), '5': dec('0.05'), '10.5': dec('0.105'), '21': dec('0.21'), '27': dec('0.27') };
export const CODIGO_ALICUOTA = { '0': 3, '10.5': 4, '21': 5, '27': 6, '5': 8, '2.5': 9 };
const UNO = dec('1'), CIEN = dec('100');

/**
 * @param items   [{ cantidad, precio, descPct, tratamiento: 'gravado'|'exento'|'no_gravado', alicuota: '21' }]  (números como texto)
 * @param opciones { descPiePct }  porcentaje de 0 a 99,99
 */
export function calcularVenta(items, { descPiePct = '0' } = {}) {
  const pie = mul(dec(descPiePct), dec('0.01'));
  const columnas = new Map(); let exento = 0n, noGravado = 0n;
  const salidaItems = items.map((it) => {
    const bruto = mul(dec(it.precio), dec(it.cantidad));
    const neto = redondear(mul(bruto, UNO - mul(dec(it.descPct ?? '0'), dec('0.01'))), 4);
    if (it.tratamiento === 'exento') exento += neto;
    else if (it.tratamiento === 'no_gravado') noGravado += neto;
    else columnas.set(it.alicuota, (columnas.get(it.alicuota) ?? 0n) + neto);
    return { importeRenglon: texto(neto, 4) };
  });
  const ivas = []; let base = 0n, iva = 0n, descTotal = 0n;
  for (const [alicuota, suma] of [...columnas].sort((a, b) => (TASAS[b[0]] > TASAS[a[0]] ? 1 : -1))) {
    const subtotal = redondear(suma, 2), desc = redondear(mul(subtotal, pie), 2), b = subtotal - desc, i = redondear(mul(b, TASAS[alicuota]), 2);
    ivas.push({ alicuota, codigo: CODIGO_ALICUOTA[alicuota], subtotal: texto(subtotal), descuento: texto(desc), base: texto(b), iva: texto(i) });
    base += b; iva += i; descTotal += desc;
  }
  const ex = redondear(exento, 2), ng = redondear(noGravado, 2);
  return { items: salidaItems, ivas, impNeto: texto(base), impIva: texto(iva), impTotConc: texto(ng), impOpEx: texto(ex), impDescPie: texto(descTotal), impTrib: '0.00', impTotal: texto(base + iva + ex + ng) };
}
export { CIEN };
