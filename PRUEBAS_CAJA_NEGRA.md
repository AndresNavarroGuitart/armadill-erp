# Pruebas de caja negra: matriz de casos (2026-10-28)

**Objetivo.** No hay código fuente. Las reglas de cálculo se obtienen **ejecutando casos en el cliente real** y anotando la entrada, la salida y dónde se leyó. Cada caso cerrado queda como prueba automática de la réplica. Producto destinado a **estudios contables** (varios clientes, cobertura fiscal amplia): se prioriza lo impositivo y lo contable.

**Limitaciones conocidas del método**
- Los `.rpt` de Crystal son archivos OLE comprimidos; **no se pueden leer como texto** (probado con `impositivo_resumen_iva_*.rpt`). Sus fórmulas se infieren por salida.
- No se consulta MySQL (sin credenciales). Todo se lee por pantalla e informes.
- Para el cálculo de impuestos se usan **números que delaten la regla**: base con decimales, descuentos y bonificaciones cruzados, para distinguir "descuento antes o después del IVA" y el redondeo.

**Convención de resultados:** `OBS` = observado, `INF` = inferido, `PEND` = no probado. Cada caso lleva un código `C-xx` y una columna "lee en".

## Prioridad 1: cálculo de comprobantes

| Código | Caso | Entrada | Qué se mide | Lee en |
|---|---|---|---|---|
| C-01 | IVA 21 % puro, compra | 200 × 100 | neto, IVA, total | pie de la factura |
| C-02 | IVA 10,5 % y 27 % en compra | un renglón de cada uno | IVA por columna; total | pie y Libro IVA Compras |
| C-03 | Exento y no gravado, compra | renglones sin IVA | en qué columna cae cada uno | pie y libro |
| C-04 | **Mezcla de 4 alícuotas en una compra** | 21 + 10,5 + 27 + exento | suma exacta del total | pie |
| C-05 | **Redondeo** | precio 33,33 × 3, y 0,01 × 1.000 | cuándo redondea (por renglón o por total) | pie |
| C-06 | Descuento por renglón (%) | 10 % y 33 % | descuento sobre neto o sobre IVA incluido | pie |
| C-07 | Bonificación por renglón | % de bonificación | distinto de descuento? orden de aplicación | pie |
| C-08 | Descuento al pie (% y $) | 5 % | base del IVA tras el descuento | pie |
| C-09 | Precio con IVA incluido vs neto | artículo con precio final | cómo se desglosa el neto | TPV y factura de venta |
| C-10 | Moneda dólar | cotización 1.100 | conversión de importes e IVA | pie y libro |
| C-11 | Ventas con 27 % | artículo 27 % | **defecto conocido**: se pierde el 27 % y un renglón sin IVA; fijar el comportamiento exacto | factura A y libro IVA Ventas |
| C-12 | Percepción IIBB / IVA en compra | importe de percepción | suma al total, no al IVA | pie y libro |
| C-13 | Impuestos internos / otros | importe | dónde se suma | pie |

## Prioridad 1: libros y posición de IVA

| Código | Caso | Qué se mide |
|---|---|---|
| L-01 | Libro IVA Compras con 10 comprobantes variados | totales por columna = suma de pantallas |
| L-02 | Libro IVA Ventas igual | idem; comparar contra L-01 la asimetría del 27 % |
| L-03 | Nota de crédito en el libro | resta o aparece negativa |
| L-04 | Comprobante anulado | sale tachado o excluido; efecto en totales |
| L-05 | Posición de IVA con débito y crédito | saldo técnico, retenciones, percepciones |
| L-06 | Intervalo de fechas y cambio de mes | corte exacto |

## Prioridad 1: retenciones y percepciones

| Código | Caso | Qué se mide |
|---|---|---|
| R-01 | Retención IIBB / Ganancias / IVA en OP | ya probado: **importe manual**; verificar con 3 proveedores de categorías distintas si el porcentaje cambia el importe sugerido |
| R-02 | Retención con importe menor y mayor al mínimo del dump | si el sistema avisa o impide |
| R-03 | Certificado de Ganancias e IVA | numeración y informe |
| R-04 | Retención sufrida en un recibo (cobranza) | altera el saldo y el informe "Retenciones sufridas" |
| R-05 | Percepción aplicada en venta | requiere activar "Agente de percepciones" (Configuración): **pedir autorización** |
| R-06 | Percepciones emitidas / sufridas / pagos | informes con datos |

