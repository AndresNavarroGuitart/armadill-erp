# Archivo > Entidades, Procesos, Exportación, Configuración y Herramientas (2026-10-27)

Fuente: recorrido del cliente administraNET Gestión 4 (base limpia restaurada, usuario Supervisor, sucursal Casa Matriz) + `estructura_default_adm.sql`. **No se guardó nada**: todos los formularios se abrieron y se cancelaron. Con este documento quedan relevados todos los menús de la barra superior (ver [MAPA_MENUS.md](MAPA_MENUS.md)); lo que sigue sin recorrer son los módulos fuera de Gestión (Contabilidad, CRM, Logística, producción agro), que **están desactivados en esta instalación** (ver 4).

## 1. Archivo > Entidades

Menú: **Cliente** (Ctrl+C), **Proveedor** (Ctrl+P), **Banco** (Ctrl+B), **Vendedor** (Ctrl+V), **Depósito**, **Laboratorio**. Cliente se relevó en [MAESTROS_CLIENTE_ARTICULO.md](MAESTROS_CLIENTE_ARTICULO.md).

### Proveedor
Listado: Código, Nombre, Tipo, Teléfono, Email, IVA, CUIT, **Saldo**; búsqueda por código / nombre / CUIT. **Comandos**: Agregar F2, Modificar F3, Visualizar F4, Eliminar F5, **Documentación F6** y **Descarga Constancia AFIP F7**.
**Alta — 3 pestañas**
- **General**
  - *Datos*: Código Sistema, Código Manual, **Tipo** (**Mercaderías**, **Servicios**, **Profesional**), Denominación, Sucursal, Observaciones.
  - *Domicilio*: Calle, Número, Dpto, País, Provincia, Departamento, Distrito, CP.
  - *Interés Fiscal*: **IVA** (con botón de consulta AFIP), **Nro Clave Tributaria** (CUIT) y **Agente Ret.**, **Nro CAI / Fecha CAI**, **Categoría Ret IIBB** (**Exento**, **Contribuyente Local**, **Monotributista**, **Convenio Multilateral**), **Certificado de no Ret IIBB** (Sí/No + vigencia desde/hasta), **Categoría Ret Ganancias**, **Categoría Ret IVA**, **Cod AFIP Agente Percep** (p. ej. "Compraventa de cosas muebles y locaciones").
  - *Contacto* y *Comunicaciones de la empresa* (teléfono, fax, e-mail, WhatsApp, web).
  - *Interés Comercial*: Descuento %, Crédito, **Estado** (Activo), **Cond Compra** (las mismas condiciones que `cond_venta`: Contado, Tarjeta, Cheque, Cta/Cte 7… ).
  - *Contabilidad*: **Cuenta Contable** (default **Proveedores – 210101**).
- **Contactos**: grilla Nombre, Doc, Nro doc., Teléfono, Celular, E-mail, Días y horarios (alta / edición / baja).
- **Opciones**: **"Obliga a relacionar una OC para generar un remito o factura compra"** (Sí/No, default No) = `proveedor.obliga_oc_carga_comp`.

Tabla: `proveedor` (ver [COMPRAS_Y_PAGOS.md](COMPRAS_Y_PAGOS.md)) y `proveedor_contacto`. Confirma el cruce: `CodCatRet`, `CodCatRetG`, `cod_ret_iva`, `id_cod_afip_percep`, `cert_IIBB`, `NroCAI`, `id_cc`, `id_pc`.

### Banco
Listado precargado de **bancos argentinos** (Código, Nombre, Cód. Bancario; el código 1 es "-Ninguno-"): Banco Bica, Bradesco, CETELEM, CMF, Coinag, Columbia, COMAFI, Credicoop, de Comercio, de Corrientes, de Formosa, de Galicia, de Inversión y Comercio Exterior… Tabla `banco` (con `cod_bcra`, `codigo_bc`).

### Vendedor / Cobrador
Listado: Código, Nombre, **Comisión Cob**, **Comisión Vta** (5 / 5 en los de ejemplo), Anulado. Comandos: Agregar F2, Modificar F3, **Sesiones de caja F4**. **Alta**: Nombre, **% Comisión Vta**, **% Comisión Cob**, Observaciones, **Clave para caja**, **Cobrador** (Sí/No), **Desc renglón E-com**, **Desc pie E-com**, **Acceso todos clientes E-com**, Anulado. Tabla `viajantes` (un vendedor y un cobrador son la misma entidad con el flag `cobrador`).

