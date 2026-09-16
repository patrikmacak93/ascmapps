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


# =============================================================================
# Společný SQL server / engine
# =============================================================================

SERVER = r"FSDB0005\I0176"
DATABASE = "FSTASCM"
DRIVER = "ODBC Driver 18 for SQL Server"

POLL_INTERVAL_S = 2
STABLE_CHECK_S = 1
STABLE_ROUNDS = 2
CHUNKSIZE = 5000
MAX_LOG_LINES = 500

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
EXT_PATTERN = re.compile(r"\.html?$", re.IGNORECASE)


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


def resolve_watch_dir(*env_vars):
    """Vrátí první nastavenou proměnnou prostředí.

    Pokud není nastavena žádná proměnná, vrátí složku, kde leží tento skript.
    """
    for env_var in env_vars:
        value = os.environ.get(env_var)
        if value:
            return value

    return SCRIPT_DIR


# =============================================================================
# Společné logování
# =============================================================================

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


def make_logger(log_path, error_log_path):
    """Vrátí dvojici funkcí logování: log a log_error."""

    def log(msg):
        line = f"[{datetime.now().isoformat()}] {msg}"
        print(line, flush=True)
        _write_log(log_path, line)

    def log_error(msg):
        line = f"[{datetime.now().isoformat()}] {msg}"
        print(line, flush=True)
        _write_log(error_log_path, line)

    return log, log_error


# =============================================================================
# Společné HTML / souborové utility
# =============================================================================

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
NUMBER_RE = re.compile(r"^\d+(\.\d+)?$")


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


def cell_text_stripped(raw):
    """Odstraní vnořené tagy i HTML entity."""
    value = TAG_RE.sub("", raw)
    value = decode_entities(value)
    return WHITESPACE_RE.sub(" ", value).strip()


def cell_text_plain(raw):
    """Pouze dekóduje entity a upraví mezery."""
    return WHITESPACE_RE.sub(" ", decode_entities(raw)).strip()


def parse_qty(text_value):
    """Převede textové množství na číslo."""
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


def enforce_done_retention(done_dir, pattern, retention, log, log_error):
    try:
        entries = os.listdir(done_dir)

    except OSError:
        return

    matching = [
        filename
        for filename in entries
        if pattern.search(filename)
        and os.path.isfile(os.path.join(done_dir, filename))
    ]

    matching.sort(
        key=lambda filename: os.path.getmtime(
            os.path.join(done_dir, filename)
        )
    )

    files_to_delete = (
        matching[:-retention]
        if len(matching) > retention
        else []
    )

    for filename in files_to_delete:
        full_path = os.path.join(done_dir, filename)

        try:
            os.remove(full_path)
            log(
                f'Smazán starý soubor v Done '
                f'(nad limit {retention}): "{filename}"'
            )

        except OSError as error:
            log_error(
                f'CHYBA při mazání starého souboru v Done '
                f'"{filename}": {error}'
            )


def move_to_done(path, done_dir, pattern, retention, log, log_error):
    os.makedirs(done_dir, exist_ok=True)

    base, extension = os.path.splitext(os.path.basename(path))
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    destination = os.path.join(
        done_dir,
        f"done_{base}_{timestamp}{extension}",
    )

    counter = 1

    while os.path.exists(destination):
        destination = os.path.join(
            done_dir,
            f"done_{base}_{timestamp}_{counter}{extension}",
        )
        counter += 1

    shutil.move(path, destination)

    log(
        f'Přesunuto do Done: "{os.path.basename(destination)}"'
    )

    enforce_done_retention(
        done_dir,
        pattern,
        retention,
        log,
        log_error,
    )


def handle_file(
    path,
    is_candidate,
    process_file,
    last_processed,
    in_progress,
    log,
    log_error,
):
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

        count, target_desc = process_file(path)

        # Soubor je po zpracování přesunut do Done.
        last_processed.pop(path, None)

        log(
            f'Hotovo: "{filename}" -> {target_desc} '
            f"({count} řádků)."
        )

    except Exception as error:  # noqa: BLE001
        log_error(
            f'CHYBA při zpracování "{filename}": {error}'
        )
        log_error(traceback.format_exc())

    finally:
        in_progress.discard(path)


# =============================================================================
# PNZ
# =============================================================================

