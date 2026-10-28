# Ventas > Nota de Crédito / Nota de Débito y Cuenta Corriente (2026-10-27)

Fuente: recorrido del cliente administraNET Gestión 4 (base limpia restaurada, usuario Supervisor, sucursal Casa Matriz) + `estructura_default_adm.sql`. **No se emitió ningún comprobante**: todas las pantallas se abrieron y se cancelaron. Sin comprobantes cargados, las listas de facturas y la cuenta corriente aparecen vacías, así que el comportamiento con datos quedó sin ver. Complementa [VENTAS_FACTURACION_COBRANZAS.md](VENTAS_FACTURACION_COBRANZAS.md) y [VENTAS_PUNTO_DE_VENTA.md](VENTAS_PUNTO_DE_VENTA.md).

## 1. Nota de Crédito / Nota de Débito (`Gestión > Ventas > Nota de Crédito / Nota de Débito`)

Misma estructura que Facturación: selector de clientes (con "Tipo Comprobante" Sistema / Talonario), menús Archivo, **Comprobantes**, Acciones (Ver Cuenta Corriente F9, Agregar Cliente F10, Agregar Cliente Rápido F11, Editar Cliente Rápido) e Informes (Visualizar F12). La letra del comprobante sale de la condición de IVA del cliente: con *Cliente 1* (Responsable Inscripto) abre **Nota de Crédito A** / **Nota de Débito A**.

### Tipos de Nota de Crédito (`Comprobantes > Nota de Credito`)

| Opción | Atajo | Observado |
|---|---|---|
| Devolución | F2 | Abre **"Nota de Credito A – Clientes (Devolución)"**: encabezado con Fecha, Detalle, PV, Cliente, Vendedor, **Tipo Dev** (Efectivo / Crédito), **Depósito** (modo + depósito), tipo de movimiento (**DEV** / **MSTOCK**), **Factura** (número + botón de selección) y **Opcional** (Ajuste / Rechazo). Grilla Renglón (Cód. Sistema 2, Descripción, Precio x U, Marca, Cantidad, % Alic, % Des, Precio Neto, Nro Pedido, Nro Remito…) con solo 3 botones laterales (editar, quitar, otro; no hay "agregar": los renglones salen de la factura elegida). Pie: subtotales 21 % y 10,5 %, descuento, interés, percepción, exento, IVA por alícuota y Total General |
| Descuento en factura | F3 | no abierta |
| Descuento en recibo | F4 | no abierta |
| **A cuenta** | F5 | Abre **"Nota de Credito A – Clientes (A cuenta)"**: Fecha, Detalle, PV, Cliente, Vendedor, Tipo Dev (Efectivo / Crédito), Factura (opcional) y **Opcional** (Ajuste / Rechazo). Sin renglones: los **importes se cargan a mano** en el pie (Sub Total 1 al 21 %, IVA 21 %, Sub Total 2 al 10,5 %, IVA 10,5 %, Percepción, Exento, Per IVA, Total General) |
| Anulación factura | F6 | se abrió una pantalla de aspecto idéntico a Devolución (mismo título); no se pudo distinguir si es la misma o la de anulación |
| Anulación ND | F7 | no abierta |
| **Concepto** | F8 | Abre **"Nota de Credito A – Clientes (Concepto)"**: Fecha, Detalle, PV, Cliente, Vendedor, Tipo Dev, Factura (opcional), **Gasto / Egreso** (lista de conceptos; en la base limpia solo "Combustibles"), Importe + botones agregar renglón [F2] y quitar; grilla Nombre / Importe, Total y pie con IVA por alícuota |
| **Devolución sin comprobante** | F9 | Variante de la devolución sin elegir factura: **"Nota de Credito A – Clientes (Devolución)"** con renglones cargables a mano (botón agregar), **Depósito: Seleccionado** y tipo DEV / MSTOCK |

