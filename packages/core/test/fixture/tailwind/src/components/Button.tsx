// @ts-nocheck -- compiled by the Design build under test, not by this package's typecheck
export function Button(props: { children?: string }) {
  return (
    <button type="button" className="rounded-md bg-brand px-3 py-2 text-white">
      {props.children ?? "Fixture button"}
    </button>
  )
}
