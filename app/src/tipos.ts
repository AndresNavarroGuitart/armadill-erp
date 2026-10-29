// Formas de las respuestas de la API (api/LEEME.md). Los importes llegan como texto decimal: el front los muestra, no los calcula.
export type EmpresaResumen = { id: number; razon_social: string; cuit: string; condicion_iva_codigo: number; rol: string };
export type EmpresaActiva = { id: number; razon_social: string; cuit: string; condicion_iva_codigo: number; rol: string; permisos: string[] };
export type Yo = { usuario: { id: number; nombre: string }; estudio_id: number; admin_estudio: boolean; empresas: EmpresaResumen[]; empresa_activa: EmpresaActiva | null };

export type Pagina<T> = { datos: T[]; total: number; limite: number; desplazamiento: number };
export type TipoDocumento = 'CUIT' | 'CUIL' | 'DNI' | 'SIN_IDENTIFICAR';
export type Tercero = {
  id: number; tipo_documento: TipoDocumento; nro_documento: string; razon_social: string; nombre_fantasia: string | null; condicion_iva_codigo: number;
  es_cliente: boolean; es_proveedor: boolean; activo: boolean; email: string | null; telefono: string | null; nro_iibb: string | null; convenio_multilateral: boolean;
  condicion_pago_dias: number; limite_credito: string; lista_precio_id: number | null; saldo?: string | null;
};
export type Lista = { id: number; nombre: string; orden: number };
export type Articulo = {
  id: number; codigo: string; nombre: string; tipo: 'bien' | 'servicio' | 'gasto' | 'bien_de_uso'; tratamiento_iva_venta: 'gravado' | 'exento' | 'no_gravado';
  alicuota_venta: string | null; controla_stock: boolean; stock_minimo?: string | null; activo: boolean; precio_neto?: string | null; costo?: string | null;
};
export type ItemFactura = { articulo_id: number; descripcion?: string; cantidad: string; precio_unitario?: string; desc_pct?: string };
export type PedidoFactura = { tercero_id: number; punto_venta?: number; fecha?: string; concepto?: number; fecha_servicio_desde?: string; fecha_servicio_hasta?: string; fecha_vto_pago?: string; desc_pie_pct?: string; observaciones?: string; items: ItemFactura[] };
export type PreviaFactura = {
  letra: 'A' | 'B' | 'C'; tipo_comprobante_codigo: number; punto_venta: number; fecha: string; cliente: { id: number; razon_social: string; condicion_iva_codigo: number };
  items: { articulo_id: number; descripcion: string; cantidad: string; precio_unitario: string; desc_pct: string; importe_renglon: string }[];
  ivas: { alicuota: string; base_imponible: string; importe_iva: string }[];
  imp_neto: string; imp_iva: string; imp_tot_conc: string; imp_op_ex: string; imp_desc_pie: string; imp_total: string; avisos: string[];
};
export type ComprobanteResumen = { id: number; letra: string; tipo: string; punto_venta: number; numero: number | null; numero_formateado: string | null; fecha: string; tercero_id: number; cliente: string; imp_total: string; estado: string; cae: string | null };
export type Comprobante = ComprobanteResumen & {
  imp_neto: string; imp_iva: string; imp_tot_conc: string; imp_op_ex: string; imp_trib: string; avisos?: string[]; repetido?: boolean;
  items: { descripcion: string; cantidad: string; precio_unitario: string; desc_pct?: string; importe_renglon?: string }[];
  ivas: { alicuota: string; base_imponible: string; importe_iva: string }[]; asiento?: { id: number; estado: string } | null;
};

