# PROJECT_CONTEXT — POKA PRÁTIKA

Data: 2026-07-22

## Estado atual

Foi criada a base full-stack do sistema POKA PRÁTIKA, seguindo o padrão TOIT/Railway:

- Repositório único com diretórios separados `frontend` e `backend`.
- Backend Node.js/TypeScript com Express e PostgreSQL via `pg`, sem ORM.
- Frontend React/Vite/TypeScript/Tailwind, mobile-first e interface compacta.
- Identidade visual original criada em `frontend/src/assets/poka-pratika-logo.svg`, com tom cômico de futebol amador/perna de pau e referência a Balneário Camboriú/SC.
- Migrações SQL manuais em `migrations/01_core_schema.sql`, `migrations/02_pagamentos_vencimento_pontuacao.sql`, `migrations/03_saldo_inicial_temporada_excel.sql` e `migrations/04_posicoes_oficiais_atletas.sql`.
- Sem criação de `.env` e sem hardcode de credenciais/URLs.
- Backend valida obrigatoriamente `NODE_ENV=production` e `PORT=8080` no startup Railway.
- CSS customizado foi mantido apenas como complemento ao Tailwind para ajustes finos de densidade visual e responsividade.
- Migrações `01`, `02` e `03` foram informadas como executadas corretamente no PostgreSQL Railway; a migração `04` deve ser executada para bancos já existentes que ainda tenham `LINHA`/`GOLEIRO` em `users.position`.

## Funcionalidades implementadas

### Banco

- Usuários com perfis `ADMIN`, `COORDENADOR`, `ATLETA`.
- Usuários/atletas com posição cadastral oficial em `users.position`: `GO`, `ZG`, `LD`, `LE`, `MD`, `MC`, `MA` ou `AT`.
- A posição cadastral do atleta é independente do papel operacional da súmula; `match_players.role_in_match` permanece com `GOLEIRO`, `LINHA` e `PRESENTE_SEM_JOGAR`.
- Temporadas com status `DRAFT`, `OPEN`, `CLOSED`.
- Súmulas, jogadores da súmula, eventos, pagamentos, pontuação, premiações, votação, badges e suspensões.
- Saldos iniciais importados da tabela atual do Excel em `season_standing_adjustments`, somados às novas súmulas confirmadas.
- `season_standings` separa `games_played` (jogos efetivamente jogados) de `presences` (compareceu, mas não jogou), conforme a planilha real da temporada 2026.
- Métricas da classificação geral incluem gols da equipe pró/contra/saldo, aproveitamento por atleta, médias de gols e cartões ponderados.
- View `season_standings` para pontos corridos/rankings.
- Índices para temporadas abertas, súmulas, eventos, pagamentos, votos e suspensões.

### Backend

- Autenticação JWT e senha com bcrypt.
- Login oficial por e-mail e senha.
- Bootstrap seguro do primeiro admin quando o banco ainda não tem usuários.
- Cadastro de usuários por ADMIN/COORDENADOR pode ser feito sem senha inicial; nesse caso o sistema gera token seguro e envia e-mail de ativação pelo Microsoft Graph.
- E-mail de ativação usa o assunto `POKA PRÁTIKA: ATIVE SEU CADASTRO`; recuperação usa `POKA PRÁTIKA: ALTERE SUA SENHA`.
- CRUD base de usuários pelo ADMIN; COORDENADOR pode cadastrar atletas, mas não cria ADMIN/COORDENADOR.
- Configuração de pontuação pelo ADMIN e COORDENADOR.
- Temporadas: criar, iniciar, encerrar, ranking e classificação.
- Encerramento de temporada gera prêmios/badges automáticos de ranking para alimentar a carreira histórica dos atletas.
- Endpoint de carreira do atleta consolida estatísticas, temporadas, títulos, badges e suspensões.
- Súmulas: criar, iniciar, submeter, confirmar, registrar eventos e cálculo de trocas.
- Súmulas não confirmadas podem ser canceladas por ADMIN/COORDENADOR sem pontuar a temporada.
- Detalhe da súmula retorna o histórico de correções auditadas com antes/depois, motivo, responsável e data.
- Súmulas validam consistência antes de pontuar: só confirmam após submissão, eventos precisam ser de atletas escalados e gols lançados precisam bater com o placar por time.
- Súmulas confirmadas podem ser corrigidas por ADMIN/COORDENADOR através de correção auditada com motivo obrigatório, gravando antes/depois em `match_corrections`.
- Eventos oficiais incluem `GOL_CONTRA`, além de gol, assistência e cartões amarelo/vermelho/azul.
- Importação de saldo inicial da tabela do Excel por temporada, para iniciar a continuidade da temporada 2026 exatamente na classificação atual.
- Pagamentos: controle de mensalidades por ADMIN/COORDENADOR e visão própria para atleta.
- Mensalidades possuem vencimento; pagamento registrado antes do vencimento gera 1 ponto na temporada vinculada.
- Votação de premiações com resultado restrito ao ADMIN.
- Consolidação de vencedores votados pelo ADMIN grava prêmios no histórico e badges dos atletas.
- Suspensões automáticas por cartão vermelho ou 3 amarelos confirmados na temporada.
- Integração de recuperação de senha preparada para Microsoft Graph.

### Frontend

