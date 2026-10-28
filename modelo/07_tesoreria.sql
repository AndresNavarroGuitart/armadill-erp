-- Tesorería: cajas, cuentas bancarias y cheques. Los movimientos se definen en 08 porque cuelgan de los pagos.

create table caja (
  id                  bigint generated always as identity primary key,
  empresa_id          bigint not null references empresa(id),
  nombre              text   not null,
  tipo                text   not null default 'efectivo' check (tipo in ('efectivo','cheques_terceros','tarjetas','otra')),
  moneda              char(3) not null default 'PES' references arca_moneda(codigo),
  cuenta_contable_id  bigint references plan_cuenta(id),
  activa              boolean not null default true,
  unique (empresa_id, nombre)
);

create table cuenta_bancaria (
  id                  bigint generated always as identity primary key,
  empresa_id          bigint not null references empresa(id),
  banco               text   not null,
  numero_cuenta       text,
  cbu                 text check (cbu is null or cbu ~ '^[0-9]{22}$'),
  alias               text,
  moneda              char(3) not null default 'PES' references arca_moneda(codigo),
  cuenta_contable_id  bigint references plan_cuenta(id),
  activa              boolean not null default true
);

-- Cartera de cheques propios y de terceros, con el historial de estados en cheque_evento.
create table cheque (
  id                   bigint generated always as identity primary key,
  empresa_id           bigint not null references empresa(id),
  origen               text   not null check (origen in ('propio','tercero')),
  numero               text   not null,
  banco                text,
  cuit_librador        text check (cuit_librador is null or fn_cuit_valido(cuit_librador)),
  importe              importe not null check (importe > 0),
  fecha_emision        date,
  fecha_pago           date,                      -- fecha de cobro: un cheque diferido tiene fecha futura
  tercero_id           bigint references tercero(id),
  cuenta_bancaria_id   bigint references cuenta_bancaria(id),
  estado               text   not null check (estado in
    ('en_cartera','depositado','acreditado','rechazado','entregado','emitido','cobrado','anulado')),
  creado_en            timestamptz not null default now(),
  check (fecha_pago is null or fecha_emision is null or fecha_pago >= fecha_emision),
  check (origen = 'tercero' and estado in ('en_cartera','depositado','acreditado','rechazado','entregado','anulado')
      or origen = 'propio'  and estado in ('emitido','cobrado','rechazado','anulado'))
);
create index on cheque (empresa_id, estado);

create table cheque_evento (
  id              bigint generated always as identity primary key,
  empresa_id      bigint not null references empresa(id),
  cheque_id       bigint not null references cheque(id) on delete cascade,
  fecha           date   not null,
  estado_anterior text,
  estado_nuevo    text   not null,
  pago_id         bigint,                         -- FK agregada en 08
  nota            text
);
