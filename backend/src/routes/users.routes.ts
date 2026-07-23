import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { query } from '../db/pool';
import { hashPassword, requireAuth, requireRoles } from '../security/auth';
import { AuthRequest } from '../types';
import { asyncHandler, httpError, validate } from '../utils/http';
import { sendAccountActivationEmail } from '../services/mail';

export const usersRouter = Router();

const athletePositionSchema = z.enum(['GO', 'ZG', 'LD', 'LE', 'MD', 'MC', 'MA', 'AT']);

const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8).optional(),
  role: z.enum(['ADMIN', 'COORDENADOR', 'ATLETA']),
  position: athletePositionSchema.default('MC')
});

const updateUserSchema = userSchema.partial().extend({ active: z.boolean().optional(), avatarDataUrl: z.string().max(900000).nullable().optional() });
const adminPasswordSchema = z.object({ password: z.string().min(8) });
const avatarSchema = z.object({
  avatarDataUrl: z.string().max(900000).regex(/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/, 'Envie uma imagem PNG, JPG ou WEBP válida.').nullable()
});

async function ensureNotRemovingLastAdmin(userId: string, nextRole?: string, nextActive?: boolean): Promise<void> {
  const current = await query<{ role: string; active: boolean }>('SELECT role, active FROM users WHERE id = $1', [userId]);
  if (!current.rowCount) throw httpError(404, 'Usuário não encontrado.');
  const currentUser = current.rows[0];
  if (currentUser.role !== 'ADMIN' || !currentUser.active) return;
  const finalRole = nextRole ?? currentUser.role;
  const finalActive = nextActive ?? currentUser.active;
  if (finalRole === 'ADMIN' && finalActive) return;
  const admins = await query<{ total: string }>("SELECT count(*) AS total FROM users WHERE role = 'ADMIN' AND active = TRUE AND id <> $1", [userId]);
  if (Number(admins.rows[0].total) === 0) throw httpError(409, 'Não é possível remover/inativar o último ADMIN ativo do sistema.');
}

async function createActivationToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await query('UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
  await query('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'7 days\')', [userId, tokenHash]);
  return token;
}

usersRouter.use(requireAuth);

usersRouter.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const isCoordinator = req.user?.role === 'ADMIN' || req.user?.role === 'COORDENADOR';
  const result = await query(
    `SELECT id, name,
      CASE WHEN $1::BOOLEAN THEN email ELSE '' END AS email,
      CASE WHEN $1::BOOLEAN THEN role ELSE 'ATLETA' END AS role,
      position,
      avatar_data_url AS "avatarDataUrl",
      CASE WHEN $1::BOOLEAN THEN active ELSE TRUE END AS active,
      created_at AS "createdAt"
     FROM users
     WHERE $1::BOOLEAN = TRUE OR active = TRUE
     ORDER BY active DESC, name ASC`,
    [isCoordinator]
  );
  res.json(result.rows);
}));

usersRouter.patch('/me/avatar', asyncHandler(async (req: AuthRequest, res) => {
  const body = validate(avatarSchema, req.body);
  const result = await query(
    `UPDATE users SET avatar_data_url = $2, updated_at = now()
     WHERE id = $1 AND active = TRUE
     RETURNING id, name, email, role, position, avatar_data_url AS "avatarDataUrl", active`,
    [req.user?.id, body.avatarDataUrl]
  );
  if (!result.rowCount) throw httpError(404, 'Usuário ativo não encontrado.');
  res.json(result.rows[0]);
}));

