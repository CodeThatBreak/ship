import { PROMPT_BODY, PROMPT_RULES } from './prompt';
import { EXECUTION_CONFIG } from './execution';
import { DECOMPOSE_CONFIG } from './decompose';
import { mcpSourceConfigFields } from '../../../../../templates/node-config';

import type { ConfigField } from '../../../../../templates/node-config';

const AGENT_CONFIG_FIELDS: readonly ConfigField[] = [
  PROMPT_BODY,
  PROMPT_RULES,
  EXECUTION_CONFIG,
  DECOMPOSE_CONFIG,
  ...mcpSourceConfigFields,
];

export { AGENT_CONFIG_FIELDS };
