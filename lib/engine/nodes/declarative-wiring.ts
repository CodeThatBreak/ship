import "server-only";

/** Side-effect imports: each module registers its kind on `declarativeKindRegistry`. */
import "./kinds/agent/agent-node";
import "./kinds/decision/decision-node";
import "./kinds/http/http-node";
import "./kinds/script/script-node";
