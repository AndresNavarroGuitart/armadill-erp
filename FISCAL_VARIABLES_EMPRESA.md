# Procesos fiscales, comprobantes electrónicos, Archivo > Variables y Archivo > Empresa (2026-10-27)

Fuente: recorrido del cliente administraNET Gestión 4 (base limpia restaurada, usuario Supervisor, sucursal Casa Matriz) + `estructura_default_adm.sql`. **No se guardó nada**: todos los formularios se abrieron y se cancelaron (los de modificación de punto de venta y de permisos se abrieron solo para leerlos). Cierra el relevamiento de los menús que faltaban. Complementa [MAPA_MENUS.md](MAPA_MENUS.md).

## 1. Procesos fiscales (`Gestión > Ventas > Procesos fiscales`)

Pantalla **"Procesos fiscales"**, para **impresora fiscal** (controlador fiscal de ticket / Hasar).
- Al abrir aparece el error interno **"Type mismatch"** (el mismo que se vio en Facturación; el sistema avisa que "guardará un registro en la base de datos"); luego la pantalla abre igual.
- **Datos**: Punto de venta, Sucursal, Impresora Fiscal, **Tipo proceso**, Intervalo (fechas) e **Intervalo / Cierre Z**. La lista de puntos de venta sale **vacía** porque ningún PV tiene impresora fiscal configurada.
- **Tipos de proceso** (lista, se ven los primeros): **Cierre Z diario**, **Cierre X diario**, **Reporte de auditoría por fecha**, **Proceso de liberación del controlador por error**, **Cancelar comprobante fiscal abierto**… (la lista continúa).
- **Estado de controlador fiscal**: **Off Line** (en rojo) y una descripción del error. Botones aceptar / cancelar.
- Depende de **`Archivo > Variables > Generales > Configuración de impresora fiscal`**, de `sucursales.tipo_impresora / nombre_impresora / puerto_impresora` y de `cuentacliente.cierre_z`.
- No se puede probar en este equipo (sin impresora fiscal).

## 2. Administración de comprobantes electrónicos (`Gestión > Ventas > …`)

Al abrirla avisa **"No hay punto de venta con régimen de facturación electrónica"** y no abre: exige al menos un PV con `punto_venta.fe_regimen = 'Si'`. En esta base el único PV (Nro 1) tiene **Factura electrónica WSFEV1: No** y tipo de régimen **CAE** (ver 4), así que la pantalla no se pudo ver. Se infiere del esquema que administra CAE / CAEA, reintentos y consulta de comprobantes electrónicos con AFIP (`fe_datos_caea`, `cuentacliente.fe_*`, `configuracion.fe_*`, `Certificado FE`); sin certificado y sin conexión no se puede probar.

## 3. Archivo > Variables (tablas de parámetros)

Cinco grupos, cada uno con su submenú:

| Grupo | Opciones |
|---|---|
| **Impositivas** | Impuesto; Alícuota IVA; Alícuota ingresos brutos; **Retención** (submenú); **Percepciones** (submenú); **Año y período de vencimiento fiscal** (el calendario fiscal visto en [IMPUESTOS.md](IMPUESTOS.md)) |
| **Administrativas** (15) | **Punto de venta y talonario de cobro**; Talonario; **Condición venta/compra**; **Cotización moneda extranjera**; Gasto; **Descuentos recibo / orden de pago**; Caja; **Tarjeta de crédito / débito / billeteras virtuales**; **Plan de tarjeta…**; **Referencia de movimiento de stock**; Transporte; **Tipo de medio de cobro / pago**; **Medio de cobro / pago**; Ingreso; Deuda |
| **Generales** | **Tipo de cliente**; **País / Provincia / Departamento / Distrito**; **Zona**; **Configuración de impresora fiscal** |
| **Bancarias** | **Gasto bancario**; **Cuenta bancaria y chequera** |
| **Ecommerce** | **Plantilla de característica de artículo** |

