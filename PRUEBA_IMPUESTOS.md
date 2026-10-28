# Prueba de IVA, retenciones y percepciones (2026-10-27)

Hecha con el cliente real (sin tocar MySQL), sobre la copia de seguridad de la base. **Resultado: prueba parcial.** El IVA de venta se pudo observar por pantalla; las retenciones y percepciones **no se pudieron calcular de punta a punta** porque el sistema bloquea cualquier comprobante fiscal por el período fiscal (ver 3).

## 1. Datos de prueba cargados

| Qué | Detalle |
|---|---|
| Artículos 4 a 8 | PRUEBA IVA 21, 10,5, 27, Exento y No gravado (costo bruto 100 / neto 120) |
| Factura B 0001-00000001 | venta por TPV (ver [VENTAS_PUNTO_DE_VENTA.md](VENTAS_PUNTO_DE_VENTA.md)) |
| Año fiscal 2026 | agregado a mano en el calendario fiscal; período octubre 2024 marcado Anulado |
| Proveedor 1 (código 3) | categorías cambiadas: Ret IIBB = Contribuyente Local, Ret Ganancias = Anexo II inc. f) enajenación de bienes (78), Ret IVA = Responsables Inscriptos M |

## 2. Resultados observados

| Caso | Observación |
|---|---|
| Alta de artículo | si queda tildado **"Recalcula precio de costo"**, el sistema recalcula el costo desde la composición vacía y el precio queda en 0. Receta: destildarlo y cargar Costo bruto 100 + neto 120 |
| Pie de ventas (TPV, Factura A) | solo columnas **21 %, 10,5 % y Exento**: no hay 27 % y una de las dos líneas sin IVA (exento / no gravado) **se pierde**. TPV: total 397,80 contra 670,20 de líneas; Factura A: pie 430,95 contra 726,05 |
| Libro IVA Ventas | mismas tres columnas: el 27 % no se discrimina |
| Pie de **compras** | sí tiene **21 %, 10,5 % y 27 %**, más Per Gan / Per IVA / Per IB, Exento, Otros Imp., Imp. Interno. Factura de prueba: renglón 200 × 100 = 20.000 neto, IVA 21 % = 4.200, total 24.200 (el cálculo es correcto) |
| Retenciones en la orden de pago | la categoría sale del **maestro del proveedor**, no del comprobante. Imputando el saldo de 800 la retención dio **0**: está por debajo de los mínimos |
| Percepciones en venta | solo se habilitan si la sucursal está como agente de percepción (Configuración); **no se tocó la configuración** |

## 3. Bloqueo: período fiscal

Toda factura (venta A y compra A) termina en *"El período fiscal al que pertenece el comprobante se encuentra vencido"*. En compras se probó con fecha 27/10/2026 y con 02/11/2026 en registro y comprobante: mismo error. En ventas ya se había visto antes *"cerrado"* y luego *"vencido"*.

- El calendario (`years` / `periodos`, ver [IMPUESTOS.md](IMPUESTOS.md)) viene con períodos 2024 sembrados que **chocan** con los de 2026 generados a mano.
- No se resolvió qué regla decide "vencido" (probable: `vencimiento_fiscal_periodo` contra la fecha de hoy, más `abierto_periodo`). **No se pudo inferir sin ver los datos del calendario.**
- La factura de compra quedó **cancelada**, no se generó.

**Implicancia para la réplica:** el período fiscal es una regla de bloqueo que hay que modelar explícitamente (calendario por año, abierto / cerrado / vencido) antes de poder emitir cualquier comprobante.

## 4. Qué NO está verificado

- Importe real de retención de IIBB, Ganancias e IVA sobre una base grande, con sus mínimos y alícuotas.
- Cálculo de percepciones aplicadas en venta.
- Libro IVA Compras y los informes `impositivo_*` con datos.
- Recibo con retenciones sufridas.

## 5. Para destrabarlo

