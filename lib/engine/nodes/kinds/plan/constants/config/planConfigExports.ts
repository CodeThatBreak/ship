import 'server-only';

import { PROMPT_BODY } from './prompt';
import { EXECUTION_CONFIG } from './execution';
import { mcpSourceConfigFields } from '../../../../../templates/nodeConfig';

import type { ConfigField } from '../../../../../templates/nodeConfig';

const AGENT_CONFIG_FIELDS: readonly ConfigField[] = [PROMPT_BODY, EXECUTION_CONFIG, ...mcpSourceConfigFields];

export { AGENT_CONFIG_FIELDS };
