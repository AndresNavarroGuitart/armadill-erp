# Ventas > Facturación y Cobranzas — pantallas y cruce con la base (2026-10-27)

Fuente: recorrido del cliente administraNET Gestión 4 (empresa vacía, usuario Supervisor, sucursal Casa Matriz) + `C:\administraNET\Bases\estructura_default_adm.sql`. No se emitió ningún comprobante: cada pantalla se abrió y se canceló.

## 1. Facturación (`Gestión > Ventas > Facturación`, F2)

### Flujo
1. Se abre un **selector de clientes**: grilla (Nombre, Código, CUIT/DOC, IVA, Tipo, Teléfono, Email, WhatsApp, Saldo) y búsqueda rápida (texto, modo Normal, tipo "Comienza con"). Búsqueda por código, nombre y CUIT. La grilla está vacía hasta buscar.
2. **Tipo Factura**: `Sistema` (el programa numera) o `Talonario` (talonario preimpreso).
3. Menús de la ventana: Archivo (Copiar celda, Salir), **Facturar**, **Acciones**, Informes (Visualizar, F12).
   - Facturar: Cliente (F2), Consumidor Final (F3), Pedido (F4), Remito (F5), Pedidos Pendientes (F6), Remitos Pendientes (F7), Masiva (F8).
   - Acciones: Ver Cuenta Corriente (F9), Agregar Cliente (F10), Agregar Cliente Rápido (F11), Editar Cliente Rápido, Visualizar domicilios y contactos (Shift+D).
4. El tipo de comprobante (A, B, C, E, M) lo decide la condición de IVA del cliente: Consumidor Final abre **Factura B**.

### Formulario "Factura B – Consumidor Final"
- **Encabezado**: Fecha (default hoy), Detalle, **PV** (punto de venta, default 1), Lista precio (default "Contado", tomada del cliente), Cliente, Vendedor (botón de selección), Cond Venta (default Contado), Vencimiento (calculado según días de la condición), Datos (botón: forma de entrega y datos adicionales), Permiso Supervisor (botón: habilita descuentos y cambio de precio).
- **Pestaña Cuerpo Comprobante**: grilla Renglón con Cód. Sistema 2, Descripción, Precio x U, Marca, Cantidad, % Alic, % Des, Precio Neto, Nro Pedido, Nro Remito… y 7 botones laterales (agregar, modificar, quitar y otras acciones sobre el renglón; no tienen tooltip). Debajo: Stock actual, PED Cliente, Disponible del artículo seleccionado.
- **Pestaña Carga Renglón**: Código (tres campos: sistema / manual / barras), Descripción, Precio x U, Lista (con botón de cambio de lista), Cantidad, Sub-Total, % Desc, Importe Desc, Importe Final, Detalle.
- **Pie de Comprobante**: Subtotal 21 %, Subtotal 10,5 %, Subtotal Gral, Desc %, Imp. Int., Interés %, Imp Desc, Percep (con botón), Exento, Subtotal Desc / Int (por alícuota), IVA Alic 21 %, IVA Alic 10,5 %, Total General.
- Botones: **Generar** y **Cancelar** (pide confirmación "¿Desea cancelar la generación de la factura?").

### Comportamiento observado
- Al elegir "Consumidor Final" aparecieron **dos errores internos "Type mismatch"** ("El sistema guardará un registro en la base de datos"), después de los cuales se abrió igual el formulario. Se origina en el entorno vacío (probablemente un parámetro o talonario sin valor); el sistema escribe una fila en el log de errores (`Herramientas > Log de errores`). No bloquea la pantalla, pero hay que reproducirlo con base cargada antes de dar por buena la regla.
- No cargué renglones ni generé el comprobante, así que el cálculo de totales, IVA, interés y redondeo está **sin verificar**: solo se relevaron los campos.