Son los ABM de las tablas auxiliares ya vistas en [MODELO_DATOS_CLIENTE_ARTICULO.md](MODELO_DATOS_CLIENTE_ARTICULO.md), [CAJA_Y_BANCOS.md](CAJA_Y_BANCOS.md) e [IMPUESTOS.md](IMPUESTOS.md) (`tipo_cliente`, `cond_venta`, `cotizacion`, `gastos`, `caja_abm`, `tarjetas_credito`, `tc_plan`, `ref_movstock`, `transporte`, `medio_cobpag_*`, `ingreso_abm`, `deuda_abm`, `provincia`/`departamento`/`distrito`, `erp_zona`, `gastosbancarios`, `cuenta_banco`, `chequera`, `ecom_caract_plantilla`…).

### Punto de venta y talonario de cobro
Grilla: Nro, Sucursal, Lista de precio, **Reg Fact Elect**, **Tipo régimen**, Detalle. Comandos: Agregar (F2), Modificar (F3), **Reporte de puntos de venta** (F4). Datos de ejemplo: PV **1**, Casa Matriz, Lista 1, Reg Fact Elect **No**, tipo **CAE**.
**Formulario "Modificar punto de venta / talonario de cobro"** (tabla `punto_venta`): Nro. Punto Venta / Tal. Cobro, Sucursal, Lista de precios, **Factura electrónica WSFEV1** (Sí/No), **Ruta informes de comprobantes** (`C:\administranet\Informes`), **Ruta de certificado AFIP LAN** y **local** (`C:\administranet\Certificado FE`), **Bloquea descuentos al pie**, **Utiliza venta por bulto en punto de venta con activación mayorista** y Detalle. Las rutas son locales de Windows (a reemplazar en una réplica web por almacenamiento de certificados).

## 4. Archivo > Empresa

Opciones: **Datos**, **Sucursal**, **Administrador de usuario**, **Puesto** (submenú: **Permiso en menú** y **Permiso en sistema**) y **Administrador de sesión**.

### Datos de la empresa (`datosempresa`)
Formulario de solo lectura ("Datos de la empresa") con los datos de ejemplo: Denominación "Empresa S.A", País Argentina, Provincia Mendoza, Departamento Godoy Cruz, Domicilio, **Condición IVA** (Responsable Inscripto), CUIT, CP, Teléfono, E-mail, Fax, **Nro. Ingresos Brutos**, **Nro. Establecimiento**, **Inicio de Actividades**, **Sede Timbrado**, WhatsApp, Facebook Messenger, Twitter, URL empresa, **URL ecommerce cliente / vendedor**, **Rubro / Canal** (Venta minorista), **Actividad** (Drugstore / Minimarket / Kioscos) y Observaciones. En la base: `datosempresa` con además `agente_retib / retg / reti / percep` (si es agente de retención), cajas de depósito por defecto, fuente, color y tipo de botón de la interfaz. El menú Comandos está vacío (la modificación está bloqueada para este usuario).

### Administrador de usuario (`usuarios`)
Grilla: Código, Usuario, Nombre, Apellido, **Puesto**, Sucursal, **Vendedor**, Anulado. Datos de ejemplo: **1 Supervisor** (puesto Supervisor, vendedor "Vendedor 1") y **2 test** (puesto Cajas, vendedor "Vendedor 2"). Comandos: **Agregar** (F2), **Modificar** (F3), **Asignación de puntos de venta** (F4), **Asignación de depósitos** (F5), **Asignación de puntos de venta para impresión de reportes** (F6), **Configuración Correo** (F7) y otros.
La tabla guarda por usuario sus **valores por defecto**: punto de venta y de cobranza, depósito, **caja de efectivo, de cheque y de tarjeta**, vendedor (`CodViajante`), tipo de búsqueda (comienza con / finaliza con / incluye), resolución, entrega por defecto ("Retira cliente mostrador"), ruta de reportes y de certificado locales, **`permiso_supervisor_venta`** y `password_usuario` (binario) / `password_temporal`.

