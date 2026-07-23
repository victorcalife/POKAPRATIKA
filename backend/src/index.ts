import { app } from './app';
import { env } from './config/env';

app.listen(env.port, '0.0.0.0', () => {
  console.log(`POKA PRÁTIKA backend escutando na porta ${env.port}`);
});