### Tablas (cruce)
| Concepto | Tabla / columnas |
|---|---|
| **Encabezado de cada comprobante de venta** | `cuentacliente`: una fila por comprobante **y también por recibo** (mismo libro de cuenta corriente). Claves: `CodigoMovimiento` (decimal 15,0, generado por la tabla `codmov`), `TipoComprobante` (FA, FB, FC…), `NroComprobante`, `NroCompBusq`, `Codigo` (cliente), `id_pv`, `CodSucursal`, `IdUsuario`, `CodViajante` |
| Importes del encabezado | `SubTotal1/2/SubTotalGral`, `Alicuota1/2`, `IVA1/IVA2`, `Exento`, `ImpDesc1/2`, `PorDesc1/2`, `interes`, `impuesto_interno_total`, `total_percep`, `redondeo`, `ImporteVenta` (total), `ImporteCobro`, `saldo`, `Vencimiento`, `CondVenta`, `id_condventa`, `Estado`, `Anulado` |
| Cuerpo (renglones) | `cuerpostock`: `IDArt`, `Cantidad`, precios por unidad y por renglón (`PrecioCostoxU`, `PrecioVentaxU`, `PrecioBrutoxU`, `PrecioNetoxU`, `PrecioIVAxU`, y `…xR`), `ImpDesc`, `PorDesc`, `Alicuota`, `AlicuotaIB`, `lista_precio`, `CodDeposito`, `id_lote`, `NroPedido`/`NroRemito`/`NroPresupuesto` y `codmov_*` (enlaces a comprobantes de origen), `CodigoMovimiento` (une con `cuentacliente`) |
| Libro de stock | `stock` (una fila por renglón con entrada/salida y saldo) y `stock_deposito` (saldo por depósito) |
| Tipos de comprobante | `comprobante` (38 tipos): FA FB FC FE FM, NCA…NCM, NDA…NDM, REC, OP, PRE, PED, REM, RETIB, RETG, MCAJ, MSTOCK, AJ, OC, PEDI, EB, CHEQUE, PD, OE, PREP, POE, RETIVA, DEV, PSJ, VALE, CI-COMOD |
| Numeración | `talonarios` (por tipo, sucursal y PV: `NroInic`, `NroFinal`, `Nro` actual, `NroCAI`, `FechaCAI`, `Habilitado`) y `punto_venta` (nro, lista de precios del PV, `fe_regimen` CAE/CAEA, rutas de reporte y certificado) |
| Factura electrónica | en `cuentacliente`: `fe_cae`, `fe_vto_cae`, `fe_comp`, `fe_transmitido`, `fe_tipo` (Normal / Crédito / Exportación), `fe_cbu`, `fe_regimen_tipo`; datos CAEA en `fe_datos_caea`; parámetros URL AFIP en `configuracion` |
| Comprobante de venta de mostrador (TPV) | columnas `tpv_*` en `cuentacliente` (cliente ocasional, pago en efectivo/cheque/tarjeta/cta cte, cambio) |
| Entrega / remito | `remite_factura_art`, `estado_fact_remito`, `id_deposito_despacho`; datos logísticos en `cliente_datos_adicionales` |
| Percepciones | `percepcion*`, `percep_cli*` y `total_percep` / `monto_percep_iva` en `cuentacliente` |

**Nota de diseño:** `cuentacliente` mezcla en una sola tabla (≈115 columnas) ventas, notas de crédito/débito y recibos, con columnas que solo aplican a un tipo. En la réplica conviene separar *comprobante* (cabecera), *renglón* y *movimiento de cuenta corriente*, y un número de movimiento propio en lugar de `codmov` (contador de una fila; es un cuello de botella de concurrencia).

## 2. Cobranzas (`Gestión > Cobranzas > Gestión Cobranza`, F5)

### Flujo
Mismo selector de clientes que Facturación, con **Tipo Comprobante** `Sistema` / `Talonario`. Menús: Archivo, **Comprobantes**, Acciones (Ver Cuenta Corriente F9, Agregar Cliente F10, Agregar Cliente Rápido F11, Editar Cliente Rápido), Informes (F12).

