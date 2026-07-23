export type LinePlayerRotationInput = {
  id: string;
  name: string;
  rotationOrder: number;
  startsOnBench: boolean;
};

export type TeamRotationPlan = {
  reserves: number;
  firstCycleMinutes: number;
  secondCycleMinutes: number;
  exchangeSize: number;
  schedule: Array<{
    minute: number;
    label: string;
    entering: string[];
    leaving: string[];
  }>;
};

const legacySheetSchedules: Record<number, number[]> = {
  1: [8, 16, 24, 32, 40, 48, 56],
  2: [9, 18, 27, 36, 41, 46, 51, 56],
  3: [10, 20, 30, 39, 48, 57]
};

const legacyCycleMinutes: Record<number, { first: number; second: number }> = {
  1: { first: 8, second: 0 },
  2: { first: 9, second: 5 },
  3: { first: 10, second: 9 }
};

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function buildTeamRotationPlan(players: LinePlayerRotationInput[], availableMinutes: number): TeamRotationPlan {
  const ordered = [...players].sort((a, b) => a.rotationOrder - b.rotationOrder);
  const bench = ordered.filter((player) => player.startsOnBench);
  const reserves = Math.max(0, ordered.length - 6);
  const exchangeSize = Math.max(1, bench.length);

  if (reserves === 0 || bench.length === 0) {
    return { reserves, firstCycleMinutes: 0, secondCycleMinutes: 0, exchangeSize: 0, schedule: [] };
  }

  const groups = chunk(ordered, exchangeSize);
  const scheduleMinutes = legacySheetSchedules[reserves] ?? Array.from({ length: Math.max(1, Math.floor(availableMinutes / 8)) }, (_, index) => Math.min(availableMinutes - 1, (index + 1) * 8));
  const cycle = legacyCycleMinutes[reserves] ?? { first: Math.min(10, Math.max(6, Math.floor(availableMinutes / Math.max(4, groups.length * 2)))), second: 5 };

  const schedule = scheduleMinutes
    .filter((minute) => minute < availableMinutes)
    .map((minute, index) => {
      const enteringGroup = groups[index % groups.length];
      const leavingGroup = groups[(index + 1) % groups.length];
      return {
        minute,
        label: `${index + 1}ª troca`,
        entering: enteringGroup.map((player) => player.name),
        leaving: leavingGroup.map((player) => player.name)
      };
    });

  return { reserves, firstCycleMinutes: cycle.first, secondCycleMinutes: cycle.second, exchangeSize, schedule };
}
