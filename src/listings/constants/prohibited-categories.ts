/**
 * Categorías que la plataforma no permite publicar. Si la categoría de
 * una publicación coincide con alguna, se rechaza de inmediato, sin
 * consultar a la IA (regla determinista para rechazos evidentes).
 *
 * Lista inicial: el equipo debe confirmarla. Se escribe sin tildes y en
 * minúsculas, porque la comparación ignora tildes y mayúsculas.
 */
export const PROHIBITED_CATEGORIES: readonly string[] = [
  'armas',
  'armas de fuego',
  'municiones',
  'explosivos',
  'drogas',
  'estupefacientes',
  'sustancias ilegales',
  'organos humanos',
  'documentos falsos',
  'billetes falsos',
  'tarjetas clonadas',
  'material pornografico',
];
