## Qué es el CAE
Palabras clave: cae, codigo de autorizacion, arca, afip, factura electronica
Pantallas: nueva
El **CAE** (Código de Autorización Electrónico) lo entrega **ARCA** cuando valida el comprobante. Sin CAE, una factura electrónica no es válida, y el CAE tiene fecha de vencimiento. Al emitir, el sistema arma el pedido a ARCA con los importes (neto, IVA, exento, no gravado, tributos y total) y guarda el CAE junto al comprobante.

## Condición frente al IVA del receptor (RG 5616)
Palabras clave: 5616, condicion iva del receptor, condicion frente al iva, receptor
Pantallas: ventas/clientes
ARCA exige informar en cada factura la **condición frente al IVA del receptor** (RG 5616). Por eso cada cliente tiene cargada su condición y el sistema avisa si falta antes de emitir.

## Cómo se valida un CUIT
Palabras clave: cuit, cuil, digito verificador, validar cuit
El sistema valida el **CUIT/CUIL** con tres reglas: **11 dígitos**, un **prefijo** de los que asigna ARCA (20, 23, 24, 27, 30, 33, 34…) y el **dígito verificador** correcto. Un CUIT que cierra el dígito pero tiene un prefijo inexistente (como 00000000000) se rechaza. También avisa si ya existe un cliente o proveedor con ese documento.

## Qué es una nota de crédito
Palabras clave: nota de credito, nota de debito, devolucion
Pantallas: ventas/facturas
Una **nota de crédito** corrige o anula una factura ya autorizada: reduce lo que el cliente debe y genera el asiento inverso al de la factura. Una **nota de débito** agrega un importe (por ejemplo, intereses). Ninguna de las dos modifica la factura original. Todavía no están en el sistema.
