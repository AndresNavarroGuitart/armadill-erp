# Módulos Caja y Bancos (2026-10-27)

Fuente: recorrido del cliente administraNET Gestión 4 (base limpia restaurada, usuario Supervisor, sucursal Casa Matriz) + `estructura_default_adm.sql`. **No se guardó nada**: cada pantalla se abrió y se canceló. Con la base limpia no hay movimientos, así que los libros aparecen vacíos y el comportamiento con datos (saldos, cierre, conciliación) quedó sin ver. Complementa [VENTAS_PUNTO_DE_VENTA.md](VENTAS_PUNTO_DE_VENTA.md) (una venta escribe `caja` y `caja_saldo`) y [COMPRAS_Y_PAGOS.md](COMPRAS_Y_PAGOS.md).

## 0. Menús

- **Gestión > Caja**: Efectivo (F12), Cheques, Tarjetas, Otros Medios de Cobro, Cierre de caja general, Informes. (10 reportes `caja_*`.)
- **Gestión > Bancos**: Gestión de Libro Banco, Gestión de Cheques de Terceros, Gestión de Cheques Propios, Informes. (16 reportes `banco_*`.)

## 1. Cajas: Efectivo, Cheques y Tarjetas

Las tres pantallas ("Caja de efectivo", "Caja de Cheques", "Caja de Tarjetas") son iguales:
- **Datos**: **Caja** (lista con descripción y sucursal), **Moneda** (solo en efectivo: Pesos / dólar), **Intervalo** de fechas (default hoy), **Fecha** por **Comprobante** o **Carga**, y **Datos** (búsqueda por nro. comp / cliente / proveedor).
- **Libro "Caja"**: Fecha, Comp, Nro Comp, Tipo, Cliente, Proveedor, **Ingreso $**, **Egreso $**, **Saldo**, Detalle, Usuario Origen, Usuario Destino, Caja Origen… (en cheques y tarjetas sin Tipo / Cliente / Proveedor).
- Cajas que ofrece cada una: *Efectivo PV* y *Efectivo Rendición*; *Cheque PV* y *Cheque Rendición*; *Tarjeta PV* (más la de rendición según `caja_abm`).
- **Comandos** (iguales en las tres): **Reimprimir** (F6), **Generar arqueo de caja efectivo** (F6), **Reimprimir arqueo de caja general** (F7), **Visualizar** (F8) y **Anular** (F9).

### Comprobantes de la caja de efectivo
- **Movimiento de Caja** (F2) — pantalla "Mov. Caja": Fecha, Moneda, **Motivo**, **Caja** y **a Caja**, Detalle, **Ingreso/Egreso** (lo fija el motivo) e Importe. Motivos: **Transferencia de Fondos** (default; Egreso, de una caja a otra), **Ajuste de Caja**, **Cierre de Caja – Usuario Supervisor**, **Cierre de Caja – Usuario de PV**, **Retiro de Caja** e **Ingreso de Caja**. Las cajas de origen disponibles en efectivo: *Efectivo Rendición* y *Efectivo PV*. Al cancelar no pide confirmación.
- **Documentos Fiscales** (F3) — abre **"Factura de Compra de Contado"**: selector de proveedores y la factura de compra, pagada en el acto desde la caja.
- **Documentos No Fiscales** (F4) — **"Documentos No Fiscales (Tickets – Otros Gastos)"**: Fecha, Nro. Doc, Sucursal, **Tipo** (**Ticket**, **Recibo no oficial**, **Otro Comprobante**), **Gasto**, Detalle e Importe. Es para gastos sin factura.

## 2. Cierre de caja general

Pantalla "Cierre de caja general" (misma "Mov. Caja"): Fecha (solo lectura), Moneda, **Motivo** "Cierre de Caja – Usuario de PV", **Caja** *Efectivo PV* → **a Caja** *Efectivo Rendición*, Detalle, **Ingreso/Egreso** (Egreso), **Importe** (lo que dice el sistema), **Importe físico** (lo contado) con botón de **arqueo por denominación** y **Diferencia**. El botón de arqueo no abrió nada con la caja en cero (no se pudo ver el desglose por billetes).

