import sqlite3
from pathlib import Path

from flask import Blueprint, jsonify, request, current_app


settingmachine_bp = Blueprint("settingmachine", __name__)


# Default demo-safe thresholds:
# Mold:    base 70, warning 60-80, alarm 55-85
# Env:     base 35, warning 31-39, alarm 29-41
# Humidity: base 58, warning 55-61, alarm 53-63
DEFAULT_MACHINE_THRESHOLDS = {
    "mold_temp_base": 70,
    "mold_temp_warning_delta": 10,
    "mold_temp_alarm_delta": 15,

    "env_temp_base": 35,
    "env_temp_warning_delta": 4,
    "env_temp_alarm_delta": 6,

    "humidity_base": 58,
    "humidity_warning_delta": 3,
    "humidity_alarm_delta": 5,
}


def get_setting_machine_db():
    db_path = current_app.config.get(
        "SETTING_MACHINE_DB_PATH",
        Path(__file__).resolve().parent / "database" / "settingmachine.db"
    )

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_warning_log_columns():
    db_path = Path(__file__).resolve().parent / "database" / "settingmachine.db"

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS warning_alarm_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                machine_id INTEGER NOT NULL,
                mold_temp REAL NOT NULL,
                env_temp REAL NOT NULL,
                humidity REAL NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('warning', 'alarm')),
                message TEXT,
                occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_confirmed INTEGER NOT NULL DEFAULT 0,
                confirmed_at DATETIME,
                confirmed_by TEXT,
                is_deleted INTEGER NOT NULL DEFAULT 0
            );
        """)

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

        if "is_deleted" not in column_names:
            conn.execute("""
                ALTER TABLE warning_alarm_logs
                ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
            """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_warning_logs_active
            ON warning_alarm_logs (is_deleted, is_confirmed, machine_id, occurred_at DESC);
        """)

        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_warning_logs_filter
            ON warning_alarm_logs (is_deleted, machine_id, status, occurred_at DESC);
        """)

        conn.commit()
    finally:
        conn.close()


def ensure_machine_threshold_table():
    """
    Bảng setting chuẩn mới:
    - Không dùng low/high cũ.
    - Chỉ dùng base + warning_delta + alarm_delta.
    - User có thể chỉnh bất kỳ base nào, ví dụ 37, 92...
    - Backend tính cảnh báo theo abs(value - base).
    """

    with get_setting_machine_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS machine_threshold_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                machine_id INTEGER NOT NULL UNIQUE,

                mold_temp_base REAL NOT NULL DEFAULT 70,
                mold_temp_warning_delta REAL NOT NULL DEFAULT 10,
                mold_temp_alarm_delta REAL NOT NULL DEFAULT 15,

                env_temp_base REAL NOT NULL DEFAULT 35,
                env_temp_warning_delta REAL NOT NULL DEFAULT 4,
                env_temp_alarm_delta REAL NOT NULL DEFAULT 6,

                humidity_base REAL NOT NULL DEFAULT 58,
                humidity_warning_delta REAL NOT NULL DEFAULT 3,
                humidity_alarm_delta REAL NOT NULL DEFAULT 5,

                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        """)

        columns = conn.execute("""
            PRAGMA table_info(machine_threshold_settings);
        """).fetchall()

        column_names = {column["name"] for column in columns}

        columns_to_add = [
            ("mold_temp_base", "REAL NOT NULL DEFAULT 70"),
            ("mold_temp_warning_delta", "REAL NOT NULL DEFAULT 10"),
            ("mold_temp_alarm_delta", "REAL NOT NULL DEFAULT 15"),

            ("env_temp_base", "REAL NOT NULL DEFAULT 35"),
            ("env_temp_warning_delta", "REAL NOT NULL DEFAULT 4"),
            ("env_temp_alarm_delta", "REAL NOT NULL DEFAULT 6"),

            ("humidity_base", "REAL NOT NULL DEFAULT 58"),
            ("humidity_warning_delta", "REAL NOT NULL DEFAULT 3"),
            ("humidity_alarm_delta", "REAL NOT NULL DEFAULT 5"),

            ("created_at", "DATETIME DEFAULT CURRENT_TIMESTAMP"),
            ("updated_at", "DATETIME DEFAULT CURRENT_TIMESTAMP"),
        ]

        for column_name, column_def in columns_to_add:
            if column_name not in column_names:
                conn.execute(f"""
                    ALTER TABLE machine_threshold_settings
                    ADD COLUMN {column_name} {column_def};
                """)

        conn.commit()


