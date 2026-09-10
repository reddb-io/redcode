# Compactação em Oh My Pi, Hermes e DeepSeek Harness

Data: 2026-09-10.
Pergunta: quando compactam, com quais limites e timings, como escolhem o que preservar, qual prompt usam e o que o Redcode pode aprender.
Escopo: leitura estática do código e documentação oficiais, com commits fixados abaixo; comparação com Redcode 0.25.1. Não executei benchmarks de LLM nem implementei mudanças no runtime. Tempos configurados não são medições de latência.

## Resumo executivo

Os três tratam compactação como manutenção do contexto enviado ao modelo. Isso deve ser distinguido do histórico persistido: retirar algo do próximo prompt não exige apagar sua origem. As diferenças mais úteis são a antecipação assíncrona do Oh My Pi, as proteções explícitas da intenção e recuperação do Hermes, e a medição/transação unificadas do DeepSeek. [O1–O6, H1–H5, D1–D5]

Não existe um único “prompt de compactação” que explique todo o comportamento. Primeiro o código escolhe região, poda, orçamento e método; depois, quando necessário, um modelo produz o resumo; por último o harness valida e recompõe o contexto. Um excelente prompt não consegue recuperar conteúdo que o corte já removeu da entrada do sumarizador.

| Projeto  | Disparo automático efetivo                                                                                                                                                   | O que fica recente                                                                                          | Execução e tempo                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Oh My Pi | Por padrão, acima de `W − max(15% de W, 16.384)`, com recuperação proporcional para janelas pequenas; limite absoluto e percentual podem sobrescrever                        | Aproximadamente 20.000 tokens no corte convencional; métodos nativos/visuais têm políticas próprias         | Verifica em fronteiras seguras, inclusive entre ferramentas; especulação antecipada ligada por padrão; idle opcional    |
| Hermes   | Base 50%; abaixo de 512.000 tokens aplica piso de 75% ao percentual. Incide sobre a janela após reserva de saída, com regras adicionais para janelas pequenas e cap absoluto | Modo `lean`: orçamento `clamp(2,5% de W, 10.000, 25.000)`, sujeito a âncoras, agrupamento e poda            | Preflight no início e antes de chamadas, reação a overflow; timeout por inatividade de 120 s e teto pré-commit de 600 s |
| DeepSeek | Pressão medida `>= floor(80% de W)`; a métrica inclui o envelope e pressão de request/response, não apenas o texto do chat                                                   | Cauda de unidades completas somando pelo menos o orçamento de 16% de W, respeitando os pares de ferramentas | Listener serial `agent/pre-step`; poda antes do resumo; sem especulação ou timer idle nesse backend                     |

`W` é a janela do modelo. Defaults não são recomendações empiricamente comprovadas: especialmente o DeepSeek declara que falta orientação baseada em corpus para seus percentuais. [O1–O3, H1–H3, D1, D2, D5]

## Fontes oficiais e versões

| Repositório                    | Commit lido                                            |
| ------------------------------ | ------------------------------------------------------ |
| `can1357/oh-my-pi`             | `2e6b5b79a0c5b190797aace99f41fab6ae42e6c5`             |
| `NousResearch/hermes-agent`    | `425b00174d0ad7f311819695e86684376b76b008`             |
| `deepseek-ai/deepseek-harness` | `aa8262ec091698bae9a6b04773a6b5b06ad4aef2`             |
| `reddb-io/redcode`             | `eaab9f69396d20b63f616729c562aa9a6aa9618a` (`v0.25.1`) |

Os remotos foram consultados nesta pesquisa. O Hermes avançou desde o estudo anterior sobre tarefas; o DeepSeek também avançou, mas a comparação de `packages/compaction` com o commit anterior mostrou apenas metadados/documentação, sem alteração de runtime nesse diretório. Links no fim apontam aos snapshots, evitando confundir esta leitura com mudanças futuras.

## Oh My Pi: antecipar a espera e oferecer vários métodos

### Quando dispara

