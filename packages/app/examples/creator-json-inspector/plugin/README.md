# JSON Inspector

Plugin de servidor do Redcode (SDK) com duas ferramentas de agente **somente leitura** para trabalhar com JSON: validação com resumo estrutural e consulta por JSON Pointer (RFC 6901). Nenhuma das ferramentas modifica arquivos; não há execução de código, `eval`, acesso a rede, filesystem ou credenciais.

- **ID do plugin:** `creator.json-inspector`
- **Entry point:** `server.js` (sem imports e sem dependências)
- **Arquivo de pacote:** `package.json` (`creator-json-inspector` v1.0.0, `type: module`)

## Ferramentas registradas

### 1. `json_inspect`

Valida o texto JSON com `JSON.parse` e resume a estrutura sem recursão (percorre o documento com uma pilha explícita, então aceita documentos muito profundos).

**Entrada** (obrigatória: `json`):

| Campo  | Tipo     | Descrição                    |
| ------ | -------- | ---------------------------- |
| `json` | `string` | Texto JSON a ser analisado   |

**Saída de sucesso:** `{ ok, type, counts }`, onde `type` é o tipo do valor raiz (`object`, `array`, `string`, `number`, `boolean` ou `null`) e `counts` traz `objects`, `arrays`, `keys` e `values`. A contagem considera apenas propriedades próprias; primitivos nunca são tratados como objetos.

**Saída de erro:** `{ ok: false, error }` com mensagem clara — a ferramenta nunca derruba o agente.

### 2. `json_pointer_get`

Lê o valor apontado por um [JSON Pointer RFC 6901](https://datatracker.ietf.org/doc/html/rfc6901) dentro de um texto JSON.

**Entrada** (obrigatórias: `json`, `pointer`):

| Campo     | Tipo     | Descrição                          |
| --------- | -------- | ---------------------------------- |
| `json`    | `string` | Texto JSON de origem               |
| `pointer` | `string` | JSON Pointer RFC 6901 do valor     |

**Comportamento do ponteiro:**

- `""` (string vazia) retorna o documento inteiro.
- `/a/b` navega pelas chaves de objetos (apenas propriedades próprias).
- `/0`, `/12` acessam índices de array na forma canônica (`"01"`, `"-1"` e `"+"` são rejeitados).
- `~0` representa `~` literal e `~1` representa `/` literal; escapes malformados (ex.: `~2`, `~` solto) geram erro claro.
- Ponteiro inexistente (chave ausente ou índice fora dos limites) gera erro claro indicando o segmento.
- Navegar dentro de um primitivo (ex.: `/active/x`) gera erro claro.

**Saída de sucesso:** `{ ok, pointer, value, type }`. **Saída de erro:** `{ ok: false, error }`.

## Como usar

Após instalar e ativar o plugin em **Project settings → Agent Extensions → Plugins**, peça ao agente em linguagem natural. Exemplos de prompts:

**Prompt 1 — resumo estrutural:**

> Use a ferramenta `json_inspect` neste texto e me diga o tipo da raiz e quantos objetos, arrays, chaves e valores ele tem: `{"customer":{"name":"Ana","email":"ana@example.com"},"orders":[{"id":"ORD-1042","total":149.9}],"active":true}`

**Prompt 2 — consulta por ponteiro:**

> Use a ferramenta `json_pointer_get` com ponteiro `/customer/email` no documento `{"customer":{"name":"Ana","email":"ana@example.com"},"orders":[{"id":"ORD-1042","total":149.9}],"active":true}` e me diga o valor e o tipo encontrados.

## Exemplos reais

Documento de exemplo usado em todos os casos abaixo:

```json
{"customer":{"name":"Ana","email":"ana@example.com"},"orders":[{"id":"ORD-1042","total":149.9}],"active":true}
```

### `json_inspect`

```json
{ "json": "{\"customer\":{\"name\":\"Ana\",\"email\":\"ana@example.com\"},\"orders\":[{\"id\":\"ORD-1042\",\"total\":149.9}],\"active\":true}" }
```

Resposta:

```json
{ "ok": true, "type": "object", "counts": { "objects": 3, "arrays": 1, "keys": 7, "values": 9 } }
```

Contagem detalhada: objetos = raiz + `customer` + `orders[0]`; arrays = `orders`; chaves = `customer`, `orders`, `active`, `name`, `email`, `id`, `total`; valores = os 5 valores folha (`name`, `email`, `id`, `total`, `active`) + a raiz + o array `orders` + os objetos `customer` e `orders[0]`.

### `json_pointer_get`

| Entrada                                        | Resposta                                                    |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `{"json":"…","pointer":"/customer/email"}`     | `{"ok":true,"pointer":"/customer/email","value":"ana@example.com","type":"string"}` |
| `{"json":"…","pointer":"/orders/0/total"}`     | `{"ok":true,"pointer":"/orders/0/total","value":149.9,"type":"number"}` |
| `{"json":"…","pointer":""}`                    | `{"ok":true,"pointer":"","value":{…documento inteiro…},"type":"object"}` |
| `{"json":"…","pointer":"/customer/name~1real"}`| `{"ok":false,"error":"JSON Pointer segment 1: object has no own key 'name/real'."}` |
| `{"json":"…","pointer":"/orders/5/id"}`        | `{"ok":false,"error":"JSON Pointer segment 1: array index 5 is out of bounds (length 1)."}` |
| `{"json":"{ quebrado","pointer":"/a"}`         | `{"ok":false,"error":"Invalid JSON: …"}`                    |

### Instalação

Este plugin **não está instalado** pela entrega — a fonte e o pacote ficam publicados nesta revisão do Design. Para instalá-lo, use **Project settings → Agent Extensions → Plugins → Install Creator plugin**, revise o pacote (`package.json` + `server.js` na raiz), instale desativado, teste carregamento/registro/teardown e só então ative no servidor desejado.

## Limites

- Somente leitura: nenhuma ferramenta grava, move ou apaga arquivos.
- Sem dependências: `server.js` não importa nenhum módulo.
- Sem `eval`/`Function`: o JSON é interpretado apenas por `JSON.parse`.
- Sem acesso a rede, filesystem, processos ou credenciais.
