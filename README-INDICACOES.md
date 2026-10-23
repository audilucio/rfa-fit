# RFA.FIT — Indique & Ganhe

Implementação entregue com a campanha **desativada por padrão**. A loja estática e `data/products.json` foram preservados. Não há banco de produção, provedor de e-mail nem ambiente Vercel configurados por este trabalho. Não ativar somente porque o código foi enviado ao GitHub.

## Arquivos e arquitetura

- `index.html`: seção da campanha e sacola; checkout legado preservado quando desativada.
- `scripts/build.js`: gera `public/` com lista explícita de arquivos públicos; backend, testes, documentação operacional e backups ficam fora da publicação estática. APIs são empacotadas separadamente como Vercel Functions.
- `assets/*referrals*`: interface responsiva, participante, sacola e administração.
- `indicacoes.html`, `admin-indicacoes.html`, `regulamento.html`, `privacidade.html`: páginas do programa.
- `api/referral.js`: função Node.js 24 para Vercel, mesma origem, limite de corpo, cookie HttpOnly/SameSite e envio transacional via Resend.
- `lib/domain.js`: catálogo autoritativo, centavos, níveis, deduplicação e mensagem WhatsApp.
- `lib/service.js`: regras, aprovação humana, cupons, reservas, venda e exclusão.
- `lib/db.js`, `migrations/001_referrals.sql`: PostgreSQL persistente; transação no mesmo cliente e advisory lock global de campanha. Adequado a baixo volume, serializa mutações e evita resgates/reservas concorrentes. Monitorar contenção antes de escalar.
- `tests/` e `scripts/`: testes e servidor local. Não há autenticação especial de desenvolvimento em produção.

## Preparação externa e ativação

1. Provisionar PostgreSQL com TLS e pool de conexões compatível com serverless (por exemplo, plano gratuito de Neon ou Supabase, sujeito aos limites do fornecedor). Não foi criada conta nem contratado plano. Usar projeto exclusivo, backups e acesso mínimo; nunca expor conexão no HTML ou `config.js`.
2. Configurar Resend e validar domínio remetente (DNS). O código envia apenas e-mail de acesso/confirmação, sem campanhas comerciais. Não usar domínio de teste para clientes reais.
3. Configurar no ambiente Vercel as variáveis de `.env.example`. `IDENTITY_SECRET` deve ser aleatório, de pelo menos 32 caracteres (recomendado 32 bytes aleatórios em hex). Manter estável: a troca invalida identidade pseudonimizada, sessões e tokens; exige plano de migração. `ADMIN_EMAILS` contém e-mails completos autorizados, separados por vírgula. Administradores usam o mesmo acesso por e-mail, sem senha compartilhada.
4. Aplicar a migração com `DATABASE_URL` e, em produção, verificação TLS. `npm run db:migrate`. Migração transacional e idempotente; não apaga dados. Preferir credencial de migração separada da credencial de runtime, com permissão apenas nas tabelas necessárias.
5. Revisar dados do controlador, política, legitimidade/interesse legítimo, contratos de operadores, transferência internacional, prazo da campanha e procedimento de retenção com o responsável pela loja. Textos fornecem o fluxo implementado; não substituem definição dessas responsabilidades pelo controlador.
6. Testar primeiro em implantação de preview isolada, com banco próprio: cadastrar endereços reais controlados, receber e-mail de verdade, verificar expiração e uso único, acessar como admin, aprovar participante e três indicadas distintas, resgatar, validar sacola e WhatsApp, cancelar/expirar reserva e confirmar uma venda sintética. Conferir cookie Secure sobre HTTPS, restrições de origem e acesso anônimo negado.
7. Somente depois, repetir o smoke test no domínio definitivo e configurar `REFERRALS_ENABLED=true` com todas as outras variáveis válidas. Implantar novamente. Conferir `/api/referral` e interface; nunca anunciar campanha ativa sem esse teste real. Para interromper novos acessos, usar `REFERRALS_ENABLED=false` e reimplantar, cuidando dos pedidos pendentes já recebidos.