## 3. Bancos — Libro Banco

Ventana **"Libro Banco"**: panel **Bancos** (Banco Nación Argentina), panel **Cuentas** (Nro Cuenta 123456, Tipo Cuenta Corriente, Saldo 0, Moneda Pesos) y **Detalle** (Fecha, Tipo Comp, Comprobante, **Débito**, **Crédito**, **Saldo**, **Conc**, **Fec. Conc**, Detalle). Búsqueda: intervalo (01/01 a hoy), Datos y filtro (*Todos*, por nro comp / tipo comprobante / débito / crédito / conciliados o no). Al pie **Saldo total**.

**Comprobantes bancarios** (menú Comprobantes): **Depósito Bancario** (F2), **Extracción Bancaria** (F3), **Gasto Bancario / Impuesto / Retención / Percepción** (F4), **Cheque Rechazado** (F5), **Ajuste / Saldo Inicial** (F6), **Clearing Recibido / Cheque Pagador** (F7), **Liquidación de Tarjeta de Crédito / Débito** (F8), **Transferencia Bancaria** (F9) y **Deuda Bancaria** (F10). Comandos: **Visualizar** (F11), **Anular** (F12) y **Conciliación Bancaria**.

- **Depósito bancario**: Banco, N° Cuenta, **Nro Boleta**, Fecha, **Tipo Depósito** (**Efectivo** / **Cheque**), Detalle. *Efectivo*: Caja (**Efectivo PV**) y Efect $. *Cheques*: Caja (**Cheque Rendición**) y grilla *Cheques a depositar* (Nro Cheque, Banco, Librador, Importe, Fecha Emisión, Fecha Cobro, Fecha Vto, con alta y baja) y Cheque $. Mueve dinero desde la caja al banco.
- **Gastos Bancarios / Impuestos / Retenciones**: Banco, N° Cuenta, Fecha, **Tipo** (**Gasto Bancario**, **Impuesto**, **Retención**, **Percepción**), **Gasto** (lista: **Mantenimiento de cuenta**, **Comisión Bancaria**) e Importe $.
- **Conciliación Bancaria**: Banco y Nro Cuenta; grilla Fecha, Tipo Comp, Comprobante, Débito, Crédito, **Fec. Conciliación**; pie con **Saldo Conciliación**, **Saldo Libro Banco** y **Libro Banco Conciliado**.

## 4. Cheques de terceros (`Gestión de Cheques de Tercero`)

Cinco pestañas por estado: **En cartera**, **Depositados**, **Rechazados**, **Entregados**, **Cobrado efectivo**. Grilla: Cliente, Librador, CUIT/CUIL, Nro Cheque, Banco, Fecha Emisión, Fecha Cobro, Importe, Tipo; pie con Cantidad de cheques y Total en $. Búsqueda por fecha (emisión / cobro) y texto (cliente, librador, nro CUIT/CUIL, nro cheque, importe).
**Comandos**: **Modificación datos cheque**, **Cambio a estado (Rechazado)**, **Cambio a estado (Reemplazado)**, **Cobro cheque efectivo** y **Anular cobro cheque efectivo**.

## 5. Cheques propios (`Gestión de Cheques Propios`)

Grilla **Cheques Emitidos**: Nro Cheque, Cuenta, Proveedor, Banco, Fecha Emisión, Fecha Pago, Importe, **Pagado**, **Rechazado**, **ND prov**, **Anulado**; búsqueda por fecha de emisión, **Estado** (Todos, Emitidos, Pagados… la lista continúa) y texto (proveedor, número, importe). Comando: **Cambiar a Estado de No Pagado**.

## 6. Cruce con la base

