import os
import sys
import tempfile
from datetime import datetime
import getpass
import traceback
import urllib

import pandas as pd
from sqlalchemy import create_engine, text

# =========================
# CONFIG
# =========================
LOG = r"D:\ASCM_apps\Packaging\pck_forecast\sql_upload.log"
MAX_LOG_LINES = 14
FALLBACK_LOG = os.path.join(tempfile.gettempdir(), "sql_upload.log")

EXCEL_PATH = r"\\vt1.vitesco.com\fst1\did80051\01_Public\02_PS_SCM_packaging\APR.xlsx"
SHEET_NAME = "Query1"

SERVER = r"FSDB0005\I0176"
DATABASE = "FSTASCM"
DRIVER = "ODBC Driver 18 for SQL Server"

# target table
TARGET_SCHEMA = "pckForecast"
TARGET_NAME = "APR"
TARGET_TABLE = f"{TARGET_SCHEMA}.{TARGET_NAME}"

CHUNKSIZE = 5000

# =========================
# LOGGING
# =========================
def _trim_log_file(path: str, max_lines: int = MAX_LOG_LINES) -> None:
    """Keep only last `max_lines` lines in the log file."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        if len(lines) > max_lines:
            with open(path, "w", encoding="utf-8") as f:
                f.writelines(lines[-max_lines:])
    except FileNotFoundError:
        pass

def log(msg: str) -> None:
    """
    Append a log line. If primary log path is not writable (PermissionError),
    write to fallback log in %TEMP%.
    """
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} | {msg}\n"

    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line)
        _trim_log_file(LOG)
    except PermissionError:
        with open(FALLBACK_LOG, "a", encoding="utf-8") as f:
            f.write(line)
        _trim_log_file(FALLBACK_LOG)

def debug_print(msg: str) -> None:
    print(msg, flush=True)
    log(msg)

# =========================
# START
# =========================
debug_print(
    f"START | user={getpass.getuser()} | excel={EXCEL_PATH} | sheet={SHEET_NAME} | "
    f"server={SERVER} | db={DATABASE} | target={TARGET_TABLE}"
)

try:
    if not os.path.exists(EXCEL_PATH):
        raise FileNotFoundError(f"Excel soubor neexistuje nebo není dostupný: {EXCEL_PATH}")

    # =========================
    # CONNECT
    # =========================
    conn_str = (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={SERVER};"
        f"DATABASE={DATABASE};"
        "Trusted_Connection=yes;"
        "TrustServerCertificate=yes;"
    )

    params = urllib.parse.quote_plus(conn_str)
    engine = create_engine(
        f"mssql+pyodbc:///?odbc_connect={params}",
        fast_executemany=True,
        # Fail fast pokud SQL server neodpovídá, místo dlouhého čekání na timeout
        connect_args={"timeout": 10},
        pool_pre_ping=True,
    )

    with engine.connect() as conn:
        login = conn.execute(text("SELECT SUSER_SNAME()")).scalar()
        dbname = conn.execute(text("SELECT DB_NAME()")).scalar()
        servername = conn.execute(text("SELECT @@SERVERNAME")).scalar()
        debug_print(f"CONNECTED | login={login} | db={dbname} | @@servername={servername}")

    # =========================
    # READ EXCEL
    # =========================
    required_columns = ["local_material", "period_type", "period_label", "requirement_qty"]
    try:
        # usecols omezí čtení jen na potřebné sloupce - méně dat k parsování,
        # pokud by Query1 obsahovalo navíc i pomocné/nepoužité sloupce.
        df = pd.read_excel(EXCEL_PATH, sheet_name=SHEET_NAME, usecols=required_columns)
    except Exception as e:
        debug_print(f"ERROR reading Excel: {repr(e)}")
        raise

    debug_print(f"EXCEL_READ | rows={len(df)} | cols={list(df.columns)}")

    # =========================
    # CHECK REQUIRED COLUMNS
    # =========================
    missing = [c for c in required_columns if c not in df.columns]
    if missing:
        raise KeyError(f"Chybí povinné sloupce v Excelu: {missing}")

    # =========================
    # CLEAN / TYPES
    # =========================
    df["local_material"] = df["local_material"].astype(str).str.strip()
    df["period_type"] = df["period_type"].astype(str).str.strip()
    df["period_label"] = df["period_label"].astype(str).str.strip()
    df["requirement_qty"] = pd.to_numeric(df["requirement_qty"], errors="coerce").fillna(0).astype("int64")

    debug_print("CLEANING_DONE")

    # =========================
    # FULL REFRESH (DELETE + INSERT v JEDNÉ TRANSAKCI)
    #
    # Delete i insert běží na jednom sdíleném připojení a v jedné transakci -
    # tabulka tak nikdy není viditelná prázdná pro ostatní čtenáře (web view)
    # a při chybě se změna celá vrátí zpět (rollback), místo aby zůstala
    # napůl smazaná tabulka.
    # =========================
    with engine.begin() as conn:
        deleted = conn.execute(text(f"DELETE FROM {TARGET_TABLE}")).rowcount
        debug_print(f"SQL_DELETE | table={TARGET_TABLE} | deleted_rowcount={deleted}")

        try:
            df.to_sql(
                TARGET_NAME,
                con=conn,
                schema=TARGET_SCHEMA,
                if_exists="append",
                index=False,
                chunksize=CHUNKSIZE,
                method=None
            )
        except Exception as e:
            debug_print(f"ERROR during to_sql: {repr(e)}")
            raise

        debug_print(f"SQL_INSERT | table={TARGET_TABLE} | inserted_rows={len(df)}")

        cnt = conn.execute(text(f"SELECT COUNT(*) FROM {TARGET_TABLE}")).scalar()
        debug_print(f"SQL_VERIFY | table={TARGET_TABLE} | count_after={cnt}")

    debug_print("SUCCESS")

except Exception:
    debug_print("ERROR")
    debug_print(traceback.format_exc())
    sys.exit(1)

sys.exit(0)
