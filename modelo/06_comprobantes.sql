-- Comprobantes de venta y de compra en UNA sola tabla (sentido). La cabecera replica la estructura
-- del pedido de CAE de ARCA (ImpNeto, ImpIVA, ImpTotConc, ImpOpEx, ImpTrib, ImpTotal), de modo que
-- lo que se informa es lo que se guarda. Un comprobante confirmado no se modifica: se corrige con una nota.

create table punto_venta (
  id         bigint generated always as identity primary key,
  empresa_id bigint not null references empresa(id),
  numero     integer not null check (numero between 1 and 99999),
  sistema    text not null check (sistema in ('ws_factura','ws_exportacion','ws_bono_fiscal','preimpresa','interno')),
  domicilio  text,
  activo     boolean not null default true,
  unique (empresa_id, numero)
);

create table comprobante (
  id                        bigint generated always as identity primary key,
  empresa_id                bigint not null references empresa(id),
  sentido                   text   not null check (sentido in ('venta','compra')),
  tipo_comprobante_codigo   smallint not null references arca_tipo_comprobante(codigo),
  punto_venta               integer not null check (punto_venta between 1 and 99999),
  numero                    bigint,                      -- ventas electrónicas: lo asigna ARCA al autorizar
  fecha                     date   not null,
  tercero_id                bigint not null references tercero(id),
  condicion_iva_receptor_codigo smallint references arca_condicion_iva(codigo),   -- RG 5616
  concepto_codigo           smallint not null default 1 references arca_concepto(codigo),
  fecha_servicio_desde      date,
  fecha_servicio_hasta      date,
  fecha_vto_pago            date,
  moneda                    char(3) not null default 'PES' references arca_moneda(codigo),
  cotizacion                numeric(18,6) not null default 1 check (cotizacion > 0),
  precios_incluyen_iva      boolean not null,
  desc_pie_pct              tasa    not null default 0 check (desc_pie_pct >= 0 and desc_pie_pct < 1),
  imp_desc_pie              importe not null default 0 check (imp_desc_pie >= 0),
  imp_neto                  importe not null default 0,   -- base gravada (después del descuento al pie)
  imp_iva                   importe not null default 0,
  imp_tot_conc              importe not null default 0,   -- no gravado
  imp_op_ex                 importe not null default 0,   -- exento (cajas SEPARADAS: defecto D-02 del original)
  imp_trib                  importe not null default 0,   -- percepciones e impuestos internos
  imp_total                 importe not null default 0,
  estado                    text   not null default 'borrador'
                            check (estado in ('borrador','confirmado','autorizado','rechazado','anulado')),
  comprobante_origen_id     bigint references comprobante(id),
  cae                       text,
  cae_vencimiento           date,
  resultado_arca            text check (resultado_arca in ('A','R','P')),
  observaciones_arca        jsonb,
  asiento_id                bigint references asiento(id),
  observaciones             text,
  creado_por                bigint references usuario(id),
  creado_en                 timestamptz not null default now(),
  actualizado_en            timestamptz not null default now(),
  -- identidad que ARCA exige en el pedido de CAE
  check (imp_total = imp_neto + imp_iva + imp_tot_conc + imp_op_ex + imp_trib),
  check (estado = 'borrador' or numero is not null),
  check (estado <> 'autorizado' or cae is not null),
  check (sentido = 'compra' or estado = 'borrador' or condicion_iva_receptor_codigo is not null),
  check (moneda <> 'PES' or cotizacion = 1)
);
create unique index comprobante_venta_unico  on comprobante (empresa_id, tipo_comprobante_codigo, punto_venta, numero)
  where sentido = 'venta' and numero is not null;
create unique index comprobante_compra_unico on comprobante (empresa_id, tercero_id, tipo_comprobante_codigo, punto_venta, numero)
  where sentido = 'compra' and numero is not null;
create index on comprobante (empresa_id, tercero_id, fecha);
create index on comprobante (empresa_id, sentido, fecha);

alter table articulo_costo add constraint articulo_costo_comprobante_fk
  foreign key (comprobante_id) references comprobante(id);