## Prioridad 2: saldos, cuenta corriente y circuito comercial

| Código | Caso | Qué se mide |
|---|---|---|
| S-01 | Factura de venta a cuenta corriente | saldo del cliente, vencimiento |
| S-02 | Recibo con imputación total, parcial y a cuenta | estados Canc / N/Canc, saldo |
| S-03 | Nota de crédito aplicada a una factura | saldo y estado |
| S-04 | Nota de débito | idem |
| S-05 | Anulación de factura, recibo y OP | reversión de saldo, stock y caja |
| S-06 | Condiciones de venta | fecha de vencimiento calculada |
| S-07 | Intereses por mora, si existen | fórmula |

## Prioridad 2: stock, costos y precios

| Código | Caso | Qué se mide |
|---|---|---|
| T-01 | Costo con compras a precios distintos | último costo, promedio, ¿PPP? |
| T-02 | Recalcular precio de costo | receta ya conocida; fijar fórmula |
| T-03 | Precio de venta desde costo + margen + lista | cadena de cálculo |
| T-04 | Ingreso y egreso de stock, transferencia entre depósitos | ficha de stock |
| T-05 | Venta con stock cero | permite o bloquea |

## Prioridad 3: lo que un estudio contable necesita

| Código | Caso | Observación |
|---|---|---|
| X-01 | **Contabilidad** (`cont_*`): asientos automáticos por factura, recibo y OP | módulo **apagado** en la instalación; requiere activarlo (pedir autorización) |
| X-02 | Plan de cuentas, ejercicio y cierre | idem |
| X-03 | Exportaciones SIAP / ATM / libro IVA digital | archivos generados en Exportación |
| X-04 | Multiempresa | cómo se separan los datos de dos empresas |
| X-05 | Régimen monotributo / factura C | no probado |

## Resultados del primer lote (2026-10-28, compras y libros)

Datos de partida: base limpia + año fiscal 2026 + artículos 4 a 8 (neto 120 en Lista 1; IVA venta e IVA compra iguales; 21 %, 10,5 %, 27 %, Exento, No gravado). Proveedor 1, factura A de compra, fecha 28/10/2026.

**Hallazgos de la preparación**
- **El calendario fiscal:** la tabla `periodos` ya trae 12 filas de 2024 con `id_year = 1`. Al dar de alta el año 2026 (que toma `id_year = 1`) se generan 12 filas más y quedan **dos por mes**; el cliente toma la de 2024 y rechaza por "vencido". Solución de prueba: editar el vencimiento de **Octubre 2024** a 15/11/2026.
- **El alta de artículo exige Rubro y Sub Rubro.** Sin ellos el sistema avisa "Debe completar todos los campos" pero igual muestra "guardados correctamente" y **crea un artículo invisible** (no aparece en ningún selector). Requisito para la réplica: validar y no guardar.
- **Precio final de venta = neto × (1 + IVA)** (120 → 145,2 / 132,6 / 152,4 / 120). El IIBB 3,5 % del artículo **no** se suma al precio final.
- Los campos numéricos aceptan coma decimal y guardan **4 decimales** internos (33,33 × 3 = 99,9900).

**Casos de cálculo observados (compras)**

| Caso | Entrada | Salida observada | Regla |
|---|---|---|---|
| C-01 | 200 × 100 al 21 % | neto 20.000, IVA 4.200, total 24.200 | IVA = neto × 21 % |
| C-02 | 10,15 × 7 al 10,5 %; 15,55 × 9 al 27 % | netos 71,05 y 139,95; IVA 7,46 y 37,79 | el pie tiene columnas 21 / 10,5 / 27 |
| C-03 | Exento 100 y No gravado 50 | **una sola caja "Exento" = 150**; en el libro, columna "No grav / Imp int / Exent" = 150,00 | en compras exento y no gravado se **suman** (no se pierden) |
| C-04 | 4 condiciones en una factura | subtotal 310,99; IVA 21,00 + 7,46 + 37,79 = 66,25; exento 150; **total 527,24** | total = neto gravado + IVA redondeado por columna + exento/no gravado |
| C-05 | 3 renglones de 0,30 al 21 % | IVA **0,19**, total 1,09 | el IVA se redondea **sobre el subtotal de cada columna** (0,90 × 0,21 = 0,189), **no por renglón** (0,06 × 3 = 0,18) |
| C-05 b | 99,99 × 21 % = 20,9979 | 21,00 | redondeo al centavo, hacia el más cercano |
| C-06 | renglón 100 con descuento 10 % | importe desc. 10, neto 90 | descuento sobre el neto |
| C-07 | renglón 100 con bonificación 10 % | importe bonif. 10, neto 90 | misma cuenta que el descuento |
| C-06/07 | descuento 10 % y bonificación 10 % | desc. 10, bonif. 9, neto **81** | **se encadenan**: 100 → 90 → 81 |
| C-08 | pie con 5 % sobre 261,00 | descuento 13,05; neto 247,95; **IVA 52,07 (sobre 247,95)**; total 300,02 | el descuento al pie reduce la base **antes** del IVA |
| (precio) | Subtotal 261,00 sin descuento al pie | IVA 54,81 (261 × 0,21), total 315,81 | |