- Compactação automática e verificações no meio do turno estão ligadas. O check ocorre em fronteiras seguras do loop, antes de outra requisição, e na manutenção após o turno. Overflow tem recuperação própria. Não há compactação arbitrária no meio de uma resposta parcialmente recebida. [O1, O3]
- O limite normal é uma reserva: `T = W − max(floor(0,15 × W), reserveTokens ?? 16384)`. O código ajusta a reserva quando o default torna uma janela pequena impraticável. `thresholdTokens` positivo tem precedência; depois vem `thresholdPercent`; sem ambos, vale a reserva. [O2]
- A decisão usa o maior valor entre uso informado pelo provider e estimativa local do histórico armazenado. Isso evita que uma transformação que encolha o payload esconda o crescimento do histórico original. Não é simplesmente usar o último número de tokens exibido na interface. [O2]

### Compactação especulativa

`asyncEnabled` é `true`. O trabalho em segundo plano pode começar em `[T − L, T)`, com `L = clamp(floor(12,5% de T), 8192, 32000)`. O resultado fica preparado; a aplicação ocorre depois, numa manutenção efetiva. [O1, O3, O4]

Exemplo calculado, não benchmark: numa janela de 200.000 tokens, `T = 170.000`, `L = 21.250`, e a preparação pode começar em 148.750. Se o usuário continuar enquanto o resumo roda, as mensagens posteriores não fazem parte da região antiga a substituir. O resultado só é aceito se a validação do branch/snapshot ainda permitir aplicá-lo. Crescimento maior que `max(keepRecentTokens, 8192)` pode disparar atualização de um resumo já preparado. [O3, O4]

Existe uma faixa de tolerância acima do limiar enquanto a preparação ainda roda: ela termina em `min(T + L, W − 8192)`. Acima disso volta a manutenção bloqueante. Essa tolerância não se aplica indiscriminadamente: extensões com `session_before_compact`, métodos locais prioritários e configuração sem async alteram o caminho. [O3]

O idle é uma opção separada, desligada por padrão: 300 segundos e pelo menos 200.000 tokens. Na TUI, precisa estar sem streaming e com editor vazio; o timer revalida as condições. Isso é compactar enquanto o usuário está ausente, diferente do Hermes, que pode compactar quando ele retorna. [O1, O8]

### Como compacta e o que preserva

A ordem padrão de fallback é `remote → snapcompact → handoff → shake → soft`; cada método ainda precisa ser elegível. [O5]

| Método        | Mecânica                                                                                                      | Prompt conhecido no repositório?                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `remote`      | Compactação nativa compatível com OpenAI; mantém dados opacos de replay vinculados à rota/modelo              | Há integração, mas não dá para afirmar o prompt interno do serviço remoto |
| `snapcompact` | Representa histórico em imagens densas que um modelo com visão lê; não faz chamada a LLM para gerar um resumo | Usa framing e notas de arquivo, não o mesmo prompt de sumarização textual |
| `handoff`     | Gera documento para outra instância continuar                                                                 | Sim: `handoff-document.md`                                                |
| `shake`       | Substitui conteúdo pesado recuperável por referências/placeholders, sem sumarizador                           | Não precisa de LLM para a poda                                            |
| `soft`        | Resumo textual local ao harness, via modelo selecionado para compactação                                      | Sim: prompts de resumo inicial, atualização e prefixo de turno            |

No corte textual convencional, percorre o histórico de trás para frente buscando aproximadamente 20K tokens recentes. Nunca corta começando num resultado de ferramenta separado de sua chamada. Se divide um turno grande, cria também um resumo do prefixo desse turno, contendo `Original Request`, `Early Progress`, `Context for Suffix`. [O2, O6]

`shake` não equivale a “remover todas as tools antigas”: respeita janela recente, protege skills e leituras de recuperação de artefatos na política normal, preserva blocos não textuais e nunca remove o bloco da chamada. Resultados marcados inúteis e sem erro podem sair mesmo dentro da janela recente. Blocos grandes de código/XML em outras mensagens também são candidatos; logo, não existe proteção absoluta de toda mensagem do usuário nesse método. [O7]

### Prompts

O system prompt do sumarizador trata histórico e resumos anteriores como dados não confiáveis; manda ignorar mudanças de papel/instruções embutidas e produzir somente o resumo. O prompt inicial solicita esta estrutura: [O6]

```text
Goal
Constraints & Preferences
Progress: Done / In Progress / Blocked
Key Decisions
Next Steps
Critical Context
Additional Notes
```

Exige preservar perguntas ainda sem resposta, caminhos, símbolos, erros, resultados relevantes e estado do repositório. Permite omitir seções inaplicáveis. O prompt de atualização carrega o resumo anterior, move itens concluídos e mantém decisões, permitindo retirar conteúdo irrelevante. Já o `handoff` usa `Done / In Progress / Pending`, solicita estado técnico exato e não permite transformar “escrever este handoff” numa nova tarefa. [O6]

