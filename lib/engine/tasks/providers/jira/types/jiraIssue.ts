export interface JiraIssue {
  id: string;
  key: string;
  summary: string;
  description: string;
  status: string;
  issueType: string;
  priority: string;
  prdText: string;
  figmaUrls: string[];
  externalUrl: string;
  /** Parent issue key when this is a sub-task (e.g. a story's child). */
  parentKey: string;
  raw: unknown;
}
