# Módulo Impuestos (2026-10-27)

Fuente: recorrido del cliente administraNET Gestión 4 (base limpia restaurada, usuario Supervisor) + `estructura_default_adm.sql`. **No se guardó nada**: la pantalla de alta de presentación se abrió y se canceló. Es el módulo más chico: `Gestión > Impuestos` tiene solo **Gestión Impuestos** e **Informes**. La parte impositiva fuerte del sistema está repartida en otros módulos (IVA en cada comprobante, retenciones y percepciones en cobranzas, pagos y compras; libros de IVA en los informes).

## 1. Gestión de Impuestos (`Gestión > Impuestos > Gestión Impuestos`)

Ventana **"Gestión de Impuestos"**.
- **Panel Impuestos** (Código, Nombre): **2 Ganancias**, **7 Ganancias – Plan de Pago**, **4 Ingresos Brutos**, **1 IVA**, **3 SUSS**. (Los códigos 5 y 6, *Imp Ley 25413 Déb./Créd. 0,6 %*, existen en la base pero no aparecen aquí: son impuestos "de libro banco", ver 3.)
- **Panel Detalle** (presentaciones del impuesto elegido): Período, Vencimiento, Importe, Estado, **Tipo Pres.**, **Tipo Saldo**, Anulado, Detalle. Búsqueda por intervalo (default 01/01/2013 – 31/12/2013) y texto ("Búsqueda por Período, Estado…"). Al pie **Total a pagar**.
- **Comandos**: **Agregar Presentación** (F2), **Visualizar Presentación** (F3), **Modificar Presentación** (F4) y **Anular** (F5). Archivo: Salir.

### Formulario "Agregar Presentación de Impuesto"
| Campo | Observado |
|---|---|
| Impuesto | el elegido (p. ej. IVA) |
| **Período** | con botón de búsqueda: abre **"Año y Período de vencimiento fiscal"**, un calendario fiscal con panel **Año** (Año, Anulado) y panel **Período** (Mes, Inicio, Fin, **Vto Fiscal**, **Abierto**, Anulado). En la base limpia está **vacío**: hay que cargarlo antes de presentar |
| **Tipo Presentación** | **Original**, **Rectificativa 1, 2, 3, 4, 5, 6, 7…** (la lista sigue) |
| Detalle | texto libre |
| Vencimiento | hoy (editable) |
| **Importe** | número + **signo**: **A Favor** (default) o **A Pagar** |

La pantalla registra el resultado de la **declaración jurada** de cada impuesto (cuánto quedó a favor o a pagar y cuándo vence) y lleva la cuenta de las **rectificativas**. No calcula el impuesto: el importe se carga a mano o llega desde los informes.

## 2. Informes de Impuestos (`Informes\impositivo_*.rpt`)

17 reportes, entre ellos: **impuestos** y **impuestos_detalle_saldo**, **iva_ventas** e **iva_compras** (libros de IVA), **resumen_iva_total**, **resumen_iva_ventas**, resumen de IVA por **sub-alícuota** (crédito y débito), **ingbrutos_gral** e **ingbrutos_xarticulo**, **percepciones** (compras, compras por jurisdicción, pagos, ventas) y **retenciones** (clientes, proveedores IIBB y proveedores Ganancias).

## 3. Cruce con la base

