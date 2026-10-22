/** @jsxImportSource react */
import QrScanner from "qr-scanner"
import { useEffect, useRef, useState } from "react"
import { Button } from "@reddb-io/design-system/base/Button"
import type { SharedLanguage } from "@/runtime/react/language"
import { pairingLink } from "./pairing"
import type { RedeemPairing } from "./redeem"
import "./scanner.css"

export function PairingScannerView(props: {
  language: SharedLanguage
  redeem: RedeemPairing
  onScan: (link: string) => void
  onCancel: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState({ error: "", ready: false, redeeming: false })
  useEffect(() => {
    if (!video.current) return
    const rejected = new Map<string, number>()
    const scan = { disposed: false, redeeming: false }
    const scanner = new QrScanner(
      video.current,
      (result) => {
        if (scan.redeeming || Date.now() < (rejected.get(result.data) ?? 0)) return
        scan.redeeming = true
        setState((state) => ({ ...state, redeeming: true, error: "" }))
        void props.redeem(result.data).then((redeemed) => {
          if (scan.disposed) return
          scan.redeeming = false
          setState((state) => ({ ...state, redeeming: false }))
          if (redeemed && "pairing" in redeemed) {
            scanner.stop()
            const code = pairingLink(result.data)?.code
            props.onScan(code ? new URL(`/auth/connect/${code}`, redeemed.pairing.url).href : result.data)
            return
          }
          rejected.set(result.data, Date.now() + 3000)
          setState((state) => ({ ...state, error: redeemed?.error ?? props.language.t("server.connect.scan.invalid") }))
        })
      },
      {
        preferredCamera: "environment",
        maxScansPerSecond: 10,
        returnDetailedScanResult: true,
        onDecodeError: (error) => {
          if (String(error).includes(QrScanner.NO_QR_CODE_FOUND) || scan.redeeming) return
          setState((state) => ({ ...state, error: props.language.t("server.connect.scan.failed") }))
        },
      },
    )
    scanner.setInversionMode("both")
    void scanner.start().then(
      () => {
        if (!scan.disposed) setState((state) => ({ ...state, ready: true }))
      },
      () => {
        if (!scan.disposed) setState((state) => ({ ...state, error: props.language.t("server.connect.camera.error") }))
      },
    )
    return () => {
      scan.disposed = true
      scanner.destroy()
    }
  }, [props.redeem, props.onScan, props.language.t])
  return (
    <section className="server-connect-scanner" aria-label={props.language.t("server.connect.scan")}>
      <p>{props.language.t("server.connect.scan.description")}</p>
      <div className="server-connect-video">
        <video ref={video} aria-label={props.language.t("server.connect.camera")} playsInline muted />
        {((!state.ready && !state.error) || state.redeeming) && (
          <span role="status" data-busy={state.redeeming ? "" : undefined}>
            {props.language.t(state.redeeming ? "dialog.server.add.checking" : "server.connect.camera.starting")}
          </span>
        )}
      </div>
      {state.error && (
        <p className="server-connect-error" role="alert">
          {state.error}
        </p>
      )}
      <Button variant="secondary" size="lg" onClick={props.onCancel}>
        {props.language.t("common.cancel")}
      </Button>
    </section>
  )
}
