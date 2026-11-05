# Roadmap do Redcode

## Tornar as esperas do agente visíveis

**Problema:** durante uma conversa, a interface pode mostrar que o agente está pensando ou executando ferramentas sem explicar que o progresso depende de uma operação que ainda não terminou. Isso dificulta entender se o trabalho está avançando ou o que está demorando.

**Objetivo:** mostrar no desktop, na web e no TUI as esperas que o servidor consegue identificar, com uma descrição útil da operação e seu estado atual. Exemplos incluem uma resposta de modelo, a inicialização de um servidor MCP, um comando ou teste, um agente delegado, um monitor e uma pergunta ou autorização pendente. A disponibilidade de cada motivo deve ser confirmada na implementação; a interface não deve inventar uma causa quando ela não for conhecida.

**Implementação local:** chamadas ativas que aguardam um monitor, uma tarefa de background ou um subagente em primeiro plano aparecem com identificador disponível e tempo desde o início da chamada. Desktop e web permitem abrir a operação na conversa. Monitores que seguem em segundo plano aparecem separadamente, inclusive com a conversa ociosa, até se encerrarem; o TUI permite abrir a lista de monitors. O servidor também informa a espera pelo registro inicial e pelas chamadas de ferramentas MCP, identificando a ferramenta, e pela primeira resposta do modelo; pedidos de permissão carregam o horário de criação. Esses estados são recuperados na reconexão enquanto a execução ou permissão permanecer ativa. Servidores antigos não fornecem as novas fases ou o horário de pedidos antigos, portanto a interface não inventa duração.

Na abertura fria de sessão em build web de produção com fixture, três amostras por rodada tiveram mediana de 802,2 ms antes e 786,6 ms depois para a primeira apresentação estável. A amostra é pequena e não mede impacto durante esperas ativas; não demonstra ganho ou ausência de regressão. Dados: [antes](evaluations/agent-wait-session-before.jsonl) e [depois](evaluations/agent-wait-session-after.jsonl).

A inclusão do inventário de monitors na sessão teve mediana de 802,1 ms na mesma medição, comparada a 786,6 ms na rodada imediatamente anterior. As três amostras não permitem concluir o impacto nem representam uma conexão remota; outros testes também rodaram durante a construção do segundo build. A medição antecedeu um pequeno ajuste posterior na sanitização dos identificadores. Dados: [antes](evaluations/agent-wait-session-after.jsonl) e [depois](evaluations/background-monitor-session-after.jsonl).

Com as fases de MCP, modelo e permissão, a mediana da apresentação estável foi de 754,0 ms nas mesmas condições, contra 802,1 ms na rodada anterior. São apenas três amostras por rodada e não há evidência de ganho; a medição não inclui espera ativa nem rede remota. Dados: [antes](evaluations/background-monitor-session-after.jsonl) e [depois](evaluations/phase-waits-session-after.jsonl).

**Comportamento desejado:**

- Identificar o que está sendo aguardado e, quando disponível, o nome da ferramenta, comando, servidor MCP, agente ou tarefa relacionada. Oferecer um caminho para abrir a operação ou conversa correspondente quando existir.
- Mostrar há quanto tempo a espera está ativa e, quando conhecido, seu limite ou próxima tentativa. Distinguir execução em andamento, espera por serviço externo, resposta humana, repetição e erro; não representar uma estimativa como prazo garantido.
- Lidar com esperas simultâneas sem esconder operações relevantes, além de encerrar ou atualizar o estado ao concluir, falhar, cancelar ou reconectar. Evitar piscar para operações rápidas.
- Preservar contexto de sessão, localização e permissões; não expor credenciais, argumentos sensíveis ou conteúdo de outras sessões. Não inferir que um processo está travado apenas pelo tempo decorrido.
- Garantir que o estado seja consistente ao reabrir uma conversa e após reconexão ou reinício, conforme o ciclo de vida real de cada operação. Clientes antigos devem continuar funcionando quando não receberem os novos dados.

**Critérios para implementação:** inventariar os estados e eventos já existentes no servidor; definir um contrato compartilhado que diferencie observação confirmada de informação desconhecida; implementar uma primeira fatia mensurável de ponta a ponta nas três interfaces; testar múltiplas esperas, isolamento entre sessões, falha, cancelamento, reconexão e compatibilidade com servidores e clientes antigos. O tratamento de processos que sobrevivem ao servidor deve seguir as garantias reais de cada executor, sem prometer recuperação universal.
