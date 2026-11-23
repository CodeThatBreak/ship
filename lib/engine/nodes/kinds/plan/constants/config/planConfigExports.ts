import 'server-only';

import { PROMPT_BODY } from './prompt';
import { mcpSourceConfigFields } from '../../../../../templates/nodeConfig';

import type { ConfigField } from '../../../../../templates/nodeConfig';

const AGENT_CONFIG_FIELDS: readonly ConfigField[] = [PROMPT_BODY, ...mcpSourceConfigFields];

export { AGENT_CONFIG_FIELDS };
