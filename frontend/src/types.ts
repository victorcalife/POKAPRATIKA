export type Role = 'ADMIN' | 'COORDENADOR' | 'ATLETA';
export type AthletePosition = 'GO' | 'ZG' | 'LD' | 'LE' | 'MD' | 'MC' | 'MA' | 'AT';

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  position?: AthletePosition;
  avatarDataUrl?: string | null;
  active?: boolean;
};

export type Season = {
  id: string;
  name: string;
  year: number;
  status: 'DRAFT' | 'OPEN' | 'CLOSED';
  votingOpen: boolean;
  startsOn?: string | null;
  endsOn?: string | null;
};

export type Standing = {
  user_id: string;
  name: string;
  position: number;
  games_played: number;
  presences: number;
  wins: number;
  draws: number;
  losses: number;
  paid_months: number;
  goals: number;
  own_goals: number;
  net_goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  blue_cards: number;
  card_points: number;
  total_cards: number;
  team_goals_for: number;
  team_goals_against: number;
  team_goal_balance: number;
  total_points: number;
  avatarDataUrl?: string | null;
};

export type MatchListItem = {
  id: string;
  seasonId?: string | null;
  matchDate: string;
  title: string;
  refereeName?: string | null;
  status: string;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  confirmationOpenAt?: string | null;
  confirmationOpensHoursBefore?: number;
  confirmationOpenedAt?: string | null;
  confirmationOpen?: boolean;
  scheduleSource?: 'MANUAL' | 'RECURRING';
  attendancePlaying?: number;
  attendancePresentOnly?: number;
  attendanceAbsent?: number;
  myAttendanceStatus?: 'JOGAR' | 'PRESENTE_SEM_JOGAR' | 'AUSENTE' | null;
  teamAName: string;
  teamBName: string;
  teamAScore: number;
  teamBScore: number;
};

export type PointSetting = { code: string; label: string; points: number };
