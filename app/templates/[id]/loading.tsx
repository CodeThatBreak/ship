import { EditorLoading } from '@/components/builder/components/EditorLoading';

/**
 * Template editor loading state: the fullscreen builder layout skeleton
 * (header bar, node palette rail, empty canvas). The layout lives in the
 * route's domain folder so the client island's inline "waiting for data"
 * state renders the exact same mirror (AGENTS.md §2.8).
 */
export default function TemplateEditorLoading() {
  return <EditorLoading />;
}
