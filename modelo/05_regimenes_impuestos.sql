-- Regímenes de retención/percepción, escalas de Ganancias, padrones de IIBB y presentaciones.
-- TODAS las tasas se guardan como fracción (0.025 = 2,5 %), igual que arca_alicuota_iva.
-- empresa_id NULL = régimen del sistema (semilla compartida); una empresa puede agregar los suyos.

create table escala_ganancias (
  id            bigint generated always as identity primary key,
  empresa_id    bigint references empresa(id),
  nombre        text not null,
  vigente_desde date not null,
  vigente_hasta date
);

-- Escala acumulativa (Odoo 18): se acumulan las bases del mes y se descuenta lo ya retenido.
create table escala_ganancias_tramo (
  id                bigint generated always as identity primary key,
  escala_id         bigint not null references escala_ganancias(id) on delete cascade,
  desde             importe not null,
  hasta             importe,
  cuota_fija        importe not null default 0,
  porcentaje        tasa    not null,
  sobre_excedente_de importe not null default 0,
  check (hasta is null or hasta > desde)
);

create table regimen_retencion (
  id                   bigint generated always as identity primary key,
  empresa_id           bigint references empresa(id),
  tipo                 text   not null check (tipo in ('iva','ganancias','iibb','suss')),
  jurisdiccion_codigo  smallint references arca_jurisdiccion(codigo),
  codigo_arca          text,
  descripcion          text   not null,
  alicuota             tasa   not null default 0,
  base                 text   not null default 'neto' check (base in ('neto','iva','total')),
  -- Tres umbrales distintos. El original tiene uno solo (`ImporteImp`) y su significado no se pudo
  -- determinar: ver ESPECIFICACION_REGLAS_CALCULO.md, sección 5. Decisión pendiente con el contador.
  monto_no_imponible   importe not null default 0,   -- se descuenta de la base antes de aplicar la alícuota
  base_minima          importe not null default 0,   -- base menor a este valor: no se retiene (semántica R-10/R-11)
  retencion_minima     importe not null default 0,   -- importe calculado menor a este valor: no se retiene (semántica Odoo)
  escala_id            bigint references escala_ganancias(id),
  vigente_desde        date   not null default date '2000-01-01',
  vigente_hasta        date,
  activo               boolean not null default true,
  check (tipo <> 'iibb' or jurisdiccion_codigo is not null),
  check (escala_id is null or tipo = 'ganancias')
);

-- Padrón de IIBB (ARBA, AGIP, Córdoba, ...): dato público, compartido por todas las empresas.
-- Es la ventaja frente a Odoo, que no actualiza las alícuotas provinciales.
create table padron_iibb (
  id                    bigint generated always as identity primary key,
  jurisdiccion_codigo   smallint not null references arca_jurisdiccion(codigo),
  cuit                  text not null check (fn_cuit_valido(cuit)),
  alicuota_percepcion   tasa,
  alicuota_retencion    tasa,
  grupo                 text,
  vigente_desde         date not null,
  vigente_hasta         date,
  fuente                text not null,
  importado_en          timestamptz not null default now()
);
create index on padron_iibb (jurisdiccion_codigo, cuit, vigente_desde desc);

-- Qué régimen aplica a cada tercero y durante qué fechas (Odoo: "desde / hasta" en el proveedor).
create table tercero_regimen_retencion (
  id          bigint generated always as identity primary key,
  empresa_id  bigint not null references empresa(id),
  tercero_id  bigint not null references tercero(id) on delete cascade,
  regimen_id  bigint not null references regimen_retencion(id),
  desde       date not null,
  hasta       date,
  check (hasta is null or hasta >= desde),
  exclude using gist (tercero_id with =, regimen_id with =, daterange(desde, hasta, '[]') with &&)
);

-- Importe sugerido de retención. Es una PROPUESTA de la réplica: el original deja el importe a mano.
-- Siempre editable por el operador; el certificado registra lo que efectivamente se retuvo.
create function fn_retencion_sugerida(
  p_regimen bigint, p_base numeric, p_base_acumulada numeric default 0, p_retenido_previo numeric default 0
) returns numeric language plpgsql stable as
$$
declare
  r regimen_retencion%rowtype;
  t escala_ganancias_tramo%rowtype;
  neta numeric;
  acumulada numeric;
  imp numeric;
begin
  select * into r from regimen_retencion where id = p_regimen;
  if not found then raise exception 'Régimen % inexistente', p_regimen; end if;
  if p_base < r.base_minima then return 0; end if;
  neta := greatest(p_base - r.monto_no_imponible, 0);
  if r.escala_id is not null then
    acumulada := p_base_acumulada + neta;
    select * into t from escala_ganancias_tramo
     where escala_id = r.escala_id and acumulada >= desde and (hasta is null or acumulada < hasta);
    if not found then return 0; end if;
    imp := t.cuota_fija + (acumulada - t.sobre_excedente_de) * t.porcentaje - p_retenido_previo;
  else
    imp := neta * r.alicuota;
  end if;
  if imp < r.retencion_minima then return 0; end if;
  return round(greatest(imp, 0), 2);
end
$$;

create table presentacion_impuesto (
  id                    bigint generated always as identity primary key,
  empresa_id            bigint not null references empresa(id),
  impuesto              text   not null check (impuesto in ('iva','ganancias','iibb','suss','otro')),
  periodo_id            bigint not null references periodo(id),
  tipo                  text   not null default 'original' check (tipo in ('original','rectificativa')),
  numero_rectificativa  smallint not null default 0 check (numero_rectificativa >= 0),
  importe               importe not null,
  sentido               text   not null check (sentido in ('a_favor','a_pagar')),
  vencimiento           date,
  estado                text   not null default 'pendiente' check (estado in ('pendiente','cancelada','anulada')),
  detalle               text,
  asiento_id            bigint references asiento(id),
  check ((tipo = 'original') = (numero_rectificativa = 0)),
  unique (empresa_id, impuesto, periodo_id, numero_rectificativa)
);
