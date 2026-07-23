import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ApiClient } from './api';
import logoUrl from './assets/poka-pratika-logo.svg';
import { AthletePosition, MatchListItem, PointSetting, Season, Standing, User } from './types';

type View = 'temporada' | 'perfis' | 'sumulas' | 'pagamentos' | 'premios' | 'admin';
type AuthPayload = { token: string; user: User };
type RankingPayload = {
  goals: Array<{ userId: string; name: string; goals: number; ownGoals: number; netGoals: number; gamesPlayed: number; average: string | number }>;
  assists: Array<{ userId: string; name: string; assists: number; gamesPlayed: number; average: string | number }>;
  presence: Array<{ userId: string; name: string; gamesPlayed: number; presences: number; total: number; percentage: string | number }>;
  cards: Array<{ userId: string; name: string; cardPoints: number; totalCards: number; gamesPlayed: number; average: string | number }>;
};
type Suspension = { id: string; userName: string; reason: string; triggerMatchTitle: string; servedAt?: string | null };
type MatchEventDraft = { userId: string; relatedUserId?: string | null; eventType: 'GOL' | 'GOL_CONTRA' | 'ASSISTENCIA' | 'CARTAO_AMARELO' | 'CARTAO_VERMELHO' | 'CARTAO_AZUL'; minute: number; team?: 'A' | 'B' | null };
type MatchCorrection = { id: string; reason: string; previousTeamAScore: number; previousTeamBScore: number; newTeamAScore: number; newTeamBScore: number; correctedByName: string; createdAt: string; previousEvents: MatchEventDraft[]; newEvents: MatchEventDraft[] };
type CareerProfile = {
  profile: User;
  totals: { totalPoints: number; presences: number; wins: number; draws: number; losses: number; goals: number; assists: number; yellowCards: number; redCards: number; blueCards: number; seasonsPlayed: number };
  seasons: Array<{ seasonId: string; seasonName: string; year: number; status: string; totalPoints: number; presences: number; wins: number; draws: number; losses: number; goals: number; assists: number; yellowCards: number; redCards: number; blueCards: number }>;
  awards: Array<{ id: string; seasonName: string; year: number; categoryCode: string; label: string; placement: number; source: string }>;
  badges: Array<{ id: string; code: string; label: string; seasonId?: string | null }>;
  suspensions: Array<{ id: string; seasonName?: string | null; reason: string; servedAt?: string | null }>;
};
type PaymentRecord = { id?: string; userId?: string; userName?: string; referenceMonth: string; dueDate: string; amountCents: number; status: 'PENDING' | 'PAID' | 'LATE' | 'WAIVED'; paidAt?: string | null; earnsPoint: boolean; notes?: string | null };
type AwardCategory = { code: string; label: string; votingEnabled: boolean };
type MyVote = { categoryCode: string; votedUserId: string };
type AwardResult = { categoryCode: string; label: string; userId: string; name: string; votes: number };
type StandingImportResult = { imported: Array<{ name: string; email: string; totalPoints: number }>; skipped: Array<{ identifier: string; reason: string }> };
type MatchDraftPlayer = { userId: string; name: string; email: string; team: 'A' | 'B' | 'PRESENTE_SEM_JOGAR'; roleInMatch: 'GOLEIRO' | 'LINHA' | 'PRESENTE_SEM_JOGAR'; drawOrder: string; startsOnBench: boolean };

type MatchDetail = MatchListItem & {
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  players: Array<{ userId: string; name: string; team: 'A' | 'B' | 'PRESENTE_SEM_JOGAR'; roleInMatch: string; drawOrder?: number | null; rotationOrder?: number | null; startsOnBench: boolean }>;
  events: Array<{ userId: string; relatedUserId?: string | null; eventType: string; minute: number; team?: 'A' | 'B' | null }>;
  corrections: MatchCorrection[];
  rotation: Record<'A' | 'B', { reserves: number; firstCycleMinutes: number; secondCycleMinutes: number; schedule: Array<{ minute: number; label: string; entering: string[]; leaving: string[] }> }>;
};

const storageKey = 'pokapratika.auth';

const athletePositionOptions: Array<{ value: AthletePosition; label: string }> = [
  { value: 'GO', label: 'GO • Goleiro' },
  { value: 'ZG', label: 'ZG • Zagueiro' },
  { value: 'LD', label: 'LD • Lateral direito' },
  { value: 'LE', label: 'LE • Lateral esquerdo' },
  { value: 'MD', label: 'MD • Meia defensor' },
  { value: 'MC', label: 'MC • Meio campo' },
  { value: 'MA', label: 'MA • Meia atacante' },
  { value: 'AT', label: 'AT • Atacante' }
];

function positionLabel(position?: AthletePosition | null): string {
  return athletePositionOptions.find((item) => item.value === position)?.label ?? 'MC • Meio campo';
}

function formatCardReason(reason: string) {
  return reason === 'CARTAO_VERMELHO' ? 'Vermelho direto' : 'Acúmulo de 3 amarelos';
}

function eventLabel(event: string) {
  return event.replace('GOL_CONTRA', 'Gol contra').replace('CARTAO_', 'Cartão ').replace('GOL', 'Gol').replace('ASSISTENCIA', 'Assistência').toLowerCase();
}

