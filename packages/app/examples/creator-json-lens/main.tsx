/** @jsxImportSource react */
import { useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import { Button } from "@reddb-io/design-system/base/Button"
import { Badge } from "@reddb-io/design-system/base/Badge"
import { Input } from "@reddb-io/design-system/base/Input"
import { Textarea } from "@reddb-io/design-system/base/Textarea"
import { Alert } from "@reddb-io/design-system/base/Alert"
import { KpiCard } from "@reddb-io/design-system/data/KpiCard"
import { BreakdownBar } from "@reddb-io/design-system/data/BreakdownBar"
import { JsonTree } from "@reddb-io/design-system/data/JsonTree"
import { Braces, ChevronRight, Code2, FileJson2, LockKeyhole, RotateCcw, Search } from "lucide-react"
import { inspect, pointer, sample } from "./model"
import "./style.css"

function App() {
  const [source, setSource] = useState(sample)
  const [path, setPath] = useState("/customer/email")
  const [expanded, setExpanded] = useState<readonly string[]>(["$", "customer", "orders", "orders.0"])
  const [selected, setSelected] = useState<string | null>(null)
  const analysis = useMemo(() => inspect(source), [source])
  const result = useMemo(() => (analysis.ok ? pointer(analysis.value, path) : undefined), [analysis, path])
  return (
    <main>
      <header>
        <div className="identity">
          <span className="mark">
            <Braces size={19} strokeWidth={1.6} />
          </span>
          <div>
            <h1>JSON Lens</h1>
            <p>Uma lente para os seus payloads.</p>
          </div>
        </div>
        <Badge variant="outline">
          <span className="dot" />
          Creator · visual
        </Badge>
      </header>
      <div className="intro">
        <span>
          <LockKeyhole size={12} /> Processamento local, sem envio de dados
        </span>
        <span>Exemplo editável</span>
      </div>
      <section className="metrics" aria-label="Métricas do documento">
        <KpiCard
          label="Tamanho"
          value={analysis.ok ? `${(analysis.bytes / 1024).toFixed(2)} KB` : "—"}
          description="UTF-8"
        />
        <KpiCard label="Propriedades" value={analysis.ok ? analysis.keys : "—"} description="em todos os objetos" />
        <KpiCard
          label="Valores"
          value={analysis.ok ? analysis.leaves : "—"}
          description="strings, números e literais"
        />
        <KpiCard label="Profundidade" value={analysis.ok ? analysis.depth : "—"} description="níveis da estrutura" />
      </section>
      <section className="editor-grid">
        <div className="panel">
          <div className="panel-heading">
            <h2>
              <Code2 size={14} /> Documento
            </h2>
            <div className="actions">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSource(sample)
                  setPath("/customer/email")
                }}
                aria-label="Restaurar exemplo"
              >
                <RotateCcw size={13} />
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!analysis.ok}
                onClick={() => analysis.ok && setSource(JSON.stringify(analysis.value, null, 2))}
              >
                Formatar
              </Button>
            </div>
          </div>
          <Textarea aria-label="Documento JSON" spellCheck={false} value={source} onValueChange={setSource} />
          <div className="editor-status" aria-live="polite">
            <span className={analysis.ok ? "valid" : "invalid"}>
              {analysis.ok ? "● JSON válido" : "● JSON inválido"}
            </span>
            <span>{source.split("\n").length} linhas</span>
          </div>
        </div>
        <div className="panel">
          <div className="panel-heading">
            <h2>
              <FileJson2 size={14} /> Estrutura
            </h2>
            <Badge variant="outline">{analysis.ok ? analysis.root : "—"}</Badge>
          </div>
          <div className="tree-wrap">
            {analysis.ok ? (
              <JsonTree
                value={analysis.value}
                label="Estrutura do JSON"
                expanded={expanded}
                onExpandedChange={setExpanded}
                selected={selected}
                onSelectedChange={setSelected}
              />
            ) : (
              <div className="tree-empty">Corrija o documento para explorar sua estrutura.</div>
            )}
          </div>
          <div className="editor-status">
            <span>Navegue com as setas do teclado</span>
            <span>{analysis.ok ? `${analysis.objects} obj · ${analysis.arrays} arrays` : "—"}</span>
          </div>
        </div>
      </section>
      {!analysis.ok && (
        <Alert tone="danger" title="Não foi possível analisar o documento">
          {analysis.error}
        </Alert>
      )}
      <section className="panel composition">
        <div className="panel-heading">
          <h2>Composição dos valores</h2>
          <span className="muted">Calculada do documento atual</span>
        </div>
        {analysis.ok && <BreakdownBar label="Distribuição por tipo JSON" items={analysis.types} format={String} />}
      </section>
      <section className="panel lookup">
        <div className="panel-heading">
          <h2>
            <Search size={14} /> Consultar caminho
          </h2>
          <span className="muted">JSON Pointer · RFC 6901</span>
        </div>
        <label className="pointer-row">
          <span aria-hidden="true">
            <ChevronRight size={14} />
          </span>
          <Input
            type="text"
            aria-label="Caminho JSON Pointer"
            value={path}
            onValueChange={setPath}
            placeholder="/customer/email"
            controlSize="sm"
          />
        </label>
        <div className={`result ${result?.ok === false ? "invalid" : ""}`} aria-live="polite">
          <code>
            {!result ? "Documento inválido" : result.ok ? JSON.stringify(result.value, null, 2) : result.error}
          </code>
          {result?.ok && <Badge variant="outline">{result.type}</Badge>}
        </div>
        <div className="presets">
          Experimentar:{" "}
          {["/customer/email", "/orders/0/total", "/active"].map((item) => (
            <Button key={item} size="sm" variant="ghost" onClick={() => setPath(item)}>
              {item}
            </Button>
          ))}
        </div>
      </section>
      <footer>
        <span>
          <Braces size={12} /> reddb.io / design system
        </span>
        <span>Componente isolado · sem permissões do servidor</span>
      </footer>
    </main>
  )
}
createRoot(document.getElementById("root")!).render(<App />)
