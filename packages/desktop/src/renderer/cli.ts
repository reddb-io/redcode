
export async function installCli(): Promise<void> {
  try {
    const path = await window.api.installCli()
    window.alert(`CLI installed to ${path}\n\nRestart your terminal to use the 'opencode' command.`)
  } catch (e) {
    window.alert(`Failed to install CLI: ${String(e)}`)
  }
}
