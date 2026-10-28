// Arma el pedido FECAESolicitar de WSFEv1 a partir de un comprobante del modelo de datos.
// Función pura: no llama a ARCA ni toca la base. La estructura del pedido y las reglas de validación son de
// conocimiento general y están marcadas [A verificar] contra el manual de WSFEv1 (RG 4291) antes de usarlas en producción.

const TRIBUTO_ID = {                      // [A verificar] Id de tributo de ARCA
  percepcion_iva: 1, percepcion_ganancias: 1, percepcion_suss: 1,   // nacionales
  percepcion_iibb: 2,                     // provinciales
  impuesto_municipal: 3,
  impuesto_interno: 4,
  otro: 99,
};
const aNumero = (x) => Number(Number(x).toFixed(2));
const fechaArca = (iso) => iso.replaceAll('-', '');               // 2026-10-28 -> 20261028

/**
 * @param {object} c       comprobante: { tipo: {codigo, letra, clase, es_fce}, punto_venta, numero, fecha, concepto_codigo,
 *                         fecha_servicio_desde, fecha_servicio_hasta, fecha_vto_pago, moneda, cotizacion,
 *                         condicion_iva_receptor_codigo, imp_*, ivas: [{alicuota_codigo, base_imponible, importe_iva}],
 *                         tributos: [{tipo, descripcion, base_imponible, alicuota, importe}], origen? }
 * @param {object} tercero { tipo_documento_codigo, nro_documento }
 * @param {object} ctx     { cuitEmisor }
 * @returns {{pedido: object, errores: string[]}}
 */
export function armarFECAESolicitar(c, tercero, ctx) {
  const errores = [];
  const esC = c.tipo.letra === 'C';
  const esNota = c.tipo.clase === 'nota_credito' || c.tipo.clase === 'nota_debito';

  if (!c.numero) errores.push('falta el número: se obtiene con FECompUltimoAutorizado + 1');
  if (c.condicion_iva_receptor_codigo == null) errores.push('falta la condición frente al IVA del receptor (RG 5616)');
  if ([2, 3].includes(c.concepto_codigo) && !(c.fecha_servicio_desde && c.fecha_servicio_hasta && c.fecha_vto_pago)) {
    errores.push('concepto de servicios: se exigen fecha de servicio desde/hasta y vencimiento de pago');
  }
  if (esNota && !c.origen) errores.push('las notas de crédito y débito exigen el comprobante asociado (CbtesAsoc)');

  const suma = aNumero(c.imp_neto) + aNumero(c.imp_iva) + aNumero(c.imp_tot_conc) + aNumero(c.imp_op_ex) + aNumero(c.imp_trib);
  if (Math.abs(suma - aNumero(c.imp_total)) > 0.001) errores.push(`ImpTotal ${c.imp_total} no es la suma de sus partes (${suma.toFixed(2)})`);
  if (esC && aNumero(c.imp_iva) !== 0) errores.push('las facturas C no discriminan IVA');
  const sumaIva = (c.ivas ?? []).reduce((a, i) => a + aNumero(i.importe_iva), 0);
  if (Math.abs(sumaIva - aNumero(c.imp_iva)) > 0.001) errores.push('el IVA por alícuota no suma el ImpIVA de la cabecera');
  if (!esC && aNumero(c.imp_neto) > 0 && !(c.ivas ?? []).length) errores.push('hay neto gravado pero ninguna alícuota de IVA');

  const sinIdentificar = tercero.tipo_documento_codigo === 99;
  const detalle = {
    Concepto: c.concepto_codigo ?? 1,
    DocTipo: tercero.tipo_documento_codigo,
    DocNro: sinIdentificar ? 0 : Number(tercero.nro_documento),
    CbteDesde: Number(c.numero),
    CbteHasta: Number(c.numero),
    CbteFch: fechaArca(c.fecha),
    ImpTotal: aNumero(c.imp_total),
    ImpTotConc: aNumero(c.imp_tot_conc),
    ImpNeto: aNumero(c.imp_neto),
    ImpOpEx: aNumero(c.imp_op_ex),
    ImpTrib: aNumero(c.imp_trib),
    ImpIVA: aNumero(c.imp_iva),
    MonId: c.moneda ?? 'PES',
    MonCotiz: Number(c.cotizacion ?? 1),
    CondicionIVAReceptorId: c.condicion_iva_receptor_codigo,
  };
  if ([2, 3].includes(c.concepto_codigo)) {
    detalle.FchServDesde = fechaArca(c.fecha_servicio_desde ?? c.fecha);
    detalle.FchServHasta = fechaArca(c.fecha_servicio_hasta ?? c.fecha);
    detalle.FchVtoPago = fechaArca(c.fecha_vto_pago ?? c.fecha);
  }
  if (esNota && c.origen) {
    detalle.CbtesAsoc = { CbteAsoc: [{
      Tipo: c.origen.tipo_comprobante_codigo, PtoVta: c.origen.punto_venta, Nro: Number(c.origen.numero),
      Cuit: ctx.cuitEmisor, CbteFch: fechaArca(c.origen.fecha),
    }] };
  }
  if ((c.tributos ?? []).length) {
    detalle.Tributos = { Tributo: c.tributos.map((t) => ({
      Id: TRIBUTO_ID[t.tipo] ?? 99, Desc: t.descripcion ?? t.tipo, BaseImp: aNumero(t.base_imponible ?? 0),
      Alic: Number(((t.alicuota ?? 0) * 100).toFixed(4)), Importe: aNumero(t.importe) })) };
  }
  if (!esC && (c.ivas ?? []).length) {
    detalle.Iva = { AlicIva: c.ivas.map((i) => ({ Id: i.alicuota_codigo, BaseImp: aNumero(i.base_imponible), Importe: aNumero(i.importe_iva) })) };
  }

  return {
    errores,
    pedido: {
      FeCabReq: { CantReg: 1, PtoVta: c.punto_venta, CbteTipo: c.tipo.codigo },
      FeDetReq: { FECAEDetRequest: [detalle] },
    },
  };
}
