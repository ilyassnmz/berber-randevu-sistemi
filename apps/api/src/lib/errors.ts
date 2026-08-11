/**
 * Uygulama hataları ve veritabanı hata çevirileri.
 */

export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Kayıt bulunamadı') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Geçersiz veri', details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Giriş yapmanız gerekiyor') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Bu işlem için yetkiniz yok') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT') {
    super(message, 409, code);
  }
}

/**
 * Slot çakışması. Veritabanındaki EXCLUDE kısıtı tarafından tetiklenir.
 * Chatbot bu hatayı görünce müşteriye güncel saatleri yeniden listeler.
 */
export class SlotTakenError extends ConflictError {
  constructor() {
    super('Bu saat az önce doldu. Lütfen başka bir saat seçin.', 'SLOT_TAKEN');
  }
}

// ─── Veritabanı hata tespiti ─────────────────────────────

/** PostgreSQL: exclusion_violation */
const PG_EXCLUSION_VIOLATION = '23P01';
/** PostgreSQL: unique_violation */
const PG_UNIQUE_VIOLATION = '23505';

const OVERLAP_CONSTRAINT_NAME = 'appointments_no_overlap';

function errorText(error: unknown): string {
  if (error instanceof Error) {
    // Prisma bazı sürücü hatalarını message içine gömüyor
    return `${error.message} ${JSON.stringify((error as { meta?: unknown }).meta ?? '')}`;
  }
  return String(error);
}

/**
 * Hata, randevu çakışma kısıtından mı geliyor?
 *
 * Prisma exclusion constraint ihlalleri için özel bir hata kodu üretmiyor;
 * hata sürücüden ham haliyle geçiyor. Bu yüzden hem SQLSTATE'e hem kısıt adına
 * bakıyoruz — biri değişse diğeri yakalar.
 */
export function isOverlapViolation(error: unknown): boolean {
  const text = errorText(error);
  return text.includes(PG_EXCLUSION_VIOLATION) || text.includes(OVERLAP_CONSTRAINT_NAME);
}

/** Hata, benzersizlik kısıtından mı geliyor? */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    // Prisma'nın kendi kodu
    if ((error as { code: unknown }).code === 'P2002') return true;
  }
  return errorText(error).includes(PG_UNIQUE_VIOLATION);
}