Se o histórico ultrapassa a janela do próprio sumarizador, a implementação de `generateSummary` faz um fold em múltiplas janelas: cada chamada atualiza o resumo recebido da anterior. O cap de saída desse caminho é `min(floor(0,8 × reserveTokens), 16384)`. Não confundir esse caminho com o orçamento da compactação nativa. [O2]

### Depois do resumo

O commit de compactação registra resumo, fronteira preservada e metadados; recompõe o contexto do agente; reinicializa referências derivadas; manda reler o plano aprovado do disco no próximo turno; sincroniza as fases do todo; reinicia o estado de replay do provider quando necessário. Há verificação de progresso para evitar continuar compactando sem liberar espaço útil. [O3]

**O que aproveitar:** preparar antecipadamente com snapshot validado; conservar trabalho novo fora da região; recompor plano e tarefas a partir de suas fontes; medir ganho antes de auto-continuar. Minha avaliação: `snapcompact` merece experimento separado, pois exige avaliar legibilidade visual, fidelidade e custo por modelo.

## Hermes: proteger intenção, recuperação e limites operacionais

### Limiares e timings efetivos

A configuração diz `threshold: 0.50`, mas `_effective_threshold_percent` eleva o percentual a pelo menos 0.75 quando `W < 512000`. A base do cálculo é `W − max_tokens`, quando há reserva de saída. Existe um piso nominal de 64K no cálculo e um ajuste para que esse piso não empurre janelas pequenas além de 85% do orçamento. Um `threshold_tokens` explícito pode reduzir o limiar resultante. Há overrides por substring de modelo e ajuste específico de 85% para certas rotas OAuth Codex. Não é correto rotular todo Hermes como “compacta em 50%”. [H1, H2]

Exemplo simplificado usando o cálculo geral: `W=200000`, saída reservada de 16000 e default efetivo de 75% resultam em `138000` tokens de disparo. Overrides de rota/cap podem mudar isso. [H2]

Os checks cobrem preparação do turno, preflight antes da API, pressão após ferramentas e recuperação de erros classificados como overflow/payload excessivo. `max_attempts` é 3 por default, com validação/cap. A compactação que não chegou a fazer uma chamada de execução não deve gastar o allowance dessa chamada: o gate devolve esse orçamento e reavalia o request. [H1, H3]

| Configuração de tempo           | Default | Significado real                                                                              |
| ------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `context_timeout_seconds`       | 120 s   | Falta de progresso durante a compactação no agente; não duração esperada                      |
| `context_total_ceiling_seconds` | 600 s   | Limite total pré-commit, mesmo com tokens chegando; commit de banco iniciado não é abandonado |
| `idle_compact_after_seconds`    | 0       | Desligado; quando ativado, compacta na retomada após o intervalo e com contexto acima do piso |
| `micro_compact`                 | false   | Compactação incremental entre turnos, opt-in                                                  |
| `micro_compact_every_n_turns`   | 1       | Cadência se a microcompactação for ligada                                                     |
| `hygiene_timeout_seconds`       | 30 s    | Orçamento sem progresso da higiene antes do agente, nos gateways                              |
| `hygiene_max_turn_hold_seconds` | 10 s    | Quanto uma mensagem que chega espera por essa higiene antes de poder seguir                   |

O motivo documentado para deixar microcompactação desligada é o cache: reescrever o prefixo a cada turno destrói repetidamente seu reaproveitamento. Higiene de gateway também tem limite de 5.000 mensagens e teto total de 600 s; são caminhos diferentes do disparo comum por tokens. [H1, H3, H4]

### O que fica e o que sai

Fluxo geral: podar saídas antigas e ecos vazios → escolher cabeça/meio/cauda → resumir o meio incorporando o resumo anterior → remontar e limpar pares órfãos. [H2]

