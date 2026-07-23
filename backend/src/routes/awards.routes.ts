import { Router } from 'express';
import { z } from 'zod';
import { pool, query } from '../db/pool';
import { requireAuth, requireRoles } from '../security/auth';
import { getAwardLeaderboards } from '../services/awardRules';
import { AuthRequest } from '../types';
import { asyncHandler, httpError, validate } from '../utils/http';

export const awardsRouter = Router();

const voteSchema = z.object({
  seasonId: z.string().uuid(),
  categoryCode: z.string().min(2),
  votedUserId: z.string().uuid().optional(),
  votes: z.array(z.string().uuid()).min(1).max(7).optional()
});
const selectionYearSchema = z.object({ seasonId: z.string().uuid(), goalkeeperUserId: z.string().uuid(), lineUserIds: z.array(z.string().uuid()).length(6) });

awardsRouter.use(requireAuth);

awardsRouter.get('/categories', asyncHandler(async (_req, res) => {
  const result = await query(`SELECT code, label, voting_enabled AS "votingEnabled", award_type AS "awardType", vote_slots AS "voteSlots",
    allow_self_vote AS "allowSelfVote", badge_icon AS "badgeIcon", badge_color AS "badgeColor"
   FROM award_categories
   WHERE active = TRUE AND voting_enabled = TRUE
   ORDER BY label`);
  res.json(result.rows);
}));

awardsRouter.get('/leaderboards/:seasonId', asyncHandler(async (req, res) => {
  res.json(await getAwardLeaderboards(req.params.seasonId));
}));

