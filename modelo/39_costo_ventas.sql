-- Costo de ventas automático (inventario permanente): cada vez que la mercadería SALE al cliente (remito de salida, factura sin remito) o VUELVE (anulación, nota de crédito con devolución)
-- se genera un asiento que pasa su costo de Mercaderías a Costo de ventas (o al revés). Hasta acá las ventas asentaban solo el ingreso (deudores / ventas / IVA): la mercadería salía del depósito
-- sin que la contabilidad se enterara, y un remito (que no genera cobro ni asiento) no dejaba rastro contable.
-- Es OPCIONAL por empresa (empresa_parametro.costo_ventas_automatico, que además exige los asientos automáticos) y se activa con fn_activar_costo_ventas.
-- Valuación: el costo VIGENTE del artículo (el de su última compra a la fecha del movimiento; método a validar con el contador). Queda grabado en el movimiento de stock
-- (movimiento_stock.costo_unitario): lo que se asentó se puede reproducir siempre, aunque el costo cambie después. Lo que vuelve (anulación, devolución) vuelve al costo con el que salió.
-- Con la opción activa, las compras de bienes con control de stock se asientan contra Mercaderías y no contra Compras (sin eso Mercaderías nunca tendría saldo). El artículo puede
-- traer su propia cuenta de compra (articulo.cuenta_compra_id): esa es la cuenta de inventario del artículo en las dos puntas.
-- Lo que NO hace: ajustes y conteos de inventario (siguen sin asiento), mercadería recibida y todavía no facturada (remito de entrada) y costo promedio ponderado o PEPS.
-- Va DESPUÉS de 38 y ANTES de 40 (el endurecimiento de Supabase, que siempre es el último).

insert into permiso (clave, modulo, descripcion) values
  ('contabilidad.configurar', 'contabilidad', 'Activar o desactivar el costo de ventas automático y otros parámetros contables');
insert into rol_permiso (rol_id, permiso_clave)
  select r.id, 'contabilidad.configurar' from rol r where r.nombre in ('Administrador', 'Contador')
  on conflict do nothing;

alter table empresa_parametro add column costo_ventas_automatico boolean not null default false;

alter table cuenta_automatica drop constraint cuenta_automatica_concepto_check;
alter table cuenta_automatica add constraint cuenta_automatica_concepto_check check (concepto in (
    'ventas','compras','iva_debito','iva_credito','deudores','proveedores',
    'percepcion_iva_sufrida','percepcion_iibb_sufrida','percepcion_ganancias_sufrida','otros_tributos_compras',
    'percepcion_iva_practicada','percepcion_iibb_practicada','otros_tributos_ventas',
    'retencion_iva_sufrida','retencion_ganancias_sufrida','retencion_iibb_sufrida','retencion_suss_sufrida',
    'retencion_iva_practicada','retencion_ganancias_practicada','retencion_iibb_practicada','retencion_suss_practicada',
    'descuentos_otorgados','descuentos_obtenidos','valores_a_depositar','cheques_a_pagar','resultados_no_asignados',
    'costo_ventas','mercaderias'));

-- Activar (o desactivar) el costo de ventas automático. Al activar usa la cuenta que la empresa ya tenga asignada para cada concepto; si no, una cuenta existente con ese nombre (Mercaderías,
-- Costo de mercaderías vendidas) y, si tampoco, crea la cuenta con el primer código libre desde 1.1.4 y 5.1.2: nunca toma una cuenta que ya tiene otro uso. Los movimientos anteriores no se reasientan: la opción rige desde que se activa.
create function fn_activar_costo_ventas(p_empresa bigint, p_activar boolean) returns void language plpgsql as
$$
declare
  x record; v_cuenta bigint; v_n int;
begin
  if p_activar then
    if not coalesce((select asientos_automaticos from empresa_parametro where empresa_id = p_empresa), false) then
      raise exception 'Primero hay que activar los asientos automáticos de la empresa';
    end if;
    for x in select * from (values ('mercaderias', '1.1.', 4, 'Mercaderías', 'activo'),
                                   ('costo_ventas', '5.1.', 2, 'Costo de mercaderías vendidas', 'egreso')) v(concepto, prefijo, desde, nombre, tipo) loop
      if not exists (select 1 from cuenta_automatica where empresa_id = p_empresa and concepto = x.concepto) then
        select id into v_cuenta from plan_cuenta where empresa_id = p_empresa and tipo = x.tipo and activa and imputable and lower(nombre) = lower(x.nombre) order by id limit 1;
        if v_cuenta is null then
          v_n := x.desde;
          while exists (select 1 from plan_cuenta where empresa_id = p_empresa and codigo = x.prefijo || v_n) loop v_n := v_n + 1; end loop;
          insert into plan_cuenta (empresa_id, codigo, nombre, tipo) values (p_empresa, x.prefijo || v_n, x.nombre, x.tipo) returning id into v_cuenta;
        end if;
        insert into cuenta_automatica (empresa_id, concepto, cuenta_id) values (p_empresa, x.concepto, v_cuenta);
      end if;
    end loop;
  end if;
  update empresa_parametro set costo_ventas_automatico = p_activar where empresa_id = p_empresa;
