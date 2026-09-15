import { Schema } from "effect"
import { Parameters } from "../../src/tool/shell/prompt"
import { shellPollingProbes } from "../../../core/test/fixture/shell-polling-probes"

shellPollingProbes(Schema.decodeUnknownSync(Parameters))