PNZ_TARGET_SCHEMA = "outbound"
PNZ_TARGET_TABLE = "pnzListSAP_zcze_sd_pn"

PNZ_FILENAME_PATTERN = re.compile(r"pnzListSAP", re.IGNORECASE)

PNZ_ROW_RE = re.compile(
    r"<tr[^>]*>([\s\S]*?)</tr>",
    re.IGNORECASE,
)

PNZ_TD_RE = re.compile(
    r"<td[^>]*>([\s\S]*?)</td>",
    re.IGNORECASE,
)

PNZ_NOBR_RE = re.compile(
    r"<nobr[^>]*>([\s\S]*?)</nobr>",
    re.IGNORECASE,
)

PNZ_COL_SPLIT_RE = re.compile(r"\s{2,}")
PNZ_ASSIGNED_SPLIT_RE = re.compile(r"[,;]+")

PNZ_HEADER_FIRST_CELL = "Char20"
PNZ_RECORD_TYPE = "ZPNZ_PR"

PNZ_IMT_URL_TEMPLATE = (
    "https://imt.vitesco-technologies.net/IMT/fst/Published"
    "?sort=Published-desc&page=1&pageSize=100"
    "&group=Area-asc~Project-asc"
    "&filter=Number~contains~%27{pn}%27"
)


def pnz_is_candidate(filename):
    return (
        bool(EXT_PATTERN.search(filename))
        and bool(PNZ_FILENAME_PATTERN.search(filename))
    )


def _pnz_extract_rows_td(html):
    rows = []
    saw_header = False

    for row_match in PNZ_ROW_RE.finditer(html):
        cells = [
            cell_text_stripped(cell)
            for cell in PNZ_TD_RE.findall(row_match.group(1))
        ]

        if not cells:
            continue

        if cells[0] == PNZ_HEADER_FIRST_CELL:
            saw_header = True
            continue

        rows.append(cells)

    return rows, saw_header


def _pnz_extract_rows_nobr(html):
    rows = []
    saw_header = False

    for nobr_match in PNZ_NOBR_RE.finditer(html):
        value = TAG_RE.sub("", nobr_match.group(1))
        value = decode_entities(value)
        value = value.replace("\xa0", " ").strip()

        if not value:
            continue

        if value.startswith(PNZ_HEADER_FIRST_CELL):
            saw_header = True
            continue

        if not value.startswith(PNZ_RECORD_TYPE):
            continue

        parts = [
            part.strip()
            for part in PNZ_COL_SPLIT_RE.split(value)
            if part.strip()
        ]

        if len(parts) < 3:
            continue

        rows.append(
            [
                parts[0],
                parts[1],
                " ".join(parts[2:]),
            ]
        )

    return rows, saw_header


def pnz_parse_html(html):
    warnings = []
    rows = []
    multi_pn_count = 0

    if "<td" in html.lower():
        parsed_rows, saw_header = _pnz_extract_rows_td(html)
    else:
        parsed_rows, saw_header = _pnz_extract_rows_nobr(html)

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
            for part in PNZ_ASSIGNED_SPLIT_RE.split(assigned_raw)
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

        assigned_pn = assigned_parts[0]

        if len(assigned_parts) > 1:
            multi_pn_count += 1

        rows.append(
            {
                "record_type": record_type,
                "local_material": local_material,
                "assigned_pn": assigned_pn,
            }
        )

    if multi_pn_count:
        warnings.append(
            f"{multi_pn_count} řádků mělo v Text 42 více PN – "
            "uložena jen první, zbytek zahozen."
        )

    if not saw_header:
        warnings.append(
            'Hlavička ("Char20") nebyla nalezena – '
            "ověřte formát exportu."
        )

    return rows, warnings


def pnz_build_imt_url(assigned_pn):
    if not assigned_pn:
        return None

    encoded_pn = urllib.parse.quote(str(assigned_pn), safe="")
    return PNZ_IMT_URL_TEMPLATE.format(pn=encoded_pn)


