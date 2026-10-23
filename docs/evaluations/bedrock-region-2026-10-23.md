# Região Bedrock após a mesclagem de configuração

> Registro histórico do commit `32db466ab5`. A decisão de não configurar
> providers por ambiente foi reafirmada depois desta entrega. Os fallbacks de
> ambiente e de região descritos abaixo foram removidos pela
> [política de configuração explícita](../provider-configuration.md).
> A resolução após mesclar valores explícitos foi preservada.

## Fonte e falha confirmada

O estudo de [OpenCode #58531](https://github.com/anomalyco/opencode/pull/58531)
apontou o caminho de resolução do endpoint. A nova consulta ainda encontrou o PR
aberto e não mesclado, head `a6c3d9e7766a8bc1b076bdc7cebb0e907efbb66d`, base
`09e6ddf630b5f2466addf6044b79a60bd48bac03`.

A correspondência foi reproduzida no Redcode: um provider configurado com
`settings.region = "us-west-2"` e um modelo com URL
`https://bedrock-mantle.${AWS_REGION}.api.aws/openai/v1` falhava quando a variável
de ambiente estava ausente. O teste usa o plugin real de configuração, o catálogo
de modelos e `ModelResolver.Service`; não substitui a resolução por um mock.

O conjunto inicial teve seis falhas e um caso de controle passando antes da
correção. Incluiu uma segunda falha: a normalização interpolava a região do
modelo antes de aplicar a configuração da credencial. Uma credencial que escolhia
outra região conservava o endpoint antigo.

## Contrato Redcode

`AISDKNative` conserva o template da URL durante a normalização. `ModelResolver`
resolve-o após mesclar provider, modelo, metadados da credencial e configuração
da credencial. Para os adapters Bedrock nativos, inclusive aliases de provider,
`${AWS_REGION}` usa `BedrockAuth.resolveRegion`, a mesma política do adapter:

1. `region` resultante da mesclagem;
2. região nas credenciais estáticas;
3. `AWS_REGION`;
4. `AWS_DEFAULT_REGION`;
5. padrão nativo `us-east-1`.

A configuração da credencial continua prevalecendo sobre os seus metadados e os
settings do modelo; os settings do modelo continuam prevalecendo sobre os do
provider. A política de outras variáveis de endpoint continua estrita. Em outros
adapters, `${AWS_REGION}` continua vindo do ambiente, sem usar um campo `region`
que pertença a outro protocolo. Endpoints explícitos sem template são preservados.

A dependência de autenticação Bedrock carrega somente no caminho que precisa
resolver seu placeholder. O catálogo permanece exclusivamente V2, sem mudanças
de Protocol/HttpApi ou edição de Client gerado.

## Verificação e limites

Depois da correção, os sete casos iniciais passaram. A suíte ampliada passou com
129 testes, zero falhas e 540 asserções, cobrindo resolução, normalização, plugin
de configuração e plugin Bedrock. Inclui credenciais estáticas, defaults nativos,
controle de outro adapter e recusa de variáveis ainda ausentes.

O [registro de validação](bedrock-region-2026-10-23-validation.json) fixa a árvore
de pacotes e os logs de antes/depois, além do check canônico. A evidência é local:
construção e resolução reais dos modelos, sem chamada paga ao Bedrock ou acesso
ao serviço instalado. Não houve publicação nem reinício de serviço.