create table comprobante_item (
  id                bigint generated always as identity primary key,
  empresa_id        bigint not null references empresa(id),
  comprobante_id    bigint not null references comprobante(id) on delete cascade,
  orden             smallint not null,
  articulo_id       bigint references articulo(id),
  descripcion       text   not null,
  cantidad          numeric(18,4) not null check (cantidad <> 0),
  precio_unitario   importe4 not null,
  desc_pct          tasa not null default 0 check (desc_pct >= 0 and desc_pct < 1),
  bonif_pct         tasa not null default 0 check (bonif_pct >= 0 and bonif_pct < 1),   -- se ENCADENA con el descuento
  tratamiento_iva   text not null check (tratamiento_iva in ('gravado','exento','no_gravado')),
  alicuota_codigo   smallint references arca_alicuota_iva(codigo),
  -- importe del renglón en la base del comprobante (neto en compras, final con IVA en ventas), 4 decimales
  importe_renglon   importe4 not null,
  cuenta_id         bigint references plan_cuenta(id),
  unique (comprobante_id, orden),
  check ((tratamiento_iva = 'gravado') = (alicuota_codigo is not null))
);

-- Una fila por alícuota gravada: es lo que se informa a ARCA (array AlicIva) y lo que alimenta el libro.
create table comprobante_iva (
  id              bigint generated always as identity primary key,
  empresa_id      bigint not null references empresa(id),
  comprobante_id  bigint not null references comprobante(id) on delete cascade,
  alicuota_codigo smallint not null references arca_alicuota_iva(codigo),
  base_imponible  importe not null,
  importe_iva     importe not null,
  unique (comprobante_id, alicuota_codigo)
);

create table comprobante_tributo (
  id                   bigint generated always as identity primary key,
  empresa_id           bigint not null references empresa(id),
  comprobante_id       bigint not null references comprobante(id) on delete cascade,
  tipo                 text   not null check (tipo in
    ('percepcion_iva','percepcion_iibb','percepcion_ganancias','percepcion_suss','impuesto_interno','impuesto_municipal','otro')),
  jurisdiccion_codigo  smallint references arca_jurisdiccion(codigo),
  descripcion          text,
  base_imponible       importe,
  alicuota             tasa,
  importe              importe not null,
  check (tipo <> 'percepcion_iibb' or jurisdiccion_codigo is not null)
);

-- Aplicación de una nota de crédito (o de un adelanto) a una factura.
create table comprobante_aplicacion (
  id           bigint generated always as identity primary key,
  empresa_id   bigint not null references empresa(id),
  nota_id      bigint not null references comprobante(id),
  factura_id   bigint not null references comprobante(id),
  importe      importe not null check (importe > 0),
  fecha        date not null default current_date,
  check (nota_id <> factura_id),
  unique (nota_id, factura_id)
);

