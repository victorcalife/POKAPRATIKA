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

## Primeira implantação

1. Execute `migrations/01_core_schema.sql`, `migrations/02_pagamentos_vencimento_pontuacao.sql`, `migrations/03_saldo_inicial_temporada_excel.sql` e `migrations/04_posicoes_oficiais_atletas.sql` no PostgreSQL Railway pelo TablePlus.
2. Configure o serviço Railway do backend apontando para `backend/`.
3. Configure o serviço Railway do frontend apontando para `frontend/`.
4. Defina todas as variáveis nos respectivos serviços.
5. Acesse o frontend e use `Primeiro acesso` para criar o primeiro ADMIN.

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
- Correção auditada de súmula confirmada para erros de gol, assistência, cartão ou placar, com motivo obrigatório.
- Criação de súmula com busca de atleta por nome/e-mail, inclusão rápida em cada time e sequência de substituição arrastável.
- Importação do saldo atual da tabela do Excel para continuar a temporada 2026 sem perder histórico.
- Classificação compatível com a planilha real: pontos, jogos, vitórias, empates, derrotas, presença sem jogar, mensalidade, gols da equipe, aproveitamento e médias.
- Rankings de artilharia, assistência, assiduidade e cartões, incluindo gol contra e pontos ponderados de cartões.
- Pontuação configurável pelo ADMIN.
- ADMIN edita perfil, posição e status ativo/inativo de usuários pela interface.
- Mensalidades com data de vencimento e ponto por pagamento antecipado dentro da temporada.
- Rankings de pontos, gols, assistências e presença.
- Perfis de atletas com carreira acumulada por várias temporadas.
- Histórico de títulos, prêmios e badges por temporada.
- Pódio visual, cards compactos, estados vazios e identidade visual própria para uso simples no celular.
- Votação sigilosa para premiações encerrada a temporada.
- Cartões amarelo, vermelho e azul.
- Suspensão automática por cartão vermelho ou 3 amarelos acumulados.
- Baixa operacional de suspensão cumprida a partir de partida confirmada.
