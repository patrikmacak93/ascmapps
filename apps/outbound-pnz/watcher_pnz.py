"""
pnz_watch.py

Hlida tuto slozku. Jakmile se v ni objevi nebo zmeni soubor s "pnzListSAP"
v nazvu (SAP ALV export, .htm/.html), pocka az se dopise na disk, rozparsuje
jednoduchou tabulku (Char20 / CHAR35 / Text 42 / c) a nahraje (DELETE + INSERT
v jedne transakci, vcetne casu zapisu ve sloupci loaded_at) do SQL tabulky:

    *pnzListSAP*.htm(l) -> outbound.pnzListSAP_zcze_sd_pn

Struktura exportu (jedna tabulka, prvni radek = hlavicka):
    Char20   -> record_type    (konstanta, napr. "ZPNZ_PR")
    CHAR35   -> local_material  (materialove cislo)
    Text 42  -> assigned_pn     (prirazene PN, napr. "PNZ5405"); pokud je
                                 v bunce vic hodnot oddelenych carkou/strednikem
                                 (napr. "PNE16007, PNZ8650"), kazda se ulozi
                                 jako samostatny radek
    c        -> prazdny sloupec, ignoruje se

Sloupec imt_url se dopocitava z assigned_pn - je to odkaz do IMT (Vitesco),
kde je na konci filtru dosazene konkretni PN daneho radku (viz IMT_URL_TEMPLATE).

Po uspesnem zapisu se zpracovany soubor presune do podslozky .\\Done
a prejmenuje na "done_<puvodni nazev>_<casove razitko>.<pripona>"
(razitko kvuli tomu, aby se stejne pojmenovane exporty neprepisovaly)
a v Done se drzi jen poslednich DONE_RETENTION souboru - starsi se smazou.

Server FSDB0005\\I0176, databaze FSTASCM, Windows trusted auth - stejny
vzor jako dco_watch.py.

Tabulka se nezakalada sama - je potreba nejdriv spustit
create_pnzListSAP_table.sql (viz tento adresar).

Zavislosti (stejne jako dco_watch.py):
    pandas, sqlalchemy, pyodbc, ODBC Driver 18 for SQL Server

Spusteni:
    python pnz_watch.py                 -> hlida slozku (dvojklik pres start-watch.bat)
    python pnz_watch.py soubor.htm       -> jednorazove zpracuje jen tento soubor

Hlidana slozka je defaultne stejna, kde lezi tento skript. Pro hlidani jine
slozky nastav pred spustenim promennou prostredi PNZ_WATCH_DIR - Done i log
pak vzniknou v teto slozce, ne u skriptu.
"""

import os
import re
import shutil
import sys
import time
import traceback
import urllib.parse
from datetime import datetime

import pandas as pd
from sqlalchemy import create_engine, text

# =========================
# CONFIG
# =========================
SERVER = r"FSDB0005\I0176"
DATABASE = "FSTASCM"
DRIVER = "ODBC Driver 18 for SQL Server"
TARGET_SCHEMA = "outbound"
TARGET_TABLE = "pnzListSAP_zcze_sd_pn"

# Slozka, kterou se hlida - defaultne stejna slozka, kde lezi tento skript.
# Da se prebit promennou prostredi PNZ_WATCH_DIR, kdyz ma skript bezet z jine
# slozky, nez je ta sledovana. Log i Done pak nasleduji WATCH_DIR.
WATCH_DIR = os.environ.get("PNZ_WATCH_DIR") or os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(WATCH_DIR, "pnz_watch.log")
MAX_LOG_LINES = 500

# Vzor v nazvu souboru, ktery skript zpracovava (case-insensitive).
FILENAME_PATTERN = re.compile(r"pnzListSAP", re.I)
EXT_PATTERN = re.compile(r"\.html?$", re.I)

POLL_INTERVAL_S = 2
STABLE_CHECK_S = 1
STABLE_ROUNDS = 2

CHUNKSIZE = 5000

DONE_DIR = os.path.join(WATCH_DIR, "Done")
DONE_RETENTION = 10  # kolik poslednich souboru se drzi v Done

# Sablona odkazu do IMT (Vitesco). {pn} se nahradi hodnotou assigned_pn daneho
# radku; %27 jsou URL-kodovane apostrofy obalujici cislo ve filtru.
IMT_URL_TEMPLATE = (
    "https://imt.vitesco-technologies.net/IMT/fst/Published"
    "?sort=Published-desc&page=1&pageSize=100"
    "&group=Area-asc~Project-asc"
    "&filter=Number~contains~%27{pn}%27"
)

