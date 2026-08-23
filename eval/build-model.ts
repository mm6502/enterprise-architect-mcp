/**
 * Builds the eval model into a temp directory and prints its path, so a human can
 * point a server at it for manual subagent dispatch. The automated runner builds
 * and cleans up its own copy — this one is deliberately left on disk.
 */
import { buildEvalModel } from "./fixture.js";

console.log(buildEvalModel().path);