- System prompt fica protegido. As três mensagens iniciais não-system são protegidas inicialmente, mas essa proteção decai a zero após a primeira compactação; isso evita eternizar um objetivo antigo. [H1, H2]
- No modo `lean`, a cauda tem orçamento de 2,5% da janela com piso 10K e teto 25K. O corte pode exceder o orçamento e protege grupos de ferramentas/âncoras recentes; não é um hard cap final. [H2]
- `protect_last_n: 20` é usado pela poda, porém o piso de mensagens no seletor da compactação principal é limitado por `_MAX_TAIL_MESSAGE_FLOOR = 8` e disponibilidade de material compactável. “Sempre mantém 20 mensagens intactas” seria falso. [H2]
- Há regras para conservar o último input humano real e a resposta recente, sem deixar snapshots sintéticos de todo consumirem a âncora humana. `min_tail_user_messages` permite ampliar a proteção. [H1, H2]
- O modo lean pode substituir resultados antigos mesmo dentro da cauda por versões menores; não promete fidelidade integral de todas as tools recentes. [H2]
- O input do sumarizador também é limitado: corpos longos usam cabeça/cauda, argumentos grandes são truncados, e a entrada agregada é limitada a 160.000 caracteres. No lean, entradas maiores são amostradas em oito fatias distribuídas; marcadores indicam recuperação por `session_search`. Não há garantia de que todo o transcript chegou ao modelo. [H2]

O comentário da configuração ainda descreve digests/chunks com chamadas extras, mas o código atual de `_generate_summary` e `_call_summary_llm` faz uma chamada principal limitada, com session log no mesmo prompt; falhas/fallbacks podem adicionar chamadas. Nesta pesquisa, prevalece a implementação. [H1, H2]

### Prompt e estrutura

O prompt gerado declara que os turnos são dados, pede apenas resumo estruturado e remove segredos tanto na entrada quanto na saída. A linguagem acompanha o usuário. Distingue sessões com mensagens humanas de sessões apenas de agentes/cron, evitando inventar uma solicitação humana. [H2]

```text
Historical Task Snapshot
Goal
Constraints & Preferences
Completed Actions
Active State
Blocked
Key Decisions
Errors & Fixes
Resolved Questions
Relevant Files
Critical Context
Session Log (lean)
Pruned Skills (quando necessário)
```

A seção histórica exige identificar precisamente a solicitação humana ainda não atendida, incluindo perguntas e decisões; instruções de cancelamento/reversão devem substituir a tarefa cancelada. `Completed Actions` exige ação, alvo, resultado e tool. `Active State` inclui cwd, branch, arquivos, testes e processos. Correções do usuário e restrições de segurança recebem preservação literal. O título efetivo é `Historical Task Snapshot`; uma frase do prompt de atualização ainda menciona o antigo `Active Task`. [H2]

Um `focus_topic`, explícito ou derivado dos turnos, direciona cerca de 60–70% do orçamento textual ao assunto relevante. No modo lean, o session log acrescenta até aproximadamente 4.000 tokens solicitados; índices determinísticos extraem identificadores e preservam referências de recuperação. Isso reduz a dependência da memória semântica do sumarizador, mas também aumenta o contexto final. [H2, H6]

O orçamento textual principal escala com 20% da região, piso de 2K e teto derivado de `min(5% da janela, 10000)`. É uma meta no prompt: `_call_summary_llm` deliberadamente não envia `max_tokens`, para evitar truncamentos por raciocínio oculto. A rota usa `call_llm(task="compression")`, com configuração auxiliar e fallback. Resumos vazios e `finish_reason=length` são falhas, não checkpoints válidos. [H2]

### Persistência, recuperação e falhas

O default `in_place: true` conserva a identidade da sessão, arquiva as linhas antigas e instala o contexto compactado. Há lease, watermark e validação de posse para não apagar mensagens admitidas depois do snapshot. Um worker tardio não deve sobrescrever o resultado de uma tentativa mais nova. [H1, H4]

O snapshot atual do todo é reinjetado a partir do store, retirando cópias antigas do contexto. O texto do resumo não vira autoridade sobre a lista de tarefas. Há checkpoint de memória antes da compactação; exigir sua confirmação é opt-in (`checkpoint_required: false` por default). [H4]

Após falha, pode existir fallback determinístico com perda de detalhe; `abort_on_summary_failure` é false por default. Logo, não é correto prometer que toda falha mantém exatamente o mesmo contexto. Há cooldown persistido, proteção contra tentativas ineficazes repetidas e tratamento explícito de resumo truncado. [H1, H2, H4]

**O que aproveitar:** proteger o último pedido real; preservar correções e autorizações literalmente; restaurar o todo pelo banco; manter o histórico consultável; registrar timings por fase e progresso; impedir commits tardios. Minha avaliação: a quantidade de caminhos de fallback também aumenta bastante o custo de manutenção.

