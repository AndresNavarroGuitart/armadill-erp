# Ventas > Punto de Venta (TPV) — pantallas y cruce con la base (2026-10-27)

Fuente: recorrido del cliente administraNET Gestión 4 (empresa vacía, usuario Supervisor, sucursal Casa Matriz) + `C:\administraNET\Bases\estructura_default_adm.sql`. No se generó ningún comprobante. Complementa [VENTAS_FACTURACION_COBRANZAS.md](VENTAS_FACTURACION_COBRANZAS.md) y [VENTAS_PRESUPUESTO_PEDIDO.md](VENTAS_PRESUPUESTO_PEDIDO.md).

## 1. Pantalla "Punto de venta" (`Gestión > Ventas > Punto de Venta`, Shift+P)

A diferencia de Facturación, Presupuesto y Pedido **no hay selector de clientes previo**: abre directo el comprobante con *Consumidor Final* cargado, pensado para mostrador y uso con teclado. Tiene su propia barra de ayuda de atajos:
`[F7] Busca cliente / [F8] Agrega cliente / [F9] Agrega cliente ocasional / [F10] Ver ficha artículo / [F11] Búsqueda artículo`.

### Encabezado (Datos)
| Campo | Observado | Notas |
|---|---|---|
| Fecha | 27/10/2026, solo lectura | |
| **Tipo Comp** | **Factura**, **NC por devolución**, **NC por anulación** | el TPV también emite notas de crédito |
| Vendedor | Vendedor 1 (botón de cambio) | |
| PV | 1 (lista de puntos de venta) | |
| Lista precio | Contado | lista del cliente, o la del PV (ver 4) |
| Cliente / Domicilio / CUIT-DOC / IVA | Consumidor Final, "Mendoza", 00-00000000-0, CF | solo lectura; botones **Buscar [F7]**, **Agregar [F8]**, **Ocasional [F9]**, **Editar** |
| Permiso Supervisor | botón | habilita descuentos / cambio de precio |
| **Asistente venta** | Ninguno (botón de selección) | segundo vendedor que asiste en la venta |

### Pestaña Ingreso de artículos [F6]
- Campo **Artículo** (con lupa de búsqueda) y **Cantidad** (default 1). Para el uso con lector de código de barras.
- Grilla **Renglón**: Cód. Sistema 1, Artículo, Cantidad, Precio x U, % Alic, % Des, Sub total, **Precio x U (SD)** (sin descuento), **Promoción**, Tipo IVA.
- Botones laterales: Agregar [F2], Modificar [F3], Eliminar [F4], **Importar**, **Lista de precio** (cambia la lista de todo el comprobante), **Descuentos**, **Ver Cta. Cte**, **Series**, **Eliminar todos**.
- Pie: **TOTAL** en grande, botones **Generar [F12]** y **Cancelar [Esc]**. Al cancelar pregunta "¿Desea salir del punto de venta?" — ojo, **Esc sale del TPV**.

### Selección de artículos (botón Agregar [F2])
Ventana "Selección de Artículos" con las mismas pestañas de búsqueda que el maestro (Búsqueda rápida, Rubro/Sub Rubro, Marca/Modelo, Proveedor, Campos adic.) y la grilla *Artículos y Precios* (Cód. Sistema 2, Artículo, PN V1, Marca, Stock, Proveedor). Panel inferior **Precios**: Lista de Precio (default "Lista 1 - Contado"), Depósitos (Depósito 1), Moneda, **Cotiz. Dólar (1100)**, Stock, Stock disponible, Precio Neto $, Precio Final $, y Aceptar / Cancelar.

### Cliente ocasional [F9] — "Carga cliente ocasional"
Nombre, Domicilio, Tipo identificación (default DNI) + número, E-mail, Celular / WhatsApp. Sirve para facturar a alguien sin darlo de alta como cliente.

### Pestaña Medios de cobro [F5]
No se pudo abrir sin renglones: aparece **"Debe ingresar al menos un artículo en el renglón"**. Por la base y por la pantalla de recibo se infiere que contiene efectivo (con vuelto), cheque, tarjeta y cuenta corriente (ver 3); falta verlo con un artículo cargado.

### Avisos de la aplicación (reglas observadas)
- Con la grilla vacía, *Lista de precio* responde "No existen artículos para llamar al proceso de cambio de lista de precios". *Descuentos* no hace nada.
- El TPV exige al menos un artículo para pasar a cobrar.

## 2. Cruce con la base

