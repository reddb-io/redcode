export type Platform = "ios" | "android"

export interface Device {
  readonly platform: Platform
  /** The CSS viewport of the screen; the same phones `viewports` audits. */
  readonly width: number
  readonly height: number
  /** Device pixels per CSS pixel. */
  readonly scale: number
  readonly userAgent: string
  /** The system areas over the screen: the status bar and the home indicator or gesture bar, in CSS pixels. */
  readonly safeArea: { readonly top: number; readonly bottom: number }
  /** The smallest comfortable touch target: 44pt on iOS, 48dp on Android. */
  readonly touch: number
  /** Frame thickness around the screen, and the corner radii of the body and of the screen. */
  readonly bezel: number
  readonly radius: number
  readonly screenRadius: number
  /**
   * The frame's own markup, drawn in CSS and inline SVG: the body behind the screen and the system
   * chrome over it (status bar, camera, home indicator or gesture bar). It is positioned against a
   * box of the frame's outer size, with the screen itself left for the preview frame.
   */
  readonly html: string
}

/**
 * The phone a platform's app designs are previewed and audited on: a 393×852 iPhone with a Dynamic
 * Island and a 412×915 Android phone with a punch-hole camera, with what emulating them takes (device
 * pixels, user agent, safe-area insets and touch target size).
 *
 * It is self-contained because review hosts serialize it into the standalone page with `toString()`.
 */
export function device(platform: Platform): Device {
  const ink = "#0b0b0c"
  const specs = {
    ios: {
      width: 393,
      height: 852,
      scale: 3,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      safeArea: { top: 59, bottom: 34 },
      touch: 44,
      bezel: 12,
      radius: 67,
      screenRadius: 55,
    },
    android: {
      width: 412,
      height: 915,
      scale: 2.625,
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
      safeArea: { top: 40, bottom: 24 },
      touch: 48,
      bezel: 10,
      radius: 44,
      screenRadius: 32,
    },
  }
  const spec = specs[platform]
  const icons = {
    signal: `<svg width="18" height="12" viewBox="0 0 18 12" fill="${ink}" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>`,
    wifi: `<svg width="16" height="12" viewBox="0 0 16 12" fill="${ink}" aria-hidden="true"><path d="M8 2.6c2.3 0 4.4.9 6 2.4l1.3-1.4A10.6 10.6 0 0 0 8 .6C5.2.6 2.6 1.7.7 3.6L2 5c1.6-1.5 3.7-2.4 6-2.4Zm0 3.8c1.3 0 2.5.5 3.4 1.3l1.3-1.4A6.8 6.8 0 0 0 8 4.4c-1.8 0-3.5.7-4.7 1.9l1.3 1.4c.9-.8 2.1-1.3 3.4-1.3Zm0 3.7c.5 0 .9.2 1.2.5L8 12l-1.2-1.4c.3-.3.7-.5 1.2-.5Z"/></svg>`,
    battery:
      platform === "ios"
        ? `<svg width="27" height="13" viewBox="0 0 27 13" aria-hidden="true"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="${ink}" stroke-opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2.2" fill="${ink}"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill="${ink}" fill-opacity=".4"/></svg>`
        : `<svg width="9" height="15" viewBox="0 0 9 15" fill="${ink}" aria-hidden="true"><rect x="3" y="0" width="3" height="2" rx=".5"/><rect x="0" y="1.5" width="9" height="13.5" rx="1.5"/></svg>`,
  }
  const screen = `left:${spec.bezel}px;top:${spec.bezel}px;width:${spec.width}px;height:${spec.height}px;border-radius:${spec.screenRadius}px`
  const body = `<div class="device-body" style="position:absolute;inset:0;z-index:0;border-radius:${spec.radius}px;background:#1d1d1f;box-shadow:inset 0 0 0 2px #3a3a3c,0 18px 48px rgba(0,0,0,.28)"></div>`
  const chrome =
    platform === "ios"
      ? `<div class="device-status" style="position:absolute;left:0;right:0;top:0;height:${spec.safeArea.top - 5}px;display:flex;align-items:center;justify-content:space-between;padding:4px 30px 0 52px;box-sizing:border-box;color:${ink};font:600 17px/1 -apple-system,'SF Pro Text',system-ui,sans-serif"><span class="device-time">9:41</span><span class="device-icons" style="display:flex;gap:6px;align-items:center">${icons.signal}${icons.wifi}${icons.battery}</span></div><div class="device-camera" style="position:absolute;top:11px;left:50%;width:126px;height:37px;margin-left:-63px;border-radius:19px;background:#000"></div><div class="device-home" style="position:absolute;bottom:8px;left:50%;width:139px;height:5px;margin-left:-70px;border-radius:3px;background:${ink}"></div>`
      : `<div class="device-status" style="position:absolute;left:0;right:0;top:0;height:${spec.safeArea.top}px;display:flex;align-items:center;justify-content:space-between;padding:0 22px;box-sizing:border-box;color:${ink};font:500 14px/1 Roboto,system-ui,sans-serif"><span class="device-time">9:41</span><span class="device-icons" style="display:flex;gap:6px;align-items:center">${icons.wifi}${icons.signal}${icons.battery}</span></div><div class="device-camera" style="position:absolute;top:12px;left:50%;width:18px;height:18px;margin-left:-9px;border-radius:50%;background:#000;box-shadow:0 0 0 2px #1d1d1f"></div><div class="device-home" style="position:absolute;bottom:10px;left:50%;width:108px;height:4px;margin-left:-54px;border-radius:2px;background:${ink};opacity:.7"></div>`
  return {
    platform,
    ...spec,
    html: `${body}<div class="device-overlay" data-platform="${platform}" style="position:absolute;z-index:2;overflow:hidden;pointer-events:none;${screen}">${chrome}</div>`,
  }
}
