/** @jsxImportSource react */
import { useId, useState, type CSSProperties } from "react"
import { Disclosure } from "@reddb-io/design-system/base/Disclosure"
import { Button } from "@reddb-io/design-system/base/Button"
import { Switch } from "@reddb-io/design-system/base/Switch"
import {
  timelineCategories,
  timelinePreset,
  timelinePresets,
  type TimelineCategory,
  type TimelineDetail,
  type TimelinePlacement,
} from "@opencode/session-ui/timeline/detail"
import type { SettingsLanguage } from "./shared.react"
import { SettingsIcon } from "./icon.react"
import "./timeline-detail.css"

const presets = timelinePresets.toReversed()
export function TimelineDetailControl(props: {
  value: TimelineDetail
  onChange: (value: TimelineDetail) => void
  language: SettingsLanguage
}) {
  const id = useId()
  const language = props.language
  const [placements, setPlacements] = useState<Partial<Record<TimelineCategory, Exclude<TimelinePlacement, "hidden">>>>(
    {},
  )
  const preset = timelinePreset(props.value)
  const [advanced, setAdvanced] = useState(!preset)
  const position = preset ? presets.indexOf(preset) : 2
  const label = preset ? language.t(`settings.timeline.preset.${preset.id}`) : language.t("settings.timeline.custom")
  return (
    <div data-component="timeline-detail-control">
      <div data-slot="settings-row-copy">
        <label data-slot="settings-row-title" htmlFor={`${id}-slider`}>
          {language.t("settings.timeline.detail")}
        </label>
        <div id={`${id}-description`} data-slot="settings-row-description">
          {language.t("settings.timeline.description")}
        </div>
      </div>
      <div data-slot="timeline-detail-scale">
        <div
          data-slot="timeline-detail-track"
          aria-hidden="true"
          style={{ "--timeline-detail-progress": `${(position / (presets.length - 1)) * 100}%` } as CSSProperties}
        >
          {presets.map((preset, index) => (
            <span
              key={preset.id}
              data-selected={index <= position ? "" : undefined}
              style={{ insetInlineStart: `${(index / (presets.length - 1)) * 100}%` }}
            />
          ))}
        </div>
        <input
          id={`${id}-slider`}
          data-action="settings-timeline-detail"
          type="range"
          min={0}
          max={presets.length - 1}
          step={1}
          value={position}
          aria-valuetext={label}
          aria-describedby={`${id}-description ${id}-preset-description`}
          onChange={(event) => props.onChange({ ...presets[event.currentTarget.valueAsNumber].value })}
        />
      </div>
      <p id={`${id}-preset-description`} aria-live="polite">
        <span data-slot="timeline-detail-summary">{language.t("settings.timeline.summary", { preset: label })}</span>{" "}
        {language.t(`settings.timeline.description.${preset?.id ?? "custom"}`)}
      </p>
      <div data-slot="timeline-detail-advanced">
        <Disclosure
          label={language.t("settings.timeline.advanced")}
          open={advanced}
          onOpenChange={setAdvanced}
          triggerClass="settings-timeline-advanced-trigger"
        >
          <div
            data-slot="timeline-detail-categories"
            role="group"
            aria-label={language.t("settings.timeline.advanced.description")}
          >
            <div data-slot="timeline-detail-columns">
              <span aria-hidden="true" />
              <span>{language.t("settings.timeline.group")}</span>
              <span>{language.t("settings.timeline.collapse")}</span>
            </div>
            <div data-slot="timeline-detail-list">
              {timelineCategories.map((category) => {
                const current = props.value[category]
                const hidden = current.placement === "hidden"
                return (
                  <div
                    key={category}
                    data-slot="timeline-detail-category"
                    data-hidden={hidden ? "" : undefined}
                    role="group"
                    aria-labelledby={`${id}-${category}`}
                  >
                    <div data-slot="timeline-detail-activity">
                      <Button
                        id={`${id}-${category}-visibility`}
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-action="timeline-detail-visibility"
                        title={language.t(
                          hidden ? "settings.timeline.visibility.show" : "settings.timeline.visibility.hide",
                        )}
                        aria-label={language.t("settings.timeline.visibility.label", {
                          activity: language.t(`settings.timeline.category.${category}`),
                        })}
                        aria-pressed={!hidden}
                        onClick={() => {
                          if (current.placement !== "hidden")
                            setPlacements((previous) => ({ ...previous, [category]: current.placement }))
                          props.onChange({
                            ...props.value,
                            [category]: {
                              ...current,
                              placement: hidden ? (placements[category] ?? "grouped") : "hidden",
                            },
                          })
                        }}
                      >
                        <SettingsIcon name={hidden ? "outline-eye-slash" : "outline-eye"} />
                      </Button>
                      <label id={`${id}-${category}`} htmlFor={`${id}-${category}-visibility`}>
                        {language.t(`settings.timeline.category.${category}`)}
                      </label>
                    </div>
                    <div data-slot="timeline-detail-placement">
                      <span data-slot="timeline-detail-field-label" aria-hidden="true">
                        {language.t("settings.timeline.group")}
                      </span>
                      {hidden ? (
                        <span data-slot="timeline-detail-unavailable" aria-hidden="true" />
                      ) : (
                        <Switch
                          data-category={category}
                          data-field="placement"
                          label={language.t("settings.timeline.grouped.label", {
                            activity: language.t(`settings.timeline.category.${category}`),
                          })}
                          fieldClass="settings-react-switch"
                          checked={current.placement === "grouped"}
                          onCheckedChange={(checked) =>
                            props.onChange({
                              ...props.value,
                              [category]: { ...current, placement: checked ? "grouped" : "separate" },
                            })
                          }
                        />
                      )}
                    </div>
                    <div data-slot="timeline-detail-expansion">
                      {(category === "shell" || category === "edit" || category === "thinking") && (
                        <>
                          <span data-slot="timeline-detail-field-label" aria-hidden="true">
                            {language.t("settings.timeline.collapse")}
                          </span>
                          {hidden ? (
                            <span data-slot="timeline-detail-unavailable" aria-hidden="true" />
                          ) : (
                            <Switch
                              data-category={category}
                              data-field="details"
                              label={language.t("settings.timeline.collapsed.label", {
                                activity: language.t(`settings.timeline.category.${category}`),
                              })}
                              fieldClass="settings-react-switch"
                              checked={props.value[category].details === "collapsed"}
                              onCheckedChange={(checked) =>
                                props.onChange({
                                  ...props.value,
                                  [category]: { ...current, details: checked ? "collapsed" : "expanded" },
                                })
                              }
                            />
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </Disclosure>
      </div>
    </div>
  )
}
