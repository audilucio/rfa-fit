# RFA.FIT — Indique & Ganhe

O fluxo atual usa **Google Identity Services / OpenID Connect**. Não exige Resend, remetente de e-mail, SMS, domínio próprio ou client secret. Neon Free, Vercel e a loja HTML/JavaScript foram preservados. Nenhum plano pago, cartão ou faturamento foi ativado.

A campanha permanece **desativada**: ainda falta criar/autorizar o OAuth Web Client ID da RFA.FIT no console Google e validar autenticação real. A presença de código e testes locais não comprova login real nem autoriza ativação. Veja [ATIVACAO-GOOGLE.md](ATIVACAO-GOOGLE.md). O relatório da etapa 2 é histórico; sua pendência Resend foi substituída.

## Configuração existente

Produção: Neon `rfa-fit-indicacoes`, projeto `broad-haze-49504623`, conectado apenas a production do projeto Vercel `rfa-fit-loja`. Homologação: `rfa-fit-indicacoes-preview`, projeto `orange-glade-30690745`, conectado apenas a preview/development. Ambos Free e exclusivos da RFA.FIT; TLS com validação de certificado. Outros projetos não foram alterados.

Variáveis usadas pelo runtime:

| Variável            | Uso                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`      | Conexão PostgreSQL persistente com pooler e TLS                                                                              |
| `IDENTITY_SECRET`   | Chave aleatória com pelo menos 32 caracteres; HMAC de identidades, sessões e desafios. Não rotacionar sem migração planejada |
| `GOOGLE_CLIENT_ID`  | **Nova**, pública: OAuth Client ID do tipo Web, terminando em `.apps.googleusercontent.com`                                  |
| `APP_ORIGIN`        | Origem HTTPS exata, sem barra final. Produção: `https://rfa-fit-loja.vercel.app`                                             |
| `ADMIN_EMAILS`      | E-mails autorizados para bootstrap administrativo; privilégio fixado ao `sub` após primeiro login confiável                  |
| `REFERRALS_ENABLED` | `false` até autenticação real e fluxos de ponta a ponta validados                                                            |
| `PGSSL`             | Opcional, `disable` aceito apenas em loopback para testes locais                                                             |

`RESEND_API_KEY` e `EMAIL_FROM` não são lidas nem exigidas. Não há envio de confirmação por e-mail. Google Client ID não é segredo; nenhum Google Client Secret, refresh token ou chave privada Google é necessário neste fluxo de ID token.

A integração Neon também fornece variáveis próprias como `DATABASE_URL_UNPOOLED` e `NEON_PROJECT_ID`. A primeira foi usada nas migrações; a segunda protege o teste de homologação contra execução no banco errado. Credenciais não entram no Git nem no build público. `.env.preview.local` é ignorado e tem permissão 0600, contendo somente homologação.

## Única configuração externa de autenticação

