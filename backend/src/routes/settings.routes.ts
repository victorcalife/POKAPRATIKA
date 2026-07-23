import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool';
import { requireAuth, requireRoles } from '../security/auth';
import { asyncHandler, validate } from '../utils/http';

export const settingsRouter = Router();

const pointsSchema = z.object({
  settings: z.array(z.object({
    code: z.enum(['PRESENTE', 'PAGAMENTO_EM_DIA', 'VITORIA', 'DERROTA', 'EMPATE']),
    points: z.number().int().min(-100).max(100)
  })).min(1)
});

settingsRouter.use(requireAuth);

settingsRouter.get('/points', asyncHandler(async (_req, res) => {
  const result = await query('SELECT code, label, points, updated_at AS "updatedAt" FROM point_settings ORDER BY code');
  res.json(result.rows);
}));

settingsRouter.put('/points', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req, res) => {
  const body = validate(pointsSchema, req.body);

  for (const item of body.settings) {
    await query('UPDATE point_settings SET points = $2, updated_at = now() WHERE code = $1', [item.code, item.points]);
  }

  const result = await query('SELECT code, label, points, updated_at AS "updatedAt" FROM point_settings ORDER BY code');
  res.json(result.rows);
}));