### Puestos y permisos (el modelo de seguridad)
- **8 puestos** (`puestos`): **Supervisor, Ventas, Administración, Depósito, Consulta precios, Compras, Cajas, Viajantes**. El usuario pertenece a un puesto (`usuarios.id_puesto`).
- **Permiso en sistema** (`Puesto > Permiso en sistema`): ventana "Permisos en sistema" con la lista de puestos; **Modificar** (F3) abre "Modificar permiso" para el puesto elegido, con **15 pestañas**: Ventas, Compras, Stock, Contabilidad, Funcionalidades, Permisos generales, Logística, Ensamblaje, E-commerce, CRM, **Menú lateral**, **Grillas** y **Reportes**. Cada permiso tiene **código**, **nombre**, **descripción** y **valor**, con búsqueda rápida por nombre o descripción.
- Tipos de valor (`permiso_sistema.tipo_permiso`): **Sí / No**, **Texto** (opciones como "Todos / Movimiento interno E/S / Transferencia / Ajuste"), **Índice** y **Número** (por ejemplo, *límite de descuento al pie* = 25, *límite por renglón* = 0).
- **Catálogo de 216 permisos** (`permiso_sistema`): **Ventas 78**, **Funcionalidades 56**, **Generales 22**, **Compras 21**, **E-commerce 11**, **Stock 9**, **Logística 5**, **Ensamblaje-MPR 4**, **General 4**, **Contabilidad 3**, **CRM 3**. Cada uno con `key_permiso` (clave interna), nombre, detalle, grupo, tipo, valor por defecto y valores posibles.
- Ejemplos observados en el puesto **Cajas** (pestaña Ventas): *Acceso a comprobantes por talonario* (Sí), *Acceso a puntos de venta* (No), *Actualiza ABM cliente* (Sí), *Modifica CV en Cta Cte venta* (No), *Acceso a talonarios de recibos* (Todos), *Acceso a tal. presup/ped/remito* (Sistema), *Utiliza desc/interés en CV* (No), *Permite facturar artículos en cero* (Sí), **Límite descuento por comprobante 25**, **Límite descuento por renglón 0**, *Descuento pie / renglón de factura* (Sí), *Modifica fecha comprobante* (No), *Acceso total lista de precio* (Sí), *Modificación precio venta* (No), *Factura venta: modif. pedido* (Sí). En Logística: *Permite repetir la ruta…*, *NC devolución rutas cerradas*, *Recuerda ruta / bloquea ruta domicilio*, *Aviso sobre pedidos pendientes antes de cerrar ruta*, *Permitir cambiar la ruta en una NC*.
- **Permiso en menú** (`Puesto > Permiso en menú`): habilita o esconde cada opción del menú por puesto; en la base `permisos` (`Clavemenu`, `IDpuesto`, `Permiso`) tiene ~1.900 filas de ejemplo (menú × puesto).

## 5. Cruce con la base