awardsRouter.post('/vote', asyncHandler(async (req: AuthRequest, res) => {
  const body = validate(voteSchema, req.body);
  if (body.categoryCode === 'SELECAO_ANO') throw httpError(400, 'Seleção do ano exige 1 goleiro e 6 jogadores de linha. Use a votação específica da seleção.');
  const season = await query<{ voting_open: boolean }>('SELECT voting_open FROM seasons WHERE id = $1 AND status = \'CLOSED\'', [body.seasonId]);
  if (!season.rows[0]?.voting_open) throw httpError(409, 'A votação desta temporada ainda não está aberta.');

  const category = await query<{ code: string; vote_slots: number; allow_self_vote: boolean }>('SELECT code, vote_slots, allow_self_vote FROM award_categories WHERE code = $1 AND active = TRUE AND voting_enabled = TRUE', [body.categoryCode]);
  const categoryRow = category.rows[0];
  if (!categoryRow) throw httpError(400, 'Categoria de votação inválida.');

  const votes = (body.votes?.length ? body.votes : body.votedUserId ? [body.votedUserId] : []).slice(0, categoryRow.vote_slots);
  if (votes.length !== categoryRow.vote_slots) throw httpError(400, `Esta categoria exige ${categoryRow.vote_slots} voto(s).`);
  if (new Set(votes).size !== votes.length) throw httpError(400, 'A mesma categoria não pode repetir atleta nos votos.');
  if (!categoryRow.allow_self_vote && votes.includes(req.user?.id ?? '')) throw httpError(400, 'Esta categoria não permite votar em si mesmo.');

  const votedUsers = await query('SELECT id FROM users WHERE id = ANY($1::UUID[]) AND active = TRUE', [votes]);
  if (votedUsers.rowCount !== votes.length) throw httpError(400, 'Todos os atletas votados precisam estar ativos.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM award_votes WHERE season_id = $1 AND voter_user_id = $2 AND category_code = $3', [body.seasonId, req.user?.id, body.categoryCode]);
    await client.query(
      `INSERT INTO award_votes (season_id, voter_user_id, category_code, vote_slot, voted_user_id)
       SELECT $1, $2, $3, vote_slot, voted_user_id::UUID
       FROM unnest($4::INTEGER[], $5::TEXT[]) AS votes(vote_slot, voted_user_id)`,
      [body.seasonId, req.user?.id, body.categoryCode, votes.map((_id, index) => index + 1), votes]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json(votes.map((votedUserId, index) => ({ seasonId: body.seasonId, categoryCode: body.categoryCode, voteSlot: index + 1, votedUserId })));
}));

awardsRouter.post('/selection-year', asyncHandler(async (req: AuthRequest, res) => {
  const body = validate(selectionYearSchema, req.body);
  const selectedIds = [body.goalkeeperUserId, ...body.lineUserIds];
  if (new Set(selectedIds).size !== 7) throw httpError(400, 'A seleção do ano precisa ter 7 atletas diferentes.');

  const season = await query<{ voting_open: boolean }>('SELECT voting_open FROM seasons WHERE id = $1 AND status = \'CLOSED\'', [body.seasonId]);
  if (!season.rows[0]?.voting_open) throw httpError(409, 'A votação desta temporada ainda não está aberta.');

  const category = await query('SELECT code FROM award_categories WHERE code = \'SELECAO_ANO\' AND active = TRUE AND voting_enabled = TRUE', []);
  if (!category.rowCount) throw httpError(400, 'Seleção do ano não está ativa para votação.');

  const users = await query<{ id: string; position: string; active: boolean }>('SELECT id, position, active FROM users WHERE id = ANY($1::UUID[])', [selectedIds]);
  if (users.rowCount !== 7 || users.rows.some((user) => !user.active)) throw httpError(400, 'Todos os atletas votados precisam estar ativos.');
  const userMap = new Map(users.rows.map((user) => [user.id, user]));
  if (userMap.get(body.goalkeeperUserId)?.position !== 'GO') throw httpError(400, 'A seleção do ano exige exatamente 1 goleiro cadastrado como GO.');
  if (body.lineUserIds.some((id) => userMap.get(id)?.position === 'GO')) throw httpError(400, 'Os 6 jogadores de linha não podem estar cadastrados como GO.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM award_votes WHERE season_id = $1 AND voter_user_id = $2 AND category_code = \'SELECAO_ANO\'', [body.seasonId, req.user?.id]);
    await client.query(
      `INSERT INTO award_votes (season_id, voter_user_id, category_code, vote_slot, voted_user_id)
       SELECT $1, $2, 'SELECAO_ANO', vote_slot, voted_user_id::UUID
       FROM unnest($3::INTEGER[], $4::TEXT[]) AS votes(vote_slot, voted_user_id)`,
      [body.seasonId, req.user?.id, [1, 2, 3, 4, 5, 6, 7], selectedIds]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json({ categoryCode: 'SELECAO_ANO', goalkeeperUserId: body.goalkeeperUserId, lineUserIds: body.lineUserIds });
}));

awardsRouter.get('/my-votes/:seasonId', asyncHandler(async (req: AuthRequest, res) => {
  const result = await query('SELECT category_code AS "categoryCode", vote_slot AS "voteSlot", voted_user_id AS "votedUserId" FROM award_votes WHERE season_id = $1 AND voter_user_id = $2 ORDER BY category_code, vote_slot', [req.params.seasonId, req.user?.id]);
  res.json(result.rows);
}));

awardsRouter.get('/results/:seasonId', requireRoles('ADMIN'), asyncHandler(async (req, res) => {
  const result = await query(
     `SELECT av.category_code AS "categoryCode", ac.label,
       CASE WHEN av.category_code = 'SELECAO_ANO' AND av.vote_slot > 1 THEN 2 ELSE av.vote_slot END AS "voteSlot",
       av.voted_user_id AS "userId", u.name, count(*)::INTEGER AS votes
     FROM award_votes av
     JOIN award_categories ac ON ac.code = av.category_code
     JOIN users u ON u.id = av.voted_user_id
     WHERE av.season_id = $1
    GROUP BY av.category_code, ac.label, CASE WHEN av.category_code = 'SELECAO_ANO' AND av.vote_slot > 1 THEN 2 ELSE av.vote_slot END, av.voted_user_id, u.name
    ORDER BY ac.label ASC, "voteSlot" ASC, votes DESC, u.name ASC`,
    [req.params.seasonId]
  );
  res.json(result.rows);
}));

awardsRouter.post('/consolidate/:seasonId', requireRoles('ADMIN'), asyncHandler(async (req, res) => {
  const season = await query('SELECT id FROM seasons WHERE id = $1 AND status = \'CLOSED\'', [req.params.seasonId]);
  if (!season.rowCount) throw httpError(409, 'A consolidação de prêmios exige temporada encerrada.');

  const votingCategories = await query<{ code: string }>('SELECT code FROM award_categories WHERE active = TRUE AND voting_enabled = TRUE', []);
  await query("DELETE FROM season_awards WHERE season_id = $1 AND source = 'VOTACAO'", [req.params.seasonId]);
  await query(
    `DELETE FROM athlete_badges
     WHERE season_id = $1
       AND code = ANY($2::TEXT[])`,
    [req.params.seasonId, votingCategories.rows.map((item) => item.code)]
  );

  const result = await query(
    `INSERT INTO season_awards (season_id, category_code, user_id, placement, source)
     SELECT $1, winners.category_code, winners.voted_user_id, winners.placement, 'VOTACAO'
     FROM (
      SELECT ranked.category_code, ranked.voted_user_id,
        CASE
          WHEN ranked.category_code = 'SELECAO_ANO' AND ranked.role_bucket = 'GO' THEN 1
          WHEN ranked.category_code = 'SELECAO_ANO' THEN ranked.position + 1
          ELSE ranked.position
        END AS placement,
        CASE WHEN ranked.category_code = 'SELECAO_ANO' AND ranked.role_bucket = 'GO' THEN 1 WHEN ranked.category_code = 'SELECAO_ANO' THEN 6 ELSE ranked.winners_count END AS max_winners,
        ranked.position
      FROM (
        SELECT totals.category_code, totals.role_bucket, totals.voted_user_id, totals.winners_count,
          row_number() OVER (PARTITION BY totals.category_code, totals.role_bucket ORDER BY totals.votes DESC, totals.name ASC, totals.voted_user_id ASC)::INTEGER AS position
        FROM (
          SELECT av.category_code, ac.winners_count,
            CASE WHEN av.category_code = 'SELECAO_ANO' AND av.vote_slot = 1 THEN 'GO' WHEN av.category_code = 'SELECAO_ANO' THEN 'LINHA' ELSE av.category_code END AS role_bucket,
            av.voted_user_id,
            min(u.name) AS name,
            count(*)::INTEGER AS votes
          FROM award_votes av
          JOIN award_categories ac ON ac.code = av.category_code AND ac.active = TRUE AND ac.voting_enabled = TRUE
          JOIN users u ON u.id = av.voted_user_id
          WHERE av.season_id = $1
          GROUP BY av.category_code, ac.winners_count, role_bucket, av.voted_user_id
        ) totals
      ) ranked
     ) winners
     WHERE winners.position <= winners.max_winners
     ON CONFLICT (season_id, category_code, placement) DO UPDATE SET user_id = EXCLUDED.user_id, source = EXCLUDED.source
     RETURNING category_code AS "categoryCode", user_id AS "userId"`,
    [req.params.seasonId]
  );

  await query(
    `INSERT INTO athlete_badges (user_id, season_id, code, label, icon, color)
     SELECT sa.user_id, sa.season_id, sa.category_code, ac.label, ac.badge_icon, ac.badge_color
     FROM season_awards sa
     JOIN award_categories ac ON ac.code = sa.category_code
     WHERE sa.season_id = $1 AND sa.source = 'VOTACAO'
     ON CONFLICT (user_id, season_id, code) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, color = EXCLUDED.color`,
    [req.params.seasonId]
  );

  res.json({ consolidated: result.rows });
}));
