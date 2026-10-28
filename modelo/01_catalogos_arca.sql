-- Catálogos de ARCA. Son GLOBALES (sin empresa_id) y se cargan desde los métodos FEParamGet* del web service.
-- Las semillas de abajo son de conocimiento general y están marcadas verificado = false:
-- reemplazarlas por la respuesta oficial antes de producción (ver REFERENCIA_ODOO_ARGENTINA.md, sección 4).

create table arca_tipo_comprobante (
  codigo         smallint primary key,
  descripcion    text     not null,
  letra          char(1)  not null,
  clase          text     not null check (clase in ('factura','nota_debito','nota_credito','recibo')),
  signo          smallint not null check (signo in (1, -1)),   -- efecto sobre el saldo y el libro de IVA
  es_fce         boolean  not null default false,
  es_exportacion boolean  not null default false,
  verificado     boolean  not null default false
);
insert into arca_tipo_comprobante (codigo, descripcion, letra, clase, signo, es_fce, es_exportacion) values
  (1,  'Factura A',                    'A', 'factura',      1, false, false),
  (2,  'Nota de Débito A',             'A', 'nota_debito',  1, false, false),
  (3,  'Nota de Crédito A',            'A', 'nota_credito', -1, false, false),
  (4,  'Recibo A',                     'A', 'recibo',       -1, false, false),
  (6,  'Factura B',                    'B', 'factura',      1, false, false),
  (7,  'Nota de Débito B',             'B', 'nota_debito',  1, false, false),
  (8,  'Nota de Crédito B',            'B', 'nota_credito', -1, false, false),
  (9,  'Recibo B',                     'B', 'recibo',       -1, false, false),
  (11, 'Factura C',                    'C', 'factura',      1, false, false),
  (12, 'Nota de Débito C',             'C', 'nota_debito',  1, false, false),
  (13, 'Nota de Crédito C',            'C', 'nota_credito', -1, false, false),
  (15, 'Recibo C',                     'C', 'recibo',       -1, false, false),
  (19, 'Factura de Exportación E',     'E', 'factura',      1, false, true),
  (20, 'Nota de Débito E',             'E', 'nota_debito',  1, false, true),
  (21, 'Nota de Crédito E',            'E', 'nota_credito', -1, false, true),
  (51, 'Factura M',                    'M', 'factura',      1, false, false),
  (52, 'Nota de Débito M',             'M', 'nota_debito',  1, false, false),
  (53, 'Nota de Crédito M',            'M', 'nota_credito', -1, false, false),
  (201,'Factura de Crédito Electrónica A', 'A', 'factura',      1, true, false),
  (202,'Nota de Débito FCE A',         'A', 'nota_debito',  1, true, false),
  (203,'Nota de Crédito FCE A',        'A', 'nota_credito', -1, true, false),
  (206,'Factura de Crédito Electrónica B', 'B', 'factura',      1, true, false),
  (207,'Nota de Débito FCE B',         'B', 'nota_debito',  1, true, false),
  (208,'Nota de Crédito FCE B',        'B', 'nota_credito', -1, true, false),
  (211,'Factura de Crédito Electrónica C', 'C', 'factura',      1, true, false),
  (212,'Nota de Débito FCE C',         'C', 'nota_debito',  1, true, false),
  (213,'Nota de Crédito FCE C',        'C', 'nota_credito', -1, true, false);

-- Alícuotas de IVA. Exento y No gravado NO son alícuotas: viajan en importes aparte (ImpOpEx, ImpTotConc).
create table arca_alicuota_iva (
  codigo      smallint primary key,
  tasa        tasa not null,
  descripcion text not null,
  verificado  boolean not null default false
);
insert into arca_alicuota_iva (codigo, tasa, descripcion) values
  (3, 0,      '0 %'),
  (4, 0.105,  '10,5 %'),
  (5, 0.21,   '21 %'),
  (6, 0.27,   '27 %'),
  (8, 0.05,   '5 %'),
  (9, 0.025,  '2,5 %');

create table arca_tipo_documento (
  codigo      smallint primary key,
  descripcion text not null,
  verificado  boolean not null default false
);
insert into arca_tipo_documento (codigo, descripcion) values
  (80, 'CUIT'), (86, 'CUIL'), (87, 'CDI'), (89, 'LE'), (90, 'LC'), (91, 'CI extranjera'),
  (92, 'En trámite'), (93, 'Acta de nacimiento'), (94, 'Pasaporte'), (95, 'CI Buenos Aires'),
  (96, 'DNI'), (99, 'Sin identificar / consumidor final'), (30, 'Certificado de migración');

-- Condición frente al IVA del receptor (RG 5616): obligatoria en el pedido de CAE.
create table arca_condicion_iva (
  codigo      smallint primary key,
  descripcion text not null,
  verificado  boolean not null default false
);
insert into arca_condicion_iva (codigo, descripcion) values
  (1,  'IVA Responsable Inscripto'),
  (4,  'IVA Sujeto Exento'),
  (5,  'Consumidor Final'),
  (6,  'Responsable Monotributo'),
  (7,  'Sujeto No Categorizado'),
  (8,  'Proveedor del Exterior'),
  (9,  'Cliente del Exterior'),
  (10, 'IVA Liberado - Ley 19.640'),
  (13, 'Monotributista Social'),
  (15, 'IVA No Alcanzado'),
  (16, 'Monotributo Trabajador Independiente Promovido');

create table arca_concepto (
  codigo      smallint primary key,
  descripcion text not null
);
insert into arca_concepto values (1, 'Productos'), (2, 'Servicios'), (3, 'Productos y servicios');

create table arca_moneda (
  codigo      char(3) primary key,
  descripcion text not null
);
insert into arca_moneda values ('PES', 'Pesos argentinos'), ('DOL', 'Dólar estadounidense'), ('060', 'Euro');

-- Jurisdicciones de Ingresos Brutos (convenio multilateral).
create table arca_jurisdiccion (
  codigo smallint primary key,
  nombre text not null,
  verificado boolean not null default false
);
insert into arca_jurisdiccion (codigo, nombre) values
  (901,'CABA'),(902,'Buenos Aires'),(903,'Catamarca'),(904,'Córdoba'),(905,'Corrientes'),(906,'Chaco'),
  (907,'Chubut'),(908,'Entre Ríos'),(909,'Formosa'),(910,'Jujuy'),(911,'La Pampa'),(912,'La Rioja'),
  (913,'Mendoza'),(914,'Misiones'),(915,'Neuquén'),(916,'Río Negro'),(917,'Salta'),(918,'San Juan'),
  (919,'San Luis'),(920,'Santa Cruz'),(921,'Santa Fe'),(922,'Santiago del Estero'),
  (923,'Tierra del Fuego'),(924,'Tucumán');

create table unidad_medida (
  id           smallint generated always as identity primary key,
  nombre       text not null unique,
  abreviatura  text not null,
  codigo_arca  smallint
);
insert into unidad_medida (nombre, abreviatura, codigo_arca) values
  ('Unidad','u',7),('Kilogramo','kg',1),('Gramo','g',2),('Litro','l',5),('Metro','m',3),('Hora','h',98);
