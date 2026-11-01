import "server-only";

import type { ConfigField } from '../../../../../templates/nodeConfig';

const PROMPT_BODY: ConfigField = {
  key: 'prompt_body',
  label: 'Prompt body',
  type: 'text',
  help: 'User-editable prompt body; internal output contracts are appended automatically.',
};

export { PROMPT_BODY };