end
$$;

-- Costo vigente de un artículo a una fecha: el último registrado hasta ese día (si todos son posteriores, el más antiguo). Sin costo cargado devuelve null.
create function fn_costo_vigente(p_articulo bigint, p_fecha date) returns numeric language sql stable as
$$
  select coalesce(
    (select costo from articulo_costo where articulo_id = p_articulo and fecha <= p_fecha order by fecha desc, id desc limit 1),
    (select costo from articulo_costo where articulo_id = p_articulo order by fecha, id limit 1));
$$;

-- A qué costo vuelve lo que se devuelve o anula: al que tenía el movimiento original, pero solo si ese costo se asentó. Una venta anterior a activar la opción (o sin costo cargado) no tiene
-- asiento de costo: su devolución tampoco lo tiene (costo cero), para no revertir algo que nunca se asentó. Con la opción apagada no importa: se conserva el costo.
create function fn_costo_a_revertir(p_mov bigint) returns numeric language sql stable as
$$
  select case
    when not coalesce((select costo_ventas_automatico from empresa_parametro where empresa_id = m.empresa_id), false) then m.costo_unitario
    when exists (select 1 from asiento a where a.origen_tipo = 'costo_remito'
                    and a.origen_id = (select di.documento_id from documento_item di where di.id = m.documento_item_id))
      or exists (select 1 from asiento a where a.origen_tipo = 'costo_comprobante'
                    and a.origen_id = (select ci.comprobante_id from comprobante_item ci where ci.id = m.comprobante_item_id))
      then coalesce(m.costo_unitario, 0)
    else 0 end
  from movimiento_stock m where m.id = p_mov;
$$;

-- Toda salida de mercadería al cliente nace con su costo; toda devolución, con el costo con el que salió (la de una nota de crédito, el de lo que se factura: directo o por remito).
create function fn_movimiento_costear() returns trigger language plpgsql as
$$
declare v numeric; o record; v_orig bigint;
begin
  if new.costo_unitario is not null or new.tipo not in ('venta', 'devolucion_venta') then return new; end if;
  if new.tipo = 'devolucion_venta' and new.comprobante_item_id is not null then
    select o2.id, o2.documento_item_id into o
      from comprobante_item i join comprobante_item o2 on o2.id = i.item_origen_id where i.id = new.comprobante_item_id;
    if o.id is not null then
      select id into v_orig from movimiento_stock
       where tipo = 'venta' and articulo_id = new.articulo_id
         and (comprobante_item_id = o.id or (o.documento_item_id is not null and documento_item_id = o.documento_item_id))
       order by id limit 1;
      if v_orig is not null then v := fn_costo_a_revertir(v_orig); end if;
    end if;
  end if;
  new.costo_unitario := coalesce(v, fn_costo_vigente(new.articulo_id, new.fecha));
  return new;
end
$$;
create trigger trg_movimiento_costear before insert on movimiento_stock
  for each row execute function fn_movimiento_costear();

-- El asiento de un grupo de movimientos de venta (o de devolución): Costo de ventas contra Mercaderías por el costo de lo que salió (o al revés si volvió). Un solo asiento por documento.
-- Devuelve el asiento, o null si la opción está apagada o no hay costo que asentar (artículos sin costo cargado).
create function fn_asiento_costo_ventas(p_movs bigint[], p_origen_tipo text, p_origen_id bigint, p_descripcion text, p_fecha date)
returns bigint language plpgsql as
$$
declare
  v_emp bigint; v_on boolean; v_auto boolean; v_as bigint; v_total numeric := 0; v_cmv bigint; r record;
