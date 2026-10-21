import { canonicalJson, sha256 } from "../util";
import type { WorkflowDefinition } from "./definition";

/** Content hash over canonical JSON; recorded on every published version. */
export function contentHash(def: WorkflowDefinition): string {
  return `sha256:${sha256(canonicalJson(def))}`;
}
