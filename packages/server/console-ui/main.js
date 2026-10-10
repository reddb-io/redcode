import { button } from "@reddb-io/design-system/contracts/button"
import { input } from "@reddb-io/design-system/contracts/input"
import { select } from "@reddb-io/design-system/contracts/select"
import { card } from "@reddb-io/design-system/contracts/card"
import { table } from "@reddb-io/design-system/contracts/table"
import { label } from "@reddb-io/design-system/contracts/label"
import { heading } from "@reddb-io/design-system/contracts/heading"
import { alert } from "@reddb-io/design-system/contracts/alert"
import { badge } from "@reddb-io/design-system/contracts/badge"
import { emptyState } from "@reddb-io/design-system/contracts/empty-state"
import { statistic } from "@reddb-io/design-system/contracts/statistic"
import { dialog } from "@reddb-io/design-system/contracts/dialog"
import { navItem } from "@reddb-io/design-system/contracts/nav-item"
import { quietControl } from "@reddb-io/design-system/contracts/quiet-control"
import { sidebarLayout } from "@reddb-io/design-system/contracts/sidebar-layout"
import { sidebarNavigation } from "@reddb-io/design-system/contracts/sidebar-navigation"
import { sidebarRail } from "@reddb-io/design-system/contracts/sidebar-rail"
import { pageHeading } from "@reddb-io/design-system/contracts/page-heading"
import { logo, logoMark } from "@reddb-io/design-system/logo/variants"
import { selectMark } from "@reddb-io/design-system/logo/marks"
import { logoBox, px } from "@reddb-io/design-system/logo/box"
import { getIcon } from "@opencode/ui/icons/catalog"
import "./style.css"

// Only the shared icon catalog supplies trusted SVG markup. User data stays text or form values.
const main = document.getElementById("main")
const notice = document.getElementById("notice")
const pageSlots = pageHeading()
const railSlots = sidebarRail()
const compact = window.matchMedia("(width < 48rem)")
let panelOpen = !compact.matches
let scope = "organization"
let infrastructureOwner = sessionStorage.getItem("redcode.console.infrastructure") || ""
const scopeViews = new Map()
const scopes = {
  infrastructure: {
    label: "Infrastructure",
    icon: "settings-gear",
    views: ["infrastructure", "resources", "operators", "grants", "owner-tasks", "auth-global", "auth-owner"],
  },
  organization: {
    label: "Organization",
    icon: "globe",
    views: ["overview", "workspaces", "members", "invitations", "activity", "organization", "auth-org"],
  },
  workspace: { label: "Workspace", icon: "folder", views: ["keys", "tasks"] },
  account: { label: "Account", icon: "bubble-5", views: ["account"] },
}
document.getElementById("scope-rail").className = railSlots.root() + " console-rail"
document.getElementById("drawer-backdrop").onclick = () => setPanel(false, true)
document.getElementById("drawer-backdrop").tabIndex = -1
for (const [id, glyph, open] of [
  ["open-sidebar", "menu", true],
  ["close-sidebar", "close", false],
]) {
  const control = document.getElementById(id)
  control.className = button({ variant: "ghost", size: "sm" })
  control.append(icon(glyph))
  control.onclick = () => setPanel(open, true)
}
function setPanel(open, focus = false) {
  panelOpen = open
  const slots = sidebarLayout({ rail: true, panelOpen: open })
  document.querySelector(".console-frame").className = slots.root() + " console-frame"
  document.getElementById("rail-region").className = slots.railRegion() + " console-rail-region"
  const sidebar = document.getElementById("sidebar")
  sidebar.className = slots.panel() + " console-sidebar"
  sidebar.inert = compact.matches && !open
  sidebar.dataset.state = open ? "open" : "closed"
  document.querySelector(".console-content").className = slots.main() + " console-content"
  document.querySelector(".console-content").inert = compact.matches && open && !!session
  document.querySelector(".console-topbar").inert = compact.matches && open && !!session
  document.getElementById("drawer-backdrop").hidden = !session || !compact.matches || !open
  document.getElementById("open-sidebar").setAttribute("aria-expanded", String(open))
  for (const control of document.querySelectorAll("[data-rail-item]"))
    control.setAttribute("aria-expanded", String(control.dataset.railItem === scope && open))
  if (!focus || !session) return
  if (open && compact.matches) sidebar.querySelector("button, select, a")?.focus()
  if (!open) document.querySelector('[data-rail-item="' + scope + '"]')?.focus()
}
compact.addEventListener("change", () => setPanel(!compact.matches))
window.addEventListener("keydown", (event) => {
  if (!session || !compact.matches || !panelOpen) return
  if (event.key === "Escape" && !document.querySelector("dialog[open]")) setPanel(false, true)
  if (event.key !== "Tab" || document.querySelector("dialog[open]")) return
  const controls = [
    ...document.querySelectorAll("#scope-rail button, #sidebar button, #sidebar select, #sidebar a"),
  ].filter((node) => !node.disabled && node.tabIndex >= 0)
  const first = controls[0]
  const last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
})
document.getElementById("scope-rail").addEventListener("keydown", (event) => {
  const controls = [...document.querySelectorAll("[data-rail-item]")]
  const current = controls.indexOf(event.target)
  if (current < 0) return
  const next = {
    ArrowDown: (current + 1) % controls.length,
    ArrowUp: (current + controls.length - 1) % controls.length,
    Home: 0,
    End: controls.length - 1,
  }[event.key]
  if (next === undefined) return
  event.preventDefault()
  controls.forEach((node, index) => {
    node.tabIndex = index === next ? 0 : -1
  })
  controls[next].focus()
})
document.getElementById("scope-rail").addEventListener("focusin", (event) => {
  if (!event.target.dataset.railItem) return
  for (const node of document.querySelectorAll("[data-rail-item]")) node.tabIndex = node === event.target ? 0 : -1
})
new ResizeObserver(([entry]) =>
  document.documentElement.style.setProperty(
    "--console-topbar-height",
    entry.target.getBoundingClientRect().height + "px",
  ),
).observe(document.querySelector(".console-topbar"))
document.querySelector(".console-header").className += " " + pageSlots.root()
document.querySelector(".console-identity").className = pageSlots.identity()
document.getElementById("page-title").className = heading({ role: "title" })
document.getElementById("page-actions").className = pageSlots.actions()
notice.className = alert({ tone: "danger" })
document.getElementById("secret").className = card({ tone: "warning" }).root() + " console-secret"
document.getElementById("dismiss-secret").className = button({ variant: "secondary" })
document.getElementById("local-status").className = badge({ variant: "outline", tone: "neutral" })

const mark = selectMark("symbol", "dark")
const box = logoBox(mark, 24)
const brandImage = document.createElement("img")
brandImage.src = mark.src
brandImage.alt = ""
brandImage.className = logoMark()
brandImage.width = Math.round(box.markWidth)
brandImage.height = Math.round(box.markHeight)
const brandMark = document.createElement("span")
brandMark.className = logo({ interactive: false })
brandMark.style.padding = px(box.clearspace)
brandMark.append(brandImage)
document.getElementById("brand").prepend(brandMark)