O endpoint GET informa somente `enabled`. Sem configuração completa, cadastro, cupons e checkout do programa respondem 503; banner e campo de cupom ficam ocultos. `/indicacoes.html` informa indisponibilidade. A loja e o checkout original continuam disponíveis. Segredos não devem ter prefixo público nem entrar no repositório. `PGSSL=disable` é exclusivamente local; produção valida certificado.

## Operação e regras

- Primeiro cadastro fixa o indicador para sempre; pessoa já cadastrada não passa a ser “nova” por outro link. Não há importação de contatos de terceiros. Compartilhamento é voluntário por link, WhatsApp e copiar/colar em outras redes.
- E-mail é normalizado e aliases com `+` são agrupados; Gmail/Googlemail também agrupam pontos. Essa deduplicação é conservadora, pode exigir revisão e não identifica toda pessoa com múltiplos e-mails. Não coletamos CPF, telefone de amigas nem impressão digital do dispositivo.
- Confirmação de contato não equivale à aprovação de legitimidade. Administrador revisa cada cadastro confirmado em `/admin-indicacoes.html`, acessando primeiro `/indicacoes.html` com e-mail autorizado. O primeiro admin pode acessar sem aprovação prévia. Aprovação/bloqueio exigem motivo auditável. Não aprovar em massa sem revisão. O painel mostra os 200 registros mais recentes por categoria; histórico completo permanece no banco e pode ser consultado com acesso operacional autorizado.
- Apenas confirmadas, aprovadas e não bloqueadas/excluídas contam. Indicador precisa estar aprovado para compartilhar link aceito e para resgatar. 3/6/9 = 10/20/30%; contador de desconto limitado a 9. Há um único cupom por participante, garantido por restrição UNIQUE e transação. Resgate encerra progressão, mesmo se cupom expirar sem uso. Não são criados benefícios adicionais.
- Cupons são aleatórios, individuais, não acumuláveis, válidos por 30 dias desde a emissão e vinculados à sessão do titular. Podem ser digitados na sacola após login pelo e-mail. O cliente não escolhe percentual. Indicações revogadas podem suspender cupom ainda não utilizado.
- Preço vigente, cor, tamanho e quantidades vêm do catálogo no servidor. Quantidades inteiras de 1 a 20 por linha, até 50 peças por pedido e 30 linhas. `referralEligible:false` exclui um produto; por padrão são elegíveis produtos cujo nome começa com “Biquíni”. Produtos inativos são recusados. Preço riscado e valores enviados pelo navegador são ignorados. Desconto arredondado uma vez sobre subtotal elegível em centavos; frete fica fora do benefício.
- Sacola, compra imediata e mensagem do pedido usam a mesma cotação do servidor quando a campanha está habilitada. Nenhum benefício é armazenado em localStorage. Sessão via cookie HttpOnly, sete dias; link de acesso, 15 minutos e uso único, token armazenado somente como HMAC. Token fica no fragmento e é removido da URL ao abrir a página; não entra no referer nem em logs HTTP.
- Checkout cria pedido `pending` por 30 minutos. Mesmo cupom e mesmos itens recuperam a reserva existente; itens diferentes exigem cancelar/expirar a anterior. Abrir WhatsApp não confirma venda. Participante pode cancelar reserva em seu painel; admin também pode cancelar. Expiração é recuperada de forma preguiçosa nas próximas operações, sem cron obrigatório.
- Atendimento deve conferir identificador, itens e valores no painel, confirmar pagamento e identidade do titular, registrar motivo e marcar a confirmação de titularidade. Só então clicar em “Confirmar venda”. O texto do WhatsApp é editável pelo usuário: nunca tratá-lo como fonte financeira autoritativa. O pedido salvo no servidor é a referência. Reservas vencidas não são confirmadas; emitir novo pedido se cupom ainda valer. Uma venda confirmada é terminal; reembolso exige processo comercial separado e não libera outro benefício automaticamente.
- Limites persistentes: 120 requisições/hora por HMAC de IP e 5 solicitações de e-mail/hora por identidade normalizada, honeypot, aprovação humana, deduplicação e auditoria. Não há promessa de eliminar toda fraude. Eventos de mudança e motivos ficam registrados sem tokens, IP bruto ou e-mail nos logs. Evitar dados pessoais nos motivos.

