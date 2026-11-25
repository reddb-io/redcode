import { radialProgress, type RadialProgressVariants } from "@reddb-io/design-system/contracts/radial-progress"
import { type ComponentProps, Show, splitProps } from "solid-js"
import "./progress-circle.css"

export interface ProgressCircleProps extends Pick<ComponentProps<"svg">, "class" | "classList" | "style"> {
  percentage: number
  appearance?: "compact" | "indicator"
  size?: number
  strokeWidth?: number
  tone?: RadialProgressVariants["tone"]
}

export function ProgressCircle(props: ProgressCircleProps) {
  const [local, rest] = splitProps(props, [
    "percentage",
    "appearance",
    "size",
    "strokeWidth",
    "tone",
    "class",
    "classList",
  ])
  const indicator = () => local.appearance === "indicator"
  const viewBox = () => (indicator() ? 16 : 14)
  const stroke = () => local.strokeWidth ?? (indicator() ? 3 : 1.5)
  const center = () => viewBox() / 2
  const radius = () => center() - stroke() / 2
  const slots = () => radialProgress({ tone: local.tone })

  return (
    <svg
      {...rest}
      class={local.class}
      classList={local.classList}
      width={local.size ?? viewBox()}
      height={local.size ?? viewBox()}
      viewBox={`0 0 ${viewBox()} ${viewBox()}`}
      data-component="progress-circle"
      data-appearance={local.appearance ?? "compact"}
      aria-hidden="true"
    >
      <g class={slots().svg({ class: "origin-center" })} stroke-width={stroke()}>
        <circle
          data-slot="progress-circle-background"
          class={slots().track()}
          cx={center()}
          cy={center()}
          r={radius()}
        />
        <Show when={indicator()}>
          <circle data-slot="progress-circle-background-overlay" fill="none" cx={center()} cy={center()} r={radius()} />
        </Show>
        <circle
          data-slot="progress-circle-progress"
          class={slots().indicator()}
          cx={center()}
          cy={center()}
          r={radius()}
          pathLength="100"
          stroke-dasharray="100"
          stroke-dashoffset={100 - Math.max(0, Math.min(100, local.percentage || 0))}
        />
      </g>
    </svg>
  )
}
