-- Stock como libro de movimientos de solo agregar. El saldo se DERIVA (vista v_stock_saldo): el original
-- lo cacheaba en tres lugares (articulo, stock_deposito, stock) y podían desalinearse.

create table deposito (
  id         bigint generated always as identity primary key,
  empresa_id bigint not null references empresa(id),
  nombre     text not null,
  activo     boolean not null default true,
  unique (empresa_id, nombre)
);

alter table comprobante_item add column deposito_id bigint references deposito(id);

create table movimiento_stock (
  id                  bigint generated always as identity primary key,
  empresa_id          bigint not null references empresa(id),
  fecha               date   not null,
  articulo_id         bigint not null references articulo(id),
  deposito_id         bigint not null references deposito(id),
  cantidad            numeric(18,4) not null check (cantidad <> 0),     -- + entra, - sale
  tipo                text   not null check (tipo in
    ('compra','venta','devolucion_venta','devolucion_compra','ajuste','inventario','transferencia_entrada','transferencia_salida')),
  comprobante_item_id bigint references comprobante_item(id),
  costo_unitario      importe4,
  lote                text,
  creado_en           timestamptz not null default now()
);
create index on movimiento_stock (empresa_id, articulo_id, deposito_id);

-- No se corrige un movimiento: se registra el contrario.
create trigger trg_movimiento_stock_solo_agregar before update or delete on movimiento_stock
  for each row execute function fn_solo_agregar();

create function fn_stock_no_negativo() returns trigger language plpgsql as
$$
declare permite boolean; controla boolean; v_saldo numeric;
begin
  select permite_stock_negativo into permite from empresa_parametro where empresa_id = new.empresa_id;
  if coalesce(permite, false) then return null; end if;
  select controla_stock into controla from articulo where id = new.articulo_id;
  if not coalesce(controla, true) then return null; end if;
  select sum(cantidad) into v_saldo from movimiento_stock
   where empresa_id = new.empresa_id and articulo_id = new.articulo_id and deposito_id = new.deposito_id;
  if v_saldo < 0 then
    raise exception 'Stock negativo (%) del artículo % en el depósito %: la empresa no lo permite',
                    v_saldo, new.articulo_id, new.deposito_id;
  end if;
  return null;
end
$$;
create constraint trigger trg_stock_no_negativo after insert on movimiento_stock
  deferrable initially immediate for each row execute function fn_stock_no_negativo();
