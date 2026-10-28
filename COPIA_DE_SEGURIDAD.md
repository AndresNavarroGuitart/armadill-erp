# Copia de seguridad de la base administraNET (2026-10-27)

- **Qué es:** copia en frío de `C:\administraNET\mysql\data` (MySQL 5.7), hecha con el servicio apagado (el log de la copia termina en `Shutdown complete`, apagado limpio).
- **Dónde está:** `C:\administraNET\BACKUP_antes_de_pruebas\data_2026-10-27\`
- **Cómo se hizo:** [backup_en_frio.ps1](backup_en_frio.ps1), ejecutado como administrador por Andrés.
- **Verificación:** 1130 archivos / 650,0 MB en la copia contra 1132 / 662,0 MB en el origen. Coinciden exactamente las bases `administranet` (46,7 MB), `empresas` (2,2 MB) y `mysql` (11,9 MB), y no difieren `ibdata1` ni los `ib_logfile*`. Las únicas diferencias son archivos que MySQL regenera o amplía al reiniciar: `ibtmp1` (temporal), el `.pid` y los logs `errores.txt` y `consultas_lentas.txt`.
- **Importante:** es una copia del **estado inicial, sin datos de prueba** (las dos bases con las semillas de ejemplo). Hay que mantenerla intacta.

## Restauración realizada (2026-10-27, 19:24)

Tras las pruebas del TPV (artículo "PRUEBA TPV" y factura FB 0001-00000001) Andrés ejecutó [restaurar_copia.ps1](restaurar_copia.ps1) como administrador. Resultado: servicio `Running`, puerto 30804 abierto, `data` con 1132 archivos / 662 MB (la copia limpia más lo que MySQL regenera al iniciar).
Verificación posterior en disco: `articulo.ibd`, `cuentacliente.ibd`, `caja.ibd` y `codmov.ibd` tienen **el mismo hash que la copia limpia y distinto del de la base con pruebas**; las demás tablas tocadas por la venta (`stock`, `stock_deposito`, `talonarios`, `precios_historial`) estaban abiertas por MySQL y no se pudo hashear, pero coinciden en tamaño con la copia. No hay ninguna diferencia de tamaño en los archivos de datos. No se consultó la base viva (no hay credenciales de MySQL).
La base con los datos de prueba se conserva en `C:\administraNET\mysql\data_con_pruebas_20261027-192435` (borrar cuando ya no haga falta).

## Segunda restauración realizada (2026-10-28, 10:11)

Tras las pruebas de IVA, retenciones y percepciones (ver [PRUEBA_IMPUESTOS.md](PRUEBA_IMPUESTOS.md)): artículos 4 a 8, FB 0001-00000001, FA 0001-00001234 y 0001-00001235, OP 0001-00000001 y 0001-00000002, certificado de retención IIBB Nº 1, año fiscal 2026 y períodos editados.

Andrés cerró el Supervisor con `Stop-Process -Name Supervisor_administraNET -Force` (la primera vez el script se detuvo porque seguía abierto) y ejecutó [restaurar_copia.ps1](restaurar_copia.ps1). Resultado: servicio `Running`, puerto 30804 abierto, `data` con 1132 archivos / 662,0 MB frente a 1130 archivos / 650,0 MB de la copia limpia (la diferencia son archivos que MySQL regenera al iniciar).
Verificación posterior en disco: las 813 tablas de `administranet` coinciden en nombre con la copia, y `cuentacliente.ibd`, `cuentaproveedor.ibd` y `articulo.ibd` tienen **el mismo hash que la copia limpia y distinto del de la base con pruebas**. `periodos`, `years` y `retenciones_prov` estaban abiertas por MySQL y no se pudieron hashear. No se consultó la base viva (sin credenciales de MySQL).
**Comprobado desde el cliente (2026-10-28, 10:14):** el calendario fiscal (Archivo > Variables > Impositivas > Año y período) volvió a estar **vacío**, como en la base limpia; el Proveedor 1 tiene saldo **800** y su única deuda es el ajuste AJD 0001-00000001 de 800, sin facturas FA, sin órdenes de pago y con 0 a cuenta. La base quedó limpia.
Aclaración sobre el calendario: la base viva **no trae** los períodos 2024-2025 que aparecen en el dump SQL; los 24 períodos que se veían en las pruebas surgieron al dar de alta el año 2026 (el cliente generó los de 2024 junto con los de 2026).
La base con las pruebas de impuestos está en `C:\administraNET\mysql\data_con_pruebas_20261028-101137`. Hay otra, de la primera restauración, en `data_con_pruebas_20261027-192435`. Las dos se pueden borrar cuando ya no hagan falta.

## Tercera restauración realizada (2026-10-28, 11:20)

Tras el lote de cálculo de IVA en compras y ventas (ver [PRUEBAS_CAJA_NEGRA.md](PRUEBAS_CAJA_NEGRA.md)): año fiscal 2026 y período editado, artículos 4 a 8 más los huérfanos creados sin rubro, tres facturas de compra (FA 0001-00002001 a 0001-00002003), dos facturas de venta (FA 0001-00000001 y 0001-00000002) y la nota de crédito NCA 0001-00000001.

Andrés cerró el Supervisor y ejecutó [restaurar_copia.ps1](restaurar_copia.ps1). Verificación en disco: servicio `Running` con un `mysqld` nuevo (PID 2960), puerto 30804 abierto, y `cuentacliente.ibd`, `cuentaproveedor.ibd`, `articulo.ibd` y `caja.ibd` con **el mismo hash que la copia limpia**; `stock.ibd` estaba abierta por MySQL y no se pudo hashear. No se abrió el cliente en esta ocasión.
La base con las pruebas quedó en `C:\administraNET\mysql\data_con_pruebas_20261028-112025`. Hay ahora **tres** carpetas `data_con_pruebas_*` (`20261027-192435`, `20261028-101137`, `20261028-112025`), de unos 650 MB cada una: se pueden borrar cuando no hagan falta.

## Cuarta restauración realizada (2026-10-28, 11:36)

Tras el lote de stock, cobranzas, TPV y dólar (ver [PRUEBAS_CAJA_NEGRA.md](PRUEBAS_CAJA_NEGRA.md)): año fiscal 2026 con el vencimiento de Octubre 2024 editado, artículos 4 (PRUEBA IVA 21) y 5 (PRUEBA USD en dólares), dos facturas de compra (FA 0001-00003001 y 0001-00003002), la factura A 0001-00000001 con el recibo REC 0001-00000001 (retención IIBB 15, certificado 12345) y la factura B 0001-00000001 del TPV.

Andrés cerró el Supervisor y ejecutó [restaurar_copia.ps1](restaurar_copia.ps1). Verificación en disco: servicio `Running` con un `mysqld` nuevo (PID 13188), puerto 30804 abierto, y `cuentacliente.ibd`, `cuentaproveedor.ibd`, `articulo.ibd` y `caja.ibd` con **el mismo hash que la copia limpia**; `retenciones.ibd` y `cuerpostock.ibd` estaban abiertas por MySQL y no se pudieron hashear. No se abrió el cliente.
La base con las pruebas quedó en `C:\administraNET\mysql\data_con_pruebas_20261028-113633`. Ya hay **cuatro** carpetas `data_con_pruebas_*` (~650 MB cada una): conviene borrar las tres anteriores.

## Quinta restauración realizada (2026-10-28, 11:57)

Tras los lotes de percepciones en compras, pago mixto en el TPV y nota de crédito por devolución parcial: año fiscal 2026 con el vencimiento de Octubre 2024 editado, artículo 4, FA de compra 0001-00004001 (con percepciones Gan 30 e IVA 20) y 0001-00004002, FB 0001-00000001 (pago mixto), FA de venta 0001-00000001 y NCA 0001-00000001. La configuración de percepciones y contabilidad **no** se guardó (el sistema pide contratar los módulos).

Andrés cerró el Supervisor y ejecutó [restaurar_copia.ps1](restaurar_copia.ps1). Verificación en disco: servicio `Running` con un `mysqld` nuevo (PID 16172), puerto 30804 abierto, y `cuentacliente.ibd`, `cuentaproveedor.ibd`, `articulo.ibd` y `caja.ibd` con **el mismo hash que la copia limpia**; `percepcion.ibd` y `years.ibd` estaban abiertas por MySQL y no se pudieron hashear. No se abrió el cliente.
La base con las pruebas quedó en `C:\administraNET\mysql\data_con_pruebas_20261028-115723`. Hay ahora **cinco** carpetas `data_con_pruebas_*` (~650 MB cada una, ~3 GB en total): conviene borrar las cuatro anteriores.

## Cómo restaurar (si las pruebas dejan la base sucia)

Preferir el script [restaurar_copia.ps1](restaurar_copia.ps1). Pasos manuales equivalentes:

Como administrador, con el cliente y el Supervisor cerrados:

1. Apagar el servicio: `Stop-Service 'administraNET MySQL'`.
2. Renombrar `C:\administraNET\mysql\data` a `data_con_pruebas` (no borrarla hasta confirmar).
3. Copiar la carpeta `data_2026-10-27` a `C:\administraNET\mysql\data`.
4. Encender el servicio: `Start-Service 'administraNET MySQL'`.
5. Abrir el cliente y comprobar que los clientes y artículos de ejemplo están y no están los de prueba.

No se probó una restauración; esta nota es el procedimiento estándar para una copia en frío de InnoDB.
