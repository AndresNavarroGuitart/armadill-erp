# Maestros Cliente y Artículo — relevamiento de pantallas (2026-10-27)

Fuente: formularios de alta del cliente administraNET Gestión 4 (empresa vacía, valores por defecto del sistema). Nada se guardó. Los campos con `*` son obligatorios (asterisco rojo en pantalla).

Convención de las ventanas: listado con grilla + barra de menús `Archivo | Comandos`; el alta se abre con `Comandos > Agregar` (F2) en una ventana modal con pestañas y botones aceptar (verde) / cancelar (rojo).

---

## 1. Cliente

### Listado (`Archivo > Entidades > Cliente`, Ctrl+C)
- Grilla: Código, Nombre, Tipo, Teléfono, Email, IVA, CUIT/DOC, Saldo. Contador "Total Registros".
- Búsqueda: texto (por código, nombre y CUIT), modo (Normal), tipo de búsqueda (Comienza con…), filtros opcionales por Selección ubicación (provincia), Zona, Depto/Localidad y Vendedor.
- Comandos: Agregar F2, Modificar F3, Visualizar F4, Eliminar F5, Documentación F6, Descarga Constancia AFIP F7, Geolocalización de clientes F8. Archivo: Copiar celda (Ctrl+C), Salir (Esc).

### Alta — 6 pestañas

**General**
- *Datos*: Código Sistema, Ingreso (fecha), Código Manual, Tipo (lista: Común, Distribuidor, Especial, Mayorista, Minorista), Nombre, Nombre fantasía, Sucursal (default Casa Matriz), Observaciones.
- *Domicilio*: Calle, Número `*`, Dpto, País `*` (default Argentina), Provincia `*`, Depart/Localidad `*`, CP, Distrito/Partido, CP, Zona (default Zona 1).
- *Comunicaciones de la empresa*: Teléfono, Fax, E-mail, WhatsApp, Web.
- *Contacto*: Nombre, Teléfono, Celular, E-mail.
- *Interés comercial*: Descuentos Pie `*` y Renglón `*` (default 0), Vendedor `*` (default "-Ninguno-"; hay Vendedor 1 y 2 de ejemplo), Cobrador, Lista de Precios `*` (default "Lista 1 - Contado"), Cond Venta `*` (Contado, Tarjeta, Cheque, Cta/Cte 7, 15, 30, 60, 90 …), Estado (Activo / No Activo).
- *Interés fiscal*: IVA `*` (Consumidor Final, Exento, Exportación, IVA no alcanzado, Monotributista, Responsable Inscripto, Responsable Inscripto CBU, Responsable Inscripto M), Tipo Doc `*` + número (CUIT, DNI, LE, LC, CIE, PAS, NOID, CDI) con botón de consulta AFIP, Nro Ingresos Brutos, Nro Agente Retención.
- *Contabilidad*: Cuenta Contable (default "Deudores por Ventas - 110301", con buscador).

**Crédito**: Cupo de crédito, Límite vencimiento días, Crédito en cheques, Crédito cheques de terceros (todos default 0) + botón "Ver Cta Cte"; panel paralelo de solo lectura "Valores de crédito actuales" con los mismos cuatro conceptos.

**Avisos / CRM**: Texto del aviso, Habilita aviso (No/Sí); CRM: Categoría (lista).

**Ecom - SP - PD**: *Ecommerce administraNET* (Activa E-commerce, Usuario, Contraseña, enviar datos por email); *Programa de fidelización (SP)* (Habilita sistema de puntaje y premios, enviar acceso por email); *Programa de descuentos y voucher (PD)* (Habilita programa, enviar estado de cuenta por email, Saldo de puntos actuales, Impresión de tarjeta de identificación).

**Domicilios** (grilla con alta/edición/baja): Calle, Número, Dpto, Provincia, Localidad, Distrito, Días y horarios.

**Contactos** (grilla con alta/edición/baja): Nombre, Doc, Nro doc., Teléfono, Celular, E-mail, Días y horarios.

---

## 2. Artículo

