import { MediaGetEndpoint } from "./media.js"
import { PersistentPtyGroup } from "./persistent-pty.js"

/** Routes under /api/experimental without compatibility guarantees. */
export const ExperimentalGroup = PersistentPtyGroup.add(MediaGetEndpoint)