def get_threshold_value(threshold, key):
    if isinstance(threshold, dict):
        return threshold[key]

    return threshold[key]


def normalize_threshold_row(row):
    """
    Đảm bảo nếu DB cũ có giá trị NULL thì vẫn fallback về default.
    """

    if not row:
        return DEFAULT_MACHINE_THRESHOLDS

    result = {}

    for key, default_value in DEFAULT_MACHINE_THRESHOLDS.items():
        try:
            value = row[key]
        except Exception:
            value = None

        result[key] = default_value if value is None else value

    return result


def get_threshold_for_machine(conn, machine_id):
    ensure_machine_threshold_table()

    row = conn.execute("""
        SELECT *
        FROM machine_threshold_settings
        WHERE machine_id = ?
        LIMIT 1;
    """, (machine_id,)).fetchone()

    if row:
        return normalize_threshold_row(row)

    return DEFAULT_MACHINE_THRESHOLDS


def calc_one_value_status(value, base, warning_delta, alarm_delta):
    """
    Logic chuẩn:
    - Normal nếu abs(value - base) < warning_delta
    - Warning nếu warning_delta <= abs(value - base) < alarm_delta
    - Alarm nếu abs(value - base) >= alarm_delta

    Ví dụ:
    base = 37, warning ±2, alarm ±5
    Normal: 35 < value < 39
    Warning: 32 < value <= 35 hoặc 39 <= value < 42
    Alarm: value <= 32 hoặc value >= 42
    """

    if value is None:
        return "normal"

    value = float(value)
    base = float(base)
    warning_delta = float(warning_delta)
    alarm_delta = float(alarm_delta)

    diff = abs(value - base)

    if diff >= alarm_delta:
        return "alarm"

    if diff >= warning_delta:
        return "warning"

    return "normal"


def calc_status(mold_temp, env_temp, humidity, threshold):
    mold_status = calc_one_value_status(
        mold_temp,
        get_threshold_value(threshold, "mold_temp_base"),
        get_threshold_value(threshold, "mold_temp_warning_delta"),
        get_threshold_value(threshold, "mold_temp_alarm_delta"),
    )

    env_status = calc_one_value_status(
        env_temp,
        get_threshold_value(threshold, "env_temp_base"),
        get_threshold_value(threshold, "env_temp_warning_delta"),
        get_threshold_value(threshold, "env_temp_alarm_delta"),
    )

    humidity_status = calc_one_value_status(
        humidity,
        get_threshold_value(threshold, "humidity_base"),
        get_threshold_value(threshold, "humidity_warning_delta"),
        get_threshold_value(threshold, "humidity_alarm_delta"),
    )

    if "alarm" in [mold_status, env_status, humidity_status]:
        return "alarm"

    if "warning" in [mold_status, env_status, humidity_status]:
        return "warning"

    return "normal"


