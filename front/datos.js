/* Datos de EJEMPLO del prototipo. Todo es inventado (nombres, CUIT, importes); no hay datos reales.
   Los importes son en pesos; la factura calcula en centavos enteros. */
(function () {
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clientes = [
    { n: 'Distribuidora Sur SRL', doc: 'CUIT 30-70811222-3', iva: 'RI' },
    { n: 'Kiosco El Pino', doc: 'CUIT 20-30456789-6', iva: 'MT' },
    { n: 'Marta Gómez', doc: 'DNI 27.345.118', iva: 'CF' },
    { n: 'Fundación Horizonte', doc: 'CUIT 30-65432109-5', iva: 'EX' },
    { n: 'Constructora Almagro SA', doc: 'CUIT 30-71500123-8', iva: 'RI' },
    { n: 'Consumidor Final', doc: 'Sin identificar', iva: 'CF' },
    { n: 'Lucía Fernández', doc: 'DNI 33.907.552', iva: 'CF' },
    { n: 'Tecno Plata SRL', doc: 'CUIT 30-71999888-4', iva: 'RI' },
  ];
  const condicion = { RI: 'Responsable Inscripto', MT: 'Monotributo', CF: 'Consumidor Final', EX: 'Exento' };

  const articulos = [
    { n: 'Honorarios profesionales', p: 85000, al: '21' },
    { n: 'Servicio de consultoría', p: 120000, al: '21' },
    { n: 'Pan lactal x500 g', p: 1850, al: '10.5' },
    { n: 'Servicio de telecomunicaciones', p: 38000, al: '27' },
    { n: 'Seguro de caución', p: 54000, al: 'ex' },
    { n: 'Reintegro de gastos', p: 15000, al: 'ng' },
    { n: 'Notebook 15"', p: 780000, al: '21' },
  ];

  const base = [
    ['Comercial Andina SA', '30-71234567-1', 'RI', 18500000, 3, 1],
    ['Panadería La Espiga', '20-28765432-4', 'MT', 3200000],
    ['Servicios Norte SRL', '30-70987654-1', 'RI', 9400000, -2, 3],
    ['Estudio Jurídico Paz', '27-30123456-5', 'MT', 2100000],
    ['Agro Pampa SA', '30-71122334-7', 'RI', 41000000, 5, 2],
    ['Taller Mecánico Ruiz', '20-25678901-2', 'MT', 2800000, 12, 6],
    ['Clínica Del Valle SRL', '30-70555444-9', 'RI', 27500000],
    ['Librería Palabra', '27-31456789-0', 'MT', 1700000],
  ];

  const estados = ['Autorizado', 'Autorizado', 'Autorizado', 'Autorizado', 'Borrador', 'Rechazado', 'Autorizado', 'Anulado'];

  function crear(i, d) {
    const r = rng(i * 977 + 13);
    const escala = d[3];
    const ventas = Array.from({ length: 12 }, (_, k) => escala * (0.78 + (k / 11) * 0.3 + (r() - 0.5) * 0.28));
    let saldo = escala * 0.55;
    const flujo = Array.from({ length: 30 }, () => (saldo += (r() - 0.42) * escala * 0.07));
    const ri = d[2] === 'RI';
    const diasIva = d[4] != null ? d[4] : 2 + Math.floor(r() * 12);
    const movs = 6 + Math.floor(r() * 24);
    const vencidas = d[5] != null ? d[5] : Math.floor(r() * 4);
    const venc = [
      { dias: ri ? diasIva : 20 - new Date().getDate(), nombre: ri ? 'IVA · F.2002' : 'Cuota monotributo', tipo: 'imp' },
      { dias: diasIva + 3, nombre: 'SIRE · Retenciones', tipo: 'imp' },
      { dias: diasIva + 8, nombre: ri ? 'Ganancias · anticipo' : 'Ingresos Brutos', tipo: 'imp' },
      { dias: diasIva + 14, nombre: 'F.931 · cargas sociales', tipo: 'lab' },
      { dias: diasIva + 22, nombre: 'Balance trimestral', tipo: 'est' },
    ].map((v) => ({ ...v, dias: v.dias < -3 ? v.dias + 30 : v.dias }));
    venc.sort((a, b) => a.dias - b.dias);
    const comp = Array.from({ length: 14 }, (_, k) => {
      const cli = clientes[Math.floor(r() * clientes.length)];
      const letra = ri ? (cli.iva === 'RI' || cli.iva === 'MT' ? 'A' : 'B') : 'C';
      const est = estados[Math.floor(r() * estados.length)];
      return {
        letra, cliente: cli.n, dias: k === 0 ? 0 : Math.floor(k * 1.5 + r() * 2),
        nro: '0003-' + String(1240 - k * 3).padStart(8, '0'),
        total: Math.round((escala / 90) * (0.2 + r() * 1.6) / 100) * 100, estado: est,
      };
    });
    return {
      id: i + 1, nombre: d[0], cuit: d[1], cond: d[2], ini: d[0].split(' ').slice(0, 2).map((p) => p[0]).join(''), tono: i % 3,
      ventas, flujo, ventasMes: ventas[11], ventasPrev: ventas[10],
      ivaPagar: ri ? Math.round(escala * (0.06 + r() * 0.05)) : 0,
      caja: Math.round(escala * (0.5 + r() * 0.5)), porCobrar: Math.round(escala * (0.25 + r() * 0.3)), vencido: vencidas,
      conciliar: movs, venc, comp,
    };
  }

  window.DATOS = { empresas: base.map((d, i) => crear(i, d)), clientes, articulos, condicion };
})();
