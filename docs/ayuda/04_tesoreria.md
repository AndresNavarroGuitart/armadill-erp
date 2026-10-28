## Cómo conciliar el banco
Palabras clave: conciliar, conciliacion, extracto, banco, comision bancaria
Pantallas: finanzas/tesoreria/conciliacion
En **Finanzas → Tesorería → Conciliación → Banco contra libros**, se elige la cuenta.
1. **Importar extracto** trae los movimientos del banco.
2. **Sugerir** concilia solo las coincidencias únicas por importe.
3. Lo que queda se concilia a mano: se marcan partidas de los dos lados (los importes tienen que sumar igual) y **Conciliar selección**.
4. Las comisiones e impuestos del banco se pasan a los libros con **Registrar en libros**, que también crea el asiento.
5. Una conciliación se puede deshacer y queda constancia.
El cuadro "Cómo cierra" explica la diferencia entre el saldo del banco y el de los libros ("no explicada" debe ser cero).

## Cómo conciliar dos archivos (CSV o Excel)
Palabras clave: archivo, archivos, excel, csv, planilla, conciliar archivos, dos archivos
Pantallas: finanzas/tesoreria/conciliacion
En **Conciliación → Entre dos archivos**:
1. Subir el **archivo A** y el **archivo B** (CSV, TSV, TXT o Excel). Se leen en el navegador: no se suben a ningún servidor.
2. Cada archivo muestra sus columnas con el tipo detectado (fecha, importe, texto).
3. Elegir **qué comparar**: pares de columnas (importe con tolerancia en pesos, fecha con tolerancia en días, texto igual o contiene). Hay una opción para ignorar el signo del importe.
4. **Conciliar**: aparece la planilla con el **% de conciliación** de cada lado (filas e importes) y las listas de lo conciliado y lo pendiente.
5. Lo pendiente se puede conciliar a mano, y todo se baja a CSV.

## Cheques
Palabras clave: cheque, cheques, depositar, diferido, acreditar, rechazado
Pantallas: finanzas/tesoreria/cheques
En **Tesorería → Cheques** se toca un cheque para ver sus acciones. Un cheque **recibido** se deposita (si es diferido, recién desde su fecha) y después el banco lo **acredita** (sube el saldo) o lo **rechaza** (vuelve a figurar la deuda del cliente). Un cheque **propio** se debita del banco cuando lo cobra el beneficiario, si hay fondos.

## Transferencias entre cuentas
Palabras clave: transferir, transferencia, entre cuentas, deposito de efectivo
Pantallas: finanzas/tesoreria
En **Tesorería → Cajas y bancos → Transferir entre cuentas** se elige origen, destino e importe. No se permite sobregiro y se genera el asiento (salvo entre dos bancos).
