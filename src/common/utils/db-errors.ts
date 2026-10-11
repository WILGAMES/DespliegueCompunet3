/** Código SQLSTATE de PostgreSQL para violación de clave foránea */
const FOREIGN_KEY_VIOLATION = '23503';


export function isForeignKeyViolation(error: unknown): boolean {
  const e = error as {
    code?: string;
    driverError?: { code?: string };
  };

  return (
    e?.code === FOREIGN_KEY_VIOLATION ||
    e?.driverError?.code === FOREIGN_KEY_VIOLATION
  );
}
