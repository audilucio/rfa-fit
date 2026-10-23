# Etapa 2 — RFA.FIT Indique & Ganhe

Verificação em 23/10/2026. Campanha permanece desativada; nenhuma compra real, mensagem de WhatsApp ou entrega de e-mail foi simulada como resultado de produção.

## Infraestrutura concluída

| Item                   | Situação                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub                 | Autenticação existente `audilucio` validada; repositório `audilucio/rfa-fit`, branch `main`.                                                                                                                                               |
| Vercel                 | Autenticação existente validada. Configuração restrita ao projeto `rfa-fit-loja`; outros projetos não foram alterados.                                                                                                                     |
| PostgreSQL produção    | Neon `rfa-fit-indicacoes`, projeto `broad-haze-49504623`, recurso `store_aybsy1cx30sVIkP6`, plano Free, região `iad1`. Exclusivo da RFA.FIT; conectado somente ao ambiente production da loja.                                             |
| PostgreSQL homologação | Neon `rfa-fit-indicacoes-preview`, projeto `orange-glade-30690745`, recurso `store_EvvDSUw7mzfemHUV`, plano Free, região `iad1`. Exclusivo da RFA.FIT; conectado somente a preview/development.                                            |
| Migração               | `migrations/001_referrals.sql` aplicada nos dois bancos após conferir sua identidade e ausência de tabelas de outros sistemas. Oito tabelas conferidas; nenhum dado real apagado.                                                          |
| TLS                    | Certificado autorizado e TLS 1.3 conferidos nos dois bancos. Runtime e migração compartilham `lib/db-config.js`; URLs não podem substituir a verificação de certificado. Conexão sem TLS só é permitida em loopback explícito para testes. |
| Administrador          | `ADMIN_EMAILS` configurado com o e-mail do titular autenticado da conta Vercel. O endereço não é publicado neste documento. Acesso continua dependente de confirmação por e-mail e da campanha habilitada.                                 |
| Custos                 | Bancos criados pelo plano `free_v3`, sem método de pagamento exigido e sem adesão a plano pago. Não foram modificados plano ou recursos de outros sistemas.                                                                                |

## Variáveis reais do código

| Variável            | Production                                                 | Preview/development                                                                                                      |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`      | Configurada pela integração, banco exclusivo de produção   | Configurada pela integração, banco exclusivo de homologação                                                              |
| `IDENTITY_SECRET`   | Gerada aleatoriamente; armazenada como sensitive na Vercel | Chave aleatória própria; criptografada, diferente de produção                                                            |
| `APP_ORIGIN`        | `https://rfa-fit-loja.vercel.app`                          | Mesmo valor enquanto desativada; antes de testar uma implantação preview habilitada, ajustar para sua origem HTTPS exata |
| `ADMIN_EMAILS`      | Titular da conta Vercel                                    | Titular da conta Vercel                                                                                                  |
| `REFERRALS_ENABLED` | `false`                                                    | `false`                                                                                                                  |
| `RESEND_API_KEY`    | Ausente: depende do Resend                                 | Ausente: depende do Resend                                                                                               |
| `EMAIL_FROM`        | Ausente: depende de domínio verificável                    | Ausente: depende de domínio verificável                                                                                  |
| `PGSSL`             | Não definida; TLS com validação obrigatória                | Não definida; TLS com validação obrigatória                                                                              |

A integração Neon acrescenta outras variáveis próprias, incluindo `DATABASE_URL_UNPOOLED` e `NEON_PROJECT_ID`. Não foram inventadas novas variáveis obrigatórias da campanha. A conexão direta foi usada para migração; a conexão com pooler foi testada para operação. Nenhuma credencial entrou no Git, logs, documentação pública ou build estático. O arquivo local ignorado `.env.preview.local` contém somente configurações de homologação com permissão 0600.

## Resend: dependência externa restante

Não foi encontrada chave Resend nas variáveis do processo, configurações locais verificadas, secrets do repositório, variáveis compartilhadas da equipe ou ambientes RFA.FIT. A instalação Resend não está presente na conta Vercel. A loja possui somente o domínio `rfa-fit-loja.vercel.app`; a conta/equipe não apresentou domínio próprio gerenciável para verificar um remetente. Não é possível verificar DNS do domínio `vercel.app` em nome da loja.

