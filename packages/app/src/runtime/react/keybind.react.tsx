/** @jsxImportSource react */
import "../../../../ui/src/data-display/keybind/keybind.css"

export function Keybind(props: { keys: string[] }) {
  return (
    <div data-component="keybind-v2" data-variant="neutral">
      {props.keys.map((key, index) => (
        <div key={index} data-slot="keybind-v2-key">
          <span data-slot="keybind-v2-label">{key}</span>
        </div>
      ))}
    </div>
  )
}