**Libros e informes**

| Caso | Resultado |
|---|---|
| L-01 Libro IVA Compras (3 facturas) | una fila por comprobante, con Sub Total gravado, IVA 21 / 10,5 / 27, percepciones Gan / IVA / IB, **No grav / Imp int / Exent** y Total. Cuadra con las pantallas: 310,99 / 0,90 / 247,95 y totales 527,24 / 1,09 / 300,02 |
| L-05 Posición de IVA | **Débito 0; Crédito 118,51** (= 21,00 + 7,46 + 37,79 + 0,19 + 52,07); saldo técnico −118,51; retención 0; percepción 0. El detalle por contribuyente reparte el crédito: **21 %: 73,26; 10,5 %: 7,46; 27 %: 37,79; No grav / Imp int / Exento: 150,00** |

**Reglas de cálculo a replicar (resumen)**
1. `neto_renglón = precio × cantidad × (1 − desc %) × (1 − bonif %)` (encadenado, 4 decimales).
2. `subtotal_columna = Σ neto_renglón` por alícuota; `desc_pie = subtotal × % desc pie`; `base = subtotal − desc_pie`.
3. `IVA_columna = redondear(base × alícuota, 2)`; **no** se redondea por renglón.
4. `total = Σ base_gravada + Σ IVA_columna + exento + no gravado + percepciones + impuestos internos + otros`.
5. Exento y no gravado comparten una caja en compras.

## Resultados del lote de ventas (2026-10-28)

Factura A de venta a **Cliente 1** (Responsable Inscripto), lista de precios 2 ("Lista", neto 130), un renglón de cada artículo (21 %, 10,5 %, 27 %, exento, no gravado). Comprobante generado: **FA 0001-00000001**.

| Observación | Valor |
|---|---|
| En ventas el precio por unidad del renglón es el **precio final con IVA** | 157,30 (= 130 × 1,21), 143,65, 165,10, 130,00, 130,00 |
| Suma de los renglones | **726,05** |
| **Pie del comprobante** | Subtotal 21 % = 130,00; Subtotal 10,5 % = 130,00; Subtotal Gral 260,00; Exento 130; IVA 21 % 27,30; IVA 10,5 % 13,65; **Total General 430,95** |
| Impresión del comprobante | lista los 5 renglones, pero los totales son los del pie: Neto 260,00 · Exento 130,00 · IVA 21,00 27,30 · IVA 10,50 13,65 · **Total 430,95** ("Total items: 5") |
| Saldo de Cliente 1 | **430,95** (se facturó y se debe esa cifra) |
| Libro de IVA Ventas | Sub Total 260,00 · IVA 21 % 27,30 · IVA 10,50 % 13,65 · Exento/No gravado 130,00 · Percepciones 0,00 · Total 430,95; **no tiene columna de 27 %** |
| Libro de IVA Compras (mismo caso en compras) | tiene IVA 21 / 10,5 / **27** y suma exento + no gravado (150) |

**Qué se pierde.** El renglón al **27 %** (130 neto + 35,10 IVA = 165,10) no entra en ninguna caja del pie, y el **segundo renglón sin IVA** (exento y no gravado comparten una sola caja, que toma uno de los dos y no los suma). Diferencia: 726,05 − 430,95 = **295,10** que no se factura, no se debe y no figura en el libro. Es una pérdida real, no un redondeo.

