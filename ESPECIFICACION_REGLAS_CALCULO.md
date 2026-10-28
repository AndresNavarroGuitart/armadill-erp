# Especificación de reglas de cálculo (2026-10-28)

Fuente: pruebas de caja negra sobre administraNET Gestión 4 (cliente real, sin código fuente) registradas en [PRUEBAS_CAJA_NEGRA.md](PRUEBAS_CAJA_NEGRA.md), más lectura del esquema SQL. Cada regla es **ejecutable**: está implementada en [reglas/calculo.mjs](reglas/calculo.mjs) y verificada por [reglas/casos.json](reglas/casos.json).

```bash
node reglas/probar.mjs     # 47 casos: 41 observados en el original + 6 propuestas
```

Estado: **47/47 correctos**. Se comprobó además que el corredor falla cuando un valor esperado es incorrecto.

## 1. Convenciones

| Tema | Regla |
|---|---|
| Aritmética | decimal exacto (nunca coma flotante); el motor usa enteros con 6 decimales internos |
| Precisión interna | importes de renglón con **4 decimales** (el original guarda 99,9900); los totales de columna se muestran a 2 |
| Redondeo | al centavo, **half away from zero**. *No verificado en el límite exacto (x,xx5)*: en las 33 observaciones ningún caso cae justo en medio |
| Alícuotas | 21 %, 10,5 %, 27 %, exento (0), no gravado (0); `iva` del esquema también guarda `cod_afip`. El 2,5 % y el 5 % están en el motor pero **no se observaron** en el original |
| Moneda | los importes en dólares se convierten a pesos con la cotización del día; el IVA y los totales se calculan siempre en pesos |

## 2. Compras (precio de costo **sin** IVA)

Función `compra(renglones, {descPiePct})`. Casos C-01 a C-08.

1. `neto_renglón = precio × cantidad × (1 − desc %) × (1 − bonif %)`. **Descuento y bonificación se encadenan**: 100 → 90 → 81.
2. `subtotal_columna = Σ neto_renglón` de cada alícuota, a 2 decimales.
3. `desc_pie = redondear(subtotal × % pie)` **por columna**; `base = subtotal − desc_pie`. El descuento al pie reduce la base **antes** del IVA.
4. `IVA_columna = redondear(base × alícuota)`. **Se redondea por columna, no por renglón** (3 × 0,30 al 21 % → IVA 0,19, no 0,18).
5. Exento y no gravado se **suman** en una sola caja.
6. `total = Σ base + Σ IVA + exento/no gravado (+ percepciones e impuestos internos)`.

Ejemplo completo (C-04): netos 99,99 / 71,05 / 139,95; IVA 21,00 + 7,46 + 37,79 = 66,25; exento 150,00; **total 527,24**.

**Percepciones sufridas en compras (C-12).** El pie tiene tres campos: Per Gan, Per IVA, Per IB (este con botón de jurisdicción). Se **suman al total**, no a la base ni al IVA: 1.000 + IVA 210 + Per Gan 30 + Per IVA 20 = **1.260**. El Libro de IVA Compras las muestra en sus propias columnas y el informe "Percepciones de proveedores" las totaliza por tipo (Ing. B. / Gan / IVA) junto al total del comprobante. En la **Posición de IVA** solo entra la **percepción de IVA** (`saldo = saldo técnico − retención − percepción`; con crédito 210 y percepción 20 el saldo es −230); la de Ganancias no.

## 3. Ventas (precio con IVA **incluido**)

Función `venta(renglones, {descPiePct})`. Casos V-01 a V-09.

1. `final_renglón = precio_final × cantidad × (1 − desc %)`.
2. `F_columna = Σ final_renglón`; `neto = redondear(F / (1 + alícuota))`.
3. **Sin descuento al pie:** `IVA = F − neto` (10,00 → neto 8,26 + IVA 1,74; 29,00 → 23,97 + 5,03). El total es exactamente la suma de los precios finales.
4. **Con descuento al pie:** `desc = redondear(neto × %)`, `base = neto − desc`, `IVA = redondear(base × alícuota)` (27,55 = 22,77 + 4,78).
5. `total = Σ base + Σ IVA + exento + no gravado`.
6. **Factura B / consumidor final:** el comprobante impreso no discrimina IVA, pero el libro de IVA Ventas sí: `desglosar(435,60) → neto 360,00 + IVA 75,60`.
7. **Invariante que debe verificar siempre la réplica:** `total del pie = Σ importes de los renglones`.

