import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool';
import { requireAuth, requireRoles } from '../security/auth';
import { consolidateRankingAwards } from '../services/awardRules';
import { AuthRequest } from '../types';
import { asyncHandler, httpError, validate } from '../utils/http';

export const seasonsRouter = Router();

const seasonSchema = z.object({ name: z.string().min(2), year: z.number().int().min(2000).max(2100), startsOn: z.string().date().nullable().optional(), endsOn: z.string().date().nullable().optional() });
const standingImportRowSchema = z.object({
  userId: z.string().uuid().optional(),
  email: z.string().email().optional(),
  name: z.string().min(2).optional(),
  gamesPlayed: z.number().int().min(0).default(0),
  presences: z.number().int().min(0).default(0),
  wins: z.number().int().min(0).default(0),
  draws: z.number().int().min(0).default(0),
  losses: z.number().int().min(0).default(0),
  paidMonths: z.number().int().min(0).default(0),
  goals: z.number().int().min(0).default(0),
  ownGoals: z.number().int().min(0).default(0),
  assists: z.number().int().min(0).default(0),
  yellowCards: z.number().int().min(0).default(0),
  redCards: z.number().int().min(0).default(0),
  blueCards: z.number().int().min(0).default(0),
  teamGoalsFor: z.number().int().min(0).default(0),
  teamGoalsAgainst: z.number().int().min(0).default(0),
  totalPoints: z.number().int().default(0),
  notes: z.string().max(300).optional()
}).refine((row) => row.userId || row.email || row.name, 'Informe userId, email ou name para localizar o atleta.');
const standingImportSchema = z.object({ replace: z.boolean().default(true), rows: z.array(standingImportRowSchema).min(1).max(200) });

async function generateRankingAwards(seasonId: string): Promise<void> {
  await consolidateRankingAwards(seasonId);
}

seasonsRouter.use(requireAuth);

seasonsRouter.get('/', asyncHandler(async (_req, res) => {
  const result = await query('SELECT id, name, year, status, starts_on AS "startsOn", ends_on AS "endsOn", voting_open AS "votingOpen", created_at AS "createdAt" FROM seasons ORDER BY year DESC, created_at DESC');
  res.json(result.rows);
}));

seasonsRouter.post('/', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req: AuthRequest, res) => {
  const body = validate(seasonSchema, req.body);
  const result = await query(
    `INSERT INTO seasons (name, year, starts_on, ends_on, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, year, status, starts_on AS "startsOn", ends_on AS "endsOn"`,
    [body.name, body.year, body.startsOn ?? null, body.endsOn ?? null, req.user?.id]
  );
  res.status(201).json(result.rows[0]);
}));

seasonsRouter.post('/:id/start', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req, res) => {
  const open = await query('SELECT id FROM seasons WHERE status = \'OPEN\' AND id <> $1', [req.params.id]);
  if (open.rowCount) throw httpError(409, 'Já existe temporada aberta. Encerre-a antes de iniciar outra.');

  const result = await query(
    `UPDATE seasons SET status = 'OPEN', started_at = COALESCE(started_at, now()), updated_at = now()
     WHERE id = $1 AND status <> 'CLOSED'
     RETURNING id, name, year, status, voting_open AS "votingOpen"`,
    [req.params.id]
  );
  if (!result.rowCount) throw httpError(409, 'Temporada não encontrada ou já encerrada.');
  res.json(result.rows[0]);
}));

seasonsRouter.post('/:id/close', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req, res) => {
  const result = await query(
    `UPDATE seasons SET status = 'CLOSED', voting_open = TRUE, closed_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'OPEN'
     RETURNING id, name, year, status, voting_open AS "votingOpen"`,
    [req.params.id]
  );
  if (result.rowCount) {
    await generateRankingAwards(req.params.id);
  }
  if (!result.rowCount) throw httpError(409, 'Somente temporada aberta pode ser encerrada.');
  res.json(result.rows[0]);
}));