**Reglas para la réplica (ventas)**
1. Debe existir columna 27 % (y 2,5 % / 5 % si se usan), en pie, impresión y libro.
2. Exento y no gravado deben ir en cajas separadas y **sumarse**.
3. Totales del pie = suma exacta de los renglones; el sistema original no lo garantiza, así que es una **prueba de invariante**: `total = Σ renglones` (conviene que la réplica la compruebe antes de generar).
4. Precios de venta a consumidor se manejan con IVA incluido y el neto se desglosa (neto = final / (1 + alícuota)); falta confirmar el redondeo del desglose.

**Otros hallazgos de interfaz** (sin relevancia contable): en la selección de clientes el botón de búsqueda con texto vacío produce el error SQL `... near 'Limit 300' at line 1`; hay que escribir texto para listar. En Carga Renglón, pasar por el campo Imp. Desc. del pie con valor ≠ 0 da "El descuento no puede sobrepasar el neto del comprobante".

### Ventas: redondeo, descuentos y nota de crédito (2026-10-28, segunda tanda)

Factura A **FA 0001-00000002** a Cliente 1: tres renglones del mismo artículo al 21 % con precio final 10,00 (el tercero con 10 % de descuento) y 5 % de descuento al pie. Nota de crédito por anulación **NCA 0001-00000001** sobre esa factura.

| Caso | Observación |
|---|---|
| Renglón único de 10,00 final | neto **8,26** (8,2645), IVA **1,74**, total 10,00 |
| 3 renglones: 10,00 + 10,00 + (10,00 − 10 % = 9,00) | suma final 29,00; **neto 23,97 (23,9669)**, **IVA 5,03**, total 29,00 |
| Descuento al pie 5 % | importe desc. **1,20** (5 % de 23,97 = 1,1985), base **22,77**, IVA **4,78** (22,77 × 21 %), total **27,55** |
| Impresión de la factura | Neto 23,97; Neto con desc 22,77; IVA 21 % 4,78; total 27,55. Los precios unitarios impresos son **netos** (8,26; el del renglón con descuento 7,44) |
| Mensaje al repetir artículo | "El artículo se encuentra cargado en el renglón, ¿Desea generar una nueva entrada?": hay que confirmar para repetirlo |
| NC "Anulación factura" | copia la factura **completa** (mismos renglones y pie: 23,97 / 1,20 / 22,77 / 4,78 / 27,55); no deja agregar ítems sueltos ("No puede agregar ítems por separado en una NC por anulación"). Tipo Dev: Crédito, Opcional: Ajuste, devuelve stock a un depósito |
| Efecto en saldo | Cliente 1: 430,95 → 458,50 al facturar 27,55 → **430,95** al emitir la NC |
| Libro de IVA Ventas | FA 1 (260,00 / 27,30 / 13,65 / 130,00 / 430,95); FA 2: Sub Total **22,77** (neto **después** de descuento), IVA 4,78, total 27,55; **NCA: −22,77 / −4,78 / −27,55**. La FA 2 **no** se marca como anulada (Anul = No): la anulación es una NC que resta |
| Posición de IVA (compras + ventas) | **Débito 40,95** (= 27,30 + 13,65 + 4,78 − 4,78); Crédito 118,51; **Saldo técnico −77,56**; débito por contribuyente: 21 % 27,30, 10,5 % 13,65, Exento 130,00 |
| Informe "Resumen de IIBB por actividad detallado" | actividad "Bienes de Cambio (3,5 %)": FA 1 con **Total neto 260,00** en el encabezado pero **cinco renglones de 130 (650)**; **Total actividad 650,00** (FA 2 +22,96 y NCA −22,96 se compensan). **La base de IIBB sale de los renglones guardados, no del pie**: IVA e IIBB divergen cuando el pie pierde renglones |

**Reglas de cálculo de ventas confirmadas**
1. Los precios de venta están **con IVA incluido**: `final_renglón = precio × cantidad × (1 − desc %)`; `total = Σ finales`.
2. El pie desglosa por alícuota: `neto_columna = redondear(Σ finales_columna / (1 + alícuota), 2)`; `IVA = Σ finales − neto` (verificado 29,00 → 23,97 + 5,03).
3. Descuento al pie sobre el **neto**: `desc = redondear(neto × %, 2)`; `base = neto − desc`; `IVA = redondear(base × alícuota, 2)`; `total = base + IVA` (22,77 + 4,78 = 27,55).
4. La **nota de crédito** reproduce el pie de la factura con signo negativo en el libro y devuelve el saldo del cliente.
5. El libro de IVA Ventas muestra el neto **con descuento aplicado**.
6. **Inconsistencia a no replicar:** el IIBB se calcula sobre los renglones (650) y el IVA sobre el pie (260); la réplica debe usar una única fuente.