`Comprobantes > Recibo de Cobro`:
- **A Cuenta** (F2) — cobro sin imputar a facturas.
- **Por Imputación** (F3) — cobra contra facturas pendientes. Con saldo cero muestra el aviso **"No hay facturas para imputar en el recibo"** y no abre.
- **Otros Ingresos** (F4).
- **Imputación de comprobantes** (F5) y **Desimputación de comprobantes** (F6), para cruzar notas de crédito/recibos con facturas después.

### Formulario "Recibo a Cuenta"
- **Encabezado**: Fecha, Talonario (número de talonario; la lista mostró solo "1"), Cliente, **Cobrador** (default el vendedor del cliente, con botón), Detalle.
- **Pestaña Medios de Cobro I**:
  - *Efectivo*: Caja (default "Efectivo PV"), Efect $, **Cotiz. Dolar** (default 1100, viene de `cotizacion`), Efect U$S.
  - *Cheques*: Total + grilla (Banco, Librador, Nro Cheque, Importe, Fec Emis, Fec Cob, Fec Vto, Tipo) con alta/modificación/baja; selector **Caja cheque de terceros** (default "Cheque PV").
  - *Transferencias*: Total + grilla (Fecha, Banco/billetera virtual, Nro cuenta/alias, Nro referencia, Importe).
  - *Totales parciales*: Total $, Saldo $.
- **Pestaña Medios de Cobro II**: *Tarjetas de crédito/débito* (Tarjeta, Plan, Importe, Cuotas, Nro tarjeta, Nro cupón, Nro lote, Valor cuota, Total, grilla con Desc. banco) y *Otros medios de cobro* (Medio: "Documento / Pagaré", Importe, Fecha emisión, Fecha vto, Nro/Serie).
- **Pestaña Descuento / Retenciones**: lista de descuentos predefinidos (semilla "Descuento 1") con porcentaje e importe; grilla de **Retenciones** (Fecha, %, Importe, Nro Certificado, Tipo, Cod Agente Ret).
- **Totales Generales del Recibo**: Imputado, S. Parcial, Cobro, Retención, Desc, Total. Botones Generar / Cancelar (pide confirmación).

### Tablas (cruce)
| Concepto | Tabla / columnas |
|---|---|
| Encabezado del recibo | `cuentacliente` con `TipoComprobante='REC'`, `TipoRecibo`, `tiporec`; totales `TotalRecibo`, `TotalEfectivoP/D`, `TotalCheque`, `Total_Tarjeta`, `Total_MC` (otros medios), `total_trans`, `TotalDescRec`, `TotalRetencion`, `TotalImputacionRec`, `NetoImputacionRec`, `ReciboPesos/ReciboDolar`, `CotiDolar` |
| Imputación recibo ↔ factura | `imputacion`: pares (factura/ND) ↔ (NC/recibo), con importe, cancelado y saldo en cada lado, `tipo`, `id_imputacion_cobranza`, `anulado`, `id_cliente`. Logs de desimputación en `imputacion_log_desimp*` |
| Facturas pendientes de cobro en el recibo | `recibo_factura` (Importe, Cancelado, Saldo, Neto, `Estado`, `Seleccionado`, `desimputado`, `id_asig_cobranza`), llenada al abrir la pantalla; `asig_cobranza` agrupa el proceso (con o sin proceso) |
| Cheques de terceros | `chequetercero` (NroCheque, CodBanco, CodCliente, Librador, CUIT, FechaEmision/Cobro/Vto, Importe, NroCompREC, estados Entregado/Rechazado/Encartera/Depositado, `id_boletadeposito`, reemplazado) más `chequeterc_rec` |
| Otros medios de cobro | `medio_cobpag` (movimiento) + `medio_cobpag_abm` (definición: tipo, caja de ingreso, caja acumuladora, cuenta contable) + `medio_cobpag_tipo` (Bonos, Documentos…) |
| Tarjetas | `tarjetas_credito` (VISA, MC, AMEX, Naranja, Visa Débito, Maestro, Mercado Pago…; cuenta contable, banco, billetera electrónica) y las liquidaciones `tc_*` |
| Transferencias | columnas `total_trans`, `ctabanc_trans`, `nroref_trans`, `fecha_trans` en `cuentacliente` y `cuenta_banco` |
| Descuentos | `descuento_rec` (Código, Nombre, Importe, Porcentaje, Descripción) |
| Retenciones | `retenciones` (CodRetencion, NroCertificado, NroREC, CodCliente, Porcentaje, Importe, CodAgentRet, `tipo_retencion` Recibo/Tarjeta) y `tipo_retencion_cli`, `cod_afip_retencion` |
| Caja | `caja` (libro: ingreso, egreso, saldo, `codigo_movimiento`, `id_cierre_caja`, `id_chequetercero`) y `caja_abm` (definición de cajas) |