usersRouter.get('/:id/career', asyncHandler(async (req, res) => {
  const profile = await query(
    `SELECT id, name, email, role, position, avatar_data_url AS "avatarDataUrl", active, created_at AS "createdAt"
     FROM users
     WHERE id = $1 AND active = TRUE`,
    [req.params.id]
  );
  if (!profile.rowCount) throw httpError(404, 'Atleta ativo não encontrado.');

  const totals = await query(
    `SELECT
      COALESCE(sum(total_points), 0)::INTEGER AS "totalPoints",
      COALESCE(sum(presences), 0)::INTEGER AS presences,
      COALESCE(sum(wins), 0)::INTEGER AS wins,
      COALESCE(sum(draws), 0)::INTEGER AS draws,
      COALESCE(sum(losses), 0)::INTEGER AS losses,
      COALESCE(sum(goals), 0)::INTEGER AS goals,
      COALESCE(sum(assists), 0)::INTEGER AS assists,
      COALESCE(sum(yellow_cards), 0)::INTEGER AS "yellowCards",
      COALESCE(sum(red_cards), 0)::INTEGER AS "redCards",
      COALESCE(sum(blue_cards), 0)::INTEGER AS "blueCards",
      count(*) FILTER (WHERE presences > 0 OR goals > 0 OR assists > 0 OR paid_months > 0)::INTEGER AS "seasonsPlayed"
     FROM season_standings
     WHERE user_id = $1`,
    [req.params.id]
  );

  const seasons = await query(
    `SELECT s.id AS "seasonId", s.name AS "seasonName", s.year, s.status,
      ss.total_points AS "totalPoints", ss.presences, ss.wins, ss.draws, ss.losses,
      ss.goals, ss.assists, ss.yellow_cards AS "yellowCards", ss.red_cards AS "redCards", ss.blue_cards AS "blueCards"
     FROM season_standings ss
     JOIN seasons s ON s.id = ss.season_id
     WHERE ss.user_id = $1 AND (ss.presences > 0 OR ss.goals > 0 OR ss.assists > 0 OR ss.paid_months > 0)
     ORDER BY s.year DESC, s.created_at DESC`,
    [req.params.id]
  );

  const awards = await query(
    `SELECT sa.id, sa.season_id AS "seasonId", s.name AS "seasonName", s.year,
      sa.category_code AS "categoryCode", ac.label, sa.placement, sa.source
     FROM season_awards sa
     JOIN seasons s ON s.id = sa.season_id
     JOIN award_categories ac ON ac.code = sa.category_code
     WHERE sa.user_id = $1
     ORDER BY s.year DESC, ac.label ASC`,
    [req.params.id]
  );

  const badges = await query(
    `SELECT id, season_id AS "seasonId", code, label, created_at AS "createdAt"
     FROM athlete_badges
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [req.params.id]
  );

  const suspensions = await query(
    `SELECT s.id, se.name AS "seasonName", s.reason, s.served_at AS "servedAt", s.created_at AS "createdAt"
     FROM athlete_suspensions s
     LEFT JOIN seasons se ON se.id = s.season_id
     WHERE s.user_id = $1
     ORDER BY s.created_at DESC`,
    [req.params.id]
  );

  res.json({ profile: profile.rows[0], totals: totals.rows[0], seasons: seasons.rows, awards: awards.rows, badges: badges.rows, suspensions: suspensions.rows });
}));

usersRouter.post('/', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req: AuthRequest, res) => {
  const body = validate(userSchema, req.body);
  if (req.user?.role === 'COORDENADOR' && body.role !== 'ATLETA') {
    throw httpError(403, 'Coordenador pode cadastrar atletas, mas não pode criar admins ou coordenadores.');
  }

  const temporaryPassword = crypto.randomBytes(48).toString('hex');
  const result = await query<{ id: string; name: string; email: string; role: string; position: string; active: boolean }>(
    `INSERT INTO users (name, email, password_hash, role, position)
     VALUES ($1, lower($2), $3, $4, $5)
     RETURNING id, name, email, role, position, active`,
    [body.name.trim(), body.email, await hashPassword(body.password ?? temporaryPassword), body.role, body.position]
  );
  let activationEmailSent = false;

  if (!body.password) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await query('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'7 days\')', [result.rows[0].id, tokenHash]);
    activationEmailSent = await sendAccountActivationEmail(result.rows[0].email, result.rows[0].name, token);
  }

  res.status(201).json({ ...result.rows[0], activationEmailSent });
}));

usersRouter.patch('/:id', requireRoles('ADMIN'), asyncHandler(async (req, res) => {
  const body = validate(updateUserSchema, req.body);
  await ensureNotRemovingLastAdmin(req.params.id, body.role, body.active);
  const passwordHash = body.password ? await hashPassword(body.password) : null;
  const result = await query(
    `UPDATE users SET
      name = COALESCE($2, name),
      email = COALESCE(lower($3), email),
      password_hash = COALESCE($4, password_hash),
      role = COALESCE($5, role),
      position = COALESCE($6, position),
      active = COALESCE($7, active),
      avatar_data_url = CASE WHEN $8::BOOLEAN THEN $9 ELSE avatar_data_url END,
      updated_at = now()
     WHERE id = $1
     RETURNING id, name, email, role, position, avatar_data_url AS "avatarDataUrl", active`,
    [req.params.id, body.name?.trim(), body.email, passwordHash, body.role, body.position, body.active, Object.prototype.hasOwnProperty.call(body, 'avatarDataUrl'), body.avatarDataUrl]
  );
  if (!result.rowCount) throw httpError(404, 'Usuário não encontrado.');
  res.json(result.rows[0]);
}));

usersRouter.post('/:id/send-activation', requireRoles('ADMIN', 'COORDENADOR'), asyncHandler(async (req: AuthRequest, res) => {
  const result = await query<{ id: string; name: string; email: string; role: string; active: boolean }>('SELECT id, name, email, role, active FROM users WHERE id = $1', [req.params.id]);
  const user = result.rows[0];
  if (!user) throw httpError(404, 'Usuário não encontrado.');
  if (req.user?.role === 'COORDENADOR' && user.role !== 'ATLETA') throw httpError(403, 'Coordenador só pode reenviar convite para atletas.');
  if (!user.active) throw httpError(409, 'Reative o usuário antes de reenviar convite.');
  const token = await createActivationToken(user.id);
  const activationEmailSent = await sendAccountActivationEmail(user.email, user.name, token);
  res.json({ ok: true, activationEmailSent });
}));

usersRouter.post('/:id/password', requireRoles('ADMIN'), asyncHandler(async (req, res) => {
  const body = validate(adminPasswordSchema, req.body);
  const result = await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1 RETURNING id', [req.params.id, await hashPassword(body.password)]);
  if (!result.rowCount) throw httpError(404, 'Usuário não encontrado.');
  await query('UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [req.params.id]);
  res.json({ ok: true });
}));
