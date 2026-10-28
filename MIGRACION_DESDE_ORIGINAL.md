# Migración desde el sistema original (administraNET Gestión 4)

Estado: **maestros migrados y probados con los datos semilla del dump**. Comprobantes históricos, saldos iniciales, stock y retenciones: pendientes (sección 5).

## 1. Cómo funciona

- Código en [migracion/](migracion/): `leer_dump.mjs` (lector del `.sql` del original), `migrar.mjs` (`migrarMaestros`), `probar_migracion.mjs` (8 pruebas, `npm run test:migracion`).
- `migrarMaestros({ db, empresaId, leer, vigenteDesde })` recibe un **lector inyectable**: `leer(tabla)` devuelve filas `{columna: valor}`. Hoy se alimenta del dump; con la base real se reemplaza por una conexión MySQL **de solo lectura** con la misma forma, sin tocar nada más.
- **Idempotente:** `migracion_mapa` guarda id original → id nuevo; repetir la carga no duplica.
- **Nada se descarta en silencio:** cada cambio, omisión o dato dudoso queda en `migracion_incidencia` (info / aviso / error) con el valor original.
- Todo en una transacción: si falla, no queda nada a medias.
- Los saldos de clientes y proveedores **no se cargan**: se devuelven en `saldosIniciales` para generar el asiento de apertura y los comprobantes de saldo.

## 2. Mapeo de campos

| Original | Nuevo | Regla |
|---|---|---|
| `cliente` / `proveedor` | `tercero` (roles) | un solo tercero con rol; Consumidor Final = tipo 99, nro `0` |
| `IDIva` | `condicion_iva_codigo` ARCA | 1→1, 2→6, 3→4, 4→5, 5→9, 6→1, 7→1, 8→15; se pierde "RI M / CBU" (incidencia info); desconocida → 7 (aviso) |
| `tipo_doc` / CUIT | `tipo_documento_codigo` | CUIT 80, CUIL 86, DNI 96, NOID 99; CUIT/CUIL inválido o ficticio → 99 y `SIN-C<cod>` / `SIN-P<cod>` + aviso |
| `cond_venta.Dias` | `condicion_pago_dias` | |
| `cliente.ListaPrecio` ("Lista N") | `lista_precio_id` | posición N de `configuracion.desc_utilN` (las "-" no se migran) |
| `proveedor` Tipo "Comisionista" o sin nombre | se omite | incidencia info |
| `proveedor.CodCatRet*` / `cod_ret_iva` | pendiente | incidencia info: se convierten a regímenes de retención con el contador |
| `rubro` / `subrubro` | `rubro` con `padre_id` | el nombre es único dentro del padre |
| `deposito` | `deposito` | `anulado='Si'` → inactivo |
| `articulo.tipo_art` | `tipo` | Servicio→servicio, Gasto→gasto, Bien…→bien_de_uso, resto→bien; `controla_stock` solo en bienes |
| `articulo.Alicuota` / `AlicuotaC` | tratamiento + alícuota ARCA | 21→5, 10,5→4, 27→6, 5→8, 2,5→9, 0→3; "Exento" y "No gravado" por nombre; desconocida → artículo no migrado (error) |
| `CodigoArticuloT` repetido | `codigo-<IDArt>` | aviso |
| `Discontinuo='Si'` | `activo=false` | |
| `Precio{n}V` | `articulo_precio` (neto) | solo el neto; el final se calcula |
| `PrecioCosto` | `articulo_costo` (origen manual) | |
| `Moneda` | `PES` / `DOL` | |

**Paridad de precios:** por cada lista se compara `Precio{n}VI` (final guardado por el original) con `neto × (1 + alícuota)` redondeado; si difieren más de 0,01 → aviso con ambos valores. El original guarda los dos y puede desincronizarse.

## 3. Resultado con la semilla del dump

2 clientes, 1 proveedor comercial (2 omitidos), 3 artículos (uno con código repetido `1.1.1`), 3 rubros y 4 subrubros, 1 depósito, listas Contado y Lista, 0 discrepancias de precio. El "Cliente 1" trae el CUIT ficticio `00-00000000-0`: se migra sin identificación y con aviso.

## 4. Hallazgo en el modelo

El CUIT `00000000000` cerraba el dígito verificador y pasaba la validación. `fn_cuit_valido` (SQL) y `cuitValido` (migración) ahora exigen un prefijo asignado por ARCA (20, 23, 24, 25, 26, 27, 30, 33, 34, 50, 51, 55); hay prueba en el modelo.

## 5. Pendiente

- Comprobantes históricos, saldos iniciales (asiento de apertura), stock inicial, cheques en cartera, retenciones y categorías de retención.
- Significado del campo `ImporteImp` del original, método de costeo y bloqueo por vencimiento: decisiones del contador.
- **Datos reales:** hay que acceder a la base MySQL del cliente. Las credenciales no están a mano; el lector de solo lectura se agrega cuando existan, y la migración corre primero en copia.
