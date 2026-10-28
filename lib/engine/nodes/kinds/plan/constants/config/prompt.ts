import type { ConfigField } from '../../../../../templates/node-config';

const PROMPT_BODY: ConfigField = {
  key: 'prompt_body',
  label: 'Prompt body',
  type: 'text',
  help: 'User-editable prompt body; internal output contracts are appended automatically.',
};

const PROMPT_RULES: ConfigField = {
  key: 'prompt_rules',
  label: 'Your rules',
  type: 'text',
  help: 'Extra rules appended after the prompt body, before the engine\'s locked instructions (output contract, run data) — on every run of this node. E.g. "always ask before assuming a framework".',
};

export { PROMPT_BODY, PROMPT_RULES };
