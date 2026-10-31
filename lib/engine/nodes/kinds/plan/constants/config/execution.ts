import "server-only";

import type { ConfigField } from '../../../../../templates/nodeConfig';

const EXECUTION_CONFIG: ConfigField = {
  key: 'execution_default',
  label: 'Execution resolution',
  type: 'select',
  help:
    'How the work after this plan executes once approved: whole (one run — the default), follow ' +
    '(the planner decides per plan version — its "steps" choice fans the plan\'s branches out as one child flow per branch via the split runtime, overridable at approve).',
  options: [
    { value: 'whole', label: 'whole', description: 'Everything executes as one run (default)' },
    {
      value: 'follow',
      label: 'follow',
      description:
        'The planner decides per plan version — "steps" fans the branches out as one child flow per branch (overridable at approve)',
    },
  ],
};

export { EXECUTION_CONFIG };