let session = sessionStorage.getItem("redcode.console.session") || ""
let organization = sessionStorage.getItem("redcode.console.organization") || ""
let workspace = sessionStorage.getItem("redcode.console.workspace") || ""
let currentAccount
let executionResource = ""
let dialogSequence = 0
const views = {
  overview: ["Overview", "An overview of your organization and workspace access.", "grid-plus"],
  workspaces: ["Workspaces", "Separate access by project, team or environment.", "folder"],
  keys: ["Access keys", "Create and revoke credentials for the selected workspace.", "lock"],
  members: ["Members", "Manage the people and roles in your organization.", "bubble-5"],
  invitations: ["Invitations", "Invite people with a code that expires in 48 hours.", "arrow-right"],
  activity: ["Activity", "Track changes to membership, workspaces and access.", "status"],
  organization: ["Organization", "Switch organizations, create one or accept an invitation.", "globe"],
  account: ["Account", "Your profile and sign-in settings.", "settings-gear"],
  infrastructure: ["Infrastructure", "Your infrastructure ownership and access.", "settings-gear"],
  resources: ["Servers & workers", "Register machines belonging to this infrastructure.", "folder"],
  operators: [
    "Infrastructure members",
    "Manage owner admins and owner users independently of organizations.",
    "bubble-5",
  ],
  grants: ["Workspace grants", "Assign infrastructure checkouts to workspaces.", "lock"],
  "owner-tasks": ["Tasks", "Run tasks using your infrastructure access.", "status"],
  tasks: ["Tasks", "Run tasks using resources assigned to the selected workspace.", "status"],
  "auth-global": [
    "Global authentication",
    "Sign-in providers shared by all organizations and infrastructure owners.",
    "settings-gear",
  ],
  "auth-owner": ["Owner authentication", "Sign-in providers for members of this infrastructure.", "lock"],
  "auth-org": ["Authentication settings", "Manage sign-in providers for this organization.", "settings-gear"],
}
function icon(name) {
  const art = getIcon(name)
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  node.setAttribute("viewBox", art.viewBox)
  node.setAttribute("aria-hidden", "true")
  node.setAttribute("fill", "none")
  node.classList.add("console-icon")
  node.innerHTML = art.body
  return node
}
function chip(text, tone = "neutral") {
  const node = element("span", text)
  node.className = badge({ variant: "tinted", tone })
  return node
}
function pageIdentity(title, description, context) {
  document.getElementById("page-title").textContent = title
  document.getElementById("page-description").textContent = description
  document.getElementById("page-context").textContent = context
  document.getElementById("page-actions").replaceChildren()
}
function empty(parent, title, description, name, action) {
  const slots = emptyState({ bordered: false })
  const root = element("div")
  root.className = slots.root()
  const media = icon(name || "folder")
  media.classList.add("console-empty-icon")
  const titleNode = element("p", title)
  titleNode.className = slots.title()
  const descriptionNode = element("p", description)
  descriptionNode.className = slots.description()
  root.append(media, titleNode, descriptionNode)
  if (action) root.append(action)
  parent.append(root)
}
function makeDialog(title, description) {
  const root = element("dialog")
  root.className = dialog({ size: "md" }) + " console-dialog"
  const titleNode = element("h2", title)
  titleNode.className = heading({ role: "heading" })
  titleNode.id = "console-dialog-title-" + ++dialogSequence
  root.setAttribute("aria-labelledby", titleNode.id)
  root.append(titleNode)
  if (description) {
    const copy = element("p", description)
    copy.id = "console-dialog-description-" + dialogSequence
    root.setAttribute("aria-describedby", copy.id)
    root.append(copy)
  }
  const close = actionButton("Close", () => root.close())
  close.className = button({ variant: "ghost", size: "sm" }) + " console-dialog-close"
  close.replaceChildren(icon("close"))
  close.setAttribute("aria-label", "Close dialog")
  root.append(close)
  root.addEventListener("close", () => root.remove(), { once: true })
  document.body.append(root)
  return root
}
function openForm(title, fields, action, description, defaults = {}) {
  const root = makeDialog(title, description)
  const error = element("div")
  error.setAttribute("role", "alert")
  error.className = alert({ tone: "danger" }) + " console-dialog-error"
  root.append(error)
  const node = form(
    root,
    fields,
    title,
    async (value) => {
      await action(value)
      root.close()
      await dashboard()
    },
    { primary: true, notice: error },
  )
  for (const [name, value] of Object.entries(defaults)) node.elements[name].value = value
  const cancel = actionButton("Cancel", () => root.close())
  const footer = element("div")
  footer.className = "console-dialog-actions"
  footer.append(cancel, node.querySelector('[type="submit"]'))
  node.append(footer)
  root.showModal()
  node.querySelector("input, select").focus()
}
function ask(title, description, confirmLabel) {
  return new Promise((resolve) => {
    const root = makeDialog(title, description)
    root.setAttribute("role", "alertdialog")
    const footer = element("div")
    footer.className = "console-dialog-actions"
    const cancel = actionButton("Cancel", () => root.close())
    cancel.autofocus = true
    const confirm = actionButton(confirmLabel, () => root.close("confirm"))
    confirm.className = button({ variant: "primary", tone: "danger" })
    footer.append(cancel, confirm)
    root.append(footer)
    root.addEventListener("close", () => resolve(root.returnValue === "confirm"), { once: true })
    root.showModal()
  })
}
function pageAction(text, action) {
  const control = actionButton(text, action)
  control.className = button({ variant: "primary" })
  control.prepend(icon("plus"))
  document.getElementById("page-actions").append(control)
}
function navigate(view) {
  if (location.hash.slice(1) === view) return guard(dashboard)
  location.hash = view
}
window.addEventListener("hashchange", () => {
  if (!session) return
  clearSecret()
  guard(dashboard)
})
document.getElementById("copy-secret").className = button({ variant: "secondary" })
document.getElementById("copy-secret").onclick = () =>
  guard(async () => {
    await navigator.clipboard.writeText(document.getElementById("secret-value").textContent)
    document.getElementById("copy-secret").textContent = "Copied"
  })
