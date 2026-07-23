import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool';
import { requireAuth, requireRoles } from '../security/auth';
import { asyncHandler, validate } from '../utils/http';

export const suspensionsRouter = Router();

const serveSchema = z.object({ servedMatchId: z.string().uuid() });

suspensionsRouter.use(requireAuth);

suspensionsRouter.get('/', asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT s.id, s.user_id AS "userId", u.name AS "userName", s.season_id AS "seasonId", se.name AS "seasonName",
      s.trigger_match_id AS "triggerMatchId", tm.title AS "triggerMatchTitle", s.reason, s.matches_to_serve AS "matchesToServe",
      s.served_match_id AS "servedMatchId", sm.title AS "servedMatchTitle", s.served_at AS "servedAt", s.created_at AS "createdAt"
     FROM athlete_suspensions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN seasons se ON se.id = s.season_id
     JOIN matches tm ON tm.id = s.trigger_match_id
     LEFT JOIN matches sm ON sm.id = s.served_match_id
     WHERE ($1::BOOLEAN = FALSE OR s.served_at IS NULL)
     ORDER BY s.served_at NULLS FIRST, s.created_at DESC`,
    [req.query.openOnly !== 'false']
  );
  res.json(result.rows);
}));

suspensionsRouter.post('/:id/serve', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req, res) => {
  const body = validate(serveSchema, req.body);
  const result = await query(
    `UPDATE athlete_suspensions
     SET served_match_id = $2, served_at = now()
     WHERE id = $1 AND served_at IS NULL
     RETURNING id, user_id AS "userId", served_match_id AS "servedMatchId", served_at AS "servedAt"`,
    [req.params.id, body.servedMatchId]
  );
  res.json(result.rows[0]);
}));
