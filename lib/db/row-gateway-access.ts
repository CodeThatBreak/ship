import "server-only";

import { rows, type RowGateway } from "./rows";

export const getRowGateway = (): RowGateway => rows;
