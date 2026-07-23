import { NextFunction, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db/pool';
import { env } from '../config/env';
import { AuthRequest, AuthUser, Role } from '../types';
import { httpError } from '../utils/http';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, env.jwtSecret, { expiresIn: '12h' });
}

export function requireAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(httpError(401, 'Autenticação obrigatória.'));
    return;
  }

  try {
    req.user = jwt.verify(header.slice(7), env.jwtSecret) as AuthUser;
    next();
  } catch {
    next(httpError(401, 'Sessão expirada ou inválida.'));
  }
}

export function requireRoles(...roles: Role[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(httpError(401, 'Autenticação obrigatória.'));
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(httpError(403, 'Perfil sem permissão para esta ação.'));
      return;
    }

    next();
  };
}

export async function loadActiveUserByEmail(email: string) {
  const result = await query<{ id: string; name: string; email: string; role: Role; password_hash: string }>(
    'SELECT id, name, email, role, password_hash FROM users WHERE lower(email) = lower($1) AND active = TRUE',
    [email]
  );
  return result.rows[0];
}
