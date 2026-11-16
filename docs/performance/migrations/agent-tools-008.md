# AGENT-TOOLS-008 — detecção de executáveis das ferramentas

- Estado: `REJECTED` para reescrita Rust; otimização TypeScript no caminho padrão.
- Jornada: abertura de projetos no backend em host sem ferramentas instaladas.
- Contrato: preservar status, comandos configurados pelo usuário, detecção de
  instalação e alterações posteriores no PATH; não iniciar ferramentas nem
  consultar registros remotos durante a listagem.
- Meta: remover as buscas por Node quando nenhuma ferramenta precisa dele, sem
  regressão funcional nas ferramentas gerenciadas e em comandos personalizados.

No cenário isolado de cinco projetos, o backend chamou `Bun.which("node")` 40
vezes e passou 111,47 ms dentro dessas chamadas. São tempos acumulados de um
único ensaio, não p95 nem tempo de abertura de produção. O perfil anterior já
apontava essa chamada em `AgentTools.read`. O Node só é usado para executar o
Browser Control gerenciado; o plano é procurar o executável somente quando esse
pacote existir, sem cachear o PATH entre listagens.

Após a mudança, o mesmo cenário registrou zero buscas por Node, contra 40 no
baseline. Trata-se de uma execução por condição; o contador cobre o processo
inteiro e a duração acumulada das chamadas não equivale ao tempo total de boot.
O teste de integração exercitou pacote gerenciado ausente, instalação e remoção
do arquivo de entrada, além do comando personalizado e das operações existentes.
O caminho continua consultando o PATH quando necessário, sem memorizar resultados.
Não foi aberta PoC Rust porque eliminar o trabalho desnecessário preservou o
contrato com uma mudança localizada. Arquivos brutos:
`agent-tools-lookup-before.json` e `agent-tools-lookup-after.json` em
`C:/Users/filip/artifacts/redcode-rust-study-2026-11-13/`.
