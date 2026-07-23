import { Router } from 'express';
import { z } from 'zod';
import { pool, query } from '../db/pool';
import { requireAuth, requireRoles } from '../security/auth';
import { AuthRequest } from '../types';
import { buildTeamRotationPlan } from '../services/substitution';
import { asyncHandler, httpError, validate } from '../utils/http';

export const matchesRouter = Router();

const playerSchema = z.object({
  userId: z.string().uuid(),
  team: z.enum(['A', 'B', 'PRESENTE_SEM_JOGAR']),
  roleInMatch: z.enum(['GOLEIRO', 'LINHA', 'PRESENTE_SEM_JOGAR']),
  drawOrder: z.number().int().min(1).nullable().optional(),
  rotationOrder: z.number().int().min(1).nullable().optional(),
  startsOnBench: z.boolean().default(false),
  present: z.boolean().default(true)
});

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Informe horário no formato HH:mm.');

const createMatchBaseSchema = z.object({
  seasonId: z.string().uuid().nullable().optional(),
  matchDate: z.string().date(),
  title: z.string().min(2),
  refereeName: z.string().max(120).nullable().optional(),
  teamAName: z.string().min(1).default('Time A'),
  teamBName: z.string().min(1).default('Time B'),
  scheduledStart: timeSchema.default('20:00'),
  scheduledEnd: timeSchema.default('21:00'),
  confirmationOpensHoursBefore: z.number().int().min(1).max(336).default(48),
  confirmationOpenAt: z.string().datetime().nullable().optional(),
  players: z.array(playerSchema).default([])
});
const createMatchSchema = createMatchBaseSchema.refine((body) => body.scheduledEnd > body.scheduledStart, { message: 'O horário final precisa ser maior que o início.' });
const lineupSchema = createMatchBaseSchema.omit({ seasonId: true }).partial({ matchDate: true, title: true, teamAName: true, teamBName: true, scheduledStart: true, scheduledEnd: true }).extend({ players: z.array(playerSchema).default([]) }).refine((body) => !body.scheduledStart || !body.scheduledEnd || body.scheduledEnd > body.scheduledStart, { message: 'O horário final precisa ser maior que o início.' });

const eventSchema = z.object({ userId: z.string().uuid(), relatedUserId: z.string().uuid().nullable().optional(), eventType: z.enum(['GOL', 'GOL_CONTRA', 'ASSISTENCIA', 'CARTAO_AMARELO', 'CARTAO_VERMELHO', 'CARTAO_AZUL']), minute: z.number().int().min(0).max(180), team: z.enum(['A', 'B']), occurredAt: z.string().datetime().nullable().optional() });
const scoreSchema = z.object({ teamAScore: z.number().int().min(0), teamBScore: z.number().int().min(0), events: z.array(eventSchema).default([]) });
const correctionSchema = scoreSchema.extend({ reason: z.string().min(5).max(500) });
const draftSchema = scoreSchema.extend({ clockSeconds: z.number().int().min(0).max(10800).default(0), clockRunning: z.boolean().default(false) });
const attendanceSchema = z.object({ responseStatus: z.enum(['JOGAR', 'PRESENTE_SEM_JOGAR', 'AUSENTE']), dinnerConfirmed: z.boolean().default(false), guestCount: z.number().int().min(0).max(20).default(0), notes: z.string().max(300).nullable().optional() });
const idParamSchema = z.object({ id: z.string().uuid() });
const manualScheduleBaseSchema = z.object({
  seasonId: z.string().uuid().nullable().optional(),
  matchDate: z.string().date(),
  title: z.string().min(2).default('Futebol de quarta'),
  refereeName: z.string().max(120).nullable().optional(),
  teamAName: z.string().min(1).default('Time A'),
  teamBName: z.string().min(1).default('Time B'),
  scheduledStart: timeSchema.default('20:00'),
  scheduledEnd: timeSchema.default('21:00'),
  confirmationOpensHoursBefore: z.number().int().min(1).max(336).default(48)
});
const manualScheduleSchema = manualScheduleBaseSchema.refine((body) => body.scheduledEnd > body.scheduledStart, { message: 'O horário final precisa ser maior que o início.' });
const recurringScheduleSchema = manualScheduleBaseSchema.omit({ matchDate: true }).extend({
  weekday: z.number().int().min(0).max(6).default(3),
  startDate: z.string().date(),
  endDate: z.string().date()
}).refine((body) => body.scheduledEnd > body.scheduledStart, { message: 'O horário final precisa ser maior que o início.' }).refine((body) => body.endDate >= body.startDate, { message: 'A data final precisa ser maior ou igual à inicial.' });
const schedulePatchSchema = manualScheduleBaseSchema.omit({ seasonId: true }).partial().refine((body) => !body.scheduledStart || !body.scheduledEnd || body.scheduledEnd > body.scheduledStart, { message: 'O horário final precisa ser maior que o início.' });

