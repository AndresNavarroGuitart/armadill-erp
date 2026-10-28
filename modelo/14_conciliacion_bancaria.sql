-- Conciliación bancaria: el extracto del banco se importa, se CIERRA (verifica su saldo) y se concilia
-- contra los movimientos de tesorería de la cuenta. La conciliación es n a n y siempre balancea:
-- la suma de las líneas del extracto debe ser igual a la suma de los movimientos de los libros.
-- Las diferencias que quedan (cheques en tránsito, gastos no registrados) se ven en v_conciliacion_estado.

create table extracto_bancario (
  id                  bigint generated always as identity primary key,
  empresa_id          bigint not null references empresa(id),
  cuenta_bancaria_id  bigint not null references cuenta_bancaria(id),
  desde               date   not null,
  hasta               date   not null,
  saldo_inicial       importe not null,
  saldo_final         importe not null,
  origen              text   not null default 'archivo' check (origen in ('archivo','manual')),
  nombre_archivo      text,
  hash_archivo        text,                       -- evita importar dos veces el mismo archivo
  estado              text   not null default 'borrador' check (estado in ('borrador','cerrado')),
  importado_en        timestamptz not null default now(),
  check (hasta >= desde)
);
create unique index extracto_hash_unico on extracto_bancario (empresa_id, cuenta_bancaria_id, hash_archivo)
  where hash_archivo is not null;

create table conciliacion (
  id                  bigint generated always as identity primary key,
  empresa_id          bigint not null references empresa(id),
  cuenta_bancaria_id  bigint not null references cuenta_bancaria(id),
  fecha               date   not null,
  importe             importe not null,            -- suma de cada lado (iguales)
  estado              text   not null default 'vigente' check (estado in ('vigente','deshecha')),
  creado_por          bigint references usuario(id),
  creado_en           timestamptz not null default now()
);

create table extracto_linea (
  id              bigint generated always as identity primary key,
  empresa_id      bigint not null references empresa(id),
  extracto_id     bigint not null references extracto_bancario(id) on delete cascade,
  orden           integer not null,
  fecha           date   not null,
  descripcion     text,
  referencia      text,
  importe         importe not null check (importe <> 0),     -- + crédito (entra), - débito (sale)
  conciliacion_id bigint references conciliacion(id),
  unique (extracto_id, orden)
);
create index on extracto_linea (empresa_id, conciliacion_id);

alter table movimiento_tesoreria add column conciliacion_id bigint references conciliacion(id);

-- Guardias: un extracto cerrado no cambia (salvo marcar líneas conciliadas).
create function fn_extracto_guardia() returns trigger language plpgsql as
$$
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' then raise exception 'Un extracto se importa en borrador y se cierra después'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.estado <> 'borrador' then raise exception 'Un extracto cerrado no se borra'; end if;
    return old;
  end if;
  if old.estado = 'cerrado' and
     (new.cuenta_bancaria_id, new.desde, new.hasta, new.saldo_inicial, new.saldo_final, new.estado)
     is distinct from (old.cuenta_bancaria_id, old.desde, old.hasta, old.saldo_inicial, old.saldo_final, old.estado) then
    raise exception 'El extracto % está cerrado y no se modifica', old.id;
  end if;
  return new;
end
$$;
create trigger trg_extracto_guardia before insert or update or delete on extracto_bancario
  for each row execute function fn_extracto_guardia();

create function fn_extracto_linea_guardia() returns trigger language plpgsql as
$$
declare v_estado text;
begin
  select estado into v_estado from extracto_bancario where id = coalesce(new.extracto_id, old.extracto_id);
  if tg_op = 'UPDATE' and v_estado = 'cerrado'
     and (new.fecha, new.descripcion, new.referencia, new.importe, new.extracto_id, new.orden)
         is not distinct from (old.fecha, old.descripcion, old.referencia, old.importe, old.extracto_id, old.orden) then
    return new;                                   -- solo cambió conciliacion_id
  end if;
  if v_estado is not null and v_estado <> 'borrador' then
    raise exception 'El extracto está cerrado; sus líneas no se modifican';
  end if;
  return coalesce(new, old);
end
$$;
create trigger trg_extracto_linea_guardia before insert or update or delete on extracto_linea
  for each row execute function fn_extracto_linea_guardia();

