# Automatický výpočet skladových hladin — vysvětlení

Tento dokument srozumitelně popisuje, co systém dělá, odkud bere data a jak
počítá doporučené skladové hladiny. Je psaný pro čtenáře, který nemusí znát
databáze ani programování. Doprovodný obrázek `diagram_hladiny.svg` ukazuje
celý tok i logiku výpočtu na jednom místě.

---

## Co systém dělá a proč

Cílem je u každého materiálu nastavit **skladovou hladinu** — tedy množství,
které chceme mít připravené na skladě — tak, aby pokrylo přibližně **2 dny**
očekávané spotřeby. Hladina se nepočítá od oka, ale z reálného plánu potřeb
(forecastu), a přepočítává se pravidelně z čerstvých dat.

Smyslem je držet skladem právě tolik, kolik je potřeba: ne zbytečně moc
(vázané peníze a místo), ale ani málo (riziko, že materiál dojde).

---

## Odkud bereme data

Systém pracuje se **třemi sestavami**, které se vyexportují ze SAP a vloží do
sledované složky. Systém je odtud sám načte. Při každém načtení se data
kompletně obnoví (nahradí se předchozí), takže výpočet vždy běží nad aktuálním
stavem.

1. **Aktuální hladiny** — kolik čeho teď na skladě máme, respektive jaká
hladina je u každého materiálu dnes nastavená.
2. **Týdenní potřeby (forecast)** — kolik se každého materiálu bude podle plánu
spotřebovávat, a to **týden po týdnu na 18 týdnů dopředu**.
3. **Materiály bez hladiny** — seznam materiálů, kterým hladina ještě nebyla
nastavena (kandidáti na založení).

---

## Jak se hladina počítá — krok za krokem

Pro každý materiál, který je ve forecastu, proběhne tento postup:

1. **Vezmeme 4 nejbližší týdny** z plánu potřeb.
2. **Týdny s nulovou potřebou vynecháme** — zajímají nás jen týdny, kdy se
materiál skutečně spotřebovává.
3. **Spočítáme „kvartil 3".** Zjednodušeně: zbylá týdenní množství seřadíme od
nejmenšího po největší a vezmeme hodnotu blízko horního konce. Záměrně tedy
nebereme průměr, ale spíš vyšší číslo — aby hladina spíš stačila, než aby
chyběla.
4. **Přepočítáme z týdne na 2 dny.** Kvartil je týdenní množství, proto ho
vynásobíme 2/7 a **zaokrouhlíme nahoru** (radši o kus víc než míň).
5. **Porovnáme s dnešní hladinou.** Hladinu změníme, jen pokud se nové číslo
liší od dnešního **o víc než 20 %**. Malé výkyvy ignorujeme, aby hladina
zbytečně neposkakovala nahoru a dolů.

Výsledek každého materiálu dostane slovní **důvod**: *Navýšeno*, *Poníženo*,
*Beze změny*, *Mrtvý materiál* nebo *Nový materiál* — aby bylo hned vidět, proč
se hladina (ne)změnila.

---

## Zvláštní situace

- **Materiál bez jakékoli potřeby na 18 týdnů** se považuje za „mrtvý" a jeho
hladina se srazí na **0**. Výjimka: materiály na ručně vedeném *seznamu
výjimek* se nechají beze změny (např. položky, které chceme držet i bez
aktuální poptávky).
- **Úplně nový materiál** (má potřebu, ale hladinu ještě nemá) dostane rovnou
spočtenou hladinu. Pravidlo 20 % se u něj nepoužije — není totiž vůči čemu
ho porovnat.
- **Materiál, který ve forecastu vůbec není**, systém nechává být — na jeho
hladinu nesahá.

---

## Co z výpočtu vzejde

Výstupem je **návrh** — přehledná tabulka, kde je u každého materiálu dnešní
hladina, nově spočtená hladina a slovní důvod. Tento návrh:

1. **zkontroluje a schválí člověk** (cílově v jednoduchém webovém rozhraní),
2. schválené hladiny se pak **vyexportují do souboru pro SAP**.

---

## Na co se lze spolehnout

- Systém **nikdy sám nezapíše hladiny do SAP.** Mezi výpočtem a SAP je vždy
kontrola a schválení člověkem.
- **Aktuální hladiny se výpočtem nemění** — slouží jen jako vstup a porovnávací
základ.
- **Každý přepočet se ukládá i s důvodem**, takže je kdykoli zpětně dohledatelné,
proč a kdy se hladina změnila.

---

## Malý slovníček

- **Hladina** — cílové množství materiálu, které chceme mít připravené skladem.
- **Forecast / potřeby** — plánovaná spotřeba materiálu do budoucna.
- **Kvartil 3** — hodnota blízko horního konce seřazených čísel; v tomto
systému znamená „spíš vyšší z běžných týdenních potřeb", zvolená pro jistotu.
- **Mrtvý materiál** — materiál, u kterého se na 18 týdnů dopředu neplánuje
žádná spotřeba.