No [Google Auth Platform](https://console.cloud.google.com/auth/clients), usando uma conta autorizada do responsável, criar um cliente OAuth do tipo **Web application**, exclusivo da RFA.FIT. Configurar nome, público/usuários de teste e URLs de privacidade/regulamento da loja. Cadastrar como origem JavaScript autorizada **`https://rfa-fit-loja.vercel.app`**, sem caminho nem barra final. A origem atual da Vercel é usada; o código não depende de registrar domínio nem de verificar DNS para e-mail.

O modo implementado é popup com callback JavaScript, seguido de POST JSON no mesmo domínio. Não há troca de authorization code nem redirect URI de servidor a cadastrar. Para testar Google real em localhost ou preview, adicionar suas origens exatas ao cliente correspondente e ajustar `APP_ORIGIN`. Não usar curingas nem credenciais de outro projeto. Preferir cliente separado para homologação; isso não é necessário para executar os testes sintéticos locais.

Copiar o Client ID real para `GOOGLE_CLIENT_ID` na Vercel, nos ambientes correspondentes, e reimplantar. Não criar valor fictício para preencher o campo. Não habilitar faturamento, Firebase Identity Platform, serviços de SMS ou e-mail. Qualquer autorização/publicação do aplicativo exigida pelo console deve ser feita pelo titular, sem contornar a verificação.

Esse passo ainda não foi executado: não foi encontrado Client ID RFA.FIT nem autenticação gcloud disponível. As demais variáveis já estão configuradas; a flag continua false. **Não alterar a flag só por preencher o Client ID**: antes de publicar a campanha, verificar login Google real em HTTPS, administrador correto, indicações aprovadas, resgate, valores, reserva e confirmação de venda no ambiente autorizado. Esta entrega não alega essa validação real.

## Autenticação, identidade e segurança

- `api/referral.js` só aceita POST JSON da origem exata. O navegador recebe nonce aleatório e cookie HttpOnly de desafio, por cinco minutos. O POST de login exige cookie e token CSRF iguais, a assinatura Google válida e o nonce assinado correspondente ao registro persistente. O desafio é consumido atomicamente; duas tentativas simultâneas não geram duas sessões/cadastros pelo mesmo desafio.
- `lib/google-auth.js` usa `jose` e JWKS no endereço fixo `https://www.googleapis.com/oauth2/v3/certs`, com cache/rotação e timeout. Valida RS256, assinatura, `iss`, `aud`, `azp` quando presente, `exp`, `iat`, `sub`, nonce e `email_verified === true`. Não aceita JWKS, issuer, audience ou chaves privadas enviados pelo navegador. Falhas retornam mensagem genérica sem token.
- O identificador da conta é HMAC de **`sub`**, persistido com índice único. Mudança de e-mail não cria outro participante nem reabre progressão. Histórico de identidades de contato impede reutilização de e-mails/aliases já vinculados. Não há associação automática de registro legado a uma nova conta Google apenas por e-mail igual; eventuais casos antigos exigem revisão segura pelo atendimento.
- Gmail/Googlemail com pontos e aliases `+` são deduplicados, e `+` também é agrupado conservadoramente nos outros domínios. A regra pode exigir revisão. Login Google e e-mail verificado não provam que contas distintas sejam pessoas distintas; aprovação humana continua obrigatória. Para contas com endereço externo ao Gmail/Workspace, o e-mail pode representar uma verificação histórica do Google; não é prova suficiente para privilégios administrativos.
- Bootstrap de admin exige e-mail autorizado para o qual Google seja autoridade (Gmail ou Workspace com `hd`). Depois, o slot administrativo fica vinculado ao `sub`. Outra conta não herda privilégios pela reutilização do endereço. Remover o e-mail da lista de configuração revoga o slot. O titular Vercel atualmente configurado usa Gmail.
- Sessão aleatória própria, armazenada só como HMAC no servidor; cookie host-only, HttpOnly, SameSite=Strict, Secure em HTTPS e prazo de sete dias. Logout revoga a sessão e desliga seleção automática do Google no navegador. ID tokens nunca são armazenados no localStorage, banco ou logs. Não pedimos senha Google, acesso a Gmail, contatos, agenda ou pagamentos. Nome e foto presentes no token não são persistidos.
- Google SDK é carregado só depois do aceite e da escolha “Continuar com Google”. O botão é oficial. Sem campanha/configuração válida, não é carregado. COOP e Referrer-Policy da página são compatíveis com o popup Google.
- Rate limiting persistente: 120 requisições/hora por HMAC de IP e 40 operações de desafio/login Google por hora/IP (um login normal usa duas). Há honeypot, auditoria e revisão administrativa; não há promessa de eliminar toda fraude.
- PostgreSQL: transações no mesmo cliente e advisory lock da campanha; restrições únicas contra duplicidades. `lib/db-config.js` impede que parâmetros SSL da URL substituam a validação do certificado. Desativar TLS é proibido fora de loopback.

## Regras preservadas

Primeiro cadastro fixa o indicador. Cada nova pessoa só beneficia um indicador; ninguém fornece contatos de terceiros. Clique e login sem aprovação não contam. Cadastro com Google validado, aprovado e não bloqueado/excluído conta. Autoconvite e reaproveitamento de conta/contato são recusados; quem já é participante não se torna indicação nova ao receber outro link.

3/6/9 indicações liberam 10/20/30%; contabilização limitada a nove e percentual limitado a 30%. Um único resgate por participante. Resgatar em três ou seis encerra a progressão; expiração ou cancelamento de pedido não cria outro benefício. O cupom é individual, intransferível, de uso único, válido por 30 dias e não cumulativo. Bloqueio/revogação de indicações pode suspender benefício ainda não utilizado.

Servidor valida produto ativo, variante, tamanho e quantidade inteira: 1–20 por linha, até 50 peças/30 linhas. Preços vêm de `data/products.json`: cinco biquínis a R$ 99,90, preservados. Desconto aplica-se ao preço vigente, nunca ao riscado, sobre subtotal elegível em centavos. `referralEligible:false` exclui um produto; por padrão são elegíveis os nomes iniciados por “Biquíni”. Frete fica fora do benefício. Duas unidades: R$ 199,80; desconto 30%: R$ 59,94; total R$ 139,86.

Sacola e compra imediata usam cotação e mensagem do servidor quando habilitadas. Abrir WhatsApp só cria reserva `pending`, por 30 minutos. Mesmo cupom/itens recuperam a reserva existente. Cancelamento/expiração libera reserva sem estender os 30 dias do cupom. Participante e admin podem cancelar; expiração é recuperada nas operações seguintes. Somente confirmação administrativa, após conferir pagamento e titularidade, consome definitivamente o cupom. Pedido expirado não é confirmado.

O texto do WhatsApp é editável pelo cliente: atendimento deve conferir o identificador e os valores no painel, fonte autoritativa do pedido. Venda confirmada é terminal; reembolso exige procedimento comercial separado e não libera benefício automaticamente. O checkout legado continua funcionando com a campanha desativada.

## Migrações e privacidade

`npm run db:migrate` executa as migrações ordenadas em uma transação, com lock e histórico `rfa_migrations`. `001_referrals.sql` preserva a base existente; `002_google_identity.sql` acrescenta vínculo Google, histórico de contatos, desafios e bindings administrativos. Preserva participantes, referências, cupons, pedidos e auditoria. Expira credenciais de e-mail antigas apenas na primeira aplicação, impedindo acesso legado após a troca. Reexecutar não expira novas sessões Google.

Solicitação de exclusão segue no painel ou no atendimento. O admin remove contato e revoga acessos após tratar reservas pendentes; permanecem somente identificadores e registros necessários para evitar reutilização indevida, obrigações aplicáveis e defesa de direitos. HMACs de sub/contatos são **pseudonimização, não anonimização**. O controlador deve revisar retenção e os direitos previstos na política; nenhum apagamento destrutivo de dados reais é feito automaticamente. Tokens antigos expirados, sessões e desafios vencidos são limpos nas operações.

## Testes e execução

Node.js 24; `npm ci`; `npm run dev` em loopback. Não publicar o servidor de desenvolvimento. Variáveis locais podem ser carregadas com `node --env-file=.env scripts/dev.js`.

```sh
npm test
npm run check
npm run build
npm audit
npm run test:browser
DATABASE_URL=postgresql://rfa_test:synthetic_local_only@127.0.0.1:55439/rfa_test npm run test:integration
DATABASE_URL=postgresql://rfa_test:synthetic_local_only@127.0.0.1:55439/rfa_test npm run test:browser:real
node --env-file=.env.preview.local scripts/staging-smoke.js
npm run test:public
```

O PostgreSQL local dedicado é o container `rfa-fit-referral-test` na porta 55439, usuário/base `rfa_test`, senha sintética `synthetic_local_only`. Os scripts de integração recusam outras URLs. Homologação recusa qualquer projeto diferente do Neon exclusivo indicado e reverte toda a transação. Nunca rodar testes sintéticos na produção.

Testes de assinatura usam chaves RSA e tokens **locais de teste**. API/default da implantação só confia nas chaves públicas Google: não existe flag/URL de JWKS nem credencial especial de teste em produção. Injeção de dependências ocorre apenas nos processos dos testes. Navegador ativo testa o SDK com fixture e API/SQL reais locais. O teste público valida loja e bloqueio da campanha, sem simular Google, cadastrar pessoas ou enviar WhatsApp. Esses testes não comprovam login Google real.

`public/` contém apenas a lista explícita de arquivos estáticos: backend, testes, documentação operacional, credenciais e backups ficam de fora. Backups desta alteração estão em `.vercel/backup-google/`, ignorados no Git e na publicação.

Referências oficiais: [configuração GIS](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [verificação de ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [API JavaScript e nonce](https://developers.google.com/identity/gsi/web/reference/js-reference), [jose](https://github.com/panva/jose), [TLS PostgreSQL](https://node-postgres.com/features/ssl).