### Depósito y Laboratorio
- **Depósito**: Código, Depósito, Descripción (solo "Depósito 1"). Tabla `deposito`.
- **Laboratorio**: Código, Laboratorio (solo "Laboratorio 1", código 2). Tabla `laboratorio` (con domicilio y contacto; sirve para el rubro farmacia: se activa en Configuración).

## 2. Archivo > Procesos

- **Anulación de numeración de comprobantes** → ventana **"Anulación de comprobantes por rango"**: **Punto de venta / Talonario**, Fecha, **Tipo Comprobante** (default FA), **Desde** y **Hasta**. Sirve para dar de baja una **tanda de números sin usar** (p. ej. un talonario preimpreso extraviado o saltos de numeración) dejándolos como anulados en el libro.
- **Liquidación de comisiones** → **"Liquidaciones de comisiones Vendedor / Cobrador / Chofer"**: grilla Fecha, Nro Liq, Período desde / hasta, Tipo, Porcentaje, **Canc**, Anulado; búsqueda por vendedor / cobrador / chofer, intervalo y Nro Liq. Comandos: **Agregar liquidación** (F2), **Modificar** (F3), **Imprimir** (F4).
  **Alta**: Nro Liquidación, **Tipo Liquidación** (**Venta**, **Cobranza**, **Chofer**, **Chofer / Zona**, **Cob. Intervalo**) y la persona, Fecha, Período desde / hasta, **Porcentaje**, **Cálculo** (**Neto** o **Bruto**), Cancelado, Anulado.
- **Liquidación de comisiones avanzadas**: no se abrió; por el esquema usa **intervalos escalonados** (ver `viajantes_intervalo_liq`).

Tablas: **`viajantes_liq`** (`periodo_desde/hasta`, `fecha_liq`, `porcentaje_liq`, `tipo_liq` Venta / Cobranza / Chofer / Chofer-Zona-Ruta, `anulado`, `cancelado`, `id_viajante`, `id_chofer`, `tipo_calculo`), `viajantes_intervalo_liq` (`desde/hasta_intervalo_liq`, `porcentaje_intervalo_liq`, `tipo_intervalo_liq` Días / Monto cobrado), `viajante_comprobante` (comprobantes incluidos) y la tabla vieja `liquidacion_viajante` (`CodViajante`, `FDesde`, `FHasta`, `Importe`, `Estado`). Las comisiones se calculan sobre las ventas o cobranzas del período del vendedor (`cuentacliente.CodViajante`, `Liquidado`).

## 3. Archivo > Exportación

**Exportación a sistemas externos**: lista de exportaciones + intervalo (default 01/01 a hoy). Opciones: **ATM Ret. IIBB Mendoza**, **ATM Percep. IIBB Mendoza** (rentas de Mendoza), **SIAP SI.CO.RE** (retenciones de AFIP), **SIAP RG 3685** (libro de IVA digital de compras y ventas), **SIAP SI.FE.RE Retenciones**, **SIAP SI.FE.RE Percepciones**, **SIAP IVA Retenciones/Percepciones** y **Web service SENASA**. Son los **archivos de presentación fiscal** que se arman desde retenciones, percepciones y libros de IVA (ver [IMPUESTOS.md](IMPUESTOS.md)). Son requisitos legales argentinos que una réplica tendría que mantener al día.

## 4. Archivo > Configuración

Ventana **"Configuracion"** (tabla `configuracion`, una fila), 5 pestañas:

- **General**
  - *Listas de precios* (5): **% de marcación** y **descripción** (Lista 1 "Contado" 20 %, Lista 2 "Lista" 30 %, 3 a 5 sin usar); **Decimales** (4).
  - *Opciones fiscales – AFIP*: **monto máximo tiquet factura (FA o FB)**: 100000; **monto máximo CF sin nominar (FB)**: 10466 y **(FC)**: 10466; **Resolución AFIP 5003** (Sí) con su texto legal.
  - *Factura electrónica – AFIP*: **URL Login** (`https://wsaa.afip.gov.ar/ws/services/LoginCms`) y **URL Server** (`https://servicios1.afip.gov.ar/wsfev1/service.asmx`): son los de **producción**, mientras que el dump trae los de **homologación**; **tipo de conexión a Padrón de AFIP**: **SOAP** (el dump dice REST); **tipo de transferencia FCE**: SCA; **límite facturación mensual CAEA**: 20 %. → La base viva **difiere del dump**: la configuración se modificó en este equipo.
  - *Opciones generales*: botón de configuración adicional (logos, conexión a servidores externos con sucursales, mayorista, venta por peso, códigos de barra); botones **Ver Log Errores** y **Cerrar 6 conexiones** (muestra las conexiones MySQL abiertas).