## Resultados del segundo lote: stock, cobranzas y TPV (2026-10-28)

Datos de partida: base limpia + año fiscal 2026 + artículo 4 "PRUEBA IVA 21" (con Rubro 1 / Sub Rubro 1, costo 100, neto 120 en Lista 1 y 130 en Lista 2, "Recalcula precio de costo" destildado). Proveedor 1 y Cliente 1.

### Stock y costos (T-01, T-04)

| Paso | Resultado |
|---|---|
| FA 0001-00003001: 10 u × 100 (total 1.210,00) | stock del artículo **10** |
| FA 0001-00003002: 10 u × 120 (total 1.452,00) | stock **20** |
| Costo del artículo después de ambas compras | **no cambió**: P. Costo 121,00 (= 100 × 1,21), precios de venta iguales (PV1 145,20, PV2 157,30); no hay costo promedio ni último costo en el maestro |

**Regla / límite:** con "Recalcula precio de costo" destildado las compras **solo mueven el stock**, no el costo. Falta probar con la casilla tildada (requiere cargar la composición del costo; con la composición vacía el costo y los precios quedan en 0). La réplica debe definir explícitamente el método de costeo (último, promedio ponderado, PEPS) y guardarlo en un historial; el sistema original no lo hace con esta configuración.

### Cobranzas (S-02, R-04)

Factura A FA 0001-00000001 a Cliente 1: 5 u × 157,30 = **786,50** (neto 650,00, IVA 136,50). Recibo **por imputación** REC 0001-00000001 con imputación parcial de **500**.

| Observación | Valor |
|---|---|
| Pestañas del recibo | Comprobantes · Descuento / Retenciones · Medios de Cobro I · Medios de Cobro II |
| Retención sufrida | se carga con "+": Tipo de retención (Ingresos Brutos por defecto), Nro de certificado, Fecha, Porcentaje, Importe. **El importe no se calcula del porcentaje** (queda vacío; se escribió 15 = 3 % de 500) |
| Totales del recibo | Imputado 500 · **Cobro = Imputado − Retención = 485** · Retención 15 · Total 500. El efectivo debe igualar 485 (saldo parcial 0) |
| Efecto en la factura | saldo **786,50 → 286,50**; en el recibo impreso: importe 786,50, cancelado actual 500, saldo 286,50 (el comprobante sigue "N/Canc") |
| Saldo del cliente | 786,50 → **286,50** |
| Informe "Retenciones sufridas" (Lista completa) | "Retenciones de clientes": Fecha 28/10/2026, **Cod Ret 1**, Tipo Ingresos Brutos, Doc Recibo, **Certificado 12345**, **Porcentaje 3,00**, Nro Comp 0001-00000001, Cliente 1, CUIT, **Importe 15,00**; total 15,00 |

**Reglas confirmadas:** `cobro_en_medios = imputado − retenciones − descuentos`; la retención sufrida es dato del cliente (certificado) y no se calcula; el recibo puede imputar parcialmente.

### TPV (C-09)

Venta FB 0001-00000001 a Consumidor Final: 3 × 145,20 (Lista 1 "Contado", precio **con IVA incluido**) = **435,60**. Cobro en efectivo con "Importe cobrado 500" y **Cambio 64,40**; opciones de medio de cobro: efectivo (con ingreso en moneda extranjera, cotización 1100, Efect U$S / Efect $), cuenta corriente, cheque, tarjeta y transferencia; descuento al pie; **redondeo (Arriba / Abajo)**; percepciones. El campo "Artículo" busca por **código**, no por nombre.

| Dónde se ve | Valor |
|---|---|
| Comprobante impreso (Factura B) | precios con IVA incluido (145,20); no discrimina IVA |
| **Libro de IVA Ventas** | FB Consumidor Final: **Sub Total 360,00 · IVA 21 % 75,60 · Total 435,60** (el libro **sí** desglosa el IVA de la B, = 435,60 / 1,21) |
| Libro, factura A del mismo día | 650,00 · 136,50 · 786,50 |

