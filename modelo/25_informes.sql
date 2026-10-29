-- Informes contables desde la aplicación: un permiso de solo lectura. Los informes se derivan de las vistas y tablas que ya existen (libro de IVA,
-- posición de IVA, asientos, saldos de los comprobantes, retenciones); no se guarda nada nuevo.
-- Va DESPUÉS de 24 y ANTES de 28 (el endurecimiento de Supabase, que siempre es el último).

insert into permiso (clave, modulo, descripcion) values
  ('informes.ver', 'informes', 'Ver y exportar los informes contables (libros de IVA, balance, mayor, diario, antigüedad de deuda, retenciones)');
-- fn_roles_base ya se lo da a los estudios nuevos (Administrador y Contador todo; Auxiliar y Consulta lo ".ver"); acá se completan los que existen.
insert into rol_permiso (rol_id, permiso_clave)
  select r.id, 'informes.ver' from rol r where r.nombre in ('Administrador', 'Contador', 'Auxiliar', 'Consulta')
  on conflict do nothing;
