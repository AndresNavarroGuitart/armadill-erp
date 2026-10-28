# Plan de réplica de administraNET Gestión 4 (2026-10-27)

Base: relevamiento de pantallas del cliente + esquema SQL + dos pruebas reales (artículo y factura de TPV) documentados en esta carpeta (15 documentos, ~20.000 palabras). Todo lo que sigue es una **propuesta para decidir**, no un compromiso: los plazos son estimaciones gruesas y las decisiones abiertas están en la sección 9.

## 1. Resumen

- **Qué es el sistema:** un ERP comercial argentino (ventas, compras, stock, caja, bancos, cobranzas y pagos, impuestos) sobre **MySQL 5.7 con 389 tablas**, cliente de escritorio VB6 y **1.068 informes Crystal**. No hay código fuente; sí hay esquema, datos de ejemplo y el programa funcionando.
- **Cuánto hay que replicar de verdad:** menos de lo que parece. En esta instalación **Contabilidad, Logística, Proyecto, Ensamblaje, Reglas de precio, Puntaje y Programa de descuentos están apagados**, y es una configuración de **comercio minorista**. Eso deja un núcleo de unas 80 tablas con uso real.
- **Estrategia recomendada:** **reemplazo gradual sobre la misma base MySQL** (patrón "strangler"). La aplicación nueva lee y escribe las mismas tablas, un documento a la vez, mientras el programa viejo sigue funcionando para lo que aún no se migró. Evita una migración de datos de un solo golpe y permite volver atrás.
- **Primer alcance (MVP):** en dos cortes. **MVP-0** solo lectura (consultas, ficha de stock, cuenta corriente, 20 informes clave) y **MVP-1** escritura del circuito comercial **sin emisión fiscal** (maestros, presupuesto, pedido, remito, TPV con comprobante interno, cobranzas, caja, stock). La **factura electrónica AFIP** queda para la Fase 3 y mientras tanto la sigue emitiendo el programa viejo.
- **Los tres riesgos más serios:** (1) **fiscal y legal** (factura electrónica, retenciones, percepciones, libros de IVA); (2) **escribir en una base compartida sin ver el código del programa viejo** (contadores, saldos cacheados, reglas que solo existen en VB6); (3) **licencia y propiedad intelectual** del producto original. Ver sección 8.
- **Lo que falta antes de empezar a construir:** credenciales de MySQL, saber **qué empresa y qué datos reales** se van a migrar, y confirmar cuáles módulos usa de verdad el usuario final (sección 9).

## 2. Qué se relevó y con qué límites

| Área | Cobertura | Límite |
|---|---|---|
| Maestros (cliente, artículo, proveedor, banco, vendedor, depósito) | pantallas y campos completos, cruce con tablas | datos de ejemplo, no reales |
| Ventas (presupuesto, pedido, factura, TPV, NC/ND, cuenta corriente) | todas las pantallas; **factura TPV probada con datos** | NC/ND, factura normal y cobranza **no** probadas con datos |
| Compras y pagos | pantallas completas | **nunca emitido** un comprobante |
| Stock | pantallas completas | sin movimientos reales, un solo depósito |
| Caja y bancos | pantallas completas | cierre con arqueo y conciliación sin datos |
| Impuestos | pantalla de presentaciones y calendario fiscal | el cálculo de IVA, retenciones y percepciones **no** se vio funcionar |
| Seguridad | 8 puestos, 216 permisos, menú, grillas | claves de permiso referenciadas en código no visible |
| Fiscal electrónico, impresora fiscal | solo se confirmó que **no abren** | requiere certificado AFIP y hardware |
| Contabilidad, CRM, Logística, agro | **no relevados** | desactivados; habría que activarlos en una copia |
| Informes | solo se contó y nombró (1.068 `.rpt`) | no se leyó su contenido |

La base viva **no se pudo consultar** (se desconocen las credenciales de MySQL; las credenciales de la aplicación no sirven para MySQL): todo el cruce sale del dump de estructura y de comparar archivos de datos antes y después de una venta.

## 3. Principios de diseño