# ---------------------------------------------------------------------------
# Logovani
# ---------------------------------------------------------------------------

def _trim_log_file(path, max_lines=MAX_LOG_LINES):
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        if len(lines) > max_lines:
            with open(path, "w", encoding="utf-8") as f:
                f.writelines(lines[-max_lines:])
    except FileNotFoundError:
        pass

# Trim logu je drahy (nacte + prepise cely soubor), takze ho NEDELAME po
# kazdem radku - to zpusobovalo O(n^2) zpomaleni pri stovkach zaprsah za sebou.
# Trimujeme jen obcas (kazdych _TRIM_EVERY zapisu) a jeste jednou na konci behu.
_TRIM_EVERY = 200
_log_counter = 0

def log(msg):
    global _log_counter
    line = f"[{datetime.now().isoformat()}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        _log_counter += 1
        if _log_counter >= _TRIM_EVERY:
            _log_counter = 0
            _trim_log_file(LOG_PATH)
    except PermissionError:
        pass

# ---------------------------------------------------------------------------
# Parser SAP HTML exportu
# ---------------------------------------------------------------------------

ENTITY_MAP = {"nbsp": " ", "amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'"}
ENTITY_RE = re.compile(r"&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);")

def decode_entities(s):
    def repl(m):
        ent = m.group(1)
        if ent[0] == "#":
            try:
                code = int(ent[2:], 16) if ent[1] in "xX" else int(ent[1:], 10)
                return chr(code)
            except ValueError:
                return m.group(0)
        return ENTITY_MAP.get(ent, m.group(0))

    return ENTITY_RE.sub(repl, s)

WHITESPACE_RE = re.compile(r"\s+")
TAG_RE = re.compile(r"<[^>]+>")

def cell_text(raw):
    return WHITESPACE_RE.sub(" ", decode_entities(TAG_RE.sub("", raw))).strip()

ROW_RE = re.compile(r"<tr[^>]*>([\s\S]*?)</tr>", re.I)
TD_RE = re.compile(r"<td[^>]*>([\s\S]*?)</td>", re.I)
# Rozdeleni vice PN v jedne bunce (carka nebo strednik). Bere se jen PRVNI.
ASSIGNED_SPLIT_RE = re.compile(r"[,;]+")

# Prvni bunka hlavickoveho radku exportu - takovy radek se preskoci.
HEADER_FIRST_CELL = "Char20"

def parse_pnz_html(html):
    """
    Vraci (rows, warnings). Kazdy vstupni radek = PRAVE JEDEN vystupni radek.
    Kdyz je v bunce Text 42 vic PN oddelenych carkou/strednikem (napr.
    "PNE16020, PNZ5500"), zapise se jen PRVNI (PNE16020) a zbytek se zahodi.
    Sloupce vystupu: (record_type, local_material, assigned_pn).
    """
    warnings = []
    rows = []
    saw_header = False

    for row_match in ROW_RE.finditer(html):
        cells = [cell_text(c) for c in TD_RE.findall(row_match.group(1))]
        if not cells:
            continue

        # Hlavicka tabulky ("Char20", "CHAR35", "Text 42", "c") - preskocit.
        if cells[0] == HEADER_FIRST_CELL:
            saw_header = True
            continue

        if len(cells) < 3:
            warnings.append(f"Radek s mene nez 3 sloupci, ignoruji: {cells!r}")
            continue

        record_type = cells[0]
        local_material = cells[1]
        assigned_raw = cells[2]

        if not local_material:
            continue

        parts = [p.strip() for p in ASSIGNED_SPLIT_RE.split(assigned_raw) if p.strip()]

        # Zapisujeme jen PRVNI PN; pripadne dalsi zahodime.
        assigned_pn = parts[0] if parts else None
        if len(parts) > 1:
            warnings.append(
                f"{local_material}: v Text 42 vic PN {parts} - "
                f"zapisuji jen prvni ({assigned_pn}), zbytek zahazuji."
            )

        rows.append(
            {
                "record_type": record_type,
                "local_material": local_material,
                "assigned_pn": assigned_pn,
            }
        )

    if not saw_header:
        warnings.append('Hlavicka ("Char20") nebyla nalezena - overte format exportu.')

    return rows, warnings

