import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { query } from './db/pool';
import { authRouter } from './routes/auth.routes';
import { awardsRouter } from './routes/awards.routes';
import { matchesRouter } from './routes/matches.routes';
import { paymentsRouter } from './routes/payments.routes';
import { seasonsRouter } from './routes/seasons.routes';
import { settingsRouter } from './routes/settings.routes';
import { suspensionsRouter } from './routes/suspensions.routes';
import { usersRouter } from './routes/users.routes';
import { ApiError } from './types';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));
app.use(cors({
  origin(origin, callback) {
    if (!origin || env.allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origem não autorizada pelo ALLOWED_ORIGINS.'));
  },
  credentials: true
}));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'pokapratika-backend' });
});

app.get('/ready', async (_req, res, next) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, service: 'pokapratika-backend', database: 'ready' });
  } catch (error) {
    next(error);
  }
});

app.use('/auth', authRouter);
app.use('/users', usersRouter);
app.use('/settings', settingsRouter);
app.use('/seasons', seasonsRouter);
app.use('/matches', matchesRouter);
app.use('/payments', paymentsRouter);
app.use('/awards', awardsRouter);
app.use('/suspensions', suspensionsRouter);

app.use((_req, _res, next) => {
  const error = new Error('Rota não encontrada.') as ApiError;
  error.status = 404;
  next(error);
});

app.use((error: ApiError, _req: Request, res: Response, _next: NextFunction) => {
  const conflictCode = (error as ApiError & { code?: string }).code === '23505';
  const status = conflictCode ? 409 : error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
  const message = conflictCode ? 'Registro duplicado. Verifique dados únicos como e-mail.' : status === 500 ? 'Erro interno do servidor.' : error.message;
  res.status(status).json({ message });
});
