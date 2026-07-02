# Git cheatsheet pro začátečníky

> 💡 Tip: `git status` je tvůj nejlepší kamarád. Když nevíš, co se děje, spusť ho — vypíše, co je změněné, co je připravené ke commitu a na jaké jsi větvi.

---

## 1. Prvotní nastavení (dělá se jen jednou na počítači)

```bash
git config --global user.name "Patrik Macak"
git config --global user.email "tvuj@email.cz"
```

Tohle Git použije jako "podpis" pod tvoje commity.

---

## 2. Založení nového repa a propojení s GitHubem

### Varianta A — máš už kód lokálně a chceš ho dostat na GitHub

1. Ve složce s projektem:
   ```bash
   git init
   ```
2. Vytvoř nové (prázdné!) repo na GitHubu a zkopíruj si jeho HTTPS odkaz.
3. Propoj lokální složku s GitHub repem:
   ```bash
   git remote add origin https://github.com/uzivatel/muj-projekt.git
   git remote -v          # zkontroluje, že se propojení povedlo
   ```
4. Sjednoť název hlavní větve na `main` (starší Git defaultně používal `master`):
   ```bash
   git branch -M main
   ```
5. Přidej soubory, commitni a pošli na GitHub:
   ```bash
   git add .
   git commit -m "Initial commit"
   git push -u origin main
   ```
   `-u` (= `--set-upstream`) říká Gitu, že tahle lokální větev patří k `origin/main`. Díky tomu příště stačí jen `git push`.

### Varianta B — repo už na GitHubu existuje a ty ho chceš jen stáhnout

```bash
git clone https://github.com/uzivatel/muj-projekt.git
```

Tím se rovnou vytvoří propojená složka — kroky výše nejsou potřeba.

---

## 3. Základní denní workflow

Tohle je cyklus, který budeš opakovat pořád dokola:

```
1. git pull            → stáhni nejnovější změny
2. (uprav soubory)
3. git status           → zkontroluj, co se změnilo
4. git add .            → připrav změny ke commitu
5. git commit -m "..."  → ulož změny lokálně
6. git push              → pošli změny na GitHub
```

| Příkaz | Co dělá |
|---|---|
| `git status` | Ukáže, co je změněné / připravené / nesledované |
| `git add .` | Přidá **všechny** změny do "staging area" (přípravy na commit) |
| `git add soubor.txt` | Přidá jen konkrétní soubor |
| `git commit -m "Popis změny"` | Uloží připravené změny jako nový bod v historii |
| `git push` | Odešle commity na GitHub |
| `git pull` | Stáhne a sloučí nejnovější změny z GitHubu |

> ⚠️ **Pull před push!** Pokud mezitím na GitHubu přibyly cizí změny, `git push` je odmítne. Nejdřív musíš `git pull`.

---

## 4. Práce s branchemi (větvemi)

Branch = samostatná "kopie" projektu, kde můžeš zkoušet věci, aniž bys ovlivnil `main`.

```bash
git branch                  # vypíše lokální branche, hvězdička = kde jsi
git branch -r                # vypíše vzdálené (GitHub) branche
git checkout -b dev           # vytvoří novou branch "dev" a rovnou na ni přepne
git checkout main             # přepne se zpátky na main
```

### Nahrání nové branche na GitHub

```bash
git push -u origin dev
```
(příště na téhle branchi stačí jen `git push`)

### Sloučení branche do mainu

```bash
git checkout main       # nejdřív se přepni na main
git pull origin main     # ujisti se, že máš aktuální main
git merge dev            # sluč do něj obsah branche dev
git push                 # pošli sloučený main na GitHub
```

---

## 5. Časté začátečnické situace

**"Zapomněl jsem, co jsem změnil"**
```bash
git status
git diff              # ukáže přesně řádky, které se změnily
```

**"Chci zrušit poslední (ještě neodeslaný) commit, ale změny nechat"**
```bash
git reset --soft HEAD~1
```

**"Rozepsal jsem něco a chci to zahodit a vrátit se k poslední commitnuté verzi"**
```bash
git checkout -- soubor.txt      # jeden soubor
git checkout -- .                # všechny soubory
```

**"Chci vidět historii commitů"**
```bash
git log --oneline
```

---

## 6. Mini slovníček

| Pojem | Vysvětlení |
|---|---|
| **repo (repozitář)** | Složka sledovaná Gitem — obsahuje projekt + celou jeho historii |
| **commit** | "Uložený bod" v historii — snímek stavu projektu s popiskem |
| **staging area** | Místo, kam dáváš změny předtím, než je commitneš (`git add`) |
| **branch (větev)** | Samostatná linie vývoje, oddělená od hlavní |
| **origin** | Výchozí název pro vzdálené (GitHub) repo, na které jsi se propojil |
| **main / master** | Název hlavní/výchozí větve projektu |
| **push / pull** | Odeslání změn na GitHub / stažení změn z GitHubu |
| **merge** | Sloučení jedné branche do druhé |
| **clone** | Stažení celého existujícího repa z GitHubu k sobě |
