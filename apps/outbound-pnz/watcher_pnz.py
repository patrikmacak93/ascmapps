"""
pnz_watch.py

Hlídá tuto složku. Jakmile se v ní objeví nebo změní soubor s „pnzListSAP“
v názvu (SAP ALV export, .htm/.html), počká, až se dopíše na disk, rozparsuje
jednoduchou tabulku (Char20 / CHAR35 / Text 42 / c) a nahraje (DELETE + INSERT
v jedné transakci, včetně času zápisu ve sloupci loaded_at) do SQL tabulky:

*pnzListSAP*.htm(l) -> outbound.pnzListSAP_zcze_sd_pn

Struktura exportu (jedna tabulka, první řádek = hlavička):
Char20 -> record_type (konstanta, např. „ZPNZ_PR“)
CHAR35 -> local_material (materiálové číslo)
Text 42 -> assigned_pn (přiřazené PN, např. „PNZ5405“); pokud je
v buňce více hodnot oddělených čárkou/středníkem
(např. „PNE16007, PNZ8650“), každá se uloží
jako samostatný řádek
c -> prázdný sloupec, ignoruje se

Sloupec imt_url se dopočítává z assigned_pn. Jedná se o odkaz do IMT
(Vitesco), kde je na konci filtru dosazena konkrétní PN daného řádku
(viz IMT_URL_TEMPLATE).

Po úspěšném zápisu se zpracovaný soubor přesune do podsložky .\\Done
a přejmenuje na „done_<původní název>_<časové razítko>.<přípona>“
(razítko kvůli tomu, aby se stejně pojmenované exporty nepřepisovaly).
V Done se drží jen posledních DONE_RETENTION souborů; starší se smažou.

Server FSDB0005\\I0176, databáze FSTASCM, Windows Trusted Authentication –
stejný vzor jako dco_watch.py.

Tabulka se nezakládá sama – je potřeba nejdříve spustit
create_pnzListSAP_table.sql (viz tento adresář).

Závislosti (stejně jako dco_watch.py):
pandas, sqlalchemy, pyodbc, ODBC Driver 18 for SQL Server

Spuštění:
python pnz_watch.py -> hlídá složku (dvojklik přes start-watch.bat)
python pnz_watch.py soubor.htm -> jednorázově zpracuje jen tento soubor

Hlídána složka je standardně stejná, kde leží tento skript. Pro hlídání jiné
složky nastav před spuštěním proměnnou prostředí PNZ_WATCH_DIR. Done i log
pak vzniknou v této složce, nikoli u skriptu.
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

# Složka, která se hlídá – standardně stejná složka, kde leží skript.
# Lze ji přepsat proměnnou prostředí PNZ_WATCH_DIR.
WATCH_DIR = (
    os.environ.get("PNZ_WATCH_DIR")
    or os.path.dirname(os.path.abspath(__file__))
)

LOG_PATH = os.path.join(WATCH_DIR, "pnz_watch.log")
MAX_LOG_LINES = 500

# Vzor v názvu souboru, který skript zpracovává (case-insensitive).
FILENAME_PATTERN = re.compile(r"pnzListSAP", re.IGNORECASE)
EXT_PATTERN = re.compile(r"\.html?$", re.IGNORECASE)

POLL_INTERVAL_S = 2
STABLE_CHECK_S = 1
STABLE_ROUNDS = 2

CHUNKSIZE = 5000

DONE_DIR = os.path.join(WATCH_DIR, "Done")
DONE_RETENTION = 10  # Kolik posledních souborů se drží v Done.

# Šablona odkazu do IMT (Vitesco).
# {pn} se nahradí hodnotou assigned_pn daného řádku.
IMT_URL_TEMPLATE = (
    "https://imt.vitesco-technologies.net/IMT/fst/Published"
    "?sort=Published-desc&page=1&pageSize=100"
    "&group=Area-asc~Project-asc"
    "&filter=Number~contains~%27{pn}%27"
)


# ---------------------------------------------------------------------------
# Logování
# ---------------------------------------------------------------------------

def _trim_log_file(path, max_lines=MAX_LOG_LINES):
    try:
        with open(path, "r", encoding="utf-8") as file:
            lines = file.readlines()

        if len(lines) > max_lines:
            with open(path, "w", encoding="utf-8") as file:
                file.writelines(lines[-max_lines:])

    except FileNotFoundError:
        pass


# Trim logu je drahé, protože načte a přepíše celý soubor.
# Proto se provádí pouze jednou za _TRIM_EVERY zápisů.
_TRIM_EVERY = 200
_log_counter = 0


def log(msg):
    global _log_counter

    line = f"[{datetime.now().isoformat()}] {msg}"
    print(line, flush=True)

    try:
        with open(LOG_PATH, "a", encoding="utf-8") as file:
            file.write(line + "\n")

        _log_counter += 1

        if _log_counter >= _TRIM_EVERY:
            _log_counter = 0
            _trim_log_file(LOG_PATH)

    except PermissionError:
        pass


# ---------------------------------------------------------------------------
# Parser SAP HTML exportu
# ---------------------------------------------------------------------------

ENTITY_MAP = {
    "nbsp": " ",
    "amp": "&",
    "lt": "<",
    "gt": ">",
    "quot": '"',
    "apos": "'",
}

ENTITY_RE = re.compile(r"&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);")
WHITESPACE_RE = re.compile(r"\s+")
TAG_RE = re.compile(r"<[^>]+>")

ROW_RE = re.compile(r"<tr[^>]*>([\s\S]*?)</tr>", re.IGNORECASE)
TD_RE = re.compile(r"<td[^>]*>([\s\S]*?)</td>", re.IGNORECASE)
NOBR_RE = re.compile(r"<nobr[^>]*>([\s\S]*?)</nobr>", re.IGNORECASE)

# Rozdělení sloupců ve druhém formátu.
COL_SPLIT_RE = re.compile(r"\s{2,}")

# Rozdělení více PN v jedné buňce.
ASSIGNED_SPLIT_RE = re.compile(r"[,;]+")

HEADER_FIRST_CELL = "Char20"
RECORD_TYPE = "ZPNZ_PR"


def decode_entities(value):
    def replace_entity(match):
        entity = match.group(1)

        if entity.startswith("#"):
            try:
                if entity[1] in "xX":
                    return chr(int(entity[2:], 16))

                return chr(int(entity[1:], 10))

            except ValueError:
                return match.group(0)

        return ENTITY_MAP.get(entity, match.group(0))

    return ENTITY_RE.sub(replace_entity, value)


def cell_text(raw):
    value = TAG_RE.sub("", raw)
    value = decode_entities(value)
    return WHITESPACE_RE.sub(" ", value).strip()


def _extract_rows_td(html):
    """
    Formát 1: každý řádek je <tr> a sloupce jsou samostatné <td> buňky.

    Vrací dvojici (řádky, nalezena_hlavička), kde řádek je seznam buněk.
    """
    rows = []
    saw_header = False

    for row_match in ROW_RE.finditer(html):
        cells = [
            cell_text(cell)
            for cell in TD_RE.findall(row_match.group(1))
        ]

        if not cells:
            continue

        if cells[0] == HEADER_FIRST_CELL:
            saw_header = True
            continue

        rows.append(cells)

    return rows, saw_header


def _extract_rows_nobr(html):
    """
    Formát 2: celý řádek je v jednom <nobr> a sloupce jsou oddělené
    dvěma nebo více mezerami.

    Vrací dvojici (řádky, nalezena_hlavička), kde řádek je seznam sloupců.
    """
    rows = []
    saw_header = False

    for nobr_match in NOBR_RE.finditer(html):
        # Zachováme mezery mezi sloupci.
        value = TAG_RE.sub("", nobr_match.group(1))
        value = decode_entities(value)
        value = value.replace("\xa0", " ").strip()

        if not value:
            continue

        if value.startswith(HEADER_FIRST_CELL):
            saw_header = True
            continue

        # Nadpis, číslo stránky, datum apod.
        if not value.startswith(RECORD_TYPE):
            continue

        parts = [
            part.strip()
            for part in COL_SPLIT_RE.split(value)
            if part.strip()
        ]

        if len(parts) < 3:
            continue

        # record_type, local_material, zbytek = PN.
        rows.append([parts[0], parts[1], " ".join(parts[2:])])

    return rows, saw_header


def parse_pnz_html(html):
    """
    Vrací dvojici (rows, warnings).

    Každý vstupní řádek může vytvořit jeden nebo více výstupních řádků.
    Pokud je ve sloupci PN více hodnot oddělených čárkou nebo středníkem,
    každá PN se uloží jako samostatný řádek.

    Výstupní sloupce:
    record_type, local_material, assigned_pn
    """
    warnings = []
    rows = []

    if "<td" in html.lower():
        parsed_rows, saw_header = _extract_rows_td(html)
    else:
        parsed_rows, saw_header = _extract_rows_nobr(html)

    for cells in parsed_rows:
        if len(cells) < 3:
            warnings.append(
                f"Řádek s méně než 3 sloupci, ignoruji: {cells!r}"
            )
            continue

        record_type = cells[0]
        local_material = cells[1]
        assigned_raw = cells[2]

        if not local_material:
            continue

        assigned_parts = [
            part.strip()
            for part in ASSIGNED_SPLIT_RE.split(assigned_raw)
            if part.strip()
        ]

        if not assigned_parts:
            rows.append(
                {
                    "record_type": record_type,
                    "local_material": local_material,
                    "assigned_pn": None,
                }
            )
            continue

        if len(assigned_parts) > 1:
            warnings.append(
                f"{local_material}: v Text 42 je více PN "
                f"{assigned_parts} – ukládám všechny."
            )

        for assigned_pn in assigned_parts:
            rows.append(
                {
                    "record_type": record_type,
                    "local_material": local_material,
                    "assigned_pn": assigned_pn,
                }
            )

    if not saw_header:
        warnings.append(
            'Hlavička ("Char20") nebyla nalezena – '
            "ověřte formát exportu."
        )

    return rows, warnings


def is_candidate(filename):
    return (
        bool(EXT_PATTERN.search(filename))
        and bool(FILENAME_PATTERN.search(filename))
    )


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------

def build_imt_url(assigned_pn):
    """Sestaví odkaz do IMT pro danou PN."""
    if not assigned_pn:
        return None

    encoded_pn = urllib.parse.quote(str(assigned_pn), safe="")
    return IMT_URL_TEMPLATE.format(pn=encoded_pn)


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

    dataframe = pd.DataFrame(
        rows,
        columns=["record_type", "local_material", "assigned_pn"],
    )

    dataframe["record_type"] = (
        dataframe["record_type"].astype(str).str.strip()
    )
    dataframe["local_material"] = (
        dataframe["local_material"].astype(str).str.strip()
    )
    dataframe["assigned_pn"] = dataframe["assigned_pn"].where(
        dataframe["assigned_pn"].notna(),
        None,
    )
    dataframe["imt_url"] = dataframe["assigned_pn"].map(build_imt_url)
    dataframe["loaded_at"] = datetime.now()

    # Full refresh (DELETE + INSERT) v jedné transakci.
    with engine.begin() as connection:
        deleted = connection.execute(
            text(f"DELETE FROM {target_table}")
        ).rowcount

        log(
            f"SQL_DELETE | table={target_table} | "
            f"deleted_rowcount={deleted}"
        )

        dataframe.to_sql(
            TARGET_TABLE,
            con=connection,
            schema=TARGET_SCHEMA,
            if_exists="append",
            index=False,
            chunksize=CHUNKSIZE,
            method=None,
        )

        log(
            f"SQL_INSERT | table={target_table} | "
            f"inserted_rows={len(dataframe)}"
        )

        count = connection.execute(
            text(f"SELECT COUNT(*) FROM {target_table}")
        ).scalar()

        log(
            f"SQL_VERIFY | table={target_table} | "
            f"count_after={count}"
        )


# ---------------------------------------------------------------------------
# Složka Done
# ---------------------------------------------------------------------------

def enforce_done_retention():
    try:
        entries = os.listdir(DONE_DIR)
    except OSError:
        return

    matching = [
        filename
        for filename in entries
        if (
            FILENAME_PATTERN.search(filename)
            and os.path.isfile(os.path.join(DONE_DIR, filename))
        )
    ]

    matching.sort(
        key=lambda filename: os.path.getmtime(
            os.path.join(DONE_DIR, filename)
        )
    )

    files_to_delete = (
        matching[:-DONE_RETENTION]
        if len(matching) > DONE_RETENTION
        else []
    )

    for filename in files_to_delete:
        full_path = os.path.join(DONE_DIR, filename)

        try:
            os.remove(full_path)
            log(
                f'Smazán starý soubor v Done '
                f'(nad limit {DONE_RETENTION}): "{filename}"'
            )
        except OSError as error:
            log(
                f'CHYBA při mazání starého souboru v Done '
                f'"{filename}": {error}'
            )


def move_to_done(path):
    """
    Přesune zpracovaný soubor do .\\Done s časovým razítkem v názvu.
    """
    os.makedirs(DONE_DIR, exist_ok=True)

    base, extension = os.path.splitext(os.path.basename(path))
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    destination = os.path.join(
        DONE_DIR,
        f"done_{base}_{timestamp}{extension}",
    )

    counter = 1

    while os.path.exists(destination):
        destination = os.path.join(
            DONE_DIR,
            f"done_{base}_{timestamp}_{counter}{extension}",
        )
        counter += 1

    shutil.move(path, destination)
    log(f'Přesunuto do Done: "{os.path.basename(destination)}"')

    enforce_done_retention()


# ---------------------------------------------------------------------------
# Hlídání složky
# ---------------------------------------------------------------------------

def process_file(engine, path):
    """
    Rozparsuje soubor, zapíše výsledek do SQL a přesune soubor do Done.

    Vrací počet zapsaných řádků.
    """
    with open(path, "r", encoding="utf-8") as file:
        html = file.read()

    rows, warnings = parse_pnz_html(html)

    for warning in warnings:
        log(f"[UPOZORNĚNÍ] {warning}")

    if not rows:
        raise ValueError(
            "V souboru nebyl nalezen žádný použitelný řádek s daty."
        )

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
            return False

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
            return

        in_progress.add(path)
        log(
            f'Detekován soubor "{filename}", '
            "čekám, až se dopíše..."
        )

        if not wait_until_stable(path):
            log(
                f'Soubor "{filename}" zmizel před zpracováním, '
                "přeskakuji."
            )
            return

        mtime_after = os.path.getmtime(path)
        count = process_file(engine, path)

        last_processed[path] = mtime_after

        log(
            f'Hotovo: "{filename}" -> '
            f"{TARGET_SCHEMA}.{TARGET_TABLE} ({count} řádků)."
        )

    except Exception as error:  # noqa: BLE001
        log(f'CHYBA při zpracování "{filename}": {error}')
        log(traceback.format_exc())

    finally:
        in_progress.discard(path)


def watch(engine):
    log(f"Sleduji složku: {WATCH_DIR}")
    log("Hledám soubory odpovídající: *pnzListSAP*.htm(l)")

    last_processed = {}
    in_progress = set()

    def scan():
        try:
            entries = os.listdir(WATCH_DIR)
        except OSError:
            return

        for filename in entries:
            if not is_candidate(filename):
                continue

            full_path = os.path.join(WATCH_DIR, filename)

            if os.path.isfile(full_path):
                handle_file(
                    engine,
                    full_path,
                    last_processed,
                    in_progress,
                )

    scan()

    while True:
        time.sleep(POLL_INTERVAL_S)
        scan()


# ---------------------------------------------------------------------------
# Vstupní bod
# ---------------------------------------------------------------------------

def main():
    input_arg = sys.argv[1] if len(sys.argv) > 1 else None

    if input_arg:
        # Jednorázový režim: python pnz_watch.py soubor.htm
        input_path = os.path.abspath(input_arg)
        filename = os.path.basename(input_path)

        if not is_candidate(filename):
            log(
                f'Soubor "{filename}" neodpovídá vzoru '
                "pnzListSAP (.htm/.html). Zpracovávám přesto, "
                "protože byl zadán přímo."
            )

        engine = get_engine()
        count = process_file(engine, input_path)

        log(
            f"Hotovo: {count} řádků zapsáno do "
            f"{TARGET_SCHEMA}.{TARGET_TABLE}"
        )
        return

    engine = get_engine()
    watch(engine)


if __name__ == "__main__":
    main()