El TPV no tiene tablas propias de comprobante: escribe en las mismas que Facturación (`cuentacliente`, `cuerpostock`, `stock`, `caja`), con columnas específicas.

| Concepto | Tabla / columnas |
|---|---|
| Marca de comprobante TPV | `cuentacliente.tpv_comp` (`Si`/`No`), `comprobante_fiscal`, `fe_*` si es electrónico |
| **Cliente ocasional** | `cuentacliente.tpv_nombre_ocasional`, `tpv_domicilio_ocasional`, `tpv_nro_identif_ocasional`, `tpv_doc_cliente_ocasional` (tipo), `tpv_mail_ocasional`, `tpv_cel_wp_ocasional` — **no crea fila en `cliente`**; el comprobante queda a nombre de Consumidor Final (código 1) |
| **Pago mixto** | `tpv_importe_efectivo`, `tpv_pago_efectivo` (lo que entrega el cliente), `tpv_cambio_efectivo` (vuelto), `tpv_importe_cheque`, `tpv_importe_tarjeta`, `tpv_importe_ctacte`, `id_cond_venta_tpv` (condición cuando va a cuenta corriente); además el detalle en las tablas de medios de cobro (`chequetercero`, `medio_cobpag`, `tarjetas_credito`) |
| Redondeo | `cuentacliente.redondeo`, `tipo_redondeo` (A favor / En contra); límite en `sucursales.lim_redondeo_tpv` (1,5 en la semilla); modo de redondeo de precios en `configuracion.redondeo_cambio_precio` (Decimal, Entero 1/5/10/50, Decimal 9/99, Entero 9) |
| **NC desde TPV** | `cuentacliente.TipoNC`, `tipo_devol_nc` (**Efectivo** o **Crédito**), `NroFactura` / `NroFacturaMov` (factura que se anula o devuelve) |
| Asistente de venta | `cuentacliente.id_vendedor_asistente`, `viajantes` |
| Supervisor | `cuentacliente.comp_supervisor`; `punto_venta.bloquea_descuento_pie` |
| Impresión fiscal | `cuentacliente.cierre_z` (cierre Z de impresora fiscal cuando es Consumidor Final), `sucursales.tipo_impresora`, `nombre_impresora`, `puerto_impresora`, `dnf_vta`, `dnf_tipo` (AFIP 910/950), `tipo_dnfh_hasar` (ticket cambio); montos fiscales en `configuracion.fiscal_monto_tq_fac`, `fiscal_monto_CF_FB`, `fiscal_monto_CF_FC` |
| **Modo del TPV** | `sucursales.tipo_tpv` (**Avanzado** / Básico; la semilla usa Avanzado), `punto_venta.tpv_venta_x_bulto` (algoritmo mayorista) |
| Lista de precios por PV | `punto_venta.lista_precio_pv` (default `Lista 1`), `configuracion.tpv_lista_precio_x_pv` (usar la lista del PV), `tpv_lista_precio_x_pv_prioridad_cliente` (la del cliente manda sobre la del PV; default Sí), `recalculo_lp_tpv_cliente` (recalcular lista al cambiar de cliente con artículos cargados; default Sí), `cambio_lista_conserva_promo` |
| Balanza | `configuracion.tipo_balanza` (Comercial / Báscula), `codigo_plu`, `longitud_cod_art_balanza` (4 o 5 dígitos), `articulo.integracion_balanza` |
| Mercado Pago | `punto_venta.activa_mp`, `usa_mp`, `id_caja_mp`, `nombre_caja_mp`; `tarjetas_credito` con billetera electrónica (Mercado Pago Débito / QR / Crédito) |
| Usuarios por PV | `punto_venta_usr` (qué usuario puede usar qué PV) y `punto_venta_usr_info` |
| **Vendedor logueado en caja** | `viajantes.clave_caja`, `logueado`, `detalle_logueo`, `ip_logueo` (un vendedor solo puede estar en una caja a la vez) |
| Cajas del PV | `caja_abm` (Efectivo PV, Cheque PV, Tarjeta PV, otras), movimientos en `caja`, `caja_cierre`, `caja_control_cierre_suc`, **`caja_arqueo`** (conteo por denominación: 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000) |
| Mínimos de factura fiscal | CF: facturas B/C con monto máximo configurable en `configuracion` |

