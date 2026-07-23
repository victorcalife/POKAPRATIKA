import { app } from './app';
import { env } from './config/env';

app.listen(env.port, '0.0.0.0', () => {
  process.stdout.write(`POKA PRÁTIKA backend escutando na porta ${env.port}\n`);
});