| Concepto | Tabla / columnas |
|---|---|
| Empresa | **`datosempresa`** (+ `datosempresa2`, `datosempresa3`): ver 4 |
| Sucursales | **`sucursales`** (~70 columnas: comprobantes, impresora, vencimientos de pedido / presupuesto, `salida_sin_stock`, `tipo_calculo_precios_impuesto_venta` Incluido / No incluido, `lim_redondeo_tpv`, agente de retención/percepción, `tipo_tpv` Avanzado / Básico, `cot_*` para COT de ARBA, geolocalización, `medios_pago_factura`…) y `sucursales_envios` |
| **Puntos de venta** | **`punto_venta`** (`nro_punto_venta`, `id_sucursal`, `lista_precio_pv`, `fe_regimen` Sí / No, `fe_regimen_tipo` CAE / CAEA, `ruta_reporte_comprobante`, `ruta_certificado`, `ruta_certificado_local`, `bloquea_descuento_pie`, `tpv_venta_x_bulto`, Mercado Pago `activa_mp`/`usa_mp`) y `punto_venta_usr` (qué usuario usa qué PV) |
| Usuarios | **`usuarios`** (ver 4) y `sesion` (`id_usuario`, `id_sucursal`, `IP`, `FechaInicio`, `FechaFin`: es el **administrador de sesión**, quién está conectado) |
| **Puestos y permisos** | **`puestos`** (8), **`permiso_sistema`** (catálogo de 216: `key_permiso`, `nombre_permiso`, `detalle_permiso`, `grupo_permiso`, `tipo_permiso`, `default_permiso`, `detalle_valor_permiso`) y **`permiso_sistema_puesto`** (`id_puesto`, `key_permiso`, `valor_permiso`: **1.728 filas = 216 permisos × 8 puestos**); **`permisos`** (menú por puesto, ~1.900 filas), `menurapido` / `menurapido_conf` / `menurapido_grupo` (menú lateral por puesto) y `conf_grilla_final_puesto` (columnas visibles de las grillas por puesto) |
| **Permisos viejos** | **`permisos_sistema`**: una fila por puesto con ~40 columnas Sí/No (`Mod_Precio_Fact`, `cambia_cv`, `actualiza_abm_art`, `mod_lista_de_precio`, `cambia_deposito`, `cambia_caja`, `cambia_sucursal`, `mod_descuento_pie`…): modelo anterior, probablemente reemplazado por `permiso_sistema_puesto` |
| Parámetros globales | **`configuracion`** (~170 columnas, ver [MODELO_DATOS_CLIENTE_ARTICULO.md](MODELO_DATOS_CLIENTE_ARTICULO.md)): una sola fila |
| Impresora fiscal | configuración en `sucursales` y `configuracion` (`fiscal_monto_*`); cierre Z en `cuentacliente.cierre_z`; tabla de configuración fiscal propia no identificada |

## 6. Reglas de negocio

**Observadas en pantalla**
- La seguridad es **por puesto**, no por usuario: cada usuario hereda los permisos de su puesto. Hay **216 permisos** con valor Sí / No / Texto / Número agrupados por módulo, además de permisos de **menú**, de **menú lateral**, de **grillas** (columnas visibles) y de **reportes**.
- Hay **límites numéricos de descuento** por comprobante y por renglón en el puesto, y un **permiso de supervisor** en el comprobante que los habilita puntualmente.
- Cada usuario tiene **sus cajas, depósito, punto de venta y vendedor por defecto**, y puede tener asignados varios PV y depósitos.
- La factura electrónica se activa **por punto de venta** (WSFEV1, CAE o CAEA), con certificado AFIP; sin PV electrónico no hay administración de comprobantes electrónicos.
- Las pantallas de impresora fiscal requieren un controlador conectado (estado Online / Offline).

**Inferidas de la base (sin probar)**
- El sistema consulta `permiso_sistema_puesto` por `key_permiso` y puesto al abrir cada pantalla; las claves (p. ej. `supervisor_venta_desc_pie`, `acceso_motivo_movstock`) están referenciadas en el código del programa y hay que replicarlas una por una.
- `sesion` impide o registra sesiones simultáneas y alimenta el administrador de sesión.

## 7. Pendiente
- Obtener la **lista completa de los 216 permisos con sus claves y valores por defecto** (están en `permiso_sistema` del dump): conviene volcarla a una hoja para decidir cuáles replicar.
- Probar con un certificado AFIP de homologación y un PV electrónico: CAE / CAEA y la pantalla de administración de comprobantes electrónicos.
- Abrir: **Archivo > Entidades** (Proveedor, Banco, Vendedor, Depósito, Laboratorio), **Archivo > Procesos** (liquidación de comisiones), **Exportación**, **Configuración**, **Herramientas** (importación, mensajería, autorizaciones), y los módulos fuera de Gestión: Contabilidad, CRM, Logística y producción agro.
