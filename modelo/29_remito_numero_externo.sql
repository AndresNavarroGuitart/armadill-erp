-- Remito de entrada: el número del remito del proveedor (el del papel que llega con la mercadería). El número interno lo sigue dando el sistema; el del proveedor sirve para
-- encontrar el remito y para que el mismo papel no se cargue dos veces. Una vez confirmado el documento, el número no se cambia (se agrega a la guardia).
-- Va DESPUÉS de 28 y ANTES de 30 (el endurecimiento de Supabase, que siempre es el último).

alter table documento_comercial add column numero_externo text check (numero_externo is null or length(btrim(numero_externo)) between 1 and 30);
create unique index documento_numero_externo_unico on documento_comercial (empresa_id, tipo, tercero_id, lower(numero_externo)) where numero_externo is not null and estado <> 'anulado';

create or replace function fn_documento_guardia() returns trigger language plpgsql as
$$
begin
  if current_setting('app.migracion', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' then raise exception 'Un documento se crea en borrador y se confirma después'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.estado <> 'borrador' then raise exception 'Un documento % no se borra: se anula', old.estado; end if;
    return old;
  end if;
  if old.estado <> 'borrador' and
     (new.tipo, new.punto_venta, new.numero, new.fecha, new.tercero_id, new.documento_origen_id, new.moneda, new.cotizacion, new.numero_externo)
     is distinct from
     (old.tipo, old.punto_venta, old.numero, old.fecha, old.tercero_id, old.documento_origen_id, old.moneda, old.cotizacion, old.numero_externo) then
    raise exception 'El documento % está % y no se modifica', old.id, old.estado;
  end if;
  if new.estado <> old.estado and (old.estado, new.estado) not in
     (('borrador','confirmado'), ('borrador','anulado'), ('confirmado','anulado')) then
    raise exception 'Transición de estado no permitida: % -> %', old.estado, new.estado;
  end if;
  return new;
end
$$;