/* ---------- administración del estudio ---------- */
export type Acceso = { empresa_id: number; empresa: string; rol_id: number; rol: string };
export type Persona = { id: number; email: string; nombre: string; activo: boolean; admin_estudio: boolean; vinculada: boolean; invitada_en: string | null; accesos: Acceso[] };
export type ResultadoInvitacion = { estado: 'invitada' | 'ya_tiene_cuenta'; email: string; mensaje: string };
export type EmpresaAdmin = { id: number; cuit: string; razon_social: string; condicion_iva_codigo: number; inicio_actividades: string | null; nro_iibb: string | null; domicilio_fiscal: string | null; convenio_multilateral: boolean; activa: boolean; personas: number };
export type Rol = { id: number; nombre: string; sistema: boolean; accesos: number; permisos: string[] };
export type Permiso = { clave: string; modulo: string; descripcion: string };
export type EstudioDatos = { id: number; nombre: string; cuit: string | null; personas: number; empresas: number; invitaciones: boolean };

/* ---------- stock y listas ---------- */
export type Deposito = { id: number; nombre: string; activo: boolean; articulos_con_stock: number };
export type Existencia = { articulo_id: number; codigo: string; nombre: string; stock_minimo: string | null; total: string; bajo_minimo: boolean; por_deposito: { deposito_id: number; saldo: string }[] };
export type Movimiento = { id: number; fecha: string; articulo_id: number; codigo: string; articulo: string; deposito_id: number; deposito: string; cantidad: string; tipo: string; motivo: string | null; costo_unitario: string | null; comprobante: string | null };
export type ListaPrecio = { id: number; nombre: string; orden: number; articulos: number; clientes: number };
export type FilaAjuste = { articulo_id: number; codigo: string; nombre: string; base: string; actual: string | null; nuevo: string; bajo_costo: boolean; costo: string | null };
export type ResultadoAjuste = { aplicado: boolean; lista: string; base_lista_id: number; porcentaje: string; vigente_desde: string; redondeo: string; total: number; cambian: number; sin_cambio: number; sin_precio_base: number; bajo_costo: number; datos?: FilaAjuste[] };

/* ---------- trazabilidad ---------- */
export type EventoTraza = { id: number; nro: number; codigo: string; en: string; empresa_id: number | null; empresa: string | null; usuario_id: number | null; usuario: string | null; categoria: string; accion: string; detalle: string | null; resultado: 'ok' | 'rechazo' | 'fallo'; entidad_tabla: string | null; entidad_id: number | null };
export type EventoDetalle = EventoTraza & { cambios: { campo: string; antes: string | null; despues: string | null }[] | null; ip: string | null; dispositivo: string | null; huella_prev: string; huella: string; huella_ok: boolean; enlace_ok: boolean };
export type VerificacionCadena = { integra: boolean; primer_evento_roto: number | null; eventos: number; cabeza: { nro: number; huella: string; en: string } | null; resguardo: { coincide: boolean; motivo: string } | null };

/* ---------- anulaciones y notas de crédito ---------- */
export type ComprobanteDetalle = Omit<Comprobante, 'items' | 'ivas' | 'asiento'> & {
  clase: 'factura' | 'nota_debito' | 'nota_credito' | 'recibo'; observaciones: string | null; imp_desc_pie: string; saldo: string | null;
  items: { id: number; orden: number; item_origen_id: number | null; descripcion: string; cantidad: string; precio_unitario: string; desc_pct?: string; importe_renglon: string; acreditado: string; por_acreditar: string }[];
  ivas: { alicuota: string; base_imponible: string; importe_iva: string }[]; asiento: { id: number; estado: string } | null;
  anulacion: { motivo: string; en: string; por: string | null } | null; origen: { id: number; tipo: string; numero_formateado: string } | null;
  notas: { id: number; tipo: string; numero_formateado: string | null; imp_total: string; estado: string }[];
  acciones: { anular: string | null; nota_credito: string | null };
};
export type PreviaNota = {
  letra: string; tipo_comprobante_codigo: number; punto_venta: number; fecha: string; origen: { id: number; etiqueta: string; total: string }; cliente: { id: number; razon_social: string };
  items: { item_id: number; descripcion: string; cantidad: string; precio_unitario: string; importe_renglon: string; devuelve_stock: boolean }[];
  ivas: { alicuota: string; base_imponible: string; importe_iva: string }[]; imp_neto: string; imp_iva: string; imp_tot_conc: string; imp_op_ex: string; imp_desc_pie: string; imp_total: string; saldo_factura: string; avisos: string[];
};

