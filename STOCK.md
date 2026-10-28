# Módulo Stock: movimientos, remitos, pedido interno, inventario y ficha (2026-10-27)

Fuente: recorrido del cliente administraNET Gestión 4 (base limpia restaurada, usuario Supervisor, sucursal Casa Matriz, **un solo depósito**) + `estructura_default_adm.sql`. **No se generó ningún comprobante ni se guardó nada**: cada pantalla se abrió y se canceló. Complementa [VENTAS_PUNTO_DE_VENTA.md](VENTAS_PUNTO_DE_VENTA.md) (donde se vio que una venta escribe `stock` y `stock_deposito`) y [COMPRAS_Y_PAGOS.md](COMPRAS_Y_PAGOS.md).

## 0. Menú `Gestión > Stock`

Ingreso Mov. Stock (F9), Remito de Compra (F10), Remito de Venta (F11), Pedido interno a depósito / compras, Inventario, Consulta Ficha de Stock, Control de salida de stock para reparto, Consultas y Anulaciones, Informes. El directorio de informes tiene 123 reportes `stock_*.rpt`.

## 1. Ingreso de movimientos (`Ingreso Mov. Stock`, F9) — "Movimiento de Stock"

Encabezado: **Fecha** (hoy), **Motivo**, **Depósito**, **Detalle** y **Referencia**. Renglón: **Artículo** (con buscador), **Movimiento** (Entrada / Salida, solo lectura, lo fija el motivo) y **Cantidad**, con botones agregar / modificar / quitar / otro. Grilla: Cód. Sistema, Descripción, **E/S**, Cantidad, Nro Pedido, Marca, **Lote**, **Vto Lote**, Pres. V, Pres. C, Embalaje…

| Motivo (lista completa) | Efecto observado |
|---|---|
| **Stock Inicial** (default) | Movimiento = Entrada |
| Ajuste | |
| Faltante Mercadería | |
| Sobrante Mercadería | |
| Rotura | |
| **Transferencia** | Movimiento = Salida; aparece **"a Depósito"**, **Vendedor** y el botón **"Pedidos internos a depósito"** (traer un pedido interno). Con un solo depósito avisa **"No existen otros depósitos para transferir"** |
| Mov. Interno Salida / Mov. Interno Entrada | |
| **Armado** / **Desarmado** | Movimiento = Salida; también muestra "a Depósito" (armado de combos / desarme, ver `Archivo > Productos > Armado / Desarmado de artículos`) |

- **Referencia**: lista de referencias de movimiento: "Referencia 1" (default) y "Sin Referencia".
- Al cancelar pide *"¿Desea cancelar la generación del movimiento de stock?"*.

## 2. Remito de Compra (F10)

Selector de proveedores (Sucursal, grilla con Saldo, búsqueda por código / nombre / CUIT). Menús: Archivo, **Comprobantes** (**Remito de Compra**, F2) y Acciones.
**Formulario "Remito"**: Fecha Comprobante, Fecha Registro, **Nro. Comprobante** (dos campos, número del proveedor), Proveedor, Detalle, **Depósito** (modo + depósito) y selector **"Ord. Compra"** con botón para traer una orden. Grilla **sin precios**: Cód. Sistema 2, Descripción, Cantidad, Nro Presupuesto, **Nro OC**, **Nro Factura**, **Lote**, **Vto Lote**, Detalle; 5 botones laterales y Stock actual / PED Cliente / Disponible. Botones Generar / Cancelar.
- **Modos de depósito** (lista): **Defecto usuario**, **Comp. original**, **Seleccionado**, **Por artículo** (iguales que en las notas de crédito por devolución).
- El remito ingresa mercadería sin valorizar; luego se factura con *Factura de Compra / Remito* (ver [COMPRAS_Y_PAGOS.md](COMPRAS_Y_PAGOS.md)).

## 3. Remito de Venta (F11)

Selector de clientes (Tipo Comprobante Sistema / Talonario). Menú **Comprobantes**: **Remito** (F2) y **Remito por pedidos pendientes** (F3).
**Formulario "Remito de Venta"**: Fecha, Detalle, **PV**, Cliente, Vendedor, **Datos** (entrega, mismo diálogo que presupuesto y pedido), **Depósito** (modo + depósito) y **Pedidos** (selector "Pedido" con botón). Grilla sin precios: Cód. Sistema 2, Artículo, Cantidad, **Nro Pedido**, **Nro Presupuesto**, **Nro Factura**, Lote, Vto Lote, Detalle; 6 botones laterales.

## 4. Pedido interno a depósito / compras

