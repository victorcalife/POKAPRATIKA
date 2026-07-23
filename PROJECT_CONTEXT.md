# PROJECT_CONTEXT — POKA PRÁTIKA

Data: 2026-07-23

## Estado atual

Foi criada a base full-stack do sistema POKA PRÁTIKA, seguindo o padrão TOIT/Railway:

- Repositório único com diretórios separados `frontend` e `backend`.
- Backend Node.js/TypeScript com Express e PostgreSQL via `pg`, sem ORM.
- Frontend React/Vite/TypeScript/Tailwind, mobile-first e interface compacta.
- Frontend em produção usa Nginx com `docker-entrypoint.sh` para gerar `/runtime-config.js` a partir de `VITE_API_URL` no runtime Railway, evitando tela branca quando a variável existe no serviço mas não entrou no build Vite.
- Identidade visual original criada em `frontend/src/assets/poka-pratika-logo.svg`, com tom cômico de futebol amador/perna de pau, referência a Balneário Camboriú/SC e paleta azul média aplicada ao escudo e aos elementos de destaque do sistema.
- Migrações SQL manuais em `migrations/01_core_schema.sql`, `migrations/02_pagamentos_vencimento_pontuacao.sql`, `migrations/03_saldo_inicial_temporada_excel.sql`, `migrations/04_posicoes_oficiais_atletas.sql`, `migrations/05_sumula_rascunho_operacional_autosave.sql`, `migrations/06_selecao_do_ano_7_votos.sql`, `migrations/07_eventos_gol_contra.sql`, `migrations/08_email_case_insensitive_unico.sql`, `migrations/09_reparo_schema_sumula_operacional.sql` e `migrations/10_correcoes_auditadas_sumula.sql`.
- Sem criação de `.env` e sem hardcode de credenciais/URLs.
- Backend valida obrigatoriamente `NODE_ENV=production`, `PORT=8080`, `DATABASE_URL`, `JWT_SECRET`, `ALLOWED_ORIGINS` e `FRONTEND_URL` no startup Railway.
- Backend expõe `/health` e `/ready`; `/ready` consulta o PostgreSQL com SQL nativo para homologar conexão real do serviço.
- CSS customizado foi mantido apenas como complemento ao Tailwind para ajustes finos de densidade visual e responsividade; modais longas e telas pequenas agora priorizam rolagem segura para não cortar formulários operacionais.
- Homologação final documentada em `docs/homologacao-final.md`; garantia técnica consolidada em `docs/garantia-qualidade.md`; troubleshooting Railway em `docs/troubleshooting-railway.md`; o sistema só deve ser considerado finalizado após execução dos fluxos de aceite na Railway.

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
- Gestão administrativa de usuários foi reforçada com edição de nome/e-mail/papel/posição/status, proteção contra remoção do último ADMIN ativo, redefinição de senha pelo ADMIN e reenvio de convite de ativação por Microsoft Graph.
- Configuração de pontuação pelo ADMIN e COORDENADOR.
- Configuração de categorias de premiação pelo ADMIN em `/settings/awards`, permitindo alterar rótulos e ligar/desligar categorias votáveis sem mudar código.
- Temporadas: criar, iniciar, encerrar, ranking e classificação.
- Encerramento de temporada gera prêmios/badges automáticos de ranking para alimentar a carreira histórica dos atletas.
- Endpoint de carreira do atleta consolida estatísticas, temporadas, títulos, badges e suspensões.
- Súmulas: criar, iniciar, submeter, confirmar, registrar eventos e cálculo de trocas.
- Detalhe de súmula `DRAFT` vazia foi endurecido para abrir sem atletas/eventos, sem depender de `scheduled_start/scheduled_end` e sem quebrar caso `match_corrections` ainda não exista; bancos existentes devem executar a migration `09` para autosave operacional e a migration `10` para histórico auditável de correções.
- Súmulas existentes em `DRAFT`, `RUNNING` ou `SUBMITTED` podem ter árbitro, data, times e escalação reabertos e editados pela interface, persistindo em `/matches/:id/lineup` e recalculando roteiro de trocas após salvar.
- Início oficial da partida pelo botão `Jogo iniciado`, persistindo `started_at` com o instante real do clique no PostgreSQL e exibindo em horário de Brasília.
- Tempo de jogo e cadência de substituições respeitam a janela fixa da quadra: aluguel das 20:00 às 21:00, mas se o jogo iniciar atrasado o tempo útil passa a ser apenas o intervalo entre `started_at` e 21:00.
- Rascunho operacional da súmula persiste `draft_team_a_score`, `draft_team_b_score`, `draft_events`, `draft_clock_seconds`, `draft_clock_running`, `draft_saved_by` e `draft_saved_at`, evitando perda de placar/eventos se o dispositivo desligar antes da submissão.
- Súmulas não confirmadas podem ser canceladas por ADMIN/COORDENADOR sem pontuar a temporada.
- Detalhe da súmula retorna o histórico de correções auditadas com antes/depois, motivo, responsável e data.
- Súmulas validam consistência antes de pontuar: só confirmam após submissão, eventos precisam ser de atletas escalados e gols lançados precisam bater com o placar por time.
- Súmulas não podem ser submetidas ou confirmadas sem `started_at`; isso bloqueia bypass de pontuação sem o botão `Jogo iniciado`.
- Eventos relacionados são validados para impedir vínculo com atleta fora da súmula, presente sem jogar, atleta do outro time ou o próprio autor do evento.
- Frontend do editor de eventos deriva o time pelo atleta selecionado e filtra atletas relacionados para o mesmo time, evitando seleção visual contraditória.
- Súmulas confirmadas podem ser corrigidas por ADMIN/COORDENADOR através de correção auditada com motivo obrigatório, gravando antes/depois em `match_corrections`, criada pela migration `10_correcoes_auditadas_sumula.sql`.
- Eventos oficiais incluem `GOL_CONTRA`, além de gol, assistência e cartões amarelo/vermelho/azul.
- `GOL_CONTRA` foi alinhado também no SQL base e na migração incremental `07_eventos_gol_contra.sql`, evitando falha em bancos novos ou já existentes.
- Importação de saldo inicial da tabela do Excel por temporada, para iniciar a continuidade da temporada 2026 exatamente na classificação atual.
- Pagamentos: controle de mensalidades por ADMIN/COORDENADOR e visão própria para atleta.
- Mensalidades possuem vencimento; pagamento registrado antes do vencimento gera 1 ponto na temporada vinculada.
- Mensalidades agora têm resumo financeiro por temporada, geração mensal em lote para todos os atletas ativos, preservação de pagamentos já quitados e observações operacionais.
- Votação de premiações com resultado restrito ao ADMIN.
- Seleção do ano possui votação estruturada com 7 votos por atleta: 1 goleiro (`GO`) e 6 jogadores de linha, persistidos em `award_votes.vote_slot`.
- Consolidação de vencedores votados pelo ADMIN grava prêmios no histórico e badges dos atletas.
- Suspensões automáticas por cartão vermelho ou 3 amarelos confirmados na temporada.
- Baixa de suspensão exige partida confirmada, posterior ao jogo gatilho e vinculada à mesma temporada quando houver `season_id`.
- Lista de usuários para atleta autenticado é reduzida a dados públicos de usuários ativos; e-mail/status completos ficam restritos a ADMIN/COORDENADOR.
- E-mails de usuários são normalizados para minúsculas, recebem índice único case-insensitive na migração `08` e conflitos de duplicidade retornam `409` sem vazar detalhes internos.
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
- Criação de súmula operacional permite montar uma lista de presença e acionar o balanceamento automático por posições, distribuindo `GO`, defesa/laterais, meio-campo e ataque entre Time A e Time B com diferença mínima por grupo.
- A tela `Nova súmula` agora cria imediatamente uma súmula `DRAFT` no banco e autosalva a escalação via `/matches/:id/lineup`, protegendo a montagem de presentes/times/banco/sequência antes do fechamento da modal.
- O detalhe da súmula permite reabrir e editar escalação existente em `DRAFT`, `RUNNING` e `SUBMITTED`, incluindo árbitro, data, times, banco, goleiro/linha, presentes, rebalanceamento e salvamento real no backend.
- Backend valida edição de escalação contra atletas duplicados/inativos e contra eventos já lançados, além de bloquear `Jogo iniciado` sem exatamente 1 goleiro e pelo menos 6 linhas em cada time.
- O balanceador define o primeiro `GO` de cada time como `GOLEIRO`, transforma excedentes em `LINHA` para evitar múltiplos goleiros fixos no mesmo time e marca automaticamente como banco os jogadores de linha acima dos 6 primeiros de cada equipe.
- Cronômetro oficial é derivado do `started_at` persistido, não do estado local do celular; ao reabrir a súmula, o tempo continua como se o dispositivo nunca tivesse desligado.
- Editor de placar/eventos usa autosave no endpoint protegido `/matches/:id/draft` enquanto a súmula não está confirmada.
- Súmulas da aba são filtradas pela temporada selecionada.
- Operação de jogo agora expõe início oficial da súmula, cancelamento seguro de súmulas não confirmadas, submissão, confirmação e correção auditada.
- Cancelamento de súmula usa confirmação inline na interface, sem `window.confirm`, para UX mais consistente em celular.
- Histórico de correções auditadas aparece no detalhe da súmula, evitando ajuste invisível de placar/eventos.
- Exibição automática de roteiro de trocas conforme súmula tradicional.
- Gestão de mensalidade com mês de referência, vencimento, data de pagamento, status e indicação de ponto antecipado.
- Aba de mensalidades exibe KPIs financeiros, gera cobranças em lote, salva lançamentos individuais e exporta CSV.
- Votação de premiações sem `Vera Verão`, com apuração ADMIN e consolidação de winners/badges; `SELECAO_ANO` exibe formulário especial com 1 goleiro + 6 linhas.
- Configurações de usuários e pontuação para ADMIN/COORDENADOR, com criação de perfis privilegiados restrita ao ADMIN.
- ADMIN consegue editar cadastro completo de usuários, redefinir senha e reenviar convite de ativação pela interface.
- ADMIN configura categorias de premiação na aba `premios`, controlando nomes e votação habilitada.
- Classificação geral e mensalidades têm exportação CSV operacional.
- Painel administrativo expõe criação, início e encerramento de temporadas, eliminando dependência de chamada manual de endpoint.
- ADMIN pode editar perfil, posição oficial e status ativo/inativo de usuários; COORDENADOR mantém criação operacional de atletas sem elevação indevida de privilégio.
- Suspensões abertas podem ser marcadas como cumpridas na temporada a partir de uma partida confirmada.
- Painel administrativo permite colar a tabela atual do Excel com cabeçalho e importar o saldo inicial da temporada, retornando linhas importadas e linhas ignoradas para revisão.
- O formulário antigo de criação de súmula foi removido; existe apenas o fluxo operacional com busca e drag-and-drop.
- UI refinada com logo original azul, palavra `PRÁTIKA` abaixo de `POKA` no símbolo, pódios, cards, microcopy cômica, modais roláveis, listas suspensas com opções em fonte preta e layout compacto/mobile-first com line-height global reduzido em 10%.

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
- `SELECAO_ANO`: consolidação gera placement 1 para goleiro e placements 2 a 7 para os seis jogadores de linha mais votados.
- A tabela da temporada é calculada por: saldo inicial importado do Excel + súmulas confirmadas/corrigidas + mensalidades pagas antes do vencimento.
- Pontuação da presença: quem joga soma o ponto de participação via `games_played`; quem comparece e não joga soma o mesmo ponto através de `presences`.