1. **Compatibilidad primero.** Mientras convivan los dos sistemas, la aplicación nueva escribe **exactamente** lo que escribe la vieja (mismas tablas, mismos valores, mismos contadores). Una factura de TPV toca 9 tablas (`cuentacliente`, `stock`, `stock_deposito`, `caja`, `caja_saldo`, `talonarios`, `codmov`, `resumen_venta_cv`, `cliente_datos_adicionales`); la réplica debe hacer lo mismo en **una sola transacción**.
2. **Un dueño por tipo de documento.** En cada momento cada tipo de comprobante lo emite **un solo** sistema. Se traspasa de a uno (por ejemplo, recibos pasan a la nueva y las facturas siguen en la vieja).
3. **No copiar los defectos del modelo, encapsularlos.** El esquema tiene booleanos `'Si'/'No'`, claves de tipos mezclados (`int`, `bigint`, `double`), casi ninguna clave foránea, importes en `double` y tablas `*_temp` de borrador. La capa de acceso a datos traduce eso a un modelo limpio y la aplicación nunca ve los textos `'Si'/'No'`.
4. **Lo fiscal se aísla.** AFIP, impresoras fiscales, retenciones y libros de IVA van en un módulo propio, con pruebas contra casos reales, no mezclado con el circuito comercial.
5. **Cada módulo se cierra con una prueba de paridad:** la misma operación hecha en el programa viejo y en el nuevo sobre dos copias de la base debe dejar **filas equivalentes**.
6. **Copia y restauración antes de cualquier prueba que escriba** (ya existe el procedimiento: `backup_en_frio.ps1` y `restaurar_copia.ps1`).

## 4. Arquitectura propuesta

- **Datos:** la misma **MySQL 5.7** al principio. A mediano plazo, migrar a MySQL 8 o PostgreSQL cuando la aplicación vieja ya no escriba.
- **API:** servicio **TypeScript (Node)** con acceso a datos generado por *introspección* del esquema existente y una capa de dominio encima (los "repositorios" son los que absorben las rarezas del modelo). Transacciones explícitas y asignación de `CodigoMovimiento` con bloqueo.
- **Web:** aplicación web (React) para uso en mostrador y administración, responsive. Es el mismo conjunto de herramientas que ya usás en otros proyectos del repositorio, lo que reduce el costo de mantener todo.
- **Informes:** reemplazar Crystal por informes web con exportación a Excel/PDF, empezando por los más usados. No se reutilizan los `.rpt` (propiedad del fabricante).
- **Seguridad:** autenticación y permisos **propios** (puestos + permisos con la misma semántica: Sí/No, texto, número, límites de descuento). No se reutiliza `usuarios.password_usuario` (binario de algoritmo desconocido); se migran usuarios con contraseña nueva.
- **Fiscal:** servicio aparte que habla con AFIP (WSAA/WSFEv1) con certificado en un almacén seguro, no en `C:\...\Certificado FE`. Impresora fiscal: puente local solo si hace falta.
- **Observabilidad:** registro de errores por pantalla (equivale al "Log de errores") y auditoría de cada escritura con usuario y comprobante.

## 5. Inventario de módulos, prioridad y complejidad

Escala: **Complejidad** B/M/A (baja, media, alta) por cantidad de reglas y tablas; **Riesgo** por impacto legal o de datos. Las fases están en la sección 7.