- Login, primeiro acesso e recuperação de senha.
- Login e header com logo/microcopy do POKA PRÁTIKA de Balneário Camboriú/SC.
- Dashboard de temporada, pontos corridos, rankings e suspensões.
- Dashboard com pódio visual, KPIs compactos, rankings e estados vazios amigáveis.
- Dashboard exibe classificação alinhada à planilha real: pontos, jogos, vitórias, empates, derrotas, presença sem jogar, mensalidade, gols da equipe, saldo e aproveitamento.
- Rankings contemplam artilharia com gols contra/saldo/média, assistência com média, assiduidade com jogos+presença e cartões por pontos/total/média.
- Aba de perfis com carreira acumulada de cada atleta/usuário em múltiplas temporadas.
- Lista de súmulas, criação com atletas por time/presença, ordem de sorteio, sequência, banco, cronômetro digital e fechamento por eventos.
- Criação de súmula operacional com busca por nome/e-mail a partir de 3 caracteres, inclusão rápida no Time A, Time B ou presente sem jogar, e ordenação drag-and-drop da sequência de substituições.
- Súmulas da aba são filtradas pela temporada selecionada.
- Operação de jogo agora expõe início oficial da súmula, cancelamento seguro de súmulas não confirmadas, submissão, confirmação e correção auditada.
- Histórico de correções auditadas aparece no detalhe da súmula, evitando ajuste invisível de placar/eventos.
- Exibição automática de roteiro de trocas conforme súmula tradicional.
- Gestão de mensalidade com mês de referência, vencimento, data de pagamento, status e indicação de ponto antecipado.
- Votação de premiações sem `Vera Verão`, com apuração ADMIN e consolidação de winners/badges.
- Configurações de usuários e pontuação para ADMIN/COORDENADOR, com criação de perfis privilegiados restrita ao ADMIN.
- Painel administrativo expõe criação, início e encerramento de temporadas, eliminando dependência de chamada manual de endpoint.
- ADMIN pode editar perfil, posição oficial e status ativo/inativo de usuários; COORDENADOR mantém criação operacional de atletas sem elevação indevida de privilégio.
- Suspensões abertas podem ser marcadas como cumpridas na temporada a partir de uma partida confirmada.
- Painel administrativo permite colar a tabela atual do Excel com cabeçalho e importar o saldo inicial da temporada, retornando linhas importadas e linhas ignoradas para revisão.
- O formulário antigo de criação de súmula foi removido; existe apenas o fluxo operacional com busca e drag-and-drop.
- UI refinada com logo original, pódios, cards, microcopy cômica e layout compacto/mobile-first.

## Regras importantes consolidadas

- Não usar ORM.
- Não criar `.env`.
- Backend deve subir somente com `NODE_ENV=production` e `PORT=8080`.
- Não criar dados mockados.
- Toda alteração de banco deve ser SQL manual em `/migrations`.
- Para bancos já existentes com usuários cadastrados em `LINHA`/`GOLEIRO`, executar `migrations/04_posicoes_oficiais_atletas.sql`; a migração converte `GOLEIRO` para `GO`, `LINHA` para `MC` e preserva posições oficiais já válidas.
- Para continuidade da temporada 2026, executar também `migrations/03_saldo_inicial_temporada_excel.sql` antes de importar a tabela do Excel.
- `Vera Verão` foi removido.
- Cartões oficiais: amarelo, vermelho e azul.
- Controle de cartões usa pontos ponderados no ranking: amarelo = 1, azul = 2, vermelho = 3.
- Vermelho suspende 1 jogo.
- 3 amarelos acumulados em jogos confirmados da temporada suspendem 1 jogo, inclusive 1 amarelo em um jogo + 2 amarelos no jogo seguinte.
- O histórico oficial é acumulado por várias temporadas e forma a carreira do atleta: estatísticas, títulos, prêmios e badges permanecem vinculados à temporada de origem.
- Mensalidade pontua apenas quando paga antes do vencimento (`paid_at::date < due_date`) e vinculada a uma temporada.
- Awards/badges definidos: rankings automáticos de temporada, votação sigilosa e badges históricos por atleta.
- A tabela da temporada é calculada por: saldo inicial importado do Excel + súmulas confirmadas/corrigidas + mensalidades pagas antes do vencimento.
- Pontuação da presença: quem joga soma o ponto de participação via `games_played`; quem comparece e não joga soma o mesmo ponto através de `presences`.

## Validações executadas

- `backend`: `npm run build` concluído com sucesso.
- `frontend`: `npm run build` concluído com sucesso.
- `backend`: `npm audit --audit-level=moderate` sem vulnerabilidades.
- `frontend`: `npm audit --audit-level=moderate` sem vulnerabilidades.
- Checagem do workspace sem erros ativos.

## Próximo passo técnico recomendado

1. Subir backend e frontend na Railway com root directories corretos.
2. Conferir variáveis Railway: backend com `DATABASE_URL`, `NODE_ENV=production`, `PORT=8080`, `JWT_SECRET`, `ALLOWED_ORIGINS`, `FRONTEND_URL` e credenciais Microsoft Graph; frontend com `VITE_API_URL`.
3. Usar a tela de primeiro acesso para criar o primeiro ADMIN.
4. Cadastrar atletas reais por e-mail e deixar o sistema enviar o convite de ativação via Microsoft Graph.
5. Criar/abrir a temporada 2026 pelo painel `config.`.
6. Importar a tabela atual do Excel no painel administrativo usando preferencialmente a coluna `email` para casar cada linha com o usuário certo.
7. Conferir classificação, rankings, suspensões e cartões; depois usar apenas as novas súmulas confirmadas/corrigidas para continuidade da temporada.