def is_candidate(filename):
    return bool(EXT_PATTERN.search(filename)) and bool(FILENAME_PATTERN.search(filename))

# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------

def build_imt_url(assigned_pn):
    """Sestavi odkaz do IMT pro dane PN. Prazdne PN -> zadny odkaz (None).
    PN se pred vlozenim do URL bezpecne zakoduje (percent-encoding)."""
    if not assigned_pn:
        return None
    pn = urllib.parse.quote(str(assigned_pn), safe="")
    return IMT_URL_TEMPLATE.format(pn=pn)

def get_engine():
    conn_str = (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={SERVER};"
        f"DATABASE={DATABASE};"
        "Trusted_Connection=yes;"
        "TrustServerCertificate=yes;"
    )
    params = urllib.parse.quote_plus(conn_str)
    return create_engine(
        f"mssql+pyodbc:///?odbc_connect={params}",
        fast_executemany=True,
        connect_args={"timeout": 10},
        pool_pre_ping=True,
    )

def load_rows_to_sql(engine, rows):
    target_table = f"{TARGET_SCHEMA}.{TARGET_TABLE}"

    df = pd.DataFrame(rows, columns=["record_type", "local_material", "assigned_pn"])
    df["record_type"] = df["record_type"].astype(str).str.strip()
    df["local_material"] = df["local_material"].astype(str).str.strip()
    df["assigned_pn"] = df["assigned_pn"].where(df["assigned_pn"].notna(), None)
    df["imt_url"] = df["assigned_pn"].map(build_imt_url)
    df["loaded_at"] = datetime.now()  # jeden spolecny cas zapisu pro cely load

    # Full refresh (DELETE + INSERT) v jedne transakci, aby tabulka nebyla
    # mezitim viditelna prazdna a pri chybe se cely zapis vratil zpet.
    with engine.begin() as conn:
        deleted = conn.execute(text(f"DELETE FROM {target_table}")).rowcount
        log(f"SQL_DELETE | table={target_table} | deleted_rowcount={deleted}")

        df.to_sql(
            TARGET_TABLE,
            con=conn,
            schema=TARGET_SCHEMA,
            if_exists="append",
            index=False,
            chunksize=CHUNKSIZE,
            method=None,
        )
        log(f"SQL_INSERT | table={target_table} | inserted_rows={len(df)}")

        cnt = conn.execute(text(f"SELECT COUNT(*) FROM {target_table}")).scalar()
        log(f"SQL_VERIFY | table={target_table} | count_after={cnt}")

# ---------------------------------------------------------------------------
# Slozka Done (archiv zpracovanych souboru)
# ---------------------------------------------------------------------------

def move_to_done(path):
    """Presune zpracovany soubor do .\\Done s casovym razitkem v nazvu
    a orizne historii na DONE_RETENTION nejnovejsich souboru."""
    os.makedirs(DONE_DIR, exist_ok=True)

    base, ext = os.path.splitext(os.path.basename(path))
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest_path = os.path.join(DONE_DIR, f"done_{base}_{stamp}{ext}")

    counter = 1
    while os.path.exists(dest_path):  # kolize v ramci stejne vteriny
        dest_path = os.path.join(DONE_DIR, f"done_{base}_{stamp}_{counter}{ext}")
        counter += 1

    shutil.move(path, dest_path)
    log(f'Presunuto do Done: "{os.path.basename(dest_path)}"')

    enforce_done_retention()

def enforce_done_retention():
    try:
        entries = os.listdir(DONE_DIR)
    except OSError:
        return

    matching = [
        f for f in entries
        if FILENAME_PATTERN.search(f) and os.path.isfile(os.path.join(DONE_DIR, f))
    ]
    matching.sort(key=lambda f: os.path.getmtime(os.path.join(DONE_DIR, f)))

    for f in matching[:-DONE_RETENTION] if len(matching) > DONE_RETENTION else []:
        full = os.path.join(DONE_DIR, f)
        try:
            os.remove(full)
            log(f'Smazan stary soubor v Done (nad limit {DONE_RETENTION}): "{f}"')
        except OSError as err:
            log(f'CHYBA pri mazani stareho souboru v Done "{f}": {err}')

# ---------------------------------------------------------------------------
# Hlidani slozky
# ---------------------------------------------------------------------------

