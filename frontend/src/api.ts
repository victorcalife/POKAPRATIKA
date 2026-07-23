const apiUrl = import.meta.env.VITE_API_URL as string | undefined;

if (!apiUrl) {
  throw new Error('VITE_API_URL precisa estar definida no serviço de frontend da Railway.');
}

export const API_URL = apiUrl.replace(/\/$/, '');

export class ApiClient {
  private token: string | null;

  constructor(token: string | null) {
    this.token = token;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);

    const response = await fetch(`${API_URL}${path}`, { ...options, headers });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.message ?? 'Falha na comunicação com o backend.');
    }

    return payload as T;
  }
}