-- Al cerrar: el saldo final debe ser el inicial más las líneas, las líneas deben caer en el rango,
-- y el saldo inicial debe continuar el del extracto anterior de la misma cuenta.
create function fn_extracto_cerrar() returns trigger language plpgsql as
$$
declare s_lineas importe; n int; fuera int; v_prev importe;
begin
  select coalesce(sum(importe), 0), count(*), count(*) filter (where fecha not between new.desde and new.hasta)
    into s_lineas, n, fuera from extracto_linea where extracto_id = new.id;
  if n = 0 then raise exception 'Extracto %: no tiene líneas', new.id; end if;
  if fuera > 0 then raise exception 'Extracto %: hay % líneas fuera del rango % a %', new.id, fuera, new.desde, new.hasta; end if;
  if new.saldo_final <> new.saldo_inicial + s_lineas then
    raise exception 'Extracto %: el saldo final % no es el inicial % más las líneas %', new.id, new.saldo_final, new.saldo_inicial, s_lineas;
  end if;
  select saldo_final into v_prev from extracto_bancario
   where empresa_id = new.empresa_id and cuenta_bancaria_id = new.cuenta_bancaria_id and estado = 'cerrado'
     and id <> new.id and hasta < new.desde order by hasta desc limit 1;
  if v_prev is not null and v_prev <> new.saldo_inicial then
    raise exception 'Extracto %: el saldo inicial % no continúa el saldo final anterior %', new.id, new.saldo_inicial, v_prev;
  end if;
  return null;
end
$$;
create constraint trigger trg_extracto_cerrar after update of estado on extracto_bancario
  deferrable initially immediate for each row
  when (old.estado = 'borrador' and new.estado = 'cerrado')
  execute function fn_extracto_cerrar();

-- Concilia un grupo: líneas del extracto contra movimientos de los libros. Todo o nada.
create function fn_conciliar(p_cuenta bigint, p_lineas bigint[], p_movimientos bigint[], p_fecha date default current_date)
returns bigint language plpgsql as
$$
declare v_emp bigint; v_n int; v_sl numeric; v_sm numeric; v_id bigint;
begin
  select empresa_id into v_emp from cuenta_bancaria where id = p_cuenta;
  if v_emp is null then raise exception 'La cuenta bancaria % no existe', p_cuenta; end if;
  if coalesce(array_length(p_lineas, 1), 0) = 0 or coalesce(array_length(p_movimientos, 1), 0) = 0 then
    raise exception 'Se concilian líneas del extracto contra movimientos de los libros: faltan de un lado';
  end if;
  select count(*), coalesce(sum(l.importe), 0) into v_n, v_sl
    from extracto_linea l join extracto_bancario e on e.id = l.extracto_id
   where l.id = any(p_lineas) and e.cuenta_bancaria_id = p_cuenta and e.estado = 'cerrado' and l.conciliacion_id is null;
  if v_n <> array_length(p_lineas, 1) then
    raise exception 'Alguna línea no existe, es de otra cuenta, no está en un extracto cerrado o ya está conciliada';
  end if;
  select count(*), coalesce(sum(importe), 0) into v_n, v_sm
    from movimiento_tesoreria where id = any(p_movimientos) and cuenta_bancaria_id = p_cuenta and conciliacion_id is null;
  if v_n <> array_length(p_movimientos, 1) then
    raise exception 'Algún movimiento no existe, es de otra cuenta o ya está conciliado';
  end if;
  if v_sl <> v_sm then
    raise exception 'No concilia: el extracto suma % y los libros %', v_sl, v_sm;
  end if;
  insert into conciliacion (empresa_id, cuenta_bancaria_id, fecha, importe, creado_por)
  values (v_emp, p_cuenta, p_fecha, v_sl, fn_usuario_actual()) returning id into v_id;
  update extracto_linea set conciliacion_id = v_id where id = any(p_lineas);
  update movimiento_tesoreria set conciliacion_id = v_id, conciliado_en = p_fecha where id = any(p_movimientos);
  return v_id;
end
$$;

create function fn_deshacer_conciliacion(p_id bigint) returns void language plpgsql as
$$
begin
  if not exists (select 1 from conciliacion where id = p_id and estado = 'vigente') then
    raise exception 'La conciliación % no existe o ya fue deshecha', p_id;
  end if;
  update extracto_linea set conciliacion_id = null where conciliacion_id = p_id;
  update movimiento_tesoreria set conciliacion_id = null, conciliado_en = null where conciliacion_id = p_id;
  update conciliacion set estado = 'deshecha' where id = p_id;