**Listas observadas**
- *Tipo Dev*: **Efectivo**, **Crédito** (devolución en dinero o saldo a favor del cliente).
- *Depósito (modo)*: **Defecto usuario**, **Comp. original**, **Seleccionado**, **Por artículo** (a qué depósito vuelve la mercadería devuelta).
- *Tipo de movimiento*: **DEV**, **MSTOCK**.
- *Opcional*: **Ajuste**, **Rechazo**.

### Nota de Débito (`Comprobantes > Nota de Debito`, F5)
Abre **"Nota de Debito A"**: Fecha, Detalle, Cliente, Factura (opcional, con botón), **Motivo**, PV, **Opcional** (Ajuste / Rechazo), Vendedor y el mismo pie de importes cargados a mano.
- *Motivo*: **Intereses** (default), **Pago fuera de término**, **Diferencia de cambio**, **Cheque rechazado**, **Anulación NC**, **Ingreso**.

Al cancelar cualquiera pregunta "¿Desea cancelar la generación de la nota de crédito/débito?".

## 2. Cuenta Corriente (`Gestión > Ventas > Cuenta Corriente`)

Ventana **"Cuenta Corriente Cliente"**. Primero el selector de clientes (grilla con Saldo y búsqueda por código, nombre o CUIT); `Acciones > Ver Cuenta Corriente (F9)` abre la cuenta del cliente elegido.
- **Cabecera**: Cliente y Código.
- **Grilla "Cuenta Corriente"**: Fecha, Comp, Nro Comp, Cond Venta, **Débitos**, **Créditos**, **Saldo**, Vencimiento, **Venc** (vencido), Estado, Anul, **Recibo**, **Factura de NC/ND**, Detalle.
- **Búsqueda**: Intervalo de fechas (default 01/01/2026 – hoy) y Datos (*"Búsqueda por Nro. Comp / Tipo Comprobante"*). Al pie, **Saldo $**.
- **Comandos**: **Visualizar** (F2), **Ver detalle de imputación** (F3), **Reimprimir comprobante** (F4).
- **Archivo**: Copiar celda, **Ajuste de cuenta / inicial** (Agregar / Modificar), Salir.
- **Formulario "Ajuste de cuenta corriente / saldo inicial"**: Fecha, Cliente, Código, **Tipo** (**Inicial** / **Ajuste**), Detalle, **Débito/Crédito** (default Débito) y **Saldo $**. Sirve para cargar el saldo inicial de un cliente al migrar y para correcciones manuales.
- Con *Cliente 1* sin movimientos: "No existen registros con las opciones seleccionadas", Saldo 0,00.

## 3. Cruce con la base

Las notas y los ajustes son filas de **`cuentacliente`**, la misma tabla que facturas y recibos. Columnas relevantes:

| Concepto | Columna |
|---|---|
| Tipo de comprobante | `TipoComprobante`: `NCA`, `NCB`, `NCC`, `NCE`, `NCM`, `NDA`…`NDM` (ids 6–15 en `comprobante`), `DEV` (id 35) |
| Subtipo de nota de crédito | **`TipoNC`** (NOT NULL, default vacío) |
| Efectivo o Crédito | **`tipo_devol_nc`** (`Efectivo` / `Crédito`) |
| Factura a la que se aplica | **`NroFactura`** (número) y **`NroFacturaMov`** (código de movimiento de esa factura) |
| Motivo de la ND | **`motivo_nd`**, **`concepto_nd`** (concepto sin detalle) y **`id_chequerechazado`** (ND por cheque rechazado) |
| Origen del recibo / NC | `TipoRecibo`, `tiporec`, `Recibo`, `ReciboMov` |
| Importes | los mismos del resto de comprobantes: `SubTotal1/2`, `IVA1/IVA2`, `Exento`, `total_percep`, `ImporteVenta`, `ImporteCobro`, `saldo` |
| Estado | `Estado`, `Anulado`, `Vencimiento`, `Vencido`, `Liquidado` |

