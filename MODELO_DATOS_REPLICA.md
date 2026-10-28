# Modelo de datos de la réplica (2026-10-28)

Modelo **nuevo y limpio** para un producto destinado a estudios contables (multiempresa, contabilidad en el centro). No convive con la base MySQL del original: el original es fuente de reglas y de migración. Implementación en [modelo/](modelo/) (PostgreSQL, validado en 18 con PGlite). Se comprueba con `npm test` en esta carpeta: **47 casos de reglas + 41 pruebas del modelo + 8 del pedido a ARCA, todas correctas**.

## 1. Decisiones (cada una revisable)

| Decisión | Elegido | Alternativa y por qué no |
|---|---|---|
| Motor | PostgreSQL 15+ | MySQL del original: sin RLS, sin exclusión de rangos, `numeric` más limitado |
| Multiempresa | `estudio` → `empresa`, `empresa_id` en cada tabla y **RLS forzado** | una base por cliente: costoso de operar y de consolidar para el estudio |
| Dinero | `numeric` (importe 2 dec., renglón 4 dec.); tasas como fracción (0.21) | el original mezcla `double` y `decimal` |
| Saldos | **nunca se guardan**: vistas sobre comprobantes, pagos y movimientos | el original cachea saldos en 3 lugares |
| Cliente/proveedor | una tabla `tercero` con roles | el original las separa |
| Comprobantes | una tabla `comprobante` (sentido venta/compra) con la **estructura del pedido de CAE** (ImpNeto, ImpIVA, ImpTotConc, ImpOpEx, ImpTrib, ImpTotal) | tablas separadas por tipo |
| Inmutabilidad | máquina de estados + guardias: confirmado no se edita ni borra; autorizado no se anula (se emite NC) | confiar en la aplicación |
| Período fiscal | por **fecha**; bloqueo por vencimiento **configurable** por empresa | el original lo resuelve por mes y bloquea siempre |
| Stock | libro de movimientos de solo agregar; política de stock negativo por empresa | el original permite −2 sin avisar |
| Catálogos ARCA | tablas globales marcadas `verificado = false` hasta cargarlas desde `FEParamGet*` | hardcodear en el código |

## 2. Módulos (14 archivos SQL)

| Archivo | Contenido |
|---|---|
| 00 base | dominios, contexto de sesión, CUIT con dígito verificador |
| 01 catálogos ARCA | tipos de comprobante (con signo), alícuotas, tipos de documento, condición IVA del receptor (RG 5616), jurisdicciones |
| 02 tenencia y seguridad | estudio, empresa, parámetros por empresa, usuarios, roles, permisos, secuencias, **auditoría append-only** |
| 03 contabilidad | plan de cuentas, ejercicio, **período** (sin solapes), asiento balanceado, balance de sumas y saldos |
| 04 terceros y artículos | tercero, domicilios, contactos, artículo (IVA gravado/exento/no gravado como ARCA), precios solo neto con vigencia, historial de costos |
| 05 regímenes | regímenes de retención con **no imponible, base mínima y retención mínima por separado**, escalas acumulativas de Ganancias, padrón de IIBB, `fn_retencion_sugerida` |
| 06 comprobantes | cabecera, renglones, IVA por alícuota, tributos, aplicación de notas, verificación al confirmar |
| 07 tesorería | cajas, cuentas bancarias, cheques con historial |
| 08 pagos y retenciones | recibos y órdenes de pago, imputaciones, medios, retenciones con certificado, **movimientos de caja generados al confirmar o anular** |
| 09 stock | depósitos y movimientos |
| 10 ARCA | certificados (solo referencia al secreto), tickets WSAA, bitácora de llamadas, CAEA, padrón |
| 11 vistas | saldo por comprobante y por tercero, libros de IVA, posición de IVA, stock, caja, balance, cartera de cheques |
| 13 documentos comerciales | presupuesto → pedido → remito de venta y orden de compra → remito de compra; el remito confirmado **mueve el stock** y la anulación lo contrarresta; sobre-entrega rechazada; cumplimiento derivado en `v_documento_pendiente` (pedido, remitado, facturado, pendiente); la factura referencia el renglón del remito |
| 14 seguridad | RLS en todas las tablas con `empresa_id` (se carga **última**, para cubrir las tablas de los archivos anteriores), rol `app_usuario`, auditoría |

## 3. Invariantes que impone la base (y el original no)

1. `imp_total = imp_neto + imp_iva + imp_tot_conc + imp_op_ex + imp_trib` (identidad de ARCA), como restricción de tabla.
2. **El total es la suma de los renglones** (defecto D-01): la factura de 726,05 que el original dejaba en 430,95 es rechazada.
3. Exento y no gravado en campos separados (D-02); una columna de IVA por alícuota, incluida la del 27 %.
4. NC con comprobante de origen, misma letra y misma moneda; una venta no se autoriza sin condición IVA del receptor.
5. Recibos y pagos: `imputado + a cuenta = medios + retenciones + descuentos`; no se imputa más que el saldo; una retención practicada no cabe en un cobro.
6. Un asiento solo se contabiliza balanceado, con cuentas imputables y en período aceptado.
7. Cada empresa ve solo lo suyo (probado con una segunda empresa y rol sin privilegios).

## 4. Hallazgos de la validación

- Un `IF ... THEN` de PL/pgSQL corta en el primer `THEN`: los `CASE` van en una variable.
- Cargar movimientos de caja a mano dejaba movimientos huérfanos de borradores: ahora los genera el trigger al confirmar y los contrarresta al anular.

## 5. Pendiente y decisiones abiertas

- **Contador:** significado del `ImporteImp` original (¿no imponible, base mínima o retención mínima?); método de costeo; si el bloqueo por vencimiento debe estar activo.
- **Catálogos ARCA:** cargarlos desde `FEParamGet*` y confirmar RG 5616, 5707, 5782 (ver [REFERENCIA_ODOO_ARGENTINA.md](REFERENCIA_ODOO_ARGENTINA.md)).
- **Falta modelar:** precios, descuentos e IVA en presupuesto y pedido (hoy solo cantidad y precio unitario); reserva de stock por pedido; conciliación bancaria; generación automática de asientos (en la aplicación); presentaciones SICORE/SIRE; módulos con licencia del original (percepciones de venta, contabilidad) a partir de normativa; migración desde MySQL (`app.migracion = 'on'` permite carga histórica controlada).
- La verificación de renglones contra la cabecera en ventas con **descuento al pie** no se hace (la base sale del desglose).