## Exclusão e retenção

Participante solicita exclusão autenticado, ou pelo atendimento oficial. Admin analisa pedidos em `deletion_requests`, cancela reservas pendentes e executa “Remover contato e revogar acesso”. O sistema remove e-mail, tokens e sessões, bloqueia a conta e mantém HMAC residual de contato para impedir novo benefício com os mesmos dados. **Esse HMAC é pseudonimização, não anonimização jurídica.** Pedidos e auditoria mínimos permanecem para obrigações aplicáveis e defesa de direitos.

O responsável deve revisar periodicamente retenção e direitos, responder solicitações, avaliar necessidade/base de dados residuais e remover o que não tiver justificativa ao fim da campanha. A implementação não faz apagamento destrutivo automático nem elimina dados fiscais. Tokens/sessões expirados e limites antigos são limpos nas operações. Não publicar uma política com prazos e operadores incompatíveis com a operação real.

## Desenvolvimento e testes

Node.js 24. `npm ci`, `npm run dev`, abrir `http://127.0.0.1:3000`. Variáveis podem ser carregadas com `node --env-file=.env scripts/dev.js` (e analogamente migração). Não disponibilizar esse servidor local na internet.

```sh
npm test
npm run check
npm run build
npm audit
npx playwright install chromium
npm run test:browser
```

`npm test` usa PostgreSQL embarcado PGlite, sem serviços externos. Cobre 0/1/2/3/6/9/10, duplicidade, aliases, código inválido, autoconvite, confirmação e expiração, níveis, resgate único, reservas, cálculos, fraude e exclusão. Teste de concorrência adicional usa PostgreSQL real e o lock exato de produção:

```sh
docker run -d --name rfa-fit-referral-test -e POSTGRES_USER=rfa_test -e POSTGRES_PASSWORD=synthetic_local_only -e POSTGRES_DB=rfa_test -p 127.0.0.1:55439:5432 postgres:16
DATABASE_URL=postgresql://rfa_test:synthetic_local_only@127.0.0.1:55439/rfa_test npm run test:integration
```

O teste recusa outra URL; usa só dados sintéticos. E-mail transacional é simulado e não confirma entrega real do Resend. Navegador testa 360/390/768/1440 px, loja desativada e checkout legado; fluxo visual ativo usa fixtures de API. API real testa sessão, proteção de origem, admin negado, reserva e resgate concorrentes, totais e rate limiting. O fluxo móvel também foi testado contra API e PostgreSQL reais com `DATABASE_URL=postgresql://rfa_test:synthetic_local_only@127.0.0.1:55439/rfa_test npm run test:browser:real`: token, cookie, painel, resgate, aplicação de cupom, totais, link WhatsApp idêntico à mensagem do servidor e cancelamento de reserva, sem mocks de API. Isso não substitui smoke test HTTPS, e-mail entregue e WhatsApp efetivamente recebido em produção.

## Publicação, backup e referências

Backup inicial de `index.html`, `config.js` e catálogo em `/tmp/rfa-fit-backup-20261023/`, fora do Git; backups preexistentes `.bkp` também ignorados e preservados. `/tmp` é temporário, não substitui backup operacional permanente.

O push para `origin/main` permite implantação automática se a integração Git/Vercel já existir. Validar o status externo; não presumir deploy bem-sucedido só por push. Rota prevista: `https://rfa-fit-loja.vercel.app/indicacoes.html`; permanece indisponível até configuração e validação reais.

Referências primárias consultadas: [Vercel Node.js](https://vercel.com/docs/functions/runtimes/node-js), [transações node-postgres](https://node-postgres.com/features/transactions), [Resend](https://resend.com/docs/api-reference/emails/send-email), [LGPD, arts. 16 e 18](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm).
