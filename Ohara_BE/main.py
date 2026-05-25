import sqlite3
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DB_DIR = BASE_DIR / "database"

MACHINE_DB_PATH = DB_DIR / "machine.db"
SETTING_MACHINE_DB_PATH = DB_DIR / "settingmachine.db"


MACHINE_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS machines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    machine_code TEXT UNIQUE,
    machine_name TEXT NOT NULL,

    line_name TEXT,
    area_name TEXT,

    is_active INTEGER NOT NULL DEFAULT 1,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sensor_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    machine_id INTEGER NOT NULL,

    mold_temp REAL NOT NULL,
    env_temp REAL NOT NULL,
    humidity REAL NOT NULL,

    status TEXT NOT NULL DEFAULT 'normal'
        CHECK (status IN ('normal', 'warning', 'alarm')),

    recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (machine_id) REFERENCES machines(id)
);

CREATE TABLE IF NOT EXISTS outdoor_weather_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    outdoor_temp REAL NOT NULL,
    outdoor_humidity REAL NOT NULL,

    recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_machine_time
ON sensor_readings(machine_id, recorded_at);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_time
ON sensor_readings(recorded_at);

CREATE INDEX IF NOT EXISTS idx_outdoor_weather_recorded_at
ON outdoor_weather_readings(recorded_at);
"""


MACHINE_SEED_SQL = """
INSERT OR IGNORE INTO machines (id, machine_code, machine_name)
VALUES
(1, NULL, '26C (A72)'),
(2, NULL, '002J_K2 (A66)'),
(3, NULL, '001H_K1 (A69)'),
(4, NULL, '007A_K2 (A46)'),
(5, NULL, '007A_K1 (A24)'),
(6, NULL, '006H_K1 (A60)'),
(7, NULL, '008A_K2 (A77)'),
(8, NULL, '002J_K1 (A67)'),
(9, NULL, '006H_K3 (A55)'),
(10, NULL, '10C (A47)'),
(11, NULL, '001H_K2 (A70)'),
(12, NULL, '008A_K1 (A76)'),
(13, NULL, '005G (A74)+(A75)'),
(14, NULL, '006H_K2 (A71)'),
(15, NULL, '002J_K3 (A73)'),
(16, NULL, 'M16'),
(17, NULL, 'M17'),
(18, NULL, 'M18'),
(19, NULL, 'M19'),
(20, NULL, 'M20'),
(21, NULL, 'M21'),
(22, NULL, 'M22'),
(23, NULL, 'M23'),
(24, NULL, 'M24');
"""


SETTING_MACHINE_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS threshold_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    warning_mold_temp REAL NOT NULL DEFAULT 80,
    alarm_mold_temp REAL NOT NULL DEFAULT 90,

    warning_env_temp REAL NOT NULL DEFAULT 32,
    alarm_env_temp REAL NOT NULL DEFAULT 35,

    warning_humidity REAL NOT NULL DEFAULT 62,
    alarm_humidity REAL NOT NULL DEFAULT 68,

    is_active INTEGER NOT NULL DEFAULT 1,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chart_time_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    label TEXT NOT NULL,
    interval_seconds INTEGER NOT NULL UNIQUE,

    is_default INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS warning_alarm_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    machine_id INTEGER NOT NULL,

    mold_temp REAL NOT NULL,
    env_temp REAL NOT NULL,
    humidity REAL NOT NULL,

    status TEXT NOT NULL
        CHECK (status IN ('warning', 'alarm')),

    message TEXT,

    occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_warning_alarm_logs_status_time
ON warning_alarm_logs(status, occurred_at);

CREATE INDEX IF NOT EXISTS idx_warning_alarm_logs_machine_time
ON warning_alarm_logs(machine_id, occurred_at);
"""


SETTING_MACHINE_SEED_SQL = """
INSERT INTO threshold_settings (
    warning_mold_temp,
    alarm_mold_temp,
    warning_env_temp,
    alarm_env_temp,
    warning_humidity,
    alarm_humidity,
    is_active
)
SELECT 80, 90, 32, 35, 62, 68, 1
WHERE NOT EXISTS (
    SELECT 1 FROM threshold_settings WHERE is_active = 1
);

INSERT OR IGNORE INTO chart_time_settings
(label, interval_seconds, is_default, is_active)
VALUES
('10s', 10, 1, 1),
('30s', 30, 0, 1),
('60s', 60, 0, 1);
"""


def init_machine_db():
    with sqlite3.connect(MACHINE_DB_PATH) as conn:
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.executescript(MACHINE_SCHEMA_SQL)
        conn.executescript(MACHINE_SEED_SQL)
        conn.commit()

    print(f"Đã tạo machine DB: {MACHINE_DB_PATH}")


def init_setting_machine_db():
    with sqlite3.connect(SETTING_MACHINE_DB_PATH) as conn:
        conn.executescript(SETTING_MACHINE_SCHEMA_SQL)
        conn.executescript(SETTING_MACHINE_SEED_SQL)
        conn.commit()

    print(f"Đã tạo setting machine DB: {SETTING_MACHINE_DB_PATH}")


def check_machine_db():
    with sqlite3.connect(MACHINE_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row

        tables = conn.execute("""
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
            ORDER BY name;
        """).fetchall()

        print("\nCác bảng trong machine.db:")
        for table in tables:
            print("-", table["name"])

        machine_count = conn.execute("""
            SELECT COUNT(*) AS total
            FROM machines;
        """).fetchone()["total"]

        print(f"\nSố máy trong machine.db: {machine_count}")

        machines = conn.execute("""
            SELECT id, machine_code, machine_name
            FROM machines
            ORDER BY id;
        """).fetchall()

        for machine in machines:
            print(dict(machine))


def check_setting_machine_db():
    with sqlite3.connect(SETTING_MACHINE_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row

        tables = conn.execute("""
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
            ORDER BY name;
        """).fetchall()

        print("\nCác bảng trong settingmachine.db:")
        for table in tables:
            print("-", table["name"])

        threshold = conn.execute("""
            SELECT *
            FROM threshold_settings
            WHERE is_active = 1
            ORDER BY id DESC
            LIMIT 1;
        """).fetchone()

        print("\nThreshold active:")
        print(dict(threshold) if threshold else "Chưa có setting")

        chart_times = conn.execute("""
            SELECT label, interval_seconds, is_default, is_active
            FROM chart_time_settings
            ORDER BY interval_seconds;
        """).fetchall()

        print("\nChart time settings:")
        for item in chart_times:
            print(dict(item))


def init_db():
    DB_DIR.mkdir(exist_ok=True)

    init_machine_db()
    init_setting_machine_db()

    check_machine_db()
    check_setting_machine_db()


if __name__ == "__main__":
    init_db()