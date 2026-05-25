import math
import random
import sqlite3
import time
from datetime import datetime
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DB_DIR = BASE_DIR / "database"

MACHINE_DB_PATH = DB_DIR / "machine.db"
SETTING_MACHINE_DB_PATH = DB_DIR / "settingmachine.db"

PLC_SCAN_INTERVAL_SECONDS = 5
DB_SAVE_INTERVAL_SECONDS = 10
ALARM_LOG_COOLDOWN_SECONDS = 15 * 60


# =========================
# DB CONNECTIONS
# =========================

def get_machine_db():
    conn = sqlite3.connect(MACHINE_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def get_setting_machine_db():
    conn = sqlite3.connect(SETTING_MACHINE_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# =========================
# HELPERS
# =========================

def get_active_threshold(conn):
    return conn.execute("""
        SELECT *
        FROM threshold_settings
        WHERE is_active = 1
        ORDER BY id DESC
        LIMIT 1;
    """).fetchone()


def calc_status(mold_temp, env_temp, humidity, threshold):
    if (
        mold_temp >= threshold["alarm_mold_temp"]
        or env_temp >= threshold["alarm_env_temp"]
        or humidity >= threshold["alarm_humidity"]
    ):
        return "alarm"

    if (
        mold_temp >= threshold["warning_mold_temp"]
        or env_temp >= threshold["warning_env_temp"]
        or humidity >= threshold["warning_humidity"]
    ):
        return "warning"

    return "normal"


def status_level(status):
    if status == "alarm":
        return 2
    if status == "warning":
        return 1
    return 0


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


def get_active_unconfirmed_log(conn, machine_id):
    return conn.execute("""
        SELECT *
        FROM warning_alarm_logs
        WHERE machine_id = ?
          AND is_deleted = 0
          AND COALESCE(is_confirmed, 0) = 0
        ORDER BY
            CASE status
                WHEN 'alarm' THEN 2
                WHEN 'warning' THEN 1
                ELSE 0
            END DESC,
            occurred_at DESC,
            id DESC
        LIMIT 1;
    """, (machine_id,)).fetchone()


def should_create_log(active_log, new_status, now_dt):
    if new_status not in ["warning", "alarm"]:
        return False

    if not active_log:
        return True

    old_status = active_log["status"]

    if status_level(new_status) > status_level(old_status):
        return True

    occurred_at = active_log["occurred_at"]

    if occurred_at:
        try:
            occurred_dt = datetime.strptime(occurred_at, "%Y-%m-%d %H:%M:%S")
            elapsed_seconds = (now_dt - occurred_dt).total_seconds()

            if elapsed_seconds >= ALARM_LOG_COOLDOWN_SECONDS:
                return True
        except ValueError:
            return False

    return False


# =========================
# FAKE PLC DATA
# =========================

def generate_plc_payload(machine_id, tick):
    """
    Giả lập payload PLC gửi lên.
    PLC chỉ gửi số liệu, không gửi trạng thái.

    Dữ liệu demo kiểu khu công nghiệp:
    - Đa số máy chạy ổn định.
    - Nhiệt độ khuôn dao động nhẹ quanh 68-75°C.
    - Nhiệt độ môi trường dao động quanh 27-30°C.
    - Độ ẩm dao động quanh 52-58%.
    - Warning rất ít, chỉ 1 máy tại một thời điểm.
    - Alarm cực hiếm.
    """

    # Dữ liệu nền ổn định theo từng máy
    base_mold_temp = 69.0 + machine_id * 0.05
    mold_wave = math.sin(tick / 18 + machine_id * 0.13) * 0.9
    mold_noise = random.uniform(-0.25, 0.25)
    mold_temp = round(base_mold_temp + mold_wave + mold_noise, 1)

    base_env_temp = 27.2 + machine_id * 0.015
    env_wave = math.sin(tick / 22 + machine_id * 0.09) * 0.45
    env_noise = random.uniform(-0.15, 0.18)
    env_temp = round(base_env_temp + env_wave + env_noise, 1)

    base_humidity = 54.0 + machine_id * 0.025
    hum_wave = math.cos(tick / 20 + machine_id * 0.11) * 1.1
    hum_noise = random.uniform(-0.35, 0.35)
    humidity = round(base_humidity + hum_wave + hum_noise, 1)

    # Warning hiếm hơn:
    # tick tăng mỗi 5s, nhưng DB chỉ save mỗi 10s.
    # tick % 72 nghĩa là khoảng 6 phút mới có 1 lần warning cho 1 máy.
    warning_machine_id = (tick // 72) % 24 + 1

    if tick > 0 and tick % 72 == 0 and machine_id == warning_machine_id:
        fault_type = random.choice(["mold", "env", "hum"])

        if fault_type == "mold":
            mold_temp = round(random.uniform(80.1, 81.2), 1)
        elif fault_type == "env":
            env_temp = round(random.uniform(32.1, 32.7), 1)
        else:
            humidity = round(random.uniform(62.1, 63.2), 1)

    # Alarm cực hiếm:
    # tick % 360 nghĩa là khoảng 30 phút mới có 1 alarm cho 1 máy.
    alarm_machine_id = (tick // 360) % 24 + 1

    if tick > 0 and tick % 360 == 0 and machine_id == alarm_machine_id:
        fault_type = random.choice(["mold", "env", "hum"])

        if fault_type == "mold":
            mold_temp = round(random.uniform(90.1, 91.0), 1)
        elif fault_type == "env":
            env_temp = round(random.uniform(35.1, 36.0), 1)
        else:
            humidity = round(random.uniform(68.1, 69.0), 1)

    return {
        "machineId": machine_id,
        "moldTemp": mold_temp,
        "temp": env_temp,
        "hum": humidity,
    }
def generate_outdoor_payload(tick):
    """
    Dữ liệu ngoài trời riêng, không liên quan máy.
    """

    outdoor_temp = round(
        29.0 + math.sin(tick / 16) * 2.0 + random.uniform(-0.3, 0.4),
        1
    )

    outdoor_humidity = round(
        59.0 + math.cos(tick / 14) * 4.0 + random.uniform(-0.8, 0.9),
        1
    )

    return {
        "temp": outdoor_temp,
        "hum": outdoor_humidity,
    }


# =========================
# INSERT ROUND
# sensor_readings + outdoor_weather_readings: machine.db
# threshold_settings + warning_alarm_logs: settingmachine.db
# =========================

def insert_one_round(tick):
    now_dt = datetime.now()
    now = now_dt.strftime("%Y-%m-%d %H:%M:%S")

    machines = get_active_machines()

    if not machines:
        print("[ERROR] Không có máy active trong machine.db.")
        return

    with get_setting_machine_db() as setting_conn:
        threshold = get_active_threshold(setting_conn)

    if not threshold:
        print("[ERROR] Chưa có threshold_settings active trong settingmachine.db.")
        return

    inserted = 0
    normal_count = 0
    warning_count = 0
    alarm_count = 0

    with get_machine_db() as machine_conn, get_setting_machine_db() as setting_conn:
        for machine in machines:
            payload = generate_plc_payload(machine["id"], tick)

            machine_id = payload["machineId"]
            mold_temp = payload["moldTemp"]
            env_temp = payload["temp"]
            humidity = payload["hum"]

            status = calc_status(mold_temp, env_temp, humidity, threshold)

            machine_conn.execute("""
                INSERT INTO sensor_readings (
                    machine_id,
                    mold_temp,
                    env_temp,
                    humidity,
                    status,
                    recorded_at
                )
                VALUES (?, ?, ?, ?, ?, ?);
            """, (
                machine_id,
                mold_temp,
                env_temp,
                humidity,
                status,
                now,
            ))

            if status in ["warning", "alarm"]:
                active_log = get_active_unconfirmed_log(setting_conn, machine_id)

                if should_create_log(active_log, status, now_dt):
                    message = (
                        f"{machine['machine_name']} {status}: "
                        f"mold_temp={mold_temp}°C, "
                        f"env_temp={env_temp}°C, "
                        f"humidity={humidity}%"
                    )

                    setting_conn.execute("""
                        INSERT INTO warning_alarm_logs (
                            machine_id,
                            mold_temp,
                            env_temp,
                            humidity,
                            status,
                            message,
                            occurred_at,
                            is_confirmed
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, 0);
                    """, (
                        machine_id,
                        mold_temp,
                        env_temp,
                        humidity,
                        status,
                        message,
                        now,
                    ))
            if status == "normal":
                normal_count += 1
            elif status == "warning":
                warning_count += 1
            elif status == "alarm":
                alarm_count += 1

            inserted += 1

        outdoor_payload = generate_outdoor_payload(tick)

        machine_conn.execute("""
            INSERT INTO outdoor_weather_readings (
                outdoor_temp,
                outdoor_humidity,
                recorded_at
            )
            VALUES (?, ?, ?);
        """, (
            outdoor_payload["temp"],
            outdoor_payload["hum"],
            now,
        ))

        machine_conn.commit()
        setting_conn.commit()

    print(
        f"[{now}] DB saved: {inserted} machines | "
        f"Normal: {normal_count} | "
        f"Warning: {warning_count} | "
        f"Alarm: {alarm_count} | "
        f"Outdoor: {outdoor_payload['temp']}°C / {outdoor_payload['hum']}%"
    )


# =========================
# DB CHECK / MIGRATION
# =========================

def ensure_confirm_columns():
    with get_setting_machine_db() as conn:
        columns = conn.execute("""
            PRAGMA table_info(warning_alarm_logs);
        """).fetchall()

        column_names = {column["name"] for column in columns}

        if "is_confirmed" not in column_names:
            conn.execute("""
                ALTER TABLE warning_alarm_logs
                ADD COLUMN is_confirmed INTEGER NOT NULL DEFAULT 0;
            """)

        if "confirmed_at" not in column_names:
            conn.execute("""
                ALTER TABLE warning_alarm_logs
                ADD COLUMN confirmed_at DATETIME;
            """)

        if "confirmed_by" not in column_names:
            conn.execute("""
                ALTER TABLE warning_alarm_logs
                ADD COLUMN confirmed_by TEXT;
            """)

        conn.commit()


def check_database_ready():
    if not MACHINE_DB_PATH.exists():
        print(f"[ERROR] Không tìm thấy machine.db: {MACHINE_DB_PATH}")
        return False

    if not SETTING_MACHINE_DB_PATH.exists():
        print(f"[ERROR] Không tìm thấy settingmachine.db: {SETTING_MACHINE_DB_PATH}")
        return False

    try:
        with get_machine_db() as conn:
            machine_count = conn.execute("""
                SELECT COUNT(*) AS total
                FROM machines
                WHERE is_active = 1;
            """).fetchone()["total"]

            machine_tables = conn.execute("""
                SELECT name
                FROM sqlite_master
                WHERE type = 'table';
            """).fetchall()

            machine_table_names = {row["name"] for row in machine_tables}

        with get_setting_machine_db() as conn:
            threshold = get_active_threshold(conn)

            setting_tables = conn.execute("""
                SELECT name
                FROM sqlite_master
                WHERE type = 'table';
            """).fetchall()

            setting_table_names = {row["name"] for row in setting_tables}

        required_machine_tables = {
            "machines",
            "sensor_readings",
            "outdoor_weather_readings",
        }

        required_setting_tables = {
            "threshold_settings",
            "chart_time_settings",
            "warning_alarm_logs",
        }

        missing_machine_tables = required_machine_tables - machine_table_names
        missing_setting_tables = required_setting_tables - setting_table_names

        if machine_count <= 0:
            print("[ERROR] machine.db không có máy active.")
            return False

        if not threshold:
            print("[ERROR] settingmachine.db chưa có threshold_settings active.")
            return False

        if missing_machine_tables:
            print(f"[ERROR] machine.db thiếu bảng: {sorted(missing_machine_tables)}")
            return False

        if missing_setting_tables:
            print(f"[ERROR] settingmachine.db thiếu bảng: {sorted(missing_setting_tables)}")
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
    print(f"Setting DB: {SETTING_MACHINE_DB_PATH}")
    print(f"PLC scan interval: {PLC_SCAN_INTERVAL_SECONDS} seconds")
    print(f"DB save interval: {DB_SAVE_INTERVAL_SECONDS} seconds")
    print(f"Alarm log cooldown: {ALARM_LOG_COOLDOWN_SECONDS} seconds")
    print("Nhấn Ctrl + C để dừng.")
    print("")

    if not check_database_ready():
        return

    ensure_confirm_columns()

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