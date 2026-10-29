-- Anulaciones y notas de crédito desde la aplicación: permiso propio, constancia de la anulación, renglón de origen de cada renglón de una
-- nota y las reglas que la base impone (no la API): no se anula lo que tiene cobros o notas aplicadas, y una nota nunca acredita más de lo facturado.
-- Va DESPUÉS de 21 y ANTES de 25 (el endurecimiento de Supabase, que siempre es el último).

insert into permiso (clave, modulo, descripcion) values ('ventas.anular', 'ventas', 'Anular facturas y notas de crédito');
insert into rol_permiso (rol_id, permiso_clave)
  select r.id, 'ventas.anular' from rol r where r.nombre in ('Administrador', 'Contador')
  on conflict do nothing;

-- Quién anuló, cuándo y por qué (el comprobante conserva su número: un número emitido nunca se reutiliza).
alter table comprobante
  add column motivo_anulacion text check (motivo_anulacion is null or length(btrim(motivo_anulacion)) between 3 and 200),
  add column anulado_en       timestamptz,
  add column anulado_por      bigint references usuario(id);

-- Qué renglón de la factura acredita cada renglón de una nota de crédito.
alter table comprobante_item add column item_origen_id bigint references comprobante_item(id);
create index comprobante_item_origen on comprobante_item (item_origen_id) where item_origen_id is not null;

create function fn_item_origen_coherente() returns trigger language plpgsql as
$$
declare v_origen bigint; v_factura bigint;
begin
  if new.item_origen_id is null then return new; end if;
  select comprobante_origen_id into v_origen from comprobante where id = new.comprobante_id;
  select comprobante_id into v_factura from comprobante_item where id = new.item_origen_id;
  if v_origen is null or v_factura is distinct from v_origen then
    raise exception 'El renglón de origen no pertenece a la factura que acredita la nota';
  end if;
  return new;
end
$$;
create trigger trg_item_origen_coherente before insert on comprobante_item for each row execute function fn_item_origen_coherente();

-- Una nota de crédito nunca acredita, en total, más de lo facturado en cada renglón (contando las demás notas vigentes; una anulada devuelve su cantidad).
create function fn_verificar_nota_cantidades() returns trigger language plpgsql as
$$
declare r record;
begin
  for r in
    select o.id, o.cantidad as facturada, sum(i.cantidad) as acreditada
      from comprobante_item o
      join comprobante_item i on i.item_origen_id = o.id
      join comprobante n on n.id = i.comprobante_id and n.estado in ('confirmado', 'autorizado')
     where o.id in (select item_origen_id from comprobante_item where comprobante_id = new.id and item_origen_id is not null)
     group by o.id, o.cantidad
  loop
    if r.acreditada > r.facturada then
      raise exception 'Las notas de crédito acreditan % del renglón % y se facturó %', r.acreditada, r.id, r.facturada;
    end if;
  end loop;
  return null;
end
$$;
create constraint trigger trg_nota_cantidades after update of estado on comprobante
  deferrable initially immediate for each row
  when (old.estado in ('borrador', 'rechazado') and new.estado in ('confirmado', 'autorizado'))
  execute function fn_verificar_nota_cantidades();

-- No se anula un comprobante del que otros dependen.
create function fn_anulacion_dependencias() returns trigger language plpgsql as
$$
begin
  if exists (select 1 from pago_imputacion i join pago p on p.id = i.pago_id and p.estado = 'confirmado' where i.comprobante_id = old.id) then
    raise exception 'El comprobante tiene cobros o pagos imputados: anulá primero esos recibos.';
  end if;
  if exists (select 1 from comprobante_aplicacion a join comprobante n on n.id = a.nota_id where a.factura_id = old.id and n.estado in ('confirmado', 'autorizado')) then
    raise exception 'El comprobante tiene notas de crédito aplicadas: anulá primero esas notas.';
  end if;
  if exists (select 1 from comprobante_aplicacion a where a.nota_id = old.id) then
    raise exception 'La nota está aplicada a una factura: deshacé la aplicación antes de anularla.';
  end if;
  return new;
end
$$;
create trigger trg_comprobante_anulacion before update of estado on comprobante
  for each row when (new.estado = 'anulado' and old.estado = 'confirmado') execute function fn_anulacion_dependencias();   -- un autorizado no llega acá: la guardia de estados ya lo rechaza
