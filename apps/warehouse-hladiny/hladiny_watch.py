"""
hladiny_watch.py

Hlídá jednu složku. Jakmile se v ní objeví nebo změní některý ze tří SAP ALV
exportů (.htm/.html), počká, až se dopíše na disk, rozparsuje ho a nahraje
(DELETE + INSERT v jedné transakci, včetně času zápisu loaded_at) do příslušné
tabulky. Podle názvu souboru se vybere parser i cílová tabulka:

* FST_WH_LVL*   -> skladyHladiny.potreby
                    (18 týdnů, backlog se ignoruje)
* NEW_HLADINY*  -> skladyHladiny.nove_hladiny
                    (materiály bez hladiny)
* ASCM_Hladiny* -> skladyHladiny.aktualni_hladiny
                    (aktuální stav, VALUE)

Všechny tři soubory se zpracovávají nezávisle. Po úspěšném zápisu se soubor
přesune do .\Done s časovým razítkem. V adresáři Done se uchovávají pouze
poslední DONE_RETENTION soubory pro každý job.

DŮLEŽITÉ: Tento skript pouze importuje data. Samotný výpočet hladin je až
následný krok, který se spouští ručně. Data ze všech tří reportů musí být
aktuální a dostupná:

    EXEC skladyHladiny.usp_vypocet_hladin;

Server: FSDB0005\I0176
Databáze: FSTASCM
Přihlášení: Windows Trusted Authentication
Používá stejný vzor jako dco_watch.py.

Spuštění:

    python hladiny_watch.py
        -> hlídá složku

    python hladiny_watch.py soubor.htm
        -> jednorázově zpracuje pouze tento soubor

Hlídaná složka je standardně složka, ve které leží skript. Lze ji změnit
pomocí proměnné prostředí HLADINY_WATCH_DIR.

Závislosti:

    pandas
    sqlalchemy
    pyodbc
    ODBC Driver 18 for SQL Server

Tabulky se nevytvářejí automaticky. Nejprve spusťte skript
01_schema_hladiny.sql.
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
TARGET_SCHEMA = "skladyHladiny"

WATCH_DIR = (
    os.environ.get("HLADINY_WATCH_DIR")
    or os.path.dirname(os.path.abspath(__file__))
)
LOG_PATH = os.path.join(WATCH_DIR, "hladiny_watch.log")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ERROR_LOG_PATH = os.path.join(SCRIPT_DIR, "hladiny_watch.error.log")
MAX_LOG_LINES = 500

# Název souboru -> (cílová tabulka, druh parseru).
# První shoda vyhrává.
JOB_MAP = [
    (re.compile(r"AKT_HLADN", re.I), "potreby", "potreby"),
    (re.compile(r"NEW_HLADINY", re.I), "nove_hladiny", "nove"),
    (re.compile(r"ASCM_REQ_W", re.I), "aktualni_hladiny", "hladiny"),
]

EXT_PATTERN = re.compile(r"\.html?$", re.I)

POLL_INTERVAL_S = 2
STABLE_CHECK_S = 1
STABLE_ROUNDS = 2
CHUNKSIZE = 5000

DONE_DIR = os.path.join(WATCH_DIR, "Done")
DONE_RETENTION = 3


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


def _write_log(path, line):
    try:
        with open(path, "a", encoding="utf-8") as file:
            file.write(line + "\n")

        _trim_log_file(path)
    except (PermissionError, OSError):
        pass


def log(message):
    line = f"[{datetime.now().isoformat()}] {message}"
    print(line, flush=True)
    _write_log(LOG_PATH, line)


def log_error(message):
    line = f"[{datetime.now().isoformat()}] {message}"
    print(line, flush=True)
    _write_log(ERROR_LOG_PATH, line)


# ---------------------------------------------------------------------------
# Společné HTML utility
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
ROW_RE = re.compile(r"<tr[^>]*>([\s\S]*?)</tr>", re.I)
TD_RE = re.compile(r"<td[^>]*>([\s\S]*?)</td>", re.I)
NUMBER_RE = re.compile(r"^\d+(\.\d+)?$")
WEEK_RE = re.compile(r"^W\s*(\d+)\s*/\s*(\d+)$", re.I)


def decode_entities(value):
    def replace_entity(match):
        entity = match.group(1)

        if entity[0] == "#":
            try:
                code = (
                    int(entity[2:], 16)
                    if entity[1] in "xX"
                    else int(entity[1:], 10)
                )
                return chr(code)
            except ValueError:
                return match.group(0)

        return ENTITY_MAP.get(entity, match.group(0))

    return ENTITY_RE.sub(replace_entity, value)


def cell_text(raw):
    """
    Vytáhne čistý text buňky – odstraní vnořené tagy <font>/<nobr>
    i HTML entity.
    """
    value = TAG_RE.sub("", raw)
    value = decode_entities(value)
    return WHITESPACE_RE.sub(" ", value).strip()


def row_cells(row_html):
    return [cell_text(cell) for cell in TD_RE.findall(row_html)]


def parse_qty(text_value):
    """
    Převede například:

        '7 000'   -> 7000
        '5 400,0' -> 5400.0
        '123-'    -> -123
        ''        -> None
    """
    value = text_value.strip()

    if not value:
        return None

    negative = False

    if value.endswith("-"):
        negative = True
        value = value[:-1].strip()
    elif value.startswith("-"):
        negative = True
        value = value[1:].strip()

    value = WHITESPACE_RE.sub("", value).replace(",", ".")

    if not NUMBER_RE.match(value):
        return None

    number = float(value)
    return -number if negative else number


# ---------------------------------------------------------------------------
# Parsery
# ---------------------------------------------------------------------------

def parse_potreby(html):
    """
    Materiál + 18 týdnů.

    Backlog (index 1) se ignoruje. Prázdné buňky se ukládají jako 0, aby
    v tabulce zůstaly i materiály s nulovými hodnotami.
    """
    warnings = []
    rows = []
    week_columns = None

    for row_match in ROW_RE.finditer(html):
        cells = row_cells(row_match.group(1))

        if not cells:
            continue

        if cells[0] == "Material":
            week_columns = []

            for index, header in enumerate(cells):
                if index in (0, 1):
                    # Material, Backlog
                    continue

                match = WEEK_RE.match(header)

                if not match:
                    warnings.append(
                        f'Neznámý sloupec v hlavičce, ignoruji: "{header}"'
                    )
                    continue

                week_columns.append(
                    (index, f"cw {match.group(1)}/{match.group(2)}")
                )

            continue

        if week_columns is None:
            continue

        material = cells[0]

        if not material:
            continue

        for period_index, (column_index, label) in enumerate(week_columns):
            raw_value = (
                cells[column_index]
                if column_index < len(cells)
                else ""
            )
            quantity = parse_qty(raw_value)

            rows.append(
                {
                    "material": material,
                    "period_index": period_index,
                    "period_label": label,
                    "requirement_qty": 0 if quantity is None else quantity,
                }
            )

    if not week_columns:
        warnings.append(
            'Hlavička ("Material") nebyla nalezena – ověřte formát exportu.'
        )

    return rows, warnings


def parse_hladiny(html):
    """
    Plant, Material, Storage Type, VALUE, XMOVE.

    Sloupec XMOVE se zahazuje.
    """
    warnings = []
    rows = []
    header_found = False

    for row_match in ROW_RE.finditer(html):
        cells = row_cells(row_match.group(1))

        if not cells:
            continue

        if cells[0] == "Plant":
            header_found = True
            continue

        if not header_found or len(cells) < 4 or not cells[1]:
            continue

        rows.append(
            {
                "material": cells[1],
                "plant": cells[0] or None,
                "storage_type": cells[2] or None,
                "current_level": parse_qty(cells[3]) or 0,
            }
        )

    if not header_found:
        warnings.append(
            'Hlavička ("Plant") nebyla nalezena – ověřte formát exportu.'
        )

    return rows, warnings


def parse_nove(html):
    """
    Plnt, Typ, Material, Total stock, BUn, Typ, ZFST_WM_SMT-VALUE.

    Před hlavičkou je ALV smetí – čeká se na řádek s první buňkou "Plnt".
    Datové řádky mají Plnt = "*" (subtotal marker).
    """
    warnings = []
    rows = []
    header_found = False

    for row_match in ROW_RE.finditer(html):
        cells = row_cells(row_match.group(1))

        if not cells:
            continue

        if cells[0] == "Plnt":
            header_found = True
            continue

        if not header_found or len(cells) < 5:
            continue

        material = cells[2]

        if not material or material == "*":
            continue

        rows.append(
            {
                "material": material,
                "plant": cells[0] if cells[0] not in ("*", "") else None,
                "storage_type": cells[1] or None,
                "total_stock": parse_qty(cells[3]),
                "base_unit": cells[4] or None,
            }
        )

    if not header_found:
        warnings.append(
            'Hlavička ("Plnt") nebyla nalezena – ověřte formát exportu.'
        )

    return rows, warnings


PARSERS = {
    "potreby": parse_potreby,
    "hladiny": parse_hladiny,
    "nove": parse_nove,
}

COLUMNS = {
    "potreby": [
        "material",
        "period_index",
        "period_label",
        "requirement_qty",
    ],
    "aktualni_hladiny": [
        "material",
        "plant",
        "storage_type",
        "current_level",
    ],
    "nove_hladiny": [
        "material",
        "plant",
        "storage_type",
        "total_stock",
        "base_unit",
    ],
}


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------

def get_engine():
    connection_string = (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={SERVER};"
        f"DATABASE={DATABASE};"
        "Trusted_Connection=yes;"
        "TrustServerCertificate=yes;"
    )

    params = urllib.parse.quote_plus(connection_string)

    return create_engine(
        f"mssql+pyodbc:///?odbc_connect={params}",
        fast_executemany=True,
        connect_args={"timeout": 10},
        pool_pre_ping=True,
    )


def load_rows_to_sql(engine, table_name, rows):
    target = f"{TARGET_SCHEMA}.{table_name}"

    dataframe = pd.DataFrame(rows, columns=COLUMNS[table_name])
    dataframe["loaded_at"] = datetime.now()

    with engine.begin() as connection:
        deleted = connection.execute(
            text(f"DELETE FROM {target}")
        ).rowcount

        log(
            f"SQL_DELETE | table={target} | "
            f"deleted_rowcount={deleted}"
        )

        dataframe.to_sql(
            table_name,
            con=connection,
            schema=TARGET_SCHEMA,
            if_exists="append",
            index=False,
            chunksize=CHUNKSIZE,
            method=None,
        )

        log(
            f"SQL_INSERT | table={target} | "
            f"inserted_rows={len(dataframe)}"
        )

        count = connection.execute(
            text(f"SELECT COUNT(*) FROM {target}")
        ).scalar()

        log(f"SQL_VERIFY | table={target} | count_after={count}")


# ---------------------------------------------------------------------------
# Job podle názvu souboru
# ---------------------------------------------------------------------------

def job_for_filename(filename):
    for pattern, table_name, parser_kind in JOB_MAP:
        if pattern.search(filename):
            return table_name, parser_kind

    return None, None


def is_candidate(filename):
    return (
        bool(EXT_PATTERN.search(filename))
        and job_for_filename(filename)[0] is not None
    )


# ---------------------------------------------------------------------------
# Done archiv
# ---------------------------------------------------------------------------

def move_to_done(path, table_name):
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
    enforce_done_retention(table_name)


def enforce_done_retention(table_name):
    pattern = next(
        pattern
        for pattern, table, _ in JOB_MAP
        if table == table_name
    )

    try:
        entries = os.listdir(DONE_DIR)
    except OSError:
        return

    matching_files = [
        filename
        for filename in entries
        if pattern.search(filename)
        and os.path.isfile(os.path.join(DONE_DIR, filename))
    ]

    matching_files.sort(
        key=lambda filename: os.path.getmtime(
            os.path.join(DONE_DIR, filename)
        )
    )

    files_to_delete = (
        matching_files[:-DONE_RETENTION]
        if len(matching_files) > DONE_RETENTION
        else []
    )

    for filename in files_to_delete:
        file_path = os.path.join(DONE_DIR, filename)

        try:
            os.remove(file_path)
            log(
                f'Smazán starý soubor v Done '
                f"(nad limit {DONE_RETENTION}): "
                f'"{filename}"'
            )
        except OSError as error:
            log_error(
                f'CHYBA při mazání "{filename}": {error}'
            )


# ---------------------------------------------------------------------------
# Zpracování souboru a hlídání
# ---------------------------------------------------------------------------

def process_file(engine, path, table_name, parser_kind):
    with open(path, "r", encoding="utf-8") as file:
        html = file.read()

    rows, warnings = PARSERS[parser_kind](html)

    for warning in warnings:
        log(f"[UPOZORNĚNÍ] {warning}")

    if not rows:
        raise ValueError(
            "V souboru nebyl nalezen žádný použitelný řádek s daty."
        )

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

    table_name, parser_kind = job_for_filename(filename)

    if not table_name:
        return

    try:
        if not os.path.exists(path):
            return

        modification_time = os.path.getmtime(path)

        if last_processed.get(path) == modification_time:
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

        count = process_file(
            engine,
            path,
            table_name,
            parser_kind,
        )

        last_processed.pop(path, None)

        log(
            f'Hotovo: "{filename}" -> '
            f"{TARGET_SCHEMA}.{table_name} ({count} řádků)."
        )

    except Exception as error:  # noqa: BLE001
        log_error(
            f'CHYBA při zpracování "{filename}": {error}'
        )
        log_error(traceback.format_exc())

    finally:
        in_progress.discard(path)


def watch(engine):
    log(f"Sleduji složku: {WATCH_DIR}")
    log(
        "Hledám: *FST_WH_LVL*, *NEW_HLADINY*, "
        "*ASCM_Hladiny* (.htm/.html)"
    )

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


def main():
    argument = sys.argv[1] if len(sys.argv) > 1 else None

    if argument:
        path = os.path.abspath(argument)
        table_name, parser_kind = job_for_filename(
            os.path.basename(path)
        )

        if not table_name:
            log(
                "Soubor neodpovídá žádnému známému vzoru "
                "(FST_WH_LVL / NEW_HLADINY / ASCM_Hladiny)."
            )
            sys.exit(1)

        engine = get_engine()

        count = process_file(
            engine,
            path,
            table_name,
            parser_kind,
        )

        log(
            f"Hotovo: {count} řádků -> "
            f"{TARGET_SCHEMA}.{table_name}"
        )
        return

    engine = get_engine()
    watch(engine)


if __name__ == "__main__":
    main()