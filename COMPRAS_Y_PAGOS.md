# Compras: Orden de Compra, Factura de Compra y Pagos (2026-10-27)

Fuente: recorrido del cliente administraNET Gestión 4 (base limpia restaurada, usuario Supervisor, sucursal Casa Matriz) + `estructura_default_adm.sql`. **No se emitió ningún comprobante**: cada pantalla se abrió y se canceló. Con la base de ejemplo solo hay un proveedor operativo (ver 1), así que el comportamiento con datos reales quedó sin ver.

## 0. Menú Compras / Pagos

- **Gestión > Compras**: Presupuesto de Compra, **Orden de Compra (F7)**, **Facturas de Compra (F6)**, Nota de Crédito / Nota de Débito, Cuenta Corriente, Consultas y Anulaciones, Informes.
- **Gestión > Pagos**: **Gestión Pago (F8)** (abre la pantalla "Orden de Pago"), Consultas y Anulaciones, Informes.

Las tres pantallas empiezan con un **selector de proveedores** (en lugar del de clientes): lista de Sucursal (Casa Matriz), grilla *Proveedores* (Nombre, Código, CUIT, IVA, Tipo, Teléfono, Email, WhatsApp, **Saldo**) y búsqueda rápida por código, nombre o CUIT. Acciones: Ver Cuenta Corriente (F9), Agregar Proveedor (F10), **Lista de soporte para compras general (F11)**. Informes: Visualizar (F12).

## 1. Datos de ejemplo de proveedores

La grilla muestra **Proveedor 1** (código 3, CUIT 00-00000000-0, Responsable Inscripto, tipo Mercaderías) con **saldo $ 800,00**; el contador dice "1 de 3". En `proveedor` hay 3 filas: 1 "-Ninguno-" (comisionista, "en blanco para el libro de IVA"), 2 (vacío) y 3 "Proveedor 1" (`saldo` 800, `id_cc` 5). El saldo corresponde a una fila de `cuentaproveedor`: ajuste del 08/05/2019, comprobante 0001-00000001, importe 800 y saldo 800 (ver 4).

## 2. Orden de Compra (`Gestión > Compras > Orden de Compra`, F7)

Menú **Comprobantes**: *Orden de Compra* (F2) y *Orden de Compra / Pedido Interno* (F4).

**Formulario "Orden de Compra"**

| Campo | Observado |
|---|---|
| Fecha Comprobante / Fecha de entrega | hoy |
| **Vencimiento** | hoy al abrir; al elegir la condición **Cta/Cte 15** pasó a **11/11/2026** (hoy + 15): el vencimiento sí sigue a la condición de compra |
| Plantilla | lista vacía en la base limpia |
| Proveedor | el seleccionado |
| **Cond Compra** | default **Cta/Cte 15**; lista: Cta/Cte 15, 30, 60, 90, 120, 150, 180 y **Múltiple** |
| Detalle, Adjunto (botón) | texto libre y archivo adjunto |
| Presupuesto (botón), Lista soporte (botón) | traen un presupuesto de compra o la lista de soporte de compras |
| Cotiz. Dólar | 1100 |

**Grilla Renglón**: Cód. Sistema 2, Descripción, Precio x U, Cantidad, % Alic, % Des, Precio Neto, **Nro Presupuesto**, **Nro OC**, Tipo… con 5 botones laterales; bajo la grilla: Stock actual, PED Cliente, Disponible.
**Pestaña Carga Renglón**: Código ×3, Descripción, Precio x U, Cantidad, Sub-Total, **% Desc** (con botón), **% Bonif**, Importe Desc, **Imp. Bonif**, Importe Final y Detalle. Hay dos descuentos por renglón (descuento y bonificación), a diferencia de ventas.
**Pie**: Subtotal 21 %, 10,5 % y **27 %** (tres alícuotas), IVA de cada una, **IVA Adic**, Subtotal, % Desc, Imp Desc, Subtotal Neto, **Per Gan, Per IVA, Per IB** (con botón), **Exento**, **Otros Imp.**, Imp Interno y Total General. Botones Generar / Cancelar (*"¿Desea cancelar la generación de la orden de compra?"*).