| # | Módulo | Núcleo de tablas | Complejidad | Riesgo | Prioridad | Fase |
|---|---|---|---|---|---|---|
| 1 | **Seguridad**: usuarios, puestos, permisos (216), menú, grillas | `usuarios`, `puestos`, `permiso_sistema(_puesto)`, `permisos`, `sesion` | M | M | Imprescindible | 0 / 1 |
| 2 | **Parámetros y catálogos** (condición de venta, IVA, provincias, zonas, listas de precio, unidades, depósitos, cajas, bancos) | `configuracion`, `cond_venta`, `iva`, `provincia`…, `caja_abm` | B | B | Imprescindible | 0 |
| 3 | **Maestro de clientes** | `cliente`, `_domicilio`, `_contacto`, `tipo_cliente`, `contribuyentes` | M | B | Imprescindible | 1 |
| 4 | **Maestro de artículos y precios** | `articulo` (~140 col.), `precios_historial`, `articulo_*`, `rubro`, `marca`… | **A** | M | Imprescindible | 1 |
| 5 | **Stock** (ficha, movimientos, inventario, remitos) | `stock`, `stock_deposito`, `movimiento_stock`, `inventario`, `lote*` | A | M | Imprescindible | 0 (consulta) / 1 |
| 6 | **Ventas operativas** (presupuesto, pedido, remito) | `comp_ped`, `cuerpostockp`, `stockp`, `cuentacliente` | M | M | Alta | 1 |
| 7 | **TPV / venta de mostrador** | las 9 tablas de la venta | A | **Alto** | Alta | 1 (interno) / 3 (fiscal) |
| 8 | **Cuenta corriente y cobranzas** (recibos, imputación, cheques, tarjetas) | `cuentacliente` (~115 col.), `imputacion`, `recibo_factura`, `chequetercero`, `retenciones` | A | **Alto** | Alta | 1 / 2 |
| 9 | **Caja** (libro, transferencias, cierre, arqueo) | `caja`, `caja_saldo`, `caja_cierre`, `caja_arqueo` | M | M | Alta | 1 |
| 10 | **Notas de crédito/débito** | `cuentacliente`, `nc_dev`, `nc_concepto` | A | **Alto** | Alta | 2 |
| 11 | **Facturación electrónica AFIP** (CAE/CAEA, tipos A/B/C/E/M) | `punto_venta`, `talonarios`, `cuentacliente.fe_*` | A | **Crítico** | Imprescindible para emitir | 3 |
| 12 | **Compras** (presupuesto, OC, remito, factura de compra) | `cuentaproveedor`, `proveedor`, `comp_ped` | A | M | Media | 4 |
| 13 | **Pagos** (orden de pago, cheques propios, retenciones a proveedores) | `cuentaproveedor`, `chequepropio`, `retenciones_prov*` | A | **Alto** | Media | 4 |
| 14 | **Bancos** (libro, depósitos, conciliación, cheques de terceros) | `librobanco`, `boletadeposito`, `cuenta_banco` | M | M | Media | 5 |
| 15 | **Impuestos y presentaciones** (IVA, IIBB, Ganancias, calendario fiscal) | `impuesto`, `impuesto_detalle`, `periodos`, `percepcion*` | A | **Alto** | Media | 5 |
| 16 | **Exportaciones fiscales** (SIAP SI.CO.RE, RG 3685, SI.FE.RE, ATM Mendoza, SENASA) | retenciones, percepciones, libros de IVA | A | **Alto** | Media | 5 |
| 17 | **Informes** (1.068 `.rpt`; ver priorización en 7) | todas | A por volumen | B | Alta (por tandas) | 0 en adelante |
| 18 | **Importación de datos** | maestros y saldos iniciales | B | M | Alta para migrar | 1 |
| 19 | **Comisiones** (liquidación, intervalos) | `viajantes_liq`, `_intervalo_liq` | M | B | Baja | 6 |
| 20 | **Impresora fiscal / procesos fiscales** | configuración, cierres Z | M | M | Solo si el cliente la usa | opcional |
| 21 | **Ecommerce, Mercado Libre, puntaje, descuentos y voucher, logística, ensamblaje, contabilidad, CRM, agro** | `ecom_*`, `ml_*`, `sp_*`, `logi_*`, `cont_*`, `crm_*`, `en_*` | A | M | **Fuera del alcance inicial** (apagados) | 7+ |

## 6. Primer alcance (MVP)

**Objetivo:** que una caja y una oficina de un comercio minorista puedan **consultar, vender, cobrar y controlar caja y stock** con la aplicación nueva, **sobre la misma base**, sin emitir facturas fiscales (esas siguen en el programa viejo).

### MVP-0: solo lectura (valor rápido y casi sin riesgo)
- Login y permisos de **lectura** por puesto.
- Consultas: clientes, artículos y precios por lista, **ficha de stock** (saldo, lotes, historial), **cuenta corriente de clientes y proveedores**, comprobantes (ventas, compras, recibos) con búsqueda por número, cliente y fecha.
- Caja: libro y saldo por caja y usuario.
- **20 informes** de mayor uso (ventas por período, por artículo, por cliente, cuenta corriente, facturas a cobrar, saldo de clientes, stock, caja del día, libro de IVA ventas y compras como consulta).
- **Criterio de aceptación:** todos los saldos y totales coinciden con los del programa viejo sobre la misma copia, al centavo, en una muestra de al menos 50 casos.

