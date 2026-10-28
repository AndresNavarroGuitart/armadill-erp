// Pruebas del constructor de pedidos a ARCA con los comprobantes observados. Uso: node arca/probar_payload.mjs
import { armarFECAESolicitar } from './payload.mjs';

let ok = 0; let mal = 0;
function prueba(nombre, fn) {
  try { fn(); ok += 1; console.log(`ok     ${nombre}`); } catch (e) { mal += 1; console.log(`FALLA  ${nombre}\n         ${e.message}`); }
}
const igual = (a, b, que) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${que}: esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`); };
const CUIT = '30712345676';
const tipoA = { codigo: 1, letra: 'A', clase: 'factura' };

// FA de la prueba V-04 (726,05) con las cinco condiciones de IVA
const fa1 = {
  tipo: tipoA, punto_venta: 1, numero: 1, fecha: '2026-10-28', concepto_codigo: 1, moneda: 'PES', cotizacion: 1,
  condicion_iva_receptor_codigo: 1, imp_neto: '390.00', imp_iva: '76.05', imp_tot_conc: '130.00', imp_op_ex: '130.00', imp_trib: '0.00', imp_total: '726.05',
  ivas: [{ alicuota_codigo: 5, base_imponible: '130.00', importe_iva: '27.30' }, { alicuota_codigo: 4, base_imponible: '130.00', importe_iva: '13.65' },
         { alicuota_codigo: 6, base_imponible: '130.00', importe_iva: '35.10' }],
};

prueba('Factura A con 21 %, 10,5 %, 27 %, exento y no gravado: importes y alícuotas separados', () => {
  const { pedido, errores } = armarFECAESolicitar(fa1, { tipo_documento_codigo: 80, nro_documento: '30111111118' }, { cuitEmisor: CUIT });
  igual(errores, [], 'errores');
  const d = pedido.FeDetReq.FECAEDetRequest[0];
  igual([d.ImpTotal, d.ImpNeto, d.ImpIVA, d.ImpTotConc, d.ImpOpEx], [726.05, 390, 76.05, 130, 130], 'importes');
  igual(d.Iva.AlicIva.map((a) => a.Id), [5, 4, 6], 'códigos de alícuota');
  igual(d.CbteFch, '20261028', 'fecha'); igual(pedido.FeCabReq, { CantReg: 1, PtoVta: 1, CbteTipo: 1 }, 'cabecera');
  igual(d.CondicionIVAReceptorId, 1, 'condición del receptor');
});
prueba('Consumidor final: DocTipo 99 y DocNro 0', () => {
  const b = { ...fa1, tipo: { codigo: 6, letra: 'B', clase: 'factura' }, condicion_iva_receptor_codigo: 5 };
  const d = armarFECAESolicitar(b, { tipo_documento_codigo: 99, nro_documento: '0' }, { cuitEmisor: CUIT }).pedido.FeDetReq.FECAEDetRequest[0];
  igual([d.DocTipo, d.DocNro, d.CondicionIVAReceptorId], [99, 0, 5], 'documento');
});
prueba('Falta la condición del receptor (RG 5616): error antes de llamar a ARCA', () => {
  const { errores } = armarFECAESolicitar({ ...fa1, condicion_iva_receptor_codigo: null }, { tipo_documento_codigo: 80, nro_documento: '30111111118' }, { cuitEmisor: CUIT });
  if (!errores.some((e) => /RG 5616/.test(e))) throw new Error(`errores: ${errores}`);
});
prueba('Nota de crédito sin comprobante asociado es un error; con asociado lleva CbtesAsoc', () => {
  const nc = { ...fa1, tipo: { codigo: 3, letra: 'A', clase: 'nota_credito' }, numero: 1 };
  const sin = armarFECAESolicitar(nc, { tipo_documento_codigo: 80, nro_documento: '30111111118' }, { cuitEmisor: CUIT });
  if (!sin.errores.some((e) => /asociado/.test(e))) throw new Error('debía exigir el asociado');
  const con = armarFECAESolicitar({ ...nc, origen: { tipo_comprobante_codigo: 1, punto_venta: 1, numero: 1, fecha: '2026-10-28' } },
    { tipo_documento_codigo: 80, nro_documento: '30111111118' }, { cuitEmisor: CUIT });
  igual(con.errores, [], 'errores');
  igual(con.pedido.FeDetReq.FECAEDetRequest[0].CbtesAsoc.CbteAsoc[0], { Tipo: 1, PtoVta: 1, Nro: 1, Cuit: CUIT, CbteFch: '20261028' }, 'asociado');
});
prueba('Servicios: exige fechas de servicio y vencimiento de pago', () => {
  const s = { ...fa1, concepto_codigo: 2 };
  if (!armarFECAESolicitar(s, { tipo_documento_codigo: 80, nro_documento: '30111111118' }, { cuitEmisor: CUIT }).errores.some((e) => /servicios/.test(e))) throw new Error('debía exigirlas');
  const d = armarFECAESolicitar({ ...s, fecha_servicio_desde: '2026-10-01', fecha_servicio_hasta: '2026-10-31', fecha_vto_pago: '2026-11-10' },
    { tipo_documento_codigo: 80, nro_documento: '30111111118' }, { cuitEmisor: CUIT }).pedido.FeDetReq.FECAEDetRequest[0];
  igual([d.FchServDesde, d.FchServHasta, d.FchVtoPago], ['20261001', '20261031', '20261110'], 'fechas');
});
prueba('Factura C: no discrimina IVA (sin array Iva) y rechaza un IVA distinto de cero', () => {
  const c = { ...fa1, tipo: { codigo: 11, letra: 'C', clase: 'factura' }, imp_neto: '100.00', imp_iva: '0.00', imp_tot_conc: '0.00', imp_op_ex: '0.00', imp_total: '100.00', ivas: [], condicion_iva_receptor_codigo: 5 };
  const r = armarFECAESolicitar(c, { tipo_documento_codigo: 99, nro_documento: '0' }, { cuitEmisor: CUIT });
  igual(r.errores, [], 'errores'); if ('Iva' in r.pedido.FeDetReq.FECAEDetRequest[0]) throw new Error('la C no lleva Iva');
  if (!armarFECAESolicitar({ ...c, imp_iva: '21.00', imp_total: '121.00' }, { tipo_documento_codigo: 99, nro_documento: '0' }, { cuitEmisor: CUIT }).errores.some((e) => /C no discriminan/.test(e))) throw new Error('debía rechazar el IVA');
});
prueba('Percepción de IIBB: tributo provincial (Id 2) con alícuota en porcentaje', () => {
  const c = { ...fa1, imp_trib: '15.00', imp_total: '741.05', tributos: [{ tipo: 'percepcion_iibb', base_imponible: '500.00', alicuota: 0.03, importe: '15.00' }] };
  const r = armarFECAESolicitar(c, { tipo_documento_codigo: 80, nro_documento: '30111111118' }, { cuitEmisor: CUIT });
  igual(r.errores, [], 'errores');
  igual(r.pedido.FeDetReq.FECAEDetRequest[0].Tributos.Tributo[0], { Id: 2, Desc: 'percepcion_iibb', BaseImp: 500, Alic: 3, Importe: 15 }, 'tributo');
});
prueba('Un total que no es la suma de sus partes (como el 430,95 del original) se detecta antes de enviar', () => {
  const { errores } = armarFECAESolicitar({ ...fa1, imp_total: '430.95' }, { tipo_documento_codigo: 80, nro_documento: '30111111118' }, { cuitEmisor: CUIT });
  if (!errores.some((e) => /ImpTotal/.test(e))) throw new Error(`errores: ${errores}`);
});

console.log(`\n${ok} pruebas correctas, ${mal} con falla`);
process.exit(mal ? 1 : 0);
