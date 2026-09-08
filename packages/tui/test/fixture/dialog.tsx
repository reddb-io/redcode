/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { type JSX, onCleanup } from "solid-js"
import { ClipboardProvider, type ClipboardService } from "../../src/context/clipboard"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"
import { TestTuiContexts } from "./tui-environment"
import { createTuiResolvedConfig } from "./tui-runtime"

export async function mountDialog(input: { root: string; children: () => JSX.Element; clipboard?: ClipboardService }) {
  await Bun.write(`${input.root}/kv.json`, "{}")
  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig({ keybinds: {}, leader_timeout: 1000 })
    onCleanup(registerOpencodeKeymap(keymap, renderer, config))
    return (
      <TestTuiContexts directory={input.root} paths={{ home: input.root, state: input.root, worktree: input.root }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <ClipboardProvider value={input.clipboard}>
                  <ToastProvider>
                    <DialogProvider>{input.children()}</DialogProvider>
                  </ToastProvider>
                </ClipboardProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }
  return testRender(() => <Harness />, { kittyKeyboard: true, width: 100, height: 35 })
}
