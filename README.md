# Vila Nova Subprodutos

MVP para controle offline e online de transporte e despejo de subprodutos da Vila Nova Agroindustrial.

## O que ja esta pronto

- Dashboard de coletas, conciliacao e analise separado do aplicativo Android.
- Aprovacao, reprovacao, edicao e exclusao controlada de coletas.
- Fotos privadas com URL temporaria, mapa de parcelas, filtros e exportacao CSV.
- Atualizacao automatica e manual sem apagar os dados ja carregados quando a rede falha.
- Login por matricula com sessao operacional e trilha de auditoria.

## Conhecimento corporativo incorporado

A pasta `C:\Users\thali\OneDrive\Desktop\conhecimento_empresa` foi analisada como base de dominio da Vila Nova Agroindustrial. A sintese aplicada ao modulo esta em `docs/conhecimento_empresa_aplicado.md`.

O principal aprendizado e que o modulo de subprodutos deve evoluir junto do processo de efluentes: OS, origem/carregamento, placa/carreta, TP/equipamento, fazenda, parcela, linha, quantidade aplicada, pesagens de balanca e dashboard de meta vs realizado.

O site oficial `https://vilanovaagroindustrial.com/` tambem foi analisado como referencia de marca. A sintese visual esta em `docs/site_referencia_marca.md`, e o app usa a paleta e o logo oficial no menu.

## Rodar localmente

```bash
npm install
npm run dev
```

Abra o endereco exibido pelo Vite no navegador.

URL principal:

- Dashboard: `http://localhost:5173/`

No deploy atual, a raiz `/` tambem abre o dashboard.

## Configurar Supabase

1. Confirme que as tabelas mobile e as funcoes de login do dashboard ja existem.
2. Execute `supabase/schema.sql`.
3. Execute `supabase/mobile_subproduct_bridge.sql`.
4. Execute `supabase/dashboard_subprodutos_rpc.sql`.
5. Execute por ultimo `supabase/secure_mobile_subproducts.sql`.
6. Publique a funcao privada de fotos e upload:

```bash
npx supabase functions deploy vna-mobile-api --project-ref wcifxyvesmhqurqhnway --no-verify-jwt
```

O `--no-verify-jwt` e intencional: a funcao valida os tokens proprios do app e
do dashboard antes de acessar o bucket privado. Nao execute novamente os SQLs
piloto do app depois da migracao segura, pois eles pertencem a fase inicial.

7. Configure o ambiente do dashboard.
8. Copie `.env.example` para `.env.local` e preencha:

```bash
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anonima
VITE_SUPABASE_AUTH_EMAIL_DOMAIN=vilanova.local
```

9. Reinicie `npm run dev`.

No deploy da Vercel, cadastre as mesmas variaveis em Project Settings > Environment Variables.

O dashboard usa somente matricula/senha via RPC `dashboard_authenticate`, como o
dashboard CQO. Leituras e alteracoes passam por RPCs com token de sessao; o
navegador nao recebe permissao direta nas tabelas operacionais.

## Fluxo operacional

1. Motorista passa na balanca de saida.
2. Motorista vai ate a fazenda.
3. No campo, registra o despejo no celular mesmo sem internet.
4. Ao retornar, passa novamente na balanca.
5. Ao conectar no Wi-Fi da industria, entra no app e sincroniza a fila local.
6. Dashboard separado consolida campo e balanca para analise.

## Verificacao

```bash
npm run typecheck
npm run build
npm run test:e2e
npm audit --audit-level=high
```
