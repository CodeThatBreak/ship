import {
  Braces,
  CircleCheck,
  CircleX,
  FileDiff,
  SquareText,
  FileText,
  Gauge,
  ListTodo,
  MessageSquareCheck,
  ScrollText,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { ARTIFACT_KIND } from '../../../artifacts/constants/artifactKinds';
import { AGENT_VIEW_TAB } from '../constants/tabs';

/** Unknown (or future) artifact kinds still get a sensible, neutral icon. */
const FALLBACK_TAB_ICON: LucideIcon = FileText;

/** One icon per tab value: the fixed tabs plus every known artifact kind. */
const TAB_ICONS: Record<string, LucideIcon> = {
  [AGENT_VIEW_TAB.OUTPUT]: SquareText,
  [ARTIFACT_KIND.MARKDOWN]: FileText,
  [ARTIFACT_KIND.JSON]: Braces,
  [ARTIFACT_KIND.DIFF]: FileDiff,
  [ARTIFACT_KIND.PLAN]: ListTodo,
  [ARTIFACT_KIND.USAGE]: Gauge,
  [ARTIFACT_KIND.TRANSCRIPT]: ScrollText,
  [ARTIFACT_KIND.PIPELINE]: Workflow,
  [ARTIFACT_KIND.REVIEW]: MessageSquareCheck,
  [ARTIFACT_KIND.RESOLVE]: CircleCheck,
  [ARTIFACT_KIND.FAILED_OUTPUT]: CircleX,
};

/** The icon component for a tab value. */
export const tabIcon = (value: string): LucideIcon => TAB_ICONS[value] ?? FALLBACK_TAB_ICON;
