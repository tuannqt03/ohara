import random
import sqlite3
import time
from datetime import datetime
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DB_DIR = BASE_DIR / "database"

MACHINE_DB_PATH = DB_DIR / "machine.db"

PLC_SCAN_INTERVAL_SECONDS = 5
DB_SAVE_INTERVAL_SECONDS = 10

# None = tất cả máy đều có dữ liệu
# Ví dụ 3 = máy có id = 3 sẽ không được ghi dữ liệu mới để test No Data
SIMULATE_NO_DATA_MACHINE_ID = None


# =========================
# DB CONNECTION
# Chỉ dùng machine.db.
# File PLC giả lập không đọc settingmachine.db.
# =========================

def get_machine_db():
    conn = sqlite3.connect(MACHINE_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def get_table_columns(conn, table_name):
    rows = conn.execute(f"""
        PRAGMA table_info({table_name});
    """).fetchall()

    return {row["name"] for row in rows}


def get_active_machines():
    with get_machine_db() as conn:
        machines = conn.execute("""
            SELECT
                id,
                machine_code,
                machine_name
            FROM machines
            WHERE is_active = 1
            ORDER BY id ASC;
        """).fetchall()

    return machines


# =========================
# FAKE PLC DATA
# =========================

def generate_plc_payload(machine_id, tick):

    # Máy 16 -> 24 mất toàn bộ dữ liệu
    if 16 <= machine_id <= 24:
        return {
            "machineId": machine_id,
            "moldTemp": 0.0,
            "temp": 0.0,
            "hum": 0.0,
        }

    # Các máy còn lại:
    # Mold luôn bằng 0
    # Chỉ Temp + Humidity có dữ liệu

    env_temp = round(random.uniform(27.0, 29.0), 1)
    humidity = round(random.uniform(38.0, 42.0), 1)

    return {
        "machineId": machine_id,
        "moldTemp": 0.0,
        "temp": env_temp,
        "hum": humidity,
    }

def generate_outdoor_payload(tick):

    # Outdoor mất dữ liệu hoàn toàn

    return {
        "temp": 0.0,
        "hum": 0.0,
    }
def insert_sensor_reading(conn, payload, recorded_at):
    """
    Lưu dữ liệu PLC raw vào sensor_readings.
    DB hiện tại đã bỏ cột status, nên chỉ insert số đo và thời gian.
    """

    conn.execute("""
        INSERT INTO sensor_readings (
            machine_id,
            mold_temp,
            env_temp,
            humidity,
            recorded_at
        )
        VALUES (?, ?, ?, ?, ?);
    """, (
        payload["machineId"],
        payload["moldTemp"],
        payload["temp"],
        payload["hum"],
        recorded_at,
    ))


def insert_outdoor_weather(conn, payload, recorded_at):
    conn.execute("""
        INSERT INTO outdoor_weather_readings (
            outdoor_temp,
            outdoor_humidity,
            recorded_at
        )
        VALUES (?, ?, ?);
    """, (
        payload["temp"],
        payload["hum"],
        recorded_at,
    ))


def insert_one_round(tick):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    machines = get_active_machines()

    if not machines:
        print("[ERROR] Không có máy active trong machine.db.")
        return

    inserted = 0
    skipped = 0

    with get_machine_db() as conn:
        for machine in machines:
            machine_id = machine["id"]

            if SIMULATE_NO_DATA_MACHINE_ID == machine_id:
                skipped += 1
                print(
                    f"[{now}] SKIP machine {machine_id} - "
                    f"{machine['machine_name']} | simulate no data"
                )
                continue

            payload = generate_plc_payload(machine_id, tick)

            insert_sensor_reading(conn, payload, now)

            inserted += 1

            print(
                f"[{now}] INSERT machine {machine_id} - {machine['machine_name']} | "
                f"mold={payload['moldTemp']}°C | "
                f"env={payload['temp']}°C | "
                f"hum={payload['hum']}%"
            )

        outdoor_payload = generate_outdoor_payload(tick)

        insert_outdoor_weather(conn, outdoor_payload, now)

        conn.commit()

    print(
        f"[{now}] DB saved raw PLC data | "
        f"Inserted: {inserted} machines | "
        f"Skipped: {skipped} | "
        f"Outdoor: {outdoor_payload['temp']}°C / {outdoor_payload['hum']}%"
    )


# =========================
# DB CHECK
# =========================

def check_database_ready():
    if not MACHINE_DB_PATH.exists():
        print(f"[ERROR] Không tìm thấy machine.db: {MACHINE_DB_PATH}")
        return False

    try:
        with get_machine_db() as conn:
            machine_count = conn.execute("""
                SELECT COUNT(*) AS total
                FROM machines
                WHERE is_active = 1;
            """).fetchone()["total"]

            tables = conn.execute("""
                SELECT name
                FROM sqlite_master
                WHERE type = 'table';
            """).fetchall()

            table_names = {row["name"] for row in tables}

            required_tables = {
                "machines",
                "sensor_readings",
                "outdoor_weather_readings",
            }

            missing_tables = required_tables - table_names

            if machine_count <= 0:
                print("[ERROR] machine.db không có máy active.")
                return False

            if missing_tables:
                print(f"[ERROR] machine.db thiếu bảng: {sorted(missing_tables)}")
                return False

            sensor_columns = get_table_columns(conn, "sensor_readings")
            required_sensor_columns = {
                "machine_id",
                "mold_temp",
                "env_temp",
                "humidity",
                "recorded_at",
            }

            missing_sensor_columns = required_sensor_columns - sensor_columns

            if missing_sensor_columns:
                print(
                    "[ERROR] Bảng sensor_readings thiếu cột: "
                    f"{sorted(missing_sensor_columns)}"
                )
                return False

            outdoor_columns = get_table_columns(conn, "outdoor_weather_readings")
            required_outdoor_columns = {
                "outdoor_temp",
                "outdoor_humidity",
                "recorded_at",
            }

            missing_outdoor_columns = required_outdoor_columns - outdoor_columns

            if missing_outdoor_columns:
                print(
                    "[ERROR] Bảng outdoor_weather_readings thiếu cột: "
                    f"{sorted(missing_outdoor_columns)}"
                )
                return False

        return True

    except Exception as error:
        print("[ERROR] Kiểm tra database thất bại:", error)
        return False


# =========================
# MAIN LOOP
# =========================

def main():
    print("====================================")
    print(" Temperature & Humidity PLC Simulator")
    print("====================================")
    print(f"Machine DB: {MACHINE_DB_PATH}")
    print(f"PLC scan interval: {PLC_SCAN_INTERVAL_SECONDS} seconds")
    print(f"DB save interval: {DB_SAVE_INTERVAL_SECONDS} seconds")
    print(f"Simulate no data machine id: {SIMULATE_NO_DATA_MACHINE_ID}")
    print("Mode: raw PLC data only")
    print("Không đọc settingmachine.db")
    print("Không tính warning/alarm")
    print("Không ghi warning_alarm_logs")
    print("Nhấn Ctrl + C để dừng.")
    print("")

    if not check_database_ready():
        return

    tick = 0
    last_save_time = None

    try:
        while True:
            now_dt = datetime.now()

            should_save = (
                last_save_time is None
                or (now_dt - last_save_time).total_seconds()
                >= DB_SAVE_INTERVAL_SECONDS
            )

            if should_save:
                insert_one_round(tick)
                last_save_time = now_dt
            else:
                print(
                    f"[{now_dt.strftime('%Y-%m-%d %H:%M:%S')}] "
                    f"PLC scanned, not saved to DB"
                )

            tick += 1
            time.sleep(PLC_SCAN_INTERVAL_SECONDS)

    except KeyboardInterrupt:
        print("\nĐã dừng simulator.")


if __name__ == "__main__":
    main()