-- ---------------------------------------------------------------------------
-- Guardia: máquina de estados e inmutabilidad
-- ---------------------------------------------------------------------------
create function fn_comprobante_guardia() returns trigger language plpgsql as
$$
begin
  if current_setting('app.migracion', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;   -- carga histórica controlada
  end if;
  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' then
      raise exception 'Un comprobante se crea en borrador y se confirma después de cargar sus renglones';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.estado <> 'borrador' then
      raise exception 'Un comprobante % no se borra: se anula o se corrige con una nota', old.estado;
    end if;
    return old;
  end if;
  if old.estado <> 'borrador' and
     (new.empresa_id, new.sentido, new.tipo_comprobante_codigo, new.punto_venta, new.numero, new.fecha,
      new.tercero_id, new.moneda, new.cotizacion, new.precios_incluyen_iva, new.desc_pie_pct, new.imp_desc_pie,
      new.imp_neto, new.imp_iva, new.imp_tot_conc, new.imp_op_ex, new.imp_trib, new.imp_total,
      new.comprobante_origen_id)
     is distinct from
     (old.empresa_id, old.sentido, old.tipo_comprobante_codigo, old.punto_venta, old.numero, old.fecha,
      old.tercero_id, old.moneda, old.cotizacion, old.precios_incluyen_iva, old.desc_pie_pct, old.imp_desc_pie,
      old.imp_neto, old.imp_iva, old.imp_tot_conc, old.imp_op_ex, old.imp_trib, old.imp_total,
      old.comprobante_origen_id) then
    raise exception 'El comprobante % está % y sus importes no se modifican', old.id, old.estado;
  end if;
  if new.estado <> old.estado and (old.estado, new.estado) not in
     (('borrador','confirmado'), ('borrador','autorizado'), ('borrador','rechazado'), ('borrador','anulado'),
      ('rechazado','borrador'), ('confirmado','autorizado'), ('confirmado','anulado')) then
    -- un comprobante autorizado por ARCA no se anula: se emite una nota de crédito
    raise exception 'Transición de estado no permitida: % -> %', old.estado, new.estado;
  end if;
  new.actualizado_en := now();
  return new;
end
$$;
create trigger trg_comprobante_guardia before insert or update or delete on comprobante
  for each row execute function fn_comprobante_guardia();

create function fn_comprobante_hijo_guardia() returns trigger language plpgsql as
$$
declare v_estado text;
begin
  if current_setting('app.migracion', true) = 'on' then return coalesce(new, old); end if;
  select estado into v_estado from comprobante where id = coalesce(new.comprobante_id, old.comprobante_id);
  if v_estado is not null and v_estado <> 'borrador' then
    raise exception 'El comprobante está %; no se modifican sus renglones, alícuotas ni tributos', v_estado;
  end if;
  return coalesce(new, old);
end
$$;
create trigger trg_item_guardia     before insert or update or delete on comprobante_item
  for each row execute function fn_comprobante_hijo_guardia();
create trigger trg_iva_guardia      before insert or update or delete on comprobante_iva
  for each row execute function fn_comprobante_hijo_guardia();
create trigger trg_tributo_guardia  before insert or update or delete on comprobante_tributo
  for each row execute function fn_comprobante_hijo_guardia();

-- ---------------------------------------------------------------------------
-- Verificación al confirmar: invariantes de la especificación de cálculo
-- ---------------------------------------------------------------------------
create function fn_verificar_comprobante(p_id bigint) returns void language plpgsql as
$$
declare
  c        comprobante%rowtype;
  t        arca_tipo_comprobante%rowtype;
  par      empresa_parametro%rowtype;
  o        comprobante%rowtype;
  t_o      arca_tipo_comprobante%rowtype;
  v_ter    tercero%rowtype;
  tol      importe;
  s_base   importe; s_iva importe; s_trib importe; s_items importe4; n_items int;
  v_per    text;
  r        record;
begin
  select * into c from comprobante where id = p_id;
  select * into t from arca_tipo_comprobante where codigo = c.tipo_comprobante_codigo;
  select * into par from empresa_parametro where empresa_id = c.empresa_id;
  select * into v_ter from tercero where id = c.tercero_id;
  tol := coalesce(par.tolerancia_redondeo, 0.01);

  v_per := fn_periodo_aceptado(c.empresa_id, c.fecha);
  if v_per <> 'ok' then
    raise exception 'Comprobante %: período no aceptado (%)', p_id, v_per;
  end if;

  if c.sentido = 'venta' and not v_ter.es_cliente then
    raise exception 'Comprobante %: el tercero no es cliente', p_id;
  end if;
  if c.sentido = 'compra' and not v_ter.es_proveedor then
    raise exception 'Comprobante %: el tercero no es proveedor', p_id;
  end if;
  if c.sentido = 'venta' and c.condicion_iva_receptor_codigo is null then
    raise exception 'Comprobante %: falta la condición frente al IVA del receptor (RG 5616)', p_id;
  end if;

  select coalesce(sum(base_imponible), 0), coalesce(sum(importe_iva), 0)
    into s_base, s_iva from comprobante_iva where comprobante_id = p_id;
  select coalesce(sum(importe), 0) into s_trib from comprobante_tributo where comprobante_id = p_id;
  if s_base <> c.imp_neto then
    raise exception 'Comprobante %: las alícuotas suman % y la cabecera dice % de neto gravado', p_id, s_base, c.imp_neto;
  end if;
  if s_iva <> c.imp_iva then
    raise exception 'Comprobante %: el IVA por alícuota suma % y la cabecera dice %', p_id, s_iva, c.imp_iva;
  end if;
  if s_trib <> c.imp_trib then
    raise exception 'Comprobante %: los tributos suman % y la cabecera dice %', p_id, s_trib, c.imp_trib;
  end if;

  -- IVA de cada columna = base × alícuota (se admite la tolerancia de centavos del desglose desde precio final)
  for r in select ci.alicuota_codigo, ci.base_imponible, ci.importe_iva, a.tasa
             from comprobante_iva ci join arca_alicuota_iva a on a.codigo = ci.alicuota_codigo
            where ci.comprobante_id = p_id loop
    if abs(r.importe_iva - round(r.base_imponible * r.tasa, 2)) > tol then
      raise exception 'Comprobante %: IVA % de la alícuota % no corresponde a la base %',
                      p_id, r.importe_iva, r.alicuota_codigo, r.base_imponible;
    end if;
  end loop;

  -- INVARIANTE D-01: el total es la suma exacta de los renglones (el original perdía renglones del 27 % y exentos)
  select count(*), coalesce(sum(importe_renglon), 0) into n_items, s_items
    from comprobante_item where comprobante_id = p_id;
  if n_items = 0 then raise exception 'Comprobante %: no tiene renglones', p_id; end if;
  if c.imp_desc_pie = 0 then
    if c.precios_incluyen_iva then
      if abs(round(s_items, 2) - (c.imp_total - c.imp_trib)) > tol then
        raise exception 'Comprobante %: los renglones suman % pero el total sin tributos es %',
                        p_id, round(s_items, 2), c.imp_total - c.imp_trib;
      end if;
    else
      if abs(round(s_items, 2) - (c.imp_neto + c.imp_tot_conc + c.imp_op_ex)) > tol then
        raise exception 'Comprobante %: los renglones suman % pero la cabecera suma %',
                        p_id, round(s_items, 2), c.imp_neto + c.imp_tot_conc + c.imp_op_ex;
      end if;
    end if;
  elsif not c.precios_incluyen_iva then
    if abs(round(s_items, 2) - (c.imp_neto + c.imp_tot_conc + c.imp_op_ex + c.imp_desc_pie)) > tol then
      raise exception 'Comprobante %: los renglones (%) no cierran con la cabecera más el descuento al pie', p_id, round(s_items, 2);
    end if;
  end if;   -- ventas con descuento al pie: la base sale del desglose; no se verifica contra los renglones

  if t.clase = 'nota_credito' and c.comprobante_origen_id is null and par.nc_requiere_origen then
    raise exception 'Comprobante %: la nota de crédito exige el comprobante de origen', p_id;
  end if;
  if c.comprobante_origen_id is not null then
    select * into o from comprobante where id = c.comprobante_origen_id;
    select * into t_o from arca_tipo_comprobante where codigo = o.tipo_comprobante_codigo;
    if o.empresa_id <> c.empresa_id or o.tercero_id <> c.tercero_id or o.sentido <> c.sentido then
      raise exception 'Comprobante %: el origen es de otra empresa, tercero o sentido', p_id;
    end if;
    if t_o.letra <> t.letra then
      raise exception 'Comprobante %: la letra (%) debe coincidir con la del origen (%)', p_id, t.letra, t_o.letra;
    end if;
    if o.moneda <> c.moneda then
      raise exception 'Comprobante %: la moneda debe coincidir con la del origen', p_id;
    end if;
  end if;
end
$$;

create function fn_comprobante_confirmar() returns trigger language plpgsql as
$$
begin
  perform fn_verificar_comprobante(new.id);
  return null;
end
$$;
create constraint trigger trg_comprobante_confirmar after update of estado on comprobante
  deferrable initially immediate for each row
  when (old.estado in ('borrador','rechazado') and new.estado in ('confirmado','autorizado'))
  execute function fn_comprobante_confirmar();
