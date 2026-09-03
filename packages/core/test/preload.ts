import path from "path"

process.env.REDCODE_DB = ":memory:"
process.env.REDCODE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.REDCODE_DISABLE_MODELS_FETCH = "true"
