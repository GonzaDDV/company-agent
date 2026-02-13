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
  { telegramId: '5107171686', name: 'MRG', companies: ['thc', 'patagon'] },
];

export function getTeamMember(telegramId: string): TeamMember | undefined {
  return TEAM.find((m) => m.telegramId === telegramId);
}

export function isTeamMember(telegramId: string): boolean {
  return TEAM.some((m) => m.telegramId === telegramId);
}
