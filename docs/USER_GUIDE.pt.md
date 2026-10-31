# Guia do Usuário do MobAlt

This guide in: [English](USER_GUIDE.md) · [한국어](USER_GUIDE.ko.md) · [简体中文](USER_GUIDE.zh-CN.md) · [日本語](USER_GUIDE.ja.md) · [Tiếng Việt](USER_GUIDE.vi.md) · [हिन्दी](USER_GUIDE.hi.md) · [Deutsch](USER_GUIDE.de.md) · [Français](USER_GUIDE.fr.md) · [Español](USER_GUIDE.es.md) · [Português](USER_GUIDE.pt.md) · [العربية](USER_GUIDE.ar.md)

O MobAlt é uma bancada de trabalho no estilo do MobaXterm para o macOS: uma árvore de sessões à esquerda,
terminais em abas e divididos no centro, e um navegador SFTP, ferramentas de rede e macros em painéis laterais.

Veja também: [Paridade de recursos com o MobaXterm 26.6](MOBAXTERM_PARITY.md) — o que o MobAlt tem, o que lhe falta e o que faz de outro jeito, com o roteiro.

![MobAlt com dois shells remotos lado a lado](images/hero.png)

Conteúdo: [Instalação](#instalação) · [Atualização](#atualização) · [Sessões](#sessões) · [Conexão](#conexão) ·
[Terminal](#terminal) · [Arquivos (SFTP / FTP)](#arquivos-sftp--ftp) · [Túneis](#túneis-encaminhamento-de-portas) ·
[X11, Mosh, Serial, RDP/VNC](#x11-mosh-serial-rdpvnc) · [Ferramentas e macros](#ferramentas-e-macros) ·
[Espaço de trabalho e ajustes](#espaço-de-trabalho-e-ajustes) · [Atalhos de teclado](#atalhos-de-teclado) ·
[Dados e privacidade](#dados-e-privacidade) · [Solução de problemas](#solução-de-problemas)

## Instalação

- **Homebrew**: `brew tap Hyeongcheol-An/tap && brew trust Hyeongcheol-An/tap && brew install --cask mobalt`
  (o Homebrew 7 pede uma única vez que você confie num tap de terceiros; depois, `brew upgrade --cask mobalt` atualiza)
- **DMG**: baixe o DMG para Apple Silicon (`arm64`) ou Intel (`x64`) em
  [Releases](https://github.com/Hyeongcheol-An/MobAlt/releases) e arraste o MobAlt para Aplicativos.

As versões publicadas são assinadas e notarizadas. Requisitos: macOS 13 ou posterior. Auxiliares opcionais:
[XQuartz](https://www.xquartz.org/) para o encaminhamento X11, `brew install mosh` para sessões Mosh,
Windows App para RDP.

Ao iniciar, o MobAlt procura uma versão mais nova nas GitHub Releases e a oferece num diálogo; nada é
baixado nem instalado sem a sua confirmação. Veja [Atualização](#atualização).

## Atualização

Três caminhos levam a uma nova versão; todos terminam com o novo pacote em `/Applications/MobAlt.app`:

- **Atualizador do app**: o MobAlt consulta as GitHub Releases ao iniciar (desative isso em Ajustes → Atualizações), e
  Ajuda → Verificar Atualizações… ou “Verificar agora” em Ajustes → Atualizações faz a verificação manualmente. Uma
  versão mais nova é oferecida num diálogo, só é baixada quando você mandar e é instalada quando você encerrar o app,
  ou na hora com “Reiniciar agora”.
- **Homebrew**: `brew upgrade --cask mobalt` substitui o app em Aplicativos.
- **DMG**: baixe o novo DMG em [Releases](https://github.com/Hyeongcheol-An/MobAlt/releases) e
  arraste o MobAlt para Aplicativos, substituindo o antigo.

As atualizações pelo app e o Homebrew convivem bem. Com “Verificar atualizações ao iniciar” ativado (Ajustes → Atualizações), o MobAlt
se mantém atualizado sozinho, e `brew upgrade --cask mobalt` pode ser executado a qualquer momento: se o app já se
atualizou, o Homebrew apenas reinstala a versão que já está lá. Como o cask declara `auto_updates`,
um `brew upgrade` simples (sem nomear o cask) ignora o MobAlt, a menos que você passe `--greedy`; nomeie o cask, ou
acrescente `--greedy`, quando quiser que o Homebrew faça a atualização.

Atualizar com o MobAlt aberto não é problema — mesmo a partir de um dos próprios terminais do MobAlt. O app em execução
continua rodando a versão antiga a partir da memória, percebe o novo pacote no disco (em até um minuto, ou assim que a
janela voltar a ficar em foco) e mostra uma faixa acima das abas: *O MobAlt 0.11.0 está instalado no disco — você está
usando o 0.10.1. Reabra o app para usá-la.* **Reabrir** pergunta antes sobre as conexões SSH/FTP abertas (como faz o ⌘Q),
salva o espaço de trabalho e inicia a nova versão; as suas abas voltam pela restauração do espaço de trabalho. **Depois**
oculta a faixa até surgir mais uma versão. Se o novo pacote já estiver no disco quando o atualizador
for executado, nada é baixado de novo: a verificação informa “0.11.0 já está instalada no disco; reabra o app para usá-la”
e oferece a mesma reabertura.

## Sessões

O painel **Sessões** é a sua árvore de favoritos. Crie uma sessão com `＋ Sessão` (⌘N), escolha um tipo
e preencha a aba Básico. Clique duas vezes numa sessão para conectar; clique com o botão direito para abrir o menu de contexto
(abrir, dividir à direita/abaixo, editar, duplicar, apagar, iniciar um túnel, nova sessão nesta pasta).

![Editor de sessão](images/session-editor.png)

| Tipo | O que faz |
|---|---|
| SSH | Terminal via SSH com navegador SFTP, túneis, encaminhamento X11 e do agente |
| Mosh | Terminal itinerante pelo cliente `mosh` (iniciado via SSH) |
| Local | O seu shell de login do macOS (zsh/bash), com acompanhamento da pasta |
| Telnet | Telnet clássico com negociação NAWS/TTYPE |
| Serial | Console USB-serial (baud, enquadramento, controle de fluxo, eco local) |
| FTP | Navegador de arquivos FTP / FTPS (TLS explícito) no painel Sftp |
| RDP / VNC | Passa a conexão ao Windows App ou ao Compartilhamento de Tela do macOS |

**Pastas**: o botão de pasta no cabeçalho do painel (Nova pasta) cria uma pasta; arraste sessões e pastas para movê-las (solte na área vazia
para a raiz). O menu de contexto de uma pasta pode abrir todas as sessões dela numa grade ou em abas.

**Ícones e cores**: escolha um emoji e uma cor no editor. Eles aparecem na linha, na aba e no
cabeçalho do painel, de modo que uma sessão de “produção” vermelha dificilmente é confundida com uma de “homologação” verde.

**Importar / exportar**: o rodapé do painel importa o `~/.ssh/config` (hosts, usuários, portas, chaves, ProxyJump) e um
`MobaXterm.ini` do MobaXterm (favoritos). Exporte / importe todas as sessões como JSON pelo menu de contexto
da árvore. O arquivo JSON contém todas as sessões e pastas, mas nunca uma senha ou frase secreta: elas ficam no
armazenamento cifrado do MobAlt neste Mac, e o arquivo só registra que uma foi salva (`hasPassword`), de modo que uma
sessão importada em outro Mac pede a senha na primeira conexão. A importação se mescla ao que você já tem: uma sessão
cujo `id` corresponde a uma existente é substituída pela versão do arquivo (a senha salva aqui para ela é mantida),
todas as outras são adicionadas — uma entrada escrita à mão sem `id` é sempre adicionada, e uma `password` escrita
no arquivo é aproveitada e guardada cifrada —, as pastas são adicionadas e nada é apagado, de modo que importar o mesmo
arquivo duas vezes não muda nada. Entradas sem nome, com tipo desconhecido ou porta inválida são ignoradas e
contadas no aviso; um arquivo que não seja um arquivo de sessões do MobAlt é recusado com o motivo. O `~/.ssh/config`
ignora os hosts que você já tem (mesma pasta e nome). Os favoritos do MobaXterm vão para uma pasta `MobaXterm`; um
importado antes (mesma pasta, nome e host) é atualizado no lugar — host, porta, usuário, X11 e compressão
seguem o `.ini`, enquanto a senha salva, o ícone, a cor, os túneis e um caminho de chave que você definiu permanecem —, de modo que importar
o mesmo `.ini` duas vezes também não muda nada.

**Comandos iniciais** (aba Terminal): um comando por linha, digitado no terminal assim que ele estiver
pronto. No SSH, isso acontece logo após o login; nos shells locais, logo depois de o prompt aparecer. Exemplo:
uma sessão local com a *Pasta inicial* definida para um projeto e `claude --resume <id>` como comando.
A *Pasta inicial* de uma sessão local aceita um caminho digitado por inteiro ou escolhido com o botão Escolher…, que abre um
diálogo de pasta e deixa o campo como estava se você cancelar.

## Conexão

- **Conexão rápida**: digite `user@host[:port]` na barra de ferramentas e pressione Enter. Os prefixos escolhem o
  tipo: `ssh://`, `mosh://`, `telnet://`, `ftp://`, `ftps://`, `rdp://`, `vnc://`. Se uma sessão salva
  corresponder, ela é usada.
- **Autenticação**: *Automática* tenta uma chave configurada, a senha salva, o agente SSH e as
  chaves padrão em `~/.ssh` antes de perguntar. Escolha *Senha*, *Chave privada* ou *Agente SSH* para
  restringi-la. Chaves com frase secreta a pedem uma vez; marque “Salvar na sessão” para guardá-la.
- **Chaves do host**: a primeira conexão mostra a impressão digital (SHA256 e MD5). Aceitar guarda a
  chave; uma chave alterada é sinalizada com destaque e nunca aceita em silêncio.
- **Chaves SSH**: Sessão → Gerar Chave SSH… (também no painel Ferramentas, e *Gerar…* ao lado do
  campo de chave privada no editor de sessão) executa o `ssh-keygen` do macOS para você: Ed25519 (padrão),
  RSA 4096 ou ECDSA, um comentário, uma frase secreta opcional com indicação da força, e o arquivo (padrão
  `~/.ssh/id_<type>`, numerado se esse nome já existir; `~/.ssh` é criado com acesso privado se não existir,
  os arquivos ficam com 0600 / 0644). Mostra a chave pública com um botão Copiar e a impressão digital.
  “Adicionar ao ssh-agent” executa `ssh-add --apple-use-keychain`; “Instalar num servidor…” conecta a uma
  sessão salva com a autenticação habitual dela e acrescenta a chave pública ao seu `~/.ssh/authorized_keys`,
  como o `ssh-copy-id` (nunca duas vezes). No editor, *Usar nesta sessão* preenche o campo da chave.
- **Algoritmos**: SSH avançado → Algoritmos lista o que a sessão oferece para troca de chaves, chave
  do host, cifras e MACs, já preenchido com os padrões integrados; edite uma lista para restringi-la ou reordená-la
  (nomes desconhecidos são recusados ali mesmo), *Restaurar padrões* repõe as listas, e “Algoritmos
  antigos (equipamentos velhos)” é uma predefinição que adiciona as trocas de chaves SHA-1, as cifras CBC e as chaves de host
  DSA de que equipamentos antigos ainda precisam. Só as listas diferentes dos padrões são guardadas.
- **Hosts de salto**: SSH avançado → Host de salto escolhe outra sessão salva como bastion (ProxyJump).
- **Quando falha**: o terminal mostra o que aconteceu, por exemplo
  `authentication failed — server accepts: publickey; tried: ~/.ssh/id_ed25519` (em português, “falha na autenticação — o
  servidor aceita: …; tentado: …”), ou um aviso de que nada respondeu na porta. Veja [Solução de problemas](#solução-de-problemas).

## Terminal

![Grade de divisões](images/split-grid.png)

- **Abas**: cada sessão abre uma aba. Arraste as abas para reordená-las, clique duas vezes para renomear, clique com o botão do meio
  para fechar. As abas locais recebem o nome da pasta atual. O menu de contexto da aba (clique direito, ou
  ⇧F10 na aba em foco) renomeia, duplica, colore, divide e fecha: *Fechar Outras*, *Fechar Abas
  à Esquerda*, *Fechar Abas à Direita* e *Fechar Todas* fecham várias abas de uma vez e fazem uma única pergunta
  que conta todas as conexões ativas entre elas (“Fechar 3 abas com 2 conexões ativas?”).
- **Abas fixadas** (*Fixar Aba* no menu, ⇧⌘P): uma aba fixada vai para a esquerda da faixa, na ordem
  em que as abas foram fixadas, e encolhe até o seu ponto de estado, o ícone e um título curto, com um pequeno alfinete no lugar
  do ✕. Os fechamentos em massa acima e o clique do meio não mexem nas abas fixadas (⌘W, o *Fechar* do menu
  e ⌫ na aba em foco ainda fecham uma), e uma aba fixada não pode ser arrastada para além de uma não fixada.
  As fixações fazem parte do espaço de trabalho, então voltam depois de reiniciar. *Desafixar Aba* coloca a aba logo
  depois do bloco de abas fixadas.
- **Mover uma aba para uma janela própria** (*Mover para Nova Janela* no menu da aba, ⌥⌘N, ou o menu
  Sessão): a aba vai para uma segunda janela do MobAlt e mantém os seus terminais — nada reconecta nem
  reinicia. A nova janela redesenha os últimos 256 KB da saída de cada terminal e continua dali;
  uma aba dividida vai com todos os seus painéis. A janela tem a mesma barra de ferramentas, os mesmos menus e atalhos e
  começa com a barra lateral recolhida (⌘B a mostra ali); o MultiExec é por janela. Uma segunda janela separada
  abre deslocada da primeira, para que nenhuma esconda a outra. Fechar uma janela separada devolve as suas abas
  à janela principal com as sessões ainda em execução — nunca encerra uma sessão; fechar a sua
  última aba (⌘W) fecha a própria janela, pois não resta nada a devolver; fechar a janela principal
  encerra o MobAlt, incluindo as janelas separadas. O espaço de trabalho memoriza
  as janelas separadas e as abre de novo na próxima inicialização, reconectando as suas sessões como as da janela
  principal. Não é possível arrastar abas entre janelas: feche a janela para trazê-las de volta, ou mova-as
  de novo a partir dali.
- **Divisões e grades**: `Dividir ▾` (⌘D à direita, ⇧⌘D abaixo) adiciona um painel vazio; as entradas de grade criam
  layouts de 1×2 … 2×4 (⌥⌘2/4/6/8). Solte uma sessão da árvore num painel vazio para conectar ali,
  na borda de um painel para dividir nessa direção, ou no centro dele para substituí-lo. Arraste uma aba para
  um painel para mover aquele terminal para a divisão. ⌥⌘1 (Visualizar → Desfazer divisão, `Dividir ▾` → Desfazer divisão) desfaz a
  divisão da aba: por padrão, cada um dos outros painéis vira uma aba própria, colocada logo depois da aba atual na
  ordem dos painéis, com o terminal, o título e o estado como estão — nada reconecta, nenhuma saída se perde;
  o painel em foco fica com a aba. Ajustes → Terminal → **Desfazer divisão** escolhe outro comportamento: *Manter o
  painel ativo e fechar os outros* (os outros painéis fecham, com a pergunta habitual quando conexões ativas
  seriam encerradas) ou *Perguntar sempre* (um pequeno diálogo oferece *Mover painéis para abas*, *Manter só este painel* ou
  Cancelar, que mantém a divisão). Uma aba com um único painel não é alterada, e um painel maximizado é restaurado antes.
- **Maximizar um painel** (⇧⌘⏎, o botão ⤢ no cabeçalho do painel, ou `Dividir ▾` → Maximizar Painel): o painel
  em foco preenche a aba, como o zoom do tmux ou o maximizar do iTerm2. Os outros painéis continuam conectados, mas
  ocultos; o cabeçalho do painel mostra uma etiqueta *maximizado* e a aba um pequeno ⤢. Pressione de novo (ou ⤡ no cabeçalho)
  para restaurar o layout. Dividir, fechar um painel, um layout em grade ou pôr o foco num painel oculto (⌘])
  restaura o layout antes. Cada aba mantém o seu próprio estado de maximização, inclusive após reiniciar.
- **Menu do painel** (clique direito num terminal; ⇧- ou ⌃-clique direito enquanto *Clique direito cola* estiver ativado): além de
  copiar, colar, buscar, limpar, dividir e maximizar, ele traz os itens por terminal do menu de terminal do MobaXterm. *Renomear
  Painel…* (o *Rename Terminal* do MobaXterm) dá nome ao próprio painel: o cabeçalho do painel mostra o nome, a aba o adota quando é
  esse painel que dá nome à aba, e as sequências de título do próprio shell deixam de alterá-lo; um nome vazio volta ao
  título automático. *Ajustes do Painel…* é o "reconfigurar o terminal atual" do MobaXterm: tema, fonte e
  tamanho, estilo do cursor e cursor piscante, histórico, realce de palavras-chave, a barra de monitoramento (SSH / Mosh), somente
  leitura e o rótulo de fundo deste painel, por cima dos valores da sessão e dos Ajustes (um campo em branco segue esses valores).
  *Aplicar a este painel* muda só este painel — os valores vão com ele ao maximizar, ao mover para nova janela e no
  espaço de trabalho — e *Salvar na sessão* (só para sessões salvas) também grava os campos que a sessão tem (tema, tamanho
  da fonte, realce de palavras-chave, monitoramento, rótulo de fundo), para que todo painel aberto depois a partir dessa sessão
  os siga. *Tamanho da Fonte ▸* ajusta a fonte deste painel (⌘= / ⌘- / ⌘0 fazem o mesmo no painel em foco; *Redefinir* volta
  ao tamanho próprio do painel). *Somente Leitura* descarta as teclas e as colagens enviadas ao painel enquanto a saída dele continua
  chegando — uma etiqueta *somente leitura* no cabeçalho o indica, e o MultiExec deixa o painel de fora.
- **Rótulo de fundo**: um nome grande e esmaecido desenhado atrás do texto de um painel — por padrão, o nome da sessão — para reconhecer
  o servidor num relance, como o badge do iTerm2 (o MobaXterm só dá nome a um painel na faixa de abas). *Rótulo de Fundo ▸*
  no menu do painel mostra ou oculta o rótulo, define o texto dele (*Definir Texto…*; vazio = o rótulo da sessão, senão o nome dela ou o
  título do painel) e o coloca no centro ou no canto superior direito; a aba Terminal do editor de sessão (*Rótulo de fundo*: exibido,
  texto, posição) o ativa para todos os painéis de uma sessão, e o ajuste próprio de um painel prevalece sobre o da sessão.
  O rótulo acompanha o tamanho do painel, some em células minúsculas, usa a cor de primeiro plano do painel com 16 % de opacidade e
  nunca faz parte do buffer do terminal, de uma seleção, de uma cópia nem de um registro de sessão.
- **MultiExec** (⇧⌘M): enquanto ativado, cada tecla vai para todos os terminais visíveis na tela — os
  painéis ativos da aba atual, ou só o painel maximizado enquanto ele preencher a aba. As outras abas nunca
  recebem as teclas, então divida a aba (ou use uma grade) para pôr lado a lado os servidores que quer comandar.
  A faixa mostra quantos terminais visíveis estão escutando e acompanha a aba para a qual você mudar.
  Para deixar um painel de fora, marque a caixa sob o terminal dele — *Excluir "nome" do modo MultiExec*, como no
  MobaXterm — ou use *Excluir do MultiExec* no menu de clique direito do painel: o painel continua na tela e
  conectado, as teclas digitadas em outro lugar deixam de chegar a ele, e o que você digita nele vai só para ele (útil
  para executar um comando num único servidor sem sair do modo). A faixa então acrescenta *, N excluídos*,
  ou avisa que todos os terminais visíveis estão excluídos. Um clique direito na faixa das caixas ou na faixa do modo (⇧F10 numa
  caixa em foco) abre o menu do modo: *Ativar todos*, *Desativar todos*, *Inverter seleção* e *Sincronizar
  rolagem da roda do mouse*, que rola os outros terminais que estão escutando o mesmo número de linhas quando você
  gira a roda num deles. As caixas são desmarcadas sempre que o MultiExec é desativado; nada delas é salvo.
- **Barra de monitoramento remoto**: cada painel SSH mostra uma faixa de uma linha sob o cabeçalho — CPU, memória usada / total,
  disco raiz usado, taxas de rede ↓ / ↑, carga média, tempo ativo e o nome do host — atualizada a cada 3 s (Ajustes →
  Recursos → Monitoramento, 2–30 s). Um pequeno trecho POSIX `sh` é executado pela própria conexão da sessão, então
  não precisa de um segundo login, funciona através de hosts de salto e nunca escreve no terminal; hosts Linux são lidos de
  `/proc`, macOS e BSDs por `sysctl`, `vm_stat` e `netstat`. Um host que não consegue executá-lo (sem `sh`,
  permissão negada) mostra um *monitoramento indisponível* esmaecido e não é consultado de novo até reconectar. A consulta pausa
  enquanto o painel não está na tela (outra aba à frente, um painel vizinho maximizado, a janela oculta) e é retomada quando ele
  volta. Desative-a por sessão (SSH avançado → *Mostrar barra de monitoramento remoto*), por painel (o botão de pulso
  no cabeçalho do painel, Visualizar → Barra de Monitoramento Remoto, ou o menu de contexto do terminal) ou para todas as sessões em
  Ajustes. Um painel Mosh não tem um canal SSH próprio: a barra dele aparece pela conexão SFTP auxiliar
  enquanto ela estiver aberta.
- **Buscar** (⌘F): busca incremental com opções de maiúsculas/minúsculas e regex e um contador de correspondências.
- **Realce de palavras-chave**: erros, avisos, OK/concluído, endereços IP, URLs e tamanhos (`512M`, `3.2GB`) são
  coloridos à medida que chegam, com cores tiradas do tema do terminal para que fiquem legíveis em qualquer paleta.
  Ajustes → Recursos → *Palavras-chave* o desativa; *Regras…* abre a tabela — cada regra é um
  texto simples ou uma expressão regular, ignorar maiúsculas, uma cor, um fundo opcional, negrito e sublinhado;
  *Restaurar padrões* traz de volta o conjunto integrado. Quando regras se sobrepõem, vence a correspondência que começa antes e, depois, a
  mais longa. A aba Terminal de uma sessão pode forçá-lo a ativado ou desativado (*Palavras-chave: Padrão / Ativado / Desativado*).
  Só as linhas recém-escritas são analisadas (apps de tela cheia como o vim não são tocados); no máximo 2.000 correspondências
  ficam decoradas por terminal — numa rajada longa, as linhas mais antigas perdem a cor primeiro — e ⌘K remove todas.
- **Zmodem (rz/sz)**: transfira arquivos pelo próprio terminal, do jeito clássico, por um console serial ou um host de salto
  onde o SFTP não está disponível. Execute `sz arquivo …` no remoto para baixar para o Mac, ou `rz` para enviar a partir dele; o MobAlt
  detecta a transferência no fluxo, pausa o terminal e a mostra na lista de transferências do painel Sftp (com Cancelar)
  e no contador da barra de estado. Os downloads vão para a Pasta de downloads (Ajustes → Geral), ou para uma pasta que você escolhe quando nenhuma
  está definida; os envios abrem um seletor de arquivos. Funciona em painéis SSH, locais, telnet e serial — não no Mosh (o fluxo dele é o do
  cliente mosh, não um fluxo de bytes bruto). Desative em Ajustes → Recursos → Transferências → *Transferências Zmodem (rz/sz)* (ativado por padrão);
  desativado, os bytes de `rz`/`sz` simplesmente aparecem como lixo, como antes. Ctrl-C no painel ou Cancelar na lista
  encerra uma transferência: o `sz`/`rz` remoto recebe a ordem de parar, o que ainda estava em trânsito é descartado em vez de desenhado,
  e o prompt volta em menos de um segundo; um `sz` remoto que morre é detectado em poucos segundos. Um segundo download
  com o mesmo nome é salvo como `nome (1).ext` e listado com esse nome.
- **Área de transferência**: selecionar copia (Ajustes → Terminal → Copiar ao selecionar); o clique direito cola
  (⇧-clique direito abre o menu). Soltar arquivos do Finder num terminal SSH os envia;
  num terminal local, cola os caminhos.
- **Proteção de colagem**: uma colagem com mais de uma linha (ou com mais de 1000 caracteres) pede confirmação antes — *Colar N
  linhas em …?* mostra o texto numa pré-visualização editável; ⌘⏎ cola, Esc cancela. Toda colagem também é
  verificada quanto ao que a área de transferência não mostra: caracteres de largura zero e bidirecionais, espaços sem quebra (um espaço
  para os olhos, parte da palavra para o shell), caracteres de controle, uma quebra de linha final (a última linha seria
  executada de imediato), um retorno de carro dentro de uma linha, `curl … | sh`,
  gravações em `~/.zshrc` e afins ou em `~/.ssh/authorized_keys`, comandos do tipo `rm -rf /` e palavras
  latinas com letras parecidas do cirílico ou do grego. As ocorrências são listadas e marcadas na pré-visualização;
  *Colar limpo* remove os caracteres ocultos e a quebra de linha final, *Colar como está* envia o texto
  sem alterações. As duas verificações são opções de Ajustes → Recursos → Proteção de colagem (ativadas por padrão); valem para ⌘V,
  o clique direito e o texto solto num painel, não para macros. Com o MultiExec ativado, uma única confirmação vale para todos
  os terminais visíveis.
- **Teclas**: Shift+Enter e Option+Enter enviam ESC+CR — a sequência que o próprio `/terminal-setup` do Claude Code
  configura em outros terminais —, então qualquer uma das duas começa uma nova linha no editor do Claude Code em vez de enviar
  o prompt; a tecla Option funciona como Meta por padrão.
- **Imagens para o Claude Code**: com uma imagem e nenhum texto na área de transferência (uma captura de tela, *Copiar Imagem*), ⌘V,
  Editar → Colar e a colagem com clique direito enviam Ctrl+V ao terminal; o Claude Code lê a própria área de transferência do sistema
  e anexa a imagem como `[Image #1]`. Texto na área de transferência é colado como sempre (e prevalece quando
  há os dois); um shell não usa essa tecla e não mostra nada. Um arquivo de imagem solto do Finder num
  painel local cola o caminho dele entre aspas (num painel SSH os arquivos são enviados, veja *Área de transferência* acima).
- **Registro**: Terminal → Iniciar/Parar Registro da Sessão, ou a opção da sessão, grava a saída bruta em
  `~/Documents/MobAlt Logs/`. Ajustes → Registro → *Remover cores e sequências de controle* guarda os
  registros como texto simples (as cores ANSI, os movimentos do cursor e o hook de acompanhamento de pasta são removidos).
- **Temas e aparência**: Ajustes → Terminal → Tema colore o programa inteiro, não só os terminais. A
  barra de ferramentas, a barra lateral, as abas, a barra de estado, os diálogos, os menus, os avisos e as faixas recebem uma paleta de interface derivada
  da escolhida — *Moba Dark* é a interface escura conhecida, *Light* é um app claro com
  painéis quase brancos e texto escuro, *One Dark*, *Dracula*, *Solarized Dark* e *Gruvbox Dark* tingem a
  interface com o seu próprio tom — e os controles nativos e a faixa da barra de título acompanham. Toda cor de texto
  da interface mantém um contraste de pelo menos 4,5:1 com o fundo, em todos os temas. A seleção de tema mostra um
  prompt de exemplo nas cores da própria paleta; Salvar o aplica na hora. Ajustes → Terminal → Fonte vale para todos os
  terminais; uma sessão pode substituir o tema e a fonte na sua aba Terminal — o tema dela colore só o terminal
  daquele painel, a janela mantém o global.

## Arquivos (SFTP / FTP)

![Painel SFTP](images/sftp-panel.png)

O painel **Sftp** acompanha o painel SSH ou FTP ativo. Ele abre automaticamente ao conectar
(Ajustes → Geral → “Abrir o painel Sftp ao conectar via SSH”).

- Navegue clicando duas vezes nas pastas, digitando um caminho (`~` funciona) ou usando ⬆ / 🏠 / ⟳.
  “Seguir terminal” mantém o painel na pasta atual do shell (requer a opção da
  sessão, que injeta um pequeno hook no prompt). `>_` envia `cd` ao terminal.
- Barra de ferramentas e menu de contexto: nova pasta, renomear, permissões, apagar, baixar, enviar. Seleção múltipla
  com ⌘ / ⇧. Arraste arquivos do Finder para a lista para enviá-los; nomes já existentes pedem confirmação antes de substituir.
- Clique duas vezes num arquivo de texto para editá-lo no editor integrado (⌘S salva de volta). “Editar no Editor
  Externo” o abre no seu editor (Ajustes → Geral → Editor externo) e o reenvia a cada gravação.
- As transferências mostram progresso, velocidade e um botão de cancelar; “Mostrar no Finder” depois de um download.
- Os cabeçalhos das colunas ordenam por nome, tamanho ou data. Quando a barra lateral está estreita, a coluna de data some.

## Túneis (encaminhamento de portas)

![Túneis](images/tunnels.png)

`Túneis` (⇧⌘U) gerencia os encaminhamentos de porta SSH:

- **Local (-L)**: `127.0.0.1:8080 → db.internal:5432` através do host SSH.
- **Remoto (-R)**: uma porta no servidor encaminhada de volta a um serviço local.
- **Dinâmico (-D)**: um proxy SOCKS5 local através do servidor.

Inicie um túnel sobre uma conexão aberta ou deixe o MobAlt abrir uma conexão dedicada a uma sessão
salva. Os túneis listados na aba **Túneis** de uma sessão iniciam automaticamente quando essa sessão
se conecta, e você é avisado se algum não conseguir escutar na porta.

## X11, Mosh, Serial, RDP/VNC

- **X11**: marque “Encaminhamento X11” em SSH avançado. O MobAlt inicia o XQuartz quando necessário, encaminha o
  display e troca o cookie de autenticação, de modo que `xeyes` ou `gedit` simplesmente funcionam. A barra de estado mostra a
  disponibilidade do X11.
- **Mosh**: requer `brew install mosh` localmente e `mosh-server` no host (UDP 60000-61000).
  O painel executa o cliente mosh; a inicialização via SSH usa a sua chave, o agente ou um pedido interativo.
  Defina o caminho do `mosh-server` se ele não estiver no PATH remoto.
- **Mosh + SFTP**: o mosh não transporta um canal SFTP, então o painel Sftp navega por um host Mosh através de uma
  conexão SSH separada e sem shell para o mesmo host (mesma chave, agente e pedidos). Ela abre
  automaticamente quando “Abrir o navegador SFTP automaticamente” está ativado na sessão (e “Abrir o painel
  Sftp” em Ajustes → Geral); caso contrário, pelo botão “Abrir SFTP para este host (via SSH)” do painel ou por
  “Abrir Navegador SFTP” no menu do painel; ela é encerrada junto com o painel.
- **Serial**: o editor lista os dispositivos USB-serial; defina baud, bits de dados/parada, paridade, controle de fluxo,
  eco local e o que o Enter envia (CR, LF, CRLF).
- **RDP / VNC**: o MobAlt grava um arquivo `.rdp` e abre o Windows App, ou abre `vnc://` no Compartilhamento
  de Tela. A sessão guarda host, usuário e pasta como qualquer outro favorito.

## Ferramentas e macros

- Painel **Ferramentas**: ping, traceroute, consulta DNS, varredura de portas e informações da rede local, com um botão
  Parar para execuções longas.
- **Wake-on-LAN** (painel Ferramentas): digite o endereço MAC em qualquer grafia (`aa:bb:cc:dd:ee:ff`,
  `aa-bb-…`, `aabb.ccdd.eeff` ou hexadecimal puro) e pressione Despertar: o pacote mágico sai três vezes como
  broadcast UDP (255.255.255.255, porta 9 por padrão; um broadcast dirigido como 192.168.1.255
  alcança outra sub-rede). Os 10 últimos endereços são memorizados com um rótulo opcional e sugeridos
  enquanto você digita.
- **Varredura de rede** (painel Ferramentas): varra um CIDR (`192.168.1.0/24`), um intervalo (`10.0.0.1-10.0.0.50`
  ou `10.0.0.1-50`) ou um único host, até um /16, por ping ICMP e/ou conexões TCP a uma lista curta de portas
  (22, 80, 443, 3389, 5900 por padrão), com paralelismo e tempo limite ajustáveis e uma consulta de DNS
  reverso para cada resultado. Os hosts que respondem aparecem numa tabela ordenável à medida que são encontrados (IP, nome do host,
  tempo de ida e volta, portas abertas), enquanto a barra de progresso conta `123/254`; Parar cancela, ＋ abre o
  editor de sessão com SSH para aquele host já preenchido, e “Copiar texto” põe a tabela na área de transferência.
- Painel **Macros**: grave as teclas digitadas num terminal (● Gravar / ■ Parar), salve-as com um nome e
  reproduza-as no terminal ativo ou em todos os terminais. Macros de texto podem ser digitadas diretamente;
  sequências de escape como `\n` ou `\x1b[A` são suportadas.

## Espaço de trabalho e ajustes

O MobAlt restaura as suas abas, divisões e sessões (as abas movidas para janelas próprias voltam como janelas) na próxima inicialização e reconecta as sessões SSH
(os shells locais reabrem na última pasta). Desative isso em Ajustes → Geral → Comportamento.

![Ajustes](images/settings.png)

Os Ajustes têm cinco abas, e cada uma cabe na menor janela sem rolagem: **Geral**
(o idioma da interface, a confirmação ao encerrar, a mudança para o painel SFTP, a restauração do espaço de trabalho, o shell local e a sua
integração de pasta, o editor externo, a pasta de downloads, o keep-alive SSH e “Abrir pasta de configuração”,
que mostra onde tudo é guardado), **Terminal** (fonte, altura da linha, cursor, histórico, tema — a aparência da janela
inteira, veja *Temas e aparência* —, mouse/teclas, e o que *Desfazer divisão* faz com os outros painéis de uma aba dividida: movê-los
para abas próprias, fechá-los ou perguntar sempre), **Recursos** (a proteção de colagem, a barra de monitoramento remoto e o seu intervalo
de atualização, o realce de palavras-chave e a sua tabela de regras, e as transferências Zmodem), **Registro** (pasta de registros, registros de sessão em texto simples) e **Atualizações** (a verificação ao iniciar
e “Verificar agora”).

### Idioma da interface

Os menus, a barra de ferramentas, os painéis, os diálogos e as mensagens do MobAlt estão disponíveis em onze idiomas: English, 한국어, 简体中文, 日本語,
Tiếng Việt, हिन्दी, Deutsch, Français, Español, Português e العربية (em árabe, a janela é espelhada: barra lateral à direita,
texto alinhado à direita; os terminais continuam da esquerda para a direita). Por padrão (**Padrão do sistema**), a interface segue
a lista de idiomas do macOS (Ajustes do Sistema → Geral → Idioma e Região): vence o primeiro idioma dessa lista que
o MobAlt oferece, e o inglês quando nenhum deles é oferecido. Ajustes → Geral → **Idioma** escolhe um explicitamente; a mudança
vale na hora em todas as janelas — nada reinicia, as conexões continuam ativas — e fica memorizada. A saída do terminal nunca é
traduzida: o que um host remoto escreve é mostrado como está. O guia do usuário existe nos mesmos onze idiomas
(`docs/USER_GUIDE.<language>.md`); Ajuda → **Guia do Usuário** abre o do idioma atual.

Em árabe, a janela inteira é lida da direita para a esquerda: a faixa lateral e a barra lateral vão para a borda direita e os
terminais para a esquerda, o botão ‹ de ocultar da barra lateral aponta para o outro lado, a barra de ferramentas, a faixa de abas (a primeira aba
à direita, com os botões de rolagem ‹ › trocados), a barra de estado, os cabeçalhos dos painéis laterais, os cabeçalhos dos painéis e a barra de monitoramento
são espelhados, os diálogos põem os rótulos à direita e o ✕ à esquerda, os menus abrem à esquerda do ponteiro e os avisos se empilham
no canto inferior esquerdo. O que continua da esquerda para a direita: os próprios terminais e todo campo ou rótulo que contém um host, uma
porta, um caminho, um comando, um padrão, um MAC ou CIDR, uma chave ou um atalho (conexão rápida, o caminho do SFTP, a caixa de busca,
as caixas do painel Ferramentas, a pasta e o usuário@host da barra de estado, as etiquetas de teclas, as impressões digitais, a chave pública do
gerador de chaves, a pré-visualização da proteção de colagem); o nome de uma sessão, aba ou pasta segue a sua própria primeira letra, então um nome em árabe
é lido da direita para a esquerda e `user@host` da esquerda para a direita, e um caminho ou nome de host citado numa mensagem mantém a sua própria ordem.
As divisões mantêm o sentido físico — "Dividir à Direita" continua abrindo o novo painel à direita, e uma sessão solta na
borda direita de um painel vai parar ali. As teclas de seta seguem a ordem das coisas, não a tela: → vai para a próxima aba,
opção ou linha (que em árabe é a da esquerda) e ← para a anterior, e na árvore de sessões → abre uma
pasta e ← a fecha, como em português.

Para usar o MobAlt num idioma uma única vez sem mudar o ajuste (capturas de tela, um teste), inicie-o com `MOBALT_LANG=<code>`
no ambiente (`en`, `ko`, `zh-CN`, `ja`, `vi`, `hi`, `de`, `fr`, `es`, `pt`, `ar`).

## Atalhos de teclado

| Ação | Teclas |
|---|---|
| Nova sessão / terminal local / conexão rápida | ⌘N / ⌘T / ⇧⌘N |
| Duplicar / reconectar / fechar aba / fechar painel | ⇧⌘T / ⌘R / ⌘W / ⇧⌘W |
| Fixar / desafixar a aba ativa | ⇧⌘P |
| Mover a aba ativa para uma janela própria | ⌥⌘N |
| Fechar outras abas / abas à esquerda / abas à direita | Menu Sessão, ou o menu de contexto da aba |
| Dividir à direita / abaixo, desfazer divisão | ⌘D / ⇧⌘D, ⌥⌘1 |
| Grade de 2 / 4 / 6 / 8 painéis | ⌥⌘2 / ⌥⌘4 / ⌥⌘6 / ⌥⌘8 |
| Painel seguinte, aba seguinte / anterior, aba 1-9 | ⌘] , ⌃Tab / ⌃⇧Tab, ⌃⌘1-9 |
| Maximizar painel (preencher a aba) / restaurar o layout | ⇧⌘⏎ |
| Buscar, limpar, zoom | ⌘F, ⌘K, ⌘= / ⌘- / ⌘0 |
| Barra lateral, Sessões / SFTP / Ferramentas / Macros | ⌘B, ⌘1 / ⌘2 / ⌘3 / ⌘4 |
| MultiExec, túneis, ajustes | ⇧⌘M, ⇧⌘U, ⌘, |
| Quebra de linha em apps TUI | ⇧Enter ou ⌥Enter |
| Diálogo da proteção de colagem (colagem de várias linhas ou suspeita): colar / cancelar | ⌘⏎ / Esc |
| Aba em foco: mover / ativar / fechar, menu de contexto | ← → / ⏎ / ⌫, ⇧F10 ou a tecla Menu |
| Linha de sessão em foco: mover / recolher / abrir / abrir em divisão / apagar | ↑ ↓ / ← → / ⏎ / ⌘⏎ ou ⇧⏎ / ⌫ |
| Linha de sessão ou pasta em foco: menu de contexto (pastas: Mover para Pasta…) | ⇧F10 ou a tecla Menu |
| Macro em foco: mover / reproduzir / apagar, menu de contexto | ↑ ↓ / ⏎ / ⌫, ⇧F10 ou a tecla Menu |
| Lista SFTP: mover / abrir / pasta superior / apagar, menu de contexto | ↑ ↓ Home End PgUp PgDn / ⏎ / ⌫ / Del, ⇧F10 ou a tecla Menu |
| Lista SFTP: estender a seleção / alternar a linha em foco / selecionar tudo | ⇧↑ ⇧↓ ⇧Home ⇧End / Espaço / ⌘A |
| Lista SFTP: ordenar por uma coluna | Tab até o cabeçalho Nome / Tamanho / Modificado, ⏎ ou Espaço |
| Árvore de sessões e lista SFTP: ir até um nome | digite as primeiras letras, espaços incluídos (a mesma letra de novo: próxima correspondência) |
| Seletores de ícone e cor no editor de sessão: mover / escolher | ← → ↑ ↓ / ⏎ ou Espaço |
| Botões de painel da faixa lateral / ⌘1-4 | ⏎ leva o teclado para dentro do painel; trocar de painel lembra onde ele estava |

Ajuda → Atalhos de Teclado mostra a mesma lista dentro do app. O Tab alcança a barra de ferramentas, a faixa
lateral, a árvore de sessões, a lista de macros, a lista SFTP e a faixa de abas (cada lista é uma parada de
Tab; as setas se movem dentro dela); os diálogos mantêm o Tab dentro deles e, ao fechar, devolvem o foco à aba,
linha ou botão que os abriu; os menus de contexto aceitam ↑ ↓ / ⏎ / Esc. Esc no
filtro de sessões ou na caixa de conexão rápida a limpa e volta ao terminal.


## Dados e privacidade

Tudo fica em `~/Library/Application Support/MobAlt/`: `sessions.json` (senhas e
frases secretas cifradas pelas Chaves do macOS), `settings.json`, `known_hosts`,
`workspace.json` e os arquivos de integração do zsh. Os registros de sessão vão para `~/Documents/MobAlt Logs/`.
O MobAlt só se conecta aos hosts que você configura; a verificação de atualizações opcional lê a lista de versões
no GitHub e nada mais. Detalhes: [SECURITY.md](../SECURITY.md).

## Solução de problemas

- **“Timed out while waiting for handshake” / ETIMEDOUT**: nada respondeu nessa porta. Verifique
  o endereço, a VPN e o encaminhamento no roteador; experimente `nc -vz host port` num terminal local.
- **“falha na autenticação — o servidor aceita: …; tentado: …”** (*authentication failed — server accepts: …; tried: …*): o servidor não aceitou o que o MobAlt
  ofereceu. Compare a lista “aceita” com o método de autenticação da sua sessão; para servidores
  que só aceitam chave, escolha o arquivo de chave certo. Falhas repetidas podem fazer o seu IP ser banido por um tempo pelo fail2ban ou pelas
  penalidades por origem do sshd.
- **“sem troca de chaves / chave do host / cifra / MAC em comum: esta sessão oferece …; o servidor oferece …”**:
  os dois lados não têm nenhum algoritmo em comum. A mensagem lista o que o servidor fala: adicione um
  deles em SSH avançado → Algoritmos (ou *Restaurar padrões*); para um equipamento antigo que só
  oferece SHA-1 / CBC, marque “Algoritmos antigos (equipamentos velhos)”.
- **A chave do host mudou**: o servidor foi reinstalado, ou algo está interceptando a conexão.
  Só aceite se souber o motivo; a chave antiga pode ser removida do `known_hosts` na pasta de configuração.
- **O app X11 não aparece**: instale o XQuartz e verifique se o shell remoto não substitui
  `DISPLAY` nos seus arquivos de inicialização.
- **Mosh**: “cliente mosh não encontrado” significa que falta o `brew install mosh` localmente;
  “mosh-server not found” significa que ele falta no host ou não está no PATH dele (defina o caminho na
  sessão).
- **Aviso do Gatekeeper num app compilado por você**: clique direito → Abrir uma vez, ou
  `xattr -dr com.apple.quarantine /Applications/MobAlt.app`.
- **`hdiutil: attach failed – Resource busy` ao executar `brew upgrade --cask mobalt`**: outro processo do Homebrew
  (por exemplo `brew audit` ou `brew fetch`) estava com o mesmo DMG montado naquele momento. Basta executar o comando
  de novo.
