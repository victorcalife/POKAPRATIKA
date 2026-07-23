import { pool, query } from '../db/pool';

export type AwardType = 'RANKING' | 'VOTACAO' | 'SORTEIO' | 'MANUAL';
export type SortDirection = 'ASC' | 'DESC';

export type AwardRule = {
  code: string;
  label: string;
  awardType: AwardType;
  metricCode: string | null;
  sortDirection: SortDirection;
  winnersCount: number;
  minGames: number;
  voteSlots: number;
  allowSelfVote: boolean;
  badgeIcon: string;
  badgeColor: string;
  active: boolean;
};

const metricExpressions: Record<string, string> = {
  TOTAL_POINTS: 'ss.total_points::NUMERIC',
  GOALS: 'ss.goals::NUMERIC',
  ASSISTS: 'ss.assists::NUMERIC',
  TOTAL_CARDS: 'ss.total_cards::NUMERIC',
  CARD_POINTS: 'ss.card_points::NUMERIC',
  ASSIDUITY: '(ss.games_played + ss.presences)::NUMERIC',
  PRESENCE_PERCENTAGE: 'CASE WHEN (ss.games_played + ss.presences) > 0 THEN round(((ss.games_played + ss.presences)::NUMERIC / GREATEST((SELECT count(*) FROM matches WHERE season_id = ss.season_id AND status = \'CONFIRMED\'), 1)) * 100, 1) ELSE 0 END',
  WIN_PERCENTAGE: 'CASE WHEN ss.games_played > 0 THEN round((((ss.wins * 3) + ss.draws)::NUMERIC / GREATEST(ss.games_played * 3, 1)) * 100, 1) ELSE 0 END',
  WINS: 'ss.wins::NUMERIC',
  TEAM_GOAL_BALANCE: 'ss.team_goal_balance::NUMERIC',
  NET_GOALS: 'ss.net_goals::NUMERIC',
  PAID_MONTHS: 'ss.paid_months::NUMERIC'
};

export const metricOptions = Object.keys(metricExpressions);

function metricExpression(metricCode: string): string {
  const expression = metricExpressions[metricCode];
  if (!expression) throw new Error(`Métrica de premiação inválida: ${metricCode}`);
  return expression;
}

export async function getRankingAwardRules(): Promise<AwardRule[]> {
  const result = await query<AwardRule>(
    `SELECT code, label, award_type AS "awardType", metric_code AS "metricCode", sort_direction AS "sortDirection",
      winners_count AS "winnersCount", min_games AS "minGames", vote_slots AS "voteSlots", allow_self_vote AS "allowSelfVote",
      badge_icon AS "badgeIcon", badge_color AS "badgeColor", active
     FROM award_categories
     WHERE active = TRUE AND award_type = 'RANKING' AND metric_code IS NOT NULL
     ORDER BY label ASC`
  );
  return result.rows;
}

export async function getAwardLeaderboards(seasonId: string) {
  const rules = await getRankingAwardRules();
  const boards = [];

  for (const rule of rules) {
    if (!rule.metricCode) continue;
    const expression = metricExpression(rule.metricCode);
    const direction = rule.sortDirection === 'ASC' ? 'ASC' : 'DESC';
    const result = await query(
      `SELECT ranked."userId", ranked.name, ranked.value, ranked."gamesPlayed", ranked."totalPoints", ranked.position
       FROM (
        SELECT ss.user_id AS "userId", u.name, ${expression} AS value, ss.games_played AS "gamesPlayed", ss.total_points AS "totalPoints",
          row_number() OVER (ORDER BY ${expression} ${direction}, ss.total_points DESC, ss.games_played DESC, u.name ASC, ss.user_id ASC)::INTEGER AS position
        FROM season_standings ss
        JOIN users u ON u.id = ss.user_id
        WHERE ss.season_id = $1
          AND ss.games_played >= $2
          AND (ss.games_played > 0 OR ss.presences > 0 OR ss.paid_months > 0 OR ss.goals > 0 OR ss.assists > 0 OR ss.total_cards > 0 OR ss.total_points <> 0)
       ) ranked
       WHERE ranked.position <= $3
       ORDER BY ranked.position ASC`,
      [seasonId, rule.minGames, rule.winnersCount]
    );

    boards.push({
      code: rule.code,
      label: rule.label,
      metricCode: rule.metricCode,
      sortDirection: rule.sortDirection,
      winnersCount: rule.winnersCount,
      minGames: rule.minGames,
      badgeIcon: rule.badgeIcon,
      badgeColor: rule.badgeColor,
      rows: result.rows
    });
  }

  return boards;
}

export async function consolidateRankingAwards(seasonId: string): Promise<void> {
  const rules = await getRankingAwardRules();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("DELETE FROM season_awards WHERE season_id = $1 AND source = 'RANKING'", [seasonId]);
    await client.query(
      `DELETE FROM athlete_badges
       WHERE season_id = $1
         AND code = ANY($2::TEXT[])`,
      [seasonId, rules.map((rule) => rule.code)]
    );

    for (const rule of rules) {
      if (!rule.metricCode) continue;
      const expression = metricExpression(rule.metricCode);
      const direction = rule.sortDirection === 'ASC' ? 'ASC' : 'DESC';
      const winners = await client.query<{ userId: string; position: number }>(
        `SELECT ranked."userId", ranked.position
         FROM (
          SELECT ss.user_id AS "userId",
            row_number() OVER (ORDER BY ${expression} ${direction}, ss.total_points DESC, ss.games_played DESC, ss.user_id ASC)::INTEGER AS position
          FROM season_standings ss
          WHERE ss.season_id = $1
            AND ss.games_played >= $2
            AND (ss.games_played > 0 OR ss.presences > 0 OR ss.paid_months > 0 OR ss.goals > 0 OR ss.assists > 0 OR ss.total_cards > 0 OR ss.total_points <> 0)
         ) ranked
         WHERE ranked.position <= $3
         ORDER BY ranked.position ASC`,
        [seasonId, rule.minGames, rule.winnersCount]
      );

      for (const winner of winners.rows) {
        await client.query(
          `INSERT INTO season_awards (season_id, category_code, user_id, placement, source)
           VALUES ($1, $2, $3, $4, 'RANKING')
           ON CONFLICT (season_id, category_code, placement) DO UPDATE SET user_id = EXCLUDED.user_id, source = EXCLUDED.source`,
          [seasonId, rule.code, winner.userId, winner.position]
        );
      }
    }

    await client.query(
      `INSERT INTO athlete_badges (user_id, season_id, code, label, icon, color)
       SELECT sa.user_id, sa.season_id, sa.category_code, ac.label, ac.badge_icon, ac.badge_color
       FROM season_awards sa
       JOIN award_categories ac ON ac.code = sa.category_code
       WHERE sa.season_id = $1 AND sa.source = 'RANKING'
       ON CONFLICT (user_id, season_id, code) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, color = EXCLUDED.color`,
      [seasonId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