## DeepSeek Harness: uma medição e uma transação

### Disparo e orçamento

O listener atual é `agent/pre-step`, serial, antes da derivação do próximo request. O default compara a pressão medida com 80% da janela da rota efetiva. A documentação tem uma passagem que ainda diz “after a successful step”; código e seção de implementação mostram o ponto de decisão antes do próximo step. [D1, D2]

`tokenMeter` combina envelope, surface atual e uso real reaproveitável. Só reutiliza a âncora do provider quando o envelope canônico é compatível; em outros casos recorre à heurística e ao preço de imagens declarado pelo adapter. A mesma medição serve para disparo, seleção da cauda e validação de redução. Seu total é pressão de request/response, não apenas tamanho das mensagens. [D5]

Defaults: `retainRatio=0.16`, `maxTokens=8192`, `compactionRetries=1` extra, `maxOverflowRetries=1`. Overrides usam o par exato provider/model. Em overflow confirmado, ignora o limiar e a cauda normal para tentar a maior redução inicial que mantenha pares balanceados. Só autoriza retry depois de uma substituição durável avançar a geração da surface. [D1, D2]

Não encontrei scheduler especulativo, microcompactação a cada N turnos ou timer idle no backend inspecionado. Há `/compact` manual em sessão ociosa. Cancelamento é propagado; os arquivos desse backend não definem um timeout próprio em segundos, o que não significa que adapters/transporte não tenham limites. [D2, D3]

### Poda antes da chamada cara

Com o plugin opcional de poda, resultados acima de 8.192 caracteres Unicode viram cabeça de 4.096 + marcador + cauda de 1.024. Mantém conteúdo não textual, metadados e a chamada; os originais continuam no log. A poda só acontece depois de um disparo qualificado. Se a nova pressão ficar abaixo do limite, dispensa o sumarizador. [D4]

Se ainda precisa resumir, seleciona a região antiga sem dividir pares tool-call/result e guarda a cauda recente em unidades inteiras. Protege o system prompt no nó inicial. Uma atualização de system prompt inserida mais tarde no histórico pode entrar na região antiga; a projeção do system atual é uma responsabilidade separada. Uma unidade indivisível gigante ou envelope de system/tools excessivo pode impedir recuperação. [D1–D3]

### Prompt e cache

O sumarizador recebe o system, schemas de tools e prefixo da conversa reproduzidos, seguidos de uma última mensagem de usuário que manda gerar somente o checkpoint. O objetivo é reutilizar o prefixo em cache quando rota e prefixo coincidem. Só o texto retornado vira resumo; reasoning/tool calls não são executados como um novo loop. Saída visual, vazia ou truncada é rejeitada. [D3]

Estrutura obrigatória, inclusive seções vazias com `(none)`: [D3]

```text
Primary Request and Intent
Key Technical Concepts
Files and Code
Errors and Fixes
Pending Jobs
Current Work
Next Step
Critical Context
```

O prompt pede inglês conciso, comandos e identificadores exatos, correções humanas preservadas e consolidação do checkpoint anterior, retirando fatos obsoletos. A mensagem de retomada envolve o resumo com `<compacted-summary>` e orienta continuar sem anunciá-lo. O texto integral está em `COMPACTION_INSTRUCTION`, no link D3. Não há separação por um novo system prompt de sumarizador como no caminho textual do Oh My Pi; preservar cache é uma escolha explícita desse desenho. [D3]

### Aplicação transacional

Registra início, prepara resumo, revalida a região e a posse, exige que o resumo com framing seja menor que a região, e então grava resumo/substituição e encerramento. Na compactação automática exige estabilidade da surface inteira; no manual permite append fora da região selecionada. A origem fica citada nos eventos, preservando replay e inspeção. Se a poda já persistiu e o resumo posterior falha, a redução anterior permanece válida. [D2–D4]

**O que aproveitar:** medidor único, poda determinística qualificada por pressão, rejeição de resumos sem redução, vínculo ao snapshot e retry condicionado a progresso durável. O cache pode reduzir custo, mas precisa de avaliação por provider; nenhuma economia percentual foi medida aqui.

## Comparação com o Redcode 0.25.1

O Redcode tem dois caminhos com políticas diferentes; uma alteração só em um deles deixa comportamento divergente. [R1–R4]

