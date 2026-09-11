# Automatický výpočet skladových hladin — vysvětlení

Tento dokument popisuje, co systém dělá, odkud bere data a jak
počítá doporučené skladové hladiny. Je psaný pro čtenáře, který nemusí znát
databáze ani programování. Doprovodný obrázek `diagram_hladiny.svg` ukazuje
celý tok i logiku výpočtu na jednom místě.

---

## Co systém dělá a proč

Cílem je u každého materiálu nastavit **skladovou hladinu** — tedy množství,
které chceme mít připravené na skladě — tak, aby pokrylo **2 dny**
očekávané spotřeby. Hladina se nepočítá od oka, ale z reálného plánu potřeb
(forecastu), a přepočítává se pravidelně z čerstvých dat.

Smyslem je držet skladem právě tolik, kolik je potřeba: ne zbytečně moc,
ale ani málo.

---

## Odkud bereme data

Systém pracuje se **třemi sestavami**, které se pomoci background jobu vyexportují ze SAPu
a vloží do složky na kterou neustále dohlíží program. Jakmile je do této složky vložen soubor,
který má sledovaný název, automaticky se soubor přepíše do SQL databáze. Při každém načtení se data
kompletně obnoví (nahradí se předchozí data), takže výpočet vždy běží nad aktuálním
stavem.

1. **Aktuální hladiny** — kolik čeho teď na skladě máme, respektive jaká
hladina je u každého materiálu dnes nastavená. Zdroj dat je SAP tabulka ZFST_WM_SMT. tabulka
se pro export nijak neupravuje. Celá se vyexportuje v HTML formátu. Pro export používáme
query: ASCM_AKT_HLADN
2. **Týdenní potřeby (forecast)** — kolik se každého materiálu bude podle plánu
spotřebovávat, a to **týden po týdnu na 18 týdnů dopředu**. Export probíhá z
transakce /n/gib/dco a použití varianta "ASCM_REQ_W".
3. **Materiály bez hladiny** — seznam materiálů, kterým hladina ještě nebyla
nastavena (kandidáti na založení). Exporuje se pomocí query: AQ15LZ-CO=======FST_HLADINY===
. Tato query zobrazuje materiály v Ostravě pro které nejsou založeny hladiny v FST.

---

## Jak se hladina počítá — krok za krokem

Pro výpočet optimální hladiny používáme interkvartilní rozpětí ze statistické
metody **IQR**.

### Postup výpočtu

1. **Vezmeme 4 následující týdny z plánu potřeb.**

   Například: potřeby mám vyexportované ze SAP v týdnu `37`. Při výpočtu tedy
   bereme požadavky z týdnů `38`, `39`, `40` a `41`.

2. **Týdny s nulovou potřebou vynecháme.**

   Zajímají nás pouze týdny, ve kterých se materiál skutečně spotřebovává.

3. **Spočítáme „kvartil 3“.**

   Pokud chcete mít obecnou představu o tom co obsahuje výsledná hladina bez čtení
   zbylého vysvětlení. Výsledná hladina je třetí nejmenší spotřeba v následnujících 
   čtyřech týdnech + rezerva.

   Máme následující hodnoty:

   - `CW38`: 42.549
   - `CW39`: 17.265
   - `CW40`: 8.178
   - `CW41`: 28.161

   Nejdříve definujeme pozici:

   \[
   0{,}75 \times (N - 1)
   \]

   kde:

   - `0,75` představuje 75 %,
   - `N` je počet týdnů s naplánovanou spotřebou materiálu.

   V našem příkladu se pozice rovná:

   \[
   0{,}75 \times (4 - 1) = 2{,}25
   \]

   Ve statistice se první číslo počítá jako index `0`. Pozice `2,25` je tedy
   mezi třetí a čtvrtou nejmenší hodnotou.

   V našem příkladu tedy použijeme hodnoty `28.161` a `42.549`:

   \[
   28{,}161 + 0{,}25 \times (42{,}549 - 28{,}161)
   \]

   > **Pozor:** Nepřičítáme čtvrtinu následující hodnoty, ale čtvrtinu rozdílu
   > mezi hodnotou na pozici `2` a hodnotou na pozici `3`.

   Výsledek je:

   \[
   31{,}758
   \]

   Následně přepočítáme výsledek na počet dnů, tedy na `2` dny:

   \[
   \frac{31{,}758}{7} \times 2 = 9{,}073
   \]

   **Výsledná hladina této čtyřtýdenní spotřeby je `9.073`.**

4. **Porovnáme s dnešní hladinou.**

   Hladinu změníme, jen pokud se nové číslo liší od dnešního
   **o víc než 20 %**. Malé výkyvy ignorujeme, aby hladina zbytečně
   neposkakovala nahoru a dolů.

Výsledek každého materiálu dostane slovní **důvod**:

- _Navýšeno_
- _Poníženo_
- _Beze změny_
- _Mrtvý materiál_
- _Nový materiál_

Díky tomu bude hned vidět, proč se hladina změnila, nebo proč zůstala beze změny.

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