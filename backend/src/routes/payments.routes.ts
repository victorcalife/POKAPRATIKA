import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool';
import { requireAuth, requireRoles } from '../security/auth';
import { AuthRequest } from '../types';
import { asyncHandler, validate } from '../utils/http';

export const paymentsRouter = Router();

const upsertPaymentSchema = z.object({
  userId: z.string().uuid(),
  seasonId: z.string().uuid().nullable().optional(),
  referenceMonth: z.string().regex(/^\d{4}-\d{2}-01$/),
  dueDate: z.string().date().optional(),
  amountCents: z.number().int().min(0),
  status: z.enum(['PENDING', 'PAID', 'LATE', 'WAIVED']),
  paidAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(500).nullable().optional()
});
const generateMonthlyPaymentsSchema = z.object({
  seasonId: z.string().uuid().nullable().optional(),
  referenceMonth: z.string().regex(/^\d{4}-\d{2}-01$/),
  dueDate: z.string().date(),
  amountCents: z.number().int().min(0),
  notes: z.string().max(500).nullable().optional()
});

paymentsRouter.use(requireAuth);

paymentsRouter.get('/', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT p.id, p.user_id AS "userId", u.name AS "userName", p.season_id AS "seasonId", p.reference_month AS "referenceMonth",
      p.due_date AS "dueDate", p.amount_cents AS "amountCents", CASE WHEN p.status = 'PENDING' AND p.due_date < CURRENT_DATE THEN 'LATE' ELSE p.status END AS status, p.paid_at AS "paidAt",
      (p.status = 'PAID' AND p.paid_at IS NOT NULL AND p.paid_at::DATE < p.due_date) AS "earnsPoint",
      p.notes
     FROM payments p
     JOIN users u ON u.id = p.user_id
     WHERE ($1::UUID IS NULL OR p.season_id = $1) AND ($2::TEXT IS NULL OR p.status = $2)
     ORDER BY p.reference_month DESC, p.due_date ASC, u.name ASC`,
    [req.query.seasonId || null, req.query.status || null]
  );
  res.json(result.rows);
}));

paymentsRouter.get('/summary', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT
      COALESCE(sum(amount_cents), 0)::INTEGER AS "totalCents",
      COALESCE(sum(amount_cents) FILTER (WHERE status = 'PAID'), 0)::INTEGER AS "paidCents",
      COALESCE(sum(amount_cents) FILTER (WHERE status IN ('PENDING', 'LATE') OR (status = 'PENDING' AND due_date < CURRENT_DATE)), 0)::INTEGER AS "openCents",
      count(*)::INTEGER AS total,
      count(*) FILTER (WHERE status = 'PAID')::INTEGER AS paid,
      count(*) FILTER (WHERE status = 'WAIVED')::INTEGER AS waived,
      count(*) FILTER (WHERE status = 'PENDING' AND due_date >= CURRENT_DATE)::INTEGER AS pending,
      count(*) FILTER (WHERE status = 'LATE' OR (status = 'PENDING' AND due_date < CURRENT_DATE))::INTEGER AS late,
      count(*) FILTER (WHERE status = 'PAID' AND paid_at IS NOT NULL AND paid_at::DATE < due_date)::INTEGER AS "earlyPoints"
     FROM payments
     WHERE ($1::UUID IS NULL OR season_id = $1)`,
    [req.query.seasonId || null]
  );
  res.json(result.rows[0]);
}));

paymentsRouter.get('/me', asyncHandler(async (req: AuthRequest, res) => {
  const result = await query(
    `SELECT reference_month AS "referenceMonth", due_date AS "dueDate", amount_cents AS "amountCents", status, paid_at AS "paidAt",
      (status = 'PAID' AND paid_at IS NOT NULL AND paid_at::DATE < due_date) AS "earnsPoint"
     FROM payments
     WHERE user_id = $1
     ORDER BY reference_month DESC, due_date ASC
     LIMIT 18`,
    [req.user?.id]
  );
  res.json(result.rows);
}));

paymentsRouter.put('/', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req: AuthRequest, res) => {
  const body = validate(upsertPaymentSchema, req.body);
  const dueDate = body.dueDate ?? body.referenceMonth;
  const paidAt = body.paidAt ?? (body.status === 'PAID' ? new Date().toISOString() : null);
  const result = await query(
    `INSERT INTO payments (user_id, season_id, reference_month, due_date, amount_cents, status, paid_at, notes, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id, reference_month) DO UPDATE SET
      season_id = EXCLUDED.season_id,
      due_date = EXCLUDED.due_date,
      amount_cents = EXCLUDED.amount_cents,
      status = EXCLUDED.status,
      paid_at = EXCLUDED.paid_at,
      notes = EXCLUDED.notes,
      recorded_by = EXCLUDED.recorded_by,
      updated_at = now()
     RETURNING id, user_id AS "userId", season_id AS "seasonId", reference_month AS "referenceMonth", due_date AS "dueDate", amount_cents AS "amountCents", status, paid_at AS "paidAt", (status = 'PAID' AND paid_at IS NOT NULL AND paid_at::DATE < due_date) AS "earnsPoint", notes`,
    [body.userId, body.seasonId ?? null, body.referenceMonth, dueDate, body.amountCents, body.status, paidAt, body.notes ?? null, req.user?.id]
  );
  res.json(result.rows[0]);
}));

paymentsRouter.post('/generate-month', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req: AuthRequest, res) => {
  const body = validate(generateMonthlyPaymentsSchema, req.body);
  const result = await query<{ id: string }>(
    `INSERT INTO payments (user_id, season_id, reference_month, due_date, amount_cents, status, paid_at, notes, recorded_by)
     SELECT id, $1, $2, $3, $4, 'PENDING', NULL, $5, $6
     FROM users
     WHERE active = TRUE AND role = 'ATLETA'
     ON CONFLICT (user_id, reference_month) DO UPDATE SET
       season_id = COALESCE(payments.season_id, EXCLUDED.season_id),
       due_date = EXCLUDED.due_date,
       amount_cents = EXCLUDED.amount_cents,
       notes = COALESCE(EXCLUDED.notes, payments.notes),
       recorded_by = EXCLUDED.recorded_by,
       updated_at = now()
     WHERE payments.status <> 'PAID'
     RETURNING id`,
    [body.seasonId ?? null, body.referenceMonth, body.dueDate, body.amountCents, body.notes ?? null, req.user?.id]
  );
  res.status(201).json({ generated: result.rowCount });
}));
