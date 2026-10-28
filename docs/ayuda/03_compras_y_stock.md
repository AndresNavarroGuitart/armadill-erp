## Cómo comprar: orden, recepción y factura de compra
Palabras clave: compra, comprar, orden de compra, recepcion, factura de compra, proveedor, mercaderia
Pantallas: compras/nuevo/orden, compras/nuevo/recepcion, compras/nuevo/factura
1. **Orden de compra** (Compras → Órdenes de compra): lo que le pedís al proveedor. Avisa si el precio se aparta más de 15 % del último costo.
2. **Recepción**: cuando llega la mercadería se registra contra la orden, total o parcial, y el **stock ingresa** al depósito. No deja recibir más de lo pedido.
3. **Factura de compra**: se carga contra la recepción con el número del proveedor. Valida el formato del número, rechaza las duplicadas, avisa si difiere de lo recibido, genera la deuda y el crédito fiscal, y actualiza el costo.
4. **Pago**: desde la factura, con medio y cuenta; no permite sobregiro.
Una recepción se puede anular (devuelve el stock, salvo que ya haya salido); una factura de compra impaga se puede anular.

## Cómo dar de alta un proveedor
Palabras clave: proveedor, nuevo proveedor, alta proveedor
Pantallas: compras/proveedores
En **Compras → Proveedores → Nuevo proveedor** se piden razón social, CUIT (validado), condición frente al IVA y plazo de pago. Desde la ficha se crea una orden de compra, se pagan las facturas pendientes y se editan los datos.

## Cómo pagar a un proveedor
Palabras clave: pagar, pago, orden de pago, proveedor
Pantallas: compras/facturas, finanzas/tesoreria/cobros
Se abre la factura en **Compras → Facturas** y se toca **Registrar el pago**, o se usa **Registrar pago** en Tesorería. Se elige el medio y la cuenta de la que sale. Si la cuenta no tiene fondos, no deja avanzar. El pago genera la orden de pago, baja el saldo y crea el asiento. Se puede anular y la factura vuelve a figurar como pendiente.

## Cómo ajustar el stock
Palabras clave: ajuste, ajustar, inventario, stock, conteo, rotura
Pantallas: compras/stock, compras/stock/movimientos
En **Compras → Stock → Ajuste de inventario** se elige artículo, depósito, si es entrada o salida, la cantidad y el motivo (conteo físico, rotura, vencimiento, consumo interno u otro). El ajuste **no edita el stock**: agrega un movimiento al libro, con usuario y motivo, y el saldo se calcula desde ahí. Las existencias muestran el estado de cada artículo: normal, bajo el mínimo o sin stock.

## Stock y saldos nunca negativos
Palabras clave: negativo, stock negativo, sobregiro, fondos insuficientes
El sistema **no deja stock ni saldos negativos**. Un remito que pide más de lo que hay en el depósito se rechaza; una anulación de recepción que dejaría el stock en negativo también; y los pagos o transferencias sin fondos no se permiten (sin sobregiro). Cada rechazo queda en la trazabilidad.

## Cómo se calcula el costo de un artículo
Palabras clave: costo, ultimo costo, costeo, margen
Pantallas: ventas/precios
El costo de cada artículo es el de la **última factura de compra** cargada (método "último costo"). Al cargar una factura, el sistema actualiza el costo y se ve enseguida en **Precios** (margen) y en el valor del stock.
