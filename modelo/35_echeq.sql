-- ECHEQ: cheque electrónico. Se carga a mano (el sistema NO está conectado a ningún banco ni a la Cámara: lo que pasa en el home banking se registra acá), y se distingue del cheque de papel por:
--   · su código de ECHEQ (el identificador que da el banco), único dentro de la empresa;
--   · su carácter (a la orden / no a la orden) y si es cruzado;
--   · la aceptación: un ECHEQ de un tercero que recibimos en un cobro queda pendiente hasta que el beneficiario (la empresa) lo acepta; hasta entonces no se puede depositar ni endosar.
-- La base impone lo de fondo: el código es obligatorio y único, esos datos no se cambian una vez cargado el cheque, un ECHEQ sin aceptar no sale de la cartera y uno "no a la orden" no se endosa a un tercero
-- (se transmite por cesión: [A verificar con el banco]). Los plazos y otras reglas oficiales del ECHEQ no se modelan: se consultan en el banco.
-- Va DESPUÉS de 34 y ANTES de 36 (el endurecimiento de Supabase, que siempre es el último).

alter table cheque
  add column es_echeq     boolean not null default false,
  add column echeq_codigo text check (echeq_codigo is null or length(btrim(echeq_codigo)) between 4 and 40),
  add column caracter     text   not null default 'a_la_orden' check (caracter in ('a_la_orden', 'no_a_la_orden')),
  add column cruzado      boolean not null default false,
  add column aceptado_en  date;
alter table cheque add constraint cheque_echeq_coherente check (
  (es_echeq and echeq_codigo is not null and (origen = 'tercero' or aceptado_en is null))
  or (not es_echeq and echeq_codigo is null and aceptado_en is null));
create unique index cheque_echeq_unico on cheque (empresa_id, lower(echeq_codigo)) where es_echeq and estado <> 'anulado';

create function fn_cheque_echeq_guardia() returns trigger language plpgsql as
$$
begin
  if current_setting('app.migracion', true) = 'on' then return new; end if;
  if (new.es_echeq, new.echeq_codigo, new.caracter, new.cruzado) is distinct from (old.es_echeq, old.echeq_codigo, old.caracter, old.cruzado) then
    raise exception 'Cheque %: los datos del ECHEQ (código, carácter, cruzado) no se modifican una vez cargado', old.id;
  end if;
  if old.aceptado_en is not null and new.aceptado_en is distinct from old.aceptado_en then
    raise exception 'Cheque %: un ECHEQ aceptado no se vuelve a aceptar ni se desacepta', old.id;
  end if;
  if new.es_echeq and new.origen = 'tercero' and old.estado = 'en_cartera' and new.estado in ('depositado', 'entregado') then
    if new.aceptado_en is null then
      raise exception 'El ECHEQ % todavía no fue aceptado: no se puede % hasta aceptarlo', new.numero, case new.estado when 'depositado' then 'depositar' else 'entregar' end;
    end if;
    if new.estado = 'entregado' and new.caracter = 'no_a_la_orden' then
      raise exception 'El ECHEQ % es no a la orden: no se endosa a un tercero (se transmite por cesión)', new.numero;
    end if;
  end if;
  return new;
end
$$;
create trigger trg_cheque_echeq_guardia before update on cheque for each row execute function fn_cheque_echeq_guardia();