function buildConfirmationOpenAt(matchDate: string, scheduledStart: string, hoursBefore: number): string {
  const startsAt = new Date(`${matchDate}T${scheduledStart}:00-03:00`).getTime();
  return new Date(startsAt - hoursBefore * 60 * 60 * 1000).toISOString();
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function getMatchColumns(): Promise<Set<string>> {
  const result = await query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'matches'`
  );
  return new Set(result.rows.map((row) => row.column_name));
}

async function tableExists(tableName: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName]
  );
  return result.rows[0]?.exists === true;
}

async function ensureScheduleAvailable(): Promise<void> {
  const matchColumns = await getMatchColumns();
  if (!matchColumns.has('confirmation_open_at') || !matchColumns.has('confirmation_opens_hours_before') || !matchColumns.has('confirmation_opened_at') || !await tableExists('match_schedule_rules')) {
    throw httpError(409, 'Agenda de confirmações indisponível: execute migrations/12_agendamento_confirmacao_jogos.sql no PostgreSQL da Railway.');
  }
}

async function validatePlayersInput(players: z.infer<typeof playerSchema>[]): Promise<void> {
  const userIds = players.map((player) => player.userId);
  if (new Set(userIds).size !== userIds.length) throw httpError(400, 'A súmula não pode repetir o mesmo atleta.');
  if (!userIds.length) return;
  const activeUsers = await query<{ id: string }>('SELECT id FROM users WHERE id = ANY($1::UUID[]) AND active = TRUE', [userIds]);
  if (activeUsers.rowCount !== userIds.length) throw httpError(400, 'Todos os atletas da súmula precisam estar ativos.');
  for (const player of players) {
    if (player.team === 'PRESENTE_SEM_JOGAR' && player.roleInMatch !== 'PRESENTE_SEM_JOGAR') throw httpError(400, 'Atleta presente sem jogar precisa ter papel PRESENTE_SEM_JOGAR.');
    if (player.team !== 'PRESENTE_SEM_JOGAR' && player.roleInMatch === 'PRESENTE_SEM_JOGAR') throw httpError(400, 'Atleta escalado em time precisa ser GOLEIRO ou LINHA.');
  }
}

async function validateLineupReady(matchId: string): Promise<void> {
  const players = await query<{ team: string; role_in_match: string; present: boolean }>('SELECT team, role_in_match, present FROM match_players WHERE match_id = $1', [matchId]);
  const playable = players.rows.filter((player) => player.present && (player.team === 'A' || player.team === 'B'));
  for (const team of ['A', 'B']) {
    const teamPlayers = playable.filter((player) => player.team === team);
    const goalkeepers = teamPlayers.filter((player) => player.role_in_match === 'GOLEIRO').length;
    const linePlayers = teamPlayers.filter((player) => player.role_in_match === 'LINHA').length;
    if (goalkeepers !== 1) throw httpError(400, `O time ${team} precisa ter exatamente 1 goleiro antes de iniciar o jogo.`);
    if (linePlayers < 6) throw httpError(400, `O time ${team} precisa ter pelo menos 6 jogadores de linha antes de iniciar o jogo.`);
  }
}

async function validateLineupAgainstEvents(matchId: string, players: z.infer<typeof playerSchema>[]): Promise<void> {
  const events = await query<{ user_id: string; related_user_id: string | null; team: string }>('SELECT user_id, related_user_id, team FROM match_events WHERE match_id = $1', [matchId]);
  if (!events.rowCount) return;
  const playerMap = new Map(players.map((player) => [player.userId, player]));
  for (const event of events.rows) {
    const player = playerMap.get(event.user_id);
    if (!player || player.team === 'PRESENTE_SEM_JOGAR' || player.team !== event.team) throw httpError(409, 'Não é possível salvar escalação incompatível com eventos já lançados na súmula.');
    if (event.related_user_id && !playerMap.has(event.related_user_id)) throw httpError(409, 'Não é possível remover atleta relacionado a evento já lançado.');
  }
}

async function validateDraftSafety(matchId: string, body: z.infer<typeof draftSchema>): Promise<void> {
  const match = await query<{ status: string }>('SELECT status FROM matches WHERE id = $1', [matchId]);
  if (!match.rowCount) throw httpError(404, 'Súmula não encontrada.');
  if (match.rows[0].status === 'CONFIRMED') throw httpError(409, 'Súmula confirmada não recebe rascunho operacional. Use correção auditada.');
  if (match.rows[0].status === 'CANCELLED') throw httpError(409, 'Súmula cancelada não recebe rascunho operacional.');

  const players = await query<{ user_id: string; team: string; present: boolean }>('SELECT user_id, team, present FROM match_players WHERE match_id = $1', [matchId]);
  const playerMap = new Map(players.rows.map((player) => [player.user_id, player]));
  for (const event of body.events) {
    const player = playerMap.get(event.userId);
    if (!player || !player.present || player.team === 'PRESENTE_SEM_JOGAR') throw httpError(400, 'O rascunho contém evento de atleta que não está escalado para jogar.');
    if (player.team !== event.team) throw httpError(400, 'O time do evento no rascunho precisa ser igual ao time do atleta.');
    if (event.relatedUserId) {
      const relatedPlayer = playerMap.get(event.relatedUserId);
      if (!relatedPlayer || !relatedPlayer.present || relatedPlayer.team === 'PRESENTE_SEM_JOGAR') throw httpError(400, 'Atleta relacionado no rascunho precisa estar escalado para jogar.');
      if (event.relatedUserId === event.userId) throw httpError(400, 'Atleta relacionado no rascunho não pode ser o próprio autor do evento.');
      if (relatedPlayer.team !== event.team) throw httpError(400, 'Atleta relacionado no rascunho precisa estar no mesmo time do evento.');
    }
  }
}

async function validateScoreSheet(matchId: string, body: z.infer<typeof scoreSchema>, allowConfirmed = false): Promise<void> {
  const match = await query<{ status: string; started_at: string | null }>('SELECT status, started_at FROM matches WHERE id = $1', [matchId]);
  if (!match.rowCount) throw httpError(404, 'Súmula não encontrada.');
  if (match.rows[0].status === 'CONFIRMED' && !allowConfirmed) throw httpError(409, 'Súmula já confirmada não pode ser alterada sem correção auditada.');
  if (match.rows[0].status === 'CANCELLED') throw httpError(409, 'Súmula cancelada não pode ser alterada.');
  if (!allowConfirmed && !['RUNNING', 'SUBMITTED'].includes(match.rows[0].status)) throw httpError(409, 'A súmula só pode ser submetida depois do botão Jogo iniciado.');
  if (!allowConfirmed && !match.rows[0].started_at) throw httpError(409, 'A súmula precisa ter início oficial registrado antes da submissão.');
  await validateLineupReady(matchId);

  const players = await query<{ user_id: string; team: string; present: boolean }>('SELECT user_id, team, present FROM match_players WHERE match_id = $1', [matchId]);
  const playerMap = new Map(players.rows.map((player) => [player.user_id, player]));
  const playableTeams = new Set(players.rows.filter((player) => player.present && (player.team === 'A' || player.team === 'B')).map((player) => player.team));
  if (!playableTeams.has('A') || !playableTeams.has('B')) throw httpError(400, 'A súmula precisa ter atletas presentes nos times A e B.');

  for (const event of body.events) {
    const player = playerMap.get(event.userId);
    if (!player || !player.present || player.team === 'PRESENTE_SEM_JOGAR') throw httpError(400, 'Todos os eventos precisam pertencer a atletas escalados para jogar.');
    if (player.team !== event.team) throw httpError(400, 'O time do evento precisa ser igual ao time do atleta na súmula.');
    if (event.relatedUserId) {
      const relatedPlayer = playerMap.get(event.relatedUserId);
      if (!relatedPlayer || !relatedPlayer.present || relatedPlayer.team === 'PRESENTE_SEM_JOGAR') throw httpError(400, 'Atleta relacionado no evento precisa estar escalado para jogar.');
      if (event.relatedUserId === event.userId) throw httpError(400, 'Atleta relacionado no evento não pode ser o próprio autor.');
      if (relatedPlayer.team !== event.team) throw httpError(400, 'Atleta relacionado no evento precisa estar no mesmo time do evento.');
    }
  }

  const goalsA = body.events.filter((event) => (event.eventType === 'GOL' && event.team === 'A') || (event.eventType === 'GOL_CONTRA' && event.team === 'B')).length;
  const goalsB = body.events.filter((event) => (event.eventType === 'GOL' && event.team === 'B') || (event.eventType === 'GOL_CONTRA' && event.team === 'A')).length;
  if (goalsA !== body.teamAScore || goalsB !== body.teamBScore) throw httpError(400, 'O placar precisa bater com a quantidade de gols lançados por time.');
}

async function createAutomaticSuspensions(matchId: string): Promise<void> {
  const matchResult = await query<{ season_id: string | null }>('SELECT season_id FROM matches WHERE id = $1', [matchId]);
  const seasonId = matchResult.rows[0]?.season_id ?? null;

  await query(
    `INSERT INTO athlete_suspensions (user_id, season_id, trigger_match_id, reason)
     SELECT DISTINCT user_id, $2, $1, 'CARTAO_VERMELHO'
     FROM match_events
     WHERE match_id = $1 AND event_type = 'CARTAO_VERMELHO'
     ON CONFLICT (user_id, trigger_match_id, reason) DO NOTHING`,
    [matchId, seasonId]
  );

  const yellowCandidates = await query<{ user_id: string }>(
    `SELECT DISTINCT me.user_id
     FROM match_events me
     WHERE me.match_id = $1 AND me.event_type = 'CARTAO_AMARELO'`,
    [matchId]
  );

  for (const candidate of yellowCandidates.rows) {
    const total = await query<{ total: string }>(
      `SELECT count(*) AS total
       FROM (
        SELECT me.id
        FROM match_events me
        JOIN matches m ON m.id = me.match_id
        WHERE me.user_id = $1
          AND me.event_type = 'CARTAO_AMARELO'
          AND m.status = 'CONFIRMED'
          AND ($2::UUID IS NULL OR m.season_id = $2)
          AND NOT EXISTS (
            SELECT 1
            FROM athlete_suspensions s
            WHERE s.user_id = me.user_id
              AND s.reason = 'ACUMULO_3_CARTOES'
              AND s.created_at > me.created_at
          )
       ) cards`,
      [candidate.user_id, seasonId]
    );

    if (Number(total.rows[0].total) >= 3) {
      await query(
        `INSERT INTO athlete_suspensions (user_id, season_id, trigger_match_id, reason)
         VALUES ($1, $2, $3, 'ACUMULO_3_CARTOES')
         ON CONFLICT (user_id, trigger_match_id, reason) DO NOTHING`,
        [candidate.user_id, seasonId, matchId]
      );
    }
  }
}

matchesRouter.use(requireAuth);

matchesRouter.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const matchColumns = await getMatchColumns();
  const hasAttendance = await tableExists('match_attendance_responses');
  const scheduleSelect = [
    matchColumns.has('scheduled_start') ? 'm.scheduled_start AS "scheduledStart"' : 'TIME \'20:00\' AS "scheduledStart"',
    matchColumns.has('scheduled_end') ? 'm.scheduled_end AS "scheduledEnd"' : 'TIME \'21:00\' AS "scheduledEnd"',
    matchColumns.has('confirmation_open_at') ? 'm.confirmation_open_at AS "confirmationOpenAt"' : 'NULL::TIMESTAMPTZ AS "confirmationOpenAt"',
    matchColumns.has('confirmation_opens_hours_before') ? 'm.confirmation_opens_hours_before AS "confirmationOpensHoursBefore"' : '48::INTEGER AS "confirmationOpensHoursBefore"',
    matchColumns.has('confirmation_opened_at') ? 'm.confirmation_opened_at AS "confirmationOpenedAt"' : 'NULL::TIMESTAMPTZ AS "confirmationOpenedAt"',
    matchColumns.has('schedule_source') ? 'm.schedule_source AS "scheduleSource"' : '\'MANUAL\' AS "scheduleSource"',
    matchColumns.has('confirmation_open_at') ? '(m.confirmation_opened_at IS NOT NULL OR m.confirmation_open_at <= now()) AS "confirmationOpen"' : '(m.status = \'DRAFT\') AS "confirmationOpen"'
  ];
  const attendanceJoin = hasAttendance
    ? `LEFT JOIN LATERAL (
         SELECT
          count(*) FILTER (WHERE response_status = 'JOGAR')::INTEGER AS playing,
          count(*) FILTER (WHERE response_status = 'PRESENTE_SEM_JOGAR')::INTEGER AS present_only,
          count(*) FILTER (WHERE response_status = 'AUSENTE')::INTEGER AS absent,
          max(response_status) FILTER (WHERE user_id = $2::UUID) AS my_status
         FROM match_attendance_responses
         WHERE match_id = m.id
       ) att ON TRUE`
    : '';
  const attendanceSelect = hasAttendance
    ? 'COALESCE(att.playing, 0) AS "attendancePlaying", COALESCE(att.present_only, 0) AS "attendancePresentOnly", COALESCE(att.absent, 0) AS "attendanceAbsent", att.my_status AS "myAttendanceStatus"'
    : '0::INTEGER AS "attendancePlaying", 0::INTEGER AS "attendancePresentOnly", 0::INTEGER AS "attendanceAbsent", NULL::TEXT AS "myAttendanceStatus"';
  const result = await query(
    `SELECT m.id, m.season_id AS "seasonId", m.match_date AS "matchDate", m.title, m.referee_name AS "refereeName", m.status,
      m.team_a_name AS "teamAName", m.team_b_name AS "teamBName", m.team_a_score AS "teamAScore", m.team_b_score AS "teamBScore", m.created_at AS "createdAt",
      ${scheduleSelect.join(', ')}, ${attendanceSelect}
     FROM matches m
     ${attendanceJoin}
    WHERE ($1::UUID IS NULL OR m.season_id = $1)
    ORDER BY m.match_date DESC, m.created_at DESC
     LIMIT 80`,
    hasAttendance ? [req.query.seasonId || null, req.user?.id] : [req.query.seasonId || null]
  );
  res.json(result.rows);
}));

matchesRouter.post('/', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req: AuthRequest, res) => {
  const body = validate(createMatchSchema, req.body);
  const players = (body.players ?? []).map((player) => ({ ...player, startsOnBench: player.startsOnBench ?? false, present: player.present ?? true }));
  await validatePlayersInput(players);
  const seasonResult = body.seasonId ? await query('SELECT id FROM seasons WHERE id = $1 AND status = \'OPEN\'', [body.seasonId]) : { rowCount: 0 };
  const seasonId = seasonResult.rowCount ? body.seasonId : null;
  const matchColumns = await getMatchColumns();
  const scheduledStart = body.scheduledStart ?? '20:00';
  const scheduledEnd = body.scheduledEnd ?? '21:00';
  const confirmationOpensHoursBefore = body.confirmationOpensHoursBefore ?? 48;
  const confirmationOpenAt = body.confirmationOpenAt ?? buildConfirmationOpenAt(body.matchDate, scheduledStart, confirmationOpensHoursBefore);

  const match = await query<{ id: string }>(
    matchColumns.has('confirmation_open_at') && matchColumns.has('confirmation_opens_hours_before')
      ? `INSERT INTO matches (season_id, match_date, title, referee_name, team_a_name, team_b_name, scheduled_start, scheduled_end, confirmation_open_at, confirmation_opens_hours_before, schedule_source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::TIME, $8::TIME, $9::TIMESTAMPTZ, $10, 'MANUAL', $11)
     RETURNING id`
      : `INSERT INTO matches (season_id, match_date, title, referee_name, team_a_name, team_b_name, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    matchColumns.has('confirmation_open_at') && matchColumns.has('confirmation_opens_hours_before')
          ? [seasonId, body.matchDate, body.title, body.refereeName ?? null, body.teamAName, body.teamBName, scheduledStart, scheduledEnd, confirmationOpenAt, confirmationOpensHoursBefore, req.user?.id]
      : [seasonId, body.matchDate, body.title, body.refereeName ?? null, body.teamAName, body.teamBName, req.user?.id]
  );

  for (const player of players) {
    await query(
      `INSERT INTO match_players (match_id, user_id, team, role_in_match, draw_order, rotation_order, starts_on_bench, present)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [match.rows[0].id, player.userId, player.team, player.roleInMatch, player.drawOrder ?? null, player.rotationOrder ?? null, player.startsOnBench, player.present]
    );
  }

  res.status(201).json({ id: match.rows[0].id });
}));

matchesRouter.patch('/:id/lineup', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req, res) => {
  const body = validate(lineupSchema, req.body);
  const players = (body.players ?? []).map((player) => ({ ...player, startsOnBench: player.startsOnBench ?? false, present: player.present ?? true }));
  await validatePlayersInput(players);
  await validateLineupAgainstEvents(req.params.id, players);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const match = await client.query<{ status: string }>('SELECT status FROM matches WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!match.rowCount) throw httpError(404, 'Súmula não encontrada.');
    if (match.rows[0].status === 'CONFIRMED') throw httpError(409, 'Súmula confirmada não permite edição direta da escalação. Use correção auditada.');
    if (match.rows[0].status === 'CANCELLED') throw httpError(409, 'Súmula cancelada não permite edição da escalação.');

    await client.query(
      `UPDATE matches
       SET match_date = COALESCE($2, match_date),
           title = COALESCE($3, title),
           referee_name = COALESCE($4, referee_name),
           team_a_name = COALESCE($5, team_a_name),
           team_b_name = COALESCE($6, team_b_name),
           updated_at = now()
       WHERE id = $1`,
      [req.params.id, body.matchDate ?? null, body.title ?? null, body.refereeName ?? null, body.teamAName ?? null, body.teamBName ?? null]
    );
    await client.query('DELETE FROM match_players WHERE match_id = $1', [req.params.id]);
    for (const player of players) {
      await client.query(
        `INSERT INTO match_players (match_id, user_id, team, role_in_match, draw_order, rotation_order, starts_on_bench, present)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [req.params.id, player.userId, player.team, player.roleInMatch, player.drawOrder ?? null, player.rotationOrder ?? null, player.startsOnBench, player.present]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json({ ok: true });
}));

matchesRouter.post('/schedule/manual', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req: AuthRequest, res) => {
  await ensureScheduleAvailable();
  const body = validate(manualScheduleSchema, req.body);
  const seasonResult = body.seasonId ? await query('SELECT id FROM seasons WHERE id = $1 AND status = \'OPEN\'', [body.seasonId]) : { rowCount: 0 };
  const seasonId = seasonResult.rowCount ? body.seasonId : null;
  const scheduledStart = body.scheduledStart ?? '20:00';
  const scheduledEnd = body.scheduledEnd ?? '21:00';
  const confirmationOpensHoursBefore = body.confirmationOpensHoursBefore ?? 48;
  const confirmationOpenAt = buildConfirmationOpenAt(body.matchDate, scheduledStart, confirmationOpensHoursBefore);
  const result = await query<{ id: string }>(
    `INSERT INTO matches (season_id, match_date, title, referee_name, team_a_name, team_b_name, scheduled_start, scheduled_end, confirmation_open_at, confirmation_opens_hours_before, schedule_source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::TIME, $8::TIME, $9::TIMESTAMPTZ, $10, 'MANUAL', $11)
     RETURNING id`,
    [seasonId, body.matchDate, body.title, body.refereeName ?? null, body.teamAName, body.teamBName, scheduledStart, scheduledEnd, confirmationOpenAt, confirmationOpensHoursBefore, req.user?.id]
  );
  res.status(201).json({ id: result.rows[0].id, confirmationOpenAt });
}));

