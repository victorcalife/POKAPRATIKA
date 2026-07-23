import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from './api';
import { AthletePosition, MatchListItem, PointSetting, Season, Standing, User } from './types';

const logoUrl = '/logo_pokapratika.png';

type View = 'temporada' | 'pagamentos' | 'premios' | 'admin';
type AuthPayload = { token: string; user: User };
type RankingPayload = {
  goals: Array<{ userId: string; name: string; goals: number; ownGoals: number; netGoals: number; gamesPlayed: number; average: string | number }>;
  assists: Array<{ userId: string; name: string; assists: number; gamesPlayed: number; average: string | number }>;
  presence: Array<{ userId: string; name: string; gamesPlayed: number; presences: number; total: number; percentage: string | number }>;
  cards: Array<{ userId: string; name: string; cardPoints: number; totalCards: number; gamesPlayed: number; average: string | number }>;
};
type AwardType = 'RANKING' | 'VOTACAO' | 'SORTEIO' | 'MANUAL';
type MetricCode = 'TOTAL_POINTS' | 'GOALS' | 'ASSISTS' | 'TOTAL_CARDS' | 'CARD_POINTS' | 'ASSIDUITY' | 'PRESENCE_PERCENTAGE' | 'WIN_PERCENTAGE' | 'WINS' | 'TEAM_GOAL_BALANCE' | 'NET_GOALS' | 'PAID_MONTHS';
type Suspension = { id: string; userName: string; reason: string; triggerMatchTitle: string; servedAt?: string | null };
type MatchEventDraft = { userId: string; relatedUserId?: string | null; eventType: 'GOL' | 'GOL_CONTRA' | 'ASSISTENCIA' | 'CARTAO_AMARELO' | 'CARTAO_VERMELHO' | 'CARTAO_AZUL'; minute: number; team?: 'A' | 'B' | null; occurredAt?: string | null; createdAt?: string | null };
type MatchCorrection = { id: string; reason: string; previousTeamAScore: number; previousTeamBScore: number; newTeamAScore: number; newTeamBScore: number; correctedByName: string; createdAt: string; previousEvents: MatchEventDraft[]; newEvents: MatchEventDraft[] };
type CareerProfile = {
  profile: User;
  totals: { totalPoints: number; presences: number; wins: number; draws: number; losses: number; goals: number; assists: number; yellowCards: number; redCards: number; blueCards: number; seasonsPlayed: number };
  seasons: Array<{ seasonId: string; seasonName: string; year: number; status: string; totalPoints: number; presences: number; wins: number; draws: number; losses: number; goals: number; assists: number; yellowCards: number; redCards: number; blueCards: number }>;
  awards: Array<{ id: string; seasonName: string; year: number; categoryCode: string; label: string; placement: number; source: string }>;
  badges: Array<{ id: string; code: string; label: string; icon?: string; color?: string; seasonId?: string | null }>;
  suspensions: Array<{ id: string; seasonName?: string | null; reason: string; servedAt?: string | null }>;
};
type PaymentRecord = { id?: string; userId?: string; userName?: string; referenceMonth: string; dueDate: string; amountCents: number; status: 'PENDING' | 'PAID' | 'LATE' | 'WAIVED'; paidAt?: string | null; earnsPoint: boolean; notes?: string | null };
type PaymentSummary = { totalCents: number; paidCents: number; openCents: number; total: number; paid: number; pending: number; late: number; waived: number; earlyPoints: number };
type AwardCategory = { code: string; label: string; votingEnabled: boolean; awardType?: AwardType; voteSlots?: number; allowSelfVote?: boolean; badgeIcon?: string; badgeColor?: string };
type AwardSetting = AwardCategory & { adminOnly: boolean; active: boolean; awardType: AwardType; metricCode?: MetricCode | null; sortDirection: 'ASC' | 'DESC'; winnersCount: number; minGames: number; voteSlots: number; allowSelfVote: boolean; badgeIcon: string; badgeColor: string };
type MyVote = { categoryCode: string; voteSlot: number; votedUserId: string };
type AwardResult = { categoryCode: string; label: string; voteSlot: number; userId: string; name: string; votes: number };
type AwardLeaderboard = { code: string; label: string; metricCode: MetricCode; sortDirection: 'ASC' | 'DESC'; winnersCount: number; minGames: number; badgeIcon: string; badgeColor: string; rows: Array<{ userId: string; name: string; value: string | number; gamesPlayed: number; totalPoints: number; position: number }> };
type StandingImportResult = { imported: Array<{ name: string; email: string; totalPoints: number }>; skipped: Array<{ identifier: string; reason: string }> };
type MatchDraftPlayer = { userId: string; name: string; email: string; position: AthletePosition; team: 'A' | 'B' | 'PRESENTE_SEM_JOGAR'; roleInMatch: 'GOLEIRO' | 'LINHA' | 'PRESENTE_SEM_JOGAR'; drawOrder: string; startsOnBench: boolean };
type PositionBalanceGroup = 'GO' | 'DEFESA' | 'MEIO' | 'ATAQUE';
type AttendanceStatus = 'JOGAR' | 'PRESENTE_SEM_JOGAR' | 'AUSENTE';
type MatchAttendanceResponse = { userId: string; name: string; position: AthletePosition; avatarDataUrl?: string | null; responseStatus: AttendanceStatus; dinnerConfirmed: boolean; guestCount: number; notes?: string | null; updatedAt: string };
type ScheduleMode = 'manual' | 'recurring';

type MatchDetail = MatchListItem & {
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  availableMinutes?: number;
  draftTeamAScore?: number;
  draftTeamBScore?: number;
  draftEvents?: MatchEventDraft[];
  draftClockSeconds?: number;
  draftClockRunning?: boolean;
  draftSavedAt?: string | null;
  players: Array<{ userId: string; name: string; team: 'A' | 'B' | 'PRESENTE_SEM_JOGAR'; roleInMatch: string; drawOrder?: number | null; rotationOrder?: number | null; startsOnBench: boolean }>;
  events: Array<{ userId: string; relatedUserId?: string | null; eventType: string; minute: number; team?: 'A' | 'B' | null; occurredAt?: string | null; createdAt?: string | null }>;
  corrections: MatchCorrection[];
  attendance: MatchAttendanceResponse[];
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

const weekdayOptions = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
  { value: 6, label: 'Sábado' }
];

const metricOptions: Array<{ value: MetricCode; label: string; hint: string }> = [
  { value: 'TOTAL_POINTS', label: 'Pontuação total', hint: 'Usa a pontuação configurável da temporada' },
  { value: 'GOALS', label: 'Artilharia', hint: 'Soma gols marcados' },
  { value: 'ASSISTS', label: 'Assistências', hint: 'Soma assistências registradas' },
  { value: 'TOTAL_CARDS', label: 'Total de cartões', hint: 'Conta amarelos, azuis e vermelhos' },
  { value: 'CARD_POINTS', label: 'Peso dos cartões', hint: 'Usa o peso configurado por tipo de cartão' },
  { value: 'ASSIDUITY', label: 'Assiduidade', hint: 'Jogos + presença sem jogar' },
  { value: 'PRESENCE_PERCENTAGE', label: '% de presença', hint: 'Presença sobre jogos confirmados' },
  { value: 'WIN_PERCENTAGE', label: '% de aproveitamento', hint: 'Vitória/empate em pontos possíveis' },
  { value: 'WINS', label: 'Vitórias', hint: 'Quantidade de vitórias' },
  { value: 'TEAM_GOAL_BALANCE', label: 'Saldo de equipe', hint: 'Gols pró da equipe menos gols sofridos' },
  { value: 'NET_GOALS', label: 'Gols líquidos', hint: 'Gols marcados menos gols contra' },
  { value: 'PAID_MONTHS', label: 'Mensalidades em dia', hint: 'Pagamentos pontuáveis da temporada' }
];

function metricLabel(metricCode?: string | null): string {
  return metricOptions.find((item) => item.value === metricCode)?.label ?? 'Pontuação total';
}

function awardCodeFromLabel(label: string): string {
  const code = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return code || 'NOVA_REGRA';
}

function positionLabel(position?: AthletePosition | null): string {
  return athletePositionOptions.find((item) => item.value === position)?.label ?? 'MC • Meio campo';
}

function positionBalanceGroup(position: AthletePosition): PositionBalanceGroup {
  if (position === 'GO') return 'GO';
  if (position === 'ZG' || position === 'LD' || position === 'LE') return 'DEFESA';
  if (position === 'MD' || position === 'MC' || position === 'MA') return 'MEIO';
  return 'ATAQUE';
}

function shuffleRows<T>(rows: T[]): T[] {
  return rows.map((row) => ({ row, sort: Math.random() })).sort((left, right) => left.sort - right.sort).map((item) => item.row);
}

