# Referencia: localización Argentina de Odoo 18 y normativa fiscal (2026-10-28)

Uso: **referencia de comparación** para la réplica de administraNET destinada a estudios contables. No es una especificación a copiar.

## 0. Fuentes y alcance

| Fuente | Qué aportó | Límite |
|---|---|---|
| PDF "Localización Argentina" (Odoo, presentación comercial) | resumen de capacidades: FCE, retenciones automáticas (v18), cheques, Líquido Producto, bono fiscal, exportación, Mercado Pago en PdV | son pocas páginas con mucha imagen; el texto extraíble es corto |
| [Documentación Odoo 18: Argentina](https://www.odoo.com/documentation/18.0/applications/finance/fiscal_localizations/argentina.html) | módulos, configuración, diarios, puntos de venta, tipos de documento, impuestos, retenciones, cheques, informes | **no cubre** CAEA, QR, padrón, IVA Digital, CITI, SIRE, escalas de Ganancias ni cotización ARS/USD |
| Búsquedas web (ver sección 5) | normativa 2024-2025 de ARCA | resultados de blogs contables; **ninguna fuente oficial se leyó completa** |

Convención: **[Odoo]** = leído en la documentación; **[Verificado]** = confirmado por una búsqueda web (fuente citada); **[A verificar]** = de conocimiento general, no confirmado en esta sesión.

## 1. Lo que dice Odoo 18

### 1.1 Módulos
| Módulo | Función |
|---|---|
| `l10n_ar` | contabilidad base: plan de cuentas, impuestos, tipos de documento |
| `l10n_ar_edi` | facturación electrónica por web service |
| `l10n_ar_reports` | libro de IVA y resumen de IVA |
| `l10n_ar_withholding` | retenciones al pagar (nuevo en v18) |
| `l10n_ar_website_sale` | tienda online con tipo de identificación y responsabilidad fiscal |
| `l10n_latam_check` | cheques propios, diferidos y de terceros |

### 1.2 Configuración fiscal
- **Responsabilidad AFIP de la empresa** define el plan de cuentas: Monotributista **227** cuentas, IVA Exento **290**, Responsable Inscripto **298**; para RI se crean **73 impuestos**.
- **Ambientes** de prueba y producción aislados; el certificado de uno no sirve en el otro. Alta del certificado: generar CSR en Odoo, obtenerlo en el portal de AFIP, cargar certificado y clave privada. Sin certificado de homologación, Odoo valida la factura **localmente**.
- **Contactos:** tipo de identificación (6 activos y 32 inactivos, **38** en total) y **responsabilidad AFIP**; esta última decide el tipo de documento.
- **Impuestos:** tres tipos: IVA, **percepción** (se aplica en la factura) y **retención** (se aplica en el pago). Los impuestos poco comunes vienen inactivos.

### 1.3 Documentos, diarios y puntos de venta
- Un **tipo de documento** (definido por AFIP) tiene **secuencia propia por diario**; se agrupan por **letra**: A (entre responsables), B (consumidor final), E (exportación). El tipo se propone según emisor y receptor y el usuario puede cambiarlo.
- Los diarios de compra y venta tienen **"Usa documentos"**; sin eso no emiten facturas fiscales.
- **Punto de venta AFIP** (solo ventas): fija el web service y el formato. Web services: **wsfev1** (A, B, C, M, sin detalle por ítem), **wsbfev1** (bono fiscal para bienes de capital), **wsfexv1** (exportación, tipo E). Campos: número de PV, domicilio comercial (se imprime; un PV por local fiscal).
- **Libro unificado** si el sistema del PV es *preimpresa*: factura, NC y ND de la misma letra comparten una secuencia (FA 0001-2, NC 0001-3, ND 0001-4).
- En la primera factura Odoo **sincroniza con AFIP** y muestra el último número usado; se puede consultar en AFIP el último número por tipo y PV.

### 1.4 Facturación
- **A: IVA discriminado** (clientes Responsable Inscripto). **B: IVA incluido** (Exento, Consumidor Final, Monotributo, IVA liberado).
- La pestaña AFIP muestra **CAE**, **vencimiento (normalmente 10 días)** y resultado: "Aceptado" o "Aceptado con observaciones". El PDF lleva código de barras del CAE.
- **Servicios:** fechas de inicio y fin; si faltan, el primer y último día del mes de la factura.
- **Exportación:** diario con sistema "Expo Voucher - Web Service"; cliente "del exterior - Ley 19.640" asigna diario, tipo de documento, posición fiscal y concepto "exportación definitiva de bienes"; **Incoterms** obligatorios.
- **Bono fiscal:** exige moneda y cotización, zona y, por ítem, código NCM, descripción, precio neto, cantidad, unidad, bonificación y alícuota.
- **FCE MiPyME:** tipos 201, 202 y 206 (entre otros); el emisor debe estar habilitado, importe mínimo **100.000 ARS**, **CBU** vinculada, modo de transmisión **SDC o ADC**. NC y ND de FCE: misma letra y misma moneda que el original; el campo "¿es cancelación?" distingue rechazo de anulación.
- **Nota de crédito: no se puede generar si no está ligada a una factura.**

### 1.5 Compras
- Tipo de documento obligatorio, número manual con formato validado (prefijo-letra-número).
- **Validación contra AFIP** del comprobante recibido: *no disponible* (defecto) / *disponible* (solo advierte) / *requerida* (bloquea). Botón "Verificar en AFIP".
- Conceptos no gravados (combustible): una línea por base de IVA y otra para el concepto exento.
- **Percepciones** como impuesto en cualquier línea, con importe editable.

### 1.6 Retenciones (módulo `l10n_ar_withholding`)
- Precargadas; las **cuentas de pagos/recibos pendientes** deben estar en cada método de pago del diario o **no se genera asiento**.
- Se asignan al proveedor (pestaña Contabilidad) con **fecha desde y hasta**.
- **Ganancias:** porcentaje, **monto no imponible**, **retención mínima** (por debajo es 0) y **secuencia de retención** (número de certificado automático).
- **Escalas de Ganancias:** se calculan por escala, **acumulativas** (Odoo suma los pagos del período). Hay dos escalas precargadas.
- **IIBB monto total** y **IIBB no gravado:** un registro **por provincia** con porcentaje; el no gravado no usa mínimo. Odoo recomienda duplicar la plantilla de Córdoba.
- **Las alícuotas de IIBB no se actualizan solas**, ni siquiera para provincias con web service.
- **Al pagar:** se calcula la retención automáticamente; la deuda se cancela por el total y lo conciliado con el banco es el neto.

### 1.7 Cheques, informes y otros
- **Cheques:** propios (comunes y diferidos, con fecha de cobro) y **de terceros** con dos diarios de caja ("Cheques de Terceros" y "Cheques de Terceros Rechazados") y estados por operación.
- **Informes:** libro de IVA (exporta .zip), **resumen de IVA** (solo uso interno), **IIBB ventas y compras por jurisdicción** (tablas dinámicas para la declaración; no se presentan a AFIP).
- **Líquido Producto** (compra/venta directa de hacienda y granos): diario de compra con web service.
- Integración con **Mercado Pago** en el punto de venta y eCommerce con campos fiscales.

## 2. Comparación: Odoo 18, administraNET y recomendación para la réplica

| Tema | Odoo 18 | administraNET (observado) | Recomendación |
|---|---|---|---|
| Retenciones al pagar | **calcula** con porcentaje, no imponible, mínimo y escalas | el operador **escribe el importe**; el porcentaje es informativo; `ImporteImp` único (mínimo o no imponible, ambiguo) | calcular y **sugerir**, editable; modelar **no imponible y mínimo por separado**; Ganancias con escalas acumulativas |
| Certificado de retención | secuencia automática por retención | certificado numerado (observado Nº 1) | numeración correlativa por tipo y agente |
| IIBB por provincia | registro por provincia, sin actualización automática | categoría del proveedor + jurisdicción | además cargar **padrones** (ARBA, AGIP, Córdoba) para actualizar alícuotas: Odoo no lo hace |
| Percepciones | impuesto de tipo percepción en la línea | campos Per Gan / Per IVA / Per IB en el pie, manuales; percepciones de venta requieren módulo con licencia | tipo de impuesto propio, con cuenta y jurisdicción |
| NC / ND | **solo ligadas a una factura** | también "devolución sin comprobante", "a cuenta", "concepto" | exigir comprobante origen; excepciones auditadas |
| Precio de venta | A neto + IVA; B con IVA incluido | grilla de venta con **precio final** también en A; la B impresa no discrimina IVA | guardar neto y bruto; B con "IVA contenido" (ver 4) |
| Documentos y secuencias | tipo de documento con secuencia por diario; libro unificado si es preimpresa | numeración por PV; letra por condición de IVA | tipo de comprobante AFIP + punto de venta + número, con sincronía contra ARCA |
| Web services | wsfev1, wsbfev1, wsfexv1 | URLs de WSAA/wsfev1 en configuración, padrón SOAP, límite CAEA 20 %; **no probado** | WSAA + WSFEv1 primero; exportación y bono fiscal después |
| Validar compras en ARCA | tres niveles (no, avisa, bloquea) | no observado | incluir; es de alto valor para un estudio contable |
| Cheques | propios, diferidos y de terceros, rechazados | tablas `chequepropio` y de terceros (relevadas) | cartera de cheques con estados |
| Plan de cuentas | 3 paquetes por responsabilidad | `cont_*` (módulo con licencia; solo esquema) | plan por tipo de responsable, con cuentas ligadas a impuestos y medios de pago |
| Asientos de pagos | no se generan sin las cuentas de pendientes | contabilidad no observable | validar configuración antes de operar |
| Moneda | cotización por comprobante; FCE en ARS o USD | precio = USD × cotización; IVA en pesos | guardar moneda y cotización en el comprobante |
| IIBB y IVA | informes IIBB por jurisdicción desde datos contables | **IIBB desde renglones, IVA desde el pie: divergen** | una sola fuente (defecto D-03 de la especificación) |

## 3. Qué agrega esto a la lista de pendientes de la réplica

1. **Escalas acumulativas de Ganancias** y retención con no imponible y mínimo separados.
2. **Validación de comprobantes de compra contra ARCA** (`WSCDC`, [A verificar]).
3. **Condición frente al IVA del receptor** como campo obligatorio de la factura (sección 4).
4. **FCE MiPyME** (importe mínimo, CBU, SDC/ADC): ARCA lo exige a ciertos emisores.
5. **Exportación** (wsfexv1, Incoterms) y **bono fiscal** si algún cliente del estudio los necesita.
6. **Padrones de IIBB** por jurisdicción: ventaja competitiva frente a Odoo.
7. Fecha de servicio desde/hasta y vencimiento de pago para conceptos de servicio.
8. **CAE vence a los 10 días** [Odoo]: validar al registrar comprobantes electrónicos recibidos.

## 4. Normativa que no figura en la documentación de Odoo

| Tema | Qué se sabe | Estado |
|---|---|---|
| **RG 5616/2024:** condición frente al IVA del receptor | desde el **15/04/2025** se informa con un **código propio** en el pedido de CAE (ya no se deduce de la letra); también alcanza a monotributistas que emiten C. Las fuentes indican que **desde el 1/12/2026 ARCA rechaza** el campo vacío | **[Verificado]** en blogs: [iProfesional](https://www.iprofesional.com/impuestos/464104-nuevo-requisito-arca-puede-trabar-emision-facturas), [Contadores en Red](https://contadoresenred.com/tu-cliente-recibio-notificacion-de-arca-por-emision-de-facturas-sin-informar-la-condicion-frente-al-iva-que-deben-hacer/), [Tributo Simple](https://tributosimple.com/arca-rechazara-facturas-electronicas-si-no-informas-la-condicion-frente-al-iva-de-tu-cliente/). **Fecha de rechazo a confirmar en la RG**. El cliente original ya muestra el aviso "actualizar antes del 15/04/2025 ... RG 5.616" |
| **Libro de IVA Digital** (RG 4597/2019) | **RG 5707/2025** lo limita a sujetos **exentos**: los Responsables Inscriptos dejan de estar obligados; vencimiento los primeros 15 días corridos del mes siguiente. IVA Simplificado dejó de aplicar el 1/7/2025; el resto desde el 1/12/2025 | **[Verificado]** en [Blog del Contador](https://siap.blogdelcontador.com.ar/numero/5707/) y [Contadores en Red](https://contadoresenred.com/resolucion-general-5707-2025/); formato de archivos **no verificado** |
| **CAE y CAEA** | **RG 5782/2025** (reemplaza a la RG 2926) limita el CAEA a **contingencia**; desde el **1/6/2026** la emisión en línea con CAE es la modalidad principal; **RG 5785/2025**: en contingencia por web service el CAEA es la primera opción; ARCA puede negarlo si no se rinde o no se presenta el F.2051 | **[Verificado]** en [Contadores en Red](https://contadoresenred.com/facturacion-uso-del-caea-se-limita-su-uso-para-contingencias/) y [Infoleg](https://www.argentina.gob.ar/normativa/nacional/norma-419496/texto). **Plazo de rendición del CAEA no encontrado** |
| **SICORE y SIRE** (retenciones y percepciones) | regímenes vigentes (RG 2233 y RG 3726); la RG 5652/2025 movió vencimientos de DDJJ e ingresos | **[Verificado]** en [CPCE CABA](https://web.cpcecba.org.ar/?p=53674); **no se confirmó** que SIRE reemplace a SICORE ni los diseños de archivo |
| Marco de la factura electrónica | **RG 4291** y manual del desarrollador de WSFEv1 | **[Verificado]**: [manual ARCA](https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf) (no se leyó) |

**[A verificar]** (conocimiento general, sin fuente leída):
- **Códigos de comprobante** habituales: 1 Factura A, 2 ND A, 3 NC A, 6 Factura B, 7 ND B, 8 NC B, 11 Factura C, 12 ND C, 13 NC C, 19 Factura E, 51 Factura M; FCE: 201, 202, 203 (A), 206-208 (B), 211-213 (C).
- **Códigos de alícuota de IVA** en el web service: 3 = 0 %, 4 = 10,5 %, 5 = 21 %, 6 = 27 %, 8 = 5 %, 9 = 2,5 %.
- **Tipos de documento:** 80 CUIT, 86 CUIL, 96 DNI, 99 sin identificar / consumidor final.
- **Códigos de condición del receptor** (RG 5616): 1 Responsable Inscripto, 4 Exento, 5 Consumidor Final, 6 Monotributo, 7 Sujeto no categorizado, 8 Proveedor del exterior, 9 Cliente del exterior, 10 IVA liberado Ley 19.640, 13 Monotributista social, 15 No alcanzado, 16 Monotributo trabajador independiente promovido. **Se obtienen de la tabla de parámetros del servicio** (no se hardcodean).
- **Autenticación:** WSAA devuelve token y firma válidos unas 12 horas; hay que cachearlos.
- **Código QR** de comprobantes: RG 4892/2020 (se regula también en una norma de 2023).
- **RG 5003** (leyenda de crédito fiscal en Factura A a monotributistas): el cliente original la trae configurable ("Resolución de AFIP 5003").
- **Transparencia fiscal (Ley 27.743):** la Factura B debe mostrar el **IVA contenido** y otros impuestos nacionales indirectos. **El original imprime la FB sin discriminar IVA** y avisa de esta ley en pantalla: hay que revisar si cumple.
- **Padrón de contribuyentes** para validar CUIT/CUIL y estado de clave, condición de IVA y domicilio: servicios `ws_sr_constancia_inscripcion` y `ws_sr_padron_a13`; vigencia y alcance por confirmar.
- **Retenciones de Ganancias** (RG 830) con escalas y mínimos que cambian por resolución: no se deben dejar fijos en el código.

## 5. Fuentes de búsqueda consultadas
- [ARCA: rechazo de facturas sin condición de IVA del receptor](https://siap.blogdelcontador.com.ar/?p=90212)
- [Condición de IVA del receptor, RG 5616](https://app.spomsolutions.com/blog/condicion-iva-receptor-rg-5616)
- [RG 5707/2025: Libro de IVA Digital](https://contadoresenred.com/resolucion-general-5707-2025/)
- [KPMG, novedades nacionales (jun-2025)](https://kpmg.com/ar/es/home/media/novedades-tax/2025/06/30-de-junio.html)
- [CPCE CABA: vencimientos SIRE y SICORE](https://web.cpcecba.org.ar/?p=53674)
- [RG 5782/2025 (texto)](https://www.argentina.gob.ar/normativa/nacional/norma-419496/texto)
- [Manual del desarrollador WSFEv1](https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf)

## 6. Qué conviene hacer con esto

1. **Antes de implementar ARCA:** leer del sitio de ARCA la tabla de parámetros de WSFEv1 (condición del receptor, tipos de comprobante, alícuotas) y confirmar las fechas de la RG 5616, RG 5782 y RG 5707. Los blogs pueden errar en fechas.
2. **Agregar a [ESPECIFICACION_REGLAS_CALCULO.md](ESPECIFICACION_REGLAS_CALCULO.md)** las reglas de retención (no imponible, mínimo, escala acumulativa) como **propuesta**, porque el original no las calcula.
3. **Decisión de producto:** qué hace la réplica que Odoo no hace. Candidatas: padrones de IIBB, validación de compras en ARCA y retenciones sugeridas con certificados.