def pnz_load_rows_to_sql(engine, rows, log):
    target_table = f"{PNZ_TARGET_SCHEMA}.{PNZ_TARGET_TABLE}"

    dataframe = pd.DataFrame(
        rows,
        columns=[
            "record_type",
            "local_material",
            "assigned_pn",
        ],
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

    dataframe["imt_url"] = dataframe["assigned_pn"].map(
        pnz_build_imt_url
    )

    dataframe["loaded_at"] = datetime.now()

    with engine.begin() as connection:
        deleted = connection.execute(
            text(f"DELETE FROM {target_table}")
        ).rowcount

        log(
            f"SQL_DELETE | table={target_table} | "
            f"deleted_rowcount={deleted}"
        )

        dataframe.to_sql(
            PNZ_TARGET_TABLE,
            con=connection,
            schema=PNZ_TARGET_SCHEMA,
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


def pnz_process_file(
    engine,
    path,
    log,
    log_error,
    done_dir,
    retention,
):
    with open(path, "r", encoding="utf-8") as file:
        html = file.read()

    rows, warnings = pnz_parse_html(html)

    for warning in warnings:
        log(f"[UPOZORNĚNÍ] {warning}")

    if not rows:
        raise ValueError(
            "V souboru nebyl nalezen žádný použitelný řádek s daty."
        )

    pnz_load_rows_to_sql(engine, rows, log)

    move_to_done(
        path,
        done_dir,
        PNZ_FILENAME_PATTERN,
        retention,
        log,
        log_error,
    )

    return len(rows), f"{PNZ_TARGET_SCHEMA}.{PNZ_TARGET_TABLE}"


# =============================================================================
# HLADINY
# =============================================================================

HLADINY_TARGET_SCHEMA = "skladyHladiny"

HLADINY_ROW_RE = re.compile(
    r"<tr[^>]*>([\s\S]*?)</tr>",
    re.IGNORECASE,
)

HLADINY_TD_RE = re.compile(
    r"<td[^>]*>([\s\S]*?)</td>",
    re.IGNORECASE,
)

HLADINY_WEEK_RE = re.compile(
    r"^W\s*(\d+)\s*/\s*(\d+)$",
    re.IGNORECASE,
)

HLADINY_HEADER_FIRST = ("plant", "plnt")

HLADINY_AKT_HLD_PATTERN = re.compile(
    r"ASCM_FST_AKT_HLD",
    re.IGNORECASE,
)

HLADINY_NW_HLD_PATTERN = re.compile(
    r"ASCM_FST_NW_HLD",
    re.IGNORECASE,
)


def hladiny_row_cells(row_html):
    return [
        cell_text_stripped(cell)
        for cell in HLADINY_TD_RE.findall(row_html)
    ]


def hladiny_parse_potreby(html):
    warnings = []
    rows = []
    week_columns = None

    for row_match in HLADINY_ROW_RE.finditer(html):
        cells = hladiny_row_cells(row_match.group(1))

        if not cells:
            continue

        if cells[0] == "Material":
            week_columns = []

            for index, header in enumerate(cells):
                if index in (0, 1):
                    continue

                match = HLADINY_WEEK_RE.match(header)

                if not match:
                    warnings.append(
                        f'Neznámý sloupec v hlavičce, '
                        f'ignoruji: "{header}"'
                    )
                    continue

                week_columns.append(
                    (
                        index,
                        f"cw {match.group(1)}/{match.group(2)}",
                    )
                )

            continue

        if week_columns is None:
            continue

        material = cells[0]

        if not material:
            continue

        for period_index, (column_index, label) in enumerate(
            week_columns
        ):
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
                    "requirement_qty": (
                        0 if quantity is None else quantity
                    ),
                }
            )

    if not week_columns:
        warnings.append(
            'Hlavička ("Material") nebyla nalezena – '
            "ověřte formát exportu."
        )

    return rows, warnings


def hladiny_parse_hladiny(html):
    warnings = []
    rows = []
    header_found = False
    header_count = 0

    for row_match in HLADINY_ROW_RE.finditer(html):
        cells = hladiny_row_cells(row_match.group(1))

        if not cells:
            continue

        if cells[0].strip().lower() in HLADINY_HEADER_FIRST:
            header_found = True
            header_count += 1
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
            'Hlavička ("Plant" ani "Plnt") nebyla nalezena – '
            "ověřte formát exportu."
        )

    if header_count > 1:
        warnings.append(
            f"Stránkovaný report: {header_count} opakovaných "
            "hlaviček (přeskočeno)."
        )

    return rows, warnings


