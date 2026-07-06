# Vila Nova Subprodutos

MVP para controle offline e online de transporte e despejo de subprodutos da Vila Nova Agroindustrial.

## O que ja esta pronto

- Registro de campo com matricula, motorista, placa, subproduto, fazenda, parcela ou entre parcelas, data, hora, GPS e observacao.
- Salvamento local em IndexedDB para funcionar sem internet.
- Fila de sincronizacao com Supabase quando houver Wi-Fi.
- Login Supabase para enviar dados com usuario autenticado.
- Dashboard separado do app de campo, com viagens, peso liquido, tempo medio, distribuicao por fazenda e subproduto.
- PWA instalavel no celular pelo navegador.
- SQL inicial em `supabase/schema.sql`.

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

URLs principais:

- App de campo: `http://localhost:5174/app`
- Dashboard: `http://localhost:5174/dashboard`

O app de campo e o dashboard usam rotas e bundles separados. O motorista nao baixa o codigo dos graficos do dashboard ao abrir `/app`.

## Configurar Supabase

1. Crie um projeto no Supabase.
2. Execute o SQL de `supabase/schema.sql` no SQL Editor.
3. Crie usuarios em Authentication.
4. Copie `.env.example` para `.env.local`.
5. Preencha:

```bash
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anonima
VITE_SUPABASE_AUTH_EMAIL_DOMAIN=vilanova.local
```

6. Reinicie `npm run dev`.

No deploy da Vercel, cadastre as mesmas variaveis em Project Settings > Environment Variables.

O dashboard aceita dois caminhos de acesso:

- Matricula/senha via RPC `dashboard_authenticate`, igual ao dashboard CQO antigo. Para esse modo tambem ler os dados de subprodutos por token de sessao, execute `supabase/dashboard_subprodutos_rpc.sql` depois do SQL de seguranca do dashboard antigo.
- Supabase Auth nativo como fallback. Nesse caso a matricula vira e-mail no formato `matricula@VITE_SUPABASE_AUTH_EMAIL_DOMAIN`, e o usuario precisa existir em Authentication.

## Fluxo operacional

1. Motorista passa na balanca de saida.
2. Motorista vai ate a fazenda.
3. No campo, registra o despejo no celular mesmo sem internet.
4. Ao retornar, passa novamente na balanca.
5. Ao conectar no Wi-Fi da industria, entra no app e sincroniza a fila local.
6. Dashboard separado consolida campo e balanca para analise.

## Proximos passos recomendados

- Importar dados reais da balanca por CSV, planilha ou API.
- Criar cadastro oficial de motoristas, veiculos, fazendas e parcelas.
- Amarrar registro de campo ao ticket de balanca automaticamente por placa, motorista e janela de horario.
- Adicionar permissao por perfil: motorista, balanca, administrativo e gestor.
- Adicionar mapa de parcelas e relatorio por periodo.