**Cajas por defecto (`caja_abm`)**: 12 cajas de seis tipos — Efectivo (acumulativa "Efectivo Rendición" y de punto de venta "Efectivo PV"), Cheque ("Cheque PV" y "Cheque Rendición"), Tarjeta ("Tarjeta PV" y "Tarjeta Rendición") y Otro Medio de Cobro (varias). Cada una referencia una cuenta contable (`id_pc`), por eso un cobro genera también un asiento. Esas cuentas son las que aparecen en los desplegables por defecto.

## 3. Reglas de negocio detectadas
Observadas en pantalla: 1 (Consumidor Final abre Factura B), 4 (aviso "No hay facturas para imputar") y 5. El resto se **infiere de la estructura de la base** y falta probarlo.
1. El **tipo de comprobante lo determina** la condición de IVA del cliente (`cliente.IDIva` → `contribuyentes`) y la del emisor (inferido; observado solo con Consumidor Final → B).
2. **Numeración** (inferido de la tabla): por tipo + PV + sucursal en `talonarios`; con rango (`NroInic`..`NroFinal` = 1..5000 en la semilla) y vencimiento de CAI (`FechaCAI`). Qué hace exactamente el modo "Talonario" no se probó.
3. **Vencimiento** (inferido): fecha + días de la condición de venta (`cond_venta.Dias`); en pantalla el vencimiento por defecto coincide con la fecha porque la condición es Contado (0 días).
4. **Cuenta corriente**: cada comprobante y recibo suma una fila con `saldo`; `cliente.saldo` guarda el último saldo. `Por Imputación` exige facturas con saldo > 0.
5. **Imputación** parcial o total, reversible con "Desimputación"; recibos y notas de crédito sin imputar se listan en `cobranza_nc_rec_sin_imputar`.
6. **Permiso Supervisor** protege descuentos y cambios de precio (`comp_supervisor` en `cuentacliente`; `punto_venta.bloquea_descuento_pie`).
7. Los **medios de cobro** distribuyen el dinero entre cajas distintas (efectivo, cheques, tarjeta, otros) y a cada una le corresponde una cuenta contable.

## 4. Informes de esta área
- `Informes\ventas_*.rpt`: **155** reportes (artículo, cliente, vendedor, zona, usuario, saldo pendiente, pedidos no remitidos, comprobantes, lotes…).
- `Informes\cobranza_*.rpt`: **46** reportes (cuenta corriente por cliente / vendedor / tipo de cliente / fecha, facturas a cobrar por cliente / vendedor / zona, cheques por período y por vendedor, límite de crédito y de días, promedio de pago, cobranza por provincia/departamento/distrito, saldo de cliente, NC y recibos sin imputar, detalle de imputación).
- Los comprobantes impresos (factura, recibo) usan además la ruta `punto_venta.ruta_reporte_comprobante`.

## 5. Pendiente
- Reproducir el error "Type mismatch" con la base de ejemplo cargada y ver el log (`Herramientas > Log de errores`) para saber el parámetro que falta.
- Registrar una factura y un recibo de prueba en una copia de la base para ver los asientos reales (`cuentacliente`, `stock`, `caja`, `imputacion`) y el cálculo exacto de IVA, interés y redondeo.
- Pantallas aún sin recorrer del módulo: Presupuesto (F4), Pedido (F3), Punto de Venta (Shift+P), Nota de Crédito / Débito, Cuenta Corriente, Consultas y Anulaciones, Procesos fiscales, Administración de comprobantes electrónicos.
