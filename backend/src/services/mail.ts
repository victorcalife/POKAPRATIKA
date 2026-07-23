import { env } from '../config/env';

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] ?? char));
}

async function sendMail(email: string, subject: string, html: string): Promise<boolean> {
  const { microsoftClientId, microsoftClientSecret, microsoftGraphMailbox, microsoftTenantId } = env;

  if (!microsoftClientId || !microsoftClientSecret || !microsoftGraphMailbox || !microsoftTenantId) {
    return false;
  }

  const tokenResponse = await fetch(`https://login.microsoftonline.com/${microsoftTenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: microsoftClientId,
      client_secret: microsoftClientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials'
    })
  });

  if (!tokenResponse.ok) {
    return false;
  }

  const tokenPayload = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenPayload.access_token) {
    return false;
  }

  const message = {
    message: {
      subject,
      body: {
        contentType: 'HTML',
        content: html
      },
      toRecipients: [{ emailAddress: { address: email } }]
    },
    saveToSentItems: false
  };

  const sendResponse = await fetch(`https://graph.microsoft.com/v1.0/users/${microsoftGraphMailbox}/sendMail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenPayload.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(message)
  });

  return sendResponse.ok;
}

export async function sendPasswordResetEmail(email: string, name: string, token: string): Promise<boolean> {
  const resetUrl = env.frontendUrl ? `${env.frontendUrl}/resetar-senha?token=${encodeURIComponent(token)}` : token;
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(resetUrl);

  return sendMail(
    email,
    'POKA PRÁTIKA: ALTERE SUA SENHA',
    `<p>Olá, ${safeName}.</p><p>Use este link para redefinir sua senha no POKA PRÁTIKA:</p><p><a href="${safeUrl}">${safeUrl}</a></p><p>O link expira em 30 minutos.</p>`
  );
}

export async function sendAccountActivationEmail(email: string, name: string, token: string): Promise<boolean> {
  const activationUrl = env.frontendUrl ? `${env.frontendUrl}/ativar-conta?token=${encodeURIComponent(token)}` : token;
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(activationUrl);

  return sendMail(
    email,
    'POKA PRÁTIKA: ATIVE SEU CADASTRO',
    `<p>Fala, ${safeName}.</p><p>Você foi cadastrado no sistema oficial do POKA PRÁTIKA.</p><p>Clique no link abaixo para ativar sua conta e definir sua senha:</p><p><a href="${safeUrl}">${safeUrl}</a></p><p>O link expira em 7 dias. Depois disso, use a opção de recuperação de senha.</p>`
  );
}
