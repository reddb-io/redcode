/** @jsxImportSource react */
import { useLayoutEffect, useRef, useState } from "react"
import type { SettingsLanguage } from "./shared.react"

export function SettingsSearchEmpty(props: { query: string; language: SettingsLanguage }) {
  const language = props.language
  const [query, setQuery] = useState(props.query)
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const text = (query: string) => language.t("settings.search.empty.query", { query })

  const update = () => {
    const container = containerRef.current
    const measure = measureRef.current
    if (!container || !measure) return
    const style = getComputedStyle(container)
    measure.textContent = language.t("settings.search.empty", { query: "" })

    // Measure the available query space independently of its current truncated text.
    const width =
      container.clientWidth -
      parseFloat(style.paddingInlineStart) -
      parseFloat(style.paddingInlineEnd) -
      measure.getBoundingClientRect().width

    const fits = (query: string) => {
      measure!.textContent = text(query)

      return measure!.getBoundingClientRect().width <= width
    }

    if (fits(props.query)) {
      setQuery(props.query)

      return
    }

    const characters = Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(props.query),
      (item) => item.segment,
    )

    let start = 0
    let end = characters.length

    while (start < end) {
      const middle = Math.ceil((start + end) / 2)

      if (fits(`${characters.slice(0, middle).join("").trimEnd()}…`)) {
        start = middle
        continue
      }

      end = middle - 1
    }

    setQuery(`${characters.slice(0, start).join("").trimEnd()}…`)
  }

  useLayoutEffect(() => {
    update()
    const observer = new ResizeObserver(update)
    if (containerRef.current) observer.observe(containerRef.current)
    if (measureRef.current) observer.observe(measureRef.current)
    return () => observer.disconnect()
  }, [props.query, language])

  return (
    <>
      <div
        ref={containerRef}
        className="settings-search-empty"
        role="status"
        aria-label={language.t("settings.search.empty", { query: text(props.query) })}
      >
        {language.rich("settings.search.empty", {
          query: (
            <span key="query" className="settings-search-empty-quoted">
              <bdi dir="auto">{text(query)}</bdi>
            </span>
          ),
        })}
      </div>
      <span className="settings-search-empty-measure" aria-hidden="true">
        <span ref={measureRef} dir="auto" />
      </span>
    </>
  )
}