## 3. Factura de Compra (`Gestión > Compras > Facturas de Compra`, F6)

Menú **Comprobantes**: *Factura de Compra*, *Factura de Compra / Remito* y *Factura de Compra / Orden de Compra* (F3).

**Formulario "Factura A – Proveedores"** (la letra sale de la condición de IVA del proveedor)

| Campo | Observado |
|---|---|
| Fecha comprobante / **Fecha registro** / **Fecha recepción** | hoy (tres fechas distintas: la del documento, la contable y la de recepción) |
| **Nro. Comprobante** | dos campos (punto de venta y número del **proveedor**, a cargar a mano) |
| **Vencimiento** | **01/11/2026** al abrir (hoy + 5), **aunque la condición mostrada es Cta/Cte 15**: no coincide con los 15 días; el vencimiento inicial no sale de esa condición (a verificar al elegir otra) |
| Proveedor, Cond Compra (Cta/Cte 15), Detalle, Cotiz. Dólar (1100) | |

Grilla con **Nro OC** y **Nro Remito** (trazabilidad hacia la orden y el remito), 6 botones laterales y el mismo pie que la OC (tres alícuotas, percepciones Gan/IVA/IB, exento, otros impuestos). Carga Renglón idéntica a la OC con **% Desc Reng** y **% Bonif**.
- **Con Orden de Compra**: añade el botón **Ord. Compra**, que lista órdenes pendientes del proveedor. Sin ninguna avisa **"No existen Órdenes de compra pendientes"**.
- **Con Remito**: toma remitos de compra pendientes (menú Stock > Remito de Compra); no se abrió.

## 4. Pagos — Orden de Pago (`Gestión > Pagos > Gestión Pago`, F8)

Menú **Comprobantes > Orden de Pago**: **A Cuenta**, **Por Imputación**, **Imputación de comprobantes a cuenta**, **Desimputación de comprobantes** y **Otros Egresos (F4)**.

**"Orden de Pago a Cuenta"**: encabezado (Fecha, Detalle, Proveedor) y tres pestañas.
- **Medios de Pago I**
  - *Efectivo*: Caja (**Efectivo PV**), Efect $, Cotiz. Dólar (1100), Efect U$S.
  - *Cheques de terceros* (los que se entregan al proveedor): Caja (**Cheque Rendición**), **Promedio días** y grilla Nro Cheque, Banco, Librador, Importe, Fec Emis, Fec Cob, Tipo.
  - *Cheques propios*: grilla Nro Cheque, Banco, Nro Cuenta, **Chequera**, Importe, Fec Emis, Fec Pago, Tipo.
  - *Transferencias*: Fecha, Banco / billetera virtual, Nro cuenta / alias, Nro referencia, Importe.
  - *Totales parciales*: Total $, Saldo $.
- **Medios de Pago II**: *Medios de Cobro ingresados de terceros* (Medio de cobro, Importe, F. emisión, F. vto, Nro / Serie), *Otros Ingresos disponibles* y *Otros Medios de Pago* (default "Documento / Pagaré Propio", importe, fechas de emisión y vencimiento, Nro / Serie).
- **Descuentos / Retenciones**: lista de **Descuento** (porcentaje o importe) y tres bloques de retenciones del proveedor: **Ingresos Brutos**, **Ganancias** y **IVA**, cada uno con *Categoría* (default "Exento"), porcentaje e importe.
- **Totales Generales**: Imputado, S. Parcial, Pago, Retención, Desc, Total. Botones Generar / Cancelar (*"¿Desea cancelar la generación de la orden de pago?"*).

