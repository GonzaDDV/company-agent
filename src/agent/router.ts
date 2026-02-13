import { env } from '../config/env.js';

export interface ModelConfig {
  fast: string;
  smart: string;
}

export interface RouteResult {
  model: string;
  tier: 'fast' | 'smart';
  reason: string;
}

export function getModelConfig(): ModelConfig {
  return {
    fast: env.MODEL_FAST,
    smart: env.MODEL_SMART,
  };
}

export function selectModel(
  config: ModelConfig,
  round: number,
  hasImage: boolean,
): RouteResult {
  // Images benefit from stronger vision reasoning
  if (round === 0 && hasImage) {
    return { model: config.smart, tier: 'smart', reason: 'image input' };
  }

  // Tool follow-up rounds need stronger reasoning
  if (round > 0) {
    return { model: config.smart, tier: 'smart', reason: `tool round ${round}` };
  }

  // Default: start with fast model
  return { model: config.fast, tier: 'fast', reason: 'initial' };
}