1. Que Andrés (o quien conozca el sistema) indique cómo se carga el calendario fiscal correcto, o que se pida la regla al fabricante.
2. ~~Alternativa: orden de pago **a cuenta**~~ **Probada el 28/10/2026: también bloquea.** Orden de pago a cuenta, Proveedor 1, 24.200 en efectivo, fecha 28/10/2026: mismo error "período fiscal vencido" al generar. En la pestaña Descuentos / Retenciones se ven las categorías heredadas (IIBB 2,50 %, Ganancias 2,00 %, IVA 100 %) pero el campo **Retención quedó en 0** antes de generar: las retenciones no se calculan en pantalla, solo (si acaso) al generar. Además el campo "Pago" de los totales quedó con un valor viejo (242.000) distinto del total (24.200), señal de que no se recalcula al editar. Quedó cancelada, no se generó.
   Conclusión: **ningún comprobante fiscal (factura de venta, de compra, orden de pago) se puede generar** hasta resolver el calendario fiscal.
3. Para las alícuotas: leer las tablas `tipo_retencion_pro`, `tipo_retencion_prog` y `tipo_retencion_pro_iva` desde el dump SQL (semilla) en lugar del cliente.

## 5 bis. Lectura del dump SQL (2026-10-28)

Fuente: `C:\administraNET\Bases\estructura_default_adm.sql` (solo lectura, líneas 27779-27848, 18601-18640, 28101-28114).

### Retenciones a proveedores (semilla)

| Tabla | Código | Nombre | % | Mínimo (`ImporteImp`) | Otro |
|---|---|---|---|---|---|
| `tipo_retencion_pro` (IIBB) | 1 | Exento | 0 | 0 | régimen 201, jurisdicción 1 |
| | 2 | Contribuyente Local | 2,5 | 1.000 | |
| | 3 | Monotributista | 2 | 1.000 | `id_pc` 119 |
| | 4 | Convenio Multilateral | 1 | 1.000 | |
| `tipo_retencion_prog` (Ganancias) | 1 | Exento | 0 | 0 | régimen 0 |
| | 2 | Locación | 2 | 5.000 | régimen 94, **anulada** |
| | 3 | Anexo II inc. f) enajenación de bienes muebles | 2 | 12.000 | régimen 78 |
| `tipo_retencion_pro_iva` (IVA) | 1 | Exento | 0 | 0 | base IVA |
| | 2 | Responsables Inscriptos M | 100 | 0 | base `IVA` (otra opción: `Neto`) |

`ImporteImp` es el **mínimo no sujeto a retención**. Con esto se explica el resultado de la prueba: la OP de 800 dio retención 0 (800 < 1.000 de IIBB y < 12.000 de Ganancias). Con el pago de 24.200 la de Ganancias (mínimo 12.000) sí debería aplicar. Falta saber si el mínimo se compara con el pago o con la base, y si la retención es sobre todo el importe o sobre el excedente: **no está en el esquema, está en el programa compilado**.

La retención de IVA es 100 % de la base elegida (`IVA` o `Neto`), con mínimo 0. Con la factura de prueba, 100 % de 4.200 = 4.200.

### Calendario fiscal

- `years` semilla: 2024 y 2025. `periodos` semilla: **24 períodos (ene-2024 a dic-2025)**, todos `abierto_periodo = 'Si'`, `anulado = 'No'`, con `vencimiento_fiscal_periodo` el **día 15 del mes siguiente**.
- **No hay ningún período 2026** en la base original. Hoy (octubre 2026) cae fuera de todo período sembrado, y todos los vencimientos sembrados ya pasaron.
- Ninguna tabla comercial guarda `id_periodo` (solo `impuesto_detalle`); el chequeo "período fiscal vencido" **no está en la base**, está en el cliente VB6. No hay triggers ni funciones que lo hagan (solo `aplicaReglas` y `listaPrecio`).
- Existe un calendario **contable** separado (`cont_ejercicio` / `cont_periodo`, ejercicio 1 = 2013, con `cerrado`); como Contabilidad está apagada, no parece ser el que bloquea.

