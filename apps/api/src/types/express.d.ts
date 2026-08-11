import type { BarberRole } from '@berber/shared';

declare global {
  namespace Express {
    interface Request {
      /**
       * İstek gövdesinin ham hali.
       *
       * WhatsApp webhook imzası (X-Hub-Signature-256) HAM gövde üzerinden
       * hesaplanır. Ayrıştırılmış nesneyi yeniden JSON.stringify etmek
       * anahtar sırasını ve boşlukları değiştirebildiği için imzayı bozar.
       */
      rawBody?: Buffer;

      /** Kimliği doğrulanmış berber (auth middleware'i tarafından set edilir). */
      auth?: {
        barberId: string;
        shopId: string;
        role: BarberRole;
      };
    }
  }
}

export {};
