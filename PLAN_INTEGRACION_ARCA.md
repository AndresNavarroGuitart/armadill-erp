# Plan de integración con ARCA (2026-10-28)

Lo que ya está hecho y probado sin credenciales: el **constructor del pedido FECAESolicitar** ([arca/payload.mjs](arca/payload.mjs), 8 pruebas con `node arca/probar_payload.mjs`). Toma un comprobante del modelo de datos y arma el pedido; valida antes de enviar (condición del receptor RG 5616, nota con comprobante asociado, fechas de servicio, factura C sin IVA, total = suma de partes).
Todo lo marcado **[A verificar]** sale de conocimiento general y de blogs: contrastarlo con el manual oficial de WSFEv1 antes de producción (ver [REFERENCIA_ODOO_ARGENTINA.md](REFERENCIA_ODOO_ARGENTINA.md), sección 4).

## 1. Piezas

| Pieza | Qué hace | Tablas del modelo | Estado |
|---|---|---|---|
| Certificados | CSR, alta del certificado, vencimiento; la clave privada va a un almacén de secretos | `arca_certificado` | modelo listo |
| WSAA | firma el pedido de acceso (CMS) con el certificado y devuelve token y firma (~12 h, se cachean) | `arca_ticket_acceso` | falta código |
| Parámetros | `FEParamGet*`: tipos de comprobante, alícuotas, tipos de documento, condición del receptor, monedas; reemplaza las semillas `verificado = false` | catálogos `arca_*` | falta código |
| Numeración | `FECompUltimoAutorizado` + 1 por punto de venta y tipo; el número se asigna al autorizar | `comprobante.numero` | falta código |
| Autorización | `FECAESolicitar`: el pedido ya se arma; falta firmar, enviar e interpretar `A`/`R`/`P`, CAE, vencimiento y observaciones | `comprobante`, `arca_solicitud` | **pedido hecho**; falta el cliente SOAP |
| Contingencia | CAEA solo si ARCA no responde (RG 5782/5785, a confirmar) | `arca_caea` | modelo listo |
| Padrón | validar CUIT/CUIL, estado de clave, condición de IVA, domicilio al dar de alta un tercero | `arca_padron_consulta` | falta código |
| Validar compras | `ComprobanteConstatar` (WSCDC) sobre facturas recibidas [A verificar] | `comprobante` (compra) | falta código |
| QR y PDF | QR del comprobante autorizado e impresión [A verificar RG 4892] | `comprobante` | falta código |

## 2. Reglas que ya impone el modelo

1. Una factura electrónica no se autoriza sin `cae`, número ni condición del receptor.
2. Una vez autorizada no se modifica ni se anula: se corrige con una nota de crédito.
3. Cada llamada a ARCA queda en `arca_solicitud` (solo agregar), con pedido, respuesta y duración.
4. El rechazo (`R`) deja el comprobante en `rechazado` y permite volver a borrador para corregir.

## 3. Orden de trabajo propuesto

1. **Homologación primero.** Cliente WSAA y `FEParamGet*` contra el ambiente de prueba; cargar los catálogos reales.
2. `FECompUltimoAutorizado` y `FECAESolicitar` con el pedido ya construido; guardar CAE y la bitácora.
3. NC con comprobante asociado, factura C y servicios (los casos ya están en las pruebas del pedido).
4. Padrón y validación de compras.
5. Producción, con certificado de producción y punto de venta de Web Services.

## 4. Lo que necesito de Andrés

| Dato | Para qué |
|---|---|
| CUIT de prueba con clave fiscal | emitir el certificado de homologación (no usar un CUIT real de un cliente sin su autorización) |
| Si ya hay punto de venta de **Web Services** | sin él no se puede emitir; el de "controlador fiscal" no sirve |
| Tipos de factura a emitir | A, B, C, M, E, FCE MiPyME o bono fiscal: define qué servicios se implementan |
| Dónde se guardan los secretos | almacén de secretos o variables protegidas; **nunca** en la base ni en el repositorio |
| Quién valida los casos | un contador que revise IVA, retenciones y percepciones |

## 5. Límites y riesgos

- El cliente SOAP real **no está probado**: sin certificado no se puede. El pedido y sus reglas sí.
- Fechas y obligaciones nuevas (RG 5616, 5707, 5782/5785) salen de blogs: confirmar en la resolución.
- La clave privada y los tokens son secretos: el modelo guarda solo referencias y valores cifrados.
- Emitir comprobantes reales tiene efecto legal: toda prueba en homologación; producción solo con el contador.
