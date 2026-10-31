import "server-only";

import type { ConfigField } from '../../../../../templates/nodeConfig';

const DECOMPOSE_CONFIG: ConfigField = {
  key: 'decompose_default',
  label: 'Decompose by default',
  type: 'boolean',
  help: 'Run repo-exploration sub-agents by default.',
};

export { DECOMPOSE_CONFIG };
