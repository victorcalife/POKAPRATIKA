import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool';
import { requireAuth, requireRoles } from '../security/auth';
import { metricOptions } from '../services/awardRules';
import { asyncHandler, validate } from '../utils/http';

export const settingsRouter = Router();

const pointsSchema = z.object({
  settings: z.array(z.object({
    code: z.string().min(2).max(60),
    points: z.number().int().min(-100).max(100)
  })).min(1)
});
const awardsSchema = z.object({
  categories: z.array(z.object({
    code: z.string().min(2).max(60),
    label: z.string().min(2).max(120),
    votingEnabled: z.boolean(),
    active: z.boolean().default(true),
    awardType: z.enum(['RANKING', 'VOTACAO', 'SORTEIO', 'MANUAL']).default('RANKING'),
    metricCode: z.enum(metricOptions as [string, ...string[]]).nullable().optional(),
    sortDirection: z.enum(['ASC', 'DESC']).default('DESC'),
    winnersCount: z.number().int().min(1).max(20).default(1),
    minGames: z.number().int().min(0).max(500).default(0),
    voteSlots: z.number().int().min(1).max(7).default(1),
    allowSelfVote: z.boolean().default(false),
    badgeIcon: z.string().min(1).max(12).default('🏅'),
    badgeColor: z.string().min(4).max(24).default('#3b82f6')
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

settingsRouter.get('/awards', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (_req, res) => {
  const result = await query(`SELECT code, label, voting_enabled AS "votingEnabled", admin_only AS "adminOnly",
    active, award_type AS "awardType", metric_code AS "metricCode", sort_direction AS "sortDirection",
    winners_count AS "winnersCount", min_games AS "minGames", vote_slots AS "voteSlots", allow_self_vote AS "allowSelfVote",
    badge_icon AS "badgeIcon", badge_color AS "badgeColor"
   FROM award_categories
   ORDER BY active DESC, award_type ASC, label ASC`);
  res.json(result.rows);
}));

settingsRouter.put('/awards', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req, res) => {
  const body = validate(awardsSchema, req.body);

  for (const item of body.categories) {
    const normalizedCode = item.code.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    await query(
      `INSERT INTO award_categories (code, label, voting_enabled, active, award_type, metric_code, sort_direction, winners_count, min_games, vote_slots, allow_self_vote, badge_icon, badge_color, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
       ON CONFLICT (code) DO UPDATE SET
        label = EXCLUDED.label,
        voting_enabled = EXCLUDED.voting_enabled,
        active = EXCLUDED.active,
        award_type = EXCLUDED.award_type,
        metric_code = EXCLUDED.metric_code,
        sort_direction = EXCLUDED.sort_direction,
        winners_count = EXCLUDED.winners_count,
        min_games = EXCLUDED.min_games,
        vote_slots = EXCLUDED.vote_slots,
        allow_self_vote = EXCLUDED.allow_self_vote,
        badge_icon = EXCLUDED.badge_icon,
        badge_color = EXCLUDED.badge_color,
        updated_at = now()`,
      [normalizedCode, item.label.trim(), item.awardType === 'VOTACAO' ? item.votingEnabled : false, item.active, item.awardType, item.awardType === 'RANKING' ? item.metricCode ?? 'TOTAL_POINTS' : null, item.sortDirection, item.winnersCount, item.minGames, item.voteSlots, item.allowSelfVote, item.badgeIcon, item.badgeColor]
    );
  }

  const result = await query(`SELECT code, label, voting_enabled AS "votingEnabled", admin_only AS "adminOnly",
    active, award_type AS "awardType", metric_code AS "metricCode", sort_direction AS "sortDirection",
    winners_count AS "winnersCount", min_games AS "minGames", vote_slots AS "voteSlots", allow_self_vote AS "allowSelfVote",
    badge_icon AS "badgeIcon", badge_color AS "badgeColor"
   FROM award_categories
   ORDER BY active DESC, award_type ASC, label ASC`);
  res.json(result.rows);
}));
