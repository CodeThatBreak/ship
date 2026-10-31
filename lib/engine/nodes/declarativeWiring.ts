import "server-only";

/** Side-effect imports: each module registers its kind on `declarativeKindRegistry`. */
import "./kinds/agent/agentNode";
import "./kinds/decision/decisionNode";
import "./kinds/http/httpNode";
import "./kinds/script/scriptNode";