## Validações executadas

- `backend`: `npm run typecheck`, `npm run build` e `npm audit --audit-level=moderate` concluídos com sucesso após hardening P1.
- `backend`: `npm run typecheck` e `npm run build` concluídos com sucesso após criação da migration `10` e blindagem do `GET /matches/:id` contra ausência temporária de `match_corrections`.
- `frontend`: `npm run typecheck`, `npm run build` e `npm audit --audit-level=moderate` concluídos com sucesso após ajustes de árbitro, responsividade e runtime config Railway.
- `backend`: `npm audit --audit-level=moderate` sem vulnerabilidades.
- `frontend`: `npm audit --audit-level=moderate` sem vulnerabilidades.
- Checagem do workspace sem erros ativos, sem `.env`, sem ORM operacional e sem `console.log`/`window.confirm`/`alert` operacional.

## Próximo passo técnico recomendado

1. Em banco novo, executar `migrations/01_core_schema.sql` e depois as migrações incrementais aplicáveis em ordem crescente.
2. Em banco já existente, executar até `migrations/10_correcoes_auditadas_sumula.sql`, garantindo também `04`, `05`, `06`, `07`, `08` e `09` se ainda não tiverem sido aplicadas.
3. Subir backend e frontend na Railway com root directories corretos.
4. Conferir variáveis Railway: backend com `DATABASE_URL`, `NODE_ENV=production`, `PORT=8080`, `JWT_SECRET`, `ALLOWED_ORIGINS`, `FRONTEND_URL` e credenciais Microsoft Graph; frontend com `VITE_API_URL`.
5. Usar a tela de primeiro acesso para criar o primeiro ADMIN.
6. Cadastrar atletas reais por e-mail e deixar o sistema enviar o convite de ativação via Microsoft Graph.
7. Criar/abrir a temporada 2026 pelo painel `config.`.
8. Importar a tabela atual do Excel no painel administrativo usando preferencialmente a coluna `email` para casar cada linha com o usuário certo.
9. Conferir classificação, rankings, suspensões e cartões; depois usar apenas as novas súmulas confirmadas/corrigidas para continuidade da temporada.