- **Impresoras**: **Punto de venta**, Sucursal, **Tipo impresora** (Ventana…), Impresora, Tipo de hoja, Orientación y la grilla **Configuración de reportes de comprobantes**: por comprobante (FA, FB, FC, FE, FM, NCA…) el tipo de impresión (Normal), impresora (Ventana), **copias** (2), **puerto** (LPT1:), **baudios**, **conexión de impresora fiscal** (Puerto serie), **IP de impresora fiscal** y **hoja** (A4).
- **Sucursal**: Vendedor por defecto, **Límite de consultas** (300), **rutas de informes** (servidor y comprobantes), **Cantidad de renglones** (100), **Salida sin existencia** (Sí), **Días venc. presupuesto** (7), **Días venc. pedidos** (7), **Impuestos en precio de venta** (Incluido), **Límite redondeo TPV** (1,5); **impresora de etiquetas** (tipo, impresora, puerto, doble etiqueta); **Agente de percepción / retención** (Ing. Brutos, Ganancias, IVA, Percepciones, Percep RG AFIP 5329/2023: todos No); **Opciones fiscales de DNF** (DNF en factura de venta, tipo AFIP 910, tres textos libres). Es el formulario de `sucursales` (ver [FISCAL_VARIABLES_EMPRESA.md](FISCAL_VARIABLES_EMPRESA.md)).
- **Activaciones** (todas en **No** en esta base): **Laboratorio**; **Contabilidad** (+ *Fecha Compras en Contabilidad*: Comprobante / Registro); **Proyecto** (+ Nro de Proyecto actual: 1); **Logística**; **Ensamblaje venta**; **Reglas de precio**; **Sistema de puntaje y premios** (nombre, "imprime puntaje en comprobantes": Sí); **Programa de descuentos y voucher** (nombre, texto de cuerpo y pie del mensaje).
- **Plantillas**: **Tipo plantilla** (Presupuesto…) y grilla Nombre / Ruta reporte / Tipo (vacía): plantillas de impresión de presupuestos (`id_plantilla` en `comp_ped`).

**Hallazgo clave:** los módulos **Contabilidad, Logística, Proyecto, Ensamblaje, Reglas de precio, Puntaje y Programa de descuentos están apagados** en esta instalación (`configuracion.activ_*`). Por eso sus tablas (`cont_*`, `logi_*`, `en_*`, `sp_*`, `reglas_precio*`) existen pero no aparecen en el menú: **un producto de réplica puede dejarlos fuera del primer alcance** sin perder funcionalidad que este cliente use hoy. También confirma que se trata de una **configuración "comercio minorista"** (rubro "Venta minorista", actividad "Drugstore / Minimarket / Kioscos").

## 5. Herramientas

Menú: **Importación de datos**, **Log de errores**, **Calculadora**, **Mensajería**, **E-mail log**, **Cerrar / Minimizar / Mostrar ventanas**, **Autorización de pedidos** (Shift+A) y **Autorización de órdenes de compra** (Shift+O).