**Tablas propias**
- **`nc_concepto`** (`nombre`, `importe`, `id_gasto`, `CodIva_gasto`, `IvaxR`, `alicuota_iva`, `CodigoMovimiento`, `anulado`): renglones de la NC por concepto; el concepto sale de **`gastos`** (`Nombre`, `TipoIVA`, `CodIVA`, `moneda`, `id_pc`, `id_gastos_grupo`) y **`gastos_grupo`**. Semilla: gasto 1 "Combustibles" (gravado, cuenta contable 98) en el grupo 1 "Grupo 1".
- **`nc_dev`** (`codigo_movimiento_nc`, `codigo_movimiento_dev`, `anulado`): vincula cada NC con su comprobante de devolución de stock (**DEV**), con lo que la devolución mueve mercadería por un comprobante aparte.
- **`descuento_rec_nc`** (CodDescuento, NroREC, NroNC, Importe, Porcentaje, Computado): descuentos del recibo que se convierten en nota de crédito ("Descuento en recibo").
- **`imputacion`** (pares factura/ND ↔ NC/recibo con importe, cancelado y saldo) y **`imputacion_log_desimp`** (`id_imputacion`, `id_cliente`, `nro_fact_nd`, `nro_rec_nc`, `id_usuario`, `fecha_control`): imputación y desimputación.
- **`recibo_factura`**: facturas pendientes que se arrastran al cobrar.
- **`otro_egreso`** (tipo Gasto / Impuesto, `codigo_movimiento_op` "OrdenPago / NCconcepto"): también la usa la NC por concepto.
- **Ajuste y saldo inicial**: son filas de `cuentacliente` (comprobante propio); `cliente.saldo` guarda el último saldo.

**Reportes** (en `Informes\`): `general_nc_global`, `general_nc_nd_importe`, `general_nd_nc_fact_importe`, `general_nc_rec_acuenta`, `cobranza_nc_rec_sin_imputar`, `cobranza_ctacte` (por cliente, por Nro de comprobante, por fecha, por tipo de cliente, por vendedor).

## 4. Reglas de negocio

**Observadas en pantalla**
- La letra de la nota (A, B…) depende de la condición de IVA del cliente.
- Toda nota puede aplicarse a una factura (campo Factura) o ser independiente; en la NC "A cuenta" y en la ND los importes se escriben a mano, mientras que en la devolución los renglones vienen de la factura (o se cargan a mano en "sin comprobante").
- La devolución indica **a qué depósito** vuelve la mercadería (4 modos) y **cómo se devuelve el valor** (Efectivo o Crédito).
- Las notas de débito se clasifican por motivo (intereses, pago fuera de término, diferencia de cambio, cheque rechazado, anulación NC, ingreso).
- Todo comprobante pide confirmación antes de cancelar; el ajuste de cuenta no la pidió al cancelar.

**Inferidas de la base (sin probar)**
- Una NC "Crédito" deja saldo a favor del cliente (aparece en `cobranza_nc_rec_sin_imputar` hasta imputarse); una "Efectivo" egresa dinero de caja.
- La NC por devolución genera un comprobante de stock `DEV` enlazado en `nc_dev` y reingresa stock al depósito elegido.
- "Cheque rechazado" en una ND se enlaza con el cheque por `id_chequerechazado` y revierte el cobro.
- El orden de imputación y los saldos se mantienen en `imputacion` y `cuentacliente.saldo`.

## 5. Pendiente
- Emitir, sobre una copia de la base, una factura y luego: NC por devolución (Efectivo y Crédito), NC por concepto, NC a cuenta, ND por intereses; ver qué filas se escriben (`cuentacliente`, `nc_dev`, `nc_concepto`, `stock`, `caja`, `imputacion`) y cómo cambia la cuenta corriente.
- Abrir y documentar *Descuento en factura*, *Descuento en recibo*, *Anulación factura* y *Anulación ND*, que no se pudieron distinguir sin comprobantes.
- Ver "Ver detalle de imputación" y "Reimprimir comprobante" con datos.
- Pantallas aún sin recorrer de Ventas: Procesos fiscales y Administración de comprobantes electrónicos; módulos Compras, Pagos, Stock, Caja, Bancos e Impuestos.