**Hipótesis más probable** (sin confirmar): el cliente busca el período que contiene la fecha del comprobante y lo rechaza si no existe o si su `vencimiento_fiscal_periodo` es anterior a hoy. Con la fecha 02/11/2026 también falló, lo que sugiere que mis períodos 2026 cargados a mano no tenían bien el vencimiento o chocaban con los de 2024 por `mes_numero_periodo`. Para confirmarlo hay que mirar el calendario cargado (Impuestos > Agregar Presentación > Período) y dejar un 2026 con meses 1-12, `abierto = Si` y vencimiento futuro. No se ha hecho.

## 5 ter. Bloqueo resuelto y resultados con comprobantes reales (2026-10-28)

**Causa del "período fiscal vencido":** el calendario cargado tenía 24 filas bajo el único año 2026 (12 meses de 2024 sembrados + 12 de 2026). Para cada mes había **dos filas** (p. ej. Octubre 2024, vto 15/11/2024, y Octubre 2026, vto 15/11/2026). El cliente toma la **primera fila del mes**, que es la de 2024, sin mirar el año real ni `Anulado`, y como su vencimiento ya pasó, rechaza el comprobante. Marcar la fila 2024 como Anulado no alcanzó. Al modificar el vencimiento de **Octubre 2024 a 15/11/2026** (Archivo > Variables > Impositivas > Año y período de vencimiento fiscal > Comandos > Período > Modificar, F3) los comprobantes se generaron sin error.

**Regla a replicar:** un comprobante se acepta si su mes cae en un período con `abierto = Si` y `vencimiento_fiscal_periodo >= hoy`. El diseño del cliente es frágil (resuelve por mes, no por año): la réplica debe resolver por fecha (`inicio_periodo <= fecha <= fin_periodo`).

### Comprobantes generados (base de prueba)

| Comprobante | Resultado |
|---|---|
| OP a cuenta 0001-00000001 | Proveedor 1, 24.200 en efectivo. **Retenciones 0**: la OP a cuenta no retiene. El saldo del proveedor pasó de 800 a -23.400 |
| FA 0001-00001234 | 200 × 100 = 20.000 neto + IVA 21 % 4.200 = **24.200**; saldo del proveedor vuelve a 800 (la OP a cuenta compensa). Stock del artículo 4 sube |
| FA 0001-00001235 | igual, 24.200. No se pagó (queda pendiente) |

### Retenciones en la orden de pago por imputación

- Al imputar facturas de 24.200 y poner efectivo 24.200, los tres importes de retención (IIBB 2,50 %, Ganancias 2,00 %, IVA 100 %) **quedan en 0 y los porcentajes solo se muestran**: **el sistema no calcula la retención, el importe se carga a mano**.
- Al cargar 500 en IIBB: **Retención 500, Pago 24.200, Total 24.700, Saldo parcial -500**. Es decir, la retención se **suma** al total de la OP y exige que Pago + Retención = Imputado (el efectivo tendría que bajar a 23.700). No se generó esa OP.
- Conclusión: la categoría del proveedor define el **porcentaje de referencia**, pero en este cliente el cálculo de retenciones es **asistido por el operador**; los mínimos del dump (1.000 IIBB, 12.000 Ganancias) no se aplican solos en pantalla. Queda por verificar si algún informe (`impositivo_retenciones_*`) o proceso los calcula.

## 5 quater. Informes de Impuestos con datos (2026-10-28)

Ventana **Informes impositivos** (Gestión > Impuestos > Informes): Sucursal, Punto de venta, Informe, Intervalo de fechas. Lista: Impuesto – detalle saldo, Impuestos, **Libro de IVA Compras**, **Libro de IVA Ventas**, Percepciones emitidas / pagos / sufridas, **Posición de IVA**, Resumen de ingresos brutos por actividad (detallado y general), Retenciones emitidas / sufridas. Los libros piden además **Nro de libro** y **Nro de página inicial**.

