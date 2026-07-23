import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool';
import { asyncHandler, httpError, validate } from '../utils/http';
import { hashPassword, loadActiveUserByEmail, requireAuth, signToken, verifyPassword } from '../security/auth';
import { AuthRequest, Role } from '../types';
import { sendPasswordResetEmail } from '../services/mail';

export const authRouter = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(6) });
const bootstrapSchema = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8) });
const forgotSchema = z.object({ email: z.string().email() });
const resetSchema = z.object({ token: z.string().min(30), password: z.string().min(8) });
const profileSchema = z.object({ name: z.string().min(2).optional(), email: z.string().email().optional(), avatarDataUrl: z.string().max(900000).nullable().optional() });

authRouter.post('/bootstrap-admin', asyncHandler(async (req, res) => {
  const count = await query<{ total: string }>('SELECT count(*) AS total FROM users');
  if (Number(count.rows[0].total) > 0) {
    throw httpError(409, 'Bootstrap indisponível: já existem usuários cadastrados.');
  }

  const body = validate(bootstrapSchema, req.body);
  const result = await query<{ id: string; name: string; email: string; role: Role }>(
    `INSERT INTO users (name, email, password_hash, role, position)
     VALUES ($1, lower($2), $3, 'ADMIN', 'MC')
     RETURNING id, name, email, role`,
    [body.name.trim(), body.email, await hashPassword(body.password)]
  );
  const user = result.rows[0];
  res.status(201).json({ token: signToken(user), user });
}));

authRouter.post('/login', asyncHandler(async (req, res) => {
  const body = validate(loginSchema, req.body);
  const user = await loadActiveUserByEmail(body.email);

  if (!user || !(await verifyPassword(body.password, user.password_hash))) {
    throw httpError(401, 'E-mail ou senha inválidos.');
  }

  const payload = { id: user.id, name: user.name, email: user.email, role: user.role as Role };
  res.json({ token: signToken(payload), user: payload });
}));

authRouter.get('/me', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const result = await query('SELECT id, name, email, role, position, avatar_data_url AS "avatarDataUrl", active FROM users WHERE id = $1', [req.user?.id]);
  if (!result.rowCount) throw httpError(404, 'Usuário autenticado não encontrado.');
  res.json(result.rows[0]);
}));

authRouter.patch('/me', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const body = validate(profileSchema, req.body);
  const result = await query(
    `UPDATE users
     SET name = COALESCE($2, name), email = COALESCE(lower($3), email), avatar_data_url = CASE WHEN $4::BOOLEAN THEN $5 ELSE avatar_data_url END, updated_at = now()
     WHERE id = $1
     RETURNING id, name, email, role, position, avatar_data_url AS "avatarDataUrl"`,
    [req.user?.id, body.name?.trim(), body.email, Object.prototype.hasOwnProperty.call(body, 'avatarDataUrl'), body.avatarDataUrl]
  );
  if (!result.rowCount) throw httpError(404, 'Usuário autenticado não encontrado.');
  res.json(result.rows[0]);
}));

authRouter.post('/forgot-password', asyncHandler(async (req, res) => {
  const body = validate(forgotSchema, req.body);
  const user = await loadActiveUserByEmail(body.email);

  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await query('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'30 minutes\')', [user.id, tokenHash]);
    await sendPasswordResetEmail(user.email, user.name, token);
  }

  res.json({ ok: true, message: 'Se o e-mail existir, enviaremos a recuperação de senha.' });
}));

authRouter.post('/reset-password', asyncHandler(async (req, res) => {
  const body = validate(resetSchema, req.body);
  const tokenHash = crypto.createHash('sha256').update(body.token).digest('hex');
  const tokenResult = await query<{ id: string; user_id: string }>(
    'SELECT id, user_id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()',
    [tokenHash]
  );

  const token = tokenResult.rows[0];
  if (!token) {
    throw httpError(400, 'Token inválido ou expirado.');
  }

  await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [token.user_id, await hashPassword(body.password)]);
  await query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [token.id]);
  res.json({ ok: true });
}));