function numberValue(value: string | number | undefined): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function formatAverage(value: string | number | undefined): string {
  return numberValue(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function App() {
  const passwordPath = window.location.pathname === '/ativar-conta' || window.location.pathname === '/resetar-senha' ? window.location.pathname : '';
  const [auth, setAuth] = useState<AuthPayload | null>(() => {
    const saved = localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) as AuthPayload : null;
  });
  const api = useMemo(() => new ApiClient(auth?.token ?? null), [auth?.token]);
  const [view, setView] = useState<View>('temporada');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [activeSeasonId, setActiveSeasonId] = useState('');
  const [standings, setStandings] = useState<Standing[]>([]);
  const [rankings, setRankings] = useState<RankingPayload>({ goals: [], assists: [], presence: [], cards: [] });
  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [points, setPoints] = useState<PointSetting[]>([]);
  const [suspensions, setSuspensions] = useState<Suspension[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<MatchDetail | null>(null);
  const canCoordinate = auth?.user.role === 'ADMIN' || auth?.user.role === 'COORDENADOR';
  const isAdmin = auth?.user.role === 'ADMIN';
  const activeSeason = seasons.find((season) => season.id === activeSeasonId) ?? seasons.find((season) => season.status === 'OPEN') ?? seasons[0];

  async function loadData() {
    if (!auth) return;
    setLoading(true);
    setError('');
    try {
      const [seasonData, userData, pointData, suspensionData] = await Promise.all([
        api.request<Season[]>('/seasons'),
        api.request<User[]>('/users'),
        api.request<PointSetting[]>('/settings/points'),
        api.request<Suspension[]>('/suspensions')
      ]);
      setSeasons(seasonData);
      setUsers(userData);
      setPoints(pointData);
      setSuspensions(suspensionData);
      const selected = activeSeasonId || seasonData.find((season) => season.status === 'OPEN')?.id || seasonData[0]?.id || '';
      setActiveSeasonId(selected);
      if (selected) {
        const [standingData, rankingData, matchData] = await Promise.all([
          api.request<Standing[]>(`/seasons/${selected}/standings`),
          api.request<RankingPayload>(`/seasons/${selected}/rankings`),
          api.request<MatchListItem[]>(`/matches?seasonId=${selected}`)
        ]);
        setStandings(standingData);
        setRankings(rankingData);
        setMatches(matchData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar dados.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [auth?.token]);

  useEffect(() => {
    if (!auth || !activeSeasonId) return;
    Promise.all([
      api.request<Standing[]>(`/seasons/${activeSeasonId}/standings`),
      api.request<RankingPayload>(`/seasons/${activeSeasonId}/rankings`),
      api.request<MatchListItem[]>(`/matches?seasonId=${activeSeasonId}`)
    ]).then(([standingData, rankingData, matchData]) => {
      setStandings(standingData);
      setRankings(rankingData);
      setMatches(matchData);
    }).catch((err) => setError(err instanceof Error ? err.message : 'Falha ao trocar temporada.'));
  }, [activeSeasonId]);

  function saveAuth(payload: AuthPayload) {
    localStorage.setItem(storageKey, JSON.stringify(payload));
    setAuth(payload);
  }

  function updateAuthenticatedUser(user: User) {
    setAuth((current) => {
      if (!current) return current;
      const updated = { ...current, user: { ...current.user, ...user } };
      localStorage.setItem(storageKey, JSON.stringify(updated));
      return updated;
    });
  }

  if (passwordPath) {
    return <PasswordTokenScreen mode={passwordPath === '/ativar-conta' ? 'activation' : 'reset'} />;
  }

  if (!auth) {
    return <LoginScreen onAuth={saveAuth} />;
  }

  return (
    <main className="shell">
      <header className="hero card glass">
        <div className="brand-lockup">
          <img className="brand-logo" src={logoUrl} alt="Escudo POKA PRÁTIKA" />
          <div>
            <p className="eyebrow">Balneário Camboriú / SC • Quarta 20h</p>
            <h1>POKA PRÁTIKA</h1>
            <p className="muted">Pouca técnica, muita resenha: súmula, mensalidade, ranking e premiação sem Excel no pós-jogo.</p>
          </div>
        </div>
        <div className="profile-pill">
          {auth.user.avatarDataUrl ? <img src={auth.user.avatarDataUrl} alt="Avatar" /> : <span>{auth.user.name.slice(0, 1)}</span>}
          <div>
            <strong>{auth.user.name}</strong>
            <small>{auth.user.role}</small>
          </div>
          <button className="ghost" onClick={() => { localStorage.removeItem(storageKey); setAuth(null); }}>Sair</button>
        </div>
      </header>

      {error && <button className="alert" onClick={() => setError('')}>{error}</button>}
      {loading && <div className="mini-loading">Carregando dados reais da Railway...</div>}

      <nav className="tabs">
        {(['temporada', 'perfis', 'sumulas', 'pagamentos', 'premios', 'admin'] as View[]).filter((item) => item !== 'admin' || canCoordinate).map((item) => (
          <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item === 'admin' ? 'config.' : item}</button>
        ))}
      </nav>

      <section className="context-row">
        <select value={activeSeasonId} onChange={(event) => setActiveSeasonId(event.target.value)}>
          {seasons.map((season) => <option key={season.id} value={season.id}>{season.name} • {season.status}</option>)}
        </select>
        <span className={`status ${activeSeason?.status?.toLowerCase()}`}>{activeSeason?.status ?? 'sem temporada'}</span>
        {suspensions.length > 0 && <span className="status danger">{suspensions.length} suspensão(ões)</span>}
      </section>

      {view === 'temporada' && <SeasonPanel api={api} standings={standings} rankings={rankings} suspensions={suspensions} matches={matches} canCoordinate={canCoordinate} onReload={loadData} />}
  {view === 'perfis' && <ProfilesPanel api={api} users={users} currentUserId={auth.user.id} onCurrentUserUpdated={updateAuthenticatedUser} />}
      {view === 'sumulas' && <MatchesPanel api={api} canCoordinate={canCoordinate} users={users} matches={matches} activeSeasonId={activeSeasonId} onReload={loadData} selectedMatch={selectedMatch} setSelectedMatch={setSelectedMatch} />}
      {view === 'pagamentos' && <PaymentsPanel api={api} canCoordinate={canCoordinate} users={users} activeSeasonId={activeSeasonId} />}
      {view === 'premios' && <AwardsPanel api={api} users={users} activeSeason={activeSeason} isAdmin={isAdmin} />}
      {view === 'admin' && canCoordinate && <AdminPanel api={api} users={users} seasons={seasons} points={points} activeSeasonId={activeSeasonId} onReload={loadData} isAdmin={isAdmin} />}
    </main>
  );
}

function PasswordTokenScreen({ mode }: { mode: 'activation' | 'reset' }) {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') ?? '', []);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  const api = useMemo(() => new ApiClient(null), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    if (!token) {
      setMessage('Link inválido: token não encontrado.');
      return;
    }
    if (password !== confirmPassword) {
      setMessage('As senhas precisam ser iguais.');
      return;
    }
    try {
      await api.request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
      setDone(true);
      setMessage(mode === 'activation' ? 'Cadastro ativado. Agora é só entrar com seu e-mail e senha.' : 'Senha alterada. Agora você pode entrar novamente.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível salvar a senha.');
    }
  }

  return <main className="login-wrap"><form className="login-card card" onSubmit={submit}><img className="login-logo" src={logoUrl} alt="Escudo POKA PRÁTIKA" /><p className="eyebrow">POKA PRÁTIKA • acesso seguro</p><h1>{mode === 'activation' ? 'Ativar cadastro' : 'Alterar senha'}</h1><p className="muted">Defina uma senha com pelo menos 8 caracteres. O login será sempre pelo seu e-mail.</p><input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Nova senha" type="password" required minLength={8} disabled={done} /><input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirmar senha" type="password" required minLength={8} disabled={done} /><button className="primary" disabled={done}>{done ? 'Senha salva' : 'Salvar senha'}</button>{message && <p className="muted">{message}</p>}{done && <button type="button" className="ghost" onClick={() => { window.history.replaceState({}, '', '/'); window.location.reload(); }}>Ir para login</button>}</form></main>;
}

function LoginScreen({ onAuth }: { onAuth: (payload: AuthPayload) => void }) {
  const [mode, setMode] = useState<'login' | 'bootstrap' | 'forgot'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const api = useMemo(() => new ApiClient(null), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      if (mode === 'forgot') {
        const response = await api.request<{ message: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
        setMessage(response.message);
        return;
      }
      const path = mode === 'bootstrap' ? '/auth/bootstrap-admin' : '/auth/login';
      const payload = await api.request<AuthPayload>(path, { method: 'POST', body: JSON.stringify(mode === 'bootstrap' ? { name, email, password } : { email, password }) });
      onAuth(payload);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível autenticar.');
    }
  }

  return (
    <main className="login-wrap">
      <form className="login-card card" onSubmit={submit}>
        <img className="login-logo" src={logoUrl} alt="Escudo POKA PRÁTIKA" />
        <p className="eyebrow">POKA PRÁTIKA • Balneário Camboriú / SC</p>
        <h1>{mode === 'bootstrap' ? 'Criar primeiro admin' : mode === 'forgot' ? 'Recuperar senha' : 'Entrar no ferino'}</h1>
        <p className="muted">O sistema oficial de quem talvez erre o domínio, mas nunca falta na quarta.</p>
        {mode === 'bootstrap' && <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome do admin" required />}
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-mail" type="email" required />
        {mode !== 'forgot' && <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha" type="password" required minLength={8} />}
        <button className="primary">{mode === 'forgot' ? 'Enviar recuperação' : 'Acessar'}</button>
        {message && <p className="muted">{message}</p>}
        <div className="login-actions">
          <button type="button" className="ghost" onClick={() => setMode(mode === 'login' ? 'bootstrap' : 'login')}>{mode === 'login' ? 'Primeiro acesso' : 'Voltar ao login'}</button>
          <button type="button" className="ghost" onClick={() => setMode('forgot')}>Esqueci minha senha</button>
        </div>
      </form>
    </main>
  );
}

function SeasonPanel({ api, standings, rankings, suspensions, matches, canCoordinate, onReload }: { api: ApiClient; standings: Standing[]; rankings: RankingPayload; suspensions: Suspension[]; matches: MatchListItem[]; canCoordinate: boolean; onReload: () => Promise<void> }) {
  const podium = standings.slice(0, 3);
  const totals = standings.reduce((acc, row) => ({ points: acc.points + row.total_points, games: acc.games + row.games_played, goals: acc.goals + row.goals, assists: acc.assists + row.assists, presences: acc.presences + row.presences }), { points: 0, games: 0, goals: 0, assists: 0, presences: 0 });
  const confirmedMatches = matches.filter((match) => match.status === 'CONFIRMED');

  async function serveSuspension(id: string, servedMatchId: string) {
    if (!servedMatchId) return;
    await api.request(`/suspensions/${id}/serve`, { method: 'POST', body: JSON.stringify({ servedMatchId }) });
    await onReload();
  }

  return (
    <div className="grid two">
      <section className="card compact">
        <div className="card-head"><h2>Pontos corridos</h2><span className="status open">{standings.length} atletas</span></div>
        {podium.length > 0 ? <div className="podium">{podium.map((row, index) => <article className={`podium-card place-${index + 1}`} key={row.user_id}><span>{index === 0 ? '👑' : index === 1 ? '🥈' : '🥉'}</span><strong>{row.name}</strong><small>{row.total_points} pts • {row.games_played} jogos • {row.presences} pres.</small></article>)}</div> : <EmptyState title="Temporada pronta para começar" text="Assim que a primeira súmula for confirmada, o pódio e a tabela ganham vida." />}
        <div className="stat-grid season-stats"><span><b>{totals.points}</b> pontos</span><span><b>{totals.games}</b> jogos</span><span><b>{totals.goals}</b> gols</span><span><b>{totals.presences}</b> presenças</span></div>
        <div className="table-cards">
          {standings.map((row) => (
            <article className="row-card" key={row.user_id}>
              <strong>{row.position}º {row.name}</strong>
              <span>{row.total_points} pts</span>
              <small>J {row.games_played} • V {row.wins} • E {row.draws} • D {row.losses} • Pres. sem jogar {row.presences} • Mens. {row.paid_months}</small>
              <small>Equipe: {row.team_goals_for} pró • {row.team_goals_against} contra • saldo {row.team_goal_balance} • aproveit. {formatPercent(row.games_played ? ((row.wins * 3 + row.draws) / (row.games_played * 3)) * 100 : 0)}</small>
            </article>
          ))}
        </div>
      </section>
      <section className="card compact">
        <h2>Corridas individuais</h2>
        <div className="ranking-grid">
          <MiniRanking title="Artilharia" rows={rankings.goals.map((item) => ({ name: item.name, value: item.netGoals, detail: `${item.goals} gols • ${item.ownGoals} contra • média ${formatAverage(item.average)}` }))} suffix="saldo" />
          <MiniRanking title="Assistência" rows={rankings.assists.map((item) => ({ name: item.name, value: item.assists, detail: `${item.gamesPlayed} jogos • média ${formatAverage(item.average)}` }))} suffix="assist." />
          <MiniRanking title="Assiduidade" rows={rankings.presence.map((item) => ({ name: item.name, value: item.total, detail: `${item.gamesPlayed} jogos • ${item.presences} pres. • ${formatAverage(item.percentage)}%` }))} suffix="total" />
          <MiniRanking title="Cartões" rows={rankings.cards.map((item) => ({ name: item.name, value: item.cardPoints, detail: `${item.totalCards} cartões • média ${formatAverage(item.average)}` }))} suffix="pts" />
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={standings.slice(0, 8)}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="name" hide />
            <YAxis hide />
            <Tooltip />
            <Bar dataKey="total_points" fill="#16c784" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>
      <section className="card compact span">
        <h2>Suspensões abertas</h2>
        <div className="chips">
          {suspensions.length === 0 ? <span className="muted">Nenhuma suspensão pendente.</span> : suspensions.map((item) => <span className="chip danger" key={item.id}>{item.userName} • {formatCardReason(item.reason)}</span>)}
        </div>
        {canCoordinate && suspensions.length > 0 && <div className="table-cards">{suspensions.map((item) => <article className="row-card" key={`serve-${item.id}`}><strong>{item.userName}</strong><span>{formatCardReason(item.reason)}</span><small>Gerada em: {item.triggerMatchTitle}</small><select disabled={!confirmedMatches.length} defaultValue="" onChange={(event) => void serveSuspension(item.id, event.target.value)}><option value="">Marcar como cumprida em...</option>{confirmedMatches.map((match) => <option key={match.id} value={match.id}>{match.title} • {match.matchDate?.slice(0, 10)}</option>)}</select></article>)}</div>}
      </section>
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><strong>{title}</strong><span>{text}</span></div>;
}

function MiniRanking({ title, rows, suffix }: { title: string; rows: Array<{ name: string; value: number; detail?: string }>; suffix: string }) {
  return <div className="mini-rank"><strong>{title}</strong>{rows.length === 0 ? <small className="muted">Aguardando a bola rolar.</small> : rows.slice(0, 4).map((row, index) => <span key={row.name}>{index + 1}. {row.name} <b>{row.value} {suffix}</b><small>{row.detail}</small></span>)}</div>;
}

function ProfilesPanel({ api, users, currentUserId, onCurrentUserUpdated }: { api: ApiClient; users: User[]; currentUserId: string; onCurrentUserUpdated: (user: User) => void }) {
  const [selectedUserId, setSelectedUserId] = useState(currentUserId);
  const [career, setCareer] = useState<CareerProfile | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setMessage('');
    api.request<CareerProfile>(`/users/${selectedUserId}/career`).then(setCareer).catch((err) => setMessage(err instanceof Error ? err.message : 'Falha ao carregar perfil.'));
  }, [selectedUserId]);

  async function saveAvatar(file?: File | null) {
    if (!career || selectedUserId !== currentUserId) return;
    if (!file) {
      const updated = await api.request<User>('/users/me/avatar', { method: 'PATCH', body: JSON.stringify({ avatarDataUrl: null }) });
      onCurrentUserUpdated(updated);
      setCareer({ ...career, profile: { ...career.profile, avatarDataUrl: null } });
      setMessage('Foto removida do perfil.');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setMessage('Use uma imagem PNG, JPG ou WEBP.');
      return;
    }
    if (file.size > 650000) {
      setMessage('A imagem precisa ter até 650 KB para carregar rápido no celular.');
      return;
    }
    const avatarDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
      reader.readAsDataURL(file);
    });
    const updated = await api.request<User>('/users/me/avatar', { method: 'PATCH', body: JSON.stringify({ avatarDataUrl }) });
    onCurrentUserUpdated(updated);
    setCareer({ ...career, profile: { ...career.profile, avatarDataUrl: updated.avatarDataUrl } });
    setMessage('Foto atualizada. Agora o craque tem figurinha oficial.');
  }

  return <div className="grid two"><section className="card compact"><div className="card-head"><h2>Perfil do atleta</h2><select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></div>{message && <p className="muted">{message}</p>}{career && <><div className="career-hero"><div className="profile-pill big">{career.profile.avatarDataUrl ? <img src={career.profile.avatarDataUrl} alt="Avatar" /> : <span>{career.profile.name.slice(0, 1)}</span>}<div><strong>{career.profile.name}</strong><small>{career.profile.role} • {career.profile.position}</small></div></div><strong>{career.totals.seasonsPlayed} temporada(s)</strong></div>{selectedUserId === currentUserId && <div className="avatar-tools"><label className="ghost"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void saveAvatar(event.target.files?.[0])} />Trocar foto</label><button className="ghost" onClick={() => void saveAvatar(null)}>Remover foto</button></div>}<div className="stat-grid"><span><b>{career.totals.totalPoints}</b> pontos</span><span><b>{career.totals.presences}</b> presenças</span><span><b>{career.totals.goals}</b> gols</span><span><b>{career.totals.assists}</b> assist.</span><span><b>{career.totals.wins}</b> vitórias</span><span><b>{career.totals.yellowCards + career.totals.redCards + career.totals.blueCards}</b> cartões</span></div><h2>Títulos e badges</h2><div className="chips">{career.awards.length === 0 ? <span className="muted">Nenhum prêmio registrado ainda.</span> : career.awards.map((award) => <span className="chip trophy" key={award.id}>{award.label} • {award.year}</span>)}</div><div className="chips">{career.badges.map((badge) => <span className="chip" key={badge.id}>{badge.label}</span>)}</div></>}</section><section className="card compact"><h2>Histórico por temporada</h2><div className="table-cards">{career?.seasons.map((season) => <article className="row-card" key={season.seasonId}><strong>{season.seasonName} • {season.year}</strong><span>{season.totalPoints} pts</span><small>Pres. {season.presences} • V {season.wins} • E {season.draws} • D {season.losses} • G {season.goals} • A {season.assists}</small></article>)}</div></section></div>;
}

