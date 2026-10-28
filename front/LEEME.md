# Prototipo de interfaz

Prototipo navegable (HTML + CSS + JS, sin build ni backend) para definir la dirección visual y la forma de trabajar del sistema. **Todos los datos son de ejemplo** y la emisión de CAE está **simulada**.

Ver: `http://localhost:3007/administranet-replica/front/index.html` (servidor `quick-consultant` de `.claude/launch.json`).

## Qué muestra

| Pantalla | Idea |
|---|---|
| Inicio | Una empresa "en una mirada": KPIs animados, caja y bancos con cursor, **qué hacer hoy** y próximos vencimientos |
| Estudio | La cartera completa ordenada por urgencia (semáforo); entrar a una empresa con un clic |
| **Ventas** | Presupuestos → pedidos → remitos → facturas, clientes y precios. **Se crean desde cero** (`Nuevo presupuesto / pedido / remito`) con precios por lista del cliente, descuento por renglón (tope 20 % para el rol), control de stock y aviso de deuda vencida; el remito descuenta stock y se rechaza si no alcanza. Cada documento se abre con su recorrido y sus acciones: editar el borrador, enviar, aceptar o rechazar, convertir en pedido, generar remito, facturar (lo remitido, o el remito completo), anular remito (devuelve el stock), cancelar pedido. **Clientes:** alta y edición con CUIT validado (dígito y prefijo), condición IVA coherente con el documento (RG 5616) y control de duplicados; cobro con recibo, caja o banco y asiento. **Precios:** lista General, Mayorista (−10 %) y Minorista (+8 %); un cambio rige para los documentos nuevos y avisa si queda bajo el costo |
| **Compras** | Órdenes de compra → recepciones → facturas de compra, proveedores y **Stock**. **Se crean desde cero**: la orden avisa si el precio se aparta más de 15 % del último costo; la recepción se hace contra la orden (total o parcial, **no deja recibir más de lo pedido**) e ingresa el stock; la factura se carga contra la recepción, valida el formato y los duplicados, avisa si difiere de lo recibido, genera la deuda y el crédito fiscal y **actualiza el costo** (se ve enseguida en Precios y en el valor del stock). **Pagos** con medio y cuenta, sin sobregiro. Se puede anular una recepción (rechaza si ya salió stock) y una factura. **Proveedores:** alta y edición con CUIT validado y control de duplicados. **Stock:** existencias por depósito con alerta de mínimo, libro de movimientos (ID `MV-…`, solo agregar), depósitos y ajuste de inventario |
| **Finanzas** | **Tesorería** (cajas y bancos, cheques, cobros y pagos), **Contabilidad** (libro diario con asientos que se generan solos desde los comprobantes, plan de cuentas, sumas y saldos que verifican Debe = Haber) e **Impuestos** (posición de IVA, libros de IVA, retenciones, vencimientos; para monotributo, solo la cuota) |
| Estudio y Trazabilidad | Siguen abajo en el menú: son del estudio, no de una empresa |
| Nueva factura | El tipo (A/B/C) se elige solo según el cliente; vista previa del comprobante en vivo; chequeos de reglas (RG 5616, fechas de servicio, total = suma de renglones); panel "cómo se lo enviamos a ARCA" |
| Trazabilidad | Registro de solo lectura de cada movimiento: **fecha, hora, usuario, actividad, empresa y resultado**. Filtros por tipo, período, usuario, empresa y texto; cada fila se abre para ver origen (IP/equipo), antes → después y la huella. Exporta a CSV lo que se ve y verifica la integridad |
| Paleta de comandos | `Ctrl K`: ir a una pantalla, cambiar de empresa, facturarle a un cliente |

## Cómo está organizado el menú

`Inicio` · `Ventas` · `Compras` (con Stock) · `Finanzas` (con Tesorería, Contabilidad e Impuestos). Cada módulo tiene sus solapas y números clave arriba (se puede entrar a cada uno con un clic). Todo se alcanza también con `Ctrl K` ("Compras · Stock · Movimientos").

Las acciones entre documentos mueven datos de verdad dentro de la pestaña y **dejan rastro en la trazabilidad**: convertir un presupuesto, generar un remito, registrar una recepción, pagar una factura o ajustar stock. Lo que todavía es solo un aviso ("próximamente en el prototipo"): asientos manuales, transferencias entre depósitos, la conciliación bancaria, cobros y pagos desde cero en Tesorería y el PDF de los documentos.

El costo de un artículo es **el de la última factura de compra** (método "último costo" del modelo); el promedio ponderado queda como parámetro por empresa.

Los datos son de ejemplo y consistentes entre sí: el stock se deriva de los movimientos, los asientos de los comprobantes, el IVA de las facturas y el balance de los asientos.

## Decisiones de diseño

- **Se navega por intención, no por menús:** paleta de comandos y cambio de empresa siempre a mano (el estudio salta entre empresas todo el día).
- **El sistema avisa antes de que el error ocurra:** los chequeos de la factura salen de las reglas del modelo, no de un mensaje al final.
- **Paleta provisoria:** verdes y azules definidos como variables al inicio de `estilos.css` (`:root` y `[data-theme="dark"]`). Cuando esté la marca se cambian ahí y todo se re-pinta. Ámbar y rojo se usan solo para estados (vencimientos, errores).
- Tema claro y oscuro, responsive (barra inferior en celular), respeta `prefers-reduced-motion`.
- Tipografías: Bricolage Grotesque (títulos), Geist y Geist Mono (interfaz y cifras). Se cargan de Google Fonts; sin conexión cae a la tipografía del sistema.

## Trazabilidad: qué es real y qué es de ejemplo

- Los ~160 movimientos de los últimos 30 días y los 4 usuarios son **inventados** (`datos.js`). Lo que hacés en el prototipo (iniciar, cambiar de empresa, guardar borrador, emitir, exportar, verificar) se agrega al registro mientras la pestaña esté abierta; al recargar vuelve al ejemplo.
- Es de solo lectura: la pantalla no tiene ninguna acción de editar ni borrar. Que verificar la integridad y exportar también queden registrados es intencional (ISO 27001: quién consultó o sacó información).
- **La huella es demostrativa** (FNV, en el navegador). En el producto la calcula el servidor con SHA-256 encadenada, sobre una tabla de solo agregar.
- El CSV neutraliza valores que empiezan con `=`, `+`, `-` o `@` para que Excel no los ejecute como fórmula.
- **Modelo:** ya está en `modelo/12_trazabilidad.sql` (tabla `evento` de solo agregar con cadena de huellas SHA-256 por estudio, `fn_registrar_evento`, `fn_verificar_trazabilidad`, vista `v_trazabilidad`) y se prueba en `npm run test:modelo`. Para conectar la pantalla falta la API (y que escriba los eventos de ingreso, exportación y rechazo de ARCA), el permiso `trazabilidad.ver` en el catálogo de permisos, y **resguardar la cabeza de la cadena** (`v_trazabilidad_cabeza`) fuera de la base cada cierto tiempo: quitar los últimos eventos no rompe la cadena. Definir también cuántos años se conserva (ISO 27001).

## Para pasar a producto

Este código es de diseño: la versión real sería React + TypeScript consumiendo la API (ver el stack acordado). Los cálculos de la factura acá son una versión simple; en el producto los hace el motor de reglas de `../reglas/`.
