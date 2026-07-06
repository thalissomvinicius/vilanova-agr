# Conhecimento da Empresa Aplicado ao Sistema de Subprodutos

Fonte analisada: `C:\Users\thali\OneDrive\Desktop\conhecimento_empresa`.

## Conclusao

Essa pasta ja serve como base inicial de aprendizado sobre a Vila Nova Agroindustrial. Ela nao e apenas material solto: contem inventario de fontes, glossario, processos operacionais, entidades de banco, formularios, indicadores, relatorios existentes, mapa de PBIX e pendencias de validacao agricola.

Para o sistema de subprodutos, o material mais relevante e o conjunto de documentos sobre efluentes, fazenda/parcela, balanca, app offline, sincronizacao e dashboard.

## O que a base ensina sobre a operacao

- A operacao agricola ainda depende bastante de Excel, PDF, Power BI e formularios impressos.
- Existe padrao recorrente de registro por data, fazenda, parcela, linha, equipe/fiscal, veiculo/equipamento e quantidade.
- O app offline e um caminho ja previsto para substituir papel e digitacao manual.
- A arquitetura desejada aparece varias vezes: coleta offline -> armazenamento local -> fila de sincronizacao -> banco SQL -> dashboard -> IA corporativa com rastreabilidade.
- Ha forte necessidade de padronizar cadastros mestres antes de travar listas rigidas.

## Ligacao direta com subprodutos, transporte e despejo

O arquivo `processos_operacionais.md` descreve a gestao de efluentes como um mini-sistema operacional:

- geracao diaria por origem;
- aplicacao no campo;
- controle por OS;
- carreta/placa;
- transporte;
- fazenda;
- parcela;
- linha;
- quantidade aplicada;
- preco unitario e total;
- nivel de bacia/lagoa;
- pluviometria;
- meta vs realizado;
- disponibilidade de TP/carreta;
- custos, receitas e projecao mensal.

Isso conversa diretamente com o nosso MVP de subprodutos. O registro atual do motorista deve evoluir para capturar tambem:

- OS ou ordem de servico;
- origem/carregamento do subproduto;
- tipo de subproduto;
- placa/carreta;
- TP/trator/equipamento quando aplicavel;
- fazenda;
- parcela ou intervalo entre parcelas;
- linha;
- quantidade transportada;
- quantidade aplicada/despejada;
- ticket de balanca;
- horario de saida e retorno vindo da balanca;
- GPS;
- observacao;
- anexos/foto, se validado pela operacao.

## Entidades mestres importantes

As entidades candidatas em `entidades_banco_dados.md` indicam que o sistema deve ter cadastros mestres para evitar digitacao livre demais:

- fazendas;
- parcelas;
- anos de plantio;
- areas agricolas;
- colaboradores;
- fiscais;
- motoristas;
- equipes;
- veiculos;
- carretas;
- tratores/TP;
- equipamentos;
- atividades;
- subprodutos;
- origens de geracao;
- centros de custo;
- fontes de dados.

Para o modulo atual, os cadastros prioritarios sao:

1. fazendas;
2. parcelas;
3. colaboradores/motoristas;
4. veiculos e carretas;
5. equipamentos/TP;
6. subprodutos;
7. origens de carregamento;
8. tipos de destino/aplicacao.

## Indicadores que devem inspirar o dashboard

Os documentos `indicadores_agricolas.md`, `relatorios_existentes.md` e `mapa_pbix_qualidade_agricola.md` mostram um padrao analitico util:

- analise por periodo, fazenda, parcela, fiscal/equipe e veiculo;
- comparacao meta vs realizado;
- acompanhamento diario, mensal e acumulado;
- uso de dimensoes como calendario, fazendas, inventario e balanca;
- separacao entre dado bruto coletado e calculo feito no dashboard/backend.

Indicadores recomendados para subprodutos:

- toneladas transportadas por subproduto;
- toneladas aplicadas/despejadas por fazenda e parcela;
- viagens por dia, motorista, veiculo e subproduto;
- tempo medio de ciclo entre saida e retorno na balanca;
- diferenca entre peso liquido de balanca e quantidade aplicada informada no campo;
- viagens sem registro de campo;
- registros de campo sem pesagem vinculada;
- aplicacao por linha/parcela;
- meta vs realizado por subproduto, se houver meta operacional;
- custo ou receita por subproduto, quando o processo financeiro for validado.

## O que nao deve ser assumido ainda

Os documentos deixam muitas pendencias explicitas. Para evitar construir regra errada, nao devemos assumir sem validacao:

- lista oficial de fazendas e parcelas;
- lista oficial de subprodutos;
- significado exato de TP, CFF e HD;
- se efluente e tratado como subproduto no mesmo fluxo de outros materiais;
- se a aplicacao/despejo sempre tem OS;
- se linha e obrigatoria para todos os subprodutos;
- se foto, assinatura ou GPS devem bloquear envio;
- formula de meta vs realizado;
- regra de conciliacao automatica entre balanca e campo;
- quem pode corrigir registro sincronizado.

## Impacto no MVP atual

O MVP ja esta na direcao correta porque possui:

- formulario offline;
- registro por motorista, placa, fazenda e parcela;
- modo parcela ou entre parcelas;
- GPS opcional;
- fila local;
- sincronizacao com Supabase;
- dashboard inicial;
- SQL inicial.

Mas a base de conhecimento mostra que a proxima versao deve adicionar:

- OS;
- origem/carregamento;
- linha;
- equipamento/TP;
- quantidade aplicada;
- cadastros mestres;
- integracao mais forte com balanca;
- tabelas de efluentes/aplicacoes;
- reconciliacao entre campo e pesagem;
- filtros por fazenda, parcela, subproduto, motorista, veiculo e periodo.

## Proxima evolucao tecnica recomendada

1. Criar tabelas mestres no Supabase: `farms`, `plots`, `employees`, `vehicles`, `equipments`, `subproducts`.
2. Atualizar `field_deposits` para conter OS, origem, linha, equipamento/TP e quantidade aplicada.
3. Criar uma tabela especifica de pesagens importadas da balanca.
4. Criar rotina de conciliacao por ticket, placa, motorista e janela de horario.
5. Trocar campos livres por listas carregadas localmente para funcionar offline.
6. Manter todos os registros com UUID local e sincronizacao idempotente.
7. Documentar quais planilhas atuais sao oficiais antes de importar dados historicos.

## Arquivos mais importantes para continuar

- `visao_geral.md`
- `processos_operacionais.md`
- `entidades_banco_dados.md`
- `formularios_identificados.md`
- `indicadores_agricolas.md`
- `relatorios_existentes.md`
- `oportunidades_melhoria.md`
- `mapa_pbix_qualidade_agricola.md`
- `pendencias_validacao_agricola.md`

## Leitura do Codex

Esta base deve ser tratada como conhecimento de dominio e nao como verdade final. Ela e boa o suficiente para orientar modelagem, telas e perguntas de validacao, mas ainda precisa de confirmacao com a equipe operacional antes de virar regra bloqueante.