Ventana **"Pedido interno"**: Fecha, **Tipo pedido** (**A depósito** / **A compras**), **Depósito** (origen), **a Depósito** (destino), Detalle; renglón con Artículo, Cantidad y **Embalaje**; grilla Cód. Sistema 1, Cód. Manual, Descripción, Cantidad, Embalaje, Nro Lote, Vto Lote. Es el comprobante `PEDI` (id 27). Un pedido "a depósito" se resuelve después con una **transferencia** (botón "Pedidos internos a depósito"); uno "a compras" alimenta la orden de compra / pedido interno del módulo Compras.

## 5. Inventario

Ventana **"Inventario"**.
- **Filtros** (cada uno con casilla): **Depósito**, **Intervalo** de fechas, **Artículo**, **Proveedor**, **Categoría**, **Marca**, **Rubro**, **Modelo**, **Sub Rubro**. Botones: cargar grilla, limpiar y otro.
- **Regla observada:** con ningún filtro tildado, al cargar avisa **"Debe seleccionar un artículo"**.
- Los artículos ofrecidos (con el filtro Artículo) son **Artículo 1** y **Servicio 1**: **no aparece "Combustibles"** (tipo Gasto), o sea que el inventario excluye los gastos.
- **Grilla**: Cód. sistema, Cód. manual, Artículo, **Depósito**, **Stock Sistema** (0 para Artículo 1 en la base limpia) y **Stock Real** (se carga a mano: el conteo físico).
- Botón **Generar** (la diferencia entre sistema y real genera el ajuste) y **Cancelar** (*"¿Desea salir del proceso de inventario?"*). No se probó generar.

## 6. Consulta Ficha de Stock

Ventana **"Ficha de Stock"** (menús Archivo / Comandos). **Datos de artículo**: Artículo (buscador), Código sistema, Código manual, Marca, Cód. Prov. **Filtros**: Depósito e Intervalo (default 01/01 del año a hoy) con botón de consulta. **Stock**: *Saldo en unidades* y grilla de **Lotes** (Lote, Fecha Vto, Stock, Saldo bulto). **Historial de Movimientos**: Fecha, Tipo Comp, Comp, Nro Comp, **Precio Costo**, **Entrada**, **Salida**, **Saldo**, Lote, Vto lote, Detalle.
- Comandos: **Visualiza comprobante** (F2), **Visualiza ficha artículo** (F3), **Visualiza de número de serie** (F4).

## 7. Control de salida de stock para reparto

Ventana **"Control de stock avanzado"**: Comprobante (default **Pedido**) + **Código de barra**, bloque *Ingreso* con lectura de código de barras y descripción, y grilla Cód. sistema, **UPC**, Artículo, **Cantidad**, **Leído**, **Faltante**, **Estado**. Sirve para **verificar con lector** que lo preparado coincide con el pedido antes de despachar (picking). Botones aceptar / cancelar.

## 8. Consultas y Anulaciones de stock

Ventana **"Consulta, Modificaciones y Anulaciones de Comprobantes – Remitos de Venta y Compra"**: filtros Talonario (1) con selector, Sucursal, **Comprobante** (default **REM Venta**; también remitos de compra), Intervalo (01/10 a hoy), Campo (Nro Comp) y Datos. Grilla: Fecha, Nro Comp, Cliente, Importe, Vencimiento, Cond Venta, Estado, Anul, **F. Entrega**, Detalle. Misma mecánica que Consultas y Anulaciones de Ventas (doble clic para visualizar).

## 9. Cruce con la base

