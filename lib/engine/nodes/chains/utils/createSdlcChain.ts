import "server-only";

import { SdlcChain } from "../sdlcChain";
import type { ChainHost } from "../types/chainHost";

/** Build the SDLC builtin chain over an engine host. */
export const createSdlcChain = (host: ChainHost): SdlcChain => new SdlcChain(host);
