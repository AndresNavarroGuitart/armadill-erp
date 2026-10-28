-- Contabilidad: el centro del producto para un estudio. En el original es un módulo con licencia
-- que no se pudo observar; este diseño parte de las prácticas habituales y del esquema `cont_*`.

create table plan_cuenta (
  id         bigint generated always as identity primary key,
  empresa_id bigint not null references empresa(id),
  codigo     text   not null,
  nombre     text   not null,
  tipo       text   not null check (tipo in ('activo','pasivo','patrimonio_neto','ingreso','egreso')),
  imputable  boolean not null default true,       -- solo las imputables reciben líneas de asiento
  padre_id   bigint references plan_cuenta(id),
  activa     boolean not null default true,
  unique (empresa_id, codigo)
);

create table ejercicio (
  id         bigint generated always as identity primary key,
  empresa_id bigint not null references empresa(id),
  desde      date not null,
  hasta      date not null,
  cerrado    boolean not null default false,
  check (hasta > desde),
  exclude using gist (empresa_id with =, daterange(desde, hasta, '[]') with &&)
);

-- Período fiscal mensual. Se resuelve SIEMPRE por fecha (el original lo resolvía por mes y fallaba
-- con filas de años distintos: defecto D-04 de la especificación).
create table periodo (
  id                  bigint generated always as identity primary key,
  empresa_id          bigint not null references empresa(id),
  desde               date not null,
  hasta               date not null,
  estado              text not null default 'abierto' check (estado in ('abierto','cerrado')),
  vencimiento_fiscal  date,
  anulado             boolean not null default false,
  check (hasta >= desde),
  exclude using gist (empresa_id with =, daterange(desde, hasta, '[]') with &&) where (not anulado)
);

-- 'ok' | 'sin_periodo' | 'cerrado' | 'vencido'. El bloqueo por vencimiento es configurable por empresa.
create function fn_periodo_aceptado(p_empresa bigint, p_fecha date, p_hoy date default current_date)
returns text language plpgsql as
$$
declare
  p periodo%rowtype;
  bloquea boolean;
begin
  select * into p from periodo
   where empresa_id = p_empresa and not anulado and p_fecha between desde and hasta;
  if not found then return 'sin_periodo'; end if;
  if p.estado = 'cerrado' then return 'cerrado'; end if;
  select bloquea_periodo_vencido into bloquea from empresa_parametro where empresa_id = p_empresa;
  if coalesce(bloquea, false) and p.vencimiento_fiscal is not null and p.vencimiento_fiscal < p_hoy then
    return 'vencido';
  end if;
  return 'ok';
end
$$;

create table asiento (
  id            bigint generated always as identity primary key,
  empresa_id    bigint not null references empresa(id),
  ejercicio_id  bigint not null references ejercicio(id),
  numero        bigint not null,
  fecha         date   not null,
  descripcion   text,
  origen_tipo   text,                                  -- 'comprobante', 'pago', 'manual', ...
  origen_id     bigint,
  estado        text   not null default 'borrador' check (estado in ('borrador','contabilizado','anulado')),
  creado_por    bigint references usuario(id),
  creado_en     timestamptz not null default now(),
  unique (empresa_id, ejercicio_id, numero)
);

create table asiento_linea (
  id          bigint generated always as identity primary key,
  empresa_id  bigint not null references empresa(id),
  asiento_id  bigint not null references asiento(id) on delete cascade,
  cuenta_id   bigint not null references plan_cuenta(id),
  debe        importe not null default 0,
  haber       importe not null default 0,
  tercero_id  bigint,                                  -- FK agregada en 04 (auxiliar de cuenta corriente)
  detalle     text,
  check (debe >= 0 and haber >= 0 and (debe = 0 or haber = 0) and (debe + haber) > 0)
);
create index on asiento_linea (asiento_id);
create index on asiento_linea (empresa_id, cuenta_id);

create function fn_asiento_numero() returns trigger language plpgsql as
$$
begin
  if new.numero is null then
    new.numero := fn_siguiente(new.empresa_id, 'asiento-' || new.ejercicio_id);
  end if;
  return new;
end
$$;
create trigger trg_asiento_numero before insert on asiento
  for each row execute function fn_asiento_numero();

-- Un asiento solo se contabiliza si está balanceado, tiene al menos dos líneas, usa cuentas
-- imputables y su fecha cae en un período aceptado.
create function fn_verificar_asiento() returns trigger language plpgsql as
$$
declare
  v_debe importe; v_haber importe; v_lineas int; v_noimputables int; v_periodo text;
begin
  if new.estado <> 'contabilizado' then return null; end if;
  select coalesce(sum(l.debe),0), coalesce(sum(l.haber),0), count(*),
         count(*) filter (where not c.imputable)
    into v_debe, v_haber, v_lineas, v_noimputables
    from asiento_linea l join plan_cuenta c on c.id = l.cuenta_id
   where l.asiento_id = new.id;
  if v_lineas < 2 then raise exception 'Asiento %: necesita al menos dos líneas', new.numero; end if;
  if v_debe <> v_haber then
    raise exception 'Asiento %: no balancea (debe % <> haber %)', new.numero, v_debe, v_haber;
  end if;
  if v_noimputables > 0 then
    raise exception 'Asiento %: usa cuentas no imputables', new.numero;
  end if;
  v_periodo := fn_periodo_aceptado(new.empresa_id, new.fecha);
  if v_periodo <> 'ok' then
    raise exception 'Asiento %: período no aceptado (%)', new.numero, v_periodo;
  end if;
  return null;
end
$$;
create constraint trigger trg_asiento_verificar after insert or update of estado on asiento
  deferrable initially immediate for each row execute function fn_verificar_asiento();

-- Las líneas de un asiento ya contabilizado no se tocan: se anula y se reemplaza.
create function fn_asiento_linea_inmutable() returns trigger language plpgsql as
$$
declare v_estado text;
begin
  select estado into v_estado from asiento where id = coalesce(new.asiento_id, old.asiento_id);
  if v_estado is not null and v_estado <> 'borrador' then
    raise exception 'El asiento ya está %; no se modifican sus líneas', v_estado;
  end if;
  return coalesce(new, old);
end
$$;
create trigger trg_asiento_linea_inmutable before insert or update or delete on asiento_linea
  for each row execute function fn_asiento_linea_inmutable();