### Listado (`Archivo > Productos > Artículo`, Ctrl+A)
- Grilla "Artículos y Precios": Cod. Sistema 2, Descripción, P. Costo desc, % Desc, P. Costo, Mon, Alic, PV 1…PV n (lista de precios). Debajo: grilla Stock por depósito, grilla Lote (Lote, Fecha Vto, Stock, Stock bulto) y panel Datos (Mínimo, Máximo, PED Cliente, OC Prov, Disponible, Cant. a pedir).
- Pestañas de búsqueda: Búsqueda rápida (Texto, Tipo búsqueda, Anulado, Lista), Rubro/Sub Rubro, Marca/Modelo, Proveedor, Campos adic.
- Comandos: Agregar F2, Modificar F3, Eliminar F4, Historial de precios F5, Editar información de ecommerce F6, Edición de precios rápida F7, Ver ficha de artículo F8, Ficha de stock F9, Impresión de etiqueta F10, Impresión de etiquetas masivas F12.

### Alta — 4 pestañas superiores + 4 inferiores

**Datos generales**
- *Datos básicos*: Nombre (con buscador), Tipo (Artículo, Servicio, Bienes de uso, Materia prima), Datos de artículo adicionales, Cod. Sist 1, Cod. Sist 2, Cod. Manual, Cod Prov, Rubro, Sub-Rubro, Proveedor, Marca, Modelo, Detalle.
- *Datos impositivos / comerciales / contables*: IVA Venta e IVA Compra (IVA General 21 %, Diferencial 10,5 %, Diferencial 1 27 %, Exento 0 %, No gravado), IIBB (Exento 0 %, Bienes de Cambio 3,5 %, Fabricación 1 %), Impuesto interno (monto fijo / porcentaje; "Impuesto interno 0 %"), Moneda (Pesos), Desc. prov (tabla Nombre / % / Composición; "Genérico" 0), Cont. Venta (default "Ventas - 420101"), Cont. Compra (default "Mercaderías - 110501").

**Datos artículo**
- *Datos globales*: Disp venta, Disp comp, Lote, Serie, Anulado, Comp. interno, Unidad med (default Unidad), Presentación (default Caja), Pres venta (1), Límite de Vta, Peso promedio, Nro. despacho, E-commerce, Ensamblado, Destacado lista. Valores Sí/No.
- *Registro de precios de costo por proveedor* (grilla): Fecha, Proveedor, P. Costo, % Desc, P. Costo Desc, Tipo, P. Final.

**Promociones**: En promoción (Sí/No).

**Campos adicionales**: 10 campos libres rotulables ("Vacío"), uno de ellos desplegable.

**Pestañas inferiores**
- *Definición de precios*: Composición del costo (Costo neto directo, Costo indirecto/adic., Costo dólar (check), Costo neto sin desc., Costo final sin desc., % Desc. renglón, % Bonificación, % Desc. pie, check "Recalcula precio de costo"); Precio de costo bruto (Costo, Final, check "Recalcula precio de venta"); Precio venta con 5 listas: nombre de lista (Contado, Lista, —, —, —), % Marcación (20 y 30 por defecto), Precio Neto, Precio Final.
- *Fotos / Videos*: previsualización de foto/video con botón de carga.
- *Código de Barra*: Tipo de simbología (CODE128) y Código interno; Tipo de simbología y Código proveedor.
- *Integración dispositivos*: Integración con SENASA (Sí/No), Integración con Balanzas (Sí/No).

---

## Observaciones para la réplica
- Los precios se arman en cadena: costo neto directo + indirecto → costo neto/final → % marcación por lista → precio neto → precio final con IVA. Hay dos checks que deciden si un cambio recalcula hacia costo o hacia venta.
- Cliente y artículo apuntan al plan de cuentas (cuentas contables por defecto) y a tablas auxiliares que hay que sembrar: lista de precios, condición de venta, zonas, provincias/localidades, vendedor, cobrador, rubro/sub-rubro/categoría, marca/modelo, unidades de medida, presentaciones, alícuotas IVA/IIBB/interno, descuentos de proveedor.
- Moneda extranjera: el artículo tiene "Costo dólar" y hay una pantalla propia de Cotización de moneda extranjera.
- Los datos de ecommerce y programa de puntos de cliente (Ecom - SP - PD) guardan usuario y contraseña: en la réplica tratarlos con hash, no en texto plano.
- Pendiente verificar con la base: nombres reales de tablas/columnas de estas pantallas contra `Bases\estructura_default_adm.sql`.