matchesRouter.post('/schedule/recurring', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req: AuthRequest, res) => {
  await ensureScheduleAvailable();
  const body = validate(recurringScheduleSchema, req.body);
  const scheduledStart = body.scheduledStart ?? '20:00';
  const scheduledEnd = body.scheduledEnd ?? '21:00';
  const confirmationOpensHoursBefore = body.confirmationOpensHoursBefore ?? 48;
  const start = new Date(`${body.startDate}T12:00:00-03:00`);
  const end = new Date(`${body.endDate}T12:00:00-03:00`);
  if ((end.getTime() - start.getTime()) / 86400000 > 370) throw httpError(400, 'Gere no máximo 12 meses de jogos por vez.');
  const seasonResult = body.seasonId ? await query('SELECT id FROM seasons WHERE id = $1 AND status = \'OPEN\'', [body.seasonId]) : { rowCount: 0 };
  const seasonId = seasonResult.rowCount ? body.seasonId : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rule = await client.query<{ id: string }>(
      `INSERT INTO match_schedule_rules (season_id, title, weekday, scheduled_start, scheduled_end, confirmation_opens_hours_before, start_date, end_date, referee_name, team_a_name, team_b_name, created_by)
       VALUES ($1, $2, $3, $4::TIME, $5::TIME, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [seasonId, body.title, body.weekday, scheduledStart, scheduledEnd, confirmationOpensHoursBefore, body.startDate, body.endDate, body.refereeName ?? null, body.teamAName, body.teamBName, req.user?.id]
    );
    let generated = 0;
    let skipped = 0;
    for (let day = start; day <= end; day = addDays(day, 1)) {
      if (day.getUTCDay() !== body.weekday) continue;
      const matchDate = formatDate(day);
      const duplicate = await client.query(
        `SELECT id FROM matches
         WHERE ($1::UUID IS NULL OR season_id = $1)
           AND match_date = $2
           AND scheduled_start = $3::TIME
           AND status <> 'CANCELLED'
         LIMIT 1`,
        [seasonId, matchDate, scheduledStart]
      );
      if (duplicate.rowCount) {
        skipped += 1;
        continue;
      }
      await client.query(
        `INSERT INTO matches (season_id, match_date, title, referee_name, team_a_name, team_b_name, scheduled_start, scheduled_end, confirmation_open_at, confirmation_opens_hours_before, schedule_source, schedule_rule_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::TIME, $8::TIME, $9::TIMESTAMPTZ, $10, 'RECURRING', $11, $12)`,
        [seasonId, matchDate, body.title, body.refereeName ?? null, body.teamAName, body.teamBName, scheduledStart, scheduledEnd, buildConfirmationOpenAt(matchDate, scheduledStart, confirmationOpensHoursBefore), confirmationOpensHoursBefore, rule.rows[0].id, req.user?.id]
      );
      generated += 1;
    }
    await client.query('COMMIT');
    res.status(201).json({ ruleId: rule.rows[0].id, generated, skipped });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

matchesRouter.patch('/:id/schedule', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req, res) => {
  await ensureScheduleAvailable();
  const params = validate(idParamSchema, req.params);
  const body = validate(schedulePatchSchema, req.body);
  const current = await query<{ matchDate: string; scheduledStart: string; scheduledEnd: string; confirmationOpensHoursBefore: number; status: string }>('SELECT match_date::TEXT AS "matchDate", scheduled_start::TEXT AS "scheduledStart", scheduled_end::TEXT AS "scheduledEnd", confirmation_opens_hours_before AS "confirmationOpensHoursBefore", status FROM matches WHERE id = $1', [params.id]);
  if (!current.rowCount) throw httpError(404, 'Jogo agendado não encontrado.');
  if (current.rows[0].status !== 'DRAFT') throw httpError(409, 'Somente jogos em rascunho podem ter agenda editada.');
  const matchDate = body.matchDate ?? current.rows[0].matchDate;
  const scheduledStart = body.scheduledStart ?? current.rows[0].scheduledStart.slice(0, 5);
  const scheduledEnd = body.scheduledEnd ?? current.rows[0].scheduledEnd.slice(0, 5);
  if (scheduledEnd <= scheduledStart) throw httpError(400, 'O horário final precisa ser maior que o início.');
  const confirmationOpensHoursBefore = body.confirmationOpensHoursBefore ?? current.rows[0].confirmationOpensHoursBefore ?? 48;
  const confirmationOpenAt = buildConfirmationOpenAt(matchDate, scheduledStart, confirmationOpensHoursBefore);
  const result = await query(
    `UPDATE matches
     SET match_date = $2,
         title = COALESCE($3, title),
         referee_name = COALESCE($4, referee_name),
         team_a_name = COALESCE($5, team_a_name),
         team_b_name = COALESCE($6, team_b_name),
         scheduled_start = $7::TIME,
         scheduled_end = $8::TIME,
         confirmation_open_at = $9::TIMESTAMPTZ,
         confirmation_opens_hours_before = $10,
         confirmation_opened_at = CASE WHEN confirmation_opened_at IS NOT NULL AND $9::TIMESTAMPTZ > now() THEN NULL ELSE confirmation_opened_at END,
         updated_at = now()
     WHERE id = $1 AND status = 'DRAFT'
     RETURNING id, confirmation_open_at AS "confirmationOpenAt", confirmation_opens_hours_before AS "confirmationOpensHoursBefore"`,
    [params.id, matchDate, body.title ?? null, body.refereeName ?? null, body.teamAName ?? null, body.teamBName ?? null, scheduledStart, scheduledEnd, confirmationOpenAt, confirmationOpensHoursBefore]
  );
  if (!result.rowCount) throw httpError(409, 'Não foi possível editar o jogo agendado.');
  res.json(result.rows[0]);
}));

matchesRouter.delete('/:id/schedule', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req, res) => {
  await ensureScheduleAvailable();
  const params = validate(idParamSchema, req.params);
  const result = await query('DELETE FROM matches WHERE id = $1 AND status = \'DRAFT\' RETURNING id', [params.id]);
  if (!result.rowCount) throw httpError(409, 'Somente jogos em rascunho podem ser removidos da agenda.');
  res.json({ ok: true });
}));

matchesRouter.post('/:id/open-confirmation', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req: AuthRequest, res) => {
  await ensureScheduleAvailable();
  const params = validate(idParamSchema, req.params);
  const result = await query(
    `UPDATE matches
     SET confirmation_opened_at = now(),
         confirmation_opened_by = $2,
         confirmation_open_at = LEAST(COALESCE(confirmation_open_at, now()), now()),
         updated_at = now()
     WHERE id = $1 AND status = 'DRAFT'
     RETURNING id, confirmation_open_at AS "confirmationOpenAt", confirmation_opened_at AS "confirmationOpenedAt"`,
    [params.id, req.user?.id]
  );
  if (!result.rowCount) throw httpError(409, 'Somente jogos em rascunho podem abrir confirmação.');
  res.json(result.rows[0]);
}));

matchesRouter.get('/:id', asyncHandler(async (req, res) => {
  const params = validate(idParamSchema, req.params);
  const matchColumns = await getMatchColumns();
  const draftSelect = [
    matchColumns.has('draft_team_a_score') ? 'draft_team_a_score AS "draftTeamAScore"' : 'team_a_score AS "draftTeamAScore"',
    matchColumns.has('draft_team_b_score') ? 'draft_team_b_score AS "draftTeamBScore"' : 'team_b_score AS "draftTeamBScore"',
    matchColumns.has('draft_events') ? 'draft_events AS "draftEvents"' : '\'[]\'::JSONB AS "draftEvents"',
    matchColumns.has('draft_clock_seconds') ? 'draft_clock_seconds AS "draftClockSeconds"' : '0::INTEGER AS "draftClockSeconds"',
    matchColumns.has('draft_clock_running') ? 'draft_clock_running AS "draftClockRunning"' : 'FALSE AS "draftClockRunning"',
    matchColumns.has('draft_saved_at') ? 'draft_saved_at AS "draftSavedAt"' : 'NULL::TIMESTAMPTZ AS "draftSavedAt"'
  ];
  const scheduleSelect = [
    matchColumns.has('scheduled_start') ? 'scheduled_start AS "scheduledStart"' : 'TIME \'20:00\' AS "scheduledStart"',
    matchColumns.has('scheduled_end') ? 'scheduled_end AS "scheduledEnd"' : 'TIME \'21:00\' AS "scheduledEnd"',
    matchColumns.has('confirmation_open_at') ? 'confirmation_open_at AS "confirmationOpenAt"' : 'NULL::TIMESTAMPTZ AS "confirmationOpenAt"',
    matchColumns.has('confirmation_opens_hours_before') ? 'confirmation_opens_hours_before AS "confirmationOpensHoursBefore"' : '48::INTEGER AS "confirmationOpensHoursBefore"',
    matchColumns.has('confirmation_opened_at') ? 'confirmation_opened_at AS "confirmationOpenedAt"' : 'NULL::TIMESTAMPTZ AS "confirmationOpenedAt"',
    matchColumns.has('schedule_source') ? 'schedule_source AS "scheduleSource"' : '\'MANUAL\' AS "scheduleSource"',
    matchColumns.has('confirmation_open_at') ? '(confirmation_opened_at IS NOT NULL OR confirmation_open_at <= now()) AS "confirmationOpen"' : '(status = \'DRAFT\') AS "confirmationOpen"'
  ];
  const match = await query(
    `SELECT id, season_id AS "seasonId", match_date AS "matchDate", title, referee_name AS "refereeName", status,
      ${scheduleSelect.join(', ')}, started_at AS "startedAt", ended_at AS "endedAt",
      team_a_name AS "teamAName", team_b_name AS "teamBName", team_a_score AS "teamAScore", team_b_score AS "teamBScore",
      ${draftSelect.join(', ')},
      GREATEST(
        1,
        FLOOR(
          EXTRACT(
            EPOCH FROM (
              ((match_date + ${matchColumns.has('scheduled_end') ? 'scheduled_end' : "TIME '21:00'"}) AT TIME ZONE 'America/Sao_Paulo')
              - COALESCE(started_at, ((match_date + ${matchColumns.has('scheduled_start') ? 'scheduled_start' : "TIME '20:00'"}) AT TIME ZONE 'America/Sao_Paulo'))
            )
          ) / 60
        )
      )::INTEGER AS "availableMinutes"
     FROM matches WHERE id = $1`,
    [params.id]
  );
  if (!match.rowCount) throw httpError(404, 'Súmula não encontrada.');
  const players = await query(
    `SELECT mp.id, mp.user_id AS "userId", u.name, u.avatar_data_url AS "avatarDataUrl", mp.team, mp.role_in_match AS "roleInMatch",
      mp.draw_order AS "drawOrder", mp.rotation_order AS "rotationOrder", mp.starts_on_bench AS "startsOnBench", mp.present
     FROM match_players mp JOIN users u ON u.id = mp.user_id
     WHERE mp.match_id = $1 ORDER BY mp.team, mp.role_in_match, mp.rotation_order NULLS LAST, u.name`,
    [params.id]
  );
  const events = await query('SELECT id, user_id AS "userId", related_user_id AS "relatedUserId", event_type AS "eventType", minute, team, created_at AS "createdAt" FROM match_events WHERE match_id = $1 ORDER BY minute ASC, created_at ASC', [params.id]);
  const corrections = await tableExists('match_corrections')
    ? await query(
      `SELECT mc.id, mc.reason, mc.previous_team_a_score AS "previousTeamAScore", mc.previous_team_b_score AS "previousTeamBScore",
        mc.new_team_a_score AS "newTeamAScore", mc.new_team_b_score AS "newTeamBScore", mc.previous_events AS "previousEvents",
        mc.new_events AS "newEvents", mc.created_at AS "createdAt", u.name AS "correctedByName"
       FROM match_corrections mc
       JOIN users u ON u.id = mc.corrected_by
       WHERE mc.match_id = $1
       ORDER BY mc.created_at DESC`,
      [params.id]
    )
    : { rows: [] };
  const attendance = await tableExists('match_attendance_responses')
    ? await query(
      `SELECT mar.user_id AS "userId", u.name, u.position, u.avatar_data_url AS "avatarDataUrl",
        mar.response_status AS "responseStatus", mar.dinner_confirmed AS "dinnerConfirmed",
        mar.guest_count AS "guestCount", mar.notes, mar.updated_at AS "updatedAt"
       FROM match_attendance_responses mar
       JOIN users u ON u.id = mar.user_id
       WHERE mar.match_id = $1
       ORDER BY CASE mar.response_status WHEN 'JOGAR' THEN 1 WHEN 'PRESENTE_SEM_JOGAR' THEN 2 ELSE 3 END, u.name ASC`,
      [params.id]
    )
    : { rows: [] };
  const lineA = players.rows.filter((player: any) => player.team === 'A' && player.roleInMatch === 'LINHA' && player.rotationOrder);
  const lineB = players.rows.filter((player: any) => player.team === 'B' && player.roleInMatch === 'LINHA' && player.rotationOrder);

  res.json({
    ...match.rows[0],
    players: players.rows,
    events: events.rows,
    corrections: corrections.rows,
    attendance: attendance.rows,
    rotation: {
      A: buildTeamRotationPlan(lineA.map((player: any) => ({ id: player.userId, name: player.name, rotationOrder: player.rotationOrder, startsOnBench: player.startsOnBench })), match.rows[0].availableMinutes),
      B: buildTeamRotationPlan(lineB.map((player: any) => ({ id: player.userId, name: player.name, rotationOrder: player.rotationOrder, startsOnBench: player.startsOnBench })), match.rows[0].availableMinutes)
    }
  });
}));

matchesRouter.put('/:id/attendance/me', asyncHandler(async (req: AuthRequest, res) => {
  const params = validate(idParamSchema, req.params);
  const body = validate(attendanceSchema, req.body);
  if (!await tableExists('match_attendance_responses')) throw httpError(409, 'Confirmação de presença indisponível: execute migrations/11_confirmacao_presenca_jantar.sql no PostgreSQL da Railway.');

  const matchColumns = await getMatchColumns();
  const match = await query<{ status: string; confirmationOpen: boolean }>(
    matchColumns.has('confirmation_open_at')
      ? 'SELECT status, (confirmation_opened_at IS NOT NULL OR confirmation_open_at <= now()) AS "confirmationOpen" FROM matches WHERE id = $1'
      : 'SELECT status, TRUE AS "confirmationOpen" FROM matches WHERE id = $1',
    [params.id]
  );
  if (!match.rowCount) throw httpError(404, 'Partida não encontrada.');
  if (match.rows[0].status !== 'DRAFT') throw httpError(409, 'A confirmação de presença só fica aberta enquanto a súmula está em rascunho.');
  if (!match.rows[0].confirmationOpen) throw httpError(409, 'A confirmação desta rodada ainda não foi aberta pela agenda ou coordenação.');

  const result = await query(
    `INSERT INTO match_attendance_responses (match_id, user_id, response_status, dinner_confirmed, guest_count, notes, responded_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now(), now())
     ON CONFLICT (match_id, user_id) DO UPDATE SET
      response_status = EXCLUDED.response_status,
      dinner_confirmed = EXCLUDED.dinner_confirmed,
      guest_count = EXCLUDED.guest_count,
      notes = EXCLUDED.notes,
      updated_at = now()
     RETURNING user_id AS "userId", response_status AS "responseStatus", dinner_confirmed AS "dinnerConfirmed", guest_count AS "guestCount", notes, updated_at AS "updatedAt"`,
    [params.id, req.user?.id, body.responseStatus, body.dinnerConfirmed, body.guestCount, body.notes?.trim() || null]
  );
  res.json(result.rows[0]);
}));

matchesRouter.post('/:id/start', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req, res) => {
  await validateLineupReady(req.params.id);
  const result = await query("UPDATE matches SET status = 'RUNNING', started_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1 AND status = 'DRAFT' AND clock_timestamp() < ((match_date + scheduled_end) AT TIME ZONE 'America/Sao_Paulo') RETURNING id, status, started_at AS \"startedAt\"", [req.params.id]);
  if (!result.rowCount) throw httpError(409, 'Somente súmulas em rascunho e dentro do horário da quadra podem ser iniciadas.');
  res.json(result.rows[0]);
}));

matchesRouter.patch('/:id/draft', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req: AuthRequest, res) => {
  const parsedBody = validate(draftSchema, req.body);
  const body = { ...parsedBody, events: parsedBody.events ?? [], clockSeconds: parsedBody.clockSeconds ?? 0, clockRunning: parsedBody.clockRunning ?? false };
  await validateDraftSafety(req.params.id, body);
  const result = await query(
    `UPDATE matches
     SET draft_team_a_score = $2,
         draft_team_b_score = $3,
         draft_events = $4::JSONB,
         draft_clock_seconds = $5,
         draft_clock_running = $6,
         draft_saved_by = $7,
         draft_saved_at = now(),
         updated_at = now()
     WHERE id = $1 AND status IN ('DRAFT', 'RUNNING', 'SUBMITTED')
     RETURNING id, draft_saved_at AS "draftSavedAt"`,
    [req.params.id, body.teamAScore, body.teamBScore, JSON.stringify(body.events), body.clockSeconds, body.clockRunning, req.user?.id]
  );
  if (!result.rowCount) throw httpError(409, 'Somente súmulas em rascunho, em andamento ou submetidas recebem autosave.');
  res.json(result.rows[0]);
}));

matchesRouter.post('/:id/cancel', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req, res) => {
  const result = await query(
    `UPDATE matches SET status = 'CANCELLED', updated_at = now()
     WHERE id = $1 AND status IN ('DRAFT', 'RUNNING', 'SUBMITTED')
     RETURNING id, status`,
    [req.params.id]
  );
  if (!result.rowCount) throw httpError(409, 'Somente súmulas não confirmadas podem ser canceladas. Súmula confirmada exige correção auditada.');
  res.json(result.rows[0]);
}));

matchesRouter.post('/:id/submit', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req, res) => {
  const parsedBody = validate(scoreSchema, req.body);
  const body = { ...parsedBody, events: parsedBody.events ?? [] };
  await validateScoreSheet(req.params.id, body);
  await query('DELETE FROM match_events WHERE match_id = $1', [req.params.id]);
  for (const event of body.events ?? []) {
    await query('INSERT INTO match_events (match_id, user_id, related_user_id, event_type, minute, team, created_at) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::TIMESTAMPTZ, now()))', [req.params.id, event.userId, event.relatedUserId ?? null, event.eventType, event.minute, event.team ?? null, event.occurredAt ?? null]);
  }
  const result = await query(
    `UPDATE matches SET status = 'SUBMITTED', team_a_score = $2, team_b_score = $3,
       draft_team_a_score = $2, draft_team_b_score = $3, draft_events = $4::JSONB, draft_saved_at = now(),
       ended_at = COALESCE(ended_at, now()), updated_at = now()
     WHERE id = $1 AND status IN ('RUNNING', 'SUBMITTED') AND started_at IS NOT NULL
     RETURNING id, status, team_a_score AS "teamAScore", team_b_score AS "teamBScore"`,
    [req.params.id, body.teamAScore, body.teamBScore, JSON.stringify(body.events)]
  );
  if (!result.rowCount) throw httpError(409, 'Somente súmulas iniciadas oficialmente podem ser submetidas.');
  res.json(result.rows[0]);
}));

matchesRouter.post('/:id/confirm', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req: AuthRequest, res) => {
  await validateLineupReady(req.params.id);
  const result = await query(
    `UPDATE matches SET status = 'CONFIRMED', confirmed_by = $2, updated_at = now()
     WHERE id = $1 AND status = 'SUBMITTED' AND started_at IS NOT NULL
     RETURNING id, status`,
    [req.params.id, req.user?.id]
  );
  if (!result.rowCount) throw httpError(409, 'Submeta e revise a súmula antes de confirmar a pontuação.');
  await createAutomaticSuspensions(req.params.id);
  res.json(result.rows[0]);
}));

matchesRouter.post('/:id/correct', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req: AuthRequest, res) => {
  const parsedBody = validate(correctionSchema, req.body);
  const body = { ...parsedBody, events: parsedBody.events ?? [] };
  await validateScoreSheet(req.params.id, body, true);
  if (!await tableExists('match_corrections')) throw httpError(409, 'Correção auditada indisponível: execute migrations/10_correcoes_auditadas_sumula.sql no PostgreSQL da Railway.');

  const match = await query<{ team_a_score: number; team_b_score: number; status: string }>('SELECT team_a_score, team_b_score, status FROM matches WHERE id = $1', [req.params.id]);
  if (match.rows[0].status !== 'CONFIRMED') throw httpError(409, 'Correção auditada é exclusiva para súmulas já confirmadas.');

  const previousEvents = await query('SELECT user_id, related_user_id, event_type, minute, team, created_at AS "createdAt" FROM match_events WHERE match_id = $1 ORDER BY minute ASC, created_at ASC', [req.params.id]);
  await query(
    `INSERT INTO match_corrections (match_id, corrected_by, reason, previous_team_a_score, previous_team_b_score, new_team_a_score, new_team_b_score, previous_events, new_events)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::JSONB, $9::JSONB)`,
    [req.params.id, req.user?.id, body.reason.trim(), match.rows[0].team_a_score, match.rows[0].team_b_score, body.teamAScore, body.teamBScore, JSON.stringify(previousEvents.rows), JSON.stringify(body.events)]
  );

  await query('DELETE FROM match_events WHERE match_id = $1', [req.params.id]);
  for (const event of body.events) {
    await query('INSERT INTO match_events (match_id, user_id, related_user_id, event_type, minute, team, created_at) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::TIMESTAMPTZ, now()))', [req.params.id, event.userId, event.relatedUserId ?? null, event.eventType, event.minute, event.team, event.occurredAt ?? null]);
  }
  await query('DELETE FROM athlete_suspensions WHERE trigger_match_id = $1', [req.params.id]);
  await query('UPDATE matches SET team_a_score = $2, team_b_score = $3, updated_at = now() WHERE id = $1', [req.params.id, body.teamAScore, body.teamBScore]);
  await createAutomaticSuspensions(req.params.id);
  res.json({ ok: true });
}));
