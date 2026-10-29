-- Stock y listas de precios desde la aplicación: permisos propios, stock mínimo por artículo, motivo de cada movimiento y reglas de depósitos.
-- Va DESPUÉS de 20 y ANTES de 22.

insert into permiso (clave, modulo, descripcion) values
  ('stock.ver',      'stock',    'Ver existencias y movimientos de stock'),
  ('stock.ajustar',  'stock',    'Ajustar y transferir stock, y administrar depósitos'),
  ('listas.editar',  'maestros', 'Crear y modificar listas de precios y ajustar precios en bloque');

-- Los roles base que ya existen reciben lo que les corresponde (fn_roles_base ya lo hace para los estudios nuevos: Administrador y
-- Contador todo; Auxiliar y Consulta, solo lo que termina en ".ver").
insert into rol_permiso (rol_id, permiso_clave)
  select r.id, p.clave from rol r cross join permiso p
   where p.clave in ('stock.ver', 'stock.ajustar', 'listas.editar') and r.nombre in ('Administrador', 'Contador')
  on conflict do nothing;
insert into rol_permiso (rol_id, permiso_clave)
  select r.id, 'stock.ver' from rol r where r.nombre in ('Auxiliar', 'Consulta')
  on conflict do nothing;

-- Cantidad por debajo de la cual conviene reponer (suma de todos los depósitos). Nulo = sin aviso.
alter table articulo add column stock_minimo numeric(18,4) check (stock_minimo is null or stock_minimo >= 0);

-- Por qué se movió el stock (obligatorio en los ajustes y transferencias que hace una persona; los movimientos de comprobantes no lo llevan).
alter table movimiento_stock add column motivo text check (motivo is null or length(btrim(motivo)) between 3 and 200);

-- Un depósito con existencias no se da de baja, y la empresa siempre conserva al menos uno activo (sin depósito no se puede facturar bienes).
create function fn_proteger_deposito() returns trigger language plpgsql as
$$
begin
  if old.activo and not new.activo then
    if exists (select 1 from movimiento_stock m where m.deposito_id = old.id group by m.articulo_id having sum(m.cantidad) <> 0) then
      raise exception 'El depósito % todavía tiene existencias: transferilas a otro depósito antes de darlo de baja.', old.nombre;
    end if;
    if not exists (select 1 from deposito d where d.empresa_id = old.empresa_id and d.activo and d.id <> old.id) then
      raise exception 'La empresa necesita al menos un depósito activo.';
    end if;
  end if;
  return new;
end
$$;
create trigger trg_deposito_proteger before update of activo on deposito for each row execute function fn_proteger_deposito();
revoke execute on function fn_proteger_deposito() from public;
