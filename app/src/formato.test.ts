import { describe, expect, it } from 'vitest';
import { aDecimal, cantidad, cuitConGuiones, fecha, moneda } from './formato';

describe('formato', () => {
  it('muestra importes con miles y coma sin perder exactitud', () => {
    expect(moneda('290400.00')).toBe('$ 290.400,00');
    expect(moneda('1234567890123.456')).toBe('$ 1.234.567.890.123,45');
    expect(moneda('-50.5')).toBe('-$ 50,50');
    expect(moneda('0.30')).toBe('$ 0,30');
    expect(moneda(null)).toBe('—');
  });
  it('muestra cantidades sin ceros de más', () => {
    expect(cantidad('2.0000')).toBe('2');
    expect(cantidad('1.5000')).toBe('1,5');
    expect(cantidad('12000')).toBe('12.000');
  });
  it('convierte lo que se escribe a decimal para la API', () => {
    expect(aDecimal('1.234,56')).toBe('1234.56');
    expect(aDecimal('1234,5')).toBe('1234.5');
    expect(aDecimal('1234.56')).toBe('1234.56');
    expect(aDecimal('1.234')).toBe('1234');
    expect(aDecimal('  ')).toBe('');
  });
  it('arma fechas y CUIT legibles', () => {
    expect(fecha('2026-10-29')).toBe('29/10/2026');
    expect(cuitConGuiones('30712345671')).toBe('30-71234567-1');
    expect(cuitConGuiones('123')).toBe('123');
  });
});