### MVP-1: escritura del circuito comercial, sin emisión fiscal
- **Alta y modificación** de clientes, artículos (con la cadena de precios: costo → marcación → neto → final con IVA), proveedores, rubros, marcas.
- **Presupuesto, pedido y remito de venta** (con vencimientos según la sucursal y reserva de stock).
- **TPV con comprobante interno**: renglones, cobro en efectivo con vuelto y redondeo, y la misma escritura en las 9 tablas; **sin CAE**. La factura legal se sigue emitiendo con el programa viejo.
- **Cobranzas**: recibo a cuenta y por imputación, descuentos, retenciones sufridas, efectivo y cheques de terceros.
- **Caja**: movimientos, transferencias entre cajas, **cierre con diferencia** y arqueo por denominación.
- **Stock**: movimientos (inicial, ajuste, faltante, sobrante, rotura, transferencia), **inventario** con diferencia.
- **Permisos de escritura** por puesto y **límites de descuento**.
- **Importación** de maestros y saldos iniciales desde Excel.
- **Criterio de aceptación:** **prueba de paridad** por cada operación (misma operación en ambos sistemas sobre copias idénticas → mismas filas), cierre de caja que cuadra, y una semana de uso paralelo sin diferencias de saldo.

### Fuera del MVP (decisión explícita)
Factura electrónica y notas de crédito/débito fiscales, compras y pagos, bancos y conciliación, impuestos, exportaciones fiscales, comisiones, impresora fiscal, ecommerce, y todos los módulos apagados.

## 7. Hoja de ruta por fases (estimaciones gruesas)

Supuestos: una persona desarrolladora con asistencia de IA, dedicación completa, acceso a una copia de la base y a alguien del negocio para validar. Los rangos son de **baja confianza** hasta resolver la sección 9.

| Fase | Contenido | Estimación | Salida |
|---|---|---|---|
| **0. Cimientos y solo lectura** | Acceso a datos por introspección, autenticación y permisos de lectura, catálogos, consultas, ficha de stock, cuenta corriente, 20 informes (**MVP-0**) | 4–6 semanas | Panel de consulta que reemplaza abrir el programa viejo para mirar |
| **1. Circuito comercial sin fiscal** | Maestros, presupuesto, pedido, remito, TPV interno, cobranzas, caja, stock, importación (**MVP-1**) | 12–18 semanas | La caja y la oficina operan con la nueva |
| **2. Notas de crédito/débito y cuenta corriente completa** | NC por devolución, concepto, a cuenta, anulaciones; ND; imputación y desimputación | 5–8 semanas | Circuito de devoluciones y ajustes |
| **3. Facturación electrónica** | WSAA/WSFEv1, CAE y CAEA, tipos A/B/C/E/M, numeración, impresión legal, homologación y producción; opcional impresora fiscal | 6–10 semanas | La nueva emite facturas legales; se apaga la emisión en la vieja |
| **4. Compras y pagos** | Presupuesto, OC, remito y factura de compra; orden de pago con retenciones; cheques propios y chequeras | 8–12 semanas | Circuito de proveedores |
| **5. Bancos, impuestos y exportaciones** | Libro banco, depósitos, conciliación; presentaciones; SIAP y ATM Mendoza | 8–14 semanas | Cierre mensual impositivo |
| **6. Comisiones y resto de informes** | Liquidación, informes por tandas | continuo | Paridad total de reportes |
| **7+. Módulos apagados** | Solo si algún cliente los activa | a definir | — |

**Total orientativo a reemplazo completo del núcleo: 9 a 14 meses.** El **MVP-0 se usa a las 4–6 semanas** y el **MVP-1 a los 4–6 meses**.

### Priorización de informes (Fase 0 en adelante)
Contados por prefijo: **ventas 155**, **cobranza 46**, **stock 123**, **caja 10**, **banco 16**, **impositivo 17**, más compras, pagos, comercial, crm, logística y otros. Orden propuesto: (1) los que un dueño mira a diario (ventas del día y del mes, caja, stock bajo mínimo, saldos de clientes y proveedores); (2) los de cobranza y compras; (3) los impositivos (libros de IVA, percepciones, retenciones); (4) el resto bajo demanda. **Medir el uso real antes de replicar**: es probable que 90 % de los informes casi no se usen.