def process_file(engine, path):
    """Rozparsuje soubor, zapise vysledek do SQL a presune soubor do Done.
    Vraci pocet zapsanych radku."""
    with open(path, "r", encoding="utf-8") as f:
        html = f.read()

    rows, warnings = parse_pnz_html(html)

    # Upozorneni typu "vic PN, zapisuji jen prvni" byva stovky - nelogujeme je
    # po jednom (zahlcuje log a zpomaluje), ale shrneme do jednoho radku a
    # vypiseme jen par prvnich prikladu. Ostatni (jine) warningy logujeme cele.
    multi_pn = [w for w in warnings if "v Text 42 vic PN" in w]
    ostatni = [w for w in warnings if "v Text 42 vic PN" not in w]

    for w in ostatni:
        log(f"[UPOZORNENI] {w}")

    if multi_pn:
        ukazka = "; ".join(multi_pn[:3])
        log(
            f"[UPOZORNENI] {len(multi_pn)} radku melo v Text 42 vic PN - "
            f"u vsech zapsano jen prvni PN. Priklady: {ukazka}"
            + (" ..." if len(multi_pn) > 3 else "")
        )

    if not rows:
        raise ValueError("V souboru nebyl nalezen zadny pouzitelny radek s daty.")

    load_rows_to_sql(engine, rows)
    move_to_done(path)
    return len(rows)

def wait_until_stable(path):
    last_size = -1
    stable_rounds = 0
    while stable_rounds < STABLE_ROUNDS:
        time.sleep(STABLE_CHECK_S)
        try:
            size = os.path.getsize(path)
        except OSError:
            return False  # soubor mezitim zmizel/prejmenovan
        if size == last_size:
            stable_rounds += 1
        else:
            stable_rounds = 0
            last_size = size
    return True

def handle_file(engine, path, last_processed, in_progress):
    filename = os.path.basename(path)
    if path in in_progress:
        return
    if not is_candidate(filename):
        return

    try:
        if not os.path.exists(path):
            return
        mtime = os.path.getmtime(path)
        if last_processed.get(path) == mtime:
            return  # uz zpracovano

        in_progress.add(path)
        log(f'Detekovan soubor "{filename}", cekam az se dopise...')

        if not wait_until_stable(path):
            log(f'Soubor "{filename}" zmizel pred zpracovanim, preskakuji.')
            return

        mtime_after = os.path.getmtime(path)
        count = process_file(engine, path)
        last_processed[path] = mtime_after
        log(f'Hotovo: "{filename}" -> {TARGET_SCHEMA}.{TARGET_TABLE} ({count} radku).')
    except Exception as err:  # noqa: BLE001 - chceme zalogovat a pokracovat ve sledovani
        log(f'CHYBA pri zpracovani "{filename}": {err}')
        log(traceback.format_exc())
    finally:
        in_progress.discard(path)

def watch(engine):
    log(f"Sleduji slozku: {WATCH_DIR}")
    log("Hledam soubory odpovidajici: *pnzListSAP*.htm(l)")

    last_processed = {}
    in_progress = set()

    def scan():
        try:
            entries = os.listdir(WATCH_DIR)
        except OSError:
            return
        for fn in entries:
            if not is_candidate(fn):
                continue
            full = os.path.join(WATCH_DIR, fn)
            if os.path.isfile(full):
                handle_file(engine, full, last_processed, in_progress)

    scan()
    while True:
        time.sleep(POLL_INTERVAL_S)
        scan()

# ---------------------------------------------------------------------------
# Vstupni bod
# ---------------------------------------------------------------------------

def main():
    input_arg = sys.argv[1] if len(sys.argv) > 1 else None

    if input_arg:
        # Jednorazovy rezim: python pnz_watch.py soubor.htm
        input_path = os.path.abspath(input_arg)
        filename = os.path.basename(input_path)
        if not is_candidate(filename):
            log(
                f'Soubor "{filename}" neodpovida vzoru pnzListSAP (.htm/.html). '
                "Zpracovavam presto, protoze byl zadan primo."
            )

        engine = get_engine()
        count = process_file(engine, input_path)
        log(f"Hotovo: {count} radku zapsano do {TARGET_SCHEMA}.{TARGET_TABLE}")
        return

    engine = get_engine()
    watch(engine)

if __name__ == "__main__":
    main()