| Concepto | Tabla / columnas |
|---|---|
| **Catálogo de impuestos** | **`impuesto`**: `nombre_impuesto`, **`comp_iva`** (Sí/No: si es del tipo IVA / patrimonial), `id_pc` (cuenta contable de pérdida / gasto), **`id_pc_deuda`** (cuenta de deuda), **`alcance_impuesto`** (`OP`, `LB` o `OP-LB`: en qué comprobante se imputa: orden de pago, libro banco o ambos), `anulado`. Semilla: 1 IVA (comp_iva Sí, alcance OP-LB, cuentas 17 y 151), 2 Ganancias, 3 SUSS, 4 Ingresos Brutos, 5 y 6 Impuesto Ley 25413 (déb. / créd. 0,6 %, alcance LB), 7 Ganancias – Plan de Pago |
| **Presentaciones** | **`impuesto_detalle`**: `id_impuesto`, `id_periodo`, `id_year`, `fecdesde_impdetalle`, `fechasta_impdetalle`, **`importe_impdetalle`**, **`estado_impdetalle`** (Canc / N/Canc), `vencimiento_impdetalle`, **`NomPer_impdetalle`** (mes y año), **`tipoPres_impdetalle`** (Original / Rectificación), **`Tipo_saldo`** (A favor / A pagar), `codigo_mov_op` (orden de pago con que se pagó), **`codigo_movimiento`** (código del asiento contable de la presentación, para poder anularlo), `detalle_impdetalle`, `detalle2_impdetalle`, `anulado` |
| **Calendario fiscal** | **`years`** (años) y **`periodos`** (`id_year`, `mes_periodo`, `mes_numero_periodo`, `inicio_periodo`, `fin_periodo`, **`vencimiento_fiscal_periodo`**, **`abierto_periodo`**, `anulado_periodo`) |
| Pago del impuesto | la orden de pago "Otros Egresos" (tipo **Impuesto**, ver [COMPRAS_Y_PAGOS.md](COMPRAS_Y_PAGOS.md)): `otro_egreso` con `id_impuesto`, `id_impuesto_detalle` y `tipo_oe` (Gasto / Impuesto); también `deuda` / `deuda_abm` para planes de pago |
| Impuestos bancarios | `librobanco.id_impuesto` (gravámenes del libro banco; ver [CAJA_Y_BANCOS.md](CAJA_Y_BANCOS.md)) |
| **Alícuotas** | `iva` (21 %, 10,5 %, 27 %, exento, no gravado, con `cod_afip`) y `activ_iibb` (3,5 % / 1 %), ver [MODELO_DATOS_CLIENTE_ARTICULO.md](MODELO_DATOS_CLIENTE_ARTICULO.md) |
| **Percepciones sufridas** (compras / pagos) | **`percepcion`** (`id_percepcion_abm`, `importe_percepcion`, `codigo_mov_op`, `tipo_percepcion`) y **`percepcion_abm`** (`nombre`, `alicuota`, `id_pc`, **`tipo`**: IVA / IIBB / SUSS / Ganancia; semilla: "Débito RG3378/79 15 %"), `percep_prov` y `percepcion_prov_convenio` (convenio multilateral por jurisdicción) |
| **Percepciones aplicadas** (ventas) | **`percep_cli`** / **`percep_cli_abm`** / `percep_cli_tipo` y `percep_cli_param` (parámetros), más `cuentacliente.total_percep`, `monto_percep_iva` |
| **Retenciones a proveedores** | `tipo_retencion_pro` (IIBB: `Porcentaje`, `ImporteImp`, `codigo_tipo_regimen`, `id_jurisdiccion`), `tipo_retencion_prog` (Ganancias) y `tipo_retencion_pro_iva`; certificados en `retenciones_prov`, `retenciones_provg` y `retenciones_prov_iva`; categorías en `categoriaret_prov` |
| **Retenciones sufridas de clientes** | `tipo_retencion_cli` (`CodAgeRet`, `id_impuesto` = impuesto al que pertenece, `cod_afip`, `tipo` Nacional / Convenio, `id_juridic_convenio`) y `retenciones` (certificados que nos hacen) |
| Códigos AFIP | `cod_afip_retencion`, `retencion_juridic_convenio`, `iva.cod_afip`, `contribuyentes.cod_afip` |
| Parámetros de agente | en `sucursales`: `agente_retib`, `agente_retg`, `agente_reti`, `agente_percep`, `agente_percep_resol_afip_5329_iva`; en `configuracion`: `resol_afip_5003` y su texto |

## 4. Reglas de negocio

**Observadas en pantalla**
- Cada impuesto se presenta por **período fiscal** (cargado en el calendario fiscal, con vencimiento por período y estado abierto / cerrado) y puede tener **presentación original y hasta 7 o más rectificativas**.
- El resultado de cada presentación es **a favor** o **a pagar**, y el estado del pago es **Canc / N/Canc**.
- Hay impuestos propios del sistema (IVA, Ganancias, Ingresos Brutos, SUSS) y un plan de pagos de Ganancias.
- La pantalla lista un **total a pagar** de las presentaciones del impuesto filtrado.

**Inferidas de la base (sin probar)**
- Presentar un impuesto **genera un asiento contable** (`codigo_movimiento` guardado para poder anularlo) y deja una deuda en la cuenta `id_pc_deuda`; pagarlo (orden de pago por *Otros Egresos*) la cancela y completa `codigo_mov_op`.
- `comp_iva` distingue el impuesto IVA (que se compensa débito contra crédito) de los demás.
- `alcance_impuesto` decide si el impuesto se imputa en órdenes de pago, en el libro banco o en ambos.

## 5. Pendiente
- Cargar el calendario fiscal (años y períodos) y presentar un impuesto de prueba sobre una copia; ver los asientos, `impuesto_detalle`, `periodos` y la relación con la orden de pago.
- **El cálculo de IVA, retenciones y percepciones es lo más delicado de replicar** y está distribuido: IVA por alícuota en cada comprobante, retenciones en la orden de pago y el recibo, percepciones en la factura, padrones y régimen de AFIP (CAE/CAEA). Requiere un análisis propio (esquema + reportes `impositivo_*`) y pruebas con datos.
- Otros pendientes del relevamiento: Procesos fiscales y Administración de comprobantes electrónicos (Ventas), Contabilidad (`cont_*`), CRM, Logística y los módulos agro (`en_*`).