seasonsRouter.get('/:id/standings', asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT ss.*, u.name, u.avatar_data_url AS "avatarDataUrl",
      row_number() OVER (ORDER BY ss.total_points DESC, ss.wins DESC, ss.games_played DESC, ss.presences DESC, ss.goals DESC, u.name ASC)::INTEGER AS position
     FROM season_standings ss
     JOIN users u ON u.id = ss.user_id
     WHERE ss.season_id = $1 AND (ss.games_played > 0 OR ss.presences > 0 OR ss.paid_months > 0 OR ss.goals > 0 OR ss.assists > 0)
     ORDER BY position ASC`,
    [req.params.id]
  );
  res.json(result.rows);
}));

seasonsRouter.get('/:id/rankings', asyncHandler(async (req, res) => {
  const goals = await query('SELECT ss.user_id AS "userId", u.name, ss.goals, ss.own_goals AS "ownGoals", ss.net_goals AS "netGoals", ss.games_played AS "gamesPlayed", CASE WHEN ss.games_played > 0 THEN round((ss.goals::NUMERIC / ss.games_played), 2) ELSE 0 END AS average FROM season_standings ss JOIN users u ON u.id = ss.user_id WHERE ss.season_id = $1 AND (ss.goals > 0 OR ss.own_goals > 0) ORDER BY ss.net_goals DESC, ss.goals DESC, u.name ASC LIMIT 32', [req.params.id]);
  const assists = await query('SELECT ss.user_id AS "userId", u.name, ss.assists, ss.games_played AS "gamesPlayed", CASE WHEN ss.games_played > 0 THEN round((ss.assists::NUMERIC / ss.games_played), 2) ELSE 0 END AS average FROM season_standings ss JOIN users u ON u.id = ss.user_id WHERE ss.season_id = $1 AND ss.assists > 0 ORDER BY ss.assists DESC, u.name ASC LIMIT 32', [req.params.id]);
  const presence = await query('SELECT ss.user_id AS "userId", u.name, ss.games_played AS "gamesPlayed", ss.presences, (ss.games_played + ss.presences)::INTEGER AS total, CASE WHEN (SELECT count(*) FROM matches WHERE season_id = $1 AND status = \'CONFIRMED\') > 0 THEN round(((ss.games_played + ss.presences)::NUMERIC / (SELECT count(*) FROM matches WHERE season_id = $1 AND status = \'CONFIRMED\')) * 100, 0) ELSE 0 END AS percentage FROM season_standings ss JOIN users u ON u.id = ss.user_id WHERE ss.season_id = $1 AND (ss.games_played > 0 OR ss.presences > 0) ORDER BY total DESC, ss.games_played DESC, u.name ASC LIMIT 32', [req.params.id]);
  const cards = await query('SELECT ss.user_id AS "userId", u.name, ss.card_points AS "cardPoints", ss.total_cards AS "totalCards", ss.games_played AS "gamesPlayed", CASE WHEN ss.games_played > 0 THEN round((ss.total_cards::NUMERIC / ss.games_played), 2) ELSE 0 END AS average FROM season_standings ss JOIN users u ON u.id = ss.user_id WHERE ss.season_id = $1 AND ss.total_cards > 0 ORDER BY ss.card_points DESC, ss.total_cards DESC, u.name ASC LIMIT 32', [req.params.id]);
  res.json({ goals: goals.rows, assists: assists.rows, presence: presence.rows, cards: cards.rows });
}));

seasonsRouter.post('/:id/standing-adjustments/import', requireRoles('ADMIN'), asyncHandler(async (req: AuthRequest, res) => {
  const body = validate(standingImportSchema, req.body);
  const season = await query('SELECT id FROM seasons WHERE id = $1', [req.params.id]);
  if (!season.rowCount) throw httpError(404, 'Temporada não encontrada.');

  if (body.replace) {
    await query('DELETE FROM season_standing_adjustments WHERE season_id = $1', [req.params.id]);
  }

  const imported: Array<{ name: string; email: string; totalPoints: number }> = [];
  const skipped: Array<{ identifier: string; reason: string }> = [];

  for (const row of body.rows) {
    const identifier = row.email ?? row.name ?? row.userId ?? 'linha sem identificação';
    const users = await query<{ id: string; name: string; email: string }>(
      `SELECT id, name, email
       FROM users
       WHERE active = TRUE AND (
        ($1::UUID IS NOT NULL AND id = $1)
        OR ($2::TEXT IS NOT NULL AND lower(email) = lower($2))
        OR ($3::TEXT IS NOT NULL AND lower(trim(name)) = lower(trim($3)))
       )
       ORDER BY CASE WHEN $1::UUID IS NOT NULL AND id = $1 THEN 1 WHEN $2::TEXT IS NOT NULL AND lower(email) = lower($2) THEN 2 ELSE 3 END
       LIMIT 2`,
      [row.userId ?? null, row.email ?? null, row.name ?? null]
    );

    if (users.rowCount !== 1) {
      skipped.push({ identifier, reason: users.rowCount ? 'mais de um usuário encontrado; use e-mail para importar com segurança' : 'usuário ativo não encontrado' });
      continue;
    }

    const user = users.rows[0];
    await query(
      `INSERT INTO season_standing_adjustments (season_id, user_id, games_played, presences, wins, draws, losses, paid_months, goals, own_goals, assists, yellow_cards, red_cards, blue_cards, team_goals_for, team_goals_against, total_points, notes, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, now())
       ON CONFLICT (season_id, user_id) DO UPDATE SET
        games_played = EXCLUDED.games_played,
        presences = EXCLUDED.presences,
        wins = EXCLUDED.wins,
        draws = EXCLUDED.draws,
        losses = EXCLUDED.losses,
        paid_months = EXCLUDED.paid_months,
        goals = EXCLUDED.goals,
        own_goals = EXCLUDED.own_goals,
        assists = EXCLUDED.assists,
        yellow_cards = EXCLUDED.yellow_cards,
        red_cards = EXCLUDED.red_cards,
        blue_cards = EXCLUDED.blue_cards,
        team_goals_for = EXCLUDED.team_goals_for,
        team_goals_against = EXCLUDED.team_goals_against,
        total_points = EXCLUDED.total_points,
        notes = EXCLUDED.notes,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()`,
      [req.params.id, user.id, row.gamesPlayed, row.presences, row.wins, row.draws, row.losses, row.paidMonths, row.goals, row.ownGoals, row.assists, row.yellowCards, row.redCards, row.blueCards, row.teamGoalsFor, row.teamGoalsAgainst, row.totalPoints, row.notes ?? 'Importação do Excel', req.user?.id]
    );
    imported.push({ name: user.name, email: user.email, totalPoints: row.totalPoints ?? 0 });
  }

  res.json({ imported, skipped });
}));