| Concepto | Tabla / columnas |
|---|---|
| **Libro de stock** | **`stock`**: una fila por movimiento y artículo (ver [VENTAS_PUNTO_DE_VENTA.md](VENTAS_PUNTO_DE_VENTA.md)): `IDArt`, `Fecha`, `Entrada`, `Salida`, `saldo`, `CodDeposito`, `CodigoMovimiento`, `Tipo`/`TipoComp`, `NroComprobante`, `PrecioCostoxU`, `id_lote`, `id_serie_entrada`, `id_ref_movstock`, `detalle`, `Anulado` |
| Saldo por depósito | `stock_deposito` (`id_articulo`, `id_deposito`, `saldo`, `saldo_pedido_cliente`, `saldo_pedido_proveedor`); saldo cacheado en `articulo.saldo_articulo` |
| **Cabecera de movimiento de stock** | **`movimiento_stock`**: `motivo_movimiento` (comentario: *Stock Inicial, Faltante Mercadería, Sobrante Mercadería, Rotura, Transferencia*), `fecha`, `deposito_origen`, `deposito_destino`, `detalle`, `codigo_movimiento`, `nro_comprobante`, `id_usuario`, `id_sucursal`, `id_pv`, **`tipo_comprobante`** (`MSTOCK` / `PEDI`), `anulado`, `id_ref_movstock`, `cant_desarme`, `estado` (Pendiente / Nc / Canc), `id_cliente`, `id_vendedor`, `transmitido` |
| Referencias | **`ref_movstock`** (semilla: 1 "Sin Referencia", 2 "Referencia 1") |
| Pedido interno ↔ movimiento | **`movstock_pedi`** (`codmov_movstock`, `codmov_pedi`, `anulado`); `comp_ped` con `tipo_pedido_interno` ("Pedido interno" / "Pedido a compras") |
| Renglones del movimiento | `cuerpostock_mstock` (cuerpo de movimientos de stock), `cuerpostockp`/`stockp` para pedidos |
| **Remitos** | encabezado en `cuentacliente` (venta) / `cuentaproveedor` (compra) con **`estado_remito`** (Pendiente / Facturado); renglones en `cuerpostock`/`stock`; vínculos: **`rem_ped`** (remito ↔ pedido: `NroRemito`, `NroPedido`, `codmov_remito`, `codmov_pedido`), **`rem_fact`** (remito ↔ factura: `CodigoMovimientoR`, `CodigoMovimientoF`) y `remp_factp` (idem para el circuito de pendientes); en `cuentacliente`: `remite_factura_art`, `estado_fact_remito`, `cantidad_entregada_pend` y `entregado_fact_total` en `stock` |
| **Inventario** | **`inventario`** (`id_articulo`, `id_deposito`, `fecha_inventario`, `saldo_sistema`, `saldo_manual` = saldo real físico, `diferencia`, `id_inventario_id`, `tipo`, `id_usuario`), `inventario_id` (cabecera de cada toma) e `inventario_temp` (borrador por usuario, **no replicar**) |
| Lotes | `lote` (`cod_lote`, `fecha_vto_lote`, `stock_total_lote`, `tipo_lote`, `id_proveedor`) y `lote_stock` (stock por lote y depósito) |
| **Series** | `serie_entrada` (nro_serie, vto, `disponible`, `id_deposito`, `codigo_mov_entrada`, `codigo_mov_compra`), `serie_salida_temp` y **`serie_movimiento`** (nro_serie y `codigo_mov_vta` / `codigo_mov_compra` / `codigo_mov_mstock`): trazabilidad por número de serie |
| Reposición por depósito | **`deposito_reposicion`** (`id_articulo`, `id_deposito`, `stock_minimo`, `stock_maximo`, `punto_pedido`, `pasillo` ubicación): los mínimos/máximos y la ubicación son **por depósito**, no solo en `articulo` |
| Depósitos | `deposito` (semilla: 1 "Depósito 1") y `deposito_usr` (qué usuario usa qué depósito, para el modo "Defecto usuario") |
| Armado / desarmado | `en_abm` / `en_abm_formula` (fórmula de armado) y `articulo.ensamblado`, `id_en_abm`; `movimiento_stock.cant_desarme` |
| Control de salida (picking) | sin tabla propia aparente; compara el comprobante (`cuerpostockp`) contra lo escaneado en pantalla |

## 10. Reglas de negocio

**Observadas en pantalla**
- El **motivo fija el sentido**: Stock Inicial es entrada; Transferencia, Armado y Desarmado son salida con depósito destino.
- Una **transferencia exige un segundo depósito**: con uno solo no se puede.
- El inventario exige filtrar por al menos un criterio y no incluye artículos de tipo Gasto.
- El remito (de compra o de venta) **no lleva precios**, solo cantidades, lotes y vencimiento de lote; se vincula con pedido / OC / factura por número.
- El depósito de un comprobante se elige entre 4 modos (defecto del usuario, el del comprobante original, uno seleccionado, o por artículo).
- La ficha de stock calcula el saldo por artículo, depósito y rango de fechas y muestra lote y serie.

**Inferidas de la base (sin probar)**
- Las ventas, compras, remitos, notas de crédito/débito y movimientos usan **el mismo libro `stock`**, distinguiendo por `TipoComp`; cada movimiento actualiza `stock_deposito` y el saldo cacheado del artículo.
- El inventario genera un movimiento de ajuste por la `diferencia`, y deja traza en `inventario`.
- Un remito deja la factura "Pendiente de remitir" o el remito "Pendiente de facturar" según `estado_remito` / `estado_fact_remito`.
- El stock reservado por pedidos vive en `stock_deposito.saldo_pedido_cliente`.

## 11. Pendiente
- Generar, sobre una copia de la base, un movimiento "Stock Inicial", una transferencia (hace falta un 2.º depósito), un remito de compra y uno de venta, y un inventario con diferencia; ver qué filas se escriben en `stock`, `stock_deposito`, `movimiento_stock`, `cuerpostock_mstock`, `rem_*` e `inventario`.
- Probar lote y serie (artículo con lote/serie), Armado / Desarmado, Remito por pedidos pendientes y el Control de salida con lector.
- Informes de Stock (123 reportes `stock_*`) y los demás módulos: Caja, Bancos e Impuestos.