| Informe | Lo que se vio con las dos FA de 24.200 |
|---|---|
| **Libro de IVA Compras** | una fila por comprobante: Fecha, Tipo, Número, Proveedor, Anul, condición IVA (RI), CUIT, **Sub Total**, **IVA 21 / 10,50 / 27**, **Percep Gan / Percep IVA / Percep IB**, **No Grav / Imp Int / Exento**, **Total**. Resultado: 2 filas, 20.000 + 4.200 = 24.200 cada una. **Compras sí discrimina el 27 %** |
| **Posición de IVA** | Débito 0,00; **Crédito 8.400,00**; **Saldo técnico -8.400,00** (= débito − crédito); Retención 0; Percepción 0; **Saldo -8.400**. Debajo, detalle por contribuyente: el débito fiscal tiene columnas 21 % / 10,50 % / Exento (**sin 27 %**), el crédito fiscal 21 / 10,50 / 27 / No grav-Imp int-Exento. Es el subinforme `impositivo_resumen_iva_sub_alicuota_*` |

**Hallazgos para la réplica**
- La **asimetría del 27 %** (compras lo discrimina, ventas no) está también en los informes: confirma que es una limitación del producto y no solo de la pantalla.
- La posición de IVA es un cálculo simple: **débito (ventas) − crédito (compras)**, con **retención y percepción** como renglones aparte; el saldo técnico es la posición antes de retenciones/percepciones.
- El libro de IVA Ventas / Posición de hoy no incluyó el TPV (se facturó el día 27); el informe se filtra por intervalo de fechas.
- No se generó ninguna retención ni percepción real, por lo que los informes de **Retenciones** y **Percepciones** no se probaron con datos.

## 5 quinquies. Retención real en una orden de pago (2026-10-28)

**Caso:** OP por imputación **0001-00000002**, Proveedor 1, imputa la FA 0001-00001235 (neto 20.000, IVA 4.200, total 24.200). Retenciones cargadas a mano: **IIBB 500** (2,5 % de 20.000) y **Ganancias 400** (2 % de 20.000); efectivo **23.300**.

| Ítem | Resultado |
|---|---|
| Totales en pantalla | Imputado 24.200 = Pago 23.300 + Retención 900; Saldo parcial 0 |
| Generación | OP generada sin error; la FA 1235 pasó a Cancelada; el efectivo que sale de caja es **23.300** (la retención no sale de caja) |
| Impresión de la OP | Retenciones 900,00; Descuentos 0; Total 24.200,00 |
| Informe **Retenciones emitidas** (opción IIBB) | "Retenciones a proveedores de IIBB", período 28/10/2026: Tipo Retención *Contribuyente Local*, Fecha, **Cod Ret 2**, **Certificado 1**, **Porcentaje 2,50**, OP 0001-00000002, Proveedor 1, CUIT, **Importe 500,00**; total 500,00 |

**Reglas confirmadas**
1. El **importe de la retención lo digita el operador**; el porcentaje de la categoría es informativo. El sistema no aplica el mínimo no sujeto a retención.
2. Identidad contable: **Imputado = Pago (medios) + Retenciones + Descuentos**. La retención reduce el efectivo, no suma al pasivo.
3. Cada retención emitida genera un **certificado numerado** (correlativo por tipo) en `retenciones_prov` (IIBB), con código de categoría, porcentaje y la OP.
4. El informe de retenciones se elige por **tipo** (IIBB / Ganancias / IVA) y por intervalo de fechas.
5. La categoría que se usa es la del **maestro del proveedor** al momento de la OP.

**Para la réplica:** conviene **sugerir** la retención calculada (base neta × %, con el mínimo de `ImporteImp`) pero dejarla editable como hace el original, y numerar los certificados. Queda sin probar el informe de Ganancias, la retención de IVA y las percepciones.

## 6. Estado de la base

La base queda **con datos de prueba**. Restaurar con `restaurar_copia.ps1` como administrador (cerrar antes el cliente y el Supervisor); ver [COPIA_DE_SEGURIDAD.md](COPIA_DE_SEGURIDAD.md).