**"Orden de Pago por Imputación"**: suma una pestaña inicial **Comprobantes** con la grilla *Comprobantes a Imputar*: Fecha, Comp, Número, Importe, **Imputado Total**, **Imputado OP**, Saldo, Estado, Vencimiento, Fecha recepción. Con el proveedor de ejemplo aparece **08/05/2019, comp AJD, 0001-00000001, importe 800,00, saldo 800,00, N/Canc, recepción 01/11/2024**. Debajo: *Imputación* (importe a imputar, botones de aplicar/quitar/marcar), **Total deuda** (800) y **Total a cuenta**.

## 5. Cruce con la base

| Concepto | Tabla / columnas |
|---|---|
| Proveedor | **`proveedor`** (`Tipo`, `Nombre`, `CUIT`, `IDIva`, domicilio, contacto, `saldo`, `estado`, **`id_cc`** condición de compra, `id_pc` cuenta contable (28), **`CodCatRet`** (retención IIBB), **`CodCatRetG`** (ganancias), **`cod_ret_iva`**, `cert_IIBB` + vigencia, `NroCAI`/`FechaCAI`, `AfavorOP`, `AfavorNC`, `credito`, `descuento`, **`obliga_oc_carga_comp`** (obliga a vincular OC al cargar factura o remito), `fecha_ultima_compra`) y `proveedor_contacto` |
| Condición de compra | `proveedor.id_cc = 5` coincide con "Cta/Cte 15" (el default mostrado); no hay tabla `cond_compra`, así que **se reutiliza la tabla `cond_venta`** (id 5 = Cta/Cte 15) — inferido; falta confirmar |
| **Factura de compra, NC/ND de compra y orden de pago** | **`cuentaproveedor`** (la contraparte de `cuentacliente`): `TipoComprobante`, `NroComprobante`, `Codigo` (proveedor), `CodigoMovimiento`, `Fecha`, `FechaRegistro`, `Vencimiento`, `CondCompra`/`id_condcompra`, `ImporteCompra`, `ImportePago`, `saldo`, `Subtotal1/2/3`, `IDAlicuota`, `PercepIB`, `PercepGan`, `PercepIVA`, `OtrosImp`, `TotalDesc`, `Estado` (Cancelada / No Cancelada), `estado_remito` (Pendiente / Facturado), `NroFactRem`, `NroFactura`/`NroFacturaMov`, `TipoFactura`, `TipoNC`, `TipoOP`, y para pagos `OP`/`OPMov`, `TotalEfectivoP/D`, `TotalChequeT` (de terceros), `TotalChequeP` (propios), `Total_MCT`, `Total_medpag`, `TotalRetencion`, `TotalDescOP`, `TotalOP`, `total_trans`, `NroCAI` |
| Orden de compra | por el esquema, `comp_ped` (comprobante `OC` id 26; `PEDI` id 27 es el pedido interno) con `cuerpostockp`/`stockp` para los renglones; **no confirmado** |
| Renglones de la factura | `cuerpostock` (con `CodDeposito`, `NroRemito`, `codmov_*`) y `stock` (libro de stock: entrada por compra, `PrecioCostoxU`…); stock del artículo en `stock_deposito` |
| Seed de ejemplo | `cuentaproveedor` fila 1: `TipoComprobante='AJ'`, `NroComprobante='0001-00000001'`, `Codigo=3`, `ImporteCompra=800`, `saldo=800`, fecha 08/05/2019; la pantalla lo muestra como **AJD** |
| Facturas pendientes en la OP | `op_factura` (Importe, ImporteNC, Cancelado, Saldo, Neto, Estado, OP, OPMov, `id_asig_pago`) — equivalente de `recibo_factura` en cobranzas |
| Imputación | `imputacion_p` (y `imputacion_temp_p`) — contraparte de `imputacion`; desimputación en `imputacion_log_desimp_p` |
| **Cheques propios** | **`chequepropio`** (`NroCheque`, `CodBanco`, `NroChequera`, `CodCuenta`, `CodChequera`, `CodProveedor`, `Importe`, `FechaEmision`, `FechaCobro`, `FechaVto`, `NroOP`, `pagado`, `rechazado`, `en_nd_proveedor`, `tipo_cheque` Normal / Electrónico) y **`chequera`** (`NroInicial`, `NroFinal`, `NroActual`, `TipoChequera`, `CodCuenta`) |
| **Cheques de terceros entregados** | `chequetercero` (`CodProveedor`, `NroCompOP`, `CodigoMovimientoOP`, `Entregado`) |
| Otros medios de pago | `medio_cobpag` (`codigo_movimiento_op`) y `medio_cobpag_abm` / `_tipo` (ver [VENTAS_FACTURACION_COBRANZAS.md](VENTAS_FACTURACION_COBRANZAS.md)) |
| **Retenciones que sufre el proveedor** | `retenciones_prov` (IIBB: `CodRetencion`, `NroCertificado`, `NroOP`, `CodProveedor`, `Porcentaje`, `Importe`), `retenciones_provg` (Ganancias), `retenciones_prov_iva` (IVA); categorías en `categoriaret_prov` y tablas `tipo_retencion_pro*`; certificados con `nro_certificado_busq` |
| Descuentos de la OP | `descuento_op_nc` (CodDescuento, NroOP, Importe, Porcentaje, CodProveedor, NroNC) |
| Otros egresos | `otro_egreso` (tipo Gasto / Impuesto, `id_gasto`, `id_impuesto`, `codigo_movimiento_op`) y `gastos` |
| Caja | `caja` / `caja_saldo` (egresos de las cajas "Efectivo PV" y "Cheque Rendición") |
| Comprobantes y numeración | `comprobante` (OC 26, OP 17, EB 28, CHEQUE 29, RETIB 21, RETG 22, RETIVA 34) y `talonarios` |