### Dólar y redondeo del TPV (C-10, 2026-10-28)

**Artículo en moneda dólar.** Alta de "PRUEBA USD" con **Moneda = Dólar** (el combo de moneda tiene dos partes: tipo y moneda), costo 100, Lista 1 neto 120 y Lista 2 neto 130, ambos **en USD**; precio final 145,2 / 157,3 (USD con IVA 21 %).

| Dónde | Observación |
|---|---|
| Selector de artículos (venta) | PN V1 120,00 (en USD), Moneda "Dólar", **Cotiz. Dólar 1100**; Lista 2: **Precio Neto $ 143.000,0000 (= 130 × 1100)**, **Precio Final $ 173.030,0000 (= 143.000 × 1,21)** |
| Renglón de Factura A (1 unidad, Lista 2) | Precio x U **173.030**; pie: Subtotal 21 % **143.000,00**, IVA **30.030,00**, Total **173.030,00** (no se generó) |
| Regla | `precio_pesos = precio_USD × cotización` (cotización del día en el selector, 1100); el IVA y el pie se calculan en pesos. No se probó el comprobante con la cotización en otro valor ni el recálculo si cambia la cotización después de facturar |

**Redondeo del TPV.** En Medios de cobro hay un campo **Redondeo** (importe) con combo **Arriba / Abajo**.

| Prueba | Resultado |
|---|---|
| Total 145,20; importe cobrado 145; Redondeo 0,20 **Arriba** | no deja generar: "El importe ingresado no alcanza para cancelar el comprobante" (saldo 0,20) |
| Mismo caso con **Abajo** | no deja generar: "La suma de los medios cobrados debe ser igual al total" |
| Importe cobrado 200 | **Cambio 54,80** (= 200 − 145,20); el campo Redondeo (0,20, Abajo) **no modifica el cambio ni el total** |

**Conclusión:** en la instalación probada el campo Redondeo **no permite cerrar un comprobante con una diferencia**: el total cobrado debe igualar exactamente al comprobante. Cómo lo usa el original (probablemente con una configuración de redondeo de efectivo o de moneda de curso) queda sin determinar; la réplica puede definir el redondeo de caja como un ajuste explícito registrado.

**Pendiente de este lote**: pago mixto en el TPV (efectivo + tarjeta + cuenta corriente), nota de crédito por devolución parcial con stock, costo con "Recalcula precio de costo" tildado, comprobante en dólares ya generado (libro y saldo) y cotización distinta de 1100.

**Pendiente del lote de ventas anterior**: C-09 (precio con IVA incluido en TPV), C-10 (dólar), C-11 / L-02 (ventas y Libro IVA Ventas con las cuatro alícuotas: el defecto ya observado el 27/10 en TPV y Factura A debe reproducirse con estos mismos artículos), C-12 y C-13 (percepciones e impuestos internos), L-03 a L-04 y L-06.

## Resultados del tercer lote: percepciones y contabilidad (2026-10-28)

**Autorizado por Andrés:** activar "Agente de percepciones" y Contabilidad en la base de prueba.

| Intento | Resultado |
|---|---|
| Archivo > Configuración > Sucursal > **Agente Percepciones = Sí** → guardar | el sistema rechaza: **"Debe contratar el módulo agente de percepciones de venta"** |
| Archivo > Configuración > Activaciones > **Contabilidad = Sí** | vuelve a "No" sin mensaje (mismo mecanismo de licencia) |
| Otros hallazgos de la ventana | el bloque "Agente de percepción / retención" trae Ret. IIBB, Ret. Ganancias, Ret. IVA, Percepciones y Percep RG AFIP 5329/2023; **Límite redondeo TPV = 1,5**; Impuestos en precio de venta = Incluido; Límite de consultas 300 |

Se **canceló** la ventana sin guardar (la base no recibió cambios de configuración) y **no se intentó saltear la licencia**.

**Percepción sufrida en compras** (no requiere módulo): FA 0001-00004001, 1 × 1.000 al 21 %, Per Gan 30, Per IVA 20.

