# Ventas > Presupuesto y Pedido — pantallas y cruce con la base (2026-10-27)

Fuente: recorrido del cliente administraNET Gestión 4 (empresa vacía, usuario Supervisor, sucursal Casa Matriz) + `C:\administraNET\Bases\estructura_default_adm.sql`. No se generó ningún comprobante. Complementa [VENTAS_FACTURACION_COBRANZAS.md](VENTAS_FACTURACION_COBRANZAS.md).

## 1. Estructura común

Presupuesto (`Gestión > Ventas > Presupuesto`, F4) y Pedido (`… > Pedido`, F3) usan el mismo patrón que Facturación y Cobranzas:

1. Ventana con **selector de clientes** (grilla Nombre / Código / CUIT-DOC / IVA / Tipo / Teléfono / Email / WhatsApp / Saldo + búsqueda rápida por código, nombre o CUIT) y **Tipo Comprobante** `Sistema` / `Talonario`.
2. Menús: Archivo (Copiar celda, Salir), **Comprobantes**, Acciones, Informes → Visualizar (F12).
3. Acciones: Ver Cuenta Corriente (F9), Agregar Cliente (F10), Agregar Cliente Rápido (F11), Editar Cliente Rápido (F12), Visualizar domicilios y contactos (Shift+D). *(En Presupuesto el listado aparece sin la palabra "contactos".)*
4. Se elige el cliente y se abre el comprobante desde `Comprobantes`.

| Pantalla | Menú Comprobantes |
|---|---|
| Presupuestos | Presupuesto (F2) |
| Pedidos | Pedido (F2), **Gestión de pedidos avanzado** (F4) |

## 2. Formulario Presupuesto / Pedido

Igual que la factura: encabezado, pestañas **Cuerpo Comprobante** / **Carga Renglón** y **Pie de comprobante**, botones **Generar** y **Cancelar** (pide confirmación "¿Desea cancelar la generación del presupuesto / pedido?").

**Encabezado** (valores observados con *Cliente 1*, el cliente de ejemplo)

| Campo | Observado | Origen |
|---|---|---|
| Fecha | 27/10/2026, **solo lectura** (en la factura sí es editable) | fecha del día |
| Cliente | Cliente 1 | selector |
| Vendedor | Vendedor 1 (botón de cambio) | `cliente.CodViajante` |
| Cond Venta | Cta/Cte 30 | `cliente.id_cv` |
| Lista precio | "Lista" | `cliente.ListaPrecio = 'Lista 2'`, rótulo en `configuracion.desc_util2` |
| **Vencimiento** | **03/11/2026 = hoy + 7 días**, aunque la condición es Cta/Cte 30 | `sucursales.dias_venc_presup` / `dias_venc_pedido` (7 en la semilla; default de columna 15). En Facturación vence según la condición de venta |
| Detalle | texto libre | |
| Datos (botón) | diálogo de entrega, ver 3 | |
| Permiso Supervisor (botón) | habilita descuentos / cambio de precio | `comp_supervisor` |
| **Solo Pedido:** Presupuesto (botón) | trae un presupuesto pendiente del cliente; sin ninguno: **"No existen presupuestos pendientes"** | `comp_ped.NroPresup` |
| **Solo Pedido:** Reporte | `Formal` / `Reducido` (formato de impresión) | selector de reporte |

**Grilla Renglón**: Cód. Sistema 2, Descripción, Precio x U, Cantidad, % Alic, % Des, Precio Neto, **Nro Pedido** (en Presupuesto) o **Nro Presupuesto** (en Pedido), Tipo IVA, Tipo Art. (La factura muestra además Marca y Nro Remito.) 7 botones laterales como en la factura. Bajo la grilla: Stock actual, PED Cliente, Disponible.

**Carga Renglón / Pie**: idénticos a la factura (Código ×3, Descripción, Precio x U, Lista + botón, Cantidad, Sub-Total, % Desc, Importe Desc, Importe Final, Detalle; pie con subtotales 21 % y 10,5 %, descuento, interés, percepción, exento, IVA por alícuota y Total General).

## 3. Diálogo "Datos adicionales de comprobante" (botón Datos)

| Campo | Valor por defecto / opciones |
|---|---|
| Depósito | Depósito 1 (lista de `deposito`) |
| F. Entrega | fecha del día |
| Entrega | **Retira cliente mostrador** (default), Retira cliente despacho, Envía por despacho, Entrega vendedor, Transporte, Envía repartidor, Reservado en depósito, Operador logístico |
| Domicilio | domicilios del cliente (`cliente_domicilio`) |
| Detalle | texto libre |
| Contacto | contactos del cliente (`cliente_contacto`) |
| Origen | **Telefónico** (default), Mostrador, E-Mail, Viajante, Ecom vendedor, Ecom cliente, Mercado Libre, Formulario de contacto web (la lista continúa; solo se vieron 8 opciones) |

## 4. Gestión de pedidos avanzado (F4)

Con un cliente sin pedidos muestra **"No existen pedidos pendientes"** y no abre. Los accesos rápidos del panel lateral muestran el resto del circuito: *Consulta presupuestos*, *Consulta avanzada de artículos*, *Gestión de pedidos avanzada*, *Gestión de preparación de pedidos* y *Consulta de preparación de pedidos*. No se pudieron explorar sin datos.