function element(tag, text) {
  const node = document.createElement(tag)
  if (tag === "button") node.className = button({ variant: "secondary" })
  if (tag === "p") node.className = "console-description"
  if (text !== undefined) node.textContent = text
  return node
}
function actionButton(text, action) {
  const node = element("button", text)
  node.type = "button"
  if (/^(Delete|Remove|Revoke|Leave)/.test(text)) node.className = button({ variant: "secondary", tone: "danger" })
  node.onclick = () => guard(action)
  return node
}
function section(title, description) {
  const slots = card()
  const root = element("section")
  root.className = slots.root() + " console-card"
  const header = element("header")
  header.className = slots.header()
  const titleNode = element("h2", title)
  titleNode.className = heading({ role: "heading" })
  header.append(titleNode)
  if (description) header.append(element("p", description))
  const body = element("div")
  body.className = slots.body() + " console-card-body"
  root.append(header, body)
  main.append(root)
  return body
}
function field(text, name, type = "text", choices) {
  const node = element("label", text)
  node.className = label() + " console-field"
  const control = element(choices ? "select" : "input")
  control.setAttribute("aria-label", text)
  control.className = choices ? select() : input()
  control.name = name
  control.required = name !== "clientSecret"
  if (choices)
    for (const value of choices) {
      const option = element("option", value)
      option.value = value
      control.append(option)
    }
  else {
    control.type = type
    control.maxLength = name === "clientSecret" ? 4096 : type === "url" ? 2048 : type === "password" ? 256 : 254
    if (type === "password") {
      control.minLength = ["currentPassword", "clientSecret"].includes(name) ? 0 : 8
      control.autocomplete =
        name === "clientSecret" ? "off" : name === "currentPassword" ? "current-password" : "new-password"
    }
  }
  node.append(control)
  return node
}
function form(parent, fields, title, action, options = {}) {
  const node = element("form")
  for (const item of fields) node.append(field(...item))
  const submit = element("button", title)
  submit.type = "submit"
  submit.className = button({
    variant: options.primary || title === "Create Console" || title === "Sign in" ? "primary" : "secondary",
    tone: title === "Delete account" ? "danger" : "neutral",
  })
  node.append(submit)
  node.onsubmit = (event) => {
    event.preventDefault()
    guard(async () => {
      submit.disabled = true
      try {
        await action(Object.fromEntries(new FormData(node)))
        node.reset()
      } finally {
        submit.disabled = false
      }
    }, options.notice || notice)
  }
  parent.append(node)
  return node
}
function renderTable(parent, headers, rows, options = {}) {
  if (!rows.length) {
    empty(
      parent,
      options.title || "Nothing here yet",
      options.description || "New entries will appear here.",
      options.icon,
      options.action,
    )
    return
  }
  const slots = table()
  const region = element("div")
  region.className = slots.root()
  region.tabIndex = 0
  region.setAttribute("role", "region")
  region.setAttribute("aria-label", parent.parentElement.querySelector("h2").textContent)
  const node = element("table"),
    thead = element("thead"),
    heading = element("tr")
  node.className = slots.table()
  thead.className = slots.header()
  for (const text of headers) {
    const cell = element("th", text)
    cell.className = slots.head()
    cell.scope = "col"
    heading.append(cell)
  }
  thead.append(heading)
  node.append(thead)
  const body = element("tbody")
  for (const values of rows) {
    const row = element("tr")
    row.className = slots.row()
    for (const value of values) {
      const cell = element("td")
      cell.className = slots.cell()
      if (Array.isArray(value)) cell.classList.add("console-cell-actions")
      if (Array.isArray(value)) cell.append(...value)
      else if (value instanceof Node) cell.append(value)
      else cell.textContent = String(value)
      row.append(cell)
    }
    body.append(row)
  }
  node.append(body)
  region.append(node)
  parent.append(region)
}
async function request(path, method = "GET", body) {
  const response = await fetch("/api/console" + path, {
    method,
    headers: { "content-type": "application/json", ...(session ? { authorization: "Bearer " + session } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (response.status === 204) return
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(
      error.message ||
        (response.status === 400 ? "Check the fields and try again." : "Could not complete this action. Try again."),
    )
  }
  const text = await response.text()
  return text ? JSON.parse(text) : undefined
}
async function guard(action, target = notice) {
  target.textContent = ""
  try {
    await action()
  } catch (error) {
    target.textContent = error.message
  }
}
function remember(result) {
  session = result.token
  sessionStorage.setItem("redcode.console.session", session)
}
function reveal(value, hint) {
  document.getElementById("copy-secret").textContent = "Copy code"
  document.getElementById("secret").hidden = false
  document.getElementById("secret-value").textContent = value
  document.getElementById("secret-hint").textContent = hint
}
document.getElementById("dismiss-secret").onclick = () => {
  document.getElementById("secret").hidden = true
  document.getElementById("secret-value").textContent = ""
}
async function signedOut() {
  document.body.className = "console-signed-out"
  document.getElementById("sidebar").hidden = true
  document.getElementById("rail-region").hidden = true
  scopeViews.clear()
  setPanel(!compact.matches)
  pageIdentity("Welcome to your Console", "Manage your Redcode organization and access.", "Redcode Console")
  main.className = "console-auth"
  main.replaceChildren()
  document.getElementById("account").replaceChildren()
  const status = await request("/status")
  if (status.needsSetup) {
    const node = section("Set up your local Console")
    node.append(element("p", "Enter the setup code printed by redcode console serve."))
    form(
      node,
      [
        ["Setup code", "setupToken"],
        ["Your name", "name"],
        ["Email", "email", "email"],
        ["Password (at least 8 characters)", "password", "password"],
        ["Organization name", "organization"],
      ],
      "Create Console",
      async (value) => {
        remember(await request("/bootstrap", "POST", value))
        sessionStorage.setItem("redcode.console.authOnboarding", "true")
        history.replaceState(null, "", "#auth-global")
        await dashboard()
      },
    )
    return
  }
  const login = section("Sign in")
  const loginContext = new URLSearchParams(location.search)
  const providerQuery = new URLSearchParams()
  if (loginContext.has("organization")) providerQuery.set("organizationID", loginContext.get("organization"))
  if (!loginContext.has("organization") && loginContext.has("infrastructure"))
    providerQuery.set("ownerID", loginContext.get("infrastructure"))
  const providers = await request("/federation/providers?" + providerQuery)
  if (providers.length) {
    const federated = section(
      "Single sign-on",
      "Use a linked identity, or an invitation from your Console administrator.",
    )
    for (const provider of providers) {
      federated.append(
        actionButton("Sign in with " + provider.name, async () => {
          const result = await request("/federation/start", "POST", { providerID: provider.id })
          location.assign(result.url)
        }),
      )
      federated.append(
        actionButton("Join with " + provider.name, () =>
          openForm(
            "Join with " + provider.name,
            [["Invitation code", "inviteToken"]],
            async (value) => {
              const result = await request("/federation/start", "POST", { ...value, providerID: provider.id })
              location.assign(result.url)
            },
            "Your identity provider must supply the verified email matching this invitation.",
          ),
        ),
      )
    }
  }
  const loginForm = form(
    login,
    [
      ["Email", "email", "email"],
      ["Password", "password", "password"],
    ],
    "Sign in",
    async (value) => {
      remember(await request("/login", "POST", value))
      await dashboard()
    },
  )
  loginForm.elements.password.autocomplete = "current-password"
  loginForm.elements.password.minLength = 0
  const join = actionButton("Have an invitation? Join an organization", () => {
    openForm(
      "Join with an invitation",
      [
        ["Invitation code", "inviteToken"],
        ["Name", "name"],
        ["Email", "email", "email"],
        ["Password (at least 8 characters)", "password", "password"],
      ],
      async (value) => remember(await request("/register", "POST", value)),
      "Enter the code shared by your organization administrator.",
    )
  })
  join.className = button({ variant: "ghost" }) + " console-join"
  main.append(join)
}

function chooser(text, items, value, change) {
  const root = element("label")
  root.className = "console-context-field"
  root.append(element("span", text))
  const control = element("select")
  control.className = select()
  control.setAttribute("aria-label", text)
  for (const item of items) {
    const option = element("option", item.name)
    option.value = item.id
    control.append(option)
  }
  control.value = value
  control.disabled = !items.length
  control.onchange = () => guard(() => change(control.value))
  root.append(control)
  return root
}
function clearSecret() {
  document.getElementById("dismiss-secret").click()
}
function newOrganization() {
  openForm(
    "Create organization",
    [["Organization name", "name"]],
    async (value) => {
      const result = await request("/orgs", "POST", value)
      organization = result.id
      workspace = ""
      history.replaceState(null, "", "#overview")
    },
    "Give your team or personal organization a name.",
  )
}
function newWorkspace(base) {
  openForm(
    "Create workspace",
    [["Workspace name", "name"]],
    async (value) => {
      const result = await request(base + "/workspaces", "POST", value)
      workspace = result.id
    },
    "Use a workspace to group credentials for a project or environment.",
  )
}
function newKey(keyBase) {
  openForm(
    "Create key",
    [
      ["Key name", "name"],
      ["Expires (optional)", "expiresAt", "datetime-local"],
    ],
    async (value) => {
      const result = await request(keyBase + "/keys", "POST", {
        name: value.name,
        ...(value.expiresAt ? { expiresAt: new Date(value.expiresAt).getTime() } : {}),
      })
      reveal(result.token, "Save this key somewhere safe. It is displayed once and cannot be recovered.")
    },
    "This key belongs to the workspace selected at the top of the page.",
  )
  document.querySelector("dialog [name=expiresAt]").required = false
}
function newInvitation(base) {
  openForm(
    "Invite member",
    [
      ["Email", "email", "email"],
      ["Role", "role", "text", ["member", "admin"]],
    ],
    async (value) => {
      const result = await request(base + "/invites", "POST", value)
      reveal(result.token, "Share this invitation code with " + value.email + ". It expires in 48 hours.")
    },
    "Invitations are shared manually. This local Console does not send email.",
  )
}
function readableDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}
function shortID(value) {
  const node = element("code", value.slice(0, 16) + "…")
  node.title = value
  return node
}
function activityRows(entries, members, workspaces, keys, orgs) {
  const names = new Map([
    ...members.map((item) => [item.accountID, item.name]),
    ...workspaces.map((item) => [item.id, item.name]),
    ...keys.map((item) => [item.id, item.name]),
    ...orgs.map((item) => [item.id, item.name]),
  ])
  const actions = {
    "organization.created": "Organization created",
    "workspace.created": "Workspace created",
    "key.created": "Access key created",
    "key.revoked": "Access key revoked",
    "invite.created": "Invitation created",
    "invite.accepted": "Invitation accepted",
    "invite.revoked": "Invitation revoked",
    "identity.linked": "Identity linked",
    "member.removed": "Member removed",
    "account.deleted": "Account deleted",
    "member.role.owner": "Role changed to owner",
    "member.role.admin": "Role changed to admin",
    "member.role.member": "Role changed to member",
  }
  return entries.map((item) => [
    actions[item.action] || item.action,
    names.get(item.actorID) || shortID(item.actorID),
    names.get(item.resourceID) || shortID(item.resourceID),
    readableDate(item.createdAt),
  ])
}
async function authenticationSettings(authScope, scopeID) {
  const path = "/auth/" + authScope + "/" + encodeURIComponent(scopeID)
  const settings = await request(path)
  if (authScope === "global" && sessionStorage.getItem("redcode.console.authOnboarding")) {
    const intro = section(
      "Set up sign-in · optional",
      "Add your identity provider now, or configure it later from Infrastructure → Global authentication.",
    )
    intro.append(
      actionButton("Continue to Console", () => {
        sessionStorage.removeItem("redcode.console.authOnboarding")
        navigate("overview")
      }),
    )
  }
  const address = section(
    "Console address",
    "Register the callback address below in your identity provider's client settings. Open the Console using this exact address when signing in.",
  )
  if (authScope === "global") {
    const node = form(address, [["Public Console URL", "publicURL", "url"]], "Save Console URL", async (value) => {
      await request("/auth/public-url", "PUT", value)
      await dashboard()
    })
    node.className = "console-auth-settings-form"
    node.elements.publicURL.value = settings.publicURL || location.origin
  }
  if (settings.publicURL) {
    address.append(
      element("p", "Callback address"),
      element("code", settings.publicURL + "/api/console/federation/callback"),
    )
    const loginURL = new URL(settings.publicURL)
    if (authScope !== "global")
      loginURL.searchParams.set(authScope === "organization" ? "organization" : "infrastructure", scopeID)
    address.append(
      element("p", "Sign-in link"),
      element("code", loginURL.href),
      actionButton("Copy sign-in link", async () => {
        await navigator.clipboard.writeText(loginURL.href)
      }),
    )
  }
  if (!settings.publicURL)
    address.append(
      element(
        "p",
        "An infrastructure administrator must save the public Console URL in Global authentication before adding providers.",
      ),
    )
  const providers = section(
    "Identity providers",
    authScope === "global"
      ? "These providers appear on every sign-in page. Users need a linked account or a Console invitation."
      : "These providers appear on this scope's sign-in link. Users must belong to this scope. Global providers are also available.",
  )
  const feedback = element("div")
  feedback.className = alert({ tone: "success" })
  feedback.setAttribute("role", "status")
  feedback.hidden = true
  providers.append(feedback)
  const edit = (provider) =>
    openForm(
      provider ? "Edit identity provider" : "Add identity provider",
      [
        ["Provider name", "name"],
        ["Issuer URL", "issuer", "url"],
        ["Client ID", "clientID"],
        ["Client secret", "clientSecret", "password"],
        ["Token authentication", "tokenAuthMethod", "text", ["client_secret_basic", "client_secret_post", "none"]],
        ["Status", "enabled", "text", ["Disabled", "Enabled"]],
      ],
      async (value) => {
        const body = {
          name: value.name,
          issuer: value.issuer,
          clientID: value.clientID,
          tokenAuthMethod: value.tokenAuthMethod,
          enabled: value.enabled === "Enabled",
          ...(value.clientSecret ? { clientSecret: value.clientSecret } : {}),
        }
        await request(
          path + "/providers" + (provider ? "/" + encodeURIComponent(provider.id) : ""),
          provider ? "PUT" : "POST",
          body,
        )
      },
      "OIDC uses authorization code and PKCE. Choose none for a public client and leave the secret empty. For confidential clients, enter a secret; when editing, leave it empty to keep the saved secret. Roles and membership remain managed in Redcode.",
      {
        name: provider?.name || "",
        issuer: provider?.issuer || "",
        clientID: provider?.clientID || "",
        tokenAuthMethod: provider?.tokenAuthMethod || "client_secret_basic",
        enabled: provider?.enabled ? "Enabled" : "Disabled",
      },
    )
  if (settings.publicURL) pageAction("Add identity provider", () => edit())
  renderTable(
    providers,
    ["Provider", "Issuer", "Client ID", "Status", "Actions"],
    settings.providers.map((provider) => [
      provider.name,
      provider.issuer,
      provider.clientID,
      chip(provider.enabled ? "Enabled" : "Disabled", provider.enabled ? "success" : "neutral"),
      [
        actionButton("Edit " + provider.name, () => edit(provider)),
        actionButton("Test " + provider.name, async () => {
          feedback.hidden = true
          await request(path + "/providers/" + encodeURIComponent(provider.id) + "/test", "POST", {})
          feedback.textContent =
            "OIDC discovery succeeded for " +
            provider.name +
            ". Complete a sign-in to verify the client credentials and callback registration."
          feedback.hidden = false
        }),
        actionButton("Remove " + provider.name, async () => {
          if (
            !(await ask(
              "Remove identity provider?",
              "New sign-ins through " + provider.name + " will stop. Existing Console sessions remain valid.",
              "Remove provider",
            ))
          )
            return
          await request(path + "/providers/" + encodeURIComponent(provider.id), "DELETE")
          await dashboard()
        }),
      ],
    ]),
    {
      title: "No providers configured",
      description: "Add your own OIDC provider. Local password sign-in remains available.",
      icon: "lock",
    },
  )
  if (settings.inherited.length) {
    const inherited = section(
      "Global providers",
      "Managed by infrastructure administrators and shared across the Console.",
    )
    renderTable(
      inherited,
      ["Provider", "Issuer"],
      settings.inherited.map((provider) => [provider.name, provider.issuer]),
    )
  }
}
async function dashboard() {
  if (!session) return signedOut()
  currentAccount = await request("/me")
  const [orgs, infrastructure] = await Promise.all([request("/orgs"), request("/infrastructure")])
  if (!infrastructure.owners.some((item) => item.id === infrastructureOwner))
    infrastructureOwner = infrastructure.owners[0]?.id || ""
  const selectedOwner = infrastructure.owners.find((item) => item.id === infrastructureOwner)
  const installationAdmin = infrastructure.owners.some((item) => item.role === "admin")
  sessionStorage.setItem("redcode.console.infrastructure", infrastructureOwner)
  if (!orgs.some((item) => item.id === organization)) organization = orgs[0]?.id || ""
  const org = orgs.find((item) => item.id === organization)
  const admin = !!org && org.role !== "member"
  const owner = org?.role === "owner"
  const base = "/orgs/" + encodeURIComponent(organization)
  const [workspaces, members] = org
    ? await Promise.all([request(base + "/workspaces"), request(base + "/members")])
    : [[], []]
  if (!workspaces.some((item) => item.id === workspace)) workspace = workspaces[0]?.id || ""
  const selectedWorkspace = workspaces.find((item) => item.id === workspace)
  sessionStorage.setItem("redcode.console.organization", organization)
  sessionStorage.setItem("redcode.console.workspace", workspace)
  let view = location.hash.slice(1)
  if (!views[view] || (!admin && ["invitations", "activity", "auth-org"].includes(view))) view = "overview"
  if (selectedOwner?.role !== "admin" && ["operators", "grants", "auth-owner"].includes(view)) view = "infrastructure"
  if (!installationAdmin && view === "auth-global") view = "infrastructure"
  if (!selectedOwner && scopes.infrastructure.views.includes(view)) view = "infrastructure"
  scope = Object.keys(scopes).find((id) => scopes[id].views.includes(view))
  if (!org && ["organization", "workspace"].includes(scope)) view = "organization"
  if (!workspace && scope === "workspace") view = "workspaces"
  scope = Object.keys(scopes).find((id) => scopes[id].views.includes(view))
  if (location.hash.slice(1) !== view) history.replaceState(null, "", "#" + view)
  scopeViews.set(scope, view)
  const keyBase = "/workspaces/" + encodeURIComponent(workspace)
  const [keys, invitations, activity] = await Promise.all([
    workspace && ["overview", "keys"].includes(view) ? request(keyBase + "/keys") : [],
    admin && ["overview", "invitations"].includes(view) ? request(base + "/invites") : [],
    admin && ["overview", "activity"].includes(view) ? request(base + "/audit") : [],
  ])
  document.body.className = ""
  document.getElementById("sidebar").hidden = false
  document.getElementById("rail-region").hidden = false
  main.className = ""
  main.replaceChildren()
  const info = views[view]
  pageIdentity(
    info[0],
    info[1],
    scope === "infrastructure"
      ? selectedOwner?.name || "Infrastructure"
      : scope === "account"
        ? currentAccount.name
        : scope === "workspace"
          ? org.name + " / " + selectedWorkspace.name
          : org?.name || "Organizations",
  )
  const account = document.getElementById("account")
  const accountLink = element("a")
  accountLink.href = "#account"
  accountLink.className = "console-account-link"
  const avatar = element("span", currentAccount.name.slice(0, 2).toUpperCase())
  avatar.className = "console-account-avatar"
  accountLink.append(avatar, element("span", currentAccount.name))
  const signOut = actionButton("Sign out", async () => {
    await request("/logout", "POST")
    session = ""
    sessionStorage.removeItem("redcode.console.session")
    clearSecret()
    await signedOut()
  })
  signOut.className = button({ variant: "ghost", size: "sm" })
  account.replaceChildren(accountLink, signOut)
  const context = document.getElementById("context")
  context.replaceChildren()
  if (["organization", "workspace"].includes(scope))
    context.append(
      chooser("Organization", orgs, organization, async (id) => {
        organization = id
        workspace = ""
        clearSecret()
        await dashboard()
      }),
    )
  if (scope === "workspace" && workspaces.length)
    context.append(
      chooser("Workspace", workspaces, workspace, async (id) => {
        workspace = id
        clearSecret()
        await dashboard()
      }),
    )
  if (scope === "infrastructure" && infrastructure.owners.length)
    context.append(
      chooser("Infrastructure owner", infrastructure.owners, infrastructureOwner, async (id) => {
        infrastructureOwner = id
        executionResource = ""
        clearSecret()
        await dashboard()
      }),
    )
  document.getElementById("scope-title").textContent = scopes[scope].label
  document.getElementById("sidebar").setAttribute("aria-label", scopes[scope].label + " sidebar")
  const focusedScope = document.activeElement?.dataset.railItem
  const railList = element("ul")
  railList.className = railSlots.list()
  const railBottom = element("div")
  railBottom.className = railSlots.region()
  for (const [id, item] of Object.entries(scopes)) {
    if (id === "workspace" && !workspace) continue
    const row = element("li")
    const control = element("button")
    control.type = "button"
    control.className = railSlots.item() + " console-rail-control"
    control.dataset.railItem = id
    control.setAttribute("aria-label", item.label)
    control.setAttribute("aria-pressed", String(id === scope))
    control.setAttribute("aria-controls", "sidebar")
    control.title = item.label
    control.tabIndex = id === (focusedScope || scope) ? 0 : -1
    control.append(icon(item.icon))
    control.onclick = () => {
      clearSecret()
      if (id === scope) return setPanel(!panelOpen, true)
      setPanel(true)
      navigate(scopeViews.get(id) || item.views[0])
    }
    row.append(control)
    if (id === "account") railBottom.append(control)
    if (id !== "account") railList.append(row)
  }
  const railMiddle = element("div")
  railMiddle.className = railSlots.region({ class: railSlots.middle() })
  railMiddle.append(railList)
  document.getElementById("scope-rail").replaceChildren(railMiddle, railBottom)
  setPanel(panelOpen)
  if (focusedScope) document.querySelector('[data-rail-item="' + focusedScope + '"]')?.focus()
  const navSlots = sidebarNavigation()
  const nav = document.getElementById("navigation")
  nav.setAttribute("aria-label", scopes[scope].label + " navigation")
  nav.className = navSlots.root() + " console-navigation"
  const list = element("ul")
  list.className = navSlots.list()
  for (const [id, item] of Object.entries(views)) {
    if (!scopes[scope].views.includes(id)) continue
    if (!admin && ["invitations", "activity", "auth-org"].includes(id)) continue
    if (selectedOwner?.role !== "admin" && ["operators", "grants", "auth-owner"].includes(id)) continue
    if (!installationAdmin && id === "auth-global") continue
    if (!selectedOwner && scope === "infrastructure" && id !== "infrastructure") continue
    if (!org && scope === "organization" && id !== "organization") continue
    const row = element("li")
    row.className = navSlots.item()
    const control = element("a")
    control.href = "#" + id
    control.onclick = () => {
      if (compact.matches) setPanel(false, true)
      clearSecret()
    }
    control.className = quietControl({ class: navItem({ current: id === view }).root(), selected: id === view })
    if (id === view) control.setAttribute("aria-current", "page")
    control.append(icon(item[2]), element("span", item[0]))
    row.append(control)
    list.append(row)
  }
  nav.replaceChildren(list)

  if (["auth-global", "auth-owner", "auth-org"].includes(view)) {
    const authScope = view === "auth-global" ? "global" : view === "auth-org" ? "organization" : "infrastructure"
    await authenticationSettings(
      authScope,
      authScope === "global" ? "installation" : authScope === "organization" ? organization : infrastructureOwner,
    )
  }

  if (["infrastructure", "resources", "operators", "grants"].includes(view)) {
    const data = infrastructure
    const intro =
      view === "infrastructure"
        ? section(
            "Infrastructure ownership",
            "Owner admin manages machines and access grants. Owner user runs authorized tasks. Organization roles are separate.",
          )
        : undefined
    if (!data.owners.length) {
      intro.append(
        element(
          "p",
          "You have no infrastructure membership. An administrator can add your account. Existing installations without an owner can be claimed with the local setup code.",
        ),
      )
      form(
        intro,
        [
          ["Infrastructure name", "name"],
          ["Infrastructure setup code", "setupToken", "password"],
        ],
        "Claim infrastructure",
        async (body) => {
          await request("/infrastructure", "POST", body)
          await dashboard()
        },
      )
    }
    for (const host of data.owners.filter((item) => item.id === infrastructureOwner)) {
      const resources = data.resources.filter((resource) => resource.ownerID === host.id)
      if (view === "infrastructure") {
        intro.append(
          element("strong", host.name),
          element(
            "p",
            host.role === "admin" ? "Owner admin · infrastructure administration" : "Owner user · task execution",
          ),
        )
        intro.append(element("p", resources.length + " servers and workers registered."))
        intro.append(actionButton("View servers & workers", () => navigate("resources")))
        if (host.role === "admin") intro.append(actionButton("Manage workspace grants", () => navigate("grants")))
        continue
      }
      const body =
        view === "resources"
          ? section(
              host.name,
              host.role === "admin" ? "Owner admin · infrastructure administration" : "Owner user · task execution",
            )
          : undefined
      if (view === "resources")
        renderTable(
          body,
          ["Server / worker", "Resource ID", "Address"],
          resources.map((resource) => [resource.name, resource.id, resource.url || "Not configured"]),
        )
      if (host.role !== "admin") continue
      if (view === "resources")
        form(
          body,
          [
            ["Server or worker name", "name"],
            ["Server origin (optional)", "url", "url"],
          ],
          "Register resource",
          async (value) => {
            if (!value.url) delete value.url
            await request("/infrastructure/" + host.id + "/resources", "POST", value)
            await dashboard()
          },
        ).elements.url.required = false
      if (view !== "operators" && view !== "grants") continue
      if (view === "operators") {
        const people = await request("/infrastructure/" + host.id + "/members")
        const access = section(
          host.name + " · People",
          "These roles apply to this infrastructure owner, independently of organization membership.",
        )
        renderTable(
          access,
          ["Account", "Role", "Actions"],
          people.map((person) => [
            person.email,
            "Owner " + person.role,
            [
              actionButton("Remove", async () => {
                if (
                  !(await ask(
                    "Remove infrastructure access",
                    person.email + " will lose this infrastructure membership.",
                    "Remove",
                  ))
                )
                  return
                await request("/infrastructure/" + host.id + "/members/" + person.accountID, "DELETE")
                await dashboard()
              }),
            ],
          ]),
        )
        form(
          access,
          [
            ["Account email", "email", "email"],
            ["Infrastructure role", "role", "text", ["user", "admin"]],
          ],
          "Set infrastructure role",
          async (value) => {
            await request("/infrastructure/" + host.id + "/members", "PUT", value)
            await dashboard()
          },
        )
        continue
      }
      const grants = section(
        host.name + " · Workspace grants",
        "Grant an exact, independent checkout to a workspace. Organization administrators cannot change these grants.",
      )
      renderTable(
        grants,
        ["Resource", "Workspace", "Checkout", "Actions"],
        data.grants
          .filter((grant) => resources.some((resource) => resource.id === grant.resourceID))
          .map((grant) => [
            resources.find((resource) => resource.id === grant.resourceID)?.name,
            grant.workspaceID,
            grant.directory,
            [
              actionButton("Revoke", async () => {
                if (
                  !(await ask(
                    "Revoke workspace grant",
                    "Further API access and queued admissions will be denied. Work already running is not interrupted.",
                    "Revoke",
                  ))
                )
                  return
                await request("/resources/" + grant.resourceID + "/grants/" + grant.id, "DELETE")
                await dashboard()
              }),
            ],
          ]),
      )
      if (resources.length)
        form(
          grants,
          [
            ["Resource ID", "resourceID", "text", resources.map((resource) => resource.id)],
            ["Workspace ID", "workspaceID"],
            ["Absolute checkout directory", "directory"],
          ],
          "Grant workspace access",
          async (value) => {
            await request("/resources/" + value.resourceID + "/grants", "POST", {
              workspaceID: value.workspaceID,
              directory: value.directory,
            })
            await dashboard()
          },
        )
    }
    return
  }

  if (view === "tasks" || view === "owner-tasks") {
    const assigned = view === "tasks" && workspace ? await request(keyBase + "/resources") : []
    const resources = [
      ...assigned
        .filter((resource) => resource.url)
        .map((resource) => ({
          ...resource,
          id: "workspace:" + resource.id,
          name: resource.name + " · " + (selectedWorkspace?.name || "Workspace"),
          workspace,
        })),
      ...infrastructure.resources
        .filter((resource) => view === "owner-tasks" && resource.ownerID === infrastructureOwner && resource.url)
        .map((resource) => ({ ...resource, id: "owner:" + resource.id, name: resource.name + " · Infrastructure" })),
    ]
    if (!resources.some((resource) => resource.id === executionResource)) executionResource = resources[0]?.id || ""
    const selected = resources.find((resource) => resource.id === executionResource)
    const body = section(
      "Execution resource",
      "A coordinator dispatches tasks to the workers authorized for your selected scope.",
    )
    if (!selected) {
      empty(
        body,
        "No execution resource assigned",
        view === "tasks"
          ? "An infrastructure administrator must assign a server with an address to your workspace."
          : "An infrastructure administrator must register a server with an address for this owner.",
        "folder",
      )
      return
    }
    body.append(
      chooser("Execution resource", resources, executionResource, async (id) => {
        executionResource = id
        await dashboard()
      }),
    )
    const remote = async (path, method = "GET", payload) => {
      const response = await fetch(new URL(path, selected.url), {
        method,
        redirect: "error",
        headers: {
          authorization: "Bearer " + session,
          "content-type": "application/json",
          ...(selected.workspace ? { "x-redcode-workspace": selected.workspace } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || "Unable to access this resource")
      return result
    }
    const snapshot = await remote("/api/workers")
    if (!snapshot.available) {
      body.append(element("p", snapshot.reason || "Coordinator unavailable"))
      return
    }
    renderTable(
      body,
      ["Worker", "Connection", "Checkouts"],
      snapshot.workers.map((item) => [item.worker.id, item.connection, item.worker.directories.join(", ")]),
    )
    if (snapshot.workers.length)
      form(
        section("New task", "The worker uses its configured tools and permission rules."),
        [
          ["Worker", "worker", "text", snapshot.workers.map((item) => item.worker.id)],
          ["Task", "prompt"],
        ],
        "Send task",
        async (value) => {
          await remote("/api/workers/batches", "POST", {
            tasks: [{ id: "task-" + crypto.randomUUID(), worker: value.worker, prompt: value.prompt }],
          })
          await dashboard()
        },
      )
    const batches = section(
      "Tasks and results",
      "Results are limited to your account, or your workspace when you administer its organization.",
    )
    batches.append(actionButton("Refresh tasks", dashboard))
    for (const batch of snapshot.batches) {
      const taskBody = section(batch.id, batch.error || (batch.observing ? "Observing workers" : "Saved batch"))
      renderTable(
        taskBody,
        ["Task", "Status", "Result", "Actions"],
        (batch.report?.tasks || batch.manifest.tasks.map((task) => ({ id: task.id, state: "queued" }))).map((task) => [
          task.id,
          task.state,
          task.text || task.detail || "",
          [
            actionButton("Review changes", async () => {
              const artifact = await remote("/api/workers/batches/" + batch.id + "/collect", "POST", { task: task.id })
              const root = makeDialog("Task changes", "Review the patch before applying it to a checkout.")
              const patch = element("pre", artifact.patch || "No file changes")
              root.append(
                patch,
                actionButton("Close", () => root.close()),
              )
              root.showModal()
            }),
          ],
        ]),
      )
    }
    return
  }

  if (view === "overview") {
    const stats = element("div")
    stats.className = "console-stats"
    const counters = [
      ["Workspaces", workspaces.length, "In this organization", "workspaces"],
      ["Members", members.length, "With organization access", "members"],
      ["Access keys", keys.length, selectedWorkspace?.name || "No workspace selected", "keys"],
    ]
    if (admin) counters.push(["Invitations", invitations.length, "Shared invitation codes", "invitations"])
    for (const [name, count, description, target] of counters) {
      const slots = statistic()
      const root = element("a")
      root.href = "#" + target
      root.setAttribute("aria-label", name + ": " + count + ". " + description)
      root.className = card().root() + " console-stat"
      root.append(element("span", name))
      const value = element("strong", count)
      value.className = slots.value()
      const detail = element("span", description)
      detail.className = slots.description()
      root.append(value, detail)
      stats.append(root)
    }
    main.append(stats)
    const panels = element("div")
    panels.className = "console-overview-panels"
    const workspacePanel = section("Workspace access", "Keep credentials scoped to the right project or environment.")
    workspacePanel.parentElement.remove()
    if (selectedWorkspace) {
      const identity = element("div")
      identity.className = "console-workspace-identity"
      identity.append(icon("folder"), element("strong", selectedWorkspace.name), chip("Selected"))
      workspacePanel.append(
        identity,
        element(
          "p",
          keys.length
            ? keys.length + " access keys in this workspace."
            : "No access keys have been created for this workspace.",
        ),
      )
      workspacePanel.append(actionButton("Manage access keys", () => navigate("keys")))
    } else
      empty(
        workspacePanel,
        "Create your first workspace",
        "Group access for a project or environment.",
        "folder",
        admin ? actionButton("Create workspace", () => newWorkspace(base)) : undefined,
      )
    const teamPanel = section("Your team", "Control who can access this organization.")
    teamPanel.parentElement.remove()
    const people = element("div")
    people.className = "console-people"
    for (const member of members.slice(0, 3)) {
      const person = element("div")
      person.className = "console-person"
      const initial = element("span", member.name.slice(0, 2).toUpperCase())
      initial.className = "console-account-avatar"
      const identity = element("div")
      identity.append(element("strong", member.name), element("p", member.email))
      person.append(initial, identity, chip(member.role))
      people.append(person)
    }
    teamPanel.append(
      people,
      actionButton("Manage members", () => navigate("members")),
    )
    panels.append(workspacePanel.closest("section"), teamPanel.closest("section"))
    main.append(panels)
    if (admin) {
      const recent = section("Recent activity", "The latest changes in this organization.")
      renderTable(
        recent,
        ["Action", "Member", "Resource", "Time"],
        activityRows(activity.slice(0, 4), members, workspaces, keys, orgs),
        { title: "No activity yet", description: "Organization changes will appear here.", icon: "status" },
      )
      recent.append(actionButton("View all activity", () => navigate("activity")))
      pageAction("Invite member", () => newInvitation(base))
    }
  }
  if (view === "workspaces") {
    const node = section("All workspaces", "Each workspace keeps its own access keys.")
    renderTable(
      node,
      ["Workspace", "Created", "Status", "Actions"],
      workspaces.map((item) => [
        item.name,
        readableDate(item.createdAt),
        chip(item.id === workspace ? "Selected" : "Available"),
        [
          actionButton("Manage access", async () => {
            workspace = item.id
            clearSecret()
            navigate("keys")
          }),
        ],
      ]),
      {
        title: "No workspaces yet",
        description: "Create a workspace for your first project or environment.",
        icon: "folder",
        action: admin ? actionButton("Create workspace", () => newWorkspace(base)) : undefined,
      },
    )
    if (admin) pageAction("Create workspace", () => newWorkspace(base))
  }
  if (view === "keys") {
    const node = section(
      selectedWorkspace?.name || "Access keys",
      "Credentials are scoped to this workspace. The model gateway is not connected yet.",
    )
    renderTable(
      node,
      ["Name", "Key prefix", "Created by", "Expires", "Actions"],
      keys.map((item) => [
        item.name,
        element("code", item.prefix),
        members.find((member) => member.accountID === item.accountID)?.name || shortID(item.accountID),
        item.expiresAt ? readableDate(item.expiresAt) : chip("No expiration"),
        [
          actionButton("Revoke", async () => {
            if (
              !(await ask(
                "Revoke access key?",
                "Any client using this key will lose access immediately.",
                "Revoke key",
              ))
            )
              return
            await request(keyBase + "/keys/" + encodeURIComponent(item.id), "DELETE")
            await dashboard()
          }),
        ],
      ]),
      {
        title: "No access keys yet",
        description: "Create a named key to identify and control access to this workspace.",
        icon: "lock",
        action: workspace ? actionButton("Create key", () => newKey(keyBase)) : undefined,
      },
    )
    if (workspace) pageAction("Create key", () => newKey(keyBase))
  }
  if (view === "members") {
    const node = section("Organization members", "Owners manage roles. Administrators manage invitations and members.")
    renderTable(
      node,
      ["Member", "Email", "Role", "Actions"],
      members.map((item) => {
        const actions = []
        if (owner)
          actions.push(
            actionButton("Change role", () =>
              openForm(
                "Change member role",
                [["Role", "role", "text", ["owner", "admin", "member"]]],
                (value) => request(base + "/members/" + encodeURIComponent(item.accountID), "PUT", value),
                "Update access for " + item.name + ".",
                { role: item.role },
              ),
            ),
          )
        if ((admin && !(item.role === "owner" && !owner)) || item.accountID === currentAccount.id)
          actions.push(
            actionButton(item.accountID === currentAccount.id ? "Leave" : "Remove", async () => {
              if (
                !(await ask(
                  item.accountID === currentAccount.id ? "Leave organization?" : "Remove member?",
                  "This removes organization membership and revokes the member's access keys.",
                  item.accountID === currentAccount.id ? "Leave" : "Remove member",
                ))
              )
                return
              await request(base + "/members/" + encodeURIComponent(item.accountID), "DELETE")
              await dashboard()
            }),
          )
        return [
          item.name + (item.accountID === currentAccount.id ? " (you)" : ""),
          item.email,
          chip(item.role),
          actions,
        ]
      }),
    )
    if (admin) pageAction("Invite member", () => newInvitation(base))
  }
  if (view === "invitations") {
    const node = section(
      "Organization invitations",
      "Copy the code after inviting someone and share it with that person. Email delivery is not configured.",
    )
    renderTable(
      node,
      ["Email", "Role", "Expires", "Actions"],
      invitations.map((item) => [
        item.email,
        chip(item.role),
        readableDate(item.expiresAt),
        [
          actionButton("Revoke", async () => {
            if (
              !(await ask(
                "Revoke invitation?",
                "The invitation code will no longer let this person join.",
                "Revoke invitation",
              ))
            )
              return
            await request(base + "/invites/" + encodeURIComponent(item.id), "DELETE")
            await dashboard()
          }),
        ],
      ]),
      {
        title: "Your team starts here",
        description: "Invite a member or administrator to your organization.",
        icon: "bubble-5",
        action: actionButton("Invite member", () => newInvitation(base)),
      },
    )
    pageAction("Invite member", () => newInvitation(base))
  }
  if (view === "activity") {
    const node = section("Organization activity", "Membership and credential changes are recorded automatically.")
    renderTable(
      node,
      ["Action", "Member", "Resource", "Time"],
      activityRows(activity, members, workspaces, keys, orgs),
      { title: "No activity yet", description: "Changes to this organization will appear here.", icon: "status" },
    )
  }
  if (view === "organization") {
    const node = section("Your organizations", "You can belong to more than one organization.")
    renderTable(
      node,
      ["Organization", "Your role", "Actions"],
      orgs.map((item) => [
        item.name,
        chip(item.role),
        [
          actionButton(item.id === organization ? "Open overview" : "Switch organization", async () => {
            organization = item.id
            workspace = ""
            clearSecret()
            navigate("overview")
          }),
        ],
      ]),
      {
        title: "Join or create an organization",
        description: "An organization groups your team and workspaces.",
        icon: "globe",
        action: actionButton("Create organization", newOrganization),
      },
    )
    const join = section(
      "Have an invitation?",
      "Join an existing organization with the code shared by its administrator.",
    )
    join.append(
      actionButton("Accept invitation", () =>
        openForm("Accept invitation", [["Invitation code", "token"]], (value) =>
          request("/invites/accept", "POST", value),
        ),
      ),
    )
    pageAction("Create organization", newOrganization)
  }
  if (view === "account") {
    const profile = section("Your profile", "This account signs in to your local Redcode Console.")
    const identity = element("div")
    identity.className = "console-profile"
    const initials = element("span", currentAccount.name.slice(0, 2).toUpperCase())
    initials.className = "console-account-avatar"
    const details = element("div")
    details.append(element("strong", currentAccount.name), element("p", currentAccount.email))
    identity.append(
      initials,
      details,
      chip(currentAccount.localPassword === false ? "Federated account" : "Local password"),
    )
    profile.append(identity)
    const providers = await request("/federation/providers?account=true")
    if (providers.length) {
      const sso = section(
        "Linked identities",
        "Sign in again before linking an identity. Linking requires a session created within five minutes.",
      )
      const identities = await request("/identities")
      renderTable(
        sso,
        ["Provider", "Linked"],
        identities.map((identity) => [
          providers.find((provider) => new URL(provider.issuer).href === new URL(identity.issuer).href)?.name ||
            "Other provider",
          new Date(identity.createdAt).toLocaleDateString(),
        ]),
      )
      for (const provider of providers)
        sso.append(
          actionButton("Link " + provider.name, async () => {
            const result = await request("/federation/start", "POST", { providerID: provider.id, link: true })
            location.assign(result.url)
          }),
        )
    }
    if (currentAccount.localPassword === false) {
      section(
        "Identity settings",
        "Your identity provider manages your password. Federated account deletion is not available in this Console yet.",
      )
      return
    }
    const security = section(
      "Password",
      "Use at least eight characters. Changing it signs out other sessions and revokes your API keys.",
    )
    security.append(
      actionButton("Change password", () =>
        openForm(
          "Change password",
          [
            ["Current password", "currentPassword", "password"],
            ["New password", "password", "password"],
          ],
          async (value) => remember(await request("/password", "PUT", value)),
          "Other sessions and existing API keys will be revoked.",
        ),
      ),
    )
    const danger = section("Delete account", "Transfer ownership first if you are the last owner of an organization.")
    danger.parentElement.classList.add("console-danger")
    danger.append(
      actionButton("Delete account", () =>
        openForm(
          "Delete account",
          [["Confirm password", "currentPassword", "password"]],
          async (value) => {
            if (
              !(await ask(
                "Permanently delete account?",
                "Your Console account will be permanently removed. This cannot be undone.",
                "Delete account",
              ))
            )
              throw new Error("Account deletion canceled.")
            await request("/account", "DELETE", value)
            session = ""
            sessionStorage.removeItem("redcode.console.session")
            clearSecret()
          },
          "This action permanently removes your account.",
        ),
      ),
    )
  }
}
guard(async () => {
  const federation = new URLSearchParams(location.search).get("federation")
  if (federation) history.replaceState(null, "", location.pathname + location.hash)
  if (federation === "success") {
    try {
      remember(await request("/federation/session", "POST"))
    } catch (error) {
      session = ""
      sessionStorage.removeItem("redcode.console.session")
      await signedOut()
      notice.textContent = error.message
      return
    }
  }
  if (federation === "failed")
    notice.textContent =
      "Federated sign-in failed. Sign in again, link the identity from Account, or use a valid invitation."
  if (!session) return signedOut()
  try {
    await dashboard()
  } catch (error) {
    session = ""
    sessionStorage.removeItem("redcode.console.session")
    await signedOut()
    notice.textContent = error.message
  }
})