function MatchesPanel({ api, canCoordinate, users, matches, activeSeasonId, onReload, selectedMatch, setSelectedMatch }: { api: ApiClient; canCoordinate: boolean; users: User[]; matches: MatchListItem[]; activeSeasonId: string; onReload: () => Promise<void>; selectedMatch: MatchDetail | null; setSelectedMatch: (match: MatchDetail | null) => void }) {
  const [clockRunning, setClockRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!clockRunning) return;
    const timer = window.setInterval(() => setSeconds((value) => Math.min(value + 1, 3600)), 1000);
    return () => window.clearInterval(timer);
  }, [clockRunning]);

  useEffect(() => {
    if (!selectedMatch) return;
    if (selectedMatch.status === 'RUNNING' && selectedMatch.startedAt) {
      setSeconds(Math.min(3600, Math.max(0, Math.floor((Date.now() - new Date(selectedMatch.startedAt).getTime()) / 1000))));
      setClockRunning(true);
      return;
    }
    if (selectedMatch.status !== 'RUNNING') setClockRunning(false);
  }, [selectedMatch?.id, selectedMatch?.status, selectedMatch?.startedAt]);

  async function openMatch(id: string) {
    setSelectedMatch(await api.request<MatchDetail>(`/matches/${id}`));
    setSeconds(0);
    setClockRunning(false);
  }

  async function startSelectedMatch() {
    if (!selectedMatch) return;
    await api.request(`/matches/${selectedMatch.id}/start`, { method: 'POST' });
    await openMatch(selectedMatch.id);
    setClockRunning(true);
    await onReload();
  }

  async function cancelSelectedMatch() {
    if (!selectedMatch || !window.confirm('Cancelar esta súmula? Ela sai do fluxo operacional e não pontua a temporada.')) return;
    await api.request(`/matches/${selectedMatch.id}/cancel`, { method: 'POST' });
    await openMatch(selectedMatch.id);
    await onReload();
  }

  return (
    <div className="grid two">
      <section className="card compact">
        <div className="card-head"><h2>Súmulas</h2>{canCoordinate && <OperationalMatchDialog api={api} users={users} activeSeasonId={activeSeasonId} onDone={onReload} />}</div>
        <div className="table-cards">
          {matches.map((match) => <button className="row-card as-button" key={match.id} onClick={() => openMatch(match.id)}><strong>{match.title}</strong><span>{match.teamAScore} x {match.teamBScore}</span><small>{match.teamAName} × {match.teamBName} • {match.status}</small></button>)}
        </div>
      </section>
      <section className="card compact">
        <h2>Cronômetro</h2>
        {!selectedMatch ? <p className="muted">Abra uma súmula para operar o jogo.</p> : <>
          <div className="scoreboard"><b>{selectedMatch.teamAName}</b><strong>{selectedMatch.teamAScore} x {selectedMatch.teamBScore}</strong><b>{selectedMatch.teamBName}</b></div>
          <div className="clock">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</div>
          <div className="actions"><button className="primary" onClick={() => setClockRunning((value) => !value)}>{clockRunning ? 'Pausar' : 'Iniciar cronômetro'}</button><button className="ghost" onClick={() => setSeconds(0)}>Zerar</button>{canCoordinate && selectedMatch.status === 'DRAFT' && <button className="primary" onClick={() => void startSelectedMatch()}>Iniciar súmula oficial</button>}{canCoordinate && ['DRAFT', 'RUNNING', 'SUBMITTED'].includes(selectedMatch.status) && <button className="ghost danger-action" onClick={() => void cancelSelectedMatch()}>Cancelar súmula</button>}</div>
          <SubstitutionManager rotation={selectedMatch.rotation} currentMinute={Math.floor(seconds / 60)} />
          <div className="chips">{selectedMatch.events.map((event, index) => <span className="chip" key={index}>{event.minute}' {eventLabel(event.eventType)}</span>)}</div>
          {canCoordinate && selectedMatch.status !== 'CANCELLED' && <MatchScoreEditor api={api} match={selectedMatch} users={users} onSaved={async () => { await openMatch(selectedMatch.id); await onReload(); }} />}
          <CorrectionHistory corrections={selectedMatch.corrections ?? []} />
        </>}
      </section>
    </div>
  );
}

function SubstitutionManager({ rotation, currentMinute }: { rotation: MatchDetail['rotation']; currentMinute: number }) {
  return <div className="rotation-grid">{(['A', 'B'] as const).map((team) => {
    const schedule = rotation[team].schedule;
    const next = schedule.find((item) => item.minute >= currentMinute);
    const last = [...schedule].reverse().find((item) => item.minute < currentMinute);
    return <div key={team} className="rotation"><strong>Trocas time {team}</strong>{next ? <div className={`next-sub ${next.minute <= currentMinute ? 'due' : ''}`}><b>{next.minute <= currentMinute ? 'Troca agora' : `Próxima aos ${next.minute}'`}</b><span>Entram: {next.entering.join(', ') || '—'}</span><span>Saem: {next.leaving.join(', ') || '—'}</span></div> : <div className="next-sub done"><b>Roteiro concluído</b><span>Última troca: {last ? `${last.minute}'` : 'nenhuma'}</span></div>}{schedule.map((item) => <span className={item.minute < currentMinute ? 'done' : item.minute === currentMinute ? 'due' : ''} key={`${team}-${item.minute}-${item.label}`}>{item.minute}' • {item.label} • entram {item.entering.join(', ')} • saem {item.leaving.join(', ')}</span>)}</div>;
  })}</div>;
}

function MatchScoreEditor({ api, match, users, onSaved }: { api: ApiClient; match: MatchDetail; users: User[]; onSaved: () => Promise<void> }) {
  const [teamAScore, setTeamAScore] = useState(match.teamAScore);
  const [teamBScore, setTeamBScore] = useState(match.teamBScore);
  const [events, setEvents] = useState<MatchEventDraft[]>(match.events.map((event) => ({ userId: event.userId, relatedUserId: event.relatedUserId, eventType: event.eventType as MatchEventDraft['eventType'], minute: event.minute, team: event.team })));
  const [userId, setUserId] = useState(match.players[0]?.userId ?? users[0]?.id ?? '');
  const [relatedUserId, setRelatedUserId] = useState('');
  const [eventType, setEventType] = useState<MatchEventDraft['eventType']>('GOL');
  const [minute, setMinute] = useState(0);
  const [team, setTeam] = useState<'A' | 'B'>('A');
  const [correctionReason, setCorrectionReason] = useState('');

  useEffect(() => {
    setTeamAScore(match.teamAScore);
    setTeamBScore(match.teamBScore);
    setEvents(match.events.map((event) => ({ userId: event.userId, relatedUserId: event.relatedUserId, eventType: event.eventType as MatchEventDraft['eventType'], minute: event.minute, team: event.team })));
    setUserId(match.players[0]?.userId ?? users[0]?.id ?? '');
    setCorrectionReason('');
  }, [match.id]);

  function addEvent() {
    if (!userId) return;
    const selectedPlayer = match.players.find((player) => player.userId === userId);
    if (!selectedPlayer || selectedPlayer.team === 'PRESENTE_SEM_JOGAR') return;
    const eventTeam = selectedPlayer.team === 'A' ? 'A' : 'B';
    setEvents((list) => [...list, { userId, relatedUserId: relatedUserId || null, eventType, minute, team: eventTeam }]);
  }

  async function submit() {
    const path = match.status === 'CONFIRMED' ? `/matches/${match.id}/correct` : `/matches/${match.id}/submit`;
    await api.request(path, { method: 'POST', body: JSON.stringify(match.status === 'CONFIRMED' ? { teamAScore, teamBScore, events, reason: correctionReason } : { teamAScore, teamBScore, events }) });
    await onSaved();
  }

  async function confirm() {
    await api.request(`/matches/${match.id}/confirm`, { method: 'POST' });
    await onSaved();
  }

  return <div className="score-editor"><strong>{match.status === 'CONFIRMED' ? 'Correção auditada da súmula' : 'Fechamento da súmula'}</strong><div className="score-inputs"><input type="number" min="0" value={teamAScore} onChange={(event) => setTeamAScore(Number(event.target.value))} /><span>x</span><input type="number" min="0" value={teamBScore} onChange={(event) => setTeamBScore(Number(event.target.value))} /></div>{match.status === 'CONFIRMED' && <input value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Motivo da correção: gol/assistência/cartão lançado errado" required minLength={5} />}<div className="event-form"><select value={eventType} onChange={(event) => setEventType(event.target.value as MatchEventDraft['eventType'])}><option value="GOL">Gol</option><option value="GOL_CONTRA">Gol contra</option><option value="ASSISTENCIA">Assistência</option><option value="CARTAO_AMARELO">Cartão amarelo</option><option value="CARTAO_VERMELHO">Cartão vermelho</option><option value="CARTAO_AZUL">Cartão azul</option></select><select value={userId} onChange={(event) => setUserId(event.target.value)}>{match.players.map((player) => <option key={player.userId} value={player.userId}>{player.name}</option>)}</select><select value={relatedUserId} onChange={(event) => setRelatedUserId(event.target.value)}><option value="">Sem relacionado</option>{match.players.map((player) => <option key={player.userId} value={player.userId}>{player.name}</option>)}</select><input type="number" min="0" max="180" value={minute} onChange={(event) => setMinute(Number(event.target.value))} /><select value={team} onChange={(event) => setTeam(event.target.value as 'A' | 'B')}><option value="A">Time A</option><option value="B">Time B</option></select><button type="button" className="ghost" onClick={addEvent}>Adicionar</button></div><div className="chips">{events.map((item, index) => <button className="chip" key={`${item.userId}-${item.eventType}-${index}`} onClick={() => setEvents((list) => list.filter((_, itemIndex) => itemIndex !== index))}>{item.minute}' {eventLabel(item.eventType)}</button>)}</div><div className="actions"><button className="primary" onClick={submit} disabled={match.status === 'CONFIRMED' && correctionReason.trim().length < 5}>{match.status === 'CONFIRMED' ? 'Salvar correção' : 'Submeter'}</button>{match.status === 'SUBMITTED' && <button className="ghost" onClick={confirm}>Confirmar e pontuar</button>}</div></div>;
}

function CorrectionHistory({ corrections }: { corrections: MatchCorrection[] }) {
  if (!corrections.length) return <div className="empty-state"><strong>Sem correções auditadas</strong><span>Depois de confirmada, qualquer ajuste de placar/eventos aparece aqui com motivo, responsável e data.</span></div>;
  return <div className="audit-box"><strong>Histórico de correções</strong>{corrections.map((item) => <article className="row-card" key={item.id}><strong>{item.previousTeamAScore} x {item.previousTeamBScore} → {item.newTeamAScore} x {item.newTeamBScore}</strong><span>{item.correctedByName}</span><small>{new Date(item.createdAt).toLocaleString('pt-BR')} • {item.reason}</small><small>Eventos: {item.previousEvents.length} → {item.newEvents.length}</small></article>)}</div>;
}

function OperationalMatchDialog({ api, users, activeSeasonId, onDone }: { api: ApiClient; users: User[]; activeSeasonId: string; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('Futebol de quarta');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [teamAName, setTeamAName] = useState('Time A');
  const [teamBName, setTeamBName] = useState('Time B');
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState<MatchDraftPlayer[]>([]);
  const [draggedUserId, setDraggedUserId] = useState('');

  const assignedIds = new Set(players.map((player) => player.userId));
  const search = query.trim().toLowerCase();
  const searchResults = search.length < 3 ? [] : users.filter((user) => !assignedIds.has(user.id) && `${user.name} ${user.email}`.toLowerCase().includes(search)).slice(0, 8);
  const teamA = players.filter((player) => player.team === 'A');
  const teamB = players.filter((player) => player.team === 'B');
  const presentOnly = players.filter((player) => player.team === 'PRESENTE_SEM_JOGAR');

  function addPlayer(user: User, team: MatchDraftPlayer['team']) {
    setPlayers((list) => [...list, { userId: user.id, name: user.name, email: user.email, team, roleInMatch: team === 'PRESENTE_SEM_JOGAR' ? 'PRESENTE_SEM_JOGAR' : user.position === 'GOLEIRO' ? 'GOLEIRO' : 'LINHA', drawOrder: String(list.length + 1), startsOnBench: false }]);
    setQuery('');
  }

  function updatePlayer(userId: string, patch: Partial<MatchDraftPlayer>) {
    setPlayers((list) => list.map((player) => player.userId === userId ? { ...player, ...patch } : player));
  }

  function removePlayer(userId: string) {
    setPlayers((list) => list.filter((player) => player.userId !== userId));
  }

  function movePlayer(userId: string, targetUserId: string, team: 'A' | 'B') {
    if (!userId || userId === targetUserId) return;
    setPlayers((list) => {
      const moving = list.find((player) => player.userId === userId);
      if (!moving) return list;
      const withoutMoving = list.filter((player) => player.userId !== userId);
      const sameTeam = withoutMoving.filter((player) => player.team === team);
      const targetIndex = sameTeam.findIndex((player) => player.userId === targetUserId);
      const orderedTeam = [...sameTeam.slice(0, targetIndex), { ...moving, team }, ...sameTeam.slice(targetIndex)];
      return withoutMoving.filter((player) => player.team !== team).concat(orderedTeam);
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const selected = players.map((player) => ({
      userId: player.userId,
      team: player.team,
      roleInMatch: player.team === 'PRESENTE_SEM_JOGAR' ? 'PRESENTE_SEM_JOGAR' : player.roleInMatch,
      drawOrder: player.drawOrder ? Number(player.drawOrder) : null,
      rotationOrder: player.team === 'A' ? teamA.findIndex((item) => item.userId === player.userId) + 1 : player.team === 'B' ? teamB.findIndex((item) => item.userId === player.userId) + 1 : null,
      startsOnBench: player.startsOnBench,
      present: true
    }));
    await api.request('/matches', { method: 'POST', body: JSON.stringify({ seasonId: activeSeasonId || null, matchDate: date, title, teamAName, teamBName, players: selected }) });
    setOpen(false);
    setPlayers([]);
    await onDone();
  }

  function TeamList({ team, rows }: { team: 'A' | 'B'; rows: MatchDraftPlayer[] }) {
    return <div className="team-list"><strong>{team === 'A' ? teamAName : teamBName} • sequência de troca</strong>{rows.length === 0 ? <small className="muted">Busque atleta e clique em {team === 'A' ? 'Time A' : 'Time B'}.</small> : rows.map((player, index) => <div className="team-player" key={player.userId} draggable onDragStart={() => setDraggedUserId(player.userId)} onDragOver={(event) => event.preventDefault()} onDrop={() => movePlayer(draggedUserId, player.userId, team)}><span className="drag-handle">↕ {index + 1}</span><b>{player.name}</b><select value={player.roleInMatch} onChange={(event) => updatePlayer(player.userId, { roleInMatch: event.target.value as MatchDraftPlayer['roleInMatch'] })}><option value="LINHA">Linha</option><option value="GOLEIRO">Goleiro</option></select><label className="bench"><input type="checkbox" checked={player.startsOnBench} onChange={(event) => updatePlayer(player.userId, { startsOnBench: event.target.checked })} /> Banco</label><button type="button" className="ghost" onClick={() => removePlayer(player.userId)}>Remover</button></div>)}</div>;
  }

  return <><button className="primary small" onClick={() => setOpen(true)}>Nova</button>{open && <div className="modal"><form className="card modal-card wide" onSubmit={submit}><div className="card-head"><h2>Nova súmula</h2><button type="button" className="ghost" onClick={() => setOpen(false)}>Fechar</button></div><div className="match-meta"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Título" /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /><input value={teamAName} onChange={(event) => setTeamAName(event.target.value)} /><input value={teamBName} onChange={(event) => setTeamBName(event.target.value)} /></div><div className="team-builder"><section><h2>Buscar atleta</h2><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite 3 letras do nome ou e-mail" />{query.trim().length > 0 && query.trim().length < 3 && <p className="muted">Digite pelo menos 3 caracteres.</p>}<div className="search-results">{searchResults.map((user) => <article key={user.id}><strong>{user.name}</strong><small>{user.email}</small><div className="actions"><button type="button" className="primary small" onClick={() => addPlayer(user, 'A')}>Time A</button><button type="button" className="primary small" onClick={() => addPlayer(user, 'B')}>Time B</button><button type="button" className="ghost" onClick={() => addPlayer(user, 'PRESENTE_SEM_JOGAR')}>Presente</button></div></article>)}</div><div className="team-list"><strong>Presentes sem jogar</strong>{presentOnly.length === 0 ? <small className="muted">Use para quem pagou presença, mas não entrou em campo.</small> : presentOnly.map((player) => <div className="team-player compact-line" key={player.userId}><b>{player.name}</b><button type="button" className="ghost" onClick={() => removePlayer(player.userId)}>Remover</button></div>)}</div></section><section className="team-board"><TeamList team="A" rows={teamA} /><TeamList team="B" rows={teamB} /></section></div><button className="primary" disabled={!teamA.length || !teamB.length}>Criar súmula</button></form></div>}</>;
}

function PaymentsPanel({ api, canCoordinate, users, activeSeasonId }: { api: ApiClient; canCoordinate: boolean; users: User[]; activeSeasonId: string }) {
  const [userId, setUserId] = useState(users[0]?.id ?? '');
  const [amount, setAmount] = useState('0');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7) + '-01');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<PaymentRecord['status']>('PAID');
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!userId && users[0]?.id) setUserId(users[0].id);
  }, [users, userId]);

  async function loadPayments() {
    const path = canCoordinate ? `/payments${activeSeasonId ? `?seasonId=${activeSeasonId}` : ''}` : '/payments/me';
    setPayments(await api.request<PaymentRecord[]>(path));
  }

  useEffect(() => {
    void loadPayments().catch((err) => setMessage(err instanceof Error ? err.message : 'Falha ao carregar mensalidades.'));
  }, [activeSeasonId, canCoordinate]);

  async function save() {
    const saved = await api.request<PaymentRecord>('/payments', { method: 'PUT', body: JSON.stringify({ userId, seasonId: activeSeasonId || null, referenceMonth: month, dueDate, amountCents: Math.round(Number(amount) * 100), status, paidAt: status === 'PAID' ? new Date(`${paidAt}T12:00:00`).toISOString() : null }) });
    setMessage(saved.earnsPoint ? 'Pagamento antecipado registrado: +1 ponto na temporada.' : 'Mensalidade registrada sem ponto antecipado.');
    await loadPayments();
  }

  return <section className="card compact"><h2>Mensalidades</h2>{canCoordinate ? <div className="inline-form"><select value={userId} onChange={(event) => setUserId(event.target.value)}>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select><input type="month" value={month.slice(0, 7)} onChange={(event) => setMonth(`${event.target.value}-01`)} /><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} title="Data de vencimento" /><input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} title="Data de pagamento" /><input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Valor" /><select value={status} onChange={(event) => setStatus(event.target.value as PaymentRecord['status'])}><option value="PAID">Pago</option><option value="PENDING">Pendente</option><option value="LATE">Atrasado</option><option value="WAIVED">Isento</option></select><button className="primary" onClick={save}>Salvar</button></div> : <p className="muted">Você visualiza apenas sua mensalidade e se ela gerou ponto por pagamento antecipado.</p>}{message && <p className="muted">{message}</p>}<div className="table-cards">{payments.map((payment) => <article className="row-card" key={`${payment.userId ?? 'me'}-${payment.referenceMonth}`}><strong>{payment.userName ?? 'Minha mensalidade'} • {payment.referenceMonth.slice(0, 7)}</strong><span>{payment.earnsPoint ? '+1 pt' : payment.status}</span><small>Venc. {payment.dueDate?.slice(0, 10)} • Pago {payment.paidAt ? payment.paidAt.slice(0, 10) : 'não informado'} • R$ {(payment.amountCents / 100).toFixed(2)}</small></article>)}</div></section>;
}

function AwardsPanel({ api, users, activeSeason, isAdmin }: { api: ApiClient; users: User[]; activeSeason?: Season; isAdmin: boolean }) {
  const [category, setCategory] = useState('CRAQUE_GALERA');
  const [votedUserId, setVotedUserId] = useState(users[0]?.id ?? '');
  const [categories, setCategories] = useState<AwardCategory[]>([]);
  const [myVotes, setMyVotes] = useState<MyVote[]>([]);
  const [results, setResults] = useState<AwardResult[]>([]);
  const [message, setMessage] = useState('');

  async function loadCategories() {
    const data = await api.request<AwardCategory[]>('/awards/categories');
    setCategories(data);
    if (!data.some((item) => item.code === category) && data[0]) setCategory(data[0].code);
  }

  async function loadMyVotes() {
    if (!activeSeason) return;
    setMyVotes(await api.request<MyVote[]>(`/awards/my-votes/${activeSeason.id}`));
  }

  async function loadResults() {
    if (!activeSeason || !isAdmin) return;
    setResults(await api.request<AwardResult[]>(`/awards/results/${activeSeason.id}`));
  }

  useEffect(() => {
    void loadCategories().catch((err) => setMessage(err instanceof Error ? err.message : 'Falha ao carregar categorias.'));
  }, []);

  useEffect(() => {
    if (!votedUserId && users[0]?.id) setVotedUserId(users[0].id);
  }, [users, votedUserId]);

  useEffect(() => {
    void loadMyVotes().catch((err) => setMessage(err instanceof Error ? err.message : 'Falha ao carregar seus votos.'));
    void loadResults().catch((err) => setMessage(err instanceof Error ? err.message : 'Falha ao carregar resultados.'));
  }, [activeSeason?.id, isAdmin]);

  async function vote() {
    if (!activeSeason) return;
    await api.request('/awards/vote', { method: 'POST', body: JSON.stringify({ seasonId: activeSeason.id, categoryCode: category, votedUserId }) });
    setMessage('Voto registrado com sigilo. Resultado visível apenas ao ADMIN.');
    await loadMyVotes();
    await loadResults();
  }

  async function consolidate() {
    if (!activeSeason) return;
    await api.request(`/awards/consolidate/${activeSeason.id}`, { method: 'POST' });
    setMessage('Vencedores consolidados: prêmios gravados no histórico e badges dos atletas.');
    await loadResults();
  }

  const groupedResults = results.reduce<Record<string, AwardResult[]>>((acc, item) => {
    acc[item.label] = [...(acc[item.label] ?? []), item];
    return acc;
  }, {});
  const voteMap = new Map(myVotes.map((item) => [item.categoryCode, users.find((user) => user.id === item.votedUserId)?.name ?? 'Atleta removido']));

  return <div className="grid two"><section className="card compact"><h2>Votação dos prêmios</h2><p className="muted">Escolha com carinho. O voto é sigiloso; a resenha fica para depois.</p><div className="inline-form"><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select><select value={votedUserId} onChange={(event) => setVotedUserId(event.target.value)}>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select><button className="primary" onClick={vote} disabled={!activeSeason || activeSeason.status !== 'CLOSED' || !categories.length}>Votar</button></div>{activeSeason?.status !== 'CLOSED' && <p className="muted">A votação abre quando a temporada for encerrada.</p>}{message && <p className="muted">{message}</p>}<div className="chips">{categories.map((item) => <span className="chip" key={item.code}>{item.label}: {voteMap.get(item.code) ?? 'sem voto'}</span>)}</div><div className="award-cards"><article><strong>🏆 Ranking automático</strong><span>Campeão, vice, terceiro, artilheiro, garçom e assiduidade geram prêmios e badges no fechamento.</span></article><article><strong>🗳️ Voto dos atletas</strong><span>Categorias vêm do banco; consolidar grava prêmio e badge histórico para cada vencedor.</span></article></div></section><section className="card compact"><div className="card-head"><h2>Apuração ADMIN</h2>{isAdmin && activeSeason && <button className="primary small" onClick={consolidate}>Consolidar</button>}</div>{!isAdmin ? <EmptyState title="Resultado sigiloso" text="A apuração fica protegida e só aparece para ADMIN." /> : Object.keys(groupedResults).length === 0 ? <EmptyState title="Sem votos ainda" text="Quando os atletas votarem, a liderança de cada categoria aparece aqui." /> : <div className="table-cards">{Object.entries(groupedResults).map(([label, rows]) => <article className="row-card" key={label}><strong>{label}</strong><span>{rows[0]?.name}</span><small>{rows.slice(0, 3).map((row) => `${row.name}: ${row.votes}`).join(' • ')}</small></article>)}</div>}</section></div>;
}

function normalizeHeader(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function readNumber(value: string | undefined): number {
  const normalized = (value ?? '0').replace(/\./g, '').replace(',', '.').trim();
  const parsed = Number(normalized || 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function parseStandingClipboard(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(delimiter).map(normalizeHeader);
  const pick = (cells: string[], aliases: string[]) => {
    const index = headers.findIndex((header) => aliases.includes(header));
    return index >= 0 ? cells[index]?.trim() : undefined;
  };
  return lines.slice(1).map((line) => {
    const cells = line.split(delimiter);
    return {
      name: pick(cells, ['nome', 'atleta', 'jogador']),
      email: pick(cells, ['email', 'e-mail']),
      totalPoints: readNumber(pick(cells, ['pontos', 'pts', 'total', 'totalpontos'])),
      gamesPlayed: readNumber(pick(cells, ['jogos', 'jogo', 'j'])),
      presences: readNumber(pick(cells, ['presencas', 'presenca', 'pres'])),
      wins: readNumber(pick(cells, ['v', 'vit', 'vitorias'])),
      draws: readNumber(pick(cells, ['e', 'empates'])),
      losses: readNumber(pick(cells, ['d', 'derrotas'])),
      paidMonths: readNumber(pick(cells, ['mensalidades', 'mesespagos', 'pagas', 'pagamentos'])),
      goals: readNumber(pick(cells, ['gols', 'gol', 'g'])),
      ownGoals: readNumber(pick(cells, ['golscontra', 'golcontra', 'contra', 'gc'])),
      assists: readNumber(pick(cells, ['assistencias', 'assistencia', 'assist', 'a'])),
      yellowCards: readNumber(pick(cells, ['amarelos', 'amarelo', 'ca'])),
      redCards: readNumber(pick(cells, ['vermelhos', 'vermelho', 'cv'])),
      blueCards: readNumber(pick(cells, ['azuis', 'azul'])),
      teamGoalsFor: readNumber(pick(cells, ['marcados', 'golsdaequipe', 'golspro', 'pro'])),
      teamGoalsAgainst: readNumber(pick(cells, ['sofridos', 'golssofridos', 'contraequipe']))
    };
  }).filter((row) => row.email || row.name);
}

function AdminPanel({ api, users, seasons, points, activeSeasonId, onReload, isAdmin }: { api: ApiClient; users: User[]; seasons: Season[]; points: PointSetting[]; activeSeasonId: string; onReload: () => Promise<void>; isAdmin: boolean }) {
  const [draftPoints, setDraftPoints] = useState(points);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'COORDENADOR' | 'ATLETA'>('ATLETA');
  const [message, setMessage] = useState('');
  const [standingPaste, setStandingPaste] = useState('');
  const [importResult, setImportResult] = useState<StandingImportResult | null>(null);
  const [seasonName, setSeasonName] = useState('Temporada 2026');
  const [seasonYear, setSeasonYear] = useState(2026);
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');

  useEffect(() => setDraftPoints(points), [points]);

  async function savePoints() {
    await api.request('/settings/points', { method: 'PUT', body: JSON.stringify({ settings: draftPoints.map(({ code, points }) => ({ code, points })) }) });
    await onReload();
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    const payload = await api.request<{ activationEmailSent?: boolean }>('/users', { method: 'POST', body: JSON.stringify({ name, email, password: password || undefined, role: isAdmin ? role : 'ATLETA', position: 'LINHA' }) });
    setMessage(password ? 'Usuário criado com senha inicial definida.' : payload.activationEmailSent ? 'Usuário criado e convite de ativação enviado por e-mail.' : 'Usuário criado. O Graph não confirmou envio; use recuperação de senha se necessário.');
    setName(''); setEmail(''); setPassword('');
    await onReload();
  }

  async function createSeason(event: FormEvent) {
    event.preventDefault();
    await api.request('/seasons', { method: 'POST', body: JSON.stringify({ name: seasonName, year: seasonYear, startsOn: startsOn || null, endsOn: endsOn || null }) });
    setMessage('Temporada criada. Inicie quando estiver pronto para receber súmulas oficiais.');
    await onReload();
  }

  async function startSeason(id: string) {
    await api.request(`/seasons/${id}/start`, { method: 'POST' });
    setMessage('Temporada iniciada. Ela agora aceita súmulas oficiais.');
    await onReload();
  }

  async function closeSeason(id: string) {
    await api.request(`/seasons/${id}/close`, { method: 'POST' });
    setMessage('Temporada encerrada. Rankings automáticos foram consolidados e votação liberada.');
    await onReload();
  }

  async function importStandings() {
    const rows = parseStandingClipboard(standingPaste);
    if (!rows.length) {
      setMessage('Cole a tabela do Excel com cabeçalho antes de importar.');
      return;
    }
    const result = await api.request<StandingImportResult>(`/seasons/${activeSeasonId}/standing-adjustments/import`, { method: 'POST', body: JSON.stringify({ replace: true, rows }) });
    setImportResult(result);
    setMessage(`${result.imported.length} atleta(s) importado(s). ${result.skipped.length} linha(s) exigem revisão.`);
    await onReload();
  }

  return <div className="grid two"><section className="card compact"><h2>Temporadas</h2><form className="inline-form" onSubmit={createSeason}><input value={seasonName} onChange={(event) => setSeasonName(event.target.value)} placeholder="Nome da temporada" required /><input type="number" value={seasonYear} onChange={(event) => setSeasonYear(Number(event.target.value))} min="2000" max="2100" /><input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /><input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /><button className="primary">Criar temporada</button></form><div className="table-cards">{seasons.map((season) => <article className="row-card" key={season.id}><strong>{season.name} • {season.year}</strong><span className={`status ${season.status.toLowerCase()}`}>{season.status}</span><small>{season.startsOn?.slice(0, 10) ?? 'sem início'} até {season.endsOn?.slice(0, 10) ?? 'sem fim'}</small><div className="actions">{season.status !== 'OPEN' && season.status !== 'CLOSED' && <button className="primary small" onClick={() => void startSeason(season.id)}>Iniciar</button>}{season.status === 'OPEN' && <button className="ghost" onClick={() => void closeSeason(season.id)}>Encerrar e liberar votação</button>}</div></article>)}</div></section><section className="card compact"><h2>Pontuação configurável</h2>{draftPoints.map((item, index) => <label className="field-row" key={item.code}><span>{item.label}</span><input type="number" value={item.points} onChange={(event) => setDraftPoints((list) => list.map((current, currentIndex) => currentIndex === index ? { ...current, points: Number(event.target.value) } : current))} /></label>)}<button className="primary" onClick={savePoints}>Salvar pontuação</button>{message && <p className="muted">{message}</p>}</section><section className="card compact"><h2>Usuários</h2><form className="inline-form" onSubmit={createUser}><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome" required /><input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-mail" type="email" required /><input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha inicial opcional" type="password" minLength={8} />{isAdmin ? <select value={role} onChange={(event) => setRole(event.target.value as 'ADMIN' | 'COORDENADOR' | 'ATLETA')}><option>ATLETA</option><option>COORDENADOR</option><option>ADMIN</option></select> : <span className="status">Novo usuário será ATLETA</span>}<button className="primary">Criar/enviar convite</button></form><div className="table-cards">{users.map((user) => <UserAdminRow key={user.id} api={api} user={user} isAdmin={isAdmin} onReload={onReload} />)}</div></section><section className="card compact"><div className="card-head"><h2>Importar tabela atual do Excel</h2><button className="primary small" onClick={importStandings} disabled={!activeSeasonId}>Importar saldo</button></div><p className="muted">Cole do Excel com cabeçalho. Use e-mail para casar atletas com segurança.</p><textarea className="paste-box" value={standingPaste} onChange={(event) => setStandingPaste(event.target.value)} placeholder="nome\temail\tpontos\tjogos\tpresenças\tv\te\td\tgols\tgols contra\tassistências\tmarcados\tsofridos" />{importResult && <div className="chips"><span className="chip trophy">Importados: {importResult.imported.length}</span>{importResult.skipped.map((item) => <span className="chip danger" key={`${item.identifier}-${item.reason}`}>{item.identifier}: {item.reason}</span>)}</div>}</section></div>;
}

function UserAdminRow({ api, user, isAdmin, onReload }: { api: ApiClient; user: User; isAdmin: boolean; onReload: () => Promise<void> }) {
  const [role, setRole] = useState<User['role']>(user.role);
  const [position, setPosition] = useState<'GOLEIRO' | 'LINHA'>(user.position ?? 'LINHA');
  const [active, setActive] = useState(user.active !== false);

  useEffect(() => {
    setRole(user.role);
    setPosition(user.position ?? 'LINHA');
    setActive(user.active !== false);
  }, [user.id, user.role, user.position, user.active]);

  async function save() {
    await api.request(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ role, position, active }) });
    await onReload();
  }

  return <article className="row-card"><strong>{user.name}</strong><span>{active ? 'ativo' : 'inativo'}</span><small>{user.email}</small>{isAdmin ? <div className="inline-form"><select value={role} onChange={(event) => setRole(event.target.value as User['role'])}><option>ATLETA</option><option>COORDENADOR</option><option>ADMIN</option></select><select value={position} onChange={(event) => setPosition(event.target.value as 'GOLEIRO' | 'LINHA')}><option>LINHA</option><option>GOLEIRO</option></select><select value={active ? 'true' : 'false'} onChange={(event) => setActive(event.target.value === 'true')}><option value="true">Ativo</option><option value="false">Inativo</option></select><button className="ghost" onClick={save}>Salvar</button></div> : <small>{user.role} • {user.position}</small>}</article>;
}
