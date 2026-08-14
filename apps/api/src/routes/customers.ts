import { Router } from 'express';
import { blacklistCustomerSchema, listCustomersQuerySchema } from '@berber/shared';
import { asyncHandler } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/auth.js';
import {
  blacklistCustomer,
  unblacklistCustomer,
  listCustomers,
  getCustomer,
} from '../services/customers.js';

export const customersRouter: Router = Router();

customersRouter.use(requireAuth);

/** Sayfalamalı, aranabilir müşteri listesi. */
customersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = listCustomersQuerySchema.parse(req.query);
    const result = await listCustomers({
      shopId: req.auth!.shopId,
      search: query.search,
      blacklistedOnly: query.blacklistedOnly,
      cursor: query.cursor,
      limit: query.limit,
    });
    res.json(result);
  }),
);

/** Müşteri detayı, randevu geçmişiyle. */
customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const customer = await getCustomer(req.auth!.shopId, req.params.id!);
    res.json({ customer });
  }),
);

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
