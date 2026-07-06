# Cronograma de Implantacao - Sistema de Subprodutos

Data atual de referencia: 02/07/2026  
Data limite para entrada em acao: 17/07/2026

## Objetivo

Preparar o sistema inicial de controle de subprodutos para teste de campo e entrada em acao operacional ate 17/07/2026, com foco em registro offline pelo motorista, sincronizacao ao retornar para a industria, dashboard de acompanhamento e validacao dos dados de fazenda, parcela, motorista, subproduto, viagem, peso e local de descarrego.

## Cronograma

| Periodo | Etapa | Entrega esperada |
| --- | --- | --- |
| 02/07 | Apresentacao visual e alinhamento | Validar proposta, telas, escopo do piloto e fluxo operacional |
| 03/07 a 05/07 | Ajustes do MVP | Separar base do sistema de subprodutos, revisar app e dashboard, preparar dados demonstrativos |
| 06/07 a 08/07 | Integracoes iniciais | Conectar Supabase separado, validar motoristas/headcount, inventario de fazendas e parcelas |
| 09/07 a 10/07 | Teste interno | Simular registros, sincronizacao, conciliacao com ticket e filtros do dashboard |
| 11/07 a 13/07 | Teste de campo controlado | Rodar piloto em Vila Nova e Fe em Deus com motoristas selecionados |
| 14/07 | Revisao do piloto | Consolidar erros, feedbacks e ajustes criticos |
| 15/07 | Treinamento rapido | Orientar motoristas, balanca e responsaveis pelo acompanhamento |
| 16/07 | Simulacao final | Conferir checklist, dados, mapas, sincronizacao e dashboard |
| 17/07 | Entrada em acao | Iniciar uso operacional monitorado do sistema |

## Escopo do piloto

- Fazendas do momento: Vila Nova e Fe em Deus.
- Nova Conceicao fica fora do piloto inicial.
- Subprodutos: Borra, Cacho Vazio (Bucha), Cacho Triturado, Cinza, Torta e Outros.
- Origem do carregamento: Extratora, Patio e Outras.
- Registro em campo: motorista, placa, data, subproduto, origem, fazenda, parcela ou entre parcelas, GPS, ticket e observacao.
- Dashboard: viagens, volume, motoristas, fazenda, subproduto, pendencias, mapa CQO e filtros.

## Criterios para entrada em acao

- Registro offline funcionando no celular.
- Sincronizacao funcionando ao retornar ao Wi-Fi da industria.
- Motoristas e placas validados.
- Fazendas e parcelas do piloto carregadas corretamente.
- Dashboard exibindo dados por motorista, fazenda, subproduto e ponto de descarrego.
- Mapa exibindo shape unico conforme fazenda selecionada.
- Processo de conferencia com balanca definido para o piloto.

## Riscos e mitigacao

| Risco | Mitigacao |
| --- | --- |
| Falha de internet no campo | Operacao offline com sincronizacao posterior |
| GPS impreciso | Registrar precisao e revisar pontos fora do esperado |
| Motorista esquecer registro | Treinamento curto e checklist operacional |
| Divergencia com ticket de balanca | Marcar pendencias no dashboard e conciliar no retorno |
| Cadastro de parcela inconsistente | Usar inventario oficial do Supabase como fonte |
