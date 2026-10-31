# Guide de l'utilisateur de MobAlt

This guide in: [English](USER_GUIDE.md) · [한국어](USER_GUIDE.ko.md) · [简体中文](USER_GUIDE.zh-CN.md) · [日本語](USER_GUIDE.ja.md) · [Tiếng Việt](USER_GUIDE.vi.md) · [हिन्दी](USER_GUIDE.hi.md) · [Deutsch](USER_GUIDE.de.md) · [Français](USER_GUIDE.fr.md) · [Español](USER_GUIDE.es.md) · [Português](USER_GUIDE.pt.md)

MobAlt est un poste de travail à la manière de MobaXterm pour macOS : une arborescence de sessions à gauche, des
terminaux en onglets et en volets au centre, et un navigateur SFTP, des outils réseau et des macros dans les panneaux latéraux.

Voir aussi : [Parité fonctionnelle avec MobaXterm 26.6](MOBAXTERM_PARITY.md) — ce que MobAlt propose, ce qui lui manque et ce qu'il fait autrement, avec la feuille de route.

![MobAlt avec deux shells distants côte à côte](images/hero.png)

Sommaire : [Installation](#installation) · [Mises à jour](#mises-à-jour) · [Sessions](#sessions) · [Connexion](#connexion) ·
[Terminal](#terminal) · [Fichiers (SFTP / FTP)](#fichiers-sftp--ftp) · [Tunnels](#tunnels-redirection-de-port) ·
[X11, Mosh, série, RDP/VNC](#x11-mosh-série-rdpvnc) · [Outils et macros](#outils-et-macros) ·
[Espace de travail et réglages](#espace-de-travail-et-réglages) · [Raccourcis clavier](#raccourcis-clavier) ·
[Données et confidentialité](#données-et-confidentialité) · [Dépannage](#dépannage)

## Installation

- **Homebrew** : `brew tap Hyeongcheol-An/tap && brew trust Hyeongcheol-An/tap && brew install --cask mobalt`
  (Homebrew 7 vous demande une seule fois de faire confiance à un tap tiers ; `brew upgrade --cask mobalt` fait les mises à jour ensuite)
- **DMG** : téléchargez le DMG Apple Silicon (`arm64`) ou Intel (`x64`) depuis
  [Releases](https://github.com/Hyeongcheol-An/MobAlt/releases) et faites glisser MobAlt dans Applications.

Les versions publiées sont signées et notariées. Configuration requise : macOS 13 ou ultérieur. Compléments facultatifs :
[XQuartz](https://www.xquartz.org/) pour le transfert X11, `brew install mosh` pour les sessions Mosh,
Windows App pour RDP.

Au démarrage, MobAlt cherche une version plus récente dans les GitHub Releases et la propose dans un dialogue ; rien n'est
téléchargé ni installé sans votre confirmation. Voir [Mises à jour](#mises-à-jour).

## Mises à jour

Trois chemins mènent à une nouvelle version ; tous aboutissent au nouveau paquet dans `/Applications/MobAlt.app` :

- **Mise à jour intégrée** : MobAlt consulte les GitHub Releases au démarrage (à désactiver dans Réglages → Mises à jour), et
  Aide (Help) → Rechercher les mises à jour… ou « Vérifier » dans Réglages → Mises à jour lance la vérification à la main. Une
  version plus récente est proposée dans un dialogue, téléchargée seulement si vous le décidez et installée quand vous quittez, ou
  tout de suite avec « Redémarrer ».
- **Homebrew** : `brew upgrade --cask mobalt` remplace l'app dans Applications.
- **DMG** : téléchargez le nouveau DMG depuis [Releases](https://github.com/Hyeongcheol-An/MobAlt/releases) et
  faites glisser MobAlt dans Applications pour remplacer l'ancien.

Les mises à jour intégrées et Homebrew font bon ménage. Avec « Rechercher les mises à jour au démarrage » activé (Réglages → Mises à jour), MobAlt se
tient à jour tout seul, et `brew upgrade --cask mobalt` reste sans risque : si l'app s'est déjà mise à jour,
Homebrew réinstalle simplement la version déjà présente. Comme le cask déclare `auto_updates`,
un simple `brew upgrade` (sans nom de cask) ignore MobAlt sauf avec `--greedy` ; nommez le cask, ou ajoutez
`--greedy`, si vous voulez que Homebrew se charge de la mise à jour.

Mettre à jour pendant que MobAlt tourne ne pose aucun problème — même depuis l'un des terminaux de MobAlt. L'app en cours
continue d'exécuter l'ancienne version depuis la mémoire, repère le nouveau paquet sur le disque (en moins d'une minute, ou dès que la
fenêtre reprend le focus) et affiche un bandeau au-dessus des onglets : *MobAlt 0.11.0 est installé sur le disque — vous exécutez
0.10.1. Relancez pour l'utiliser.* **Relancer** pose d'abord la question des connexions SSH/FTP ouvertes (comme ⌘Q),
enregistre l'espace de travail et démarre la nouvelle version ; vos onglets reviennent grâce à la restauration de l'espace de travail. **Plus tard**
masque le bandeau jusqu'à l'apparition d'une autre version. Si le nouveau paquet est déjà sur le disque quand la mise à jour
s'exécute, rien n'est téléchargé à nouveau : la vérification indique « MobAlt 0.11.0 est déjà installé sur le disque ; relancez pour
l'utiliser » et propose la même relance.

## Sessions

Le panneau **Sessions** est votre arborescence de signets. Créez une session avec `＋ Session` (⌘N), choisissez un type
et remplissez l'onglet Base. Double-cliquez sur une session pour vous connecter ; le clic droit ouvre le menu contextuel
(ouvrir, ouvrir dans un volet à droite / en dessous, modifier, dupliquer, supprimer, démarrer un tunnel, nouvelle session dans ce dossier).

![Éditeur de session](images/session-editor.png)

| Type | Rôle |
|---|---|
| SSH | Terminal via SSH avec navigateur SFTP, tunnels, transfert X11 et transfert d'agent |
| Mosh | Terminal itinérant via le client `mosh` (amorcé par SSH) |
| Local | Votre shell de connexion macOS (zsh/bash) avec suivi du dossier |
| Telnet | Telnet classique avec négociation NAWS/TTYPE |
| Serial | Console série USB (débit, trame, contrôle de flux, écho local) |
| FTP | Navigateur de fichiers FTP / FTPS (TLS explicite) dans le panneau Sftp |
| RDP / VNC | Délègue à Windows App ou au Partage d'écran de macOS |

**Dossiers** : le bouton dossier de l'en-tête du panneau (Nouveau dossier) crée un dossier ; faites glisser sessions et dossiers pour les déplacer (déposez-les dans la zone vide
pour la racine). Le menu contextuel d'un dossier peut ouvrir toutes ses sessions en grille ou en onglets.

**Icônes et couleurs** : choisissez un emoji et une couleur dans l'éditeur. Ils apparaissent sur la ligne, l'onglet et
l'en-tête du volet : une session « production » rouge se confond difficilement avec une session « staging » verte.

**Importation / exportation** : le pied du panneau importe `~/.ssh/config` (hôtes, utilisateurs, ports, clés, ProxyJump) et un
fichier MobaXterm `MobaXterm.ini` (signets). Exportez ou importez toutes les sessions en JSON depuis le menu contextuel de
l'arborescence. Le fichier JSON contient chaque session et chaque dossier, mais jamais de mot de passe ni de phrase secrète : ceux-ci restent dans
le stockage chiffré de MobAlt sur ce Mac, et le fichier note seulement qu'un mot de passe a été enregistré (`hasPassword`) ; une
session importée sur un autre Mac le demande donc à sa première connexion. L'importation fusionne avec ce que vous avez : une session
dont l'`id` correspond à une session existante est remplacée par la version du fichier (un mot de passe enregistré ici pour elle est conservé),
toutes les autres sont ajoutées — une entrée écrite à la main sans `id` est toujours ajoutée, et un `password` écrit
dans le fichier est repris et stocké chiffré — les dossiers sont ajoutés et rien n'est supprimé : importer deux fois le même
fichier ne change rien. Les entrées sans nom, d'un type inconnu ou avec un port incorrect sont ignorées et
comptées dans la notification ; un fichier qui n'est pas un fichier de sessions MobAlt est refusé, avec la raison. `~/.ssh/config`
ignore les hôtes que vous avez déjà (même dossier et même nom). Les signets MobaXterm vont dans un dossier `MobaXterm` ; un signet
importé auparavant (même dossier, nom et hôte) est actualisé sur place — hôte, port, utilisateur, X11 et compression
suivent le `.ini`, tandis que son mot de passe enregistré, son icône, sa couleur, ses tunnels et un chemin de clé que vous avez défini restent — si bien qu'importer
deux fois le même `.ini` ne change rien non plus.

**Commandes de démarrage** (onglet Terminal) : une commande par ligne, saisie dans le terminal dès qu'il est
prêt. Pour SSH, juste après la connexion ; pour les shells locaux, juste après l'apparition de l'invite. Exemple :
une session locale avec *Dossier de démarrage* réglé sur un projet et `claude --resume <id>` comme commande.
Le *Dossier de démarrage* d'une session locale accepte un chemin saisi en entier ou choisi avec son bouton Parcourir…, qui ouvre un
dialogue de dossier et laisse le champ tel quel si vous annulez.

## Connexion

- **Connexion rapide** : saisissez `user@host[:port]` dans la barre d'outils et appuyez sur Entrée. Les préfixes choisissent le
  type : `ssh://`, `mosh://`, `telnet://`, `ftp://`, `ftps://`, `rdp://`, `vnc://`. Si une session enregistrée
  correspond, elle est utilisée.
- **Authentification** : *Automatique* essaie une clé configurée, le mot de passe enregistré, l'agent SSH et les
  clés par défaut de `~/.ssh` avant de demander quoi que ce soit. Choisissez *Mot de passe*, *Clé privée* ou *Agent SSH* pour
  la restreindre. Les clés protégées par une phrase secrète la demandent une fois ; cochez « Enregistrer dans la session » pour la conserver.
- **Clés d'hôte** : la première connexion affiche l'empreinte (SHA256 et MD5). Accepter enregistre la
  clé ; une clé modifiée est signalée bien visiblement et n'est jamais acceptée en silence.
- **Clés SSH** : Session → Générer une clé SSH… (aussi dans le panneau Outils, et *Générer…* à côté du
  champ de clé privée dans l'éditeur de session) exécute pour vous le `ssh-keygen` de macOS : Ed25519 (par défaut),
  RSA 4096 ou ECDSA, un commentaire, une phrase secrète facultative avec une indication de robustesse, et le fichier (par défaut
  `~/.ssh/id_<type>`, numéroté si ce nom est pris ; `~/.ssh` est créé en accès privé s'il manque,
  les fichiers finissent en 0600 / 0644). La clé publique s'affiche avec un bouton Copier et l'empreinte.
  « Ajouter à ssh-agent » exécute `ssh-add --apple-use-keychain` ; « Installer sur un serveur… » se connecte à une session
  enregistrée avec son authentification habituelle et ajoute la clé publique à son `~/.ssh/authorized_keys`
  comme `ssh-copy-id` (jamais en double). Depuis l'éditeur, *Utiliser dans cette session* remplit le champ de clé.
- **Algorithmes** : SSH avancé → Algorithmes liste ce que la session propose pour l'échange de clés, la clé
  d'hôte, les chiffrements et les MAC, prérempli avec les valeurs intégrées par défaut ; modifiez une liste pour la restreindre ou la réordonner
  (les noms inconnus sont refusés sur place), *Rétablir les valeurs par défaut* remet les listes en l'état, et « Algorithmes
  hérités (anciens appareils) » est un préréglage qui ajoute les échanges de clés SHA-1, les chiffrements CBC et les clés d'hôte DSA
  dont les vieux équipements ont encore besoin. Seules les listes qui diffèrent des valeurs par défaut sont enregistrées.
- **Hôtes de rebond** : SSH avancé → Hôte de rebond choisit une autre session enregistrée comme bastion (ProxyJump).
- **En cas d'échec** : le terminal affiche ce qui s'est passé, par exemple
  `échec de l'authentification — le serveur accepte : publickey ; essayé : ~/.ssh/id_ed25519`, ou indique que
  rien n'a répondu sur le port. Voir [Dépannage](#dépannage).

## Terminal

![Grille de volets](images/split-grid.png)

- **Onglets** : chaque session ouvre un onglet. Faites glisser les onglets pour les réordonner, double-cliquez pour renommer, clic du milieu
  pour fermer. Les onglets locaux portent le nom de leur dossier actuel. Le menu contextuel de l'onglet (clic droit, ou
  ⇧F10 sur l'onglet actif) renomme, duplique, colore, divise et ferme : *Fermer les autres*, *Fermer les onglets
  à gauche*, *Fermer les onglets à droite* et *Tout fermer* ferment plusieurs onglets d'un coup et posent une seule question
  qui compte toutes les connexions actives concernées (« Fermer 3 onglets avec 2 connexions actives ? »).
- **Onglets épinglés** (*Épingler l'onglet* dans le menu, ⇧⌘P) : un onglet épinglé se place à gauche de la barre, dans l'ordre
  où les onglets ont été épinglés, et se réduit à son point d'état, son icône et un titre court, avec une petite punaise à la place
  du ✕. Les fermetures groupées ci-dessus et le clic du milieu épargnent les onglets épinglés (⌘W, *Fermer* dans le menu
  et ⌫ sur l'onglet actif en ferment toujours un), et un onglet épinglé ne peut pas être glissé au-delà d'un onglet non épinglé.
  Les épingles font partie de l'espace de travail : elles reviennent après un redémarrage. *Désépingler l'onglet* place l'onglet juste
  après le bloc épinglé.
- **Détacher un onglet dans sa propre fenêtre** (*Détacher dans une nouvelle fenêtre* dans le menu de l'onglet, ⌥⌘N, ou le menu
  Session) : l'onglet passe dans une seconde fenêtre MobAlt et garde ses terminaux — rien ne se reconnecte ni ne
  redémarre. La nouvelle fenêtre redessine les 256 derniers Ko de la sortie de chaque terminal et continue à partir de là ;
  un onglet divisé emporte tous ses volets. La fenêtre a la même barre d'outils, les mêmes menus et raccourcis, et
  s'ouvre avec la barre latérale repliée (⌘B l'y affiche) ; MultiExec est propre à chaque fenêtre. Une deuxième fenêtre détachée
  s'ouvre décalée par rapport à la première, pour qu'aucune n'en cache une autre. Fermer une fenêtre détachée rend ses onglets
  à la fenêtre principale avec leurs sessions toujours actives — cela ne met jamais fin à une session ; fermer son
  dernier onglet (⌘W) ferme la fenêtre elle-même, puisqu'il ne reste rien à rendre ; fermer la fenêtre principale
  quitte MobAlt, fenêtres détachées comprises. L'espace de travail mémorise
  les fenêtres détachées et les rouvre au lancement suivant, en reconnectant leurs sessions comme celles de la fenêtre
  principale. Les onglets ne peuvent pas être glissés d'une fenêtre à l'autre : fermez la fenêtre pour les récupérer, ou détachez-les
  à nouveau depuis là.
- **Divisions et grilles** : `Diviser ▾` (⌘D à droite, ⇧⌘D en dessous) ajoute un volet vide ; les entrées de grille créent
  des dispositions de 1×2 à 2×4 (⌥⌘2/4/6/8). Déposez une session de l'arborescence sur un volet vide pour vous y connecter,
  sur le bord d'un volet pour diviser dans cette direction, ou en son centre pour le remplacer. Faites glisser un onglet sur
  un volet pour déplacer ce terminal dans la division. ⌥⌘1 (Présentation → Annuler la division, `Diviser ▾` → Annuler la division) annule la division de
  l'onglet : par défaut, chaque autre volet devient un onglet à part, placé juste après l'onglet actuel dans
  l'ordre des volets, avec son terminal, son titre et son état tels quels — rien ne se reconnecte, aucune sortie n'est perdue ;
  le volet actif garde l'onglet. Réglages → Terminal → **Annuler la division** choisit un autre comportement : *Garder le
  volet actif, fermer les autres* (les autres volets se ferment, avec la question habituelle si des connexions actives
  devaient être coupées) ou *Demander à chaque fois* (un petit dialogue propose *Volets en onglets*, *Garder uniquement ce volet* ou
  Annuler, qui conserve la division). Un onglet à un seul volet n'est pas touché, et un volet agrandi est d'abord rétabli.
- **Agrandir un volet** (⇧⌘⏎, le bouton ⤢ de l'en-tête du volet, ou `Diviser ▾` → Agrandir le volet) : le volet
  actif remplit l'onglet, comme le zoom de tmux ou la maximisation d'iTerm2. Les autres volets restent connectés mais
  masqués ; l'en-tête du volet affiche une pastille *agrandi* et l'onglet un petit ⤢. Recommencez (ou ⤡ dans l'en-tête)
  pour rétablir la disposition. Diviser, fermer un volet, choisir une disposition en grille ou activer un volet masqué (⌘])
  rétablit d'abord la disposition. Chaque onglet garde son propre agrandissement, y compris après un redémarrage.
- **MultiExec** (⇧⌘M) : tant qu'il est activé, chaque frappe va à tous les terminaux visibles à l'écran — les
  volets actifs de l'onglet actif, ou seulement le volet agrandi quand l'un d'eux remplit l'onglet. Les autres onglets ne
  la reçoivent jamais : divisez donc l'onglet (ou utilisez une grille) pour placer côte à côte les serveurs à piloter.
  Le bandeau indique combien de terminaux visibles écoutent et suit l'onglet vers lequel vous basculez.
- **Barre de surveillance distante** : chaque volet SSH affiche une bande d'une ligne sous son en-tête — CPU, mémoire utilisée / totale,
  disque racine utilisé, débits réseau ↓ / ↑, charge moyenne, durée d'activité et nom d'hôte — actualisée toutes les 3 s (Réglages →
  Fonctions → Surveillance, 2 à 30 s). Un petit extrait POSIX `sh` s'exécute via la connexion de la session elle-même : il
  ne demande pas de seconde connexion, fonctionne à travers les hôtes de rebond et n'écrit jamais dans le terminal ; les hôtes Linux sont lus depuis
  `/proc`, macOS et les BSD via `sysctl`, `vm_stat` et `netstat`. Un hôte qui ne peut pas l'exécuter (pas de `sh`,
  permission refusée) affiche un *surveillance indisponible* atténué et n'est plus interrogé avant de se reconnecter. Les relevés s'interrompent
  tant que le volet n'est pas à l'écran (autre onglet au premier plan, volet voisin agrandi, fenêtre masquée) et reprennent quand il
  revient. Désactivez-la par session (SSH avancé → *Afficher la barre de surveillance distante*), par volet (le bouton pouls
  de l'en-tête du volet, Présentation → Barre de surveillance distante, ou le menu contextuel du terminal) ou pour toutes les sessions dans
  Réglages. Un volet Mosh n'a pas de canal SSH propre : sa barre passe par la connexion SFTP associée
  tant que celle-ci est ouverte.
- **Rechercher** (⌘F) : recherche incrémentale avec options de casse et d'expression régulière, et un compteur de correspondances.
- **Surlignage des mots-clés** : erreurs, avertissements, OK/done, adresses IP, URL et tailles (`512M`, `3.2GB`) sont
  colorés à leur arrivée, avec des couleurs tirées du thème du terminal pour rester lisibles sur toutes les palettes.
  Réglages → Fonctions → *Surlignage* le désactive ; *Règles…* ouvre le tableau — chaque règle est un
  texte brut ou une expression régulière, avec ignorer la casse, une couleur, un arrière-plan facultatif, gras et souligné ;
  *Restaurer les valeurs par défaut* rétablit le jeu intégré. Quand des règles se chevauchent, la correspondance la plus précoce l'emporte, puis la
  plus longue. L'onglet Terminal d'une session peut le forcer à activé ou désactivé (*Surlignage : Par défaut (Réglages) / Activé / Désactivé*).
  Seules les lignes nouvellement écrites sont analysées (les apps plein écran comme vim ne sont pas touchées) ; au plus 2 000 correspondances
  restent décorées par terminal — lors d'une longue rafale, les lignes les plus anciennes redeviennent brutes en premier — et ⌘K les efface toutes.
- **Zmodem (rz/sz)** : transférez des fichiers par le terminal lui-même, à l'ancienne, via une console série ou un hôte de rebond
  où SFTP n'est pas disponible. Lancez `sz fichier …` sur l'hôte distant pour télécharger vers le Mac, ou `rz` pour y envoyer depuis le Mac ; MobAlt
  repère le transfert dans le flux, met le terminal en pause et l'affiche dans la liste des transferts du panneau Sftp (avec Annuler)
  et dans le compteur de la barre d'état. Les téléchargements vont dans le dossier Téléchargements (Réglages → Général), ou dans un dossier que vous choisissez s'il
  n'est pas défini ; les envois ouvrent un sélecteur de fichiers. Fonctionne dans les volets SSH, locaux, telnet et série — pas Mosh (son flux est celui du
  client mosh, pas un flux d'octets brut). Désactivez-le avec Réglages → Fonctions → Transferts → *Transferts Zmodem (rz/sz)* (activé par défaut) ;
  désactivé, les octets de `rz`/`sz` s'affichent simplement comme des caractères parasites, comme avant. Ctrl-C dans le volet ou Annuler dans la liste
  met fin à un transfert : le `sz`/`rz` distant reçoit l'ordre de s'arrêter, ce qu'il avait encore en vol est absorbé au lieu d'être affiché,
  et l'invite revient en moins d'une seconde ; un `sz` distant qui meurt est détecté en quelques secondes. Un deuxième téléchargement
  du même nom arrive sous `name (1).ext` et est listé sous ce nom.
- **Presse-papiers** : sélectionner copie (Réglages → Terminal → Copier à la sélection) ; le clic droit colle
  (⇧ clic droit ouvre le menu). Déposer des fichiers du Finder sur un terminal SSH les envoie ;
  sur un terminal local, cela colle leurs chemins.
- **Garde-collage** : un collage de plus d'une ligne (ou de plus de 1000 caractères) demande d'abord confirmation — *Coller N
  lignes dans … ?* montre le texte dans un aperçu modifiable ; ⌘⏎ colle, Échap annule. Chaque collage est aussi
  inspecté pour ce que le presse-papiers ne montre pas : caractères sans chasse et bidi, espaces insécables (une espace
  à l'œil, une partie du mot pour le shell), caractères de contrôle, saut de ligne final (la dernière ligne
  s'exécuterait aussitôt), retour chariot au milieu d'une ligne, `curl … | sh`,
  écritures dans `~/.zshrc` et consorts ou dans `~/.ssh/authorized_keys`, commandes du genre `rm -rf /` et mots
  latins contenant des lettres cyrilliques ou grecques trompeuses. Les problèmes sont listés et marqués dans l'aperçu ;
  *Coller nettoyé* retire les caractères cachés et le saut de ligne final, *Coller tel quel* envoie le texte
  sans changement. Les deux vérifications sont des cases de Réglages → Fonctions → Garde-collage (activées par défaut) ; elles couvrent ⌘V,
  le clic droit et le texte déposé sur un volet, pas les macros. Avec MultiExec activé, une seule confirmation vaut pour tous les
  terminaux visibles.
- **Touches** : Maj+Entrée et Option+Entrée envoient ESC+CR (un saut de ligne dans les apps TUI comme Claude Code) ;
  Option sert de Meta par défaut.
- **Journalisation** : Terminal → Démarrer/Arrêter le journal de session, ou l'option de session, écrit la sortie brute dans
  `~/Documents/MobAlt Logs/`. Réglages → Journaux → *Retirer les couleurs et séquences de contrôle* garde plutôt les
  journaux en texte brut (couleurs ANSI, déplacements du curseur et hook de suivi de dossier retirés).
- **Thèmes et apparence** : Réglages → Terminal → Thème colore tout le programme, pas seulement les terminaux. La
  barre d'outils, la barre latérale, les onglets, la barre d'état, les dialogues, les menus, les notifications et les bandeaux prennent une palette d'interface dérivée
  de celle choisie — *Moba Dark* est l'interface sombre habituelle, *Light* une application claire avec
  des panneaux presque blancs et du texte sombre, *One Dark*, *Dracula*, *Solarized Dark* et *Gruvbox Dark* teintent
  l'interface de leur propre couleur — et les contrôles natifs ainsi que la bande de la barre de titre suivent. Chaque couleur de texte de
  l'interface garde un contraste d'au moins 4,5:1 avec son arrière-plan, dans tous les thèmes. Le menu des thèmes montre une
  invite d'exemple dans les couleurs de la palette ; Enregistrer l'applique aussitôt. Réglages → Terminal → Police s'applique à tous
  les terminaux ; une session peut remplacer thème et police dans son onglet Terminal — son propre thème ne colore que le terminal de
  ce volet, la fenêtre garde le thème global.

## Fichiers (SFTP / FTP)

![Panneau SFTP](images/sftp-panel.png)

Le panneau **Sftp** suit le volet SSH ou FTP actif. Il s'ouvre automatiquement à la connexion
(Réglages → Général → « Afficher SFTP à la connexion SSH »).

- Naviguez en double-cliquant sur les dossiers, en saisissant un chemin (`~` fonctionne) ou avec ⬆ / 🏠 / ⟳.
  « Suivre le terminal » garde le panneau sur le dossier actuel du shell (nécessite l'option de session,
  qui injecte un petit hook d'invite). `>_` envoie `cd` au terminal.
- Barre d'outils et menu contextuel : nouveau dossier, renommer, permissions, supprimer, télécharger, envoyer. Sélection multiple
  avec ⌘ / ⇧. Faites glisser des fichiers du Finder sur la liste pour les envoyer ; les noms existants demandent confirmation avant d'être écrasés.
- Double-cliquez sur un fichier texte pour le modifier dans l'éditeur intégré (⌘S l'enregistre sur le serveur). « Modifier dans un éditeur
  externe » l'ouvre dans votre éditeur (Réglages → Général → Éditeur externe) et le renvoie à chaque enregistrement.
- Les transferts affichent la progression, la vitesse et un bouton d'annulation ; « Afficher dans le Finder » après un téléchargement.
- Les en-têtes de colonne trient par nom, taille ou date. Quand la barre latérale est étroite, la colonne de date se masque.

## Tunnels (redirection de port)

![Tunnels](images/tunnels.png)

`Tunnels` (⇧⌘U) gère les redirections de port SSH :

- **Local (-L)** : `127.0.0.1:8080 → db.internal:5432` via l'hôte SSH.
- **Distant (-R)** : un port du serveur redirigé vers un service local.
- **Dynamique (-D)** : un proxy SOCKS5 local via le serveur.

Démarrez un tunnel sur une connexion ouverte, ou laissez MobAlt ouvrir une connexion dédiée vers une session
enregistrée. Les tunnels listés dans l'onglet **Tunnels** d'une session démarrent automatiquement à la connexion de cette session,
et vous êtes prévenu si l'un d'eux ne parvient pas à se lier à son port.

## X11, Mosh, série, RDP/VNC

- **X11** : cochez « Transfert X11 (XQuartz) » dans SSH avancé. MobAlt lance XQuartz si nécessaire, transfère
  l'affichage et échange le cookie d'authentification : `xeyes` ou `gedit` fonctionnent tout simplement. La barre d'état indique la
  disponibilité de X11.
- **Mosh** : nécessite `brew install mosh` en local et `mosh-server` sur l'hôte (UDP 60000-61000).
  Le volet exécute le client mosh ; l'amorçage SSH utilise votre clé, l'agent ou une invite interactive.
  Indiquez le chemin de `mosh-server` s'il n'est pas dans le PATH distant.
- **Mosh + SFTP** : mosh ne transporte pas de canal SFTP ; le panneau Sftp parcourt donc un hôte Mosh via une
  connexion SSH distincte, sans shell, vers le même hôte (même clé, même agent, mêmes invites). Elle s'ouvre
  automatiquement quand « Ouvrir automatiquement le navigateur SFTP » est activé pour la session (et « Afficher SFTP à la connexion SSH »
  dans Réglages → Général), sinon depuis le bouton « Ouvrir SFTP pour cet hôte (via SSH) » du panneau ou depuis
  « Ouvrir le navigateur SFTP » dans le menu du volet ; elle est fermée en même temps que le volet.
- **Série** : l'éditeur liste les périphériques série USB ; réglez le débit, les bits de données et d'arrêt, la parité, le contrôle de flux,
  l'écho local et ce qu'envoie Entrée (CR, LF, CRLF).
- **RDP / VNC** : MobAlt écrit un fichier `.rdp` et ouvre Windows App, ou ouvre `vnc://` dans le Partage
  d'écran. La session conserve l'hôte, l'utilisateur et le dossier comme n'importe quel autre signet.

## Outils et macros

- Panneau **Outils** : ping, traceroute, résolution DNS, scan de ports et informations sur le réseau local, avec un bouton Arrêter
  pour les opérations longues.
- **Wake-on-LAN** (panneau Outils) : saisissez l'adresse MAC sous n'importe quelle forme (`aa:bb:cc:dd:ee:ff`,
  `aa-bb-…`, `aabb.ccdd.eeff` ou hexadécimal brut) et appuyez sur Réveiller : le paquet magique part trois fois en
  diffusion UDP (255.255.255.255, port 9 par défaut ; une diffusion dirigée comme 192.168.1.255
  atteint un autre sous-réseau). Les 10 dernières adresses sont mémorisées avec un libellé facultatif et proposées
  pendant la saisie.
- **Scanner réseau** (panneau Outils) : analysez un CIDR (`192.168.1.0/24`), une plage (`10.0.0.1-10.0.0.50`
  ou `10.0.0.1-50`) ou un seul hôte, jusqu'à un /16, par ping ICMP et/ou connexions TCP sur une courte liste de ports
  (22, 80, 443, 3389, 5900 par défaut), avec parallélisme et délai réglables et une résolution DNS
  inverse de chaque réponse. Les hôtes qui répondent apparaissent dans un tableau triable au fur et à mesure (IP, nom d'hôte,
  temps aller-retour, ports ouverts) pendant que la barre de progression compte `123/254` ; Arrêter annule, ＋ ouvre
  l'éditeur de session avec SSH vers cet hôte déjà rempli, et « Copier texte » place le tableau dans le presse-papiers.
- Panneau **Macros** : enregistrez les frappes dans un terminal (● Enr. / ■ Arrêter), sauvegardez-les sous un nom et
  rejouez-les dans le terminal actif ou dans tous les terminaux. Les macros texte peuvent être saisies directement ;
  les séquences d'échappement comme `\n` ou `\x1b[A` sont prises en charge.

## Espace de travail et réglages

MobAlt restaure vos onglets, divisions et sessions (les onglets détachés dans leur propre fenêtre reviennent sous forme de fenêtres) au lancement suivant et reconnecte les sessions SSH
(les shells locaux se rouvrent dans leur dernier dossier). Désactivez cela dans Réglages → Général → Comportement.

![Réglages](images/settings.png)

Les Réglages comptent cinq onglets, chacun tenant dans la plus petite fenêtre sans défilement : **Général**
(la langue de l'interface, la confirmation à la fermeture, le passage au panneau SFTP, la restauration de l'espace de travail, le shell local et son intégration
de dossier, l'éditeur externe, le dossier Téléchargements, le keep-alive SSH, et « Ouvrir le dossier de config. »,
qui montre où tout est stocké), **Terminal** (police, hauteur de ligne, curseur, historique, thème — l'apparence de toute la
fenêtre, voir *Thèmes et apparence* — souris/touches, et ce que fait *Annuler la division* des autres volets d'un onglet divisé : les déplacer
dans leurs propres onglets, les fermer, ou demander à chaque fois), **Fonctions** (le garde-collage, la barre de surveillance distante et son intervalle
d'actualisation, le surlignage des mots-clés et son tableau de règles, et les transferts Zmodem), **Journaux** (dossier des journaux, journaux de session en texte brut) et **Mises à jour** (la vérification au démarrage
et « Vérifier »).

### Langue de l'interface

Les menus, la barre d'outils, les panneaux, les dialogues et les messages de MobAlt existent en dix langues : English, 한국어, 简体中文, 日本語,
Tiếng Việt, हिन्दी, Deutsch, Français, Español et Português. Par défaut (**Langue du système**), l'interface suit
la liste des langues de macOS (Réglages Système → Général → Langue et région) : la première langue de cette liste que
MobAlt propose l'emporte, l'anglais si aucune ne convient. Réglages → Général → **Langue** en impose une ; le changement
s'applique immédiatement dans toutes les fenêtres — rien ne redémarre, les connexions restent ouvertes — et il est mémorisé. La sortie des terminaux n'est jamais
traduite : ce qu'affiche un hôte distant est montré tel quel. Le guide de l'utilisateur existe dans les mêmes dix langues
(`docs/USER_GUIDE.<language>.md`) ; Aide (Help) → **Guide de l'utilisateur** ouvre celui de la langue actuelle.

Pour lancer MobAlt une seule fois dans une langue sans modifier le réglage (captures d'écran, test), démarrez-le avec `MOBALT_LANG=<code>`
dans l'environnement (`en`, `ko`, `zh-CN`, `ja`, `vi`, `hi`, `de`, `fr`, `es`, `pt`).

## Raccourcis clavier

| Action | Touches |
|---|---|
| Nouvelle session / terminal local / connexion rapide | ⌘N / ⌘T / ⇧⌘N |
| Dupliquer / reconnecter / fermer l'onglet / fermer le volet | ⇧⌘T / ⌘R / ⌘W / ⇧⌘W |
| Épingler / désépingler l'onglet actif | ⇧⌘P |
| Détacher l'onglet actif dans sa propre fenêtre | ⌥⌘N |
| Fermer les autres onglets / les onglets à gauche / les onglets à droite | Menu Session, ou menu contextuel de l'onglet |
| Diviser à droite / en dessous, annuler la division | ⌘D / ⇧⌘D, ⌥⌘1 |
| Grille de 2 / 4 / 6 / 8 volets | ⌥⌘2 / ⌥⌘4 / ⌥⌘6 / ⌥⌘8 |
| Volet suivant, onglet suivant / précédent, onglet 1 à 9 | ⌘] , ⌃Tab / ⌃⇧Tab, ⌃⌘1-9 |
| Agrandir le volet (remplir l'onglet) / rétablir la disposition | ⇧⌘⏎ |
| Rechercher, effacer, zoom | ⌘F, ⌘K, ⌘= / ⌘- / ⌘0 |
| Barre latérale, Sessions / SFTP / Outils / Macros | ⌘B, ⌘1 / ⌘2 / ⌘3 / ⌘4 |
| MultiExec, tunnels, réglages | ⇧⌘M, ⇧⌘U, ⌘, |
| Saut de ligne dans les apps TUI | ⇧Entrée ou ⌥Entrée |
| Dialogue du garde-collage (collage multiligne ou suspect) : coller / annuler | ⌘⏎ / Échap |
| Onglet actif : déplacer / activer / fermer, menu contextuel | ← → / ⏎ / ⌫, ⇧F10 ou la touche Menu |
| Ligne de session active : déplacer / replier / ouvrir / ouvrir dans un volet / supprimer | ↑ ↓ / ← → / ⏎ / ⌘⏎ ou ⇧⏎ / ⌫ |
| Ligne de session ou dossier actif : menu contextuel (dossiers : Déplacer vers un dossier…) | ⇧F10 ou la touche Menu |
| Macro active : déplacer / lire / supprimer, menu contextuel | ↑ ↓ / ⏎ / ⌫, ⇧F10 ou la touche Menu |
| Liste SFTP : déplacer / ouvrir / dossier parent / supprimer, menu contextuel | ↑ ↓ Home End PgUp PgDn / ⏎ / ⌫ / Suppr, ⇧F10 ou la touche Menu |
| Liste SFTP : étendre la sélection / basculer la ligne active / tout sélectionner | ⇧↑ ⇧↓ ⇧Home ⇧End / Espace / ⌘A |
| Liste SFTP : trier selon une colonne | Tab jusqu'à l'en-tête Nom / Taille / Modifié, ⏎ ou Espace |
| Arborescence des sessions et liste SFTP : aller à un nom | saisissez ses premières lettres, espaces compris (la même lettre à nouveau : correspondance suivante) |
| Choix d'icône et de couleur dans l'éditeur de session : déplacer / choisir | ← → ↑ ↓ / ⏎ ou Espace |
| Boutons de panneau de la bande latérale / ⌘1-4 | ⏎ fait entrer le clavier dans le panneau ; changer de panneau mémorise la position |

Aide (Help) → Raccourcis clavier affiche la même liste dans l'app. Tab atteint la barre d'outils, la bande
latérale, l'arborescence des sessions, la liste des macros, la liste SFTP et la barre d'onglets (chaque liste est un seul arrêt de
Tab ; les flèches se déplacent à l'intérieur) ; les dialogues gardent Tab en leur sein et rendent le focus à l'onglet,
à la ligne ou au bouton qui les a ouverts quand ils se ferment ; les menus contextuels acceptent ↑ ↓ / ⏎ / Échap. Échap dans le
filtre des sessions ou le champ de connexion rapide le vide et revient au terminal.


## Données et confidentialité

Tout reste dans `~/Library/Application Support/MobAlt/` : `sessions.json` (mots de passe et
phrases secrètes chiffrés via le trousseau de macOS), `settings.json`, `known_hosts`,
`workspace.json` et les fichiers d'intégration zsh. Les journaux de session vont dans `~/Documents/MobAlt Logs/`.
MobAlt ne se connecte qu'aux hôtes que vous configurez ; la vérification facultative des mises à jour lit la liste des versions
sur GitHub, et rien d'autre. Détails : [SECURITY.md](../SECURITY.md).

## Dépannage

- **« Timed out while waiting for handshake » / ETIMEDOUT** : rien n'a répondu sur ce port. Vérifiez
  l'adresse, le VPN et la redirection du routeur ; essayez `nc -vz host port` dans un terminal local.
- **« échec de l'authentification — le serveur accepte : … ; essayé : … »** : le serveur n'a pas accepté ce que MobAlt
  a proposé. Comparez la liste « accepte » avec la méthode d'authentification de votre session ; pour les serveurs
  n'acceptant que les clés, choisissez le bon fichier de clé. Des échecs répétés peuvent faire bannir votre IP un moment par fail2ban ou par les
  pénalités par source de sshd.
- **« aucun échange de clés / clé d'hôte / chiffrement / MAC commun : cette session propose … ; le serveur propose … »** :
  les deux côtés n'ont aucun algorithme en commun. Le message liste ce que le serveur sait parler : ajoutez-en un
  dans SSH avancé → Algorithmes (ou *Rétablir les valeurs par défaut*) ; pour un vieil équipement qui ne
  propose que SHA-1 / CBC, cochez « Algorithmes hérités (anciens appareils) ».
- **La clé d'hôte a changé** : le serveur a été réinstallé, ou quelque chose intercepte la connexion.
  N'acceptez que si vous savez pourquoi ; l'ancienne clé peut être retirée de `known_hosts` dans le dossier de configuration.
- **Une app X11 n'apparaît pas** : installez XQuartz, et vérifiez que le shell distant ne remplace pas
  `DISPLAY` dans ses fichiers de démarrage.
- **Mosh** : « client mosh introuvable » signifie que `brew install mosh` manque en local ;
  « mosh-server not found » signifie qu'il manque sur l'hôte ou n'est pas dans son PATH (indiquez le chemin dans la
  session).
- **Avertissement Gatekeeper sur une app compilée soi-même** : clic droit → Ouvrir une fois, ou
  `xattr -dr com.apple.quarantine /Applications/MobAlt.app`.
- **`hdiutil: attach failed – Resource busy` avec `brew upgrade --cask mobalt`** : un autre processus Homebrew
  (par exemple `brew audit` ou `brew fetch`) avait le même DMG monté à ce moment-là. Relancez simplement la
  commande.