## 6. Reglas de negocio

**Observadas en pantalla**
- El vencimiento de la **orden de compra** sigue la condición de compra (Cta/Cte 15 → hoy + 15). El de la **factura de compra** salió a hoy + 5 aunque la condición decía Cta/Cte 15 (diferencia a investigar).
- La factura de compra registra **tres fechas** (comprobante, registro, recepción) y pide el **número del comprobante del proveedor**, y arrastra **Nro OC y Nro Remito** por renglón.
- Con "Factura de Compra / Orden de Compra" hay que traer una orden pendiente; sin órdenes avisa y no continúa.
- La orden de pago se hace **a cuenta** (sin imputar) o **por imputación** sobre comprobantes con saldo; la imputación muestra deuda total, importe a imputar y total a cuenta.
- El pago admite efectivo, cheques de terceros, cheques propios (con chequera), transferencias, otros medios y **retenciones de IIBB, Ganancias e IVA** con categoría por proveedor.

**Inferidas de la base (sin probar)**
- El proveedor puede **obligar a vincular una OC** al cargar la factura o el remito (`obliga_oc_carga_comp`).
- La factura de compra suma stock al depósito y actualiza el costo del artículo (`precios_historial` con tipo "Factura de Compra", visto en el esquema) y las percepciones sufridas.
- Las retenciones se calculan según la categoría del proveedor (`CodCatRet`, `CodCatRetG`, `cod_ret_iva`) y generan certificados numerados.
- Un cheque propio emitido toma el número de la chequera (`NroActual`) y queda en `chequepropio`.

## 7. Pendiente
- Probar con datos, sobre una copia de la base: cargar un proveedor y un artículo, emitir una OC, luego la factura con esa OC (y con remito), y una orden de pago con efectivo, cheque propio y retenciones; ver las tablas escritas y los asientos de stock, costo y caja.
- Aclarar por qué el vencimiento de la factura de compra no sigue la condición mostrada.
- Abrir **Presupuesto de Compra**, **Nota de Crédito / Débito** de compras, **Cuenta Corriente** de proveedores, **Consultas y Anulaciones**, *Imputación / Desimputación*, *Otros Egresos*, *Lista de soporte para compras* y la **Orden de Compra / Pedido Interno**.
- Remito de Compra e Ingreso de movimientos (menú Stock), y los módulos Caja, Bancos e Impuestos.
