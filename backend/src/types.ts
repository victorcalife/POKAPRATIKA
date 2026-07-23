import { Request } from 'express';

export type Role = 'ADMIN' | 'COORDENADOR' | 'ATLETA';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export type AuthRequest = Request & {
  user?: AuthUser;
};

export type ApiError = Error & {
  status?: number;
};
