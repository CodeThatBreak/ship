/**
 * The template editor route's page-local public surface (§1.7 barrel): the
 * client island the server page hydrates, plus the layout skeleton app/
 * templates/[id]/loading.tsx mirrors. Everything else in this folder is
 * internal to the route.
 */
export { TemplateEditor, type TemplateEditorProps } from "./EditorPage";
export { EditorLoading } from "./EditorLoading";
export {
  repoChoicesQueryOptions,
  fetchRepoChoices,
} from "./queries";
