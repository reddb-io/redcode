/** @jsxImportSource react */
import { type CSSProperties, useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { Button } from "@reddb-io/design-system/base/Button"
import { Badge } from "@reddb-io/design-system/base/Badge"
import { Slider } from "@reddb-io/design-system/base/Slider"
import { Switch } from "@reddb-io/design-system/base/Switch"
import { Box, MoveUpRight, Pause, Play, RotateCcw } from "lucide-react"
import { scene } from "./scene"
import "./style.css"

const materials = [
  { name: "Coral", color: "#fb5c79" },
  { name: "Azul", color: "#6b9eff" },
  { name: "Sálvia", color: "#8bc7a2" },
  { name: "Argila", color: "#d6a780" },
]

function App() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<ReturnType<typeof scene> | null>(null)
  const [controls, setControls] = useState({ size: 1, zoom: 1, material: 0, wireframe: false, playing: false })
  const [error, setError] = useState("")
  const [orientation, setOrientation] = useState({ x: 24, y: 36 })
  useEffect(() => {
    if (!canvas.current) return
    try {
      renderer.current = scene(canvas.current, setOrientation, (zoom) =>
        setControls((previous) => ({ ...previous, zoom })),
      )
      return () => renderer.current?.dispose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])
  useEffect(() => renderer.current?.update(controls, materials[controls.material].color), [controls])
  return (
    <main>
      <header className="studio-header">
        <div className="identity">
          <span className="identity-icon">
            <Box size={18} strokeWidth={1.5} />
          </span>
          <div>
            <h1>Cube studio</h1>
            <p>Uma pequena ideia, em três dimensões.</p>
          </div>
        </div>
        <Badge variant="outline">
          <span className="live-dot" />
          3D interativo
        </Badge>
      </header>
      <section className="studio" aria-label="Editor do cubo">
        <div className="viewport">
          <div className="viewport-top">
            <span className="eyebrow">PERSPECTIVA</span>
            <span className="view-mode">{controls.wireframe ? "Estrutura" : "Sólido"}</span>
          </div>
          <div className="ground-grid" />
          <div className="shadow" />
          <canvas ref={canvas} aria-label="Cubo 3D: arraste para girar ou use as setas do teclado" tabIndex={0} />
          {error && (
            <p className="scene-error" role="alert">
              {error}
            </p>
          )}
          <div className="axis" aria-hidden="true">
            <span className="axis-z">Z</span>
            <span className="axis-y">Y</span>
            <span className="axis-x">X</span>
          </div>
          <div className="viewport-bottom">
            <span>
              Arraste para girar <span className="separator">·</span> Scroll para zoom
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Restaurar câmera"
              onClick={() => {
                renderer.current?.reset()
                setControls({ size: 1, zoom: 1, material: 0, wireframe: false, playing: false })
              }}
            >
              <RotateCcw size={13} />
            </Button>
          </div>
        </div>
        <aside aria-label="Propriedades do cubo">
          <section>
            <h2>Material</h2>
            <div className="swatches">
              {materials.map((material, index) => (
                <button
                  key={material.name}
                  type="button"
                  className="swatch"
                  style={{ "--swatch": material.color } as CSSProperties}
                  aria-label={`Material ${material.name}`}
                  aria-pressed={controls.material === index}
                  onClick={() => setControls({ ...controls, material: index })}
                >
                  <span />
                </button>
              ))}
            </div>
            <div className="material-label">
              <span>{materials[controls.material].name}</span>
              <code>{materials[controls.material].color.toUpperCase()}</code>
            </div>
          </section>
          <section className="sliders">
            <h2>Transformação</h2>
            <Slider
              label="Tamanho"
              value={controls.size}
              min={0.6}
              max={1.4}
              step={0.05}
              formatValue={(value) => `${value.toFixed(2)}×`}
              onValueChange={(size) => setControls({ ...controls, size })}
            />
            <Slider
              label="Zoom"
              value={controls.zoom}
              min={0.7}
              max={1.5}
              step={0.05}
              formatValue={(value) => `${Math.round(value * 100)}%`}
              onValueChange={(zoom) => setControls({ ...controls, zoom })}
            />
            <div className="rotation-readout">
              <span>Rotação</span>
              <code>
                {orientation.x}° <span>/</span> {orientation.y}°
              </code>
            </div>
          </section>
          <section className="display-settings">
            <h2>Visualização</h2>
            <Switch
              label="Wireframe"
              checked={controls.wireframe}
              onCheckedChange={(wireframe) => setControls({ ...controls, wireframe })}
            />
            <Button
              variant={controls.playing ? "primary" : "secondary"}
              size="sm"
              block
              onClick={() => setControls({ ...controls, playing: !controls.playing })}
            >
              {controls.playing ? <Pause size={13} /> : <Play size={13} />}
              {controls.playing ? "Pausar rotação" : "Animar cubo"}
            </Button>
          </section>
        </aside>
      </section>
      <footer>
        <div className="geometry">
          <span>
            <strong>8</strong> vértices
          </span>
          <span>
            <strong>12</strong> triângulos
          </span>
          <span>
            <strong>1</strong> material
          </span>
        </div>
        <span className="render-status">
          <span className="live-dot" />
          {controls.playing ? "Animação · até 30 fps" : "Render sob demanda"}
        </span>
      </footer>
      <div className="studio-note">
        <MoveUpRight size={12} />
        <span>Componente local · controles do Design System · sem requests externos</span>
      </div>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<App />)