end
$$;

-- Una línea del banco que no está en los libros (comisión, interés, impuesto al débito/crédito) se registra
-- como movimiento de la cuenta con su mismo importe; después se concilia.
create function fn_movimiento_desde_linea(p_linea bigint, p_concepto text) returns bigint language plpgsql as
$$
declare l extracto_linea%rowtype; e extracto_bancario%rowtype; v_id bigint;
begin
  select * into l from extracto_linea where id = p_linea;
  select * into e from extracto_bancario where id = l.extracto_id;
  if l.conciliacion_id is not null then raise exception 'La línea % ya está conciliada', p_linea; end if;
  insert into movimiento_tesoreria (empresa_id, fecha, cuenta_bancaria_id, importe, concepto)
  values (l.empresa_id, l.fecha, e.cuenta_bancaria_id, l.importe, p_concepto) returning id into v_id;
  return v_id;
end
$$;

-- Coincidencias 1 a 1 seguras: mismo importe, fecha cercana y candidato único de ambos lados.
create function fn_sugerir_conciliacion(p_cuenta bigint, p_dias integer default 3)
returns table (linea_id bigint, movimiento_id bigint, dif_dias integer) language sql stable as
$$
  with cand as (
    select l.id as linea_id, m.id as movimiento_id, abs(l.fecha - m.fecha) as dif
      from extracto_linea l
      join extracto_bancario e on e.id = l.extracto_id and e.cuenta_bancaria_id = p_cuenta and e.estado = 'cerrado'
      join movimiento_tesoreria m on m.cuenta_bancaria_id = p_cuenta and m.importe = l.importe
     where l.conciliacion_id is null and m.conciliacion_id is null and abs(l.fecha - m.fecha) <= p_dias
  ), c2 as (
    select *, count(*) over (partition by linea_id) as nl, count(*) over (partition by movimiento_id) as nm from cand
  )
  select linea_id, movimiento_id, dif from c2 where nl = 1 and nm = 1
$$;

-- Estado de la conciliación por cuenta. diferencia_total = saldo del banco - saldo de los libros, y debe quedar
-- explicada por las partidas pendientes: no_explicada = 0 (si no, el saldo de apertura de los libros no coincide).
create view v_conciliacion_estado with (security_invoker = true) as
with ext as (
  select e.empresa_id, e.cuenta_bancaria_id,
         min(e.desde) as desde0,
         (array_agg(e.saldo_inicial order by e.desde))[1] as saldo_inicial0,
         (array_agg(e.saldo_final order by e.hasta desc))[1] as saldo_banco
    from extracto_bancario e where e.estado = 'cerrado' group by e.empresa_id, e.cuenta_bancaria_id
), lin as (
  select e.empresa_id, e.cuenta_bancaria_id, coalesce(sum(l.importe) filter (where l.conciliacion_id is null), 0) as pendiente_banco
    from extracto_bancario e join extracto_linea l on l.extracto_id = e.id where e.estado = 'cerrado'
   group by e.empresa_id, e.cuenta_bancaria_id
)
select x.empresa_id, x.cuenta_bancaria_id,
       x.saldo_banco::importe,
       coalesce(sum(m.importe), 0)::importe                                                      as saldo_libros,
       (x.saldo_banco - coalesce(sum(m.importe), 0))::importe                                    as diferencia_total,
       coalesce(l.pendiente_banco, 0)::importe                                                   as pendiente_banco,
       coalesce(sum(m.importe) filter (where m.conciliacion_id is null and m.fecha >= x.desde0), 0)::importe as pendiente_libros,
       (x.saldo_inicial0 - coalesce(sum(m.importe) filter (where m.fecha < x.desde0), 0))::importe as diferencia_apertura,
       ((x.saldo_banco - coalesce(sum(m.importe), 0))
         - (coalesce(l.pendiente_banco, 0)
            - coalesce(sum(m.importe) filter (where m.conciliacion_id is null and m.fecha >= x.desde0), 0)))::importe as no_explicada
  from ext x
  left join lin l on l.empresa_id = x.empresa_id and l.cuenta_bancaria_id = x.cuenta_bancaria_id
  left join movimiento_tesoreria m on m.empresa_id = x.empresa_id and m.cuenta_bancaria_id = x.cuenta_bancaria_id
 group by x.empresa_id, x.cuenta_bancaria_id, x.saldo_banco, x.saldo_inicial0, x.desde0, l.pendiente_banco;