| Dónde | Resultado |
|---|---|
| Pie de la factura | Subtotal 1.000,00 · IVA 210,00 · Per Gan 30 · Per IVA 20 · **Total 1.260,00** (las percepciones se suman al total, no a la base ni al IVA). El campo Per IB tiene botón de jurisdicción: el valor tipeado directo no se guardó |
| Libro de IVA Compras | Sub Total 1.000,00 · IVA 21 % 210,00 · **Percep Gan 30,00 · Percep IVA 20,00** · Percep IB 0,00 · Total 1.260,00 |
| Informe "Percepciones de proveedores" | columnas Ing. B. / Gan / IVA; totales 0,00 / 30,00 / 20,00; Importe del comprobante 1.260,00 |
| Posición de IVA | Débito 0 · Crédito 210,00 · Saldo técnico −210,00 · Retención 0 · **Percepción 20,00** (solo la de IVA) · **Saldo −230,00** |

**Reglas confirmadas** (pasadas a casos C-12 y L-05c en [ESPECIFICACION_REGLAS_CALCULO.md](ESPECIFICACION_REGLAS_CALCULO.md)).

**Pendiente:** percepciones aplicadas en venta y contabilidad (licencia: definir desde normativa, no por observación), percepción de IIBB con jurisdicción en compras.

### Pago mixto en el TPV y nota de crédito por devolución parcial (2026-10-28)

**Pago mixto (TPV).** Venta de 3 × 145,20 = **435,60** a Consumidor Final. El combo "Tipo cobro" ofrece solo **Efectivo y Tarjeta** (cuenta corriente, cheque y transferencia figuran como totales pero no como opciones de este combo). Se cobró **Efectivo 200** y **Tarjeta (American Express, plan American Express, 1 cuota) 235,60**: al elegir Tarjeta el sistema propone el **saldo** como importe. Totales: Efectivo 200 + Tarjeta 235,60 = 435,60; saldo 0. Se generó **FB 0001-00000001** con condición de venta **"Múltiple"**; el detalle de tarjetas guarda tarjeta, plan, importe, cuotas, interés, valor de cuota, nro de tarjeta, lote y cupón.

**Hallazgo: se vendió sin stock.** El artículo tenía 1 unidad (de la FA de compra 4001) y el TPV vendió 3 sin avisar: el stock quedó en **−2** (se ve en la factura de compra siguiente: "Stock: Depósito 1 = −2"). El original **permite stock negativo** en esta configuración (parámetro "Salida sin existencia = Sí" de la ficha de sucursal).

**NC por devolución parcial.** FA 0001-00000001 a Cliente 1: 5 × 157,30 = 786,50 (stock 8 tras una compra de 10). NC "Devolución" desde el selector de facturas: se elige la factura y se **agrega el renglón** (aviso "Agrego el artículo al renglón de la NC"); el renglón trae la cantidad total (5) y se **edita a 2**.

| Observación | Valor |
|---|---|
| NC parcial | 2 × 157,30 = **314,60** (neto 260,00 + IVA 54,60), **NCA 0001-00000001** |
| Saldo de Cliente 1 | 786,50 → **471,90** (= 786,50 − 314,60) |
| Stock | 8 (tras la compra de 10 sobre −2) − 5 (venta) + 2 (devolución) = **5**: la devolución **reingresa stock** al "Depósito 1" |
| Campos de la NC | Tipo Dev. (Crédito), Depósito, Opcional (Ajuste), Factura de origen |

**Reglas confirmadas**
1. La NC por devolución **parcial** copia precio y alícuota de la factura y recalcula el pie con la cantidad editada (260,00 + 54,60 = 314,60).
2. Reingresa al stock la cantidad devuelta en el depósito elegido.
3. Resta del saldo del cliente el total de la NC.
4. El pago mixto exige que la suma de medios iguale al total; el saldo se propone al cambiar de medio.
5. El stock **puede quedar negativo** (configurable); la réplica debe decidir una política y avisar.

## Orden de ejecución

1. **Primer lote:** C-01 a C-13 y L-01 a L-06 (solo cálculo y libros; necesita calendario fiscal; ver nota).
2. **Segundo lote:** R-01 a R-06, S-01 a S-07.
3. **Tercer lote:** T, X.

**Nota operativa.** La base limpia tiene el calendario fiscal vacío. Para generar comprobantes hay que dar de alta el año fiscal y **subir el vencimiento de las filas duplicadas** (ver [PRUEBA_IMPUESTOS.md](PRUEBA_IMPUESTOS.md), sección 5 ter). La base queda con datos de prueba y se restaura con [restaurar_copia.ps1](restaurar_copia.ps1).