A integração nativa [Resend/Vercel](https://resend.com/changelog/vercel-marketplace-integration) permite configuração automática, mas exige um domínio próprio elegível. Não foi comprado domínio nem criada conta com dados fictícios.

Pendência indispensável: disponibilizar um domínio próprio para o remetente e conectar/autenticar o Resend (pela [integração Vercel](https://vercel.com/marketplace/resend) quando elegível, ou [painel Resend](https://resend.com/domains) e DNS do domínio existente). Depois de verificar o domínio, definir os dois nomes já existentes `RESEND_API_KEY` e `EMAIL_FROM`. Não usar remetente de teste para uma campanha pública. Não compartilhar a chave no chat ou em arquivos versionados.

Com essa dependência atendida, ainda é necessário receber e abrir e-mails reais em endereços controlados, validar o token de uso único e autenticação administrativa em HTTPS e testar o pedido com o atendimento. Somente após essa validação e a conferência operacional da loja, configurar `REFERRALS_ENABLED=true` e reimplantar. Não há chave falsa configurada na Vercel, endpoint de bypass nem ativação pública parcial.

## Testes executados

- Suíte automatizada: 0/1/2/3/6/9/10 indicações; 3/6/9 = 10/20/30%; limite de 30%; contatos e aliases duplicados, autoconvite, códigos inválidos, tokens de uso único e expiração, resgate único e concorrente, cupom individual, suspensão por fraude, exclusão, reserva e recuperação.
- PostgreSQL local dedicado: API, origem/CSRF, sessão, acesso administrativo negado a participante comum, concorrência real e valores do pedido. O transporte de e-mail é simulado apenas nesse teste local, sem alegação de entrega externa.
- Neon real de homologação: conexão por pooler e certificado conferidos; cadastro/confirmação/aprovação pela camada de regras, níveis 0 a 10, resgates em 3/6/9, reserva/cancelamento/confirmacão, uso único e mensagem calculada. Toda a transação de teste foi revertida; contagens de todas as tabelas conferidas iguais às anteriores. Nenhum participante de teste foi inserido no banco de produção.
- Navegador local: 360/390/768/1440 px, loja antiga e campanha desativada; fluxo ativo com API e PostgreSQL reais em 390 px, link/token/cookie, painel, cupom, sacola, link WhatsApp idêntico à mensagem do servidor, cancelamento, aprovação administrativa e confirmação de venda sintética. Cupom consumido uma única vez.
- Loja pública: verificação separada, com campanha desativada, em celular e desktop, catálogo com cinco biquínis a R$ 99,90, sacola e checkout legado; cadastro/ações do programa bloqueados e arquivos internos inacessíveis. Nenhuma mensagem enviada.
- Sintaxe, build estático, auditoria de dependências e `git diff --check`.

Exemplo conferido para dois biquínis: subtotal R$ 199,80; 30% = R$ 59,94; total R$ 139,86. Uma unidade a 30%: R$ 69,93. Preço riscado não participa do cálculo; frete é confirmado separadamente.

## Links e operação

- [Loja](https://rfa-fit-loja.vercel.app/): funcionando.
- [Campanha](https://rfa-fit-loja.vercel.app/indicacoes.html): página publicada, participação desativada.
- [Painel administrativo](https://rfa-fit-loja.vercel.app/admin-indicacoes.html): página publicada, operações desativadas enquanto falta e-mail validado.
- [Regulamento](https://rfa-fit-loja.vercel.app/regulamento.html) e [privacidade](https://rfa-fit-loja.vercel.app/privacidade.html): publicados.
- [Ambiente Vercel da loja](https://vercel.com/audiluciofisico-8068s-projects/rfa-fit-loja/settings/environment-variables): requer autenticação do titular.

Backups dos arquivos preexistentes alterados nesta etapa ficam em `.vercel/backup-stage2/`, ignorado pelo Git e excluído da publicação estática. Dados e documentos dos outros projetos não foram alterados. Os resultados de push/deploy são verificados externamente após a publicação; uma implantação concluída não significa campanha ativa nem comprova entrega de e-mail.