## 4. Dólar

`precio_pesos = precio_USD × cotización` (D-01, D-02). Una factura de 1 unidad con precio final de 157,30 USD y cotización 1100 da neto 143.000,00 + IVA 30.030,00 = **173.030,00** (D-03). El articulo guarda moneda; el selector convierte con la cotización vigente. *No probado:* cambio de cotización posterior a la factura.

## 5. Cobranzas, pagos y retenciones

Función `recibo({imputado, retenciones, descuento, saldoComprobante})`. Casos R-01 a R-03.

1. **Identidad:** `imputado = medios de pago/cobro + retenciones + descuentos`. Cobrar 500 imputados con una retención de 15 exige 485 en efectivo.
2. Imputación **parcial** permitida: la factura de 786,50 queda con saldo 286,50 y estado `N/Canc`; con saldo 0 pasa a `Canc`.
3. **El importe de la retención lo escribe el operador.** El porcentaje de la categoría (maestro del proveedor) es informativo; el original no aplica el mínimo no sujeto a retención.
4. Cada retención emitida genera un **certificado numerado**; las retenciones sufridas se registran con el número de certificado del cliente. Informes: "Retenciones emitidas" (IIBB / Ganancias / IVA) y "Retenciones de clientes".
5. **Propuesta de la réplica** (no es del original): `retencionSugerida(base, %, mínimo)` = 0 si la base es menor que el mínimo, o `redondear(base × %)`; el importe sigue siendo editable (R-10, R-11).
6. Una orden de pago **a cuenta** no retiene.

Catálogos de partida (esquema `estructura_default_adm.sql`):

| Régimen | Categoría | % | Mínimo |
|---|---|---|---|
| IIBB (`tipo_retencion_pro`) | Exento / Contribuyente Local / Monotributista / Convenio Multilateral | 0 / 2,5 / 2 / 1 | 0 / 1.000 / 1.000 / 1.000 |
| Ganancias (`tipo_retencion_prog`) | Exento / Locación (anulada) / Anexo II inc. f) | 0 / 2 / 2 | 0 / 5.000 / 12.000 |
| IVA (`tipo_retencion_pro_iva`) | Exento / Responsables Inscriptos M | 0 / 100 | 0 (base IVA o Neto) |

## 6. Notas de crédito, saldos y libros

- **Saldo de cuenta corriente:** FA/FB/FC y ND suman; NC y recibos restan (`saldoCuenta`, S-01, S-02).
- **NC por anulación:** copia la factura completa (renglones y pie) y devuelve el saldo; no admite renglones sueltos. La factura original **no** se marca anulada: la NC la compensa (L-01).
- **Libro de IVA:** una fila por comprobante, con Sub Total **neto de descuentos**, IVA por alícuota, percepciones y no gravado/exento; la NC entra con signo negativo en todas las columnas.
- **Posición de IVA:** `débito (ventas netas de NC) − crédito (compras) = saldo técnico`; retenciones y percepciones se restan aparte (L-05a, L-05b).

## 7. Stock y costos

- Una factura de compra suma stock; una de venta resta (observado: 10 + 10 = 20). **Una nota de crédito por devolución suma** la cantidad devuelta al depósito elegido (T-01: 8 − 5 + 2 = 5).
- **El stock puede quedar negativo:** el TPV vendió 3 unidades con 1 en existencia y quedó −2 (T-02; parámetro de sucursal "Salida sin existencia = Sí"). La réplica debe decidir una política (bloquear, avisar o permitir) y registrarla.
- **NC por devolución parcial (S-03, S-04):** se agrega el renglón de la factura y se edita la cantidad; copia precio y alícuota y recalcula el pie (2 × 157,30 → neto 260,00 + IVA 54,60 = 314,60); resta ese total del saldo del cliente (786,50 → 471,90).
- **Pago mixto en el TPV (M-01, M-02):** efectivo + tarjeta; la suma de medios debe igualar el total exacto (con 145 sobre 145,20 el original rechaza). La condición de venta del comprobante queda "Múltiple".
- **Con "Recalcula precio de costo" destildado, las compras no cambian el costo ni los precios** del maestro (P. Costo siguió en 121 tras compras a 100 y a 120). La réplica debe definir el método de costeo (último, promedio ponderado o PEPS) y llevar un historial, porque el original no lo hace con esa configuración. *No probado* con la casilla tildada.

## 8. Período fiscal y reglas de alta

