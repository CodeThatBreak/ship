import "server-only";

import { wireDeclarativeResolver } from "./registry";
import { declarativeDef } from "./declarative";
import "./declarativeWiring";

wireDeclarativeResolver(declarativeDef);