begin
  if p_movs is null or cardinality(p_movs) = 0 then return null; end if;
  select empresa_id into v_emp from movimiento_stock where id = p_movs[1];
  select costo_ventas_automatico, asientos_automaticos into v_on, v_auto from empresa_parametro where empresa_id = v_emp;
  if not (coalesce(v_on, false) and coalesce(v_auto, false)) then return null; end if;
  select coalesce(sum(round(-m.cantidad * coalesce(m.costo_unitario, 0), 2)), 0) into v_total from movimiento_stock m where m.id = any(p_movs);
  if v_total = 0 then return null; end if;
  v_cmv := fn_cuenta_auto(v_emp, 'costo_ventas');                                                -- si falta la cuenta, falla antes de crear nada
  insert into asiento (empresa_id, ejercicio_id, fecha, descripcion, origen_tipo, origen_id, creado_por)
  values (v_emp, fn_ejercicio_de(v_emp, p_fecha), p_fecha, p_descripcion, p_origen_tipo, p_origen_id, fn_usuario_actual())
  returning id into v_as;
  for r in select coalesce(a.cuenta_compra_id, fn_cuenta_auto(v_emp, 'mercaderias')) as cuenta, round(sum(-m.cantidad * coalesce(m.costo_unitario, 0)), 2) as valor
             from movimiento_stock m join articulo a on a.id = m.articulo_id where m.id = any(p_movs) group by 1 loop
    perform fn_linea_asiento(v_as, v_emp, r.cuenta, r.valor, false, null, 'Mercaderías');
  end loop;
  perform fn_linea_asiento(v_as, v_emp, v_cmv, (select sum(l.haber - l.debe) from asiento_linea l where l.asiento_id = v_as), true, null, 'Costo de ventas');
  update asiento set estado = 'contabilizado' where id = v_as;
  return v_as;
end
$$;

-- Remito de salida: al confirmarlo sale la mercadería (con su costo) y se asienta; al anularlo vuelve al costo con el que salió y se asienta al revés. El remito de entrada no se asienta
-- (la deuda y el ingreso a Mercaderías los hace la factura de compra).
create or replace function fn_remito_stock() returns trigger language plpgsql as
$$
declare v_signo int; v_ids bigint[]; v_etiqueta text;
begin
  if new.tipo not in ('remito_venta','remito_compra') then return null; end if;
  v_signo := case new.tipo when 'remito_compra' then 1 else -1 end;
  v_etiqueta := 'Remito ' || lpad(new.punto_venta::text, 4, '0') || '-' || lpad(coalesce(new.numero::text, '?'), 8, '0');
  if new.estado = 'confirmado' then
    with nuevos as (
      insert into movimiento_stock (empresa_id, fecha, articulo_id, deposito_id, cantidad, tipo, documento_item_id, costo_unitario)
      select di.empresa_id, new.fecha, di.articulo_id, di.deposito_id, v_signo * di.cantidad,
             case new.tipo when 'remito_compra' then 'compra' else 'venta' end, di.id,
             case when new.tipo = 'remito_compra' then di.precio_unitario end
        from documento_item di join articulo a on a.id = di.articulo_id
       where di.documento_id = new.id and a.controla_stock
      returning id)
    select array_agg(id) into v_ids from nuevos;
    if new.tipo = 'remito_venta' then
      perform fn_asiento_costo_ventas(v_ids, 'costo_remito', new.id, 'Costo de ventas · ' || v_etiqueta, new.fecha);
    end if;
  elsif new.estado = 'anulado' then
    with nuevos as (
      insert into movimiento_stock (empresa_id, fecha, articulo_id, deposito_id, cantidad, tipo, documento_item_id, costo_unitario)
      select m.empresa_id, current_date, m.articulo_id, m.deposito_id, - m.cantidad,
             case new.tipo when 'remito_compra' then 'devolucion_compra' else 'devolucion_venta' end, m.documento_item_id,
             case when new.tipo = 'remito_venta' then fn_costo_a_revertir(m.id) end
        from movimiento_stock m
       where m.documento_item_id in (select id from documento_item where documento_id = new.id)
      returning id)
    select array_agg(id) into v_ids from nuevos;
    if new.tipo = 'remito_venta' then
      perform fn_asiento_costo_ventas(v_ids, 'costo_remito', new.id, 'Anulación del costo de ventas · ' || v_etiqueta, current_date);
    end if;
  end if;
  return null;
end
$$;

-- Asiento de un comprobante: igual al de 15, salvo que con el costo de ventas automático las compras de bienes con control de stock van a Mercaderías (la cuenta de compra del artículo
-- si la tiene) y no a Compras. Un renglón con cuenta propia, o un gasto, sigue como antes.
create or replace function fn_generar_asiento_comprobante(p_id bigint) returns bigint language plpgsql as
$$
declare
  c comprobante%rowtype;
  t arca_tipo_comprobante%rowtype;
  te tercero%rowtype;
  v_ej bigint; v_as bigint; v_tercero_cta bigint; v_default bigint; v_merc bigint;
  v_base numeric; v_debe_ingreso boolean; v_debe_tercero boolean;
  v_concepto text;
  r record;
