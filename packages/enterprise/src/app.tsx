import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Font } from "@reddb-io/redcode-ui/font"
import { MetaProvider } from "@solidjs/meta"
import { MarkedProvider } from "@reddb-io/redcode-ui/context/marked"
import { DialogProvider } from "@reddb-io/redcode-ui/context/dialog"
import { Suspense, type ParentProps } from "solid-js"
import "./app.css"
import { Favicon } from "@reddb-io/redcode-ui/favicon"

export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <DialogProvider>
            <MarkedProvider>
              <Favicon />
              <Font />
              <Suspense>{props.children}</Suspense>
            </MarkedProvider>
          </DialogProvider>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  )
}