function drawBalancedTeams(players: MatchDraftPlayer[]): MatchDraftPlayer[] {
  const playable = players.filter((player) => player.team !== 'PRESENTE_SEM_JOGAR');
  const presentOnly = players.filter((player) => player.team === 'PRESENTE_SEM_JOGAR');
  const teams: Record<'A' | 'B', MatchDraftPlayer[]> = { A: [], B: [] };
  const counts: Record<'A' | 'B', Record<PositionBalanceGroup, number>> = { A: { GO: 0, DEFESA: 0, MEIO: 0, ATAQUE: 0 }, B: { GO: 0, DEFESA: 0, MEIO: 0, ATAQUE: 0 } };

  for (const group of ['GO', 'DEFESA', 'MEIO', 'ATAQUE'] as PositionBalanceGroup[]) {
    for (const player of shuffleRows(playable.filter((item) => positionBalanceGroup(item.position) === group))) {
      const target = counts.A[group] < counts.B[group] ? 'A' : counts.B[group] < counts.A[group] ? 'B' : teams.A.length < teams.B.length ? 'A' : teams.B.length < teams.A.length ? 'B' : Math.random() < 0.5 ? 'A' : 'B';
      teams[target].push({ ...player, team: target });
      counts[target][group] += 1;
    }
  }

  let drawOrder = 1;
  const decorateTeam = (team: 'A' | 'B') => {
    let goalkeepers = 0;
    let linePlayers = 0;
    return teams[team].map((player) => {
      const goalkeeper = player.position === 'GO' && goalkeepers === 0;
      const roleInMatch: MatchDraftPlayer['roleInMatch'] = goalkeeper ? 'GOLEIRO' : 'LINHA';
      if (goalkeeper) goalkeepers += 1;
      const startsOnBench = roleInMatch === 'LINHA' && linePlayers >= 6;
      if (roleInMatch === 'LINHA') linePlayers += 1;
      return { ...player, roleInMatch, startsOnBench, drawOrder: String(drawOrder++) };
    });
  };

  return [
    ...decorateTeam('A'),
    ...decorateTeam('B'),
    ...presentOnly.map((player) => ({ ...player, roleInMatch: 'PRESENTE_SEM_JOGAR' as const, startsOnBench: false, drawOrder: String(drawOrder++) }))
  ];
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

function formatBrasiliaTime(value?: string | null): string {
  if (!value) return 'não iniciado';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
}

function formatBrasiliaClock(value?: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}

function todayInputValue(): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function addDaysInput(days: number): string {
  const date = new Date(`${todayInputValue()}T12:00:00-03:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function matchDateLabel(match: MatchListItem): string {
  const date = match.matchDate?.slice(0, 10) ?? 'sem data';
  const start = match.scheduledStart?.slice(0, 5) ?? '20:00';
  const end = match.scheduledEnd?.slice(0, 5) ?? '21:00';
    return `${date} • ${start}-${end}`;
}

function isMatchToday(match: MatchListItem): boolean {
  return match.matchDate?.slice(0, 10) === todayInputValue();
}

function downloadCsv(filename: string, rows: Array<Record<string, string | number | boolean | null | undefined>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (value: string | number | boolean | null | undefined) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.join(';'), ...rows.map((row) => headers.map((header) => escape(row[header])).join(';'))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [awardSettingsOpen, setAwardSettingsOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (!auth || !activeSeasonId) return;
    const timer = window.setInterval(() => {
      api.request<MatchListItem[]>(`/matches?seasonId=${activeSeasonId}`)
        .then(setMatches)
        .catch(() => undefined);
    }, 60000);
    return () => window.clearInterval(timer);
  }, [api, auth?.token, activeSeasonId]);

  useEffect(() => {
    if (!accountMenuOpen) return;

    function closeOnOutside(event: PointerEvent) {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setAccountMenuOpen(false);
    }

    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [accountMenuOpen]);

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
            <p className="eyebrow">Balneário Camboriú • Quarta 20h</p>
            <h1>POKA PRÁTIKA</h1>
          </div>
        </div>
        <div className="profile-pill account-area" ref={accountMenuRef}>
          <button className="profile-trigger" onClick={() => canCoordinate ? setAccountMenuOpen((value) => !value) : setProfileUserId(auth.user.id)} title={canCoordinate ? 'Abrir menu' : 'Abrir perfil'}>
                {auth.user.avatarDataUrl ? <img src={auth.user.avatarDataUrl} alt="Avatar" /> : <span>{auth.user.name.slice(0, 1)}</span>}
            <div>
              <strong>{auth.user.name}</strong>
              <small>{canCoordinate ? `${auth.user.role} • menu` : `${auth.user.role} • perfil`}</small>
            </div>
          </button>
          {!canCoordinate && <button className="ghost" onClick={() => { localStorage.removeItem(storageKey); setAuth(null); }}>Sair</button>}
          {canCoordinate && accountMenuOpen && <div className="account-menu"><button onClick={() => { setView('temporada'); setAccountMenuOpen(false); }}>Temporada</button><button onClick={() => { setView('pagamentos'); setAccountMenuOpen(false); }}>Mensalidades</button><button onClick={() => { setView('premios'); setAccountMenuOpen(false); }}>Prêmios</button><button onClick={() => { setView('admin'); setAccountMenuOpen(false); }}>Config.</button><button onClick={() => { setScheduleDialogOpen(true); setAccountMenuOpen(false); }}>Agenda</button><button onClick={() => { setProfileUserId(auth.user.id); setAccountMenuOpen(false); }}>Meu perfil</button><button onClick={() => { setChangePasswordOpen(true); setAccountMenuOpen(false); }}>Trocar senha</button><button className="danger-menu" onClick={() => { localStorage.removeItem(storageKey); setAuth(null); }}>Sair</button></div>}
        </div>
      </header>

      {canCoordinate && <ScheduleManagerDialog api={api} matches={matches} activeSeasonId={activeSeasonId} onDone={loadData} controlledOpen={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen} hideTrigger />}

      {changePasswordOpen && <ChangePasswordDialog api={api} onClose={() => setChangePasswordOpen(false)} />}
      {profileUserId && <div className="modal profile-modal"><div className="profile-modal-card"><div className="card-head"><h2>Perfil do atleta</h2><div className="actions">{profileUserId === auth.user.id && <button className="ghost" onClick={() => { setProfileUserId(null); setChangePasswordOpen(true); }}>Trocar senha</button>}<button className="ghost" onClick={() => setProfileUserId(null)}>Fechar</button></div></div><ProfilesPanel api={api} users={users} currentUserId={auth.user.id} initialUserId={profileUserId} onCurrentUserUpdated={updateAuthenticatedUser} /></div></div>}

      {error && <button className="alert" onClick={() => setError('')}>{error}</button>}
      {loading && <div className="mini-loading">Carregando dados reais da Railway...</div>}
      {!loading && <GlobalConfirmationPrompt api={api} matches={matches} canCoordinate={canCoordinate} onReload={loadData} setSelectedMatch={setSelectedMatch} />}

      <section className="context-row">
        <select value={activeSeasonId} onChange={(event) => setActiveSeasonId(event.target.value)}>
          {seasons.map((season) => <option key={season.id} value={season.id}>{season.name} • {season.status}</option>)}
        </select>
        <span className={`status ${activeSeason?.status?.toLowerCase()}`}>{activeSeason?.status ?? 'sem temporada'}</span>
        {suspensions.length > 0 && <span className="status danger">{suspensions.length} suspensão(ões)</span>}
      </section>
        {view === 'temporada' && <div className="home-stack season-home"><SeasonPanel standings={standings} rankings={rankings} onOpenProfile={setProfileUserId} /><div className="season-lower"><MatchesPanel api={api} canCoordinate={canCoordinate} users={users} matches={matches} activeSeasonId={activeSeasonId} currentUserId={auth.user.id} onReload={loadData} selectedMatch={selectedMatch} setSelectedMatch={setSelectedMatch} /><SuspensionsPanel api={api} suspensions={suspensions} matches={matches} canCoordinate={canCoordinate} onReload={loadData} /></div></div>}
      {view === 'pagamentos' && <PaymentsPanel api={api} canCoordinate={canCoordinate} users={users} activeSeasonId={activeSeasonId} />}
      {view === 'premios' && <div className="home-stack"><div className="card compact"><div className="card-head"><div><h2>Central de prêmios</h2><p className="muted">Votação, rankings, badges e regras configuráveis do ferino.</p></div>{canCoordinate && <button className="primary small" onClick={() => setAwardSettingsOpen(true)}>Configurar regras e prêmios</button>}</div></div><AwardsPanel api={api} users={users} activeSeason={activeSeason} isAdmin={isAdmin} /><AwardLeaderboardsPanel api={api} activeSeason={activeSeason} /></div>}
      {view === 'admin' && canCoordinate && <AdminPanel api={api} users={users} seasons={seasons} points={points} activeSeasonId={activeSeasonId} onReload={loadData} isAdmin={isAdmin} />}
      {awardSettingsOpen && <div className="modal profile-modal"><div className="profile-modal-card"><div className="card-head"><h2>Configuração de prêmios</h2><button className="ghost" onClick={() => setAwardSettingsOpen(false)}>Fechar</button></div><AwardSettingsCard api={api} /></div></div>}
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

  return <main className="login-wrap"><form className="login-card card" onSubmit={submit}><img className="login-logo" src={logoUrl} alt="Escudo POKA PRÁTIKA" /><p className="eyebrow">POKA PRÁTIKA • acesso seguro</p><h1>{mode === 'activation' ? 'Ativar cadastro' : 'Alterar senha'}</h1><p className="muted">Defina uma senha com pelo menos 8 caracteres. O login será sempre pelo seu e-mail.</p><input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Nova senha" type="password" autoComplete="new-password" required minLength={8} disabled={done} /><input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirmar senha" type="password" autoComplete="new-password" required minLength={8} disabled={done} /><button className="primary" disabled={done}>{done ? 'Senha salva' : 'Salvar senha'}</button>{message && <p className="muted">{message}</p>}{done && <button type="button" className="ghost" onClick={() => { window.history.replaceState({}, '', '/'); window.location.reload(); }}>Ir para login</button>}</form></main>;
}

function LoginScreen({ onAuth }: { onAuth: (payload: AuthPayload) => void }) {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
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
      const payload = await api.request<AuthPayload>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
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
        <h1>{mode === 'forgot' ? 'Recuperar senha' : 'Entrar no ferino'}</h1>
        <p className="muted">O sistema oficial de quem talvez erre o domínio, mas nunca falta na quarta.</p>
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-mail" type="email" required />
        {mode !== 'forgot' && <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha" type="password" autoComplete="current-password" required minLength={8} />}
        <button className="primary">{mode === 'forgot' ? 'Enviar recuperação' : 'Acessar'}</button>
        {message && <p className="muted">{message}</p>}
        <div className="login-actions">
          <button type="button" className="ghost" onClick={() => setMode(mode === 'forgot' ? 'login' : 'forgot')}>{mode === 'forgot' ? 'Voltar ao login' : 'Esqueci minha senha'}</button>
        </div>
      </form>
    </main>
  );
}

function GlobalConfirmationPrompt({ api, matches, canCoordinate, onReload, setSelectedMatch }: { api: ApiClient; matches: MatchListItem[]; canCoordinate: boolean; onReload: () => Promise<void>; setSelectedMatch: (match: MatchDetail | null) => void }) {
  const [dismissedId, setDismissedId] = useState('');
  const upcoming = [...matches].sort((left, right) => `${left.matchDate}${left.scheduledStart ?? ''}`.localeCompare(`${right.matchDate}${right.scheduledStart ?? ''}`));
  const coordinatorMatch = canCoordinate ? upcoming.find((match) => match.status === 'DRAFT' && !match.confirmationOpen && isMatchToday(match)) : undefined;
  const athleteMatch = !canCoordinate ? upcoming.find((match) => match.status === 'DRAFT' && match.confirmationOpen && !match.myAttendanceStatus) : undefined;
  const match = coordinatorMatch ?? athleteMatch;
  if (!match || dismissedId === match.id) return null;

  async function openConfirmation() {
    if (!match) return;
    await api.request(`/matches/${match.id}/open-confirmation`, { method: 'POST' });
    await onReload();
    setDismissedId(match.id);
  }

  async function openMatch() {
    if (!match) return;
    setSelectedMatch(await api.request<MatchDetail>(`/matches/${match.id}`));
    setDismissedId(match.id);
  }

  return <div className="modal prompt-modal"><section className="card modal-card confirmation-popup"><div className="card-head"><div><h2>{canCoordinate ? 'Jogo hoje: liberar confirmações?' : 'Confirme sua presença no jogo'}</h2><p className="muted">{match.title} • {matchDateLabel(match)}</p></div><button type="button" className="ghost" onClick={() => setDismissedId(match.id)}>Depois</button></div><p className="muted">{canCoordinate ? 'Abra a confirmação para os atletas responderem de forma fácil antes da súmula.' : 'O jogo foi disponibilizado para confirmação. Responda se vai jogar, só estará presente, janta/churrasco e convidados.'}</p><div className="actions">{canCoordinate ? <button type="button" className="primary" onClick={() => void openConfirmation()}>Disparar confirmação</button> : <button type="button" className="primary" onClick={() => void openMatch()}>Confirmar agora</button>}<button type="button" className="ghost" onClick={() => setDismissedId(match.id)}>Agora não</button></div></section></div>;
}

function ChangePasswordDialog({ api, onClose }: { api: ApiClient; onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    if (newPassword !== confirmPassword) {
      setMessage('A confirmação precisa ser igual à nova senha.');
      return;
    }
    setSaving(true);
    try {
      const response = await api.request<{ message: string }>('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSaved(true);
      setMessage(response.message);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível trocar a senha.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal"><form className="card modal-card password-card" onSubmit={submit}><div className="card-head"><h2>Trocar senha</h2><button type="button" className="ghost" onClick={onClose}>Fechar</button></div><p className="muted">Informe sua senha atual e defina uma nova senha com pelo menos 8 caracteres.</p><input value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Senha atual" type="password" autoComplete="current-password" required disabled={saving || saved} /><input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Nova senha" type="password" autoComplete="new-password" required minLength={8} disabled={saving || saved} /><input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirmar nova senha" type="password" autoComplete="new-password" required minLength={8} disabled={saving || saved} /><button className="primary" disabled={saving || saved}>{saving ? 'Salvando...' : saved ? 'Senha alterada' : 'Salvar nova senha'}</button>{message && <p className="muted">{message}</p>}</form></div>;
}

function SeasonPanel({ standings, rankings, onOpenProfile }: { standings: Standing[]; rankings: RankingPayload; onOpenProfile: (userId: string) => void }) {
  const topScorer = rankings.goals[0];
  const topAssistant = rankings.assists[0];
  const topPresence = rankings.presence[0];
  const topPoints = standings[0];
  const topEfficiency = [...standings].filter((row) => row.games_played > 0).sort((left, right) => ((right.wins * 3 + right.draws) / (right.games_played * 3)) - ((left.wins * 3 + left.draws) / (left.games_played * 3)))[0];
  const topTeamBalance = [...standings].sort((left, right) => right.team_goal_balance - left.team_goal_balance || right.team_goals_for - left.team_goals_for)[0];
  const indicators = [
    topScorer && { icon: '⚽', title: 'Artilheiro', userId: topScorer.userId, name: topScorer.name, value: topScorer.goals, suffix: 'gols', detail: `${topScorer.netGoals} saldo • ${topScorer.ownGoals} contra` },
    topAssistant && { icon: '🅰️', title: 'Garçom', userId: topAssistant.userId, name: topAssistant.name, value: topAssistant.assists, suffix: 'assist.', detail: `${topAssistant.gamesPlayed} jogos • média ${formatAverage(topAssistant.average)}` },
    topPresence && { icon: '📍', title: 'Mais assíduo', userId: topPresence.userId, name: topPresence.name, value: topPresence.total, suffix: 'pres.', detail: `${topPresence.gamesPlayed} jogos • ${formatAverage(topPresence.percentage)}%` },
    topEfficiency && { icon: '📈', title: 'Melhor aproveitamento', userId: topEfficiency.user_id, name: topEfficiency.name, value: Math.round(topEfficiency.games_played ? ((topEfficiency.wins * 3 + topEfficiency.draws) / (topEfficiency.games_played * 3)) * 100 : 0), suffix: '%', detail: `V ${topEfficiency.wins} • E ${topEfficiency.draws} • D ${topEfficiency.losses}` },
    topPoints && { icon: '🏆', title: 'Maior pontuador', userId: topPoints.user_id, name: topPoints.name, value: topPoints.total_points, suffix: 'pts', detail: `1º nos pontos corridos` },
    topTeamBalance && { icon: '🥅', title: 'Melhor saldo equipe', userId: topTeamBalance.user_id, name: topTeamBalance.name, value: topTeamBalance.team_goal_balance, suffix: 'saldo', detail: `${topTeamBalance.team_goals_for} pró • ${topTeamBalance.team_goals_against} contra` }
  ].filter(Boolean) as Array<{ icon: string; title: string; userId: string; name: string; value: number; suffix: string; detail: string }>;

  return <section className="card compact standings-card"><div className="card-head championship-head"><div><h2>Tabela da temporada</h2><p className="muted">Classificação em largura total, estilo campeonato: clique no atleta para abrir o perfil.</p></div>{standings.length > 0 && <button className="ghost" onClick={() => downloadCsv('poka-pratika-classificacao.csv', standings.map((row) => ({ posicao: row.position, atleta: row.name, pontos: row.total_points, jogos: row.games_played, vitorias: row.wins, empates: row.draws, derrotas: row.losses, presencasSemJogar: row.presences, mensalidades: row.paid_months, gols: row.goals, golsContra: row.own_goals, assistencias: row.assists, cartoes: row.total_cards, saldoEquipe: row.team_goal_balance })))}>Exportar CSV</button>}</div>{standings.length === 0 ? <EmptyState title="Temporada pronta para começar" text="Assim que a primeira súmula for confirmada, a tabela ganha vida." /> : <div className="championship-wrap"><table className="championship-table"><thead><tr><th>Pos</th><th>Atleta</th><th>PTS</th><th>J</th><th>V</th><th>E</th><th>D</th><th>PSJ</th><th>Mens.</th><th>GP</th><th>GC</th><th>SG</th><th>GF</th><th>GS</th><th>SE</th><th>APR</th><th>G</th><th>A</th><th>CAR</th></tr></thead><tbody>{standings.map((row) => <tr key={row.user_id}><td className="pos-cell">{row.position}</td><td className="athlete-cell"><button className="name-link strong" onClick={() => onOpenProfile(row.user_id)}>{row.name}</button></td><td className="points-cell">{row.total_points}</td><td>{row.games_played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.presences}</td><td>{row.paid_months}</td><td>{row.goals}</td><td>{row.own_goals}</td><td>{row.net_goals}</td><td>{row.team_goals_for}</td><td>{row.team_goals_against}</td><td>{row.team_goal_balance}</td><td>{formatPercent(row.games_played ? ((row.wins * 3 + row.draws) / (row.games_played * 3)) * 100 : 0)}</td><td>{row.goals}</td><td>{row.assists}</td><td>{row.total_cards}</td></tr>)}</tbody></table></div>}<div className="leader-strip">{indicators.length === 0 ? <EmptyState title="Indicadores aguardando jogos" text="Os líderes individuais aparecem aqui após as primeiras súmulas confirmadas." /> : indicators.map((item) => <article className="leader-card" key={item.title}><span className="leader-icon">{item.icon}</span><div><small>{item.title}</small><button className="name-link" onClick={() => onOpenProfile(item.userId)}>{item.name}</button><b>{item.value} {item.suffix}</b><em>{item.detail}</em></div></article>)}</div></section>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><strong>{title}</strong><span>{text}</span></div>;
}

function SuspensionsPanel({ api, suspensions, matches, canCoordinate, onReload }: { api: ApiClient; suspensions: Suspension[]; matches: MatchListItem[]; canCoordinate: boolean; onReload: () => Promise<void> }) {
  const confirmedMatches = matches.filter((match) => match.status === 'CONFIRMED');

  async function serveSuspension(id: string, servedMatchId: string) {
    if (!servedMatchId) return;
    await api.request(`/suspensions/${id}/serve`, { method: 'POST', body: JSON.stringify({ servedMatchId }) });
    await onReload();
  }

  return <section className="card compact suspension-panel"><div className="card-head"><div><h2>Suspensões</h2><p className="muted">Pendências disciplinares da temporada.</p></div><span className={`status ${suspensions.length ? 'danger' : 'open'}`}>{suspensions.length}</span></div>{suspensions.length === 0 ? <EmptyState title="Sem suspensões" text="Ninguém pendurado para cumprir jogo. Milagre da várzea organizada." /> : <div className="suspension-list">{suspensions.map((item) => <article className="suspension-row" key={item.id}><strong>{item.userName}</strong><span>{formatCardReason(item.reason)}</span><small>Origem: {item.triggerMatchTitle}</small>{canCoordinate && <select disabled={!confirmedMatches.length} defaultValue="" onChange={(event) => void serveSuspension(item.id, event.target.value)}><option value="">Cumpriu em...</option>{confirmedMatches.map((match) => <option key={match.id} value={match.id}>{match.title} • {match.matchDate?.slice(0, 10)}</option>)}</select>}</article>)}</div>}</section>;
}

function ProfilesPanel({ api, users, currentUserId, initialUserId, onCurrentUserUpdated }: { api: ApiClient; users: User[]; currentUserId: string; initialUserId: string; onCurrentUserUpdated: (user: User) => void }) {
  const [selectedUserId, setSelectedUserId] = useState(initialUserId);
  const [career, setCareer] = useState<CareerProfile | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => setSelectedUserId(initialUserId), [initialUserId]);

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

  return <div className="grid two"><section className="card compact"><div className="card-head"><h2>Perfil do atleta</h2><select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></div>{message && <p className="muted">{message}</p>}{career && <><div className="career-hero"><div className="profile-pill big">{career.profile.avatarDataUrl ? <img src={career.profile.avatarDataUrl} alt="Avatar" /> : <span>{career.profile.name.slice(0, 1)}</span>}<div><strong>{career.profile.name}</strong><small>{career.profile.role} • {positionLabel(career.profile.position)}</small></div></div><strong>{career.totals.seasonsPlayed} temporada(s)</strong></div>{selectedUserId === currentUserId && <div className="avatar-tools"><label className="ghost"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void saveAvatar(file); }} />Trocar foto</label>{career.profile.avatarDataUrl && <button type="button" className="ghost" onClick={() => void saveAvatar(null)}>Remover foto</button>}</div>}<div className="stat-grid"><span><b>{career.totals.totalPoints}</b> pontos</span><span><b>{career.totals.presences}</b> presenças</span><span><b>{career.totals.goals}</b> gols</span><span><b>{career.totals.assists}</b> assist.</span><span><b>{career.totals.wins}</b> vitórias</span><span><b>{career.totals.yellowCards + career.totals.redCards + career.totals.blueCards}</b> cartões</span></div><h2>Títulos e badges</h2><div className="chips">{career.awards.length === 0 ? <span className="muted">Nenhum prêmio registrado ainda.</span> : career.awards.map((award) => <span className="chip trophy" key={award.id}>{award.label} • {award.year}</span>)}</div><div className="chips">{career.badges.map((badge) => <span className="chip" key={badge.id}>{badge.label}</span>)}</div></>}</section><section className="card compact"><h2>Histórico por temporada</h2><div className="table-cards">{career?.seasons.map((season) => <article className="row-card" key={season.seasonId}><strong>{season.seasonName} • {season.year}</strong><span>{season.totalPoints} pts</span><small>Pres. {season.presences} • V {season.wins} • E {season.draws} • D {season.losses} • G {season.goals} • A {season.assists}</small></article>)}</div></section></div>;
}

function AttendancePanel({ api, match, currentUserId, onSaved }: { api: ApiClient; match: MatchDetail; currentUserId: string; onSaved: () => Promise<void> }) {
  const own = match.attendance.find((item) => item.userId === currentUserId);
  const [responseStatus, setResponseStatus] = useState<AttendanceStatus>(own?.responseStatus ?? 'JOGAR');
  const [dinnerConfirmed, setDinnerConfirmed] = useState(own?.dinnerConfirmed ?? false);
  const [guestCount, setGuestCount] = useState(own?.guestCount ?? 0);
  const [notes, setNotes] = useState(own?.notes ?? '');
  const [message, setMessage] = useState('');
  const openForResponse = match.status === 'DRAFT' && match.confirmationOpen !== false;

  useEffect(() => {
    setResponseStatus(own?.responseStatus ?? 'JOGAR');
    setDinnerConfirmed(own?.dinnerConfirmed ?? false);
    setGuestCount(own?.guestCount ?? 0);
    setNotes(own?.notes ?? '');
    setMessage('');
  }, [match.id, own?.updatedAt]);

  const playing = match.attendance.filter((item) => item.responseStatus === 'JOGAR');
  const presentOnly = match.attendance.filter((item) => item.responseStatus === 'PRESENTE_SEM_JOGAR');
  const absent = match.attendance.filter((item) => item.responseStatus === 'AUSENTE');
  const dinnerPeople = match.attendance.reduce((total, item) => total + (item.dinnerConfirmed ? 1 : 0) + (item.dinnerConfirmed ? item.guestCount : 0), 0);
  const closedMessage = match.status === 'DRAFT'
    ? `Confirmação ainda não aberta. A coordenação pode abrir manualmente ou manter a janela configurada${match.confirmationOpenAt ? ` para ${formatBrasiliaTime(match.confirmationOpenAt)}` : ''}.`
    : 'Confirmação bloqueada porque a súmula já saiu do rascunho.';

  async function saveAttendance() {
    setMessage('Salvando confirmação...');
    await api.request(`/matches/${match.id}/attendance/me`, { method: 'PUT', body: JSON.stringify({ responseStatus, dinnerConfirmed, guestCount, notes: notes || null }) });
    setMessage('Confirmação salva. A súmula já pode usar esta informação para montar os times.');
    await onSaved();
  }

  return (
    <section className="score-editor attendance-panel">
      <div className="card-head">
        <div>
          <strong>Confirmação da rodada</strong>
          <p className="muted">Atletas confirmam jogo, presença no evento e janta/churrasco.</p>
        </div>
        <span className="status open">{playing.length} jogo • {presentOnly.length} presença • {dinnerPeople} janta</span>
      </div>
      <MatchDayChecklist match={match} />
      <div className="stat-grid">
        <span><b>{playing.length}</b> disponíveis para jogar</span>
        <span><b>{presentOnly.length}</b> só presentes</span>
        <span><b>{absent.length}</b> ausentes</span>
        <span><b>{dinnerPeople}</b> pessoas na janta</span>
      </div>
      {openForResponse ? <div className="attendance-form">
        <div className="segmented">
          <button type="button" className={responseStatus === 'JOGAR' ? 'primary small' : 'ghost'} onClick={() => setResponseStatus('JOGAR')}>Vou jogar</button>
          <button type="button" className={responseStatus === 'PRESENTE_SEM_JOGAR' ? 'primary small' : 'ghost'} onClick={() => setResponseStatus('PRESENTE_SEM_JOGAR')}>Só presença</button>
          <button type="button" className={responseStatus === 'AUSENTE' ? 'primary small' : 'ghost'} onClick={() => setResponseStatus('AUSENTE')}>Não vou</button>
        </div>
        <label className="bench"><input type="checkbox" checked={dinnerConfirmed} onChange={(event) => setDinnerConfirmed(event.target.checked)} /> Fico para janta/churrasco</label>
        <input type="number" min="0" max="20" value={guestCount} onChange={(event) => setGuestCount(Number(event.target.value))} disabled={!dinnerConfirmed} placeholder="Convidados para janta" />
        <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Observação rápida: chego atrasado, levo bola, etc." maxLength={300} />
        <button type="button" className="primary" onClick={() => void saveAttendance()}>Salvar minha confirmação</button>
      </div> : <p className="muted">{closedMessage}</p>}
      {message && <p className="muted">{message}</p>}
      <div className="table-cards attendance-list">
        {match.attendance.length === 0 ? <EmptyState title="Sem confirmações ainda" text="Quando os atletas responderem, a lista vira a base da escalação." /> : match.attendance.map((item) => <article className="row-card" key={item.userId}><strong>{item.name}</strong><span>{item.responseStatus === 'JOGAR' ? 'vai jogar' : item.responseStatus === 'PRESENTE_SEM_JOGAR' ? 'só presença' : 'ausente'}</span><small>{positionLabel(item.position)} • {item.dinnerConfirmed ? `janta + ${item.guestCount} convidado(s)` : 'sem janta'}{item.notes ? ` • ${item.notes}` : ''}</small></article>)}
      </div>
    </section>
  );
}

function MatchDayChecklist({ match }: { match: MatchDetail }) {
  const teamA = match.players.filter((player) => player.team === 'A');
  const teamB = match.players.filter((player) => player.team === 'B');
  const teamAGoalkeepers = teamA.filter((player) => player.roleInMatch === 'GOLEIRO').length;
  const teamBGoalkeepers = teamB.filter((player) => player.roleInMatch === 'GOLEIRO').length;
  const teamALine = teamA.filter((player) => player.roleInMatch !== 'GOLEIRO').length;
  const teamBLine = teamB.filter((player) => player.roleInMatch !== 'GOLEIRO').length;
  const checks = [
    { label: match.confirmationOpen ? 'Aberto para Confirmação' : 'Fechado para Confirmação', ok: Boolean(match.confirmationOpen) },
    { label: `${match.attendance.filter((item) => item.responseStatus === 'JOGAR').length} confirmado(s) para jogar`, ok: match.attendance.some((item) => item.responseStatus === 'JOGAR') },
    { label: `${teamA.length} x ${teamB.length} atletas escalados`, ok: teamA.length > 0 && teamB.length > 0 },
    { label: `Goleiros ${teamAGoalkeepers}/${teamBGoalkeepers}`, ok: teamAGoalkeepers === 1 && teamBGoalkeepers === 1 },
    { label: `Linha ${teamALine}/${teamBLine}`, ok: teamALine >= 6 && teamBLine >= 6 },
    { label: match.startedAt ? `Iniciado ${formatBrasiliaClock(match.startedAt)}` : 'Aguardando início oficial', ok: Boolean(match.startedAt) }
  ];

  return <section className="match-day-checklist">{checks.map((check) => <span className={`status ${check.ok ? 'open' : 'danger'}`} key={check.label}>{check.ok ? '✓' : '•'} {check.label}</span>)}</section>;
}

function MatchesPanel({ api, canCoordinate, users, matches, activeSeasonId, currentUserId, onReload, selectedMatch, setSelectedMatch }: { api: ApiClient; canCoordinate: boolean; users: User[]; matches: MatchListItem[]; activeSeasonId: string; currentUserId: string; onReload: () => Promise<void>; selectedMatch: MatchDetail | null; setSelectedMatch: (match: MatchDetail | null) => void }) {
  const [clockRunning, setClockRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [matchMessage, setMatchMessage] = useState('');

  useEffect(() => {
    if (!clockRunning || selectedMatch?.status === 'RUNNING') return;
    const limitSeconds = (selectedMatch?.availableMinutes ?? 60) * 60;
    const timer = window.setInterval(() => setSeconds((value) => Math.min(value + 1, limitSeconds)), 1000);
    return () => window.clearInterval(timer);
  }, [clockRunning, selectedMatch?.status, selectedMatch?.availableMinutes]);

  useEffect(() => {
    if (!selectedMatch) return;
    if (selectedMatch.status === 'RUNNING' && selectedMatch.startedAt) {
      const startedAt = new Date(selectedMatch.startedAt).getTime();
      const limitSeconds = (selectedMatch.availableMinutes ?? 60) * 60;
      const syncOfficialClock = () => setSeconds(Math.min(limitSeconds, Math.max(0, Math.floor((Date.now() - startedAt) / 1000))));
      syncOfficialClock();
      setClockRunning(true);
      const timer = window.setInterval(syncOfficialClock, 1000);
      return () => window.clearInterval(timer);
    }
    setClockRunning(selectedMatch.draftClockRunning ?? false);
    setSeconds(selectedMatch.draftClockSeconds ?? 0);
  }, [selectedMatch?.id, selectedMatch?.status, selectedMatch?.startedAt, selectedMatch?.availableMinutes, selectedMatch?.draftClockSeconds, selectedMatch?.draftClockRunning]);

  async function openMatch(id: string) {
    try {
      setMatchMessage('');
      setSelectedMatch(await api.request<MatchDetail>(`/matches/${id}`));
      setSeconds(0);
      setClockRunning(false);
      setCancelConfirm(false);
    } catch (error) {
      setMatchMessage(error instanceof Error ? error.message : 'Não foi possível abrir a súmula.');
    }
  }

  async function startSelectedMatch() {
    if (!selectedMatch) return;
    await api.request(`/matches/${selectedMatch.id}/start`, { method: 'POST' });
    await openMatch(selectedMatch.id);
    setClockRunning(true);
    await onReload();
  }

  async function cancelSelectedMatch() {
    if (!selectedMatch) return;
    await api.request(`/matches/${selectedMatch.id}/cancel`, { method: 'POST' });
    await openMatch(selectedMatch.id);
    await onReload();
  }

  const sortedMatches = [...matches].sort((left, right) => new Date(right.matchDate).getTime() - new Date(left.matchDate).getTime());

  return <section className="card compact matches-report"><div className="card-head"><div><h2>Histórico dos jogos</h2><p className="muted">Mais recente primeiro. Use os botões para abrir placar, súmula e acontecimentos.</p></div>{canCoordinate && <OperationalMatchDialog api={api} users={users} activeSeasonId={activeSeasonId} onDone={onReload} />}</div>{matchMessage && <button className="alert" onClick={() => setMatchMessage('')}>{matchMessage}</button>}<div className="match-history-list">{sortedMatches.length === 0 ? <EmptyState title="Nenhum jogo criado" text="Use Criar jogo para montar a súmula operacional desta rodada." /> : sortedMatches.map((match) => <article className="match-history-row" key={match.id}><div className="match-history-main"><strong>{match.title}</strong><small>{match.matchDate?.slice(0, 10)} • {match.status}</small></div><div className="match-scoreline"><span>{match.teamAName}</span><b>{match.teamAScore} x {match.teamBScore}</b><span>{match.teamBName}</span></div><div className="match-icons"><button type="button" title="Ver placar" aria-label={`Ver placar de ${match.title}`} onClick={() => openMatch(match.id)}>🏟️</button><button type="button" title="Abrir súmula" aria-label={`Abrir súmula de ${match.title}`} onClick={() => openMatch(match.id)}>📋</button><button type="button" title="Ver eventos" aria-label={`Ver eventos de ${match.title}`} onClick={() => openMatch(match.id)}>⚡</button></div></article>)}</div>{selectedMatch && <div className="modal match-modal"><section className="match-modal-card"><div className="card-head"><div><h2>{selectedMatch.title}</h2><p className="muted">Súmula operacional • {selectedMatch.matchDate?.slice(0, 10)} • {selectedMatch.status}</p></div><button className="ghost" onClick={() => { setSelectedMatch(null); setCancelConfirm(false); }}>Fechar</button></div><AttendancePanel api={api} match={selectedMatch} currentUserId={currentUserId} onSaved={async () => { await openMatch(selectedMatch.id); await onReload(); }} /><div className="match-ops-grid"><section className="score-editor broadcast-panel"><div className="scoreboard"><b>{selectedMatch.teamAName}</b><strong>{selectedMatch.status === 'CONFIRMED' ? selectedMatch.teamAScore : selectedMatch.draftTeamAScore ?? selectedMatch.teamAScore} x {selectedMatch.status === 'CONFIRMED' ? selectedMatch.teamBScore : selectedMatch.draftTeamBScore ?? selectedMatch.teamBScore}</strong><b>{selectedMatch.teamBName}</b></div><div className="clock">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</div>{selectedMatch.startedAt && <p className="muted">Jogo iniciado oficialmente em {formatBrasiliaTime(selectedMatch.startedAt)} — horário de Brasília. A quadra encerra às 21:00; tempo útil desta súmula: {selectedMatch.availableMinutes ?? 60} min.</p>}<div className="actions"><button className="primary" disabled={selectedMatch.status === 'RUNNING'} onClick={() => setClockRunning((value) => !value)}>{selectedMatch.status === 'RUNNING' ? 'Cronômetro oficial ativo' : clockRunning ? 'Pausar rascunho' : 'Iniciar rascunho'}</button><button className="ghost" disabled={selectedMatch.status === 'RUNNING'} onClick={() => setSeconds(0)}>Zerar</button>{canCoordinate && selectedMatch.status === 'DRAFT' && <button className="primary" onClick={() => void startSelectedMatch()}>Jogo iniciado</button>}{canCoordinate && ['DRAFT', 'RUNNING', 'SUBMITTED'].includes(selectedMatch.status) && (cancelConfirm ? <><button className="ghost danger-action" onClick={() => void cancelSelectedMatch()}>Confirmar cancelamento</button><button className="ghost" onClick={() => setCancelConfirm(false)}>Manter súmula</button></> : <button className="ghost danger-action" onClick={() => setCancelConfirm(true)}>Cancelar súmula</button>)}</div>{cancelConfirm && <p className="muted">Cancelar tira esta súmula do fluxo operacional e ela não pontua a temporada.</p>}<SubstitutionManager rotation={selectedMatch.rotation} currentMinute={Math.floor(seconds / 60)} /></section><section className="match-sheet-panel">{canCoordinate && ['DRAFT', 'RUNNING', 'SUBMITTED'].includes(selectedMatch.status) && <ExistingLineupEditor api={api} match={selectedMatch} users={users} onSaved={async () => { await openMatch(selectedMatch.id); await onReload(); }} />}<div className="chips">{selectedMatch.events.map((event, index) => <span className="chip" key={index}>{event.minute}' {eventLabel(event.eventType)}</span>)}</div>{canCoordinate && selectedMatch.status !== 'CANCELLED' && <MatchScoreEditor api={api} match={selectedMatch} users={users} clockSeconds={seconds} clockRunning={clockRunning} onSaved={async () => { await openMatch(selectedMatch.id); await onReload(); }} />}<CorrectionHistory corrections={selectedMatch.corrections ?? []} /></section></div></section></div>}</section>;
}

function ExistingLineupEditor({ api, match, users, onSaved }: { api: ApiClient; match: MatchDetail; users: User[]; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(match.status === 'DRAFT' && match.players.length === 0);
  const [title, setTitle] = useState(match.title);
  const [date, setDate] = useState(match.matchDate.slice(0, 10));
  const [refereeName, setRefereeName] = useState(match.refereeName ?? '');
  const [teamAName, setTeamAName] = useState(match.teamAName);
  const [teamBName, setTeamBName] = useState(match.teamBName);
  const [players, setPlayers] = useState<MatchDraftPlayer[]>([]);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');

  function playersFromAttendance(): MatchDraftPlayer[] {
    const attendancePlayers = match.attendance.filter((item) => item.responseStatus !== 'AUSENTE').map((item, index) => {
      const user = users.find((current) => current.id === item.userId);
      const position = user?.position ?? item.position ?? 'MC';
      const presentOnly = item.responseStatus === 'PRESENTE_SEM_JOGAR';
      return {
        userId: item.userId,
        name: item.name,
        email: user?.email ?? '',
        position,
        team: presentOnly ? 'PRESENTE_SEM_JOGAR' as const : 'A' as const,
        roleInMatch: presentOnly ? 'PRESENTE_SEM_JOGAR' as const : position === 'GO' ? 'GOLEIRO' as const : 'LINHA' as const,
        drawOrder: String(index + 1),
        startsOnBench: false
      };
    });
    return drawBalancedTeams(attendancePlayers);
  }

  useEffect(() => {
    setTitle(match.title);
    setDate(match.matchDate.slice(0, 10));
    setRefereeName(match.refereeName ?? '');
    setTeamAName(match.teamAName);
    setTeamBName(match.teamBName);
    const savedPlayers: MatchDraftPlayer[] = match.players.map((player, index) => {
      const user = users.find((item) => item.id === player.userId);
      const team = player.team as MatchDraftPlayer['team'];
      return {
        userId: player.userId,
        name: player.name,
        email: user?.email ?? '',
        position: user?.position ?? 'MC',
        team,
        roleInMatch: team === 'PRESENTE_SEM_JOGAR' ? 'PRESENTE_SEM_JOGAR' : player.roleInMatch === 'GOLEIRO' ? 'GOLEIRO' : 'LINHA',
        drawOrder: String(player.drawOrder ?? index + 1),
        startsOnBench: player.startsOnBench
      };
    });
    const attendancePlayers = playersFromAttendance();
    setPlayers(savedPlayers.length ? savedPlayers : attendancePlayers);
    setMessage(savedPlayers.length || !attendancePlayers.length ? '' : `${attendancePlayers.filter((player) => player.team !== 'PRESENTE_SEM_JOGAR').length} atleta(s) para jogo e ${attendancePlayers.filter((player) => player.team === 'PRESENTE_SEM_JOGAR').length} apenas presente(s) carregados das confirmações. Revise e salve a escalação antes de iniciar.`);
  }, [match.id, match.title, match.matchDate, match.refereeName, match.teamAName, match.teamBName, match.players, match.attendance, users]);

  const assignedIds = new Set(players.map((player) => player.userId));
  const search = query.trim().toLowerCase();
  const searchResults = search.length < 3 ? [] : users.filter((user) => user.active !== false && !assignedIds.has(user.id) && `${user.name} ${user.email}`.toLowerCase().includes(search)).slice(0, 8);
  const teamA = players.filter((player) => player.team === 'A');
  const teamB = players.filter((player) => player.team === 'B');
  const presentOnly = players.filter((player) => player.team === 'PRESENTE_SEM_JOGAR');

  function payload() {
    const currentTeamA = players.filter((player) => player.team === 'A');
    const currentTeamB = players.filter((player) => player.team === 'B');
    return players.map((player) => ({
      userId: player.userId,
      team: player.team,
      roleInMatch: player.team === 'PRESENTE_SEM_JOGAR' ? 'PRESENTE_SEM_JOGAR' : player.roleInMatch,
      drawOrder: player.drawOrder ? Number(player.drawOrder) : null,
      rotationOrder: player.team === 'A' ? currentTeamA.findIndex((item) => item.userId === player.userId) + 1 : player.team === 'B' ? currentTeamB.findIndex((item) => item.userId === player.userId) + 1 : null,
      startsOnBench: player.startsOnBench,
      present: true
    }));
  }

  function addPlayer(user: User, team: MatchDraftPlayer['team']) {
    const position = user.position ?? 'MC';
    setPlayers((list) => [...list, { userId: user.id, name: user.name, email: user.email, position, team, roleInMatch: team === 'PRESENTE_SEM_JOGAR' ? 'PRESENTE_SEM_JOGAR' : position === 'GO' ? 'GOLEIRO' : 'LINHA', drawOrder: String(list.length + 1), startsOnBench: false }]);
    setQuery('');
  }

  function updatePlayer(userId: string, patch: Partial<MatchDraftPlayer>) {
    setPlayers((list) => list.map((player) => player.userId === userId ? { ...player, ...patch } : player));
  }

  function movePlayer(userId: string, direction: -1 | 1) {
    setPlayers((list) => {
      const player = list.find((item) => item.userId === userId);
      if (!player || player.team === 'PRESENTE_SEM_JOGAR') return list;
      const teamRows = list.filter((item) => item.team === player.team);
      const index = teamRows.findIndex((item) => item.userId === userId);
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= teamRows.length) return list;
      const reordered = [...teamRows];
      [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
      return list.filter((item) => item.team !== player.team).concat(reordered);
    });
  }

  function removePlayer(userId: string) {
    setPlayers((list) => list.filter((player) => player.userId !== userId));
  }

  function balanceTeamsByPosition() {
    setPlayers((list) => drawBalancedTeams(list));
  }

  function applyAttendanceLineup() {
    const attendancePlayers = playersFromAttendance();
    setPlayers(attendancePlayers);
    setMessage(`${attendancePlayers.filter((player) => player.team !== 'PRESENTE_SEM_JOGAR').length} atleta(s) disponíveis para jogo e ${attendancePlayers.filter((player) => player.team === 'PRESENTE_SEM_JOGAR').length} apenas presente(s) carregados das confirmações.`);
  }

  async function save() {
    setMessage('Salvando escalação no banco...');
    await api.request(`/matches/${match.id}/lineup`, { method: 'PATCH', body: JSON.stringify({ matchDate: date, title, refereeName: refereeName || null, teamAName, teamBName, players: payload() }) });
    setMessage('Escalação salva e roteiro de trocas recalculado.');
    await onSaved();
  }

  function TeamRows({ team, rows }: { team: 'A' | 'B'; rows: MatchDraftPlayer[] }) {
    return <div className="team-list"><strong>{team === 'A' ? teamAName : teamBName}</strong>{rows.length === 0 ? <small className="muted">Sem atletas no time.</small> : rows.map((player, index) => <div className="team-player compact-line" key={player.userId}><span className="drag-handle">{index + 1}</span><div className="player-meta"><b>{player.name}</b><small>{positionLabel(player.position)}</small></div><select value={player.roleInMatch} onChange={(event) => updatePlayer(player.userId, { roleInMatch: event.target.value as MatchDraftPlayer['roleInMatch'] })}><option value="LINHA">Linha</option><option value="GOLEIRO">Goleiro</option></select><label className="bench"><input type="checkbox" checked={player.startsOnBench} onChange={(event) => updatePlayer(player.userId, { startsOnBench: event.target.checked })} /> Banco</label><button type="button" className="ghost" onClick={() => movePlayer(player.userId, -1)}>↑</button><button type="button" className="ghost" onClick={() => movePlayer(player.userId, 1)}>↓</button><button type="button" className="ghost" onClick={() => updatePlayer(player.userId, { team: team === 'A' ? 'B' : 'A' })}>Mover</button><button type="button" className="ghost" onClick={() => removePlayer(player.userId)}>Remover</button></div>)}</div>;
  }

  return <div className="score-editor"><div className="card-head"><strong>Escalação editável</strong><button className="ghost" onClick={() => setOpen((value) => !value)}>{open ? 'Recolher' : 'Editar escalação'}</button></div>{open && <><p className="muted">Edite antes da confirmação final. Se já houver eventos oficiais, o backend bloqueia remoções incompatíveis.</p><div className="match-meta"><input value={title} onChange={(event) => setTitle(event.target.value)} /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /><input value={refereeName} onChange={(event) => setRefereeName(event.target.value)} placeholder="Árbitro" /><input value={teamAName} onChange={(event) => setTeamAName(event.target.value)} /><input value={teamBName} onChange={(event) => setTeamBName(event.target.value)} />{match.attendance.some((item) => item.responseStatus !== 'AUSENTE') && <button className="ghost" onClick={applyAttendanceLineup}>Usar confirmações</button>}<button className="primary" onClick={balanceTeamsByPosition}>Rebalancear</button><button className="primary" onClick={() => void save()}>Salvar escalação</button></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar atleta para adicionar" />{query.trim().length > 0 && query.trim().length < 3 && <small className="muted">Digite pelo menos 3 caracteres.</small>}<div className="search-results">{searchResults.map((user) => <article key={user.id}><strong>{user.name}</strong><small>{user.email} • {positionLabel(user.position)}</small><div className="actions"><button className="primary small" onClick={() => addPlayer(user, 'A')}>Time A</button><button className="primary small" onClick={() => addPlayer(user, 'B')}>Time B</button><button className="ghost" onClick={() => addPlayer(user, 'PRESENTE_SEM_JOGAR')}>Presente</button></div></article>)}</div><div className="team-board"><TeamRows team="A" rows={teamA} /><TeamRows team="B" rows={teamB} /></div><div className="team-list"><strong>Presentes sem jogar</strong>{presentOnly.length === 0 ? <small className="muted">Nenhum atleta marcado apenas como presente.</small> : presentOnly.map((player) => <div className="team-player compact-line" key={player.userId}><div className="player-meta"><b>{player.name}</b><small>{positionLabel(player.position)}</small></div><button className="ghost" onClick={() => updatePlayer(player.userId, { team: 'A', roleInMatch: player.position === 'GO' ? 'GOLEIRO' : 'LINHA' })}>Time A</button><button className="ghost" onClick={() => updatePlayer(player.userId, { team: 'B', roleInMatch: player.position === 'GO' ? 'GOLEIRO' : 'LINHA' })}>Time B</button><button className="ghost" onClick={() => removePlayer(player.userId)}>Remover</button></div>)}</div>{message && <p className="muted">{message}</p>}</>}</div>;
}

function SubstitutionManager({ rotation, currentMinute }: { rotation: MatchDetail['rotation']; currentMinute: number }) {
  return <div className="rotation-grid">{(['A', 'B'] as const).map((team) => {
    const schedule = rotation[team].schedule;
    const next = schedule.find((item) => item.minute >= currentMinute);
    const last = [...schedule].reverse().find((item) => item.minute < currentMinute);
    return <div key={team} className="rotation"><strong>Trocas time {team}</strong>{next ? <div className={`next-sub ${next.minute <= currentMinute ? 'due' : ''}`}><b>{next.minute <= currentMinute ? 'Troca agora' : `Próxima aos ${next.minute}'`}</b><span>Entram: {next.entering.join(', ') || '—'}</span><span>Saem: {next.leaving.join(', ') || '—'}</span></div> : <div className="next-sub done"><b>Roteiro concluído</b><span>Última troca: {last ? `${last.minute}'` : 'nenhuma'}</span></div>}{schedule.map((item) => <span className={item.minute < currentMinute ? 'done' : item.minute === currentMinute ? 'due' : ''} key={`${team}-${item.minute}-${item.label}`}>{item.minute}' • {item.label} • entram {item.entering.join(', ')} • saem {item.leaving.join(', ')}</span>)}</div>;
  })}</div>;
}

function MatchScoreEditor({ api, match, users, clockSeconds, clockRunning, onSaved }: { api: ApiClient; match: MatchDetail; users: User[]; clockSeconds: number; clockRunning: boolean; onSaved: () => Promise<void> }) {
  const initialEvents = match.status === 'CONFIRMED' ? match.events : match.draftEvents?.length ? match.draftEvents : match.events;
  const [teamAScore, setTeamAScore] = useState(match.status === 'CONFIRMED' ? match.teamAScore : match.draftTeamAScore ?? match.teamAScore);
  const [teamBScore, setTeamBScore] = useState(match.status === 'CONFIRMED' ? match.teamBScore : match.draftTeamBScore ?? match.teamBScore);
  const [events, setEvents] = useState<MatchEventDraft[]>(initialEvents.map((event) => ({ userId: event.userId, relatedUserId: event.relatedUserId, eventType: event.eventType as MatchEventDraft['eventType'], minute: event.minute, team: event.team, occurredAt: event.occurredAt ?? event.createdAt ?? null, createdAt: event.createdAt ?? null })));
  const [userId, setUserId] = useState(match.players[0]?.userId ?? users[0]?.id ?? '');
  const [relatedUserId, setRelatedUserId] = useState('');
  const [eventType, setEventType] = useState<MatchEventDraft['eventType']>('GOL');
  const [minute, setMinute] = useState(0);
  const [correctionReason, setCorrectionReason] = useState('');
  const [pendingQuickEvent, setPendingQuickEvent] = useState<{ userId: string; eventType: MatchEventDraft['eventType'] } | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState(match.draftSavedAt ? `Rascunho recuperado de ${formatBrasiliaTime(match.draftSavedAt)}.` : 'Rascunho pronto para autosave.');
  const clockRef = useRef({ clockSeconds, clockRunning });

  useEffect(() => {
    const recoveredEvents = match.status === 'CONFIRMED' ? match.events : match.draftEvents?.length ? match.draftEvents : match.events;
    setTeamAScore(match.status === 'CONFIRMED' ? match.teamAScore : match.draftTeamAScore ?? match.teamAScore);
    setTeamBScore(match.status === 'CONFIRMED' ? match.teamBScore : match.draftTeamBScore ?? match.teamBScore);
    setEvents(recoveredEvents.map((event) => ({ userId: event.userId, relatedUserId: event.relatedUserId, eventType: event.eventType as MatchEventDraft['eventType'], minute: event.minute, team: event.team, occurredAt: event.occurredAt ?? event.createdAt ?? null, createdAt: event.createdAt ?? null })));
    setUserId(match.players[0]?.userId ?? users[0]?.id ?? '');
    setCorrectionReason('');
    setPendingQuickEvent(null);
    setAutosaveStatus(match.draftSavedAt ? `Rascunho recuperado de ${formatBrasiliaTime(match.draftSavedAt)}.` : 'Rascunho pronto para autosave.');
  }, [match.id]);

  useEffect(() => {
    clockRef.current = { clockSeconds, clockRunning };
  }, [clockSeconds, clockRunning]);

  useEffect(() => {
    if (match.status === 'CONFIRMED' || match.status === 'CANCELLED') return;
    setAutosaveStatus('Salvando rascunho no banco...');
    const timer = window.setTimeout(() => {
      void api.request<{ draftSavedAt: string }>(`/matches/${match.id}/draft`, { method: 'PATCH', body: JSON.stringify({ teamAScore, teamBScore, events, clockSeconds: clockRef.current.clockSeconds, clockRunning: clockRef.current.clockRunning }) })
        .then((saved) => setAutosaveStatus(`Rascunho salvo em ${formatBrasiliaTime(saved.draftSavedAt)}.`))
        .catch((err) => setAutosaveStatus(err instanceof Error ? err.message : 'Falha ao salvar rascunho.'));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [api, match.id, match.status, teamAScore, teamBScore, events]);

  function addEvent() {
    if (!userId) return;
    const selectedPlayer = match.players.find((player) => player.userId === userId);
    if (!selectedPlayer || selectedPlayer.team === 'PRESENTE_SEM_JOGAR') return;
    const eventTeam = selectedPlayer.team === 'A' ? 'A' : 'B';
    setEvents((list) => [...list, { userId, relatedUserId: relatedUserId || null, eventType, minute, team: eventTeam, occurredAt: new Date().toISOString() }]);
  }
  function addQuickEvent(player: MatchDetail['players'][number], quickEventType: MatchEventDraft['eventType']) {
    if (player.team === 'PRESENTE_SEM_JOGAR') return;
    const eventTeam = player.team === 'A' ? 'A' : 'B';
    const eventMinute = match.status === 'CONFIRMED' ? minute : Math.max(0, Math.floor(clockRef.current.clockSeconds / 60));
    setEvents((list) => [...list, { userId: player.userId, relatedUserId: null, eventType: quickEventType, minute: eventMinute, team: eventTeam, occurredAt: new Date().toISOString() }]);
    if (quickEventType === 'GOL') {
      if (eventTeam === 'A') setTeamAScore((value) => value + 1);
      if (eventTeam === 'B') setTeamBScore((value) => value + 1);
    }
    if (quickEventType === 'GOL_CONTRA') {
      if (eventTeam === 'A') setTeamBScore((value) => value + 1);
      if (eventTeam === 'B') setTeamAScore((value) => value + 1);
    }
  }

  function confirmQuickEvent() {
    if (!pendingQuickEvent) return;
    const player = playablePlayers.find((item) => item.userId === pendingQuickEvent.userId);
    if (!player) return;
    addQuickEvent(player, pendingQuickEvent.eventType);
    setPendingQuickEvent(null);
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

  const selectedEventPlayer = match.players.find((player) => player.userId === userId);
  const playablePlayers = match.players.filter((player) => player.team !== 'PRESENTE_SEM_JOGAR');
  const relatedPlayers = playablePlayers.filter((player) => player.userId !== userId && player.team === selectedEventPlayer?.team);
  const eventLog = [
    ...(match.startedAt ? [{ key: 'start', at: match.startedAt, label: 'Início do jogo', detail: 'Cronômetro oficial iniciado' }] : []),
    ...events.map((item, index) => {
      const player = match.players.find((current) => current.userId === item.userId);
      return { key: `${item.userId}-${item.eventType}-${index}`, at: item.occurredAt ?? item.createdAt ?? null, label: eventLabel(item.eventType), detail: `${player?.name ?? 'Atleta'} • ${item.minute}' • Time ${item.team ?? '—'}` };
    }),
    ...((match.endedAt || match.status === 'SUBMITTED' || match.status === 'CONFIRMED') ? [{ key: 'end', at: match.endedAt ?? null, label: 'Final do jogo', detail: match.endedAt ? 'Súmula encerrada' : 'Será registrado ao submeter' }] : [])
  ].sort((left, right) => {
    const leftTime = left.at ? new Date(left.at).getTime() : Number.MAX_SAFE_INTEGER;
    const rightTime = right.at ? new Date(right.at).getTime() : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime;
  });

  return (
    <div className="score-editor">
      <strong>{match.status === 'CONFIRMED' ? 'Correção auditada da súmula' : 'Fechamento da súmula'}</strong>
      {match.status !== 'CONFIRMED' && <p className="muted">{autosaveStatus}</p>}
      <div className="quick-sheet">
        <strong>Atletas em jogo</strong>
        <small className="muted">Clique no ícone do evento e confirme. O horário real do clique entra no log da súmula.</small>
        {(['A', 'B'] as const).map((team) => (
          <div className="quick-team" key={team}>
            <b>{team === 'A' ? match.teamAName : match.teamBName}</b>
            {playablePlayers.filter((player) => player.team === team).length === 0 && <small className="muted">Nenhum atleta escalado neste time.</small>}
            {playablePlayers.filter((player) => player.team === team).map((player) => (
              <div className={`quick-player ${pendingQuickEvent?.userId === player.userId ? 'confirming' : ''}`} key={player.userId}>
                <span>{player.name}</span>
                <div className="quick-icons">
                  <button type="button" title="Gol" onClick={() => setPendingQuickEvent({ userId: player.userId, eventType: 'GOL' })}>⚽</button>
                  <button type="button" title="Assistência" onClick={() => setPendingQuickEvent({ userId: player.userId, eventType: 'ASSISTENCIA' })}>🅰️</button>
                  <button type="button" title="Cartão amarelo" onClick={() => setPendingQuickEvent({ userId: player.userId, eventType: 'CARTAO_AMARELO' })}>🟨</button>
                  <button type="button" title="Cartão azul" onClick={() => setPendingQuickEvent({ userId: player.userId, eventType: 'CARTAO_AZUL' })}>🟦</button>
                  <button type="button" title="Cartão vermelho" onClick={() => setPendingQuickEvent({ userId: player.userId, eventType: 'CARTAO_VERMELHO' })}>🟥</button>
                </div>
                {pendingQuickEvent?.userId === player.userId && <div className="quick-confirm"><small>Confirmar {eventLabel(pendingQuickEvent.eventType)} para {player.name}?</small><button type="button" className="primary small" onClick={confirmQuickEvent}>Confirmar</button><button type="button" className="ghost" onClick={() => setPendingQuickEvent(null)}>Cancelar</button></div>}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="event-log"><strong>Log da súmula</strong>{eventLog.length === 0 ? <small className="muted">Sem eventos registrados ainda.</small> : eventLog.map((item) => <span key={item.key}><b>{formatBrasiliaClock(item.at)}</b><small>{item.label} • {item.detail}</small></span>)}</div>
      <div className="score-inputs"><input type="number" min="0" value={teamAScore} onChange={(event) => setTeamAScore(Number(event.target.value))} /><span>x</span><input type="number" min="0" value={teamBScore} onChange={(event) => setTeamBScore(Number(event.target.value))} /></div>
      {match.status === 'CONFIRMED' && <input value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Motivo da correção: gol/assistência/cartão lançado errado" required minLength={5} />}
      <details className="advanced-score"><summary>Lançamento manual avançado</summary><div className="event-form"><select value={eventType} onChange={(event) => setEventType(event.target.value as MatchEventDraft['eventType'])}><option value="GOL">Gol</option><option value="GOL_CONTRA">Gol contra</option><option value="ASSISTENCIA">Assistência</option><option value="CARTAO_AMARELO">Cartão amarelo</option><option value="CARTAO_VERMELHO">Cartão vermelho</option><option value="CARTAO_AZUL">Cartão azul</option></select><select value={userId} onChange={(event) => { setUserId(event.target.value); setRelatedUserId(''); }}>{playablePlayers.map((player) => <option key={player.userId} value={player.userId}>{player.name} • Time {player.team}</option>)}</select><select value={relatedUserId} onChange={(event) => setRelatedUserId(event.target.value)}><option value="">Sem relacionado</option>{relatedPlayers.map((player) => <option key={player.userId} value={player.userId}>{player.name}</option>)}</select><input type="number" min="0" max="180" value={minute} onChange={(event) => setMinute(Number(event.target.value))} /><span className="status open">Time {selectedEventPlayer?.team ?? '—'}</span><button type="button" className="ghost" onClick={addEvent}>Adicionar</button></div></details>
      <div className="chips">{events.map((item, index) => <button className="chip" key={`${item.userId}-${item.eventType}-${index}`} onClick={() => setEvents((list) => list.filter((_, itemIndex) => itemIndex !== index))}>{item.minute}' {eventLabel(item.eventType)}</button>)}</div>
      <div className="actions"><button className="primary" onClick={submit} disabled={match.status === 'CONFIRMED' && correctionReason.trim().length < 5}>{match.status === 'CONFIRMED' ? 'Salvar correção' : 'Submeter'}</button>{match.status === 'SUBMITTED' && <button className="ghost" onClick={confirm}>Confirmar e pontuar</button>}</div>
    </div>
  );
}

function CorrectionHistory({ corrections }: { corrections: MatchCorrection[] }) {
  if (!corrections.length) return <div className="empty-state"><strong>Sem correções auditadas</strong><span>Depois de confirmada, qualquer ajuste de placar/eventos aparece aqui com motivo, responsável e data.</span></div>;
  return <div className="audit-box"><strong>Histórico de correções</strong>{corrections.map((item) => <article className="row-card" key={item.id}><strong>{item.previousTeamAScore} x {item.previousTeamBScore} → {item.newTeamAScore} x {item.newTeamBScore}</strong><span>{item.correctedByName}</span><small>{new Date(item.createdAt).toLocaleString('pt-BR')} • {item.reason}</small><small>Eventos: {item.previousEvents.length} → {item.newEvents.length}</small></article>)}</div>;
}

function ScheduleManagerDialog({ api, matches, activeSeasonId, onDone, controlledOpen, onOpenChange, hideTrigger = false }: { api: ApiClient; matches: MatchListItem[]; activeSeasonId: string; onDone: () => Promise<void>; controlledOpen?: boolean; onOpenChange?: (open: boolean) => void; hideTrigger?: boolean }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [mode, setMode] = useState<ScheduleMode>('recurring');
  const [editingId, setEditingId] = useState('');
  const [message, setMessage] = useState('');
  const [title, setTitle] = useState('Futebol de quarta');
  const [manualDate, setManualDate] = useState(todayInputValue());
  const [rangeStart, setRangeStart] = useState(todayInputValue());
  const [rangeEnd, setRangeEnd] = useState(addDaysInput(90));
  const [weekday, setWeekday] = useState(3);
  const [scheduledStart, setScheduledStart] = useState('20:00');
  const [scheduledEnd, setScheduledEnd] = useState('21:00');
  const [confirmationHours, setConfirmationHours] = useState(48);
  const [teamAName, setTeamAName] = useState('Time A');
  const [teamBName, setTeamBName] = useState('Time B');
  const scheduledMatches = [...matches].filter((match) => match.status === 'DRAFT').sort((left, right) => `${left.matchDate}${left.scheduledStart ?? ''}`.localeCompare(`${right.matchDate}${right.scheduledStart ?? ''}`));

  function loadForEdit(match: MatchListItem) {
    setEditingId(match.id);
    setMode('manual');
    setTitle(match.title);
    setManualDate(match.matchDate.slice(0, 10));
    setScheduledStart(match.scheduledStart?.slice(0, 5) ?? '20:00');
    setScheduledEnd(match.scheduledEnd?.slice(0, 5) ?? '21:00');
    setTeamAName(match.teamAName);
    setTeamBName(match.teamBName);
    setConfirmationHours(match.confirmationOpensHoursBefore ?? 48);
    setMessage(`Editando ${match.title}. Ajuste a antecedência conforme a regra do grupo e salve para recalcular a janela de confirmação.`);
  }

  async function saveSchedule(event: FormEvent) {
    event.preventDefault();
    setMessage('Salvando agenda...');
    if (editingId) {
      await api.request(`/matches/${editingId}/schedule`, { method: 'PATCH', body: JSON.stringify({ matchDate: manualDate, title, scheduledStart, scheduledEnd, confirmationOpensHoursBefore: confirmationHours, teamAName, teamBName }) });
      setMessage('Jogo pré-definido atualizado.');
      setEditingId('');
    } else if (mode === 'manual') {
      await api.request('/matches/schedule/manual', { method: 'POST', body: JSON.stringify({ seasonId: activeSeasonId || null, matchDate: manualDate, title, scheduledStart, scheduledEnd, confirmationOpensHoursBefore: confirmationHours, teamAName, teamBName }) });
      setMessage('Jogo avulso criado e disponível na lista.');
    } else {
      const result = await api.request<{ generated: number; skipped: number }>('/matches/schedule/recurring', { method: 'POST', body: JSON.stringify({ seasonId: activeSeasonId || null, weekday, startDate: rangeStart, endDate: rangeEnd, title, scheduledStart, scheduledEnd, confirmationOpensHoursBefore: confirmationHours, teamAName, teamBName }) });
      setMessage(`${result.generated} jogo(s) gerado(s). ${result.skipped} data(s) já existiam e foram preservadas.`);
    }
    await onDone();
  }

  async function removeScheduledMatch(matchId: string) {
    setMessage('Removendo jogo pré-definido...');
    await api.request(`/matches/${matchId}/schedule`, { method: 'DELETE' });
    setMessage('Jogo removido da agenda.');
    await onDone();
  }

  async function openConfirmation(matchId: string) {
    setMessage('Abrindo confirmação para os atletas...');
    await api.request(`/matches/${matchId}/open-confirmation`, { method: 'POST' });
    setMessage('Aberto para Confirmação. Atletas verão o aviso de fácil acesso ao entrar.');
    await onDone();
  }

  return (
    <>
      {!hideTrigger && <button className="ghost small" onClick={() => setOpen(true)}>Agenda</button>}
      {open && <div className="modal">
        <section className="card modal-card wide schedule-modal">
          <div className="card-head">
            <div>
              <h2>Agenda e confirmação dos jogos</h2>
              <p className="muted">Pré-defina recorrência, datas avulsas e a antecedência de abertura conforme a regra do grupo.</p>
            </div>
            <button type="button" className="ghost" onClick={() => setOpen(false)}>Fechar</button>
          </div>
          {message && <p className="status-line">{message}</p>}
          <form className="schedule-form" onSubmit={saveSchedule}>
            <div className="segmented">
              <button type="button" className={mode === 'recurring' && !editingId ? 'primary small' : 'ghost'} onClick={() => { setMode('recurring'); setEditingId(''); }}>Recorrente</button>
              <button type="button" className={mode === 'manual' || editingId ? 'primary small' : 'ghost'} onClick={() => { setMode('manual'); setEditingId(''); }}>Data específica</button>
            </div>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Título do jogo" required />
            {mode === 'recurring' && !editingId ? <div className="match-meta">
              <select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>{weekdayOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
              <input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} />
              <input type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} />
            </div> : <input type="date" value={manualDate} onChange={(event) => setManualDate(event.target.value)} />}
            <div className="match-meta">
              <input type="time" value={scheduledStart} onChange={(event) => setScheduledStart(event.target.value)} />
              <input type="time" value={scheduledEnd} onChange={(event) => setScheduledEnd(event.target.value)} />
              <label className="field-row"><span>Abre antes (h)</span><input type="number" min="1" max="336" value={confirmationHours} onChange={(event) => setConfirmationHours(Number(event.target.value))} aria-label="Horas antes do jogo para abrir confirmação" /></label>
              <input value={teamAName} onChange={(event) => setTeamAName(event.target.value)} />
              <input value={teamBName} onChange={(event) => setTeamBName(event.target.value)} />
            </div>
            <button className="primary">{editingId ? 'Salvar edição' : mode === 'recurring' ? 'Gerar jogos recorrentes' : 'Criar jogo avulso'}</button>
          </form>
          <div className="table-cards schedule-list">
            {scheduledMatches.length === 0 ? <EmptyState title="Sem jogos pré-definidos" text="Crie uma recorrência semanal ou uma data específica para liberar confirmação aos atletas." /> : scheduledMatches.map((match) => <article className="row-card" key={match.id}>
              <strong>{match.title}</strong>
              <span className={`status ${match.confirmationOpen ? 'open' : 'draft'}`}>{match.confirmationOpen ? 'Aberto para Confirmação' : 'Fechado para Confirmação'}</span>
              <small>{matchDateLabel(match)} • abre {match.confirmationOpenAt ? formatBrasiliaTime(match.confirmationOpenAt) : 'sem janela'} • antecedência {match.confirmationOpensHoursBefore ?? 48}h</small>
              <small>{match.attendancePlaying ?? 0} jogar • {match.attendancePresentOnly ?? 0} só presença • {match.attendanceAbsent ?? 0} ausente(s)</small>
              <div className="actions">
                <button type="button" className="ghost" onClick={() => loadForEdit(match)}>Editar</button>
                {!match.confirmationOpen && <button type="button" className="primary small" onClick={() => void openConfirmation(match.id)}>Abrir confirmação</button>}
                <button type="button" className="ghost" onClick={() => void removeScheduledMatch(match.id)}>Remover</button>
              </div>
            </article>)}
          </div>
        </section>
      </div>}
    </>
  );
}

function OperationalMatchDialog({ api, users, activeSeasonId, onDone }: { api: ApiClient; users: User[]; activeSeasonId: string; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [draftMatchId, setDraftMatchId] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [title, setTitle] = useState('Futebol de quarta');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [refereeName, setRefereeName] = useState('');
  const [teamAName, setTeamAName] = useState('Time A');
  const [teamBName, setTeamBName] = useState('Time B');
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState<MatchDraftPlayer[]>([]);
  const [draggedUserId, setDraggedUserId] = useState('');

  const assignedIds = new Set(players.map((player) => player.userId));
  const search = query.trim().toLowerCase();
  const searchResults = search.length < 3 ? [] : users.filter((user) => !assignedIds.has(user.id) && `${user.name} ${user.email}`.toLowerCase().includes(search)).slice(0, 8);
  const pendingPlayers = players.filter((player) => player.team === 'PRESENTE_SEM_JOGAR');
  const teamA = players.filter((player) => player.team === 'A');
  const teamB = players.filter((player) => player.team === 'B');
  const teamsDrawn = teamA.length > 0 && teamB.length > 0 && pendingPlayers.length === 0;

  function selectedPlayersPayload(list = players) {
    const currentTeamA = list.filter((player) => player.team === 'A');
    const currentTeamB = list.filter((player) => player.team === 'B');
    return list.map((player) => ({
      userId: player.userId,
      team: player.team,
      roleInMatch: player.team === 'PRESENTE_SEM_JOGAR' ? 'PRESENTE_SEM_JOGAR' : player.roleInMatch,
      drawOrder: player.drawOrder ? Number(player.drawOrder) : null,
      rotationOrder: player.team === 'A' ? currentTeamA.findIndex((item) => item.userId === player.userId) + 1 : player.team === 'B' ? currentTeamB.findIndex((item) => item.userId === player.userId) + 1 : null,
      startsOnBench: player.startsOnBench,
      present: true
    }));
  }

  async function saveLineup() {
    if (!draftMatchId) return;
    await api.request(`/matches/${draftMatchId}/lineup`, { method: 'PATCH', body: JSON.stringify({ matchDate: date, title, refereeName: refereeName || null, teamAName, teamBName, players: selectedPlayersPayload() }) });
  }

  async function openPersistentDraft() {
    const created = await api.request<{ id: string }>('/matches', { method: 'POST', body: JSON.stringify({ seasonId: activeSeasonId || null, matchDate: date, title, refereeName: refereeName || null, teamAName, teamBName, players: [] }) });
    setDraftMatchId(created.id);
    setSaveStatus('Rascunho da súmula criado e salvo no banco.');
    setOpen(true);
    await onDone();
  }

  useEffect(() => {
    if (!open || !draftMatchId) return;
    if (players.length > 0 && !teamsDrawn) {
      setSaveStatus('Participantes selecionados. Faça o sorteio automático para gravar a escalação no banco.');
      return;
    }
    setSaveStatus('Salvando escalação...');
    const timer = window.setTimeout(() => {
      void saveLineup()
        .then(() => setSaveStatus('Escalação salva no banco.'))
        .catch((err) => setSaveStatus(err instanceof Error ? err.message : 'Falha ao salvar escalação.'));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [open, draftMatchId, title, date, refereeName, teamAName, teamBName, players, teamsDrawn]);

  function addParticipant(user: User) {
    const position = user.position ?? 'MC';
    setPlayers((list) => [...list, { userId: user.id, name: user.name, email: user.email, position, team: 'PRESENTE_SEM_JOGAR', roleInMatch: 'PRESENTE_SEM_JOGAR', drawOrder: String(list.length + 1), startsOnBench: false }]);
    setQuery('');
  }

  function balanceTeamsByPosition() {
    setPlayers((list) => drawBalancedTeams(list.map((player) => ({ ...player, team: player.team === 'PRESENTE_SEM_JOGAR' ? 'A' : player.team, roleInMatch: player.roleInMatch === 'PRESENTE_SEM_JOGAR' ? 'LINHA' : player.roleInMatch }))));
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
    if (!teamsDrawn) {
      setSaveStatus('Faça o sorteio/divisão automática das equipes antes de salvar a súmula.');
      return;
    }
    await saveLineup();
    setOpen(false);
    setDraftMatchId('');
    setPlayers([]);
    await onDone();
  }

  function TeamList({ team, rows }: { team: 'A' | 'B'; rows: MatchDraftPlayer[] }) {
    return <div className={`team-list drawn-team team-${team.toLowerCase()}`}><div className="team-title"><strong>{team === 'A' ? teamAName : teamBName}</strong><span>{rows.length} atletas</span></div>{rows.length === 0 ? <small className="muted">O time aparecerá aqui depois do sorteio automático.</small> : rows.map((player, index) => <div className="team-player draw-row" key={player.userId} draggable onDragStart={() => setDraggedUserId(player.userId)} onDragOver={(event) => event.preventDefault()} onDrop={() => movePlayer(draggedUserId, player.userId, team)}><span className="drag-handle">#{index + 1}</span><div className="player-meta"><b>{player.name}</b><small>{positionLabel(player.position)}</small></div><select value={player.roleInMatch} onChange={(event) => updatePlayer(player.userId, { roleInMatch: event.target.value as MatchDraftPlayer['roleInMatch'] })}><option value="LINHA">Linha</option><option value="GOLEIRO">Goleiro</option></select><label className="bench"><input type="checkbox" checked={player.startsOnBench} onChange={(event) => updatePlayer(player.userId, { startsOnBench: event.target.checked })} /> Banco</label><button type="button" className="ghost" onClick={() => removePlayer(player.userId)}>Remover</button></div>)}</div>;
  }

  const rosterRows = [...players].sort((left, right) => Number(left.drawOrder || 0) - Number(right.drawOrder || 0) || left.name.localeCompare(right.name, 'pt-BR'));
  const positionOverview = ([['GO', 'Goleiros'], ['DEFESA', 'Defesa'], ['MEIO', 'Meio'], ['ATAQUE', 'Ataque']] as const).map(([group, label]) => ({ group, label, count: players.filter((player) => positionBalanceGroup(player.position) === group).length }));
  const drawStatus = players.length < 2 ? 'Adicione pelo menos 2 atletas para liberar o sorteio.' : teamsDrawn ? 'Equipes sorteadas. Você ainda pode sortear novamente ou ajustar sequência/banco.' : 'Elenco pronto para sorteio aleatório por posições.';

  return <><button className="primary small" onClick={() => void openPersistentDraft()}>Criar jogo</button>{open && <div className="modal"><form className="card modal-card wide draw-modal" onSubmit={submit}><div className="draw-hero"><div><span className="eyebrow">Súmula inteligente</span><h2>Montar jogo por presença e sorteio</h2><p className="muted">Inclua somente quem vai participar do jogo. A divisão em {teamAName} e {teamBName} é automática, aleatória e balanceada pelas posições oficiais.</p></div><button type="button" className="ghost" onClick={() => setOpen(false)}>Fechar</button></div><div className="sheet-steps"><span className="step-chip done">1. Dados</span><span className={`step-chip ${players.length ? 'done' : 'active'}`}>2. Participantes</span><span className={`step-chip ${teamsDrawn ? 'done' : players.length >= 2 ? 'active' : ''}`}>3. Sorteio</span></div>{saveStatus && <p className="status-line">{saveStatus}</p>}<div className="match-meta draw-meta"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Título" /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /><input value={refereeName} onChange={(event) => setRefereeName(event.target.value)} placeholder="Árbitro" /><input value={teamAName} onChange={(event) => setTeamAName(event.target.value)} /><input value={teamBName} onChange={(event) => setTeamBName(event.target.value)} /></div><div className="draw-dashboard"><article><span>Elenco</span><strong>{players.length}</strong><small>atletas no jogo</small></article>{positionOverview.map((item) => <article key={item.group}><span>{item.label}</span><strong>{item.count}</strong><small>posição base</small></article>)}</div><div className="draw-action"><div><strong>{teamsDrawn ? 'Sorteio concluído' : 'Divisão automática obrigatória'}</strong><small>{drawStatus}</small></div><button type="button" className="primary draw-button" onClick={balanceTeamsByPosition} disabled={players.length < 2}>{teamsDrawn ? 'Sortear novamente' : 'Sortear times'}</button></div><div className="team-builder draw-builder"><section className="draw-pool"><h2>Participantes do jogo</h2><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar atleta por nome ou e-mail" />{query.trim().length > 0 && query.trim().length < 3 && <p className="muted">Digite pelo menos 3 caracteres.</p>}<div className="search-results draw-search">{searchResults.map((user) => <article key={user.id}><strong>{user.name}</strong><small>{user.email} • {positionLabel(user.position)}</small><div className="actions"><button type="button" className="primary small" onClick={() => addParticipant(user)}>Adicionar ao jogo</button></div></article>)}</div><div className="team-list roster-list"><div className="team-title"><strong>Elenco selecionado</strong><span>{pendingPlayers.length ? `${pendingPlayers.length} aguardando` : teamsDrawn ? 'sorteado' : 'vazio'}</span></div>{rosterRows.length === 0 ? <small className="muted">Busque e adicione todos os atletas que jogarão. Quem estiver presente e não jogar será incluído depois, na súmula aberta do jogo.</small> : rosterRows.map((player) => <div className={`team-player roster-row ${player.team === 'PRESENTE_SEM_JOGAR' ? 'pending' : ''}`} key={player.userId}><div className="player-meta"><b>{player.name}</b><small>{positionLabel(player.position)}</small></div><span className="team-badge">{player.team === 'PRESENTE_SEM_JOGAR' ? 'Aguardando' : player.team === 'A' ? teamAName : teamBName}</span><button type="button" className="ghost" onClick={() => removePlayer(player.userId)}>Remover</button></div>)}</div></section><section className="team-board draw-teams"><TeamList team="A" rows={teamA} /><TeamList team="B" rows={teamB} /></section></div><div className="draw-footer"><small>{teamsDrawn ? 'Pronto para salvar: a súmula será criada com times e roteiro de troca já calculados.' : 'O salvamento final só libera após o sorteio para impedir escalação manual incorreta.'}</small><button className="primary" disabled={!teamsDrawn}>Salvar súmula</button></div></form></div>}</>;
}

function PaymentsPanel({ api, canCoordinate, users, activeSeasonId }: { api: ApiClient; canCoordinate: boolean; users: User[]; activeSeasonId: string }) {
  const [userId, setUserId] = useState(users[0]?.id ?? '');
  const [amount, setAmount] = useState('0');
  const [bulkAmount, setBulkAmount] = useState('0');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7) + '-01');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<PaymentRecord['status']>('PAID');
  const [notes, setNotes] = useState('');
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [message, setMessage] = useState('');
  const [paymentModal, setPaymentModal] = useState<'generate' | 'register' | null>(null);

  useEffect(() => {
    if (!userId && users[0]?.id) setUserId(users[0].id);
  }, [users, userId]);

  async function loadPayments() {
    const path = canCoordinate ? `/payments${activeSeasonId ? `?seasonId=${activeSeasonId}` : ''}` : '/payments/me';
    setPayments(await api.request<PaymentRecord[]>(path));
    if (canCoordinate) setSummary(await api.request<PaymentSummary>(`/payments/summary${activeSeasonId ? `?seasonId=${activeSeasonId}` : ''}`));
  }

  useEffect(() => {
    void loadPayments().catch((err) => setMessage(err instanceof Error ? err.message : 'Falha ao carregar mensalidades.'));
  }, [activeSeasonId, canCoordinate]);

  async function save() {
    const saved = await api.request<PaymentRecord>('/payments', { method: 'PUT', body: JSON.stringify({ userId, seasonId: activeSeasonId || null, referenceMonth: month, dueDate, amountCents: Math.round(Number(amount) * 100), status, paidAt: status === 'PAID' ? new Date(`${paidAt}T12:00:00`).toISOString() : null, notes: notes || null }) });
    setMessage(saved.earnsPoint ? 'Pagamento antecipado registrado: +1 ponto na temporada.' : 'Mensalidade registrada sem ponto antecipado.');
    await loadPayments();
  }

  async function generateMonth() {
    const result = await api.request<{ generated: number }>('/payments/generate-month', { method: 'POST', body: JSON.stringify({ seasonId: activeSeasonId || null, referenceMonth: month, dueDate, amountCents: Math.round(Number(bulkAmount || amount) * 100), notes: notes || null }) });
    setMessage(`${result.generated} cobrança(s) criada(s)/atualizada(s) para atletas ativos. Pagamentos já quitados foram preservados.`);
    await loadPayments();
  }

  return (
    <section className="card compact payments-panel">
      <div className="card-head">
        <div>
          <h2>Mensalidades</h2>
          <p className="muted">Acompanhamento financeiro da temporada com ações operacionais em modal.</p>
        </div>
        {canCoordinate && <div className="actions panel-actions"><button className="primary small" onClick={() => setPaymentModal('generate')}>Gerar mês</button><button className="ghost" onClick={() => setPaymentModal('register')}>Registrar pagamento</button>{payments.length > 0 && <button className="ghost" onClick={() => downloadCsv('poka-pratika-mensalidades.csv', payments.map((payment) => ({ atleta: payment.userName ?? 'Minha mensalidade', mes: payment.referenceMonth.slice(0, 7), vencimento: payment.dueDate?.slice(0, 10), pagoEm: payment.paidAt ? payment.paidAt.slice(0, 10) : '', valor: (payment.amountCents / 100).toFixed(2), status: payment.status, pontoAntecipado: payment.earnsPoint, observacao: payment.notes ?? '' })))}>Exportar CSV</button>}</div>}
      </div>
      {canCoordinate && summary && <div className="stat-grid"><span><b>R$ {(summary.paidCents / 100).toFixed(2)}</b> recebido</span><span><b>R$ {(summary.openCents / 100).toFixed(2)}</b> aberto</span><span><b>{summary.pending}</b> pendente(s)</span><span><b>{summary.late}</b> atraso(s)</span><span><b>{summary.earlyPoints}</b> ponto(s) antecipados</span></div>}
      {!canCoordinate && <p className="muted">Você visualiza apenas sua mensalidade e se ela gerou ponto por pagamento antecipado.</p>}
      {message && <p className="muted">{message}</p>}
      <div className="table-cards payment-list">{payments.map((payment) => <article className="row-card" key={`${payment.userId ?? 'me'}-${payment.referenceMonth}`}><strong>{payment.userName ?? 'Minha mensalidade'} • {payment.referenceMonth.slice(0, 7)}</strong><span>{payment.earnsPoint ? '+1 pt' : payment.status}</span><small>Venc. {payment.dueDate?.slice(0, 10)} • Pago {payment.paidAt ? payment.paidAt.slice(0, 10) : 'não informado'} • R$ {(payment.amountCents / 100).toFixed(2)}</small>{payment.notes && <small>{payment.notes}</small>}</article>)}</div>
      {paymentModal === 'generate' && <div className="modal"><form className="card modal-card payment-card" onSubmit={(event) => { event.preventDefault(); void generateMonth().then(() => setPaymentModal(null)).catch((err) => setMessage(err instanceof Error ? err.message : 'Falha ao gerar mensalidades.')); }}><div className="card-head"><h2>Gerar mensalidades do mês</h2><button type="button" className="ghost" onClick={() => setPaymentModal(null)}>Fechar</button></div><p className="muted">Cria ou atualiza cobranças dos atletas ativos preservando pagamentos já quitados.</p><input type="month" value={month.slice(0, 7)} onChange={(event) => setMonth(`${event.target.value}-01`)} /><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} title="Data de vencimento" /><input value={bulkAmount} onChange={(event) => setBulkAmount(event.target.value)} placeholder="Valor do lote" /><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Observação" /><button className="primary">Gerar para atletas ativos</button></form></div>}
      {paymentModal === 'register' && <div className="modal"><form className="card modal-card payment-card" onSubmit={(event) => { event.preventDefault(); void save().then(() => setPaymentModal(null)).catch((err) => setMessage(err instanceof Error ? err.message : 'Falha ao registrar pagamento.')); }}><div className="card-head"><h2>Registrar pagamento</h2><button type="button" className="ghost" onClick={() => setPaymentModal(null)}>Fechar</button></div><p className="muted">Pagamento antes do vencimento gera ponto automático na temporada vinculada.</p><select value={userId} onChange={(event) => setUserId(event.target.value)}>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select><input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} title="Data de pagamento" /><input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Valor individual" /><select value={status} onChange={(event) => setStatus(event.target.value as PaymentRecord['status'])}><option value="PAID">Pago</option><option value="PENDING">Pendente</option><option value="LATE">Atrasado</option><option value="WAIVED">Isento</option></select><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Observação" /><button className="primary">Salvar individual</button></form></div>}
    </section>
  );
}

function AwardSettingsCard({ api }: { api: ApiClient }) {
  const [categories, setCategories] = useState<AwardSetting[]>([]);
  const [message, setMessage] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newMetric, setNewMetric] = useState<MetricCode>('TOTAL_POINTS');
  const [newType, setNewType] = useState<AwardType>('RANKING');
  const [newIcon, setNewIcon] = useState('🏅');

  async function loadSettings() {
    setCategories(await api.request<AwardSetting[]>('/settings/awards'));
  }

  useEffect(() => {
    void loadSettings().catch((err) => setMessage(err instanceof Error ? err.message : 'Falha ao carregar configuração de prêmios.'));
  }, []);

  async function save() {
    const updated = await api.request<AwardSetting[]>('/settings/awards', { method: 'PUT', body: JSON.stringify({ categories }) });
    setCategories(updated);
    setMessage('Central de regras salva. Rankings, votação e badges passam a usar esta configuração.');
  }

  function patchCategory(code: string, patch: Partial<AwardSetting>) {
    setCategories((list) => list.map((item) => item.code === code ? { ...item, ...patch, votingEnabled: patch.awardType === 'VOTACAO' ? true : patch.awardType ? false : item.votingEnabled } : item));
  }

  function addCategory() {
    const label = newLabel.trim();
    if (!label) {
      setMessage('Informe o nome da regra/premiação antes de adicionar.');
      return;
    }
    const code = awardCodeFromLabel(label);
    if (categories.some((item) => item.code === code)) {
      setMessage('Já existe uma regra com este nome/código. Ajuste o nome para diferenciar.');
      return;
    }
    setCategories((list) => [{
      code,
      label,
      votingEnabled: newType === 'VOTACAO',
      adminOnly: false,
      active: true,
      awardType: newType,
      metricCode: newType === 'RANKING' ? newMetric : null,
      sortDirection: 'DESC',
      winnersCount: 1,
      minGames: 0,
      voteSlots: 1,
      allowSelfVote: false,
      badgeIcon: newIcon,
      badgeColor: '#3b82f6'
    }, ...list]);
    setNewLabel('');
    setNewIcon('🏅');
    setMessage('Regra adicionada na tela. Clique em salvar para gravar no banco.');
  }

  return <section className="card compact rules-center"><div className="card-head"><div><h2>Central de regras, rankings e premiações</h2><p className="muted">Configure pontuação, acompanhamentos individuais, votação e badges sem alterar código.</p></div><button className="primary small" onClick={save}>Salvar central</button></div>{message && <p className="status-line">{message}</p>}<div className="rule-create"><input value={newLabel} onChange={(event) => setNewLabel(event.target.value)} placeholder="Nova regra: Ex. Rei dos cartões" /><select value={newType} onChange={(event) => setNewType(event.target.value as AwardType)}><option value="RANKING">Ranking automático</option><option value="VOTACAO">Votação</option><option value="SORTEIO">Sorteio/manual</option><option value="MANUAL">Premiação manual</option></select>{newType === 'RANKING' && <select value={newMetric} onChange={(event) => setNewMetric(event.target.value as MetricCode)}>{metricOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>}<input value={newIcon} onChange={(event) => setNewIcon(event.target.value)} maxLength={4} placeholder="🏅" /><button className="ghost" onClick={addCategory}>Adicionar regra</button></div><div className="table-cards rule-list">{categories.map((item) => <article className="row-card rule-card" key={item.code}><div className="rule-title"><span className="rule-icon" style={{ background: `${item.badgeColor}33`, color: item.badgeColor }}>{item.badgeIcon}</span><div><strong>{item.label}</strong><small>{item.code} • {item.awardType === 'RANKING' ? metricLabel(item.metricCode) : item.awardType === 'VOTACAO' ? 'Votação da temporada' : item.awardType === 'SORTEIO' ? 'Sorteio configurável' : 'Premiação manual'}</small></div></div><span className={`status ${item.active ? 'open' : 'danger'}`}>{item.active ? 'ativa' : 'inativa'}</span><div className="rule-grid"><input value={item.label} onChange={(event) => patchCategory(item.code, { label: event.target.value })} /><select value={item.awardType} onChange={(event) => patchCategory(item.code, { awardType: event.target.value as AwardType })}><option value="RANKING">Ranking automático</option><option value="VOTACAO">Votação</option><option value="SORTEIO">Sorteio/manual</option><option value="MANUAL">Premiação manual</option></select>{item.awardType === 'RANKING' ? <select value={item.metricCode ?? 'TOTAL_POINTS'} onChange={(event) => patchCategory(item.code, { metricCode: event.target.value as MetricCode })}>{metricOptions.map((metric) => <option key={metric.value} value={metric.value}>{metric.label}</option>)}</select> : <label className="bench"><input type="checkbox" checked={item.votingEnabled} onChange={(event) => patchCategory(item.code, { votingEnabled: event.target.checked, awardType: 'VOTACAO' })} /> Entra na votação</label>}<select value={item.sortDirection} onChange={(event) => patchCategory(item.code, { sortDirection: event.target.value as 'ASC' | 'DESC' })}><option value="DESC">Maior vence</option><option value="ASC">Menor vence</option></select><label className="field-row"><span>Vencedores</span><input type="number" min="1" max="20" value={item.winnersCount} onChange={(event) => patchCategory(item.code, { winnersCount: Number(event.target.value) })} /></label><label className="field-row"><span>Mín. jogos</span><input type="number" min="0" max="500" value={item.minGames} onChange={(event) => patchCategory(item.code, { minGames: Number(event.target.value) })} /></label><label className="field-row"><span>Votos</span><input type="number" min="1" max="7" value={item.voteSlots} onChange={(event) => patchCategory(item.code, { voteSlots: Number(event.target.value) })} /></label><label className="bench"><input type="checkbox" checked={item.allowSelfVote} onChange={(event) => patchCategory(item.code, { allowSelfVote: event.target.checked })} /> Permite voto em si</label><input value={item.badgeIcon} onChange={(event) => patchCategory(item.code, { badgeIcon: event.target.value })} maxLength={4} /><input value={item.badgeColor} onChange={(event) => patchCategory(item.code, { badgeColor: event.target.value })} /><label className="bench"><input type="checkbox" checked={item.active} onChange={(event) => patchCategory(item.code, { active: event.target.checked })} /> Ativa</label></div><small>{metricOptions.find((metric) => metric.value === item.metricCode)?.hint ?? 'Configure como votação, sorteio ou premiação manual quando não depender de cálculo automático.'}</small></article>)}</div></section>;
}

function AwardsPanel({ api, users, activeSeason, isAdmin }: { api: ApiClient; users: User[]; activeSeason?: Season; isAdmin: boolean }) {
  const [category, setCategory] = useState('CRAQUE_GALERA');
  const [votedUserId, setVotedUserId] = useState(users[0]?.id ?? '');
  const [voteUserIds, setVoteUserIds] = useState<string[]>([users[0]?.id ?? '']);
  const goalkeepers = users.filter((user) => user.position === 'GO');
  const linePlayers = users.filter((user) => user.position !== 'GO');
  const [selectionGoalkeeperId, setSelectionGoalkeeperId] = useState(goalkeepers[0]?.id ?? '');
  const [selectionLineUserIds, setSelectionLineUserIds] = useState<string[]>(Array(6).fill(''));
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
    setVoteUserIds((current) => current.length ? current.map((id, index) => id || users[index]?.id || users[0]?.id || '') : [users[0]?.id ?? '']);
    if (!selectionGoalkeeperId && goalkeepers[0]?.id) setSelectionGoalkeeperId(goalkeepers[0].id);
    setSelectionLineUserIds((current) => current.map((id, index) => id || linePlayers[index]?.id || ''));
  }, [users, votedUserId]);

  useEffect(() => {
    void loadMyVotes().catch((err) => setMessage(err instanceof Error ? err.message : 'Falha ao carregar seus votos.'));
    void loadResults().catch((err) => setMessage(err instanceof Error ? err.message : 'Falha ao carregar resultados.'));
  }, [activeSeason?.id, isAdmin]);

  useEffect(() => {
    const selectionVotes = myVotes.filter((voteItem) => voteItem.categoryCode === 'SELECAO_ANO');
    const goalkeeperVote = selectionVotes.find((voteItem) => voteItem.voteSlot === 1);
    const lineVotes = selectionVotes.filter((voteItem) => voteItem.voteSlot > 1).sort((left, right) => left.voteSlot - right.voteSlot);
    if (goalkeeperVote) setSelectionGoalkeeperId(goalkeeperVote.votedUserId);
    if (lineVotes.length) setSelectionLineUserIds(Array.from({ length: 6 }, (_, index) => lineVotes[index]?.votedUserId ?? linePlayers[index]?.id ?? ''));
  }, [myVotes]);

  async function vote() {
    if (!activeSeason) return;
    if (category === 'SELECAO_ANO') {
      const selectedIds = [selectionGoalkeeperId, ...selectionLineUserIds].filter(Boolean);
      if (selectedIds.length !== 7 || new Set(selectedIds).size !== 7) {
        setMessage('Seleção do ano precisa ter 1 goleiro e 6 jogadores de linha diferentes.');
        return;
      }
      await api.request('/awards/selection-year', { method: 'POST', body: JSON.stringify({ seasonId: activeSeason.id, goalkeeperUserId: selectionGoalkeeperId, lineUserIds: selectionLineUserIds }) });
    } else {
      const slots = categories.find((item) => item.code === category)?.voteSlots ?? 1;
      const votes = Array.from({ length: slots }, (_item, index) => voteUserIds[index] || votedUserId || users[index]?.id || users[0]?.id || '').filter(Boolean);
      if (votes.length !== slots || new Set(votes).size !== votes.length) {
        setMessage('Revise os votos: a categoria exige atletas preenchidos e sem repetição.');
        return;
      }
      await api.request('/awards/vote', { method: 'POST', body: JSON.stringify({ seasonId: activeSeason.id, categoryCode: category, votes }) });
    }
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
  const voteMap = new Map(myVotes.filter((item) => item.categoryCode !== 'SELECAO_ANO').map((item) => [item.categoryCode, users.find((user) => user.id === item.votedUserId)?.name ?? 'Atleta removido']));
  const selectionVoteNames = myVotes.filter((item) => item.categoryCode === 'SELECAO_ANO').sort((left, right) => left.voteSlot - right.voteSlot).map((item) => users.find((user) => user.id === item.votedUserId)?.name ?? 'Atleta removido');
  const selectionDuplicate = new Set([selectionGoalkeeperId, ...selectionLineUserIds].filter(Boolean)).size !== [selectionGoalkeeperId, ...selectionLineUserIds].filter(Boolean).length;
  const selectedCategory = categories.find((item) => item.code === category);
  const selectedVoteSlots = category === 'SELECAO_ANO' ? 1 : selectedCategory?.voteSlots ?? 1;
  const genericVotes = Array.from({ length: selectedVoteSlots }, (_item, index) => voteUserIds[index] || votedUserId || users[index]?.id || users[0]?.id || '');
  const genericVoteDuplicate = category !== 'SELECAO_ANO' && new Set(genericVotes.filter(Boolean)).size !== genericVotes.filter(Boolean).length;

  return <div className="grid two"><section className="card compact"><h2>Votação dos prêmios</h2><p className="muted">Escolha com carinho. O voto é sigiloso; a resenha fica para depois.</p><div className="inline-form"><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select>{category !== 'SELECAO_ANO' && <select value={votedUserId} onChange={(event) => setVotedUserId(event.target.value)}>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select>}<button className="primary" onClick={vote} disabled={!activeSeason || activeSeason.status !== 'CLOSED' || !categories.length || (category === 'SELECAO_ANO' && selectionDuplicate)}>Votar</button></div>{category === 'SELECAO_ANO' && <div className="selection-grid"><label><span>Goleiro da seleção</span><select value={selectionGoalkeeperId} onChange={(event) => setSelectionGoalkeeperId(event.target.value)}>{goalkeepers.map((user) => <option key={user.id} value={user.id}>{user.name} • {positionLabel(user.position)}</option>)}</select></label>{selectionLineUserIds.map((lineUserId, index) => <label key={`linha-${index}`}><span>Linha {index + 1}</span><select value={lineUserId} onChange={(event) => setSelectionLineUserIds((list) => list.map((current, currentIndex) => currentIndex === index ? event.target.value : current))}>{linePlayers.map((user) => <option key={user.id} value={user.id}>{user.name} • {positionLabel(user.position)}</option>)}</select></label>)}<small className="muted">Seleção do ano: 1 goleiro + 6 jogadores de linha diferentes.</small>{selectionDuplicate && <small className="muted">A seleção não pode repetir atleta.</small>}</div>}{activeSeason?.status !== 'CLOSED' && <p className="muted">A votação abre quando a temporada for encerrada.</p>}{message && <p className="muted">{message}</p>}<div className="chips">{categories.map((item) => <span className="chip" key={item.code}>{item.label}: {item.code === 'SELECAO_ANO' ? selectionVoteNames.length === 7 ? selectionVoteNames.join(', ') : 'sem voto' : voteMap.get(item.code) ?? 'sem voto'}</span>)}</div><div className="award-cards"><article><strong>🏆 Ranking automático</strong><span>Campeão, vice, terceiro, artilheiro, garçom e assiduidade geram prêmios e badges no fechamento.</span></article><article><strong>🗳️ Voto dos atletas</strong><span>Seleção do ano recebe 7 votos: 1 GO e 6 linhas. Demais categorias recebem voto único.</span></article></div></section><section className="card compact"><div className="card-head"><h2>Apuração ADMIN</h2>{isAdmin && activeSeason && <button className="primary small" onClick={consolidate}>Consolidar</button>}</div>{!isAdmin ? <EmptyState title="Resultado sigiloso" text="A apuração fica protegida e só aparece para ADMIN." /> : Object.keys(groupedResults).length === 0 ? <EmptyState title="Sem votos ainda" text="Quando os atletas votarem, a liderança de cada categoria aparece aqui." /> : <div className="table-cards">{Object.entries(groupedResults).map(([label, rows]) => <article className="row-card" key={label}><strong>{label}</strong><span>{rows[0]?.name}</span><small>{rows.slice(0, label === 'Seleção do ano' ? 8 : 3).map((row) => `${label === 'Seleção do ano' ? row.voteSlot === 1 ? 'GO ' : 'LINHA ' : ''}${row.name}: ${row.votes}`).join(' • ')}</small></article>)}</div>}</section></div>;
}

function AwardLeaderboardsPanel({ api, activeSeason }: { api: ApiClient; activeSeason?: Season }) {
  const [boards, setBoards] = useState<AwardLeaderboard[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!activeSeason) return;
    api.request<AwardLeaderboard[]>(`/awards/leaderboards/${activeSeason.id}`)
      .then(setBoards)
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Falha ao carregar acompanhamentos configurados.'));
  }, [api, activeSeason?.id]);

  return <section className="card compact span"><div className="card-head"><div><h2>Acompanhamentos configurados</h2><p className="muted">Rankings automáticos definidos na Central de Regras, usando dados reais das súmulas.</p></div><span className="status open">{boards.length} regra(s)</span></div>{message && <p className="muted">{message}</p>}<div className="award-board-grid">{boards.length === 0 ? <EmptyState title="Sem acompanhamentos ativos" text="Crie regras de ranking automático na configuração de prêmios para acompanhar métricas individuais." /> : boards.map((board) => <article className="award-board" key={board.code}><div className="rule-title"><span className="rule-icon" style={{ background: `${board.badgeColor}33`, color: board.badgeColor }}>{board.badgeIcon}</span><div><strong>{board.label}</strong><small>{metricLabel(board.metricCode)} • {board.sortDirection === 'DESC' ? 'maior vence' : 'menor vence'} • mínimo {board.minGames} jogo(s)</small></div></div>{board.rows.length === 0 ? <small className="muted">Sem dados suficientes nesta temporada.</small> : board.rows.map((row) => <span className="board-row" key={`${board.code}-${row.userId}`}><b>{row.position}º {row.name}</b><em>{Number(row.value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</em></span>)}</article>)}</div></section>;
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
  const [userPosition, setUserPosition] = useState<AthletePosition>('MC');
  const [message, setMessage] = useState('');
  const [standingPaste, setStandingPaste] = useState('');
  const [importResult, setImportResult] = useState<StandingImportResult | null>(null);
  const [seasonName, setSeasonName] = useState('Temporada 2026');
  const [seasonYear, setSeasonYear] = useState(2026);
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [adminModal, setAdminModal] = useState<'season' | 'points' | 'user' | 'import' | null>(null);

  useEffect(() => setDraftPoints(points), [points]);

  async function savePoints() {
    await api.request('/settings/points', { method: 'PUT', body: JSON.stringify({ settings: draftPoints.map(({ code, points }) => ({ code, points })) }) });
    await onReload();
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    const payload = await api.request<{ activationEmailSent?: boolean }>('/users', { method: 'POST', body: JSON.stringify({ name, email, password: password || undefined, role: isAdmin ? role : 'ATLETA', position: userPosition }) });
    setMessage(password ? 'Usuário criado com senha inicial definida.' : payload.activationEmailSent ? 'Usuário criado e convite de ativação enviado por e-mail.' : 'Usuário criado. O Graph não confirmou envio; use recuperação de senha se necessário.');
    setName(''); setEmail(''); setPassword(''); setUserPosition('MC');
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

  return (
    <div className="home-stack admin-home">
      <section className="card compact">
        <div className="card-head">
          <div><h2>Configuração operacional</h2><p className="muted">Ações críticas ficam em modais para manter a tela principal limpa e auditável.</p></div>
          {message && <span className="status open">{message}</span>}
        </div>
        <div className="admin-action-grid">
          <button className="row-card as-button" onClick={() => setAdminModal('season')}><strong>Criar temporada</strong><span>{seasons.length}</span><small>Abra novas temporadas, depois inicie ou encerre pela lista abaixo.</small></button>
          <button className="row-card as-button" onClick={() => setAdminModal('points')}><strong>Pontuação</strong><span>{draftPoints.length}</span><small>Ajuste regras dinâmicas sem alterar código.</small></button>
          <button className="row-card as-button" onClick={() => setAdminModal('user')}><strong>Novo usuário</strong><span>{users.length}</span><small>Crie atletas e convites de ativação reais por e-mail.</small></button>
          {isAdmin && <button className="row-card as-button" onClick={() => setAdminModal('import')} disabled={!activeSeasonId}><strong>Importar Excel</strong><span>{importResult?.imported.length ?? 0}</span><small>Atualize saldo inicial da temporada ativa via colagem do Excel.</small></button>}
        </div>
      </section>
      <section className="card compact"><div className="card-head"><h2>Temporadas</h2><span className="status open">{seasons.length} registro(s)</span></div><div className="table-cards admin-list">{seasons.map((season) => <article className="row-card" key={season.id}><strong>{season.name} • {season.year}</strong><span className={`status ${season.status.toLowerCase()}`}>{season.status}</span><small>{season.startsOn?.slice(0, 10) ?? 'sem início'} até {season.endsOn?.slice(0, 10) ?? 'sem fim'}</small><div className="actions">{season.status !== 'OPEN' && season.status !== 'CLOSED' && <button className="primary small" onClick={() => void startSeason(season.id)}>Iniciar</button>}{season.status === 'OPEN' && <button className="ghost" onClick={() => void closeSeason(season.id)}>Encerrar e liberar votação</button>}</div></article>)}</div></section>
      <section className="card compact"><div className="card-head"><h2>Usuários</h2><span className="status open">{users.length} pessoa(s)</span></div><div className="table-cards admin-users">{users.map((user) => <UserAdminRow key={user.id} api={api} user={user} isAdmin={isAdmin} onReload={onReload} />)}</div></section>
      {adminModal === 'season' && <div className="modal"><form className="card modal-card admin-modal-card" onSubmit={(event) => { void createSeason(event).then(() => setAdminModal(null)).catch((err) => setMessage(err instanceof Error ? err.message : 'Falha ao criar temporada.')); }}><div className="card-head"><h2>Criar temporada</h2><button type="button" className="ghost" onClick={() => setAdminModal(null)}>Fechar</button></div><input value={seasonName} onChange={(event) => setSeasonName(event.target.value)} placeholder="Nome da temporada" required /><input type="number" value={seasonYear} onChange={(event) => setSeasonYear(Number(event.target.value))} min="2000" max="2100" /><input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /><input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /><button className="primary">Criar temporada</button></form></div>}
      {adminModal === 'points' && <div className="modal"><section className="card modal-card admin-modal-card"><div className="card-head"><h2>Pontuação configurável</h2><button type="button" className="ghost" onClick={() => setAdminModal(null)}>Fechar</button></div>{draftPoints.map((item, index) => <label className="field-row" key={item.code}><span>{item.label}</span><input type="number" value={item.points} onChange={(event) => setDraftPoints((list) => list.map((current, currentIndex) => currentIndex === index ? { ...current, points: Number(event.target.value) } : current))} /></label>)}<button className="primary" onClick={() => void savePoints().then(() => setAdminModal(null)).catch((err) => setMessage(err instanceof Error ? err.message : 'Falha ao salvar pontuação.'))}>Salvar pontuação</button></section></div>}
      {adminModal === 'user' && <div className="modal"><form className="card modal-card admin-modal-card" onSubmit={(event) => { void createUser(event).then(() => setAdminModal(null)).catch((err) => setMessage(err instanceof Error ? err.message : 'Falha ao criar usuário.')); }}><div className="card-head"><h2>Novo usuário</h2><button type="button" className="ghost" onClick={() => setAdminModal(null)}>Fechar</button></div><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome" required /><input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-mail" type="email" required /><input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha inicial opcional" type="password" minLength={8} />{isAdmin ? <select value={role} onChange={(event) => setRole(event.target.value as 'ADMIN' | 'COORDENADOR' | 'ATLETA')}><option>ATLETA</option><option>COORDENADOR</option><option>ADMIN</option></select> : <span className="status">Novo usuário será ATLETA</span>}<select value={userPosition} onChange={(event) => setUserPosition(event.target.value as AthletePosition)}>{athletePositionOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><button className="primary">Criar/enviar convite</button></form></div>}
      {isAdmin && adminModal === 'import' && <div className="modal"><section className="card modal-card wide"><div className="card-head"><h2>Importar tabela atual do Excel</h2><button type="button" className="ghost" onClick={() => setAdminModal(null)}>Fechar</button></div><p className="muted">Cole do Excel com cabeçalho. Use e-mail para casar atletas com segurança.</p><textarea className="paste-box" value={standingPaste} onChange={(event) => setStandingPaste(event.target.value)} placeholder="nome\temail\tpontos\tjogos\tpresenças\tv\te\td\tgols\tgols contra\tassistências\tmarcados\tsofridos" /><button className="primary" onClick={() => void importStandings().then(() => setAdminModal(null)).catch((err) => setMessage(err instanceof Error ? err.message : 'Falha ao importar Excel.'))} disabled={!activeSeasonId}>Importar saldo</button>{importResult && <div className="chips"><span className="chip trophy">Importados: {importResult.imported.length}</span>{importResult.skipped.map((item) => <span className="chip danger" key={`${item.identifier}-${item.reason}`}>{item.identifier}: {item.reason}</span>)}</div>}</section></div>}
    </div>
  );
}

function UserAdminRow({ api, user, isAdmin, onReload }: { api: ApiClient; user: User; isAdmin: boolean; onReload: () => Promise<void> }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<User['role']>(user.role);
  const [position, setPosition] = useState<AthletePosition>(user.position ?? 'MC');
  const [active, setActive] = useState(user.active !== false);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setName(user.name);
    setEmail(user.email);
    setRole(user.role);
    setPosition(user.position ?? 'MC');
    setActive(user.active !== false);
    setPassword('');
  }, [user.id, user.name, user.email, user.role, user.position, user.active]);

  async function save() {
    await api.request(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ name, email, role, position, active }) });
    setMessage('Usuário atualizado.');
    await onReload();
  }

  async function sendActivation() {
    const result = await api.request<{ activationEmailSent: boolean }>(`/users/${user.id}/send-activation`, { method: 'POST' });
    setMessage(result.activationEmailSent ? 'Convite enviado por e-mail.' : 'Convite gerado; Graph não confirmou envio. Use recuperação de senha se necessário.');
  }

  async function changePassword() {
    if (password.length < 8) {
      setMessage('A senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    await api.request(`/users/${user.id}/password`, { method: 'POST', body: JSON.stringify({ password }) });
    setPassword('');
    setMessage('Senha redefinida pelo ADMIN.');
  }

  return <article className="row-card"><strong>{user.name}</strong><span className={`status ${active ? 'open' : 'danger'}`}>{active ? 'ativo' : 'inativo'}</span><small>{user.email} • {user.role} • {positionLabel(user.position)}</small>{isAdmin ? <div className="actions"><button className="ghost" onClick={() => setOpen(true)}>Editar</button><button className="ghost" onClick={() => void sendActivation()}>Reenviar convite</button></div> : <small>{user.role} • {positionLabel(user.position)}</small>}{message && <small className="muted">{message}</small>}{open && <div className="modal"><form className="card modal-card admin-modal-card" onSubmit={(event) => { event.preventDefault(); void save().then(() => setOpen(false)).catch((err) => setMessage(err instanceof Error ? err.message : 'Falha ao salvar usuário.')); }}><div className="card-head"><h2>Editar usuário</h2><button type="button" className="ghost" onClick={() => setOpen(false)}>Fechar</button></div><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome" /><input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-mail" type="email" /><select value={role} onChange={(event) => setRole(event.target.value as User['role'])}><option>ATLETA</option><option>COORDENADOR</option><option>ADMIN</option></select><select value={position} onChange={(event) => setPosition(event.target.value as AthletePosition)}>{athletePositionOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><select value={active ? 'true' : 'false'} onChange={(event) => setActive(event.target.value === 'true')}><option value="true">Ativo</option><option value="false">Inativo</option></select><button className="primary">Salvar cadastro</button><div className="inline-form"><input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Nova senha" type="password" minLength={8} /><button type="button" className="ghost" onClick={() => void changePassword()}>Redefinir senha</button><button type="button" className="ghost" onClick={() => void sendActivation()}>Reenviar convite</button></div>{message && <p className="muted">{message}</p>}</form></div>}</article>;
}
