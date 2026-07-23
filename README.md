# POKA PRÁTIKA

Sistema oficial de gestão do futebol semanal POKA PRÁTIKA, criado para substituir a súmula em papel e o controle manual por Excel.

Grupo de futebol de Balneário Camboriú/SC, com identidade visual própria inspirada no espírito cômico dos jogadores “pouca prática”, mas apaixonados por futebol.

## Arquitetura

- `frontend/`: React + Vite + TypeScript + Tailwind CSS, serviço próprio na Railway.
- `backend/`: Node.js + TypeScript + Express, serviço próprio na Railway.
- `migrations/`: scripts SQL nativos executados manualmente no PostgreSQL Railway via TablePlus.
- `docs/`: documentação técnica e operacional.

## Regras de infraestrutura

- 100% Railway.
- Sem ORM.
- Sem arquivo `.env`.
- Sem hardcode de URL, porta, segredo ou conexão.
- Banco alimentado apenas por SQL nativo no backend e migrações manuais.

## Variáveis Railway

### Backend

- `DATABASE_URL`
- `NODE_ENV=production`
- `PORT=8080`
- `JWT_SECRET`
- `ALLOWED_ORIGINS`
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_GRAPH_MAILBOX`
- `MICROSOFT_TENANT_ID`
- `FRONTEND_URL`

### Frontend

- `VITE_API_URL`

## Validações realizadas

- Backend: build TypeScript executado com sucesso.
- Frontend: build React/Vite/Tailwind executado com sucesso.
- Auditoria npm: backend e frontend sem vulnerabilidades moderadas ou superiores.
- Checagem do editor: sem erros ativos.
- Backend valida em runtime `NODE_ENV=production` e `PORT=8080` antes de escutar conexões.
- Backend expõe `/health` para processo vivo e `/ready` para validar conexão real com PostgreSQL.

## Primeira implantação

1. Execute `migrations/01_core_schema.sql`, `migrations/02_pagamentos_vencimento_pontuacao.sql`, `migrations/03_saldo_inicial_temporada_excel.sql`, `migrations/04_posicoes_oficiais_atletas.sql`, `migrations/05_sumula_rascunho_operacional_autosave.sql`, `migrations/06_selecao_do_ano_7_votos.sql`, `migrations/07_eventos_gol_contra.sql` e `migrations/08_email_case_insensitive_unico.sql` no PostgreSQL Railway pelo TablePlus.
2. Configure o serviço Railway do backend apontando para `backend/`.
3. Configure o serviço Railway do frontend apontando para `frontend/`.
4. Defina todas as variáveis nos respectivos serviços.
5. Acesse o frontend e use `Primeiro acesso` para criar o primeiro ADMIN.

## Homologação final

- O checklist oficial está em `docs/homologacao-final.md`.
- A garantia técnica de qualidade está em `docs/garantia-qualidade.md`.
- O sistema só deve ser considerado finalizado após todos os fluxos de aceite serem executados na Railway sem erro bloqueante.

## Roteiro operacional pós-migração

1. Criar o primeiro ADMIN no frontend.
2. Cadastrar atletas com nome, e-mail, perfil e posição; se a senha ficar vazia, o atleta recebe o link `POKA PRÁTIKA: ATIVE SEU CADASTRO`.
3. Criar e abrir a temporada 2026.
4. Colar a tabela atual do Excel em `config. > Importar tabela atual do Excel`, usando `email` sempre que possível.
5. Revisar linhas ignoradas na importação e corrigir nomes/e-mails antes de importar novamente.
6. Conferir classificação geral, artilharia, assistência, assiduidade e cartões.
7. A partir da primeira rodada no sistema, criar súmula pela busca de atletas, ordenar substituições por arrastar e soltar, submeter, revisar e confirmar.
8. Se uma súmula não confirmada foi aberta por engano, cancelar pela própria aba de súmulas para não impactar a temporada.
9. Se houver erro de gol, assistência, cartão ou placar depois de confirmar, usar correção auditada informando o motivo; o histórico fica visível no detalhe da súmula.
10. Marcar suspensões cumpridas na aba de temporada selecionando a partida confirmada em que o atleta ficou suspenso.

## Escopo inicial implementado

- Perfis `ADMIN`, `COORDENADOR` e `ATLETA`.
- Login por e-mail e senha, com ativação de cadastro por link enviado via Microsoft Graph.
- Coordenador cadastra atletas, controla mensalidades e configura pontuações; criação de admin/coordenador fica restrita ao ADMIN.
- Usuários/atletas com e-mail, senha criptografada, avatar e posição oficial: `GO`, `ZG`, `LD`, `LE`, `MD`, `MC`, `MA` ou `AT`.
- Posição cadastral do atleta é separada do papel operacional da súmula: na partida o jogador continua sendo escalado como `GOLEIRO`, `LINHA` ou `PRESENTE_SEM_JOGAR`.
- Temporadas com abertura, encerramento e classificação.
- Gestão de temporadas na interface: criar, iniciar e encerrar pelo painel `config.`.
- Súmulas com placar, árbitro, times, jogadores, eventos, cronômetro e trocas.
- Súmula com início oficial, cancelamento seguro antes da confirmação, submissão, confirmação e histórico de correções.
- Botão `Jogo iniciado` grava no PostgreSQL o instante real de início (`TIMESTAMPTZ`) e a interface exibe o horário de Brasília.
- Tempo operacional da partida respeita o aluguel fixo da quadra: começa quando o jogo for iniciado e sempre encerra às 21:00; se iniciar 20:04, o roteiro usa 56 minutos úteis.
- Rascunho operacional da súmula tem autosave no banco para placar, eventos e estado de cronômetro antes da confirmação, evitando perda se o celular desligar.
- Correção auditada de súmula confirmada para erros de gol, assistência, cartão ou placar, com motivo obrigatório.
- Criação de súmula com busca de atleta por nome/e-mail, inclusão rápida em cada time e sequência de substituição arrastável.
- Criação de súmula com lista de presença e balanceamento automático por posições, distribuindo goleiros, defensores/laterais, meias e atacantes entre os times da forma mais equilibrada possível.
- A tela `Nova súmula` cria imediatamente um rascunho no PostgreSQL e autosalva montagem de presentes, times, banco e sequência antes mesmo do coordenador fechar a modal.
- Súmulas existentes em `DRAFT`, `RUNNING` ou `SUBMITTED` podem ter árbitro, data, times e escalação reabertos, editados e salvos, recalculando o roteiro de trocas.
- O backend permite editar a escalação enquanto a súmula não está confirmada/cancelada e bloqueia `Jogo iniciado` se os times não tiverem exatamente 1 goleiro e pelo menos 6 jogadores de linha cada.
- O backend bloqueia submissão/confirmação de súmula sem início oficial registrado por `Jogo iniciado`, impedindo pontuação de rascunho que não entrou em operação.
- No lançamento de eventos, o time é derivado automaticamente do atleta escalado e o atleta relacionado é filtrado para o mesmo time, reduzindo erro operacional no celular.
- A baixa de suspensão exige partida confirmada, posterior ao jogo que gerou a punição e da mesma temporada quando aplicável.
- Atletas autenticados recebem lista pública reduzida de usuários ativos; dados operacionais completos de usuários ficam restritos a ADMIN/COORDENADOR.
- E-mails de usuários são normalizados em minúsculas e protegidos por índice case-insensitive na migração `08_email_case_insensitive_unico.sql`.
- Eventos oficiais de súmula incluem `GOL_CONTRA` também no schema SQL base e na migração incremental `07_eventos_gol_contra.sql` para bancos já existentes.
- Cancelamento de súmula usa confirmação inline na interface, evitando diálogo nativo do navegador e reduzindo risco de toque acidental no celular.
- Importação do saldo atual da tabela do Excel para continuar a temporada 2026 sem perder histórico.
- Gestão administrativa completa de usuários: edição de nome/e-mail/papel/posição/status, proteção contra remoção do último ADMIN ativo, redefinição de senha pelo ADMIN e reenvio de convite de ativação.
- Mensalidades com geração mensal em lote para atletas ativos, preservando pagamentos já quitados, KPIs financeiros e exportação CSV.
- Configuração self-service das categorias de premiação pelo ADMIN, com alteração de rótulos e controle de quais categorias entram na votação.
- Exportação CSV da classificação geral e das mensalidades para conferência externa sem depender de manipulação manual no sistema.
- Classificação compatível com a planilha real: pontos, jogos, vitórias, empates, derrotas, presença sem jogar, mensalidade, gols da equipe, aproveitamento e médias.
- Rankings de artilharia, assistência, assiduidade e cartões, incluindo gol contra e pontos ponderados de cartões.
- Pontuação configurável pelo ADMIN.
- ADMIN edita perfil, posição e status ativo/inativo de usuários pela interface.
- Mensalidades com data de vencimento e ponto por pagamento antecipado dentro da temporada.
- Rankings de pontos, gols, assistências e presença.
- Perfis de atletas com carreira acumulada por várias temporadas.
- Histórico de títulos, prêmios e badges por temporada.
- Pódio visual, cards compactos, estados vazios, modais roláveis e identidade visual própria para uso simples no celular.
- Votação sigilosa para premiações encerrada a temporada.
- Seleção do ano é votação estruturada com 7 escolhas por atleta: 1 goleiro (`GO`) e 6 jogadores de linha.
- Cartões amarelo, vermelho e azul.
- Suspensão automática por cartão vermelho ou 3 amarelos acumulados.
- Baixa operacional de suspensão cumprida a partir de partida confirmada.
