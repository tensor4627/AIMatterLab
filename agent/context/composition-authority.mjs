import {graphAuthorityFacts} from "../../backend/main/workspace/composition-authority.mjs";
import {formatGraphAuthorityContext} from "./task-turn-context.mjs";

export {sourceAuthority,synchronizeGraphMirrors,protectGraphMirrors,reviewGraph,graphAuthorityFacts} from "../../backend/main/workspace/composition-authority.mjs";

export function graphAuthorityContext(task){return formatGraphAuthorityContext(graphAuthorityFacts(task));}