## 8. Riesgos principales

| # | Riesgo | Impacto | Probabilidad | Mitigación |
|---|---|---|---|---|
| 1 | **Fiscal:** errores en factura electrónica, retenciones, percepciones o libros de IVA tienen consecuencias legales y económicas | Crítico | Media | Aislar el módulo fiscal; homologación AFIP antes de producción; contador que valide casos; **no apagar la emisión vieja hasta una etapa de uso paralelo**; las resoluciones cambian (hay un aviso en pantalla de "actualizar antes del 15/04/2025 por ARCA RG 5.616") |
| 2 | **Base compartida con código que no vemos:** reglas ocultas en VB6, contadores (`codmov`), saldos cacheados (`cliente.saldo`, `stock_deposito.saldo`, `caja_saldo`), claves de permiso, triggers | Alto | Alta | Pruebas de paridad por operación; transacciones que repliquen la escritura observada; **un dueño por documento**; empezar por solo lectura; auditoría de diferencias diaria |
| 3 | **Licencia y propiedad intelectual:** términos del contrato con el fabricante, uso de su esquema, informes y marca | Alto | A verificar | **Revisar el contrato y la licencia antes de construir.** No reutilizar binarios, informes `.rpt`, imágenes ni textos del fabricante. Desarrollar sobre los datos del propio cliente y sobre comportamiento observado |
| 4 | **Sin acceso a la base viva:** el dump es estructura y semilla; no se leyó ninguna fila real | Alto | Cierta hasta resolver | Obtener credenciales de MySQL, o una copia de la base **real** del cliente (anonimizada si hace falta) |
| 5 | **Datos sensibles:** `clientes_web.clave_usuario` (algoritmo desconocido), `usuarios.password_usuario`, certificados AFIP, datos de clientes | Alto | Media | No copiar secretos a desarrollo; contraseñas nuevas en la migración; certificados en un almacén de secretos; ambiente de desarrollo con datos anonimizados |
| 6 | **Calidad del modelo de datos:** tipos de clave mezclados, sin claves foráneas, importes en `double`, flags en texto, tablas temporales | Medio | Cierta | Capa de acceso que normaliza; validar integridad con consultas de control antes de escribir; decidir el cambio de modelo recién al apagar el sistema viejo |
| 7 | **Errores del programa viejo que se arrastran:** el error "Type mismatch" en ventanas fiscales; stock negativo permitido; el costo no se persiste igual que en los datos de ejemplo | Medio | Media | Registrar cada comportamiento dudoso como decisión: replicar, corregir o bloquear |
| 8 | **Alcance que se expande:** 389 tablas, 1.068 informes, módulos apagados | Alto | Alta | Congelar el alcance por fase; backlog explícito de "no ahora"; medir uso real |
| 9 | **Cambio operativo del usuario:** cajeros acostumbrados a atajos de teclado (F2–F12, Esc = salir) y a lector de código de barras | Medio | Alta | Mantener atajos y flujo de pantalla de mostrador; capacitación; período en paralelo |
| 10 | **Hardware y entorno:** impresora fiscal, balanza, impresión de tickets, lector, funcionamiento sin internet | Medio | Media | Definir desde el inicio qué hardware existe; modo sin conexión para el TPV si el local lo necesita |
| 11 | **Concurrencia:** dos sistemas escribiendo la misma base (cierres de caja, numeración, saldos) | Alto | Media | Bloqueos explícitos en contadores; ventanas de operación acordadas; ver principio 2 |
| 12 | **Mantenimiento a largo plazo:** una persona que depende de conocimiento tácito | Medio | Media | Documentación (ya hay 15 documentos), pruebas automáticas de paridad, código abierto a quien lo mantenga |

## 9. Decisiones y datos que hacen falta de Andrés (antes de construir)

