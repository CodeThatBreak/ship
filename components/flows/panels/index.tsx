'use client';
/**
 * Panel registration (§3.1): importing this module imports every panel, and
 * each panel self-registers with the registry at module import. Add a new
 * panel by creating its module and listing it here — NodePanel never changes.
 */
import '../components/plan/PlanView';
import './ReviewView';
import './AgentView';
import './DeclarativeView';
import './StartView';
import './BuildView';
import './PipelineView';
import './ResolveView';

export { resolvePanel, registerPanel, type PanelProps, type PanelMatcher } from './registry';
