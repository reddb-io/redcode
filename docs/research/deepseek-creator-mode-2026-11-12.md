# Creator Mode do DeepSeek Harness: estudo e aplicação ao Redcode

Data da pesquisa: 12 de novembro de 2026. Este documento distingue comportamento observado no código público, demonstrações publicadas e propostas para o Redcode. Não registra uma instalação ou teste funcional do DeepSeek Harness nesta máquina.

Implementação iniciada neste trabalho: quinto agente primário `creator`, instruções próprias,
skill embarcada `redcode-creator` e identidade estável nos seletores Desktop/Web/TUI. O modo usa
as permissões de código configuradas e a infraestrutura existente de Design para previews.
Um plugin local sem dependências foi carregado, executado e descarregado em teste do registry.
Isso constitui a primeira etapa de autoria, não paridade com instalação dinâmica de UI/Slots,
nem uma implementação dos sete aplicativos da demonstração. As fases posteriores continuam
identificadas como propostas abaixo.

Snapshot do upstream: [`e8f7b93a344964de3dca1ace9e72b6e4d6de87cb`](https://github.com/deepseek-ai/deepseek-harness/tree/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb), último commit de `master` consultado, datado de 11 de novembro. O repositório usa licença MIT e declara que está em developer preview. As referências de código abaixo apontam para esse snapshot para tornar a comparação reproduzível.

## 1. O produto que devemos reproduzir

O Creator Mode pertence ao **DeepSeek Harness**, o aplicativo de agentes da DeepSeek construído sobre Cordis. Não é um novo modelo de geração 3D. É um modo em que o agente desenvolve extensões para o próprio aplicativo: interface, ferramentas, skills e composições de agentes. A [página oficial](https://www.deepseek.com/en/harness/) apresenta essa capacidade de personalização e uma demonstração de construção de um temporizador flutuante.

Isso muda o escopo do Redcode. Um modo que apenas gera uma página Three.js reproduz um caso de uso visual, mas não reproduz a capacidade central de criar extensões utilizáveis e persistentes. O desenho completo envolve cinco partes:

1. Um agente especializado no contrato de extensibilidade do aplicativo.
2. Descoberta das APIs e superfícies realmente disponíveis na instalação.
3. Skills e templates de autoria que não precisam ocupar todo o system prompt.
4. Instalação, ativação, diagnóstico, atualização e remoção de extensões.
5. Verificação da funcionalidade instalada e entrega de arquivos quando a tarefa produz um artefato.

Uma extensão 3D é um produto desse mecanismo. Um gerador de assets 3D remoto, um renderizador Blender e um editor de vídeos são integrações ou aplicações diferentes, com dependências e requisitos próprios.

## 2. Evidências e limites da pesquisa

| Nível de evidência                    | O que foi consultado                                                                | O que permite afirmar                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Código oficial versionado             | Preset `cordis`, skill `dsh-doc`, Plugin Manager, ferramentas de inspeção e runners | Composição real, contratos, persistência e limites declarados                           |
| Material de demonstração oficial      | Coleção bilíngue dos sete prompts e página do produto                               | Intenções e recursos mostrados; não uma taxa de sucesso ou garantia de reprodução       |
| Documentação de projetos de terceiros | Tripo para DSH, Blender para DSH e editor Three.js via MCP Apps                     | Abordagens complementares do ecossistema, sem atribuí-las ao produto nativo da DeepSeek |
| Código local do Redcode               | Agentes, Design, GUI Extensions, artefatos e Delivery                               | Infraestrutura reaproveitável e lacunas concretas                                       |
| Propostas deste documento             | Contratos, fases e critérios de aceite abaixo                                       | Decisões sugeridas para nós; não APIs já existentes                                     |

A pesquisa não localizou, no núcleo oficial consultado, implementações distribuídas dos sete plugins da demonstração. Os prompts públicos permitem tentar recriá-los. A arquitetura de autoria e instalação, por outro lado, está aberta. Não foram obtidos prompts privados, pesos de modelo, telemetria de produção ou arquivos internos da DeepSeek.

O material recente de divulgação não estabelece a data em que o mecanismo entrou pela primeira vez no produto. As notas de implementação do próprio repositório já discutiam Creator em agosto e setembro. Portanto, convém dizer **demonstração/divulgação recente**, sem tratar todo o mecanismo como lançado pela primeira vez em novembro.

## 3. Os sete casos oficiais, sem confundir pedido com implementação pronta

A [coleção oficial de prompts em inglês](https://cdn.deepseek.com/harness/dsh-creator-mode-prompt-collection-en.html) e a [versão chinesa](https://cdn.deepseek.com/harness/dsh-creator-mode-prompt-collection-zh.html) publicam as instruções completas. A DeepSeek informa que alguns resultados exigiram várias iterações.

| Demonstração | Pedido essencial                                                                   | Superfície                |
| ------------ | ---------------------------------------------------------------------------------- | ------------------------- |
| Galeria 3D   | Monumentos em modelos tridimensionais                                              | Entrada na barra esquerda |
| Transformer  | Explicação computacional interativa em 3D, respeitando controles nativos da janela | Painel próprio            |
| Aparência    | Cinco estilos selecionáveis, incluindo pixel art                                   | Aplicativo inteiro        |
| Pôster       | Texto e cores editáveis sobre shader                                               | Acesso pela conversa      |
| Vídeo        | Vários uploads, edição, exportação, preview e timeline; comandos pela conversa     | Workbench                 |
| Artigos      | Preservar apresentação; seleção com destaque, anotação e pergunta                  | Barra direita             |
| Estatísticas | Dados reais de conversas, tokens, custo, orçamento e CPU                           | Dashboard                 |

Essa lista não especifica um serviço nativo de text-to-3D, formatos de intercâmbio ou uma implementação universal de edição de vídeo. Também não estabelece qualidade geométrica, fidelidade de exportação, disponibilidade offline ou desempenho.

### O que aproveitar dos prompts

Os pedidos especificam **onde** a funcionalidade aparece, **como** se usa e **como** conversa com o agente. Esse padrão é mais útil que um comando genérico para “criar uma coisa bonita”. Para nós, um pedido completo pode descrever:

- Entrada e contexto: painel da sessão, dashboard global, arquivo ou ferramenta.
- Dados de origem: arquivos locais, projeções da sessão, resultados de ferramentas ou serviço selecionado.
- Operações humanas e do agente: os dois devem trabalhar sobre o mesmo estado e revisão.
- Saída: extensão instalada, arquivo exportado ou protótipo revisável.
- Comportamento quando uma dependência está ausente e o que foi realmente verificado.

Esses são princípios de especificação propostos para o Redcode, não uma transcrição adicional da coleção.

## 4. Como o modo é implementado

### 4.1 Preset declarativo

O preset é uma declaração `@deepseek-ai/dsh-agent-preset` com identificador **`cordis`**. O nome apresentado ao usuário é Creator. O [arquivo do preset](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/bundle/web-app/presets/cordis.patch.yml) combina plugins de capacidades:

| Grupo                | Composição observada                                                  | Implicação                                                                             |
| -------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Identidade           | Persona cujo prefixo diz para ajudar a personalizar o próprio Harness | A especialização começa pelo objetivo, não por outro modelo                            |
| Contexto             | Instruções de agentes, horário e compaction/pruning                   | Pode operar em projetos extensos sem incorporar documentação inteira a cada requisição |
| Trabalho local       | Arquivos, pesquisa, Bash ou PowerShell conforme plataforma e jobs     | Autor e verifica código normal no workspace                                            |
| Planejamento         | Grupo isolado com modo de planejamento                                | Planejamento é uma política separada da autoria                                        |
| Delegação            | Subagentes, fork e workflow                                           | Possibilidade de separar implementação, pesquisa e revisão                             |
| Pesquisa e interação | Web, perguntas e lista de tarefas                                     | Resolve lacunas e acompanha trabalho                                                   |
| Extensibilidade      | `tool-cordis`, skill filesystem e tool-skill                          | Descobre APIs e carrega conhecimento sob demanda                                       |
| Gestão e entrega     | Plugin Manager, Plugin Market e `present`                             | Instala o resultado ou apresenta arquivos                                              |

O arquivo é a fonte do catálogo exato; essa tabela agrupa capacidades e não pretende enumerar todos os parâmetros internos.

O [README do seletor de presets](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/client/ui-agent-preset/README.md) mostra que selecionar Creator inicia uma tarefa com esse preset. Não há exigência arquitetural de uma família de modelo específica para o conceito de Creator.

### 4.2 System prompt e conhecimento especializado

O [snapshot público do system prompt](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/snapshots/web/creator-persona/system-prompt.expected.md) contém a persona e orientações de ferramentas, background jobs, fontes e entregáveis. É uma evidência de teste de uma composição concreta; não se deve presumir que toda instalação produza exatamente aquele texto.

A especialização de desenvolvimento fica sobretudo na skill **`dsh-doc`**, e não em centenas de linhas injetadas permanentemente no prefixo. A skill antiga mencionada na demonstração, **`cordis-plugin-development`**, não é o nome da skill atual no snapshot consultado. A [nota sobre divulgação progressiva](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/.agents/notes/archived/architecture/2026-09-21-creator-skills-progressive-disclosure.md) documenta a retirada de receitas de um texto inicial grande e sua separação em referências e templates.

Não devemos copiar instruções específicas de Cordis para nosso prompt. Elas citam ferramentas, diretórios e serviços que não existem no Redcode. O equivalente deve ensinar nosso SDK e refletir as permissões efetivamente aplicadas pelo servidor.

### 4.3 Conteúdo da skill atual

A [skill `dsh-doc`](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/preset/agent-preset/skills/dsh-doc/SKILL.md) é um índice de procedimentos. Ela separa conhecer a aplicação de ter autorização para modificá-la. As referências cobrem:

| Área                        | Referências públicas                                        |
| --------------------------- | ----------------------------------------------------------- |
| Descobrir instalação e APIs | `locate-docs.md`, documentação e fontes da versão instalada |
| Criar e instalar bundles    | `plugin-development.md`, `host-plugin.md`                   |
| Interface                   | `ui-plugin.md`, `practices.md`, `user-actions.md`           |
| Configuração e autenticação | `configuration.md`, `mcp-bundle.md`                         |
| Presets                     | `compositions.md`, `composition-reference.md`               |
| Ferramentas e skills        | `tool-design.md`, lista de packages                         |
| Apresentação e validação    | `artwork.md`, `plugin-details.md`, `verification.md`        |
| Evolução de versão          | `upgrading.md`                                              |

Há templates para uma decoração de interface e para uma conexão MCP. O índice orienta a ler a receita necessária em vez de carregar todo o conjunto.

Para o Redcode, isso sugere uma skill embarcada de desenvolvimento de extensões, referências separadas para artefatos interativos/3D, contribuições GUI, plugins do servidor e conectores externos. Uma skill de operação não deve ser confundida com uma credencial nem com um grant de permissão.

## 5. Descoberta de APIs: a parte menos visível e mais importante

O [toolset `tool-cordis`](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/extensions/tool-cordis/README.md) oferece duas operações de leitura: listar providers de inspeção e consultar declarações específicas. Não executa métodos de negócio. O agente consulta o contrato real antes de escrever código contra ele.

| Inspeção          | Utilidade para autoria                                          |
| ----------------- | --------------------------------------------------------------- |
| Services e Events | Métodos, tipos e modos dos eventos existentes                   |
| Config            | Identificadores e schemas das configurações da composição ativa |
| Tools             | Ferramentas efetivamente visíveis ao agente                     |
| Client Slots      | Pontos de encaixe, props, opções e hierarquia de interface      |
| Theme             | Tokens que a interface instalada realmente fornece              |

Isso reduz APIs inventadas pelo modelo, dependência de memória de versões antigas e leituras excessivas do repositório. Há uma limitação concreta: consultas Client dependem de uma página conectada. O [runner Host](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/extensions/cordis-host-runner/README.md) documenta prazo limitado, resposta válida e necessidade de tentar novamente após reconexão; uma consulta não é uma assinatura infinita.

### Equivalente proposto para o Redcode

Um catálogo consultável deve descrever o SDK da versão instalada e as contribuições que o cliente conectado oferece. Os resultados devem ser pequenos, filtráveis e tipados. Informar “nenhum cliente GUI conectado” é melhor que listar um painel como utilizável numa sessão TUI headless.

O catálogo precisa separar:

- Contratos estáticos do SDK que podem ser lidos mesmo sem GUI.
- Disponibilidade do cliente atual: desktop, web e presença de browser integrado.
- Capacidades da máquina executora: renderização, GPU, Blender ou outro conversor.
- Permissões da sessão e contas explicitamente selecionadas.

Uma lista de ferramentas disponíveis não equivale a permissão para chamá-las. Nenhum resultado de inspeção deve carregar segredos de configuração.

## 6. Formato e ciclo de vida dos bundles

### 6.1 Pacote persistente

A [receita de Host plugins](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/preset/agent-preset/skills/dsh-doc/references/host-plugin.md) define um pacote com `package.json`, identificação própria e declaração `dsh.bundle.patch` apontando para um patch YAML. O patch insere as linhas de plugins. Um Host plugin pode exportar `apply(ctx, config)` ou uma classe de serviço, e declarar serviços injetados e schema de configuração.

A [receita de desenvolvimento persistente](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/preset/agent-preset/skills/dsh-doc/references/plugin-development.md) manda produzir o pacote no workspace e instalá-lo por Plugin Manager. O efeito é sobre o perfil, atravessa sessões e sobrevive ao reinício. O workflow não depende de o agente editar manualmente diretórios internos do perfil.

### 6.2 Parte Client

A [receita de UI](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/preset/agent-preset/skills/dsh-doc/references/ui-plugin.md) acrescenta `dsh.client`, um export Client e um artefato que se registra no loader do navegador. A fábrica usa o React fornecido pela aplicação e contribui por slots. A documentação exige recursos descartáveis: listeners, timers e estilos devem acompanhar o ciclo de vida da extensão.

Slots têm dono, cardinalidade e escopo. O [contrato de slots](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/docs/subsystems/slots.md) distingue posições únicas, listas e entradas por chave. Declarar uma contribuição não autoriza escrever livremente no DOM da aplicação.

### 6.3 Instalação e gestão

O [Plugin Manager](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/boot/plugin-manager/README.md) é a camada durável. Sua [ferramenta pública](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/boot/plugin-manager/src/tools.ts) inclui listar plugins/bundles, alternar ativação, instalar, remover e gerir exceções de compatibilidade. As listagens são paginadas. Operações persistentes passam pela política de aprovação do Harness; scripts de build de dependências têm tratamento próprio.

Os estados distinguem aplicação imediata, falha, cancelamento, sobreposição por outra camada e reinício necessário. Essa separação é valiosa para o Redcode: “arquivo salvo”, “dependência instalada” e “extensão ativa no cliente atual” são fatos diferentes.

### 6.4 Runners efêmeros não são o fluxo atual do Creator

O repositório também contém runners de definições dinâmicas com registro em memória, versão e execução Host/Client. Não devemos confundi-los com a instalação persistente usada hoje pelo Creator. O [runner Host](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/extensions/cordis-host-runner/README.md) diz explicitamente que suas definições se perdem no reinício. Seu papel atual inclui inspeção e consumidores programáticos.

Para nós, uma preview temporária pode ser útil, mas não deve aparecer como extensão instalada. Histórico de chat tampouco deve ser usado para reexecutar código automaticamente no reinício.

## 7. Permissões e isolamento: o que absorver e o que melhorar

A [nota de segurança oficial](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/SAFETY.md) caracteriza o produto como experimental e sem auditoria de segurança. Ela não deve ser transformada em alegação de que os plugins são isolados de forma segura.

Há três situações diferentes no código:

| Situação                  | Limite real descrito                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Bundle Host instalado     | Executa no processo e fora do sandbox de workspace; afeta o perfil                                                    |
| Definição dinâmica Host   | Usa `node:vm` e fachada de serviços, mas o próprio projeto diz que não é contenção de segurança                       |
| Definição dinâmica Client | Avaliação em closure, serviços declarados e wrappers de ciclo de vida; não uma VM ou origem de navegador independente |

O [sandbox Host](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/extensions/cordis-host-runner/src/sandbox.ts) redireciona certos globals para serviços e limita a parte síncrona da avaliação. O [avaliador Client](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/extensions/cordis-client-runner/src/client/evaluator.ts) orienta rede e timers para o contrato do runtime. Essas medidas ajudam cooperação e descarte, mas não justificam carregar código arbitrário de terceiros com acesso à autenticação do app.

### Fronteiras propostas para o Redcode

1. **Artefato:** conteúdo de projeto e preview sem acesso implícito a credenciais, IPC privilegiado ou APIs do servidor.
2. **Aplicação interativa:** runtime próprio, origem delimitada e mensagens tipadas; somente operações explicitamente expostas.
3. **Extensão confiável:** contribuições GUI ou servidor com permissões de instalação distintas, compatibilidade e identificação de origem.
4. **Execução pesada:** job em processo/worker apropriado, com cancelamento e ownership explícitos.

O modo Creator não deve conceder uma permissão universal nova. Reutilizar a política de ferramentas, instalação e aprovação existente. Build grants antigos não devem atravessar uma mudança para Question. Contas e endpoints disponíveis no ambiente não devem ser selecionados automaticamente.

## 8. Entrega de arquivos e estado compartilhado

O [`present` do Harness](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/deliverables/tool-present/README.md) registra arquivos acessíveis à sessão; ele não cria snapshots das versões nem copia os bytes para um repositório de artefatos. Isso é diferente do contrato atual de `session_artifact` no Redcode.

O ponto de aprendizado é distinguir entrega e instalação. Um modelo exportado deve ter uma entrada em Delivery. Uma extensão instalada deve aparecer no inventário de extensões. Se uma tarefa produzir ambos, o usuário precisa enxergar os dois fatos e a revisão relacionada.

Para ferramentas gráficas, a UI e o agente devem chamar a mesma operação de domínio. O usuário editar um parâmetro e salvar não pode deixar o agente trabalhando numa cópia desatualizada. Revisão esperada, origem das alterações e o resultado da operação devem fazer parte da troca, sem gravar novamente todo o estado em cada evento.

## 9. Assets 3D: três produtos diferentes

### 9.1 Cena procedural e visualização

Uma cena produzida em código pode ser construída com geometrias, materiais, iluminação, câmera e controles. Não exige automaticamente um provedor de geração 3D. É um bom primeiro caso para um Creator que já dispõe de arquivos, build e preview interativo.

Esse produto entrega código de cena e, se implementado, arquivos exportados. Deve declarar limitações de fidelidade e acessibilidade. Uma imagem do objeto não é um arquivo 3D, e um HTML com canvas não é automaticamente um modelo reutilizável em outra engine.

### 9.2 Ferramentas locais de modelagem e renderização

O [plugin Blender da comunidade](https://github.com/s1lverex/dsh-plugin-blender) demonstra status, renderização e conversão para GLB com preview próprio. Seu README descreve dependência de Blender e recomenda atenção às rotas de arquivos quando o servidor fica exposto. É inspiração, não componente nativo de Creator, e a compatibilidade anunciada é com versões antigas do Harness.

Para nós, executar Blender headless num worker Linux é uma integração separada de mostrar a cena no desktop Windows. O arquivo pertence à máquina executora até ser entregue ao servidor. O adaptador deve informar binário selecionado, formato aceito, erro original e onde a saída realmente ficou. Não instalar Blender ou iniciar uma renderização onerosa só porque o modo foi selecionado.

### 9.3 Geração por provedor externo

O projeto [Tripo para DSH](https://github.com/Tripo-Developer/Tripo3D-Plugin-dsh), hoje sob `Tripo-Developer`, acrescenta skills que operam `tripo-cli`. A documentação mostra autenticação, submissão, espera e download para o workspace, com conta e créditos do serviço. Isso não é uma API de geração 3D incorporada à DeepSeek.

Um adaptador equivalente no Redcode precisaria de seleção explícita de provedor/conta, catálogo de capacidades, parâmetros, acompanhamento do job e entrega local. Modelagem procedural deve continuar funcionando sem essa integração. O modo deve informar dependência ausente ou conta não selecionada de forma acionável, sem presumir que credenciais no ambiente autorizam uso.

### 9.4 Estado e interoperabilidade: referência complementar

Na [discussão de MCP Apps e editor Three.js](https://github.com/deepseek-ai/deepseek-harness/discussions/2424), o autor da integração descreve projeto persistente, revisões e devolução das operações humanas à conversa. É uma referência comunitária para colaboração humano/agente, não uma garantia de suporte do núcleo. A decisão de suportar MCP Apps no Redcode precisa de um projeto próprio de host, isolamento e visibilidade de ferramentas.

## 10. O que já existe no Redcode

Esta seção descreve o baseline lido antes da implementação do Creator nesta tarefa; os caminhos são relativos ao repositório.

| Necessidade                        | Infraestrutura existente                                                          | Aproveitamento e lacuna                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Modo primário com política própria | `packages/core/src/plugin/question.ts`, `packages/core/src/plugin/design.ts`      | Padrão de transformação do agente; adicionar Creator sem duplicar o runner de sessões            |
| Conhecimento de projeto            | Descoberta de instruções e skill tool                                             | Incluir skill embarcada e referências próprias da versão instalada                               |
| Protótipos revisáveis              | `packages/core/src/design/`, `packages/gui-extensions/src/design/`                | Preview e interação já têm caminho próprio; não precisam ser recriados como HTML solto           |
| Arquivos e revisões                | `packages/core/src/session/artifacts.ts`, schema `session-artifact.ts`            | Snapshot por sessão, arquivos por hash e revisão esperada; útil para rastreabilidade             |
| Entrega visível                    | `packages/gui-extensions/src/delivery/`                                           | Pode listar outputs e relações com jobs/revisões                                                 |
| Preview de artefatos               | `delivery/artifact-preview.ts`                                                    | Hoje desabilita scripts e recursos externos; não executa uma cena Three.js                       |
| Contribuições de interface         | `packages/gui-extensions/src/sdk/`, host em `packages/app/src/runtime/extension/` | SDK nativo com comandos, menus, painéis e ciclos de vida; não é um loader Cordis compatível      |
| Browser integrado                  | Extensões Browser e plugin-browser                                                | Pode ajudar a validar experiência e coletar evidências; depende de cliente e permissões          |
| Jobs, automações e workers         | Serviços existentes de tarefas, monitors e execução                               | Renderização/exportação podem reaproveitar ownership e cancelamento; não criar segundo scheduler |
| Informações operacionais           | Memória, atividade e dashboards já existentes                                     | Dados devem vir das projeções/serviços reais, sem geradores de KPI fictício                      |

### Consequência importante do preview atual

A descrição de `session_artifact` diz que scripts e recursos externos estão desabilitados. O construtor de preview aplica CSP restritiva. Portanto:

- Publicar um HTML com JavaScript em Delivery não comprova que a experiência interativa funciona.
- Não retirar essa restrição silenciosamente para uma demonstração 3D.
- Preferir o runtime de protótipos já existente ou criar uma capacidade interativa explícita, com contrato e testes próprios.
- Arquivos 3D binários ainda precisam de classificação, transporte e visualizador definidos. No baseline consultado, `ArtifactKind` não tem uma categoria de modelo 3D.

## 11. Contrato de produto proposto

### Os cinco modos

| Modo     | Resultado principal                                                                             |
| -------- | ----------------------------------------------------------------------------------------------- |
| Build    | Mudança implementada e validada no projeto                                                      |
| Plan     | Plano de implementação investigado e revisável                                                  |
| Design   | Protótipo, revisão visual e passagem das decisões aprovadas para implementação                  |
| Question | Investigação de leitura com resposta baseada em evidências                                      |
| Creator  | Artefato interativo ou extensão criada, verificável, entregável e, quando suportado, instalável |

Design e Creator compartilham infraestrutura visual, mas têm contratos diferentes. Design se organiza em decisões de interface e aprovação de um protótipo. Creator se organiza em uma capacidade utilizável e seus assets, controles, dependências e instalação. Um seletor novo com o mesmo prompt de Build não é essa especialização.

### Três destinos explícitos

| Destino          | Exemplos                                                  | O que o usuário deve receber                                             |
| ---------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| Projeto/artefato | Cena, simulação, pôster, arquivo 3D                       | Fontes, revisão, preview suportado e exportação real quando implementada |
| Sessão           | Ferramenta visual ou painel associado a uma conversa      | Entrada estável no workbench e vínculo com o estado da sessão            |
| Aplicativo       | Extensão global, integração de ferramentas ou novo painel | Pacote, origem, permissões e estado de instalação/ativação               |

O agente deve inferir o destino quando o pedido é claro e perguntar somente quando mudar esse destino altera substancialmente persistência ou alcance. Um pedido de “crie uma imagem” não deve instalar uma extensão no aplicativo.

## 12. Prompt e skills próprios: desenho proposto

O texto abaixo é uma proposta original de comportamento, não o prompt do DeepSeek e não a declaração de que essas ferramentas já existem.

> Você é o Creator do Redcode. Construa a capacidade ou o artefato pedido usando os contratos e ferramentas da instalação atual. Identifique o destino e as dependências, leia a referência necessária e produza uma primeira versão verificável. Reutilize os serviços existentes do Redcode. Trabalhe com fontes e revisões explícitas, use a política de permissões vigente e não trate a escolha deste modo como autorização para instalar dependências, publicar conteúdo ou gastar créditos. Verifique a funcionalidade e o ciclo de vida; distinga fonte criada, build concluído, preview validado e extensão ativa. Entregue o resultado, sua localização e os limites que permanecerem sem verificação.

Uma skill embarcada curta deve apontar para receitas por necessidade:

| Referência proposta   | Conteúdo                                                                  |
| --------------------- | ------------------------------------------------------------------------- |
| `artifacts`           | Workspace, publicação, revisões, conflitos, entradas e formatos           |
| `interactive-preview` | Runtime suportado, assets locais, mensagens e evidências de renderização  |
| `procedural-3d`       | Cena, câmera, controles, ciclo de render, descarte e exportação suportada |
| `gui-extension`       | SDK da versão instalada, comandos, painéis, estado e desativação          |
| `server-plugin`       | Contratos do servidor, ferramentas, configuração e escopo de credenciais  |
| `external-renderers`  | Detecção de dependência explícita, job remoto e download de outputs       |
| `verification`        | Verificação funcional, visual, acessibilidade e recursos após fechamento  |

O catálogo inicial deve ser econômico; receitas são carregadas sob demanda. Não colocar a documentação inteira do Design, do SDK GUI e de um motor 3D em toda requisição do Creator.

## 13. Plano de implementação e critérios de saída

### Fase A — quinto modo e primeiro resultado verificável

Adicionar identificação, descrição, prompt próprio e política às listas de agentes e seletores de desktop/web/TUI. Reusar sessão, provider, Code Mode e histórico existentes. Fornecer uma orientação de autoria que nomeie apenas ferramentas realmente registradas.

Escolher um caminho existente para o primeiro artefato interativo, deixando clara a diferença entre revisão Design e produto Creator. Criar uma pequena cena/simulação de demonstração com fontes editáveis, controles reais e entrega local. Publicar uma segunda revisão para provar atualização e conflito, em vez de produzir apenas screenshots.

Critérios:

- Creator aparece nos três clientes e mantém identidade após reinício/reconexão.
- Entrar no modo não dispara geração, instalação ou acesso a um provedor por si só.
- Ferramentas citadas estão disponíveis conforme a capacidade real da sessão.
- O primeiro resultado pode ser aberto pelo usuário no desktop e na web por um caminho suportado.
- Question continua sem acesso a mutação ao trocar de modo.
- Selecionar Creator numa sessão TUI sem GUI fornece arquivos/URL ou limitação específica, sem depender de um painel invisível.

Essa fase é uma primeira capacidade vertical. Ela não entrega, sozinha, equivalência com o Plugin Manager da DeepSeek nem os sete produtos demonstrados.

### Fase B — autoria de extensões com catálogo real

Expor documentação/inspeção dos contratos Redcode, oferecer templates válidos do SDK e permitir ao agente preparar um pacote local. Separar validação, instalação, ativação e diagnóstico. Usar o inventário de Agent Extensions, em vez de criar um cadastro concorrente.

Critérios:

- Uma extensão simples pode ser criada, validada, ativada, desativada e removida.
- A UI informa se o cliente atual carregou a extensão e qual revisão está ativa.
- Erros de schema, import, dependência e montagem preservam detalhes técnicos e não derrubam o workbench.
- Desinstalar remove contribuições e libera recursos; não apaga outputs criados pelo usuário.
- Permissão da sessão não concede implicitamente execução privilegiada no Host.

### Fase C — assets 3D como domínio de primeira classe

Definir modelo de assets e transporte binário antes de um viewer generalista. Para uma primeira compatibilidade, avaliar GLB/glTF com uma biblioteca mantida e pacote local, evitando CDNs obrigatórios em redes corporativas. A escolha é proposta nossa, não formato contratado pela DeepSeek.

Metadados mínimos propostos: tipo de asset, revisão, arquivos e hashes, ferramenta geradora, parâmetros relevantes, unidade/eixos quando conhecidos, dependências, preview e proveniência/licença disponível. Não armazenar tokens ou credenciais na proveniência.

Critérios:

- Importação, manipulação visual suportada e exportação de um arquivo válido, com teste de round-trip do que se promete preservar.
- Erro de formato e dependência ausente acionáveis.
- Arquivo remoto é servido pela API autenticada e confinado ao projeto/asset, sem aceitar caminho arbitrário vindo do browser.
- Abrir outra sessão não reaproveita indevidamente memória, credenciais ou arquivo da anterior.
- A cena continua compreensível quando WebGL não está disponível e pode fornecer preview estático.

### Fase D — renderizadores e geradores externos

Integrar adaptadores, começando por um que resolva uma necessidade concreta. Reutilizar workers/jobs/monitors para submissão, espera, cancelamento, recuperação e entrega. Seleção de conta e máquina executora precisa ser visível.

Critérios:

- Reiniciar cliente não duplica um job remoto nem uma operação paga.
- O agente acompanha o job conhecido, em vez de iniciar outro porque houve timeout de uma leitura.
- Cancelamento e falha liberam streams e processos próprios e preservam outputs já entregues.
- Headless Linux pode renderizar sem exigir um desktop conectado, quando o backend escolhido suporta isso.

### Fase E — editores colaborativos e casos da demonstração

Depois da fundação, priorizar aplicações por demanda: editor de cenas, pôster, leitor anotável, editor de vídeo ou dashboards personalizados. Cada uma é uma entrega de domínio; não existe equivalência automática por adicionar um quinto item ao seletor.

O editor precisa de operações tipadas compartilhadas entre usuário e agente, revisão esperada, undo/redo onde prometido e estado persistente. Exportar vídeo exige verificar codecs, resolução, áudio e fonte de mídia; desenhar uma timeline não comprova edição/exportação.

## 14. Memória e CPU: requisitos desde a primeira entrega

O histórico de consumo em idle do Redcode torna o ciclo de vida um critério funcional. Creator não pode acrescentar um render loop global sempre ligado.

| Recurso                         | Comportamento exigido                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| Bibliotecas grandes             | Importação sob demanda ao abrir a capacidade                                               |
| Render loop                     | Pausar quando o painel/aba ficar oculto; renderizar por demanda quando a cena for estática |
| Geometria, materiais e texturas | Ownership por projeto/view e descarte ao substituir ou fechar                              |
| Timers/listeners/observers      | Registro com disposer e remoção na desativação                                             |
| Histórico de revisões           | Listagem paginada e leitura do conteúdo sob demanda                                        |
| Binários e mídia                | Não manter múltiplas cópias base64 em stores reativos e histórico do chat                  |
| Jobs de exportação              | Processo/worker apropriado e progresso resumido, sem logs ilimitados no renderer           |
| Dados de dashboard              | Projeções e assinaturas mínimas; não recalcular todas as sessões a cada tick               |

Esses requisitos devem ser medidos. A UI pode mostrar consumo e configurações escolhidas pelo usuário; não deve inventar um limite universal de RAM nem classificar 2 GB como “ruim” para todos.

A política de retenção de métricas existente deve continuar valendo. Métricas operacionais de memória não precisam incorporar os arquivos do projeto, frames de vídeo ou geometria da cena.

## 15. Matriz de validação sugerida

| Área                  | Teste                                 | Evidência desejada                                                     |
| --------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| Registro do modo      | Core e seletores                      | ID estável, seleção/restauração e descrição correta                    |
| Política              | Testes de permissões                  | Leitura vs mutação, troca para Question e ausência de grants indevidos |
| Catálogo              | Fixture de instalação com e sem GUI   | Capacidades disponíveis e bloqueios específicos                        |
| Artefatos             | Publicação e duas revisões            | Hashes/entrada corretos e conflito de revisão rejeitado                |
| Preview               | Teste em navegador real               | Controles funcionam; nada sai da origem/permissões contratadas         |
| Desktop Windows       | Runtime empacotado                    | Abertura, fechamento e navegação sem drag global indevido              |
| Web                   | Servidor local e remoto               | Downloads autenticados e sem dependência de caminhos locais do browser |
| TUI                   | Sessão headless                       | Comandos/artefatos acessíveis e fallback claro para preview            |
| Worker Linux          | Job de ferramenta local               | Ownership, cancelamento e transferência da saída                       |
| Recuperação           | Desconexão/reinício durante job       | Resultado chega à sessão sem duplicar execução                         |
| Ciclo de vida         | Repetir abrir/fechar/switch           | Sem acúmulo de loops, listeners, webviews e buffers                    |
| Segurança de arquivos | Traversal/symlink/MIME e autenticação | Rejeição na fronteira que serve o asset                                |
| Rede corporativa      | CDN e domínio do provedor bloqueados  | Erro da operação e fallback local, quando suportado                    |
| Visual                | Tema claro/escuro, largura compacta   | Controles acessíveis e alinhados ao Design System                      |

Não considerar testes de parser ou snapshots de texto como prova de que uma cena ou editor funciona visualmente. Também não considerar uma captura de mock como validação da aplicação empacotada.

## 16. Decisões que a comparação recomenda

1. Implementar Creator como especialização do nosso sistema de agentes, mantendo o servidor como fonte da política.
2. Reaproveitar Design para o que ele já resolve em protótipos, e Delivery para snapshots e entrega; não enfraquecer o isolamento do preview estático para acomodar JavaScript.
3. Trazer descoberta de contratos e skills progressivas antes de prometer um ecossistema inteiro de plugins gerados.
4. Tratar extensão nativa, aplicação interativa e arquivo 3D como produtos com ciclos de vida diferentes.
5. Manter providers independentes do modo e exigir seleção/configuração explícita para serviços externos.
6. Medir descarte e idle no primeiro viewer; um resultado visual bonito não compensa uma aba consumindo recursos depois de fechada.
7. Priorizar capacidades verificadas, com estados de instalação e execução claros. A qualidade do feedback é parte da funcionalidade.

## 17. Fontes para continuar o trabalho

- [Produto oficial](https://www.deepseek.com/en/harness/).
- [Prompts oficiais em inglês](https://cdn.deepseek.com/harness/dsh-creator-mode-prompt-collection-en.html) e [chinês](https://cdn.deepseek.com/harness/dsh-creator-mode-prompt-collection-zh.html).
- [Repositório oficial no snapshot estudado](https://github.com/deepseek-ai/deepseek-harness/tree/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb).
- [Preset Creator/cordis](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/bundle/web-app/presets/cordis.patch.yml).
- [Skill e seu índice de receitas/templates](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/preset/agent-preset/skills/dsh-doc/SKILL.md).
- [Inspeção de APIs](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/extensions/tool-cordis/README.md).
- [Gerenciamento de plugins](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/boot/plugin-manager/README.md).
- [Contratos de slots](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/docs/subsystems/slots.md).
- [Runner Host e limites declarados](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/extensions/cordis-host-runner/README.md).
- [Runner Client](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/extensions/cordis-client-runner/README.md).
- [Entrega de arquivos](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/deliverables/tool-present/README.md).
- [Aviso de segurança e licença](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/SAFETY.md).
- [Tripo para Harness, projeto de terceiro](https://github.com/Tripo-Developer/Tripo3D-Plugin-dsh).
- [Blender para Harness, projeto comunitário](https://github.com/s1lverex/dsh-plugin-blender).
- [Editor Three.js e MCP Apps, discussão comunitária](https://github.com/deepseek-ai/deepseek-harness/discussions/2424).

Os links de projetos de terceiros são referências de implementação, não indicação de instalação automática, endosso da DeepSeek ou declaração de compatibilidade com o Redcode. Nenhuma dessas dependências foi instalada ou ativada por esta pesquisa.