## 3. Reglas de negocio
**Observadas en pantalla:** abre directo con Consumidor Final; fecha no editable; tres tipos de comprobante (Factura, NC por devolución, NC por anulación); atajos de teclado F2–F12; no se puede pasar a cobro ni cambiar lista sin artículos; Esc sale (con confirmación).

**Inferidas de la base (sin probar):** el TPV puede cobrar en efectivo con vuelto, cheque, tarjeta y cuenta corriente en el mismo comprobante; el cliente ocasional no se guarda como cliente; el vendedor queda "logueado" en una caja; la lista de precios se decide entre la del cliente y la del PV según dos parámetros; hay cierre de caja y arqueo por denominación.

## 3 bis. Prueba real: artículo de prueba + factura de TPV (2026-10-27, 19:15–19:21)

Se hizo sobre la base real del equipo, **con una copia de seguridad en frío tomada antes** (ver [COPIA_DE_SEGURIDAD.md](COPIA_DE_SEGURIDAD.md)). Los datos de prueba quedan en la base hasta que se restaure la copia.

### Artículo de prueba (maestro de artículos)
- Alta de **"PRUEBA TPV"**: tipo Artículo, Rubro 1 / Sub Rubro 1, IVA 21 %, IIBB Bienes de Cambio 3,5 %, costo 100. Resultó **código de sistema 4**, `Cod. Sist 1 = 1.1.2` (rubro.subrubro.correlativo), stock 0.
- **Al guardar, los precios no se calculan solos.** Con "Costo neto directo = 100" y marcación 20 % los precios netos y finales quedaron en 0. El sistema exige completar **"Precio de costo bruto: Costo"** (aviso *"Complete el precio de costo"*) y recién después recalcula la marcación.
- Al escribir el **Precio Neto** de una lista, el sistema calcula el **Precio Final con IVA** al salir del campo (120 → 145,2) y recalcula el % de marcación (100 → 120 = 20 %). Con "Recalcula precio de venta" marcada, al guardar vuelve a calcular desde el costo bruto; hubo que desmarcarla para conservar el precio escrito a mano.
- El botón verde de "% Desc. renglón" pregunta *"¿Desea configurar el precio de costo del proveedor como descuento de renglón?"*.
- Guardado en dos pasos (¿Desea guardar el artículo? → "Los datos fueron guardados correctamente"). El listado quedó con **P. Costo = 0,00** aunque el costo era 100: el costo no se persistió como costo de lista; sí quedaron PV 1 = 145,20 y alícuota 21. (Comportamiento a replicar con cuidado: los artículos de ejemplo tienen P. Costo 100 y P. Costo con IVA 121,00.)

### Factura de TPV
| Paso | Observado |
|---|---|
| Selección de artículo | búsqueda por texto "Comienza con"; panel muestra PN V1 120,00 / final 145,20, stock 0, cotización 1100 |
| Renglón ("Agrega renglón") | Código 1.1.2 / 4, descripción, **Precio x U 145,2 (con IVA)**, cantidad, Lista de precio, sub-total, % desc, importe desc, importe final. Cantidad 2 → sub-total 290,4. En la grilla: 2,00 × 145,20, 21 % alícuota, "Gravado", promoción No. TOTAL 290,40 |
| **Medios de cobro [F5]** | *Selección*: Tipo cobro (**Efectivo** / **Tarjeta**), Detalle, Desc. al pie (% e importe). *Detalle*: Importe cobrado, **Cambio**, **Redondeo** (Arriba / Abajo) y "Ingreso de efectivo en moneda extranjera" (Cotiz. dólar 1100, Efect U$S, Efect $). *Totales*: Efectivo, Cuenta Corriente, Cheque, Tarjeta, Transferencia. Saldo, interés total, imp. interno, percepción |
| Cobro | importe cobrado 300 → **cambio 9,60**, saldo 0, total efectivo 290,40 (el botón verde aplica el cobro) |
| Generar [F12] | pregunta *"¿Desea generar el comprobante?"* → *"Se generó el comprobante **FB – 0001-00000001**"* + vista previa Crystal de la Factura B (fecha, número, "Facturado: Supervisor", vendedor, datos del cliente, detalle) y botones de enviar por mail / PDF / WhatsApp |
| Después de generar | el TPV queda vacío, listo para otra venta; no pide cerrar |

