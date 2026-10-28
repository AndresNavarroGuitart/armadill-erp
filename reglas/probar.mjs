// Ejecuta casos.json contra calculo.mjs.   Uso:  node reglas/probar.mjs
import { readFileSync } from 'node:fs';
import * as motor from './calculo.mjs';

const casos = JSON.parse(readFileSync(new URL('./casos.json', import.meta.url), 'utf8'));

const llamar = {
  compra: (e) => motor.compra(e.renglones, { descPiePct: e.descPiePct, percepciones: e.percepciones }),
  venta: (e) => motor.venta(e.renglones, { descPiePct: e.descPiePct }),
  desglosar: (e) => motor.desglosar(e.totalFinal, e.alicuota),
  aPesos: (e) => motor.aPesos(e.precioUsd, e.cotizacion),
  recibo: (e) => motor.recibo(e),
  retencionSugerida: (e) => motor.retencionSugerida(e.base, e.porcentaje, e.minimo),
  filaLibro: (e) => motor.filaLibro(e.tipo, e.fila),
  posicionIva: (e) => motor.posicionIva(e),
  saldoCuenta: (e) => motor.saldoCuenta(e.movimientos),
  periodoAceptado: (e) => motor.periodoAceptado(e.fecha, e.periodos, e.hoy),
  stock: (e) => motor.stock(e.movimientos),
  devolucionParcial: (e) => motor.devolucionParcial(e.precioFinal, e.cantidadDevuelta, e.alicuota),
  pagoMixto: (e) => motor.pagoMixto(e.total, e.medios),
};

/** Todo lo esperado debe estar en lo obtenido (subconjunto profundo). */
function diferencias(esperado, obtenido, ruta = '') {
  if (esperado !== null && typeof esperado === 'object') {
    return Object.entries(esperado).flatMap(([k, v]) =>
      diferencias(v, obtenido?.[k], ruta ? `${ruta}.${k}` : k));
  }
  return esperado === obtenido ? [] : [`${ruta || 'valor'}: esperado ${esperado}, obtenido ${obtenido}`];
}

let fallos = 0;
for (const caso of casos) {
  let dif;
  try {
    dif = diferencias(caso.esperado, llamar[caso.funcion](caso.entrada));
  } catch (error) {
    dif = [`excepción: ${error.message}`];
  }
  const etiqueta = caso.origen === 'propuesta' ? ' (propuesta)' : '';
  if (dif.length) {
    fallos += 1;
    console.log(`FALLA  ${caso.id}${etiqueta}  ${caso.ref}`);
    dif.forEach((d) => console.log(`         ${d}`));
  } else {
    console.log(`ok     ${caso.id}${etiqueta}  ${caso.ref}`);
  }
}
const observados = casos.filter((c) => c.origen === 'observado').length;
console.log(`\n${casos.length - fallos}/${casos.length} casos correctos (${observados} observados en el programa original, ${casos.length - observados} propuestas)`);
process.exit(fallos ? 1 : 0);
