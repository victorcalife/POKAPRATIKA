import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool';
import { requireAuth, requireRoles } from '../security/auth';
import { AuthRequest } from '../types';
import { asyncHandler, httpError, validate } from '../utils/http';

export const awardsRouter = Router();

const voteSchema = z.object({ seasonId: z.string().uuid(), categoryCode: z.string().min(2), votedUserId: z.string().uuid() });

awardsRouter.use(requireAuth);

awardsRouter.get('/categories', asyncHandler(async (_req, res) => {
  const result = await query('SELECT code, label, voting_enabled AS "votingEnabled" FROM award_categories WHERE voting_enabled = TRUE ORDER BY label');
  res.json(result.rows);
}));

awardsRouter.post('/vote', asyncHandler(async (req: AuthRequest, res) => {
  const body = validate(voteSchema, req.body);
  const season = await query<{ voting_open: boolean }>('SELECT voting_open FROM seasons WHERE id = $1 AND status = \'CLOSED\'', [body.seasonId]);
  if (!season.rows[0]?.voting_open) throw httpError(409, 'A votação desta temporada ainda não está aberta.');

  const category = await query('SELECT code FROM award_categories WHERE code = $1 AND voting_enabled = TRUE', [body.categoryCode]);
  if (!category.rowCount) throw httpError(400, 'Categoria de votação inválida.');

  const result = await query(
    `INSERT INTO award_votes (season_id, voter_user_id, category_code, voted_user_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (season_id, voter_user_id, category_code) DO UPDATE SET voted_user_id = EXCLUDED.voted_user_id, updated_at = now()
     RETURNING season_id AS "seasonId", category_code AS "categoryCode", voted_user_id AS "votedUserId"`,
    [body.seasonId, req.user?.id, body.categoryCode, body.votedUserId]
  );
  res.json(result.rows[0]);
}));

awardsRouter.get('/my-votes/:seasonId', asyncHandler(async (req: AuthRequest, res) => {
  const result = await query('SELECT category_code AS "categoryCode", voted_user_id AS "votedUserId" FROM award_votes WHERE season_id = $1 AND voter_user_id = $2', [req.params.seasonId, req.user?.id]);
  res.json(result.rows);
}));

awardsRouter.get('/results/:seasonId', requireRoles('ADMIN'), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT av.category_code AS "categoryCode", ac.label, av.voted_user_id AS "userId", u.name, count(*)::INTEGER AS votes
     FROM award_votes av
     JOIN award_categories ac ON ac.code = av.category_code
     JOIN users u ON u.id = av.voted_user_id
     WHERE av.season_id = $1
     GROUP BY av.category_code, ac.label, av.voted_user_id, u.name
     ORDER BY ac.label ASC, votes DESC, u.name ASC`,
    [req.params.seasonId]
  );
  res.json(result.rows);
}));

awardsRouter.post('/consolidate/:seasonId', requireRoles('ADMIN'), asyncHandler(async (req, res) => {
  const season = await query('SELECT id FROM seasons WHERE id = $1 AND status = \'CLOSED\'', [req.params.seasonId]);
  if (!season.rowCount) throw httpError(409, 'A consolidação de prêmios exige temporada encerrada.');

  const votingCategories = await query<{ code: string }>('SELECT code FROM award_categories WHERE voting_enabled = TRUE', []);
  await query("DELETE FROM season_awards WHERE season_id = $1 AND source = 'VOTACAO'", [req.params.seasonId]);
  await query(
    `DELETE FROM athlete_badges
     WHERE season_id = $1
       AND code = ANY($2::TEXT[])`,
    [req.params.seasonId, votingCategories.rows.map((item) => item.code)]
  );

  const result = await query(
    `INSERT INTO season_awards (season_id, category_code, user_id, placement, source)
     SELECT $1, winners.category_code, winners.voted_user_id, 1, 'VOTACAO'
     FROM (
      SELECT av.category_code, av.voted_user_id,
        row_number() OVER (PARTITION BY av.category_code ORDER BY count(*) DESC, min(u.name) ASC, av.voted_user_id ASC)::INTEGER AS position
      FROM award_votes av
      JOIN users u ON u.id = av.voted_user_id
      WHERE av.season_id = $1
      GROUP BY av.category_code, av.voted_user_id
     ) winners
     WHERE winners.position = 1
     ON CONFLICT (season_id, category_code, placement) DO UPDATE SET user_id = EXCLUDED.user_id, source = EXCLUDED.source
     RETURNING category_code AS "categoryCode", user_id AS "userId"`,
    [req.params.seasonId]
  );

  await query(
    `INSERT INTO athlete_badges (user_id, season_id, code, label)
     SELECT sa.user_id, sa.season_id, sa.category_code, ac.label
     FROM season_awards sa
     JOIN award_categories ac ON ac.code = sa.category_code
     WHERE sa.season_id = $1 AND sa.source = 'VOTACAO'
     ON CONFLICT (user_id, season_id, code) DO NOTHING`,
    [req.params.seasonId]
  );

  res.json({ consolidated: result.rows });
}));
