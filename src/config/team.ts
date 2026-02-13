export interface TeamMember {
  telegramId: string;
  name: string;
  companies: ('thc' | 'patagon')[];
}

/**
 * Configure team members here.
 * Each member needs their Telegram user ID (get it by messaging @userinfobot on Telegram).
 */
export const TEAM: TeamMember[] = [
  // { telegramId: '123456789', name: 'John', companies: ['thc', 'patagon'] },
  // { telegramId: '987654321', name: 'Jane', companies: ['thc'] },
];

export function getTeamMember(telegramId: string): TeamMember | undefined {
  return TEAM.find((m) => m.telegramId === telegramId);
}

export function isTeamMember(telegramId: string): boolean {
  return TEAM.some((m) => m.telegramId === telegramId);
}