| Concepto | Tabla / columnas |
|---|---|
| **Libro de caja** | **`caja`**: `fecha`, `tipo_comprobante`, `tipo` (Factura de Contado / Pago / Cobranza), `nro_comprobante`, `moneda`, `ingreso`, `egreso`, `saldo`, `codigo_movimiento`, `codigo_cliente`, `codigo_prov`, `tipo_cp` (Cliente o Proveedor), `cod_gasto` (documento no fiscal), `nro_doc`, `cod_sucursal`, `id_caja_abm_origen`/`_destino`, `id_usuario`, `id_usuario_destino`, `id_cierre_caja`, `id_chequetercero`, `anulado` |
| Definición de cajas | **`caja_abm`**: `tipo_caja` (Acumulativa, Punto de Venta, Cheque, Tarjeta, Acumulativa Cheque, Otro Medio de Cobro, Acumulativa Otro Medio de Cobro, Acumulativa Tarjeta), `nombre_caja`, `id_sucursal`, `id_pc` (cuenta contable), `id_pc_dolares`, `limite_efectivo`, `activa_limite_efectivo`. Semilla: 12 cajas (Efectivo Rendición, Efectivo PV, Cheque PV, Tarjeta PV, Cheque Rendición, Caja OMC…) |
| Saldo vigente de cada caja | `caja_saldo` (`id_caja`, `id_usuario`, `saldo`, `cod_sucursal`, `moneda`): un saldo por caja **y por usuario** |
| Cierres | **`caja_cierre`** (`id_caja_cierre`, `nro_caja_cierre`), `caja_control_cierre_suc` (copia del libro al cierre) y `caja.id_cierre_caja` |
| **Arqueo** | **`caja_arqueo`**: caja origen y destino, `cant_dinero_1…5000` y `monto_dinero_*` (conteo por denominación: 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000), `fecha_hora`, `id_usuario`, `id_vendedor`, `id_cierre_efectivo`, `id_cierre_tarjeta`, `id_cierre_cheque` |
| Banco | **`banco`** (`Nombre`, `CUIT`, `IDIva`, `cod_bcra`, `codigo_bc`, `Descubierto`, `cuentaabierta` (si la empresa tiene cuenta), `anulado`); la semilla trae decenas de bancos argentinos (Bica, Bradesco, CETELEM…) |
| Cuentas | **`cuenta_banco`** (`CodBanco`, `NroCuenta`, `TipoCuenta`, `saldo`, `moneda`, `id_pc`, `cbu`, `utiliza_afip_fact_credito`). Semilla: cuenta 1 en el banco 39 y cuenta 2 (123456, CBU de ejemplo) en el banco 16 = Banco Nación |
| **Libro Banco** | **`librobanco`**: `CodBanco`, `CodCuenta`, `CodCuentaDestino` (transferencia), `TipoComp`, `Comprobante`, `Fecha`, `FechaMov`, `Debito`, `Credito`, `Saldo`, `conciliado` (1 / 0), `fecha_conciliado`, y vínculos: `id_boletadeposito`, `id_clearing`, `id_gastobancario`, `id_tc_liquidacion`, `id_impuesto`, `id_retenciones`, `id_cheq_rechaz`, `id_deuda`, `id_alicuota`, `CodigoMovimiento_Anul`, `Anulado` |
| Depósitos | **`boletadeposito`** (`NroBoleta`, `CodBanco`, `CodCuenta`, `Tipo`, `Fecha`, `Importe`, `codigo_movimiento`, `detalle`) y `boletacheque` (cheques incluidos); `chequetercero.id_boletadeposito` marca los depositados |
| Gastos bancarios | **`gastosbancarios`**: semilla 1 "Mantenimiento de cuenta" (alícuota 1) y 2 "Comisión Bancaria" (alícuota 0), `computa_libro_compras`, `id_pc` (104) |
| Clearing | **`clearing`** (`nro_ref`, `CodBanco`, `CodCuenta`, `Fecha`, `Importe`, `nro_cheque`, `Cod_Prov`, `FechaE`, `FechaC`) |
| Deuda bancaria | **`deuda`** (`id_deuda_abm`, `nombre_deuda`, `tipo_deuda`, `importe_deuda`, `saldo`, `estado_deuda`, `fecha_emision/vencimiento`, `codigo_movimiento_lb`) y `deuda_abm` |
| Tarjetas | `tarjetas_credito`, `tc_plan`, **`tc_liquidacion`** (`id_tc`, `id_cuentabancaria`, `neto`, `importe`, `comisiones`, `iva_comisiones`, `total_retencion`, `total_descuento`, `id_caja`), `tc_comprobante`, `tc_temp` y `tc_cupones_temp` (borradores, no replicar) |
| **Cheques de terceros** | `chequetercero` (estados: `Encartera`, `Depositado`, `Rechazado`, `Entregado`, `reemplazado`, `en_nd_cliente`, `en_nd_proveedor`, `CodBancoDep`, `NroCuentaDep`, `tipo_comp`, `id_boletadeposito`) |
| **Cheques propios** | `chequepropio` (`pagado`, `rechazado`, `en_nd_proveedor`, `tipo_cheque` Normal / Electrónico, `CodChequera`) y `chequera` (`NroInicial`, `NroFinal`, `NroActual`) |
| Otros medios de cobro | `medio_cobpag` / `medio_cobpag_abm` / `medio_cobpag_tipo` |

