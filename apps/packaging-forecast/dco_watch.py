"""
dco_watch.py

Hlida tuto slozku (Reports). Jakmile se v ni objevi nebo zmeni soubor
s "FST_PCK_FC_W", "HRU_PCK_FC_W", "FST_PCK_FC_M" nebo "HRU_PCK_FC_M"
v nazvu (SAP ALV export, .htm/.html), pockej az se dopise na disk,
rozparsuj tydenni/mesicni pozadavky (beze zmen, zadne sectani/slucovani
- to uz je vec SQL) a nahraj (DELETE + INSERT v jedne transakci, vcetne
casu zapisu ve sloupci loaded_at) do prislusne SQL tabulky. Vsechny 4
soubory se zpracovavaji zcela nezavisle na sobe, kazdy do sve vlastni
tabulky:

    *FST_PCK_FC_W*.htm(l) -> pckForecast.FST_DCO_week
    *HRU_PCK_FC_W*.htm(l) -> pckForecast.HRU_DCO_week
    *FST_PCK_FC_M*.htm(l) -> pckForecast.FST_PCK_DCO_month
    *HRU_PCK_FC_M*.htm(l) -> pckForecast.HRU_PCK_DCO_month

Sloupec period_label je ve formatu "cw <tyden>/<rok>" pro tydenni radky
(napr. "cw 33/2026") a "cm <mesic>/<rok>" pro mesicni radky (napr.
"cm 8/2026"). Format hlavicek mesicnich sloupcu v exportu (predpoklad
"M <cislo>/<rok>", stejne jako u tydnu "W <cislo>/<rok>") zatim nebyl
overen na realnem souboru - az prijde skutecny mesicni export, zkontroluj
PERIOD_PATTERNS.
Sloupec mod_pn se dopocitava z local_material (viz compute_mod_pn) pro
JOIN na dbo.pckDatabase.PartNumber.

Po uspesnem zapisu se zpracovany soubor presune do podslozky .\Done
a prejmenuje na "done_<puvodni nazev>_<casove razitko>.<pripona>"
(razitko kvuli tomu, aby se stejne pojmenovane exporty neprepisovaly)
a v Done se pro kazdy job drzi jen poslednich DONE_RETENTION souboru -
starsi se smazou.

Server FSDB0005\\I0176, databaze FSTASCM, Windows trusted auth - stejny
vzor jako ascmapps/apps/packaging-forecast/load_query1_to_sql.py.

Tabulky se nezakladaji samy - je potreba nejdriv spustit
create_dco_tables.sql, create_dco_month_tables.sql,
alter_dco_tables_add_loaded_at.sql a alter_dco_tables_add_mod_pn.sql
(viz tento adresar).

Zavislosti (uz pouzivane load_query1_to_sql.py, na serveru by mely byt):
    pandas, sqlalchemy, pyodbc, ODBC Driver 18 for SQL Server

Spusteni:
    python dco_watch.py                 -> hlida slozku (dvojklik pres start-watch.bat)
    python dco_watch.py soubor.htm       -> jednorazove zpracuje jen tento soubor

Hlidana slozka je defaultne stejna, kde lezi tento skript. Pro hlidani jine
slozky nastav pred spustenim promennou prostredi DCO_WATCH_DIR (viz CONFIG
nize) - Done i log pak vzniknou v teto slozce, ne u skriptu.
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
TARGET_SCHEMA = "pckForecast"

# Slozka, kterou se hlida - defaultne stejna slozka, kde lezi tento skript
# (jako u pck_forecast_watch.js). Da se prebit promennou prostredi DCO_WATCH_DIR,
# kdyz ma skript bezet z jinacy slozky, nez je ta sledovana (napr. v NSSM
# pres "Environment": DCO_WATCH_DIR=D:\SdilenaSlozka). Log i Done pak
# nasleduji WATCH_DIR, ne umisteni skriptu.
WATCH_DIR = os.environ.get("DCO_WATCH_DIR") or os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(WATCH_DIR, "dco_watch.log")
# Stavovy log (LOG_PATH) zustava ve WATCH_DIR. Chybovy log jde vzdy vedle
# skriptu (tam, kde lezi watchery), aby byly chyby pohromade a nezmizely
# v pripade, ze je WATCH_DIR sitova/sdilena slozka.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ERROR_LOG_PATH = os.path.join(SCRIPT_DIR, "dco_watch.error.log")
MAX_LOG_LINES = 500

# Nazev souboru -> cilova tabulka. Prvni shoda vyhrava.
JOB_TABLE_MAP = [
    (re.compile(r"FST_PCK_FC_W", re.I), "FST_DCO_week"),
    (re.compile(r"HRU_PCK_FC_W", re.I), "HRU_DCO_week"),
    (re.compile(r"FST_PCK_FC_M", re.I), "FST_PCK_DCO_month"),
    (re.compile(r"HRU_PCK_FC_M", re.I), "HRU_PCK_DCO_month"),
]
EXT_PATTERN = re.compile(r"\.html?$", re.I)

POLL_INTERVAL_S = 2
STABLE_CHECK_S = 1
STABLE_ROUNDS = 2

CHUNKSIZE = 5000

DONE_DIR = os.path.join(WATCH_DIR, "Done")
DONE_RETENTION = 2  # kolik poslednich souboru se drzi v Done na kazdy job (FST / HRU zvlast)

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

def _write_log(path, line):
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        _trim_log_file(path)
    except (PermissionError, OSError):
        pass

def log(msg):
    """Stavovy/informacni log -> LOG_PATH (WATCH_DIR)."""
    line = f"[{datetime.now().isoformat()}] {msg}"
    print(line, flush=True)
    _write_log(LOG_PATH, line)

def log_error(msg):
    """Chybovy log -> ERROR_LOG_PATH (slozka se skriptem)."""
    line = f"[{datetime.now().isoformat()}] {msg}"
    print(line, flush=True)
    _write_log(ERROR_LOG_PATH, line)

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

def cell_text(raw):
    return WHITESPACE_RE.sub(" ", decode_entities(raw)).strip()

NUMBER_RE = re.compile(r"^\d+(\.\d+)?$")

def parse_qty(text_value):
    # "7 000" -> 7000, "5 400,0" -> 5400.0, "123-" -> -123, "" -> None
    s = text_value.strip()
    if not s:
        return None

    negative = False
    if s.endswith("-"):
        negative = True
        s = s[:-1].strip()
    elif s.startswith("-"):
        negative = True
        s = s[1:].strip()

    s = WHITESPACE_RE.sub("", s)  # oddelovace tisicu
    s = s.replace(",", ".")  # desetinna carka -> tecka

    if not NUMBER_RE.match(s):
        return None
    value = float(s)
    return -value if negative else value

PERIOD_PATTERNS = [
    ("day", re.compile(r"^D\s*(\d+)(?:/(\d+))?$", re.I)),
    ("week", re.compile(r"^W\s*(\d+)(?:/(\d+))?$", re.I)),
    ("month", re.compile(r"^M\s*(\d+)(?:/(\d+))?$", re.I)),
]

PERIOD_LABEL_PREFIX = {"week": "cw", "month": "cm"}

def classify_period_header(header):
    for period_type, pattern in PERIOD_PATTERNS:
        m = pattern.match(header)
        if m:
            number, year = m.group(1), m.group(2)
            prefix = PERIOD_LABEL_PREFIX.get(period_type)
            if prefix:
                label = f"{prefix} {number}/{year}" if year else f"{prefix} {number}"
                return period_type, label
            return period_type, number
    return None

ROW_RE = re.compile(r"<tr>([\s\S]*?)</tr>")
NOBR_RE = re.compile(r"<nobr[^>]*>([\s\S]*?)</nobr>")

def parse_forecast_html(html):
    """
    Vraci (rows, warnings). Kazdy radek exportu = jeden radek na vystupu,
    beze slucovani/scitani - to uz je vec SQL, ne tohoto skriptu.
    """
    warnings = []
    period_columns = None
    rows = []

    for row_match in ROW_RE.finditer(html):
        cells = [cell_text(c) for c in NOBR_RE.findall(row_match.group(1))]
        if not cells:
            continue

        if cells[0] == "Material":
            period_columns = []
            for idx, header in enumerate(cells):
                if idx in (0, 1):  # Material / Backlog
                    period_columns.append(None)
                    continue
                classified = classify_period_header(header)
                if not classified:
                    warnings.append(f'Neznamy sloupec v hlavicce, ignoruji: "{header}"')
                period_columns.append(classified)
            continue

        if period_columns is None:
            warnings.append("Datovy radek pred hlavickou tabulky byl preskocen.")
            continue

        local_material = cells[0]
        if not local_material:
            continue

        for idx in range(2, len(cells)):
            period = period_columns[idx] if idx < len(period_columns) else None
            if period is None:
                continue
            qty = parse_qty(cells[idx])
            if qty is None:
                continue  # prazdna bunka = zadny pozadavek dane obdobi
            period_type, period_label = period
            rows.append(
                {
                    "local_material": local_material,
                    "period_type": period_type,
                    "period_label": period_label,
                    "requirement_qty": qty,
                }
            )

    return rows, warnings

def table_for_filename(filename):
    for pattern, table in JOB_TABLE_MAP:
        if pattern.search(filename):
            return table
    return None

def is_candidate(filename):
    return bool(EXT_PATTERN.search(filename)) and table_for_filename(filename) is not None

# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------

def compute_mod_pn(local_material):
    """Odvozuje mod_pn z local_material pro JOIN na dbo.pckDatabase.PartNumber.
    Pravidla se zkousi v tomto poradi (prefixy se navzajem vylucuji, takze
    poradi mezi pravidly 1-3 fakticky nehraje roli, jen 4 je vzdy az posledni):
      1) zacina "00"          -> oriznou se vsechny uvodni nuly
      2) zacina "A2C", delka 11 -> odebere se posledni znak
      3) zacina "AAA", delka 13 -> odeberou se posledni 3 znaky
      4) jinak                -> beze zmeny
    """
    if local_material is None:
        return None
    s = str(local_material)
    if s.startswith("00"):
        return s.lstrip("0") or "0"
    if s.startswith("A2C") and len(s) == 11:
        return s[:-1]
    if s.startswith("AAA") and len(s) == 13:
        return s[:-3]
    return s

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

def load_rows_to_sql(engine, table_name, rows):
    target_table = f"{TARGET_SCHEMA}.{table_name}"

    df = pd.DataFrame(rows, columns=["local_material", "period_type", "period_label", "requirement_qty"])
    df["local_material"] = df["local_material"].astype(str).str.strip()
    df["period_type"] = df["period_type"].astype(str).str.strip()
    df["period_label"] = df["period_label"].astype(str).str.strip()
    df["requirement_qty"] = pd.to_numeric(df["requirement_qty"], errors="coerce").fillna(0)
    df["mod_pn"] = df["local_material"].map(compute_mod_pn)
    df["loaded_at"] = datetime.now()  # jeden spolecny cas zapisu pro cely tento load

    # Full refresh (DELETE + INSERT) v jedne transakci, aby tabulka nebyla
    # mezitim viditelna prazdna a pri chybe se cely zapis vratil zpet.
    with engine.begin() as conn:
        deleted = conn.execute(text(f"DELETE FROM {target_table}")).rowcount
        log(f"SQL_DELETE | table={target_table} | deleted_rowcount={deleted}")

        df.to_sql(
            table_name,
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

def move_to_done(path, table_name):
    """Presune zpracovany soubor do .\\Done s casovym razitkem v nazvu
    (SAP export ma porad stejne jmeno, takze bez razitka by se dalsi
    zaznam proste prepsal pres predchozi) a orizne historii daneho jobu
    na DONE_RETENTION nejnovejsich souboru."""
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

    enforce_done_retention(table_name)

def enforce_done_retention(table_name):
    pattern = next(p for p, t in JOB_TABLE_MAP if t == table_name)
    try:
        entries = os.listdir(DONE_DIR)
    except OSError:
        return

    matching = [f for f in entries if pattern.search(f) and os.path.isfile(os.path.join(DONE_DIR, f))]
    matching.sort(key=lambda f: os.path.getmtime(os.path.join(DONE_DIR, f)))

    for f in matching[:-DONE_RETENTION] if len(matching) > DONE_RETENTION else []:
        full = os.path.join(DONE_DIR, f)
        try:
            os.remove(full)
            log(f'Smazan stary soubor v Done (nad limit {DONE_RETENTION}): "{f}"')
        except OSError as err:
            log_error(f'CHYBA pri mazani stareho souboru v Done "{f}": {err}')

# ---------------------------------------------------------------------------
# Hlidani slozky
# ---------------------------------------------------------------------------

def process_file(engine, path, table_name):
    """Rozparsuje soubor, zapise vysledek do SQL a presune soubor do Done.
    Vraci pocet zapsanych radku. Pouziva se z watch rezimu i jednorazoveho
    rezimu, aby se chovaly stejne."""
    with open(path, "r", encoding="utf-8") as f:
        html = f.read()

    rows, warnings = parse_forecast_html(html)
    for w in warnings:
        log(f"[UPOZORNENI] {w}")
    if not rows:
        raise ValueError("V souboru nebyl nalezen zadny pouzitelny radek s daty.")

    load_rows_to_sql(engine, table_name, rows)
    move_to_done(path, table_name)
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
    table_name = table_for_filename(filename)
    if not table_name:
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
        count = process_file(engine, path, table_name)
        last_processed[path] = mtime_after
        log(f'Hotovo: "{filename}" -> {TARGET_SCHEMA}.{table_name} ({count} radku).')
    except Exception as err:  # noqa: BLE001 - chceme zalogovat a pokracovat ve sledovani
        log_error(f'CHYBA pri zpracovani "{filename}": {err}')
        log_error(traceback.format_exc())
    finally:
        in_progress.discard(path)

def watch(engine):
    log(f"Sleduji slozku: {WATCH_DIR}")
    log(
        "Hledam soubory odpovidajici: *FST_PCK_FC_W*.htm(l), *HRU_PCK_FC_W*.htm(l), "
        "*FST_PCK_FC_M*.htm(l) a *HRU_PCK_FC_M*.htm(l)"
    )

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
        # Jednorazovy rezim: python dco_watch.py soubor.htm
        input_path = os.path.abspath(input_arg)
        filename = os.path.basename(input_path)
        table_name = table_for_filename(filename)
        if not table_name:
            log(
                f'Soubor "{filename}" neodpovida zadnemu znamemu vzoru '
                "(FST_PCK_FC_W, HRU_PCK_FC_W, FST_PCK_FC_M, HRU_PCK_FC_M)."
            )
            sys.exit(1)

        engine = get_engine()
        count = process_file(engine, input_path, table_name)
        log(f"Hotovo: {count} radku zapsano do {TARGET_SCHEMA}.{table_name}")
        return

    engine = get_engine()
    watch(engine)

if __name__ == "__main__":
    main()

