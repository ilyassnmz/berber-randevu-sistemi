import { Router } from 'express';
import { blacklistCustomerSchema } from '@berber/shared';
import { asyncHandler } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { blacklistCustomer, unblacklistCustomer } from '../services/customers.js';

export const customersRouter: Router = Router();

customersRouter.use(requireAuth);

customersRouter.put(
  '/:id/blacklist',
  asyncHandler(async (req, res) => {
    const { reason } = blacklistCustomerSchema.parse(req.body);
    const customer = await blacklistCustomer(
      req.auth!.shopId,
      req.params.id!,
      reason,
      req.auth!.barberId,
    );
    res.json({ customer });
  }),
);

customersRouter.delete(
  '/:id/blacklist',
  asyncHandler(async (req, res) => {
    const customer = await unblacklistCustomer(req.auth!.shopId, req.params.id!, req.auth!.barberId);
    res.json({ customer });
  }),
);
