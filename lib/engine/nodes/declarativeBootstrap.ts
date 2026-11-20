import "server-only";

import { wireDeclarativeResolver } from "./utils/declarativeResolverWire";
import { declarativeDef } from "./declarative";
import "./declarativeWiring";

wireDeclarativeResolver(declarativeDef);
