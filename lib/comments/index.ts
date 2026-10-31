import "server-only";

import { processSingleton } from "../singleton";
import { CommentService } from "./comment-service";

export const commentService = processSingleton("commentService", () => new CommentService());

export { CommentService } from "./comment-service";
export type { ApiComment } from "./comment-service";