## 5. Cruce con la base

| Concepto | Tabla / columnas |
|---|---|
| **Encabezado de presupuesto y pedido** | **`comp_ped`** (no `cuentacliente`): `TipoComprobante` (`PRE`, `PED`; también `PEDI` pedido interno), `NroComprobante`, `NroCompBusq`, `Codigo` (cliente), `CodigoMovimiento`, `Fecha`, `Vencimiento`, `Vencido`, `Estado`, `Anulado`, `CondVenta`, `id_condventa`, `CodViajante`, `CodSucursal`, `IdUsuario`, `id_pv` |
| Importes | `SubTotal1/2/SubTotalGral`, `Alicuota1/2`, `IVA1/IVA2`, `Exento`, `ImpDesc1/2`, `PorDesc1/2`, `interes*`, `impuesto_interno*`, `total_percep`, `ImporteVenta` (total), `CotiDolar` |
| Vínculo presupuesto → pedido | `NroPresup` (en el pedido), `Tipo`, `TipoPedido`; el estado del presupuesto se cierra con `erp_estado_pre` (`Abierto` / `Vencido`, solo uno abierto por vez según el comentario del campo) y `id_plantilla` (plantilla de presupuesto) |
| Entrega | `FechaEntrega`, `FormaEntrega`, `id_transporte`, `id_repartidor`, `id_deposito_despacho`, `operador_logistico`; el detalle por comprobante (domicilio, contacto, origen, ruta, seguimiento) en **`cliente_datos_adicionales`** (`CodigoMovimiento`, `TipoComprobante`, `Fentrega`, `origen_pedido`, `id_cliente_domicilio`, `id_cliente_contacto`) |
| Autorización | `autorizacion_web` (default `Aprobado`), `autorizacion_sistema` (default `Autorizado`), `idUsuarioAut`; la autorización la gestiona `Herramientas > Autorización de pedidos (Shift+A)` |
| Ecommerce / pasarela | `ped_eco` (nº de pedido de la tienda), `estado_pago_ecom`, `info_ped_eco` (JSON de la pasarela de pago), `geo_latitud/longitud` |
| Cliente ocasional | columnas `tpv_*_ocasional` (nombre, domicilio, documento, mail, WhatsApp) |
| **Renglones** | **`cuerpostockp`** (cuerpo: `IDArt`, `Cantidad`, `CantidadOr` cantidad original, precios `…xU` y `…xR`, descuento, alícuotas, lote, `NroPresupuesto`/`NroPedido` y `codmov_*`) y **`stockp`** (libro de movimientos del comprobante pendiente, `Entrada/Salida`, `saldo`, `Orden`); la `p` es de *pedido/pendiente* |
| Reserva de stock | `stock_deposito.saldo_pedido_cliente` (cantidad comprometida por pedidos de cliente) y `saldo_pedido_proveedor`; es lo que muestra "PED Cliente" y "Disponible" en pantalla |
| Numeración | `talonarios` (tipos `PRE` y `PED`, comprobantes 18 y 19 en `comprobante`) |
| Vencimientos | `sucursales.dias_venc_presup`, `sucursales.dias_venc_pedido` |
| Movimiento interno | `movstock_pedi` y `movimiento_stock` con `tipo_comprobante='PEDI'` (pedido interno a depósito / compras, menú Stock) |

**Diferencias con la factura**
- *(Inferido de la estructura, sin probar con un comprobante real.)* Presupuesto y pedido **no tocan la cuenta corriente ni el stock real**: viven en `comp_ped` + `cuerpostockp` + `stockp`; la factura vive en `cuentacliente` + `cuerpostock` + `stock`. Al facturar un pedido, los renglones pasarían de un conjunto de tablas a otro, con `codmov_pedido` como vínculo.
- La fecha es fija y el vencimiento sale de la sucursal, no de la condición de venta.
- Pedido admite `Formal`/`Reducido` como formato de reporte.

## 6. Reglas de negocio
Observadas en pantalla: vencimiento = hoy + días de la sucursal (7); fecha no editable; "Presupuesto" del pedido solo lista presupuestos pendientes del cliente; gestión avanzada exige pedidos pendientes.
Inferidas de la base (sin probar): un presupuesto convertido en pedido deja de estar pendiente; un solo presupuesto abierto por cliente (`erp_estado_pre`); la reserva del pedido descuenta del "Disponible" vía `saldo_pedido_cliente`; los pedidos de ecommerce nacen `Aprobado` y los del sistema `Autorizado`, y la autorización los habilita en la lista de pendientes.

## 7. Pendiente
- Generar un presupuesto y un pedido de prueba sobre una copia de la base para confirmar: tablas escritas, estado, reserva de stock, conversión a factura.
- Recorrer *Gestión de pedidos avanzado*, *Gestión de preparación de pedidos* y *Consulta de presupuestos* con datos.
- Pantallas aún sin recorrer: Punto de Venta (Shift+P), Nota de Crédito / Débito, Cuenta Corriente, Consultas y Anulaciones, Procesos fiscales, Administración de comprobantes electrónicos.