| Aspecto  | V2 Core                                                                                                                        | Runtime legado                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Disparo  | Estimativa do request acima de `context − max(output, buffer)`, buffer default 20K, antes da chamada; recuperação por overflow | Uso reportado contra orçamento utilizável calculado em `overflow.ts`, mais recuperação do loop           |
| Retenção | 8K tokens default de texto serializado recente                                                                                 | Orçamento proporcional a 25% do utilizável, entre 2K e 15K; ajustável e delimitado por turnos/pares      |
| Tools    | Serialização reduz cada resultado textual e shell output a 2.000 caracteres                                                    | Poda separada, protege `skill`, preserva 40K de resultados recentes e só aplica se recuperar mais de 20K |
| Resumo   | Mesmo modelo, sem tools, até 4096 tokens; salva `summary` e `recent` em evento                                                 | Agente de compactação, hooks, template compartilhado, timeout auxiliar e retenção por fronteira          |

O V2 já consolida resumo anterior e prioriza correções mais recentes. O template cobre objetivo, detalhes, estado, próximos passos e arquivos. A persistência de tarefas e a fonte `progress-context` já reintroduzem o estado corrente; no legado, `SessionTodo.context` também entra na montagem do prompt. Não precisamos reinventar isso. [R1, R4]

Lacunas observadas no caminho V2: não há especulação nesse módulo; não há validação explícita de redução do resumo antes de publicar `Compaction.Ended`; a saída recente preservada já passou pelo truncamento de tools; a chamada do sumarizador usa uma mensagem de usuário, sem um system dedicado de isolamento. São propriedades do código inspecionado, não comprovação de um incidente específico do usuário. [R1]

## Próximos passos recomendados

Estas são propostas, não mudanças implementadas. A prioridade é confiabilidade da retomada, depois latência e custo.

1. **Definir o contrato comum aos dois runtimes.** Separar histórico original, resumo, mensagens recentes e estado autoritativo de execução. Proteger última solicitação real, decisões/autorizações ainda válidas, revisão do plano e IDs/revisões de tarefas. Referências a arquivos e evidências precisam apontar à origem recuperável.
2. **Validar cada compactação antes de aplicar.** Snapshot/revisão continuam válidos; nenhuma mensagem nova foi perdida; resumo não está vazio/truncado; pares de ferramentas permanecem válidos; houve redução útil. Falha deve ter resultado explícito, sem loop nem falso estado de conclusão.
3. **Adotar uma medição coerente.** Usar o mesmo orçamento para UI, disparo, retenção e ganho. Incluir system, tools, imagens e reserva de saída. Expor aproximação versus uso real, em vez de transformar um número estimado em certeza.
4. **Adicionar poda com recuperação.** Começar por resultados grandes/redundantes, guardando original e origem. Manter cabeça e cauda pode preservar conclusões de testes que o truncamento apenas do início perde. Aplicar só com economia mínima que justifique quebrar cache.
5. **Adicionar preparação assíncrona depois das garantias anteriores.** Snapshot imutável, resumo preparado sem alterar o transcript, aplicação na fronteira segura, cauda posterior preservada, invalidação de resultado obsoleto e no máximo uma preparação ativa por sessão.
6. **Medir com casos reais.** Latência total e tempo bloqueando o usuário, entrada/saída/cache, tokens antes/depois, chamadas auxiliares, abortos e retries. Comparar política atual, poda, e poda + antecipação. Não adotar 50%, 75% ou 80% como número universal sem avaliação.

### Cenários de avaliação propostos

- Correção recente contradiz o resumo anterior; a correção deve vencer.
- Novo pedido chega durante a sumarização; deve sobreviver uma única vez e com seu papel original.
- Usuário cancela/restringe parte do escopo; a tarefa não pode reaparecer por resumo antigo.
- Plano aprovado e tarefas parcialmente concluídas sobrevivem à compactação e ao restart sem repetir trabalho.
- Resultado de teste tem o erro importante no meio ou no fim; recuperação da evidência continua possível.
- Uma tool retorna mais que o orçamento da cauda; não produzir par órfão nem compactação infinita.
- Sumarizador responde vazio, atinge limite, falha ou termina depois de cancelado; não aplicar resultado inválido.
- Três compactações consecutivas: requisitos, autorizações, caminhos, IDs e bloqueios ainda válidos permanecem corretos.
- Mudança para modelo de janela menor: orçamento se recalcula antes da próxima execução.