1. **¿Para quién es la réplica?** ¿Un cliente concreto (cuál, con qué volumen y cuántos puestos), un producto para vender, o uso propio? Cambia todo: multiempresa, soporte, licenciamiento.
2. **Base real.** La base de esta máquina es la **semilla de ejemplo** ("Empresa S.A", Cliente 1, Proveedor 1). ¿Existe una base con datos reales? Sin ella no se puede validar la paridad ni medir qué se usa.
3. **Credenciales de MySQL** (o una copia real con usuario de solo lectura) para leer filas y no solo estructura.
4. **Contrato y licencia de administraNET.** ¿Qué permite y qué prohíbe sobre replicar funciones, usar el esquema o migrar los datos a otro sistema? Conviene consultarlo con quien tenga el contrato antes de invertir.
5. **Qué módulos usa el cliente de verdad.** Hoy están apagados los avanzados y el rubro es kiosco/minimarket; ¿es el perfil real? ¿Usa **impresora fiscal** o **factura electrónica** (el único punto de venta tiene WSFEV1 en "No")?
6. **Plazo y presupuesto.** ¿Hay fecha límite o evento que obligue (fin del soporte, cambio de equipos, nueva versión 4.0 del fabricante)?
7. **Hardware y conectividad** del punto de venta (balanza, lector, impresoras, internet).
8. **Asesor contable/impositivo** para validar los cálculos de IVA, retenciones, percepciones y las presentaciones.
9. **Alternativa a construir:** evaluar si **adoptar un ERP existente** (Odoo ya figura en los materiales del repositorio) con los datos migrados resulta más barato que replicar. Vale compararlo con esta hoja de ruta; el módulo de importación y los documentos de relevamiento sirven para ambas rutas.

## 10. Próximos pasos inmediatos (sin construir todavía)

1. **Resolver la sección 9, puntos 1 a 4.** Son los que más cambian el plan.
2. **Volcar los 216 permisos y los parámetros de `configuracion`** a una hoja (están en el dump) y marcar cuáles aplican.
3. **Probar con datos, sobre una copia** (con el ciclo copia → prueba → restauración ya armado): factura normal, nota de crédito (efectivo y crédito), recibo por imputación, compra y orden de pago, movimiento de stock con segundo depósito, cierre de caja con arqueo. Es lo que más reduce la incertidumbre del plan.
4. **Medir el uso real** (si hay base real): cantidad de comprobantes por tipo y por mes, usuarios activos, informes ejecutados.
5. **Decidir la ruta:** construir (este plan), adoptar un ERP existente, o híbrido (la nueva para consultas e informes y el programa viejo para emitir).
6. Recién entonces, **empezar la Fase 0** con una prueba de concepto: conectar a una copia, mostrar la cuenta corriente de un cliente y compararla con el programa viejo.

## Anexo A. Reglas del sistema que la réplica debe respetar (observadas)

- **Cadena de precios del artículo:** costo → % de marcación por lista → precio neto → precio final con IVA (120 → 145,2 con IVA 21 %), con dos casilleros ("recalcula precio de costo / de venta") que deciden en qué sentido se recalcula.
- **Una venta de TPV** de 2 unidades a 145,20 con 300 cobrados dejó total 290,40, cambio 9,60, saldo 0, estado "Canc" (cancelado = cobrado), código de movimiento 2 (el contador arrancaba en 1) y **stock −2** (se puede vender sin existencia por parámetro).
- **Vencimientos:** pedido y presupuesto = hoy + días de la sucursal (7); orden de compra = hoy + días de la condición; la factura de compra mostró un vencimiento que no coincide (pendiente de aclarar).
- **Descuentos:** límites por puesto (por comprobante y por renglón) y permiso de supervisor por comprobante.
- **Numeración:** por tipo de comprobante, punto de venta y sucursal (`talonarios`), con rango y vencimiento de CAI; anulación por rango.
- **Cajas:** dos niveles (punto de venta y rendición); el cierre transfiere de una a otra con diferencia contra el conteo físico.
- **Notas de crédito:** el valor se devuelve en **Efectivo** o **Crédito**; la mercadería vuelve a un depósito elegido entre 4 modos; la nota de débito se clasifica por motivo.
- **Cheques:** de terceros pasan por 5 estados; propios se marcan pagado o rechazado; se depositan en una boleta que genera el libro banco.
- **Seguridad:** por puesto, 216 permisos de valor Sí/No, texto o número; usuario con cajas, depósito, punto de venta y vendedor por defecto.
- **Pantallas con aviso de precondición** (pedir un cliente, un artículo, un punto de venta electrónico) que la réplica debe mantener como validaciones.
