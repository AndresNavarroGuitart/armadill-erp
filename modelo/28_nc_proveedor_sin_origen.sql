-- Notas de crédito de proveedores sin factura de origen: una bonificación o un ajuste que el proveedor manda por su cuenta. La exigencia de comprobante de origen
-- (empresa_parametro.nc_requiere_origen) pasa a valer solo para las ventas: quien factura sí tiene que decir qué acredita; la nota de un proveedor se carga como
-- viene y queda a favor hasta que se aplique a una factura (ver /api/compras/notas/:id/aplicar). Si trae origen, las reglas de siempre (mismo tercero, letra y moneda).
-- Va DESPUÉS de 27 y ANTES de 29 (el endurecimiento de Supabase, que siempre es el último).

create or replace function fn_verificar_comprobante(p_id bigint) returns void language plpgsql as
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

  if t.clase = 'nota_credito' and c.comprobante_origen_id is null and par.nc_requiere_origen and c.sentido = 'venta' then
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