- **Propuesta (P-01 a P-04):** un comprobante se acepta si existe un período, **resuelto por fecha**, que no esté anulado, esté abierto y tenga vencimiento fiscal ≥ hoy. Motivos de rechazo: `sin_periodo`, `cerrado`, `vencido`.
- **Artículo:** exige Rubro y Sub Rubro. El original, si faltan, muestra "Debe completar todos los campos" y luego "guardados correctamente", creando un artículo invisible; la réplica debe **rechazar el alta**.

## 9. Defectos del original que NO se deben replicar

| # | Defecto | Evidencia | Qué hace la réplica |
|---|---|---|---|
| D-01 | La venta pierde el renglón al **27 %** (pie, impresión y libro de ventas no tienen esa columna) | factura de 726,05 en líneas facturada como 430,95 (V-04) | soportar todas las alícuotas; invariante `total = Σ renglones` |
| D-02 | Exento y no gravado comparten una caja que toma **uno** de los dos | idem | cajas separadas y sumadas |
| D-03 | El IIBB se calcula sobre los renglones guardados (650) y el IVA sobre el pie (260) | informe "Resumen de IIBB por actividad" | una sola fuente de datos |
| D-04 | El calendario fiscal se resuelve por **mes**, no por año: con filas de 2024 y 2026 toma la primera | error "período vencido" con calendario correcto | resolver por fecha (sección 8) |
| D-05 | Alta de artículo sin rubro crea registros huérfanos | artículos que no aparecen en ningún selector | validar antes de guardar |
| D-06 | Buscar clientes con texto vacío produce un error SQL (`near 'Limit 300'`) | Facturación y notas de crédito | consultar siempre con límite correcto |
| D-07 | El campo Redondeo del TPV no permite cerrar un comprobante con diferencia | casos del 28/10 | modelar el redondeo de caja como ajuste explícito registrado |

## 9 bis. Módulos con licencia (límite de la ingeniería inversa)

En la configuración de la sucursal (Archivo > Configuración > Sucursal) existe el bloque **"Agente de percepción / retención"** (Ret. IIBB, Ret. Ganancias, Ret. IVA, Percepciones, Percep RG AFIP 5329/2023). Al poner **Agente Percepciones = Sí** y guardar, el sistema responde: **"Debe contratar el módulo agente de percepciones de venta"**. La **Contabilidad** (Archivo > Configuración > Activaciones) vuelve a "No" sin avisar. Son **módulos vendidos por separado** que el cliente valida contra la licencia. No se intentó saltear esa restricción: **las percepciones aplicadas en venta y los asientos contables quedan fuera del alcance de la prueba de caja negra** y hay que definirlos desde normativa y requisitos, no por observación. Además, en la misma ventana: **"Límite redondeo TPV = 1,5"** (parámetro del redondeo del TPV) y "Impuestos en precio de venta = Incluido".

## 10. Lo que NO está verificado

- Redondeo en el límite exacto de medio centavo y descuento al pie con **varias columnas** a la vez (se asumió por columna).
- Alícuotas 2,5 % y 5 %; percepción de IIBB en compra (botón de jurisdicción; el campo directo no tomó el valor) y **percepciones aplicadas en venta** (requieren módulo con licencia, ver 9 bis).
- Impuestos internos, intereses por mora, descuentos de cliente por reglas o puntos.
- Costo con "Recalcula precio de costo" tildado y métodos de costeo.
- Nota de débito, pago con cheque / transferencia / cuenta corriente en el TPV, y devolución con tipo "Dinero" en lugar de "Crédito".
- Contabilidad (`cont_*`): asientos automáticos, plan de cuentas y cierre (**módulo con licencia no activable**, ver 9 bis). Solo se conoce el esquema: `cont_ejercicio`, `cont_periodo`, `cont_pc` (plan de cuentas con códigos como 210101 Proveedores, 210406/210407 retenciones a pagar) y las cuentas contables que cada artículo trae asignadas (Ventas 420101, Mercaderías 110501).
- Exportaciones SIAP / ATM / libro IVA digital y todo lo de ARCA.

## 11. Cómo ampliar

1. Hacer el caso en el cliente real y anotarlo en [PRUEBAS_CAJA_NEGRA.md](PRUEBAS_CAJA_NEGRA.md).
2. Agregarlo a `reglas/casos.json` con `"origen": "observado"` (o `"propuesta"` si es una decisión de diseño de la réplica).
3. Si falla, ajustar `reglas/calculo.mjs` hasta que coincida con el original (o documentar el defecto en la sección 9).
