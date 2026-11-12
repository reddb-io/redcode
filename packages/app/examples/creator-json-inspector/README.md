# JSON Inspector: Creator → plugin → conversa

Exemplo real gerado pelo agente Creator no Redcode 0.87.26. O pacote em `plugin/` é uma cópia da revisão publicada e instalada pelo instalador de Agent extensions. Não requer dependências nem acesso a arquivos, rede ou credenciais.

Este exemplo adiciona ferramentas ao agente; não instala um painel visual. O Creator produz e publica a extensão, e uma conversa Build usa as ferramentas registradas.

## Usar pela interface

1. Em um projeto, peça ao Creator para criar uma extensão `server-plugin`, com entry `server.js`, usando o SDK `ctx.tool.transform(editor => editor.add(...))`. Use o [pacote de referência](./plugin/README.md) para especificar o comportamento.
2. Aguarde a publicação da revisão.
3. Abra **Settings → Agent extensions → Plugins → Install Creator plugin**.
4. Selecione o documento publicado, revise o pacote e escolha **Install disabled → Test plugin → Activate**.
5. Em uma conversa **Build** no mesmo projeto, envie:

```text
Use o plugin JSON Inspector neste JSON:
{"customer":{"name":"Ana","email":"ana@example.com"},"orders":[{"id":"ORD-1042","total":149.9}],"active":true}
Chame json_inspect e depois json_pointer_get para /customer/email e /orders/0/total.
```

As chamadas retornam 3 objetos, 1 array, 7 chaves e 9 valores (incluindo contêineres), `ana@example.com` e `149.9`. São ferramentas do agente, não comandos de barra. Para desativar ou remover, use o cartão do plugin em Agent extensions.

## Validação

Na raiz do repositório:

```sh
bun packages/app/examples/creator-json-inspector/verify.ts
```

O verificador importa o módulo realmente exportado pelo pacote, registra suas ferramentas e executa 22 casos: JSON válido/inválido, ponteiros RFC 6901, escapes, índices de arrays, propriedades próprias e documento profundo. Não duplica a implementação.

Além disso, na demonstração Windows:

- A revisão R1 foi instalada, testada e ativada pelos controles reais da interface web compartilhada com o desktop.
- O teste isolado carregou `creator.json-inspector`, registrou ambas as ferramentas e concluiu o teardown. Esse teste verifica compatibilidade; não executa as ferramentas.
- Uma conversa Build executou `json_inspect` e duas chamadas de `json_pointer_get`. Os resultados reais do servidor foram conferidos, além da resposta do modelo.
- Nenhuma rota foi simulada. A instalação ficou restrita ao projeto de demonstração.

## Reproduzir o laboratório

Com as dependências instaladas e `packages/app/dist` construído, execute na raiz:

```sh
bun packages/core/script/creator-plugin-demo.ts <diretorio-do-laboratorio> <caminho-explicito-do-seu-opencode.db> 3198
```

O script abre o banco indicado somente para leitura e reutiliza uma conexão salva de um modelo selecionado recentemente. A credencial fica apenas na memória do laboratório; não é exportada para o pacote ou para seu banco persistente. Não usa variáveis de ambiente como fallback.

Abra `http://127.0.0.1:3198/demo/setup`. Na primeira execução, o Creator gera o pacote usando o provedor salvo, com o custo normal dessa chamada. O laboratório tem banco, projeto e armazenamento do navegador separados. Reiniciar com o mesmo diretório retoma a conversa existente sem reenviar o pedido. Encerre o processo do laboratório quando terminar.

O prompt completo de geração está em `packages/core/script/creator-plugin-demo.ts`. A instalação permanece uma ação explícita na interface; o script não a realiza automaticamente.
