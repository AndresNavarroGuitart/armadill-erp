// Completa un prefijo de 10 dígitos con su dígito verificador (para armar CUIT de ejemplo y de prueba).
export function cuitConDigito(prefijo10) {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = [...prefijo10].reduce((a, d, i) => a + Number(d) * pesos[i], 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0; else if (dv === 10) dv = 9;
  return prefijo10 + dv;
}
