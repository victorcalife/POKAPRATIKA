const requiredKeys = ['DATABASE_URL', 'JWT_SECRET', 'NODE_ENV', 'PORT', 'ALLOWED_ORIGINS'] as const;

for (const key of requiredKeys) {
  if (!process.env[key]) {
    throw new Error(`Variável obrigatória ausente no serviço Railway: ${key}`);
  }
}

const port = Number(process.env.PORT);

if (process.env.NODE_ENV !== 'production') {
  throw new Error('NODE_ENV precisa ser production no serviço Railway do backend.');
}

if (port !== 8080) {
  throw new Error('PORT precisa ser exatamente 8080 no serviço Railway do backend.');
}

export const env = {
  databaseUrl: process.env.DATABASE_URL as string,
  jwtSecret: process.env.JWT_SECRET as string,
  nodeEnv: process.env.NODE_ENV as 'production',
  port,
  allowedOrigins: (process.env.ALLOWED_ORIGINS as string).split(',').map((origin) => origin.trim()).filter(Boolean),
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID,
  microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  microsoftGraphMailbox: process.env.MICROSOFT_GRAPH_MAILBOX,
  microsoftTenantId: process.env.MICROSOFT_TENANT_ID,
  frontendUrl: process.env.FRONTEND_URL
};