## Perguntas em aberto

- Qual é o p95 de espera por compactação nas sessões reais do Redcode? Não foi medido.
- Quanto do contexto é tool output recuperável, quanto é pedido/decisão humana e quanto é schema/system? Precisamos de telemetria agregada para escolher a primeira poda.
- Qual orçamento de resumo preserva melhor as tarefas em português e sessões com várias frentes? Não há benchmark nesta pesquisa.
- Compactação nativa e visual mantêm fidelidade suficiente nas rotas usadas pelo Redcode? O código público não expõe o prompt interno do serviço remoto; demanda experimento separado.

## Hotlinks e notas por fonte

As fontes abaixo são arquivos oficiais nos commits auditados; cada grupo acima indica seus IDs. Prompts completos estão nos links O6, H2 e D3.

- **O1:** [packages/coding-agent/src/config/settings-schema.ts#L2570-L2785](https://github.com/can1357/oh-my-pi/blob/2e6b5b79a0c5b190797aace99f41fab6ae42e6c5/packages/coding-agent/src/config/settings-schema.ts#L2570-L2785).
- **O2:** [packages/agent/src/compaction/compaction.ts](https://github.com/can1357/oh-my-pi/blob/2e6b5b79a0c5b190797aace99f41fab6ae42e6c5/packages/agent/src/compaction/compaction.ts).
- **O3:** [packages/coding-agent/src/session/session-maintenance.ts](https://github.com/can1357/oh-my-pi/blob/2e6b5b79a0c5b190797aace99f41fab6ae42e6c5/packages/coding-agent/src/session/session-maintenance.ts).
- **O4:** [packages/coding-agent/src/session/speculation-lead.ts](https://github.com/can1357/oh-my-pi/blob/2e6b5b79a0c5b190797aace99f41fab6ae42e6c5/packages/coding-agent/src/session/speculation-lead.ts).
- **O5:** [packages/coding-agent/src/session/compaction-methods.ts](https://github.com/can1357/oh-my-pi/blob/2e6b5b79a0c5b190797aace99f41fab6ae42e6c5/packages/coding-agent/src/session/compaction-methods.ts).
- **O6:** [packages/agent/src/compaction/prompts/summarization-system.md](https://github.com/can1357/oh-my-pi/blob/2e6b5b79a0c5b190797aace99f41fab6ae42e6c5/packages/agent/src/compaction/prompts/summarization-system.md); [packages/agent/src/compaction/prompts/compaction-summary.md](https://github.com/can1357/oh-my-pi/blob/2e6b5b79a0c5b190797aace99f41fab6ae42e6c5/packages/agent/src/compaction/prompts/compaction-summary.md); [packages/agent/src/compaction/prompts/compaction-update-summary.md](https://github.com/can1357/oh-my-pi/blob/2e6b5b79a0c5b190797aace99f41fab6ae42e6c5/packages/agent/src/compaction/prompts/compaction-update-summary.md); [packages/agent/src/compaction/prompts/compaction-turn-prefix.md](https://github.com/can1357/oh-my-pi/blob/2e6b5b79a0c5b190797aace99f41fab6ae42e6c5/packages/agent/src/compaction/prompts/compaction-turn-prefix.md); [packages/agent/src/compaction/prompts/handoff-document.md](https://github.com/can1357/oh-my-pi/blob/2e6b5b79a0c5b190797aace99f41fab6ae42e6c5/packages/agent/src/compaction/prompts/handoff-document.md).
- **O7:** [packages/agent/src/compaction/shake.ts](https://github.com/can1357/oh-my-pi/blob/2e6b5b79a0c5b190797aace99f41fab6ae42e6c5/packages/agent/src/compaction/shake.ts).
- **O8:** [packages/coding-agent/src/modes/controllers/event-controller.ts#L2304-L2333](https://github.com/can1357/oh-my-pi/blob/2e6b5b79a0c5b190797aace99f41fab6ae42e6c5/packages/coding-agent/src/modes/controllers/event-controller.ts#L2304-L2333).
- **H1:** [hermes_cli/config_defaults.py#L524-L638](https://github.com/NousResearch/hermes-agent/blob/425b00174d0ad7f311819695e86684376b76b008/hermes_cli/config_defaults.py#L524-L638).
- **H2:** [agent/context_compressor.py](https://github.com/NousResearch/hermes-agent/blob/425b00174d0ad7f311819695e86684376b76b008/agent/context_compressor.py).
- **H3:** [agent/turn_context_compaction.py](https://github.com/NousResearch/hermes-agent/blob/425b00174d0ad7f311819695e86684376b76b008/agent/turn_context_compaction.py); [agent/turn_preflight.py](https://github.com/NousResearch/hermes-agent/blob/425b00174d0ad7f311819695e86684376b76b008/agent/turn_preflight.py); [agent/turn_overflow.py](https://github.com/NousResearch/hermes-agent/blob/425b00174d0ad7f311819695e86684376b76b008/agent/turn_overflow.py).
- **H4:** [agent/conversation_compression.py](https://github.com/NousResearch/hermes-agent/blob/425b00174d0ad7f311819695e86684376b76b008/agent/conversation_compression.py).
- **H5:** [agent/context_engine.py](https://github.com/NousResearch/hermes-agent/blob/425b00174d0ad7f311819695e86684376b76b008/agent/context_engine.py).
- **H6:** [agent/context_compressor_summary.py](https://github.com/NousResearch/hermes-agent/blob/425b00174d0ad7f311819695e86684376b76b008/agent/context_compressor_summary.py).
- **D1:** [packages/compaction/compaction-basic/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/packages/compaction/compaction-basic/README.md); [packages/compaction/compaction-basic/src/config.ts](https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/packages/compaction/compaction-basic/src/config.ts).
- **D2:** [packages/compaction/compaction-basic/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/packages/compaction/compaction-basic/src/index.ts); [packages/compaction/compaction-basic/src/region.ts](https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/packages/compaction/compaction-basic/src/region.ts).
- **D3:** [packages/compaction/compaction-basic/src/summarizer.ts](https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/packages/compaction/compaction-basic/src/summarizer.ts).
- **D4:** [packages/compaction/compaction-tool-result-pruner/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/packages/compaction/compaction-tool-result-pruner/README.md); [packages/compaction/compaction-tool-result-pruner/src/config.ts](https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/packages/compaction/compaction-tool-result-pruner/src/config.ts); [packages/compaction/compaction-tool-result-pruner/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/packages/compaction/compaction-tool-result-pruner/src/index.ts).
- **D5:** [packages/llm/token-meter/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/aa8262ec091698bae9a6b04773a6b5b06ad4aef2/packages/llm/token-meter/README.md).
- **R1:** [packages/core/src/session/compaction.ts](https://github.com/reddb-io/redcode/blob/eaab9f69396d20b63f616729c562aa9a6aa9618a/packages/core/src/session/compaction.ts); [packages/core/src/config/compaction.ts](https://github.com/reddb-io/redcode/blob/eaab9f69396d20b63f616729c562aa9a6aa9618a/packages/core/src/config/compaction.ts).
- **R2:** [packages/redcode/src/session/compaction.ts](https://github.com/reddb-io/redcode/blob/eaab9f69396d20b63f616729c562aa9a6aa9618a/packages/redcode/src/session/compaction.ts); [packages/redcode/src/session/overflow.ts](https://github.com/reddb-io/redcode/blob/eaab9f69396d20b63f616729c562aa9a6aa9618a/packages/redcode/src/session/overflow.ts).
- **R3:** [packages/core/src/session/runner/llm.ts](https://github.com/reddb-io/redcode/blob/eaab9f69396d20b63f616729c562aa9a6aa9618a/packages/core/src/session/runner/llm.ts); [packages/redcode/src/session/prompt.ts](https://github.com/reddb-io/redcode/blob/eaab9f69396d20b63f616729c562aa9a6aa9618a/packages/redcode/src/session/prompt.ts).
- **R4:** [packages/core/src/session/progress-context.ts](https://github.com/reddb-io/redcode/blob/eaab9f69396d20b63f616729c562aa9a6aa9618a/packages/core/src/session/progress-context.ts); [packages/core/src/session/todo.ts](https://github.com/reddb-io/redcode/blob/eaab9f69396d20b63f616729c562aa9a6aa9618a/packages/core/src/session/todo.ts); [packages/redcode/src/agent/prompt/compaction.txt](https://github.com/reddb-io/redcode/blob/eaab9f69396d20b63f616729c562aa9a6aa9618a/packages/redcode/src/agent/prompt/compaction.txt).
