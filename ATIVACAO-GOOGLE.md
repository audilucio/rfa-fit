# RFA.FIT — migração para Google Identity Services

Implementação sobre o sistema existente, com validação final em 26/10/2026. Neon Free, Vercel, catálogo, níveis, cupons, pedidos e painel foram preservados. Não foi contratado serviço pago nem ativado cartão/faturamento.

## Estado operacional

- Resend e domínio remetente deixam de ser dependências. Nenhuma chamada ou chave Resend é usada no fluxo atual.
- Login Google implementado com assinatura RS256/JWKS Google, issuer, audience, expiração, email verificado, `sub`, nonce, proteção CSRF e desafio de uso único. Sessão própria segura.
- Identidade vinculada ao `sub`, com histórico de contatos e revisão administrativa. Administrador fixado à identidade Google após bootstrap confiável. Login não elimina fraude nem aprova automaticamente indicações.
- Migração aditiva `002_google_identity.sql` aplicada em produção e homologação com TLS validado, com histórico de aplicação para não expirar sessões novas em reexecuções. Sem apagar participantes, pedidos ou cupons.
- Produção continua com `REFERRALS_ENABLED=false`. As variáveis existentes de Neon, origem, identidade e administrador permanecem. `GOOGLE_CLIENT_ID` já foi configurada em production, preview e development com o ID real fornecido pelo titular.

## Client ID configurado e validação real pendente

O titular criou o OAuth Web Client e forneceu seu ID. A variável `GOOGLE_CLIENT_ID` foi configurada na Vercel para production, preview e development; o arquivo local ignorado de homologação também foi atualizado. O Client ID não é secreto, mas seu valor não precisa ser versionado. Nenhum Client Secret foi solicitado ou armazenado.

Acesse [verificar-login.html](https://rfa-fit-loja.vercel.app/verificar-login.html), aceite os termos e entre com a **conta Google administradora**. O servidor verifica assinatura, audience, nonce, sessão e autorização administrativa e registra a comprovação na auditoria. A confirmação dessa página não habilita a campanha: resgates, cadastros de participantes comuns e pedidos do programa continuam bloqueados. Contas não administrativas são recusadas e o cadastro é revertido atomicamente.

Configuração para o titular:

1. Nome do aplicativo: RFA.FIT — Indique & Ganhe. Configurar público externo/usuários de teste e autorização/publicação conforme as exigências do console. Não ativar Billing nem Identity Platform pago.
2. Origem JavaScript autorizada: **`https://rfa-fit-loja.vercel.app`** (sem caminho/barra final). Usar a origem Vercel existente; não é necessário comprar domínio para o código implementado. Para testes reais em preview/localhost, autorizar a origem exata correspondente e definir `APP_ORIGIN` corretamente; sem wildcard.
3. Página inicial: `https://rfa-fit-loja.vercel.app/`; privacidade: `/privacidade.html`; regulamento: `/regulamento.html`. O fluxo é popup/callback JavaScript, sem endpoint de troca de código e sem necessidade de Client Secret no servidor.
4. Client ID real já definido em **`GOOGLE_CLIENT_ID`** na Vercel. Se o Google apresentar erro de origem/público de teste, ajustar as permissões do cliente existente no console; não criar outro ID nem fornecer Client Secret.

Ainda é obrigatório concluir o login real pela página administrativa e validar os fluxos em HTTPS no ambiente autorizado, incluindo a conta administrativa, indicação aprovada, resgate, cotação, reserva e confirmação da venda. O Client ID por si só não comprova funcionamento nem autoriza `REFERRALS_ENABLED=true`. A implantação desta entrega mantém a campanha fechada porque essa validação real não pôde ocorrer.

## Validação desta entrega

- Assinatura e claims: RSA, chave desconhecida, assinatura adulterada, algoritmo incorreto, issuer/audience/azp incorretos, expiração/iat, `email_verified` falso/ausente, sub e nonce inválidos.
- Autenticação: origem, CSRF, nonce persistente com validade/uso único, replays e duas tentativas simultâneas; nenhuma confiança em e-mail digitado.
- Identidades: sub estável após troca de e-mail; contato/alias não migra entre contas; registro legado não é associado automaticamente por e-mail; identidade administrativa não é transferida com o contato.
- Campanha: 0/1/2/3/6/9/10, máximo 30%, resgate único/concorrente, fraude e exclusão, cupons expirados, reservas, venda e valores preservados (R$ 99,90 por biquíni).
- Navegador: responsividade da loja; fluxo ativo móvel local com fixture do Google, tokens RSA de teste, API e PostgreSQL reais; administração, sacola e texto WhatsApp conferidos. Não é um login Google real.
- Neon de homologação: regras testadas em transação revertida; produção sem participantes/pedidos fictícios.
- Loja publicada: campanha fechada, checkout legado disponível, arquivos privados protegidos. Não foram enviadas mensagens de WhatsApp.

Detalhes e comandos em [README-INDICACOES.md](README-INDICACOES.md). O relatório `ATIVACAO-ETAPA-2.md` fica como histórico da configuração Neon e não descreve mais o método de autenticação atual.

## URLs

- [Verificação administrativa do Google](https://rfa-fit-loja.vercel.app/verificar-login.html)
- [Loja](https://rfa-fit-loja.vercel.app/)
- [Campanha — desativada](https://rfa-fit-loja.vercel.app/indicacoes.html)
- [Administração — operações desativadas](https://rfa-fit-loja.vercel.app/admin-indicacoes.html)
- [Privacidade](https://rfa-fit-loja.vercel.app/privacidade.html) e [regulamento](https://rfa-fit-loja.vercel.app/regulamento.html)
