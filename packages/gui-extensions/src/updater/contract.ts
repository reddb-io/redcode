import { Schema } from "effect"
import { Ipc } from "../sdk"

/** Updates run the installation's `redcode upgrade`, which updates the CLI, the design app and the desktop together. */
export const Updater = Ipc.define({
  id: "updater",
  /** Whether the app runs the CLI of a Redcode installation, the only CLI `redcode upgrade` can update. */
  state: Schema.Struct({ upgradable: Schema.Boolean }),
  methods: {
    /** Quits the app and runs the installation's `redcode upgrade` in a detached process. */
    upgrade: {},
  },
  events: {
    /** The app menu asks the focused window to check for updates. */
    check: Schema.Null,
  },
})