begin
  select * into c from comprobante where id = p_id;
  if c.asiento_id is not null then raise exception 'El comprobante % ya tiene asiento', p_id; end if;
  select * into t from arca_tipo_comprobante where codigo = c.tipo_comprobante_codigo;
  select * into te from tercero where id = c.tercero_id;
  v_ej := fn_ejercicio_de(c.empresa_id, c.fecha);
  insert into asiento (empresa_id, ejercicio_id, fecha, descripcion, origen_tipo, origen_id, creado_por)
  values (c.empresa_id, v_ej, c.fecha, t.descripcion || ' ' || c.punto_venta || '-' || coalesce(c.numero::text, '?'),
          'comprobante', c.id, fn_usuario_actual())
  returning id into v_as;

  -- venta normal: el tercero va al debe y los ingresos al haber; la nota de crédito lo invierte
  v_debe_tercero := (c.sentido = 'venta') = (t.signo = 1);
  v_debe_ingreso := not v_debe_tercero;
  v_base := c.imp_neto + c.imp_tot_conc + c.imp_op_ex;
  v_concepto := case c.sentido when 'venta' then 'ventas' else 'compras' end;
  v_default := fn_cuenta_auto(c.empresa_id, v_concepto);
  if c.sentido = 'compra' and coalesce((select costo_ventas_automatico from empresa_parametro where empresa_id = c.empresa_id), false) then
    v_merc := fn_cuenta_auto(c.empresa_id, 'mercaderias');
  end if;
  v_tercero_cta := coalesce(case c.sentido when 'venta' then te.cuenta_deudores_id else te.cuenta_acreedores_id end,
                            fn_cuenta_auto(c.empresa_id, case c.sentido when 'venta' then 'deudores' else 'proveedores' end));

  perform fn_linea_asiento(v_as, c.empresa_id, v_tercero_cta, c.imp_total, v_debe_tercero, c.tercero_id, 'Cuenta corriente');

  for r in
    select cuenta_id, acum - coalesce(lag(acum) over (order by cuenta_id), 0) as parte
      from (select cuenta_id, round(v_base * sum(peso) over (order by cuenta_id) / sum(peso) over (), 2) as acum
              from (select coalesce(ci.cuenta_id,
                                    case c.sentido when 'venta' then a.cuenta_venta_id else a.cuenta_compra_id end,
                                    case when a.controla_stock then v_merc end,
                                    v_default) as cuenta_id,
                           sum(abs(ci.importe_renglon)) as peso
                      from comprobante_item ci left join articulo a on a.id = ci.articulo_id
                     where ci.comprobante_id = p_id group by 1) g
             where peso > 0) h
  loop
    perform fn_linea_asiento(v_as, c.empresa_id, r.cuenta_id, r.parte, v_debe_ingreso, null, 'Ingresos / gastos');
  end loop;

  perform fn_linea_asiento(v_as, c.empresa_id,
    fn_cuenta_auto(c.empresa_id, case c.sentido when 'venta' then 'iva_debito' else 'iva_credito' end),
    c.imp_iva, v_debe_ingreso, null, 'IVA');

  for r in select tipo, sum(importe) as importe from comprobante_tributo where comprobante_id = p_id group by tipo loop
    v_concepto := case
      when c.sentido = 'compra' and r.tipo = 'percepcion_iva'       then 'percepcion_iva_sufrida'
      when c.sentido = 'compra' and r.tipo = 'percepcion_iibb'      then 'percepcion_iibb_sufrida'
      when c.sentido = 'compra' and r.tipo = 'percepcion_ganancias' then 'percepcion_ganancias_sufrida'
      when c.sentido = 'compra'                                     then 'otros_tributos_compras'
      when r.tipo = 'percepcion_iva'                                then 'percepcion_iva_practicada'
      when r.tipo = 'percepcion_iibb'                               then 'percepcion_iibb_practicada'
      else 'otros_tributos_ventas' end;
    perform fn_linea_asiento(v_as, c.empresa_id, fn_cuenta_auto(c.empresa_id, v_concepto), r.importe, v_debe_ingreso, null, r.tipo);
  end loop;

  update asiento set estado = 'contabilizado' where id = v_as;     -- aquí se verifica el balance
  update comprobante set asiento_id = v_as where id = p_id;
  return v_as;
end
$$;
