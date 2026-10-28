## Cómo emitir una factura
Palabras clave: factura, emitir, generar, nueva factura, cae, comprobante
Pantallas: nueva, ventas/facturas
1. Entrá a **Ventas → Facturas** y tocá **Nueva factura**.
2. Elegí el **cliente**: el sistema define solo el tipo (A, B o C) según su condición frente al IVA.
3. Completá fecha, concepto (productos o servicios; los servicios piden fechas "desde" y "hasta" y el vencimiento de pago) y moneda.
4. Cargá los **renglones**: al elegir el artículo trae el precio de la lista del cliente y su alícuota de IVA.
5. Mirá los **chequeos** de la derecha: tienen que estar todos en verde. El total es siempre la suma de los renglones.
6. Tocá **Emitir y pedir CAE**.
Si la empresa es monotributista, siempre emite Factura C y no discrimina IVA.

## Tipos de factura: A, B y C
Palabras clave: factura a, factura b, factura c, tipo de factura, tipos de factura, letra
Pantallas: nueva
La letra la define quién emite y a quién:
- **A**: emite un responsable inscripto y recibe un responsable inscripto o un monotributista.
- **B**: emite un responsable inscripto y recibe un consumidor final, un exento u otro.
- **C**: emite un monotributista (o un exento) y recibe cualquiera.
El sistema elige la letra solo al cargar el cliente. Existen otros tipos (M, E de exportación, FCE para MiPyMEs) que todavía no están en el sistema.

## Presupuesto, pedido, remito y factura: qué es cada uno
Palabras clave: diferencia, presupuesto, pedido, remito, factura, recorrido
Pantallas: ventas/presupuestos, ventas/pedidos, ventas/remitos, ventas/facturas
Es el recorrido de una venta, y cada paso es un documento distinto:
1. **Presupuesto**: la oferta con precios y validez. No mueve stock ni genera deuda.
2. **Pedido**: el cliente confirma qué quiere.
3. **Remito**: la entrega. Descuenta el stock y queda pendiente de facturar.
4. **Factura**: el documento fiscal. Genera la deuda, el IVA y el asiento contable.
Cada documento muestra arriba su recorrido (qué pasó y qué falta) y se convierte en el siguiente desde su detalle.

## Cómo crear un presupuesto, un pedido o un remito
Palabras clave: presupuesto, pedido, remito, cotizacion, crear, nuevo
Pantallas: ventas/nuevo/presupuesto, ventas/nuevo/pedido, ventas/nuevo/remito
1. Entrá a **Ventas** y elegí la solapa (Presupuestos, Pedidos o Remitos).
2. Tocá **Nuevo presupuesto**, **Nuevo pedido** o **Nuevo remito**.
3. Elegí el cliente y cargá los renglones: el precio sale de su **lista de precios** y se puede dar un descuento por renglón, hasta el tope del rol.
4. En el remito elegí el depósito: el sistema muestra cuánto hay y no deja entregar más del stock.
5. Después se convierten desde el detalle: presupuesto → pedido → remito → factura. Un presupuesto en borrador se puede editar.

## Cómo anular o corregir una factura
Palabras clave: anular, anulo, nota de credito, corregir, equivoque
Pantallas: ventas/facturas
Una factura **autorizada por ARCA no se edita ni se borra**: se corrige emitiendo una **nota de crédito**, que genera el asiento inverso. Mientras es un borrador sí se puede cambiar. Un remito sin facturar se puede anular (devuelve el stock) y un pedido sin entregas se puede cancelar. La nota de crédito todavía no está en el sistema.

## Cómo dar de alta o editar un cliente
Palabras clave: cliente, nuevo cliente, alta, editar cliente, cuit, plazo
Pantallas: ventas/clientes
En **Ventas → Clientes** tocá **Nuevo cliente**. Se piden nombre, tipo y número de documento, condición frente al IVA, plazo de pago y lista de precios. El sistema valida el CUIT, avisa si ya existe y exige CUIT a los responsables inscriptos, monotributistas y exentos. Desde la ficha del cliente se factura, se crea un presupuesto o pedido, se registra un cobro y se editan los datos.

## Precios y listas de precios
Palabras clave: precio, lista de precios, listas, mayorista, minorista, aumentar, cambiar precio, margen
Pantallas: ventas/precios
En **Ventas → Precios** se ve cada artículo con su costo, el precio de las listas **General**, **Mayorista** (10 % menos) y **Minorista** (8 % más) y el margen. Tocando un artículo se cambia el precio neto de la lista General; las otras se calculan solas. El cambio rige para los documentos **nuevos**; los ya emitidos no se tocan. Si el precio queda por debajo del costo, pide confirmación.

## Cómo registrar un cobro
Palabras clave: cobro, cobrar, recibo, me pagaron, cobranza
Pantallas: finanzas/tesoreria/cobros, ventas/clientes
En **Finanzas → Tesorería → Registrar cobro** (o desde la ficha del cliente) se elige al cliente, el importe (no puede superar su saldo) y el medio: transferencia, efectivo o cheque. El sistema genera el **recibo**, mueve la caja o el banco, cancela primero lo vencido y crea el asiento. Un recibo se puede **anular** desde Cobros y pagos; vuelve a figurar la deuda.