- **Importación de datos** (clave para migrar): muestra Empresa (*Andres Navarro*) y Base (*administranet*). **Generador de plantillas** (Modelo de plantilla: **Maestro Cliente/Proveedor**, **Maestro Artículo**, **Plantilla Cliente Simple / Simple Modificar / Avanzada / Avanzada Modificar**, **Plantilla Proveedor Simple / Simple Modificar**… + Filtros + Destino) para descargar una plantilla de Excel, y **Importación**: **Tipo** (**Simple**, **Avanzada**, **Lince-Externo**), **Acción** (**Nuevos**, **Actualizar**, **Reestablecer**) y **Proceso a importar** (**Rubro, SubRubro, Marca, Modelo, Proveedor, Artículo, Cliente, Saldos iniciales de clientes**… la lista sigue); se elige el archivo plantilla, **Procesa archivo** y **Generar importación**. Menú *Descargas* (plantillas). Reemplaza un ETL manual para cargar maestros y saldos iniciales.
- **Log de errores**: grilla Fecha, Detalle, **Ventana**, Usuario, con intervalo y búsqueda por detalle o ventana; Archivo > exporta la consulta a Excel (el clic en "Archivo" lo dispara directo; respondí No). Hay **3 errores registrados**, todos **"Type mismatch"**: dos en *Factura B – Clientes* (16:51, la primera vez que se abrió Facturación a Consumidor Final) y uno en *Procesos fiscales* (20:25). Sin errores en el TPV, aunque también factura. El patrón sugiere que el error sale de **código del circuito fiscal / impresión**, no del cálculo de comprobantes. Tabla `error`.
- **Autorización de pedidos** (Shift+A): es la consulta de comprobantes de Ventas **prefiltrada**: Comprobante **PED**, Campo **Autorización**, Datos "n" (no autorizados), con las columnas **Autorización**, **Tipo pedido**, **Autorizado por**. Confirma `comp_ped.autorizacion_sistema`, `autorizacion_web` e `idUsuarioAut`. La de órdenes de compra (Shift+O) hace lo mismo sobre OC.
- **Mensajería** y **E-mail log**: por el esquema, `mensajeria` (mensajes entre usuarios) y `correo_log_envio`, `correo_adjunto`, `correo_usr` (cola y registro de correos salientes, con `Configuración Correo` por usuario). No se abrieron.

## 6. Cruce con la base (nuevo en este documento)

| Concepto | Tabla / columnas |
|---|---|
| Configuración global | `configuracion` (ver [MODELO_DATOS_CLIENTE_ARTICULO.md](MODELO_DATOS_CLIENTE_ARTICULO.md)): `valor_util1..5`, `desc_util1..5`, `Decimales`, `fiscal_monto_*`, `fe_url_login`, `fe_url_acceso_servidor`, `padron_afip`, `transf_FCE`, `fe_caea_limite_facturacion`, `resol_afip_5003`, `activ_laboratorio / contabilidad / proyecto / logistica / ensamblaje_venta / reglas_precios / sp / pd / ml` |
| Comisiones | `viajantes_liq`, `viajantes_intervalo_liq`, `viajante_comprobante`, `liquidacion_viajante` y `comp_liquidacion` |
| Transporte | `transporte` (`nombre_transporte`, teléfono, e-mail, domicilio) |
| Errores / mensajes / correo | `error`, `mensajeria`, `correo_log_envio`, `correo_adjunto`, `correo_usr` |
| Plantillas de reporte | `reporte_plantilla`, `reporte_usuario` |
| Importación | no hay tablas propias: lee archivos Excel/CSV y escribe directo en los maestros (`rubro`, `subrubro`, `marca`, `modelo`, `proveedor`, `articulo`, `cliente`, saldos iniciales como filas de `cuentacliente`) |

## 7. Reglas de negocio

**Observadas en pantalla**
- Los **módulos opcionales se activan por interruptores** (Contabilidad, Logística, etc.) y todos están apagados aquí.
- Las **comisiones** se liquidan por período y por persona, con cálculo sobre neto o bruto, y tipos Venta, Cobranza, Chofer, Chofer / Zona y Cobranza por intervalo.
- Una **numeración se puede anular por rango** sin crear comprobantes.
- El proveedor puede **obligar a vincular una orden de compra** a sus remitos y facturas.
- La importación masiva distingue **crear, actualizar y reestablecer**, con plantillas simples o avanzadas.
- La configuración de **impresión es por comprobante** (copias, puerto, impresora fiscal, hoja).

**Inferidas de la base (sin probar)**
- Los archivos de **exportación SIAP / ATM** se arman con los datos de `retenciones*`, `percepcion*`, `percep_cli*` y los libros de IVA en el período elegido.
- Una liquidación marca los comprobantes incluidos (`cuentacliente.Liquidado`) para no liquidarlos dos veces.

## 8. Pendiente
- **Volcar los 216 permisos y los parámetros de `configuracion`** a una hoja para decidir cuáles replicar.
- Probar con datos: facturación electrónica con certificado de homologación, liquidación de comisiones, exportación SIAP y una **importación de prueba** (plantilla de artículos y de saldos iniciales de clientes) sobre una copia.
- Abrir *Mensajería*, *E-mail log*, *Autorización de órdenes de compra*, *Liquidación de comisiones avanzadas* y *Archivo > Entidades > Cliente* con datos.
- **Módulos fuera de Gestión** (Contabilidad, CRM, Logística, producción agro): están desactivados aquí, así que habría que activarlos en una copia para relevarlos.