## 7. Reglas de negocio

**Observadas en pantalla**
- Hay **dos niveles de caja**: cajas de **punto de venta** ("Efectivo PV", "Cheque PV", "Tarjeta PV") y cajas de **rendición** ("Efectivo Rendición", "Cheque Rendición"); el cierre de caja pasa el dinero de la primera a la segunda con **diferencia** entre lo del sistema y lo contado.
- Un movimiento de caja tiene un **motivo** que fija el sentido: transferencia (egreso hacia otra caja), ajuste, cierres (por supervisor o por usuario de PV), retiro e ingreso.
- Los gastos sin factura se cargan como **documentos no fiscales** (ticket, recibo no oficial, otro).
- El **depósito bancario** puede ser de efectivo (desde Efectivo PV) o de cheques (desde Cheque Rendición).
- El banco tiene **nueve** clases de comprobantes y todo se **concilia** contra el extracto.
- Los cheques de terceros pasan por cinco estados (cartera, depositado, rechazado, entregado, cobrado en efectivo); los propios se marcan pagado / rechazado.

**Inferidas de la base (sin probar)**
- Cada cobro o pago en efectivo, cheque o tarjeta inserta una fila en `caja` y actualiza `caja_saldo` por usuario; el cierre las agrupa con `id_cierre_caja` y las pasa a rendición.
- El depósito crea `boletadeposito` + una fila en `librobanco` (crédito) y saca el efectivo o los cheques de la caja; un cheque rechazado revierte el cobro y genera una ND ligada por `id_cheq_rechaz`.
- Los gastos bancarios pueden computarse en el libro de compras si `computa_libro_compras = Sí`.
- Al conciliar se marca `librobanco.conciliado` y `fecha_conciliado`.

## 8. Pendiente
- Probar con datos sobre una copia: ingresos de caja por una venta, **transferencia entre cajas, cierre con diferencia y arqueo por denominación**, depósito bancario (efectivo y cheque), gasto bancario, cheque rechazado y conciliación; ver qué filas se escriben en `caja`, `caja_saldo`, `caja_cierre`, `caja_arqueo`, `librobanco`, `boletadeposito`.
- Abrir: *Otros Medios de Cobro*, *Extracción*, *Cheque Rechazado*, *Ajuste / Saldo Inicial*, *Clearing*, *Liquidación de Tarjeta*, *Transferencia Bancaria* y *Deuda Bancaria*.
- El módulo Impuestos y los Informes de Caja y Bancos.