/* ---------- compras ---------- */
export type PreviaCompra = {
  clase?: string; origen?: { id: number; etiqueta: string; saldo: string } | null; letra: string; tipo_comprobante_codigo: number; proveedor: { id: number; razon_social: string }; fecha: string; discrimina_iva: boolean;
  items: { descripcion: string; cantidad: string; precio_unitario: string; tratamiento: string; alicuota: string | null; importe_renglon: string; ingresa_stock: boolean; devuelve_stock?: boolean }[];
  ivas: { alicuota: string; base_imponible: string; importe_iva: string }[]; imp_neto: string; imp_iva: string; imp_tot_conc: string; imp_op_ex: string; imp_trib: string;
  total_calculado: string; total_informado: string; diferencia: string; coincide: boolean; avisos: string[];
};
export type Cuenta = { id: number; codigo: string; nombre: string; tipo: string };
export type Jurisdiccion = { codigo: number; nombre: string };

/* ---------- tesorería ---------- */
export type Caja = { id: number; nombre: string; tipo: 'efectivo' | 'tarjetas' | 'otra'; activa: boolean; cuenta_contable_id: number | null; cuenta_codigo: string | null; cuenta_nombre: string | null; saldo: string };
export type Banco = { id: number; banco: string; numero_cuenta: string | null; cbu: string | null; alias: string | null; activa: boolean; cuenta_contable_id: number | null; cuenta_codigo: string | null; saldo: string };
export type MovimientoTesoreria = { id: number; fecha: string; importe: string; concepto: string | null; caja: string | null; banco: string | null; caja_id: number | null; cuenta_bancaria_id: number | null; pago_id: number | null };
export type PagoResumen = { id: number; numero_formateado: string; fecha: string; tercero_id: number; tercero: string; total_documento: string; total_imputado: string; a_cuenta: string; estado: 'confirmado' | 'anulado' };
export type Pendiente = { id: number; tipo: string; numero_formateado: string; fecha: string; vencimiento: string | null; total: string; saldo: string };
export type PreviaPago = {
  tercero: { id: number; razon_social: string }; fecha: string; total_medios: string; total_retenciones: string; total_descuentos: string; total_documento: string; total_imputado: string; a_cuenta: string;
  imputaciones: { comprobante_id: number; comprobante: string; importe: string; saldo_antes: string; saldo_despues: string }[]; avisos: string[];
};
export type PagoDetalle = PagoResumen & {
  clase: 'cobro' | 'pago'; etiqueta: string; total_medios: string; total_retenciones: string; total_descuentos: string; observaciones: string | null; asiento: { id: number; numero: number; estado: string } | null;
  medios: { medio: string; importe: string; destino: string }[]; retenciones: { tipo: string; origen: string; jurisdiccion_codigo: number | null; importe: string; certificado_numero: string; certificado_fecha: string }[];
  imputaciones: { comprobante_id: number; comprobante: string; importe: string }[]; anulacion: { motivo: string; en: string; por: string | null } | null;
};
export type CuentaCorriente = { tercero: { id: number; razon_social: string }; saldo: string; movimientos: { fecha: string; clase: 'comprobante' | 'pago'; id: number; detalle: string; importe: string; saldo: string }[] };

/* ---------- cheques ---------- */
export type Cheque = { id: number; origen: 'propio' | 'tercero'; numero: string; banco: string | null; cuit_librador: string | null; importe: string; fecha_emision: string | null; fecha_pago: string | null; estado: string; tercero_id: number | null; tercero: string | null; cuenta_bancaria_id: number | null; cuenta_banco: string | null; cuenta_numero: string | null; acciones: string[]; diferido: boolean };
export type ChequeDetalle = Cheque & { eventos: { id: number; fecha: string; estado_anterior: string | null; estado_nuevo: string; nota: string | null; pago_id: number | null; comprobante: string | null }[] };
export type ResumenCheque = { origen: string; estado: string; cantidad: number; importe: string };