def threshold_to_frontend(machine_id, threshold):
    return {
        "machineId": machine_id,

        "moldTempBase": get_threshold_value(threshold, "mold_temp_base"),
        "moldTempWarningDelta": get_threshold_value(threshold, "mold_temp_warning_delta"),
        "moldTempAlarmDelta": get_threshold_value(threshold, "mold_temp_alarm_delta"),

        "envTempBase": get_threshold_value(threshold, "env_temp_base"),
        "envTempWarningDelta": get_threshold_value(threshold, "env_temp_warning_delta"),
        "envTempAlarmDelta": get_threshold_value(threshold, "env_temp_alarm_delta"),

        "humidityBase": get_threshold_value(threshold, "humidity_base"),
        "humidityWarningDelta": get_threshold_value(threshold, "humidity_warning_delta"),
        "humidityAlarmDelta": get_threshold_value(threshold, "humidity_alarm_delta"),
    }


def get_active_alarm_map(conn):
    rows = conn.execute("""
        SELECT
            l.*
        FROM warning_alarm_logs l
        INNER JOIN (
            SELECT
                machine_id,
                MAX(
                    CASE status
                        WHEN 'alarm' THEN 2
                        WHEN 'warning' THEN 1
                        ELSE 0
                    END
                ) AS max_level
            FROM warning_alarm_logs
            WHERE COALESCE(is_deleted, 0) = 0
              AND COALESCE(is_confirmed, 0) = 0
            GROUP BY machine_id
        ) active
            ON active.machine_id = l.machine_id
           AND active.max_level = CASE l.status
                WHEN 'alarm' THEN 2
                WHEN 'warning' THEN 1
                ELSE 0
           END
        WHERE COALESCE(l.is_deleted, 0) = 0
          AND COALESCE(l.is_confirmed, 0) = 0
        ORDER BY l.machine_id ASC, l.occurred_at DESC, l.id DESC;
    """).fetchall()

    result = {}

    for row in rows:
        machine_id = row["machine_id"]
        if machine_id not in result:
            result[machine_id] = row

    return result