def hladiny_parse_nove(html):
    warnings = []
    rows = []
    header_found = False

    for row_match in HLADINY_ROW_RE.finditer(html):
        cells = hladiny_row_cells(row_match.group(1))

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
                "plant": (
                    cells[0]
                    if cells[0] not in ("*", "")
                    else None
                ),
                "storage_type": cells[1] or None,
                "total_stock": parse_qty(cells[3]),
                "base_unit": cells[4] or None,
            }
        )

    if not header_found:
        warnings.append(
            'Hlavička ("Plnt") nebyla nalezena – '
            "ověřte formát exportu."
        )

    return rows, warnings


HLADINY_COLUMNS = {
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


def hladiny_load_rows_to_sql(engine, table_name, rows, log):
    target = f"{HLADINY_TARGET_SCHEMA}.{table_name}"

    dataframe = pd.DataFrame(
        rows,
        columns=HLADINY_COLUMNS[table_name],
    )

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
            schema=HLADINY_TARGET_SCHEMA,
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

        log(
            f"SQL_VERIFY | table={target} | "
            f"count_after={count}"
        )


def hladiny_process_file(
    engine,
    path,
    table_name,
    parser,
    log,
    log_error,
    done_dir,
    retention,
    pattern,
):
    with open(path, "r", encoding="utf-8") as file:
        html = file.read()

    rows, warnings = parser(html)

    for warning in warnings:
        log(f"[UPOZORNĚNÍ] {warning}")

    if not rows:
        raise ValueError(
            "V souboru nebyl nalezen žádný použitelný řádek s daty."
        )

    hladiny_load_rows_to_sql(
        engine,
        table_name,
        rows,
        log,
    )

    move_to_done(
        path,
        done_dir,
        pattern,
        retention,
        log,
        log_error,
    )

    return len(rows), f"{HLADINY_TARGET_SCHEMA}.{table_name}"


# =============================================================================
# REQUIREMENTS
# =============================================================================

REQUIREMENTS_REQ_W_PATTERN = re.compile(
    r"ASCM_FST_REQ_W",
    re.IGNORECASE,
)


# =============================================================================
# RECEIPTS
# =============================================================================

RECEIPTS_TARGET_SCHEMA = "pckForecast"

RECEIPTS_REC_W_PATTERN = re.compile(
    r"ASCM_FST_REC_W",
    re.IGNORECASE,
)

RECEIPTS_REC_M_PATTERN = re.compile(
    r"ASCM_FST_REC_M",
    re.IGNORECASE,
)

RECEIPTS_PERIOD_PATTERNS = [
    (
        "day",
        re.compile(r"^D\s*(\d+)(?:/(\d+))?$", re.IGNORECASE),
    ),
    (
        "week",
        re.compile(r"^W\s*(\d+)(?:/(\d+))?$", re.IGNORECASE),
    ),
    (
        "month",
        re.compile(r"^M\s*(\d+)(?:/(\d+))?$", re.IGNORECASE),
    ),
]

RECEIPTS_PERIOD_LABEL_PREFIX = {
    "week": "cw",
    "month": "cm",
}

RECEIPTS_ROW_RE = re.compile(
    r"<tr>([\s\S]*?)</tr>"
)

RECEIPTS_NOBR_RE = re.compile(
    r"<nobr[^>]*>([\s\S]*?)</nobr>"
)


def receipts_classify_period_header(header):
    for period_type, pattern in RECEIPTS_PERIOD_PATTERNS:
        match = pattern.match(header)

        if not match:
            continue

        number, year = match.group(1), match.group(2)
        prefix = RECEIPTS_PERIOD_LABEL_PREFIX.get(period_type)

        if prefix:
            label = (
                f"{prefix} {number}/{year}"
                if year
                else f"{prefix} {number}"
            )
        else:
            label = number

        return period_type, label

    return None


def receipts_parse_forecast_html(html):
    warnings = []
    period_columns = None
    rows = []

    for row_match in RECEIPTS_ROW_RE.finditer(html):
        cells = [
            cell_text_plain(cell)
            for cell in RECEIPTS_NOBR_RE.findall(
                row_match.group(1)
            )
        ]

        if not cells:
            continue

        if cells[0] == "Material":
            period_columns = []

            for index, header in enumerate(cells):
                if index in (0, 1):
                    period_columns.append(None)
                    continue

                classified = receipts_classify_period_header(
                    header
                )

                if not classified:
                    warnings.append(
                        f'Neznámý sloupec v hlavičce, '
                        f'ignoruji: "{header}"'
                    )

                period_columns.append(classified)

            continue

        if period_columns is None:
            warnings.append(
                "Datový řádek před hlavičkou tabulky "
                "byl přeskočen."
            )
            continue

        local_material = cells[0]

        if not local_material:
            continue

        for index in range(2, len(cells)):
            period = (
                period_columns[index]
                if index < len(period_columns)
                else None
            )

            if period is None:
                continue

            quantity = parse_qty(cells[index])

            if quantity is None:
                continue

            period_type, period_label = period

            rows.append(
                {
                    "local_material": local_material,
                    "period_type": period_type,
                    "period_label": period_label,
                    "requirement_qty": quantity,
                }
            )

    return rows, warnings


def receipts_compute_mod_pn(local_material):
    if local_material is None:
        return None

    value = str(local_material)

    if value.startswith("00"):
        return value.lstrip("0") or "0"

    if value.startswith("A2C") and len(value) == 11:
        return value[:-1]

    if value.startswith("AAA") and len(value) == 13:
        return value[:-3]

    return value


def receipts_load_rows_to_sql(engine, table_name, rows, log):
    target_table = f"{RECEIPTS_TARGET_SCHEMA}.{table_name}"

    dataframe = pd.DataFrame(
        rows,
        columns=[
            "local_material",
            "period_type",
            "period_label",
            "requirement_qty",
        ],
    )

    dataframe["local_material"] = (
        dataframe["local_material"].astype(str).str.strip()
    )

    dataframe["period_type"] = (
        dataframe["period_type"].astype(str).str.strip()
    )

    dataframe["period_label"] = (
        dataframe["period_label"].astype(str).str.strip()
    )

    dataframe["requirement_qty"] = (
        pd.to_numeric(
            dataframe["requirement_qty"],
            errors="coerce",
        )
        .fillna(0)
    )

    dataframe["mod_pn"] = dataframe["local_material"].map(
        receipts_compute_mod_pn
    )

    dataframe["loaded_at"] = datetime.now()

    with engine.begin() as connection:
        deleted = connection.execute(
            text(f"DELETE FROM {target_table}")
        ).rowcount

        log(
            f"SQL_DELETE | table={target_table} | "
            f"deleted_rowcount={deleted}"
        )

        dataframe.to_sql(
            table_name,
            con=connection,
            schema=RECEIPTS_TARGET_SCHEMA,
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


def receipts_process_file(
    engine,
    path,
    table_name,
    log,
    log_error,
    done_dir,
    retention,
    pattern,
):
    with open(path, "r", encoding="utf-8") as file:
        html = file.read()

    rows, warnings = receipts_parse_forecast_html(html)

    for warning in warnings:
        log(f"[UPOZORNĚNÍ] {warning}")

    if not rows:
        raise ValueError(
            "V souboru nebyl nalezen žádný použitelný řádek s daty."
        )

    receipts_load_rows_to_sql(
        engine,
        table_name,
        rows,
        log,
    )

    move_to_done(
        path,
        done_dir,
        pattern,
        retention,
        log,
        log_error,
    )

    return len(rows), f"{RECEIPTS_TARGET_SCHEMA}.{table_name}"


# =============================================================================
# Registr jobů
# =============================================================================

def build_jobs(engine):
    jobs = []

    # -------------------------------------------------------------------------
    # PNZ
    # -------------------------------------------------------------------------

    watch_dir = resolve_watch_dir("PNZ_WATCH_DIR")

    log, log_error = make_logger(
        os.path.join(watch_dir, "pnz_watch.log"),
        os.path.join(SCRIPT_DIR, "pnz_watch.error.log"),
    )

    jobs.append(
        {
            "id": "pnz",
            "watch_dir": watch_dir,
            "done_dir": os.path.join(watch_dir, "Done"),
            "retention": 10,
            "pattern": PNZ_FILENAME_PATTERN,
            "is_candidate": pnz_is_candidate,
            "process_file": (
                lambda path,
                log=log,
                log_error=log_error,
                watch_dir=watch_dir: pnz_process_file(
                    engine,
                    path,
                    log,
                    log_error,
                    os.path.join(watch_dir, "Done"),
                    10,
                )
            ),
            "log": log,
            "log_error": log_error,
            "describe": (
                "Hledám soubory odpovídající: "
                "*pnzListSAP*.htm(l)"
            ),
        }
    )

    # -------------------------------------------------------------------------
    # HLADINY
    # -------------------------------------------------------------------------

    hladiny_specs = [
        (
            "hladiny_nw_hld",
            "ASCM_FST_NW_HLD_WATCH_DIR",
            "HLADINY_WATCH_DIR",
            HLADINY_NW_HLD_PATTERN,
            "nove_hladiny",
            hladiny_parse_nove,
            "hladiny_nw_hld_watch",
            (
                "Hledám soubory odpovídající: "
                "*ASCM_FST_NW_HLD*.htm(l)"
            ),
        ),
        (
            "hladiny_akt_hld",
            "ASCM_FST_AKT_HLD_WATCH_DIR",
            "HLADINY_WATCH_DIR",
            HLADINY_AKT_HLD_PATTERN,
            "aktualni_hladiny",
            hladiny_parse_hladiny,
            "hladiny_akt_hld_watch",
            (
                "Hledám soubory odpovídající: "
                "*ASCM_FST_AKT_HLD*.htm(l)"
            ),
        ),
    ]

    for (
        job_id,
        env_var,
        fallback_env_var,
        pattern,
        table_name,
        parser,
        log_base,
        describe,
    ) in hladiny_specs:
        watch_dir = resolve_watch_dir(
            env_var,
            fallback_env_var,
        )

        log, log_error = make_logger(
            os.path.join(watch_dir, f"{log_base}.log"),
            os.path.join(SCRIPT_DIR, f"{log_base}.error.log"),
        )

        done_dir = os.path.join(watch_dir, "Done")

        def make_is_candidate(pattern=pattern):
            return lambda filename: (
                bool(EXT_PATTERN.search(filename))
                and bool(pattern.search(filename))
            )

        jobs.append(
            {
                "id": job_id,
                "watch_dir": watch_dir,
                "done_dir": done_dir,
                "retention": 3,
                "pattern": pattern,
                "is_candidate": make_is_candidate(),
                "process_file": (
                    lambda path,
                    table_name=table_name,
                    parser=parser,
                    log=log,
                    log_error=log_error,
                    done_dir=done_dir,
                    pattern=pattern: hladiny_process_file(
                        engine,
                        path,
                        table_name,
                        parser,
                        log,
                        log_error,
                        done_dir,
                        3,
                        pattern,
                    )
                ),
                "log": log,
                "log_error": log_error,
                "describe": describe,
            }
        )

    # -------------------------------------------------------------------------
    # REQUIREMENTS
    # -------------------------------------------------------------------------

    requirements_watch_dir = resolve_watch_dir(
        "ASCM_FST_REQ_W_WATCH_DIR"
    )

    requirements_log, requirements_log_error = make_logger(
        os.path.join(
            requirements_watch_dir,
            "requirements_watch.log",
        ),
        os.path.join(
            SCRIPT_DIR,
            "requirements_watch.error.log",
        ),
    )

    requirements_done_dir = os.path.join(
        requirements_watch_dir,
        "Done",
    )

    jobs.append(
        {
            "id": "requirements",
            "watch_dir": requirements_watch_dir,
            "done_dir": requirements_done_dir,
            "retention": 3,
            "pattern": REQUIREMENTS_REQ_W_PATTERN,
            "is_candidate": lambda filename: (
                bool(EXT_PATTERN.search(filename))
                and bool(
                    REQUIREMENTS_REQ_W_PATTERN.search(filename)
                )
            ),
            "process_file": (
                lambda path,
                log=requirements_log,
                log_error=requirements_log_error,
                done_dir=requirements_done_dir: hladiny_process_file(
                    engine,
                    path,
                    "potreby",
                    hladiny_parse_potreby,
                    log,
                    log_error,
                    done_dir,
                    3,
                    REQUIREMENTS_REQ_W_PATTERN,
                )
            ),
            "log": requirements_log,
            "log_error": requirements_log_error,
            "describe": (
                "Hledám soubory odpovídající: "
                "*ASCM_FST_REQ_W*.htm(l)"
            ),
        }
    )

    # -------------------------------------------------------------------------
    # RECEIPTS
    # -------------------------------------------------------------------------

    receipts_specs = [
        (
            "receipts_rec_w",
            "ASCM_FST_REC_W_WATCH_DIR",
            "RECEIPTS_WATCH_DIR",
            RECEIPTS_REC_W_PATTERN,
            "FST_DCO_week",
            "receipts_rec_w_watch",
            (
                "Hledám soubory odpovídající: "
                "*ASCM_FST_REC_W*.htm(l)"
            ),
        ),
        (
            "receipts_rec_m",
            "ASCM_FST_REC_M_WATCH_DIR",
            "RECEIPTS_WATCH_DIR",
            RECEIPTS_REC_M_PATTERN,
            "FST_PCK_DCO_month",
            "receipts_rec_m_watch",
            (
                "Hledám soubory odpovídající: "
                "*ASCM_FST_REC_M*.htm(l)"
            ),
        ),
    ]

    for (
        job_id,
        env_var,
        fallback_env_var,
        pattern,
        table_name,
        log_base,
        describe,
    ) in receipts_specs:
        watch_dir = resolve_watch_dir(
            env_var,
            fallback_env_var,
        )

        log, log_error = make_logger(
            os.path.join(watch_dir, f"{log_base}.log"),
            os.path.join(SCRIPT_DIR, f"{log_base}.error.log"),
        )

        done_dir = os.path.join(watch_dir, "Done")

        def make_is_candidate(pattern=pattern):
            return lambda filename: (
                bool(EXT_PATTERN.search(filename))
                and bool(pattern.search(filename))
            )

        jobs.append(
            {
                "id": job_id,
                "watch_dir": watch_dir,
                "done_dir": done_dir,
                "retention": 2,
                "pattern": pattern,
                "is_candidate": make_is_candidate(),
                "process_file": (
                    lambda path,
                    table_name=table_name,
                    log=log,
                    log_error=log_error,
                    done_dir=done_dir,
                    pattern=pattern: receipts_process_file(
                        engine,
                        path,
                        table_name,
                        log,
                        log_error,
                        done_dir,
                        2,
                        pattern,
                    )
                ),
                "log": log,
                "log_error": log_error,
                "describe": describe,
            }
        )

    return jobs


# =============================================================================
# Smyčka hlídání
# =============================================================================

def watch(engine):
    jobs = build_jobs(engine)

    for job in jobs:
        job["log"](
            f"Sleduji složku: {job['watch_dir']}"
        )
        job["log"](job["describe"])

    last_processed = {
        job["id"]: {}
        for job in jobs
    }

    in_progress = {
        job["id"]: set()
        for job in jobs
    }

    def scan_job(job):
        try:
            entries = os.listdir(job["watch_dir"])

        except OSError:
            return

        for filename in entries:
            if not job["is_candidate"](filename):
                continue

            full_path = os.path.join(
                job["watch_dir"],
                filename,
            )

            if os.path.isfile(full_path):
                handle_file(
                    full_path,
                    job["is_candidate"],
                    job["process_file"],
                    last_processed[job["id"]],
                    in_progress[job["id"]],
                    job["log"],
                    job["log_error"],
                )

    def scan_all():
        for job in jobs:
            scan_job(job)

    scan_all()

    while True:
        time.sleep(POLL_INTERVAL_S)
        scan_all()


# =============================================================================
# Vstupní bod
# =============================================================================

def main():
    input_arg = sys.argv[1] if len(sys.argv) > 1 else None

    if input_arg:
        input_path = os.path.abspath(input_arg)
        filename = os.path.basename(input_path)

        engine = get_engine()
        jobs = build_jobs(engine)

        for job in jobs:
            if job["is_candidate"](filename):
                count, target = job["process_file"](input_path)

                print(
                    f"Hotovo: {count} řádků zapsáno do {target}"
                )
                return

        print(
            f'Soubor "{filename}" neodpovídá žádnému známému '
            "vzoru "
            "(pnzListSAP / ASCM_FST_AKT_HLD / "
            "ASCM_FST_NW_HLD / ASCM_FST_REQ_W / "
            "ASCM_FST_REC_W / ASCM_FST_REC_M)."
        )

        sys.exit(1)

    engine = get_engine()
    watch(engine)


if __name__ == "__main__":
    main()