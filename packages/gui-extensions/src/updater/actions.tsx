import { Button } from "@opencode/ui/button"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { showToast } from "@opencode/ui/toast"
import type { DialogHandle, IpcClient, SetupContext } from "../sdk"
import type { Updater } from "./contract"
import type definition from "./index"
import { newerRelease, RELEASES_URL } from "./release"

type Client = IpcClient<typeof Updater.spec>

type Context = SetupContext<typeof definition>

/**
 * Reads the newest Redcode release from the list What's New reads, and offers `redcode upgrade` unless this version is
 * already the newest. A failed read still offers it, without a version.
 */
export async function check(ctx: Context, client: Client) {
  const release = await fetch(RELEASES_URL, { signal: ctx.signal, headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : undefined))
    .then((json) => newerRelease(json, ctx.build.version))
    .catch(() => ({ status: "unknown" as const }))

  if (ctx.signal.aborted) return

  if (release.status === "current") {
    showToast({
      variant: "success",
      icon: () => <Icon name="circle-check" />,
      title: ctx.t("toast.latest.title"),
      description: ctx.t("toast.latest.description", { version: ctx.build.version }),
    })

    return
  }

  ctx.dialogs.open(
    (dialog) => (
      <DialogUpgrade
        ctx={ctx}
        dialog={dialog}
        version={release.status === "newer" ? release.version : undefined}
        upgrade={() => client.upgrade().catch((cause: unknown) => requestFailed(ctx, cause))}
      />
    ),
    { replace: true },
  )
}

function requestFailed(ctx: Context, cause: unknown) {
  if (ctx.signal.aborted) return

  showToast({
    title: ctx.t("common.requestFailed"),
    description: cause instanceof Error && cause.message ? cause.message : undefined,
  })
}

function DialogUpgrade(props: {
  ctx: Context
  dialog: DialogHandle
  version: string | undefined
  upgrade: () => Promise<void>
}) {
  const ctx = props.ctx

  const upgrade = () => {
    props.dialog.close()
    void props.upgrade()
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={ctx.t("upgrade.title")}
          description={
            props.version
              ? ctx.t("upgrade.description.version", { version: props.version })
              : ctx.t("upgrade.description")
          }
        />
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={() => props.dialog.close()}>
          {ctx.t("common.cancel")}
        </Button>
        <Button type="button" variant="contrast" autofocus onClick={upgrade}>
          {ctx.t("action.upgrade")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