def get_active_unconfirmed_log(conn, machine_id):
    return conn.execute("""
        SELECT *
        FROM warning_alarm_logs
        WHERE machine_id = ?
          AND COALESCE(is_deleted, 0) = 0
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


@settingmachine_bp.route("/api/settings/threshold", methods=["GET"])
def get_threshold_setting():
    machine_id = request.args.get("machineId", type=int)

    if not machine_id:
        return jsonify({
            "message": "Missing machineId"
        }), 400

    ensure_machine_threshold_table()

    with get_setting_machine_db() as conn:
        threshold = get_threshold_for_machine(conn, machine_id)

    return jsonify(threshold_to_frontend(machine_id, threshold))


@settingmachine_bp.route("/api/settings/threshold", methods=["PUT"])
def update_threshold_setting():
    body = request.get_json() or {}

    required_fields = [
        "machineId",

        "moldTempBase",
        "moldTempWarningDelta",
        "moldTempAlarmDelta",

        "envTempBase",
        "envTempWarningDelta",
        "envTempAlarmDelta",

        "humidityBase",
        "humidityWarningDelta",
        "humidityAlarmDelta",
    ]

    missing = [field for field in required_fields if field not in body]
    if missing:
        return jsonify({
            "message": "Missing required data",
            "missing": missing,
        }), 400

    machine_id = int(body["machineId"])

    values = {
        "mold_temp_base": float(body["moldTempBase"]),
        "mold_temp_warning_delta": float(body["moldTempWarningDelta"]),
        "mold_temp_alarm_delta": float(body["moldTempAlarmDelta"]),

        "env_temp_base": float(body["envTempBase"]),
        "env_temp_warning_delta": float(body["envTempWarningDelta"]),
        "env_temp_alarm_delta": float(body["envTempAlarmDelta"]),

        "humidity_base": float(body["humidityBase"]),
        "humidity_warning_delta": float(body["humidityWarningDelta"]),
        "humidity_alarm_delta": float(body["humidityAlarmDelta"]),
    }

    checks = [
        (
            values["mold_temp_warning_delta"],
            values["mold_temp_alarm_delta"],
            "Mold temperature",
        ),
        (
            values["env_temp_warning_delta"],
            values["env_temp_alarm_delta"],
            "Ambient temperature",
        ),
        (
            values["humidity_warning_delta"],
            values["humidity_alarm_delta"],
            "Humidity",
        ),
    ]

    for warning_delta, alarm_delta, label in checks:
        if warning_delta <= 0 or alarm_delta <= 0:
            return jsonify({
                "message": f"{label}: Warning ± and Alarm ± must be greater than 0."
            }), 400

        if warning_delta >= alarm_delta:
            return jsonify({
                "message": f"{label}: Alarm ± must be greater than Warning ±."
            }), 400

    ensure_machine_threshold_table()

    with get_setting_machine_db() as conn:
        existing = conn.execute("""
            SELECT id
            FROM machine_threshold_settings
            WHERE machine_id = ?
            LIMIT 1;
        """, (machine_id,)).fetchone()

        if existing:
            conn.execute("""
                UPDATE machine_threshold_settings
                SET
                    mold_temp_base = ?,
                    mold_temp_warning_delta = ?,
                    mold_temp_alarm_delta = ?,

                    env_temp_base = ?,
                    env_temp_warning_delta = ?,
                    env_temp_alarm_delta = ?,

                    humidity_base = ?,
                    humidity_warning_delta = ?,
                    humidity_alarm_delta = ?,

                    updated_at = CURRENT_TIMESTAMP
                WHERE machine_id = ?;
            """, (
                values["mold_temp_base"],
                values["mold_temp_warning_delta"],
                values["mold_temp_alarm_delta"],

                values["env_temp_base"],
                values["env_temp_warning_delta"],
                values["env_temp_alarm_delta"],

                values["humidity_base"],
                values["humidity_warning_delta"],
                values["humidity_alarm_delta"],

                machine_id,
            ))
        else:
            conn.execute("""
                INSERT INTO machine_threshold_settings (
                    machine_id,

                    mold_temp_base,
                    mold_temp_warning_delta,
                    mold_temp_alarm_delta,

                    env_temp_base,
                    env_temp_warning_delta,
                    env_temp_alarm_delta,

                    humidity_base,
                    humidity_warning_delta,
                    humidity_alarm_delta
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (
                machine_id,

                values["mold_temp_base"],
                values["mold_temp_warning_delta"],
                values["mold_temp_alarm_delta"],

                values["env_temp_base"],
                values["env_temp_warning_delta"],
                values["env_temp_alarm_delta"],

                values["humidity_base"],
                values["humidity_warning_delta"],
                values["humidity_alarm_delta"],
            ))

        conn.commit()

    return jsonify({
        "message": "Machine setting updated successfully",
        "setting": threshold_to_frontend(machine_id, values),
    })


@settingmachine_bp.route("/api/settings/chart-times", methods=["GET"])
def get_chart_time_settings():
    with get_setting_machine_db() as conn:
        rows = conn.execute("""
            SELECT id, label, interval_seconds, is_default, is_active
            FROM chart_time_settings
            WHERE is_active = 1
            ORDER BY interval_seconds ASC;
        """).fetchall()

    return jsonify([
        {
            "id": row["id"],
            "label": row["label"],
            "value": row["interval_seconds"],
            "intervalSeconds": row["interval_seconds"],
            "isDefault": bool(row["is_default"]),
        }
        for row in rows
    ])


@settingmachine_bp.route("/api/warning-logs", methods=["GET"])
def get_warning_logs():
    from machine import get_machine_name_map

    status = request.args.get("status", default="all")
    date_value = request.args.get("date")
    machine = request.args.get("machine", default="").strip().lower()
    machine_id = request.args.get("machineId", type=int)
    only_active = request.args.get("onlyActive", default="0")

    query = """
        SELECT
            id,
            machine_id,
            mold_temp,
            env_temp,
            humidity,
            status,
            message,
            occurred_at,
            COALESCE(is_confirmed, 0) AS is_confirmed,
            confirmed_at,
            confirmed_by
        FROM warning_alarm_logs
        WHERE COALESCE(is_deleted, 0) = 0
    """

    params = []

    if only_active in ["1", "true", "True"]:
        query += " AND COALESCE(is_confirmed, 0) = 0"

    if machine_id:
        query += " AND machine_id = ?"
        params.append(machine_id)

    if status in ["warning", "alarm"]:
        query += " AND status = ?"
        params.append(status)

    if date_value:
        query += " AND date(occurred_at) = date(?)"
        params.append(date_value)

    query += " ORDER BY COALESCE(is_confirmed, 0) ASC, occurred_at DESC, id DESC;"

    with get_setting_machine_db() as conn:
        rows = conn.execute(query, params).fetchall()

    machine_map = get_machine_name_map()

    data = []
    for row in rows:
        machine_info = machine_map.get(row["machine_id"], {})
        machine_name = machine_info.get("name", f"M{row['machine_id']}")

        if machine and machine not in machine_name.lower():
            continue

        data.append({
            "id": row["id"],
            "machineId": row["machine_id"],
            "machineName": machine_name,
            "time": row["occurred_at"],
            "moldTemp": row["mold_temp"],
            "envTemp": row["env_temp"],
            "hum": row["humidity"],
            "status": row["status"],
            "message": row["message"],
            "isConfirmed": bool(row["is_confirmed"]),
            "confirmedAt": row["confirmed_at"],
            "confirmedBy": row["confirmed_by"],
        })

    return jsonify(data)


@settingmachine_bp.route("/api/warning-logs/<int:log_id>/confirm", methods=["PUT"])
def confirm_warning_log(log_id):
    body = request.get_json() or {}
    confirmed_by = body.get("confirmedBy", "operator")

    with get_setting_machine_db() as conn:
        log = conn.execute("""
            SELECT *
            FROM warning_alarm_logs
            WHERE id = ?
              AND COALESCE(is_deleted, 0) = 0;
        """, (log_id,)).fetchone()

        if not log:
            return jsonify({
                "message": "Log not found"
            }), 404

        conn.execute("""
            UPDATE warning_alarm_logs
            SET
                is_confirmed = 1,
                confirmed_at = CURRENT_TIMESTAMP,
                confirmed_by = ?
            WHERE id = ?;
        """, (
            confirmed_by,
            log_id,
        ))

        conn.commit()

    return jsonify({
        "message": "Warning confirmed",
        "id": log_id
    })


@settingmachine_bp.route("/api/machines/<int:machine_id>/confirm-alerts", methods=["PUT"])
def confirm_machine_alerts(machine_id):
    from machine import get_machine_by_id

    body = request.get_json() or {}
    confirmed_by = body.get("confirmedBy", "operator")

    machine = get_machine_by_id(machine_id)

    if not machine:
        return jsonify({
            "message": "Machine not found or inactive"
        }), 404

    with get_setting_machine_db() as conn:
        conn.execute("""
            UPDATE warning_alarm_logs
            SET
                is_confirmed = 1,
                confirmed_at = CURRENT_TIMESTAMP,
                confirmed_by = ?
            WHERE machine_id = ?
              AND COALESCE(is_deleted, 0) = 0
              AND COALESCE(is_confirmed, 0) = 0;
        """, (
            confirmed_by,
            machine_id,
        ))

        conn.commit()

    return jsonify({
        "message": "All machine alerts confirmed",
        "machineId": machine_id
    })


@settingmachine_bp.route("/api/warning-logs", methods=["DELETE"])
def delete_warning_logs():
    with get_setting_machine_db() as conn:
        conn.execute("""
            UPDATE warning_alarm_logs
            SET is_deleted = 1
            WHERE COALESCE(is_deleted, 0) = 0;
        """)
        conn.commit()

    return jsonify({
        "message": "Warning logs deleted"
    })