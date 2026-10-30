-- Facturas de compra desde la aplicación: permisos propios. Las reglas de fondo (número único por proveedor, verificación de importes, asiento
-- automático, período abierto, anulación con contraasiento y sin pagos imputados) ya las imponen 06, 15 y 22.
-- Va DESPUÉS de 22 y ANTES de 30 (el endurecimiento de Supabase, que siempre es el último).

insert into permiso (clave, modulo, descripcion) values
  ('compras.ver',    'compras', 'Ver facturas de compra y el plan de cuentas'),
  ('compras.cargar', 'compras', 'Cargar facturas de compra de proveedores'),
  ('compras.anular', 'compras', 'Anular facturas de compra');

-- Roles base que ya existen (fn_roles_base ya lo hace para los estudios nuevos: Administrador y Contador todo; Auxiliar y Consulta, solo lo ".ver").
insert into rol_permiso (rol_id, permiso_clave)
  select r.id, p.clave from rol r cross join permiso p
   where p.clave in ('compras.ver', 'compras.cargar', 'compras.anular') and r.nombre in ('Administrador', 'Contador')
  on conflict do nothing;
insert into rol_permiso (rol_id, permiso_clave)
  select r.id, 'compras.ver' from rol r where r.nombre in ('Auxiliar', 'Consulta')
  on conflict do nothing;