### Resultado guardado (Consultas y Anulaciones, comprobante FB)
- Fila: 27/10/2026, **0001-00000001**, Consumidor Final, **290,40**, vencimiento 27/10 (Contado), **Estado "Canc"** (cancelado = cobrado), Anulado No.
- Al visualizar ("Visualizar Factura B TPV"): pie *"Usuario: Supervisor – Sucursal: Casa Matriz – **Cod. mov: 2** – Fecha: 27/10/2026 19:20:12"*. El contador `codmov` arrancó en 1 y la venta tomó el 2.
- En la pestaña de cobro del comprobante guardado: Efectivo **290,4** (Efect $ 290,4); **cambio e importe cobrado no se muestran** (0): lo entregado y el vuelto no se ven al visualizar; no se pudo confirmar si se guardan en `tpv_pago_efectivo` / `tpv_cambio_efectivo`.
- **Stock**: el artículo pasó a **−2 en Depósito 1**: el TPV deja vender sin stock (`sucursales.salida_sin_stock = Si`).
- Menú Comandos de la consulta: Visualizar F2, Modificar F3, **Anular F4**, **Reimprimir F5**, Adjunto F6, **Autorización F7**, **Estado de crédito F8**, Adjuntar archivo F10, Geolocalización. También existe "Trazabilidad" y "Descuentos y voucher" en la vista del comprobante.

### Tablas realmente escritas
Se comparó la hora de modificación de los archivos de datos de MySQL (`C:\administraNET\mysql\data\administranet\*.ibd`) antes y después de la venta. **A las 19:20:16** (momento de Generar) cambiaron:

| Tabla | Para qué |
|---|---|
| `cuentacliente` | encabezado del comprobante y total |
| `stock` | libro de stock: una fila por renglón (entrada/salida y saldo) |
| `stock_deposito` | saldo por depósito (−2) |
| `caja` | movimiento de ingreso en la caja "Efectivo PV" |
| `caja_saldo` | saldo acumulado de la caja |
| `talonarios` | avance de numeración (siguiente nº de FB) |
| `codmov` | contador del código de movimiento |
| `resumen_venta_cv` | resumen de ventas por condición de venta |
| `cliente_datos_adicionales` | datos de entrega del comprobante (depósito, forma de entrega) |

Al crear el artículo (19:17–19:18) cambiaron `articulo`, `articulo_valor_ce` (campos adicionales) y `precios_historial` (historial de precios). Al iniciar sesión (19:12–19:14) cambiaron `viajantes` (marca de vendedor logueado), `sesion` y `empresas.sesion2`.

**Dato importante**: `cuerpostock` **no figura** entre las tablas modificadas, así que los renglones de la venta se guardaron en `stock` y no en `cuerpostock` (que sería de comprobantes en curso o de otro circuito). Falta confirmarlo, porque MySQL escribe en disco de forma diferida y una tabla puede no haberse volcado aún; hay que leer la base viva o repetir el chequeo.
No hubo escritura en `medio_cobpag`, `chequetercero` ni `tarjetas_credito`: el cobro en efectivo se resume en `cuentacliente` y `caja`.

### Correcciones a lo inferido en las secciones 2 y 3
- Confirmado: pago en efectivo con vuelto y cuadro de totales por medio (efectivo, cuenta corriente, cheque, tarjeta, transferencia). Tipos de cobro disponibles en esa pestaña: Efectivo y Tarjeta.
- Confirmado: el vendedor se marca como logueado (`viajantes` se modifica al iniciar sesión).
- Confirmado: el comprobante de TPV usa `cuentacliente` + `stock` + `caja`; los renglones **no** se vieron en `cuerpostock`.
- El cliente ocasional, el pago mixto, la nota de crédito, el cierre de caja y el arqueo **siguen sin probar**.

## 4. Pendiente
- Probar **pago con tarjeta**, **cuenta corriente** y pago mixto; **NC por devolución / por anulación**; **cliente ocasional**; cierre de caja y arqueo (menú Caja).
- Confirmar con la base viva (consulta de solo lectura) los renglones en `stock`/`cuerpostock` y los campos `tpv_*` de la fila de `cuentacliente`.
- **Restaurar la copia** para dejar la base sin datos de prueba (artículo 4, FB 0001-00000001, movimientos de caja y stock).
- Probar NC por devolución y por anulación (qué comprobante exige elegir, cómo calcula `tipo_devol_nc`).
- Ver cierre de caja y arqueo (menú Caja) y los botones *Importar* y *Series*.
- Pantallas aún sin recorrer de Ventas: Nota de Crédito / Débito (menú), Cuenta Corriente, Consultas y Anulaciones, Procesos fiscales, Administración de comprobantes electrónicos.
