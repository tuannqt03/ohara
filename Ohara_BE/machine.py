import random
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from flask import Blueprint, jsonify, request, current_app

from settingmachine import (
    get_setting_machine_db,
    get_threshold_for_machine,
    calc_status,
    get_warning_sources,
)

machine_bp = Blueprint("machine", __name__)

OUTDOOR_CHART_ID = "outdoor"


def get_machine_db():
    db_path = current_app.config.get(
        "MACHINE_DB_PATH",
        Path(__file__).resolve().parent / "database" / "machine.db",
    )

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def get_machine_by_id(machine_id):
    with get_machine_db() as conn:
        return conn.execute(
            """
            SELECT id, machine_code, machine_name, is_active
            FROM machines
            WHERE id = ?
              AND is_active = 1;
            """,
            (machine_id,),
        ).fetchone()


def get_machine_name_map():
    with get_machine_db() as conn:
        rows = conn.execute(
            """
            SELECT id, machine_code, machine_name
            FROM machines
            WHERE is_active = 1
            ORDER BY id ASC;
            """
        ).fetchall()

    return {
        row["id"]: {
            "id": row["id"],
            "code": row["machine_code"],
            "name": row["machine_name"],
        }
        for row in rows
    }


def generate_safe_sensor_values():
    return (
        round(random.uniform(66.0, 74.0), 1),
        round(random.uniform(33.0, 37.0), 1),
        round(random.uniform(56.0, 60.0), 1),
    )


def generate_safe_outdoor_values():
    return (
        round(random.uniform(25.0, 38.0), 1),
        round(random.uniform(40.0, 70.0), 1),
    )


def ensure_warning_alarm_logs_schema(setting_conn):
    columns = setting_conn.execute(
        """
        PRAGMA table_info(warning_alarm_logs);
        """
    ).fetchall()

    column_names = {column["name"] for column in columns}

    if "resolved_at" not in column_names:
        setting_conn.execute(
            """
            ALTER TABLE warning_alarm_logs
            ADD COLUMN resolved_at TEXT;
            """
        )
    setting_conn.execute(
        """
        DELETE FROM warning_alarm_logs
        WHERE COALESCE(is_deleted, 0) = 1
           OR resolved_at IS NOT NULL;
        """
    )

    setting_conn.commit()
def build_warning_message(mold_temp, env_temp, humidity, threshold):
    warning_parts = []

    sources = get_warning_sources(
        mold_temp,
        env_temp,
        humidity,
        threshold,
    )

    if "Mold Temp" in sources:
        warning_parts.append(f"Mold Temp ({mold_temp}C)")

    if "Temp" in sources:
        warning_parts.append(f"Temp ({env_temp}C)")

    if "Humidity" in sources:
        warning_parts.append(f"Humidity ({humidity}%)")

    return ", ".join(warning_parts)


def create_warning_log_if_needed(
    setting_conn,
    machine,
    mold_temp,
    env_temp,
    humidity,
    status,
    occurred_at=None,
):
    ensure_warning_alarm_logs_schema(setting_conn)

    occurred_at_text = occurred_at or datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Khi máy về normal: xoá thật log active để DB không phình.
    if status == "normal":
        setting_conn.execute(
            """
            DELETE FROM warning_alarm_logs
            WHERE machine_id = ?
              AND resolved_at IS NULL;
            """,
            (machine["id"],),
        )

        setting_conn.commit()
        return None

    if status not in ["warning", "alarm"]:
        return None

    threshold = get_threshold_for_machine(
        setting_conn,
        machine["id"],
    )

    message = build_warning_message(
        mold_temp,
        env_temp,
        humidity,
        threshold,
    )

    active_log = setting_conn.execute(
        """
        SELECT *
        FROM warning_alarm_logs
        WHERE machine_id = ?
          AND COALESCE(is_deleted, 0) = 0
          AND resolved_at IS NULL
        ORDER BY occurred_at DESC, id DESC
        LIMIT 1;
        """,
        (machine["id"],),
    ).fetchone()

    # Nếu đang có log active thì chỉ UPDATE.
    # Warning -> Alarm hoặc Alarm -> Warning không sinh thêm dòng mới.
    if active_log:
        setting_conn.execute(
            """
            UPDATE warning_alarm_logs
            SET
                mold_temp = ?,
                env_temp = ?,
                humidity = ?,
                status = ?,
                message = ?
            WHERE id = ?;
            """,
            (
                mold_temp,
                env_temp,
                humidity,
                status,
                message,
                active_log["id"],
            ),
        )

        setting_conn.commit()
        return active_log["id"]

    cursor = setting_conn.execute(
        """
        INSERT INTO warning_alarm_logs (
            machine_id,
            mold_temp,
            env_temp,
            humidity,
            status,
            message,
            occurred_at,
            resolved_at,
            is_confirmed
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0);
        """,
        (
            machine["id"],
            mold_temp,
            env_temp,
            humidity,
            status,
            message,
            occurred_at_text,
        ),
    )

    setting_conn.commit()
    return cursor.lastrowid

def calculate_status_for_reading(setting_conn, machine_id, mold_temp, env_temp, humidity):
    threshold = get_threshold_for_machine(setting_conn, machine_id)
    return calc_status(mold_temp, env_temp, humidity, threshold)


CHART_SAMPLE_TIME_POLICIES = [
    {
        "max_days": 5,
        "allowed_intervals": [10, 30, 60],
        "default_interval": 10,
        "label": "10s/30s/60s",
    },
    {
        "max_days": 10,
        "allowed_intervals": [60],
        "default_interval": 60,
        "label": "1p",
    },
    {
        "max_days": 30,
        "allowed_intervals": [300],
        "default_interval": 300,
        "label": "5p",
    },
    {
        "max_days": 90,
        "allowed_intervals": [600],
        "default_interval": 600,
        "label": "10p",
    },
    {
        "max_days": 365,
        "allowed_intervals": [3600],
        "default_interval": 3600,
        "label": "60p",
    },
]


def get_chart_sample_time_policy(start_time, end_time, is_custom_range):
    if not is_custom_range:
        return {
            "blocked": False,
            "allowed_intervals": [10, 30, 60],
            "default_interval": 10,
            "label": "10s/30s/60s",
            "range_days": None,
        }

    range_days = (end_time - start_time).total_seconds() / 86400

    if range_days > 365:
        return {
            "blocked": True,
            "message": "Time range is longer than 1 year. Please choose a range of 1 year or less.",
            "range_days": range_days,
        }

    for policy in CHART_SAMPLE_TIME_POLICIES:
        if range_days <= policy["max_days"]:
            return {
                "blocked": False,
                "allowed_intervals": policy["allowed_intervals"],
                "default_interval": policy["default_interval"],
                "label": policy["label"],
                "range_days": range_days,
            }

    return {
        "blocked": True,
        "message": "Invalid time range",
        "range_days": range_days,
    }


@machine_bp.route("/api/debug/db", methods=["GET"])
def debug_db():
    machine_db_path = current_app.config["MACHINE_DB_PATH"]
    setting_machine_db_path = current_app.config["SETTING_MACHINE_DB_PATH"]

    result = {
        "machineDb": {
            "path": str(machine_db_path),
            "exists": machine_db_path.exists(),
            "tables": [],
        },
        "settingMachineDb": {
            "path": str(setting_machine_db_path),
            "exists": setting_machine_db_path.exists(),
            "tables": [],
        },
    }

    if machine_db_path.exists():
        with get_machine_db() as conn:
            rows = conn.execute(
                """
                SELECT name
                FROM sqlite_master
                WHERE type = 'table'
                ORDER BY name;
                """
            ).fetchall()
            result["machineDb"]["tables"] = [row["name"] for row in rows]

    if setting_machine_db_path.exists():
        with get_setting_machine_db() as conn:
            rows = conn.execute(
                """
                SELECT name
                FROM sqlite_master
                WHERE type = 'table'
                ORDER BY name;
                """
            ).fetchall()
            result["settingMachineDb"]["tables"] = [row["name"] for row in rows]

    return jsonify(result)


@machine_bp.route("/api/machines/latest", methods=["GET"])
def get_latest_machines():
    with get_machine_db() as machine_conn:
        machines = machine_conn.execute(
            """
            SELECT
                id,
                machine_code,
                machine_name
            FROM machines
            WHERE is_active = 1
            ORDER BY id ASC;
            """
        ).fetchall()

        latest_rows = machine_conn.execute(
            """
            SELECT
                r.machine_id,
                r.mold_temp,
                r.env_temp,
                r.humidity,
                r.recorded_at
            FROM sensor_readings r
            INNER JOIN (
                SELECT
                    machine_id,
                    MAX(recorded_at || printf('%010d', id)) AS latest_key
                FROM sensor_readings
                GROUP BY machine_id
            ) latest
                ON latest.machine_id = r.machine_id
               AND latest.latest_key = r.recorded_at || printf('%010d', r.id)
            ORDER BY r.machine_id ASC;
            """
        ).fetchall()

    latest_map = {row["machine_id"]: row for row in latest_rows}

    data = []
    now = datetime.now()
    dashboard_refresh_seconds = 10
    disconnect_after_seconds = dashboard_refresh_seconds * 2

    def is_disconnected(latest_row):
        if not latest_row or not latest_row["recorded_at"]:
            return True

        try:
            recorded_at = datetime.strptime(
                latest_row["recorded_at"],
                "%Y-%m-%d %H:%M:%S",
            )
        except ValueError:
            return True

        return (now - recorded_at).total_seconds() > disconnect_after_seconds

    with get_setting_machine_db() as setting_conn:
        for machine in machines:
            latest = latest_map.get(machine["id"])
            disconnected = is_disconnected(latest)

            calculated_status = "disconnected"
            active_log_id = None
            need_confirm = False

            if not disconnected:
                mold_temp = latest["mold_temp"]
                env_temp = latest["env_temp"]
                humidity = latest["humidity"]

                calculated_status = calculate_status_for_reading(
                    setting_conn,
                    machine["id"],
                    mold_temp,
                    env_temp,
                    humidity,
                )

                create_warning_log_if_needed(
                    setting_conn=setting_conn,
                    machine=machine,
                    mold_temp=mold_temp,
                    env_temp=env_temp,
                    humidity=humidity,
                    status=calculated_status,
                    occurred_at=latest["recorded_at"],
                )

            if disconnected:
                display_status = "disconnected"
            else:
                display_status = calculated_status

            active_log_id = None
            need_confirm = False

            data.append(
                {
                    "id": machine["id"],
                    "code": machine["machine_code"],
                    "name": machine["machine_name"],
                    "moldTemp": None if disconnected else latest["mold_temp"],
                    "temp": None if disconnected else latest["env_temp"],
                    "hum": None if disconnected else latest["humidity"],
                    "status": display_status,
                    "currentStatus": calculated_status,
                    "needConfirm": need_confirm,
                    "activeLogId": active_log_id,
                    "isDisconnected": disconnected,
                    "recordedAt": latest["recorded_at"] if latest else None,
                }
            )

    return jsonify(data)


@machine_bp.route("/api/sensor-readings/chart", methods=["GET"])
def get_chart_data():
    interval = request.args.get("interval", default=10, type=int)
    points = request.args.get("points", default=100, type=int)

    if points <= 0:
        points = 100

    start_time_text = request.args.get("startTime", default="").strip()
    end_time_text = request.args.get("endTime", default="").strip()

    try:
        is_custom_range = bool(start_time_text or end_time_text)

        if is_custom_range:
            if not start_time_text or not end_time_text:
                return jsonify({"message": "Custom range needs both startTime and endTime"}), 400

            start_time = datetime.strptime(
                start_time_text,
                "%Y-%m-%d %H:%M:%S",
            )
            end_time = datetime.strptime(
                end_time_text,
                "%Y-%m-%d %H:%M:%S",
            )
        else:
            end_time = datetime.now().replace(microsecond=0)
            start_time = end_time - timedelta(seconds=interval * points)

    except ValueError:
        return jsonify({"message": "Invalid startTime/endTime format. Use YYYY-MM-DD HH:mm:ss"}), 400

    if start_time >= end_time:
        return jsonify({"message": "startTime must be earlier than endTime"}), 400

    sample_policy = get_chart_sample_time_policy(
        start_time,
        end_time,
        is_custom_range,
    )

    if sample_policy.get("blocked"):
        return jsonify(
            {
                "message": sample_policy.get("message"),
                "maxRangeDays": 365,
                "rangeDays": sample_policy.get("range_days"),
            }
        ), 400

    allowed_intervals = sample_policy["allowed_intervals"]

    if interval not in allowed_intervals:
        if is_custom_range:
            interval = sample_policy["default_interval"]
        else:
            return jsonify(
                {
                    "message": "Invalid interval",
                    "allowed": allowed_intervals,
                    "defaultInterval": sample_policy["default_interval"],
                }
            ), 400

    disconnect_after_seconds = interval * 2

    with get_machine_db() as machine_conn:
        machines = machine_conn.execute(
            """
            SELECT id
            FROM machines
            WHERE is_active = 1
            ORDER BY id ASC;
            """
        ).fetchall()

        latest_before_start_rows = machine_conn.execute(
            """
            SELECT
                r.machine_id,
                r.recorded_at,
                r.mold_temp,
                r.env_temp,
                r.humidity
            FROM sensor_readings r
            INNER JOIN (
                SELECT
                    machine_id,
                    MAX(recorded_at || printf('%010d', id)) AS latest_key
                FROM sensor_readings
                WHERE recorded_at < ?
                GROUP BY machine_id
            ) latest
                ON latest.machine_id = r.machine_id
               AND latest.latest_key = r.recorded_at || printf('%010d', r.id)
            ORDER BY r.machine_id ASC;
            """,
            (
                start_time.strftime("%Y-%m-%d %H:%M:%S"),
            ),
        ).fetchall()

        rows_in_range = machine_conn.execute(
            """
            SELECT
                machine_id,
                recorded_at,
                mold_temp,
                env_temp,
                humidity
            FROM sensor_readings
            WHERE recorded_at >= ?
              AND recorded_at <= ?
            ORDER BY recorded_at ASC, machine_id ASC;
            """,
            (
                start_time.strftime("%Y-%m-%d %H:%M:%S"),
                end_time.strftime("%Y-%m-%d %H:%M:%S"),
            ),
        ).fetchall()

        latest_outdoor_before_start = machine_conn.execute(
            """
            SELECT
                recorded_at,
                outdoor_temp,
                outdoor_humidity
            FROM outdoor_weather_readings
            WHERE recorded_at < ?
            ORDER BY recorded_at DESC, id DESC
            LIMIT 1;
            """,
            (
                start_time.strftime("%Y-%m-%d %H:%M:%S"),
            ),
        ).fetchone()

        outdoor_rows_in_range = machine_conn.execute(
            """
            SELECT
                recorded_at,
                outdoor_temp,
                outdoor_humidity
            FROM outdoor_weather_readings
            WHERE recorded_at >= ?
              AND recorded_at <= ?
            ORDER BY recorded_at ASC, id ASC;
            """,
            (
                start_time.strftime("%Y-%m-%d %H:%M:%S"),
                end_time.strftime("%Y-%m-%d %H:%M:%S"),
            ),
        ).fetchall()

    machine_ids = [row["id"] for row in machines]
    all_rows = list(latest_before_start_rows) + list(rows_in_range)

    rows_by_machine = {}

    for row in all_rows:
        recorded_at = row["recorded_at"]

        if not recorded_at:
            continue

        try:
            recorded_dt = datetime.strptime(recorded_at, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue

        machine_id = row["machine_id"]

        rows_by_machine.setdefault(machine_id, []).append(
            {
                "dt": recorded_dt,
                "recorded_at": recorded_at,
                "mold_temp": row["mold_temp"],
                "env_temp": row["env_temp"],
                "humidity": row["humidity"],
            }
        )

    for machine_id in rows_by_machine:
        rows_by_machine[machine_id].sort(
            key=lambda item: (item["dt"], item["recorded_at"])
        )

    outdoor_source_rows = (
        ([latest_outdoor_before_start] if latest_outdoor_before_start else [])
        + list(outdoor_rows_in_range)
    )

    outdoor_rows = []

    for row in outdoor_source_rows:
        recorded_at = row["recorded_at"]

        if not recorded_at:
            continue

        try:
            recorded_dt = datetime.strptime(recorded_at, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue

        outdoor_rows.append(
            {
                "dt": recorded_dt,
                "recorded_at": recorded_at,
                "temp": row["outdoor_temp"],
                "hum": row["outdoor_humidity"],
            }
        )

    outdoor_rows.sort(key=lambda item: (item["dt"], item["recorded_at"]))

    result = []
    machine_pointer_map = {machine_id: 0 for machine_id in machine_ids}
    outdoor_pointer = 0
    current_time = start_time.replace(microsecond=0)

    while current_time <= end_time:
        current_time_text = current_time.strftime("%Y-%m-%d %H:%M:%S")

        if interval >= 3600:
            display_time = current_time.strftime("%d/%m %H:%M")
        elif is_custom_range:
            display_time = current_time.strftime("%d/%m %H:%M:%S")
        else:
            display_time = current_time.strftime("%H:%M:%S")

        item = {
            "time": display_time,
            "fullTime": current_time_text,
            "realFullTime": current_time_text,
            "interval": interval,
        }

        item[f"moldTemp_{OUTDOOR_CHART_ID}"] = None
        item[f"temp_{OUTDOOR_CHART_ID}"] = None
        item[f"hum_{OUTDOOR_CHART_ID}"] = None
        item[f"isDisconnected_{OUTDOOR_CHART_ID}"] = False
        item[f"recordedAt_{OUTDOOR_CHART_ID}"] = None

        while outdoor_pointer < len(outdoor_rows) and outdoor_rows[outdoor_pointer]["dt"] <= current_time:
            outdoor_pointer += 1

        latest_outdoor = outdoor_rows[outdoor_pointer - 1] if outdoor_pointer > 0 else None

        if latest_outdoor:
            outdoor_diff_seconds = (current_time - latest_outdoor["dt"]).total_seconds()

            if outdoor_diff_seconds < disconnect_after_seconds:
                item[f"temp_{OUTDOOR_CHART_ID}"] = latest_outdoor["temp"]
                item[f"hum_{OUTDOOR_CHART_ID}"] = latest_outdoor["hum"]
                item[f"isDisconnected_{OUTDOOR_CHART_ID}"] = False
                item[f"recordedAt_{OUTDOOR_CHART_ID}"] = latest_outdoor["recorded_at"]
            else:
                # Khi mất kết nối: giữ giá trị cuối cùng để biểu đồ vẽ thành đường thẳng liền
                item[f"temp_{OUTDOOR_CHART_ID}"] = latest_outdoor["temp"]
                item[f"hum_{OUTDOOR_CHART_ID}"] = latest_outdoor["hum"]
                item[f"isDisconnected_{OUTDOOR_CHART_ID}"] = True
                item[f"recordedAt_{OUTDOOR_CHART_ID}"] = latest_outdoor["recorded_at"]
        for machine_id in machine_ids:
            machine_rows = rows_by_machine.get(machine_id, [])
            pointer = machine_pointer_map.get(machine_id, 0)

            while pointer < len(machine_rows) and machine_rows[pointer]["dt"] <= current_time:
                pointer += 1

            machine_pointer_map[machine_id] = pointer
            latest_row = machine_rows[pointer - 1] if pointer > 0 else None

            item[f"moldTemp_{machine_id}"] = None
            item[f"temp_{machine_id}"] = None
            item[f"hum_{machine_id}"] = None
            item[f"isDisconnected_{machine_id}"] = False
            item[f"recordedAt_{machine_id}"] = None

            if not latest_row:
                continue

            diff_seconds = (current_time - latest_row["dt"]).total_seconds()

            if diff_seconds < disconnect_after_seconds:
                item[f"moldTemp_{machine_id}"] = latest_row["mold_temp"]
                item[f"temp_{machine_id}"] = latest_row["env_temp"]
                item[f"hum_{machine_id}"] = latest_row["humidity"]
                item[f"isDisconnected_{machine_id}"] = False
                item[f"recordedAt_{machine_id}"] = latest_row["recorded_at"]
            else:
                # Khi mất kết nối: giữ giá trị cuối cùng để biểu đồ vẽ thành đường thẳng liền
                item[f"moldTemp_{machine_id}"] = latest_row["mold_temp"]
                item[f"temp_{machine_id}"] = latest_row["env_temp"]
                item[f"hum_{machine_id}"] = latest_row["humidity"]
                item[f"isDisconnected_{machine_id}"] = True
                item[f"recordedAt_{machine_id}"] = latest_row["recorded_at"]
        result.append(item)
        current_time += timedelta(seconds=interval)

    return jsonify(result)


@machine_bp.route("/api/sensor-readings", methods=["POST"])
def create_sensor_reading():
    body = request.get_json() or {}

    required_fields = ["machineId", "moldTemp", "temp", "hum"]
    missing = [field for field in required_fields if field not in body]

    if missing:
        return jsonify({"message": "Missing data", "missing": missing}), 400

    machine_id = int(body["machineId"])
    mold_temp = float(body["moldTemp"])
    env_temp = float(body["temp"])
    humidity = float(body["hum"])

    machine = get_machine_by_id(machine_id)

    if not machine:
        return jsonify({"message": "Machine not found or inactive"}), 404

    with get_setting_machine_db() as setting_conn:
        status = calculate_status_for_reading(
            setting_conn,
            machine_id,
            mold_temp,
            env_temp,
            humidity,
        )

    recorded_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_machine_db() as machine_conn:
        cursor = machine_conn.execute(
            """
            INSERT INTO sensor_readings (
                machine_id,
                mold_temp,
                env_temp,
                humidity,
                recorded_at
            )
            VALUES (?, ?, ?, ?, ?);
            """,
            (
                machine_id,
                mold_temp,
                env_temp,
                humidity,
                recorded_at,
            ),
        )

        sensor_id = cursor.lastrowid
        machine_conn.commit()

    with get_setting_machine_db() as setting_conn:
        create_warning_log_if_needed(
            setting_conn=setting_conn,
            machine=machine,
            mold_temp=mold_temp,
            env_temp=env_temp,
            humidity=humidity,
            status=status,
            occurred_at=recorded_at,
        )

    return jsonify(
        {
            "message": "Saved PLC data successfully",
            "id": sensor_id,
            "status": status,
            "recordedAt": recorded_at,
        }
    )


@machine_bp.route("/api/sensor-readings/fake", methods=["POST"])
def create_fake_sensor_readings():
    with get_machine_db() as machine_conn:
        machines = machine_conn.execute(
            """
            SELECT id, machine_name
            FROM machines
            WHERE is_active = 1
            ORDER BY id ASC;
            """
        ).fetchall()

    inserted = 0
    warning_count = 0
    alarm_count = 0

    with get_machine_db() as machine_conn, get_setting_machine_db() as setting_conn:
        for machine in machines:
            machine_id = machine["id"]

            mold_temp, env_temp, humidity = generate_safe_sensor_values()

            status = calculate_status_for_reading(
                setting_conn,
                machine_id,
                mold_temp,
                env_temp,
                humidity,
            )

            recorded_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            machine_conn.execute(
                """
                INSERT INTO sensor_readings (
                    machine_id,
                    mold_temp,
                    env_temp,
                    humidity,
                    recorded_at
                )
                VALUES (?, ?, ?, ?, ?);
                """,
                (
                    machine_id,
                    mold_temp,
                    env_temp,
                    humidity,
                    recorded_at,
                ),
            )

            if status == "warning":
                warning_count += 1
            elif status == "alarm":
                alarm_count += 1

            create_warning_log_if_needed(
                setting_conn=setting_conn,
                machine=machine,
                mold_temp=mold_temp,
                env_temp=env_temp,
                humidity=humidity,
                status=status,
            )

            inserted += 1

        machine_conn.commit()
        setting_conn.commit()

    return jsonify(
        {
            "message": "Created fake data for all machines",
            "inserted": inserted,
            "warning": warning_count,
            "alarm": alarm_count,
        }
    )


@machine_bp.route("/api/sensor-readings/fake-history", methods=["POST"])
def create_fake_history():
    body = request.get_json() or {}

    minutes = int(body.get("minutes", 60))
    step_seconds = int(body.get("stepSeconds", 10))

    now = datetime.now()
    start_time = now - timedelta(minutes=minutes)

    with get_machine_db() as machine_conn:
        machines = machine_conn.execute(
            """
            SELECT id, machine_name
            FROM machines
            WHERE is_active = 1
            ORDER BY id ASC;
            """
        ).fetchall()

    inserted = 0
    warning_count = 0
    alarm_count = 0
    current_time = start_time

    with get_machine_db() as machine_conn, get_setting_machine_db() as setting_conn:
        while current_time <= now:
            current_time_text = current_time.strftime("%Y-%m-%d %H:%M:%S")

            for machine in machines:
                machine_id = machine["id"]

                mold_temp, env_temp, humidity = generate_safe_sensor_values()

                status = calculate_status_for_reading(
                    setting_conn,
                    machine_id,
                    mold_temp,
                    env_temp,
                    humidity,
                )

                machine_conn.execute(
                    """
                    INSERT INTO sensor_readings (
                        machine_id,
                        mold_temp,
                        env_temp,
                        humidity,
                        recorded_at
                    )
                    VALUES (?, ?, ?, ?, ?);
                    """,
                    (
                        machine_id,
                        mold_temp,
                        env_temp,
                        humidity,
                        current_time_text,
                    ),
                )

                if status == "warning":
                    warning_count += 1
                elif status == "alarm":
                    alarm_count += 1

                create_warning_log_if_needed(
                    setting_conn=setting_conn,
                    machine=machine,
                    mold_temp=mold_temp,
                    env_temp=env_temp,
                    humidity=humidity,
                    status=status,
                    occurred_at=current_time_text,
                )

                inserted += 1

            current_time += timedelta(seconds=step_seconds)

        machine_conn.commit()
        setting_conn.commit()

    return jsonify(
        {
            "message": "Created fake history",
            "minutes": minutes,
            "stepSeconds": step_seconds,
            "inserted": inserted,
            "warning": warning_count,
            "alarm": alarm_count,
        }
    )


@machine_bp.route("/api/outdoor-weather/latest", methods=["GET"])
def get_latest_outdoor_weather():
    dashboard_refresh_seconds = 10
    disconnect_after_seconds = dashboard_refresh_seconds * 2
    now = datetime.now()

    with get_machine_db() as conn:
        row = conn.execute(
            """
            SELECT
                id,
                outdoor_temp,
                outdoor_humidity,
                recorded_at
            FROM outdoor_weather_readings
            ORDER BY recorded_at DESC, id DESC
            LIMIT 1;
            """
        ).fetchone()

    if not row:
        return jsonify(
            {
                "id": None,
                "temp": None,
                "hum": None,
                "recordedAt": None,
                "isDisconnected": True,
            }
        )

    try:
        recorded_at = datetime.strptime(row["recorded_at"], "%Y-%m-%d %H:%M:%S")
        disconnected = (now - recorded_at).total_seconds() > disconnect_after_seconds
    except Exception:
        disconnected = True

    return jsonify(
        {
            "id": row["id"],
            "temp": None if disconnected else row["outdoor_temp"],
            "hum": None if disconnected else row["outdoor_humidity"],
            "recordedAt": row["recorded_at"],
            "isDisconnected": disconnected,
        }
    )


@machine_bp.route("/api/outdoor-weather", methods=["POST"])
def create_outdoor_weather():
    body = request.get_json() or {}

    required_fields = ["temp", "hum"]
    missing = [field for field in required_fields if field not in body]

    if missing:
        return jsonify({"message": "Missing data", "missing": missing}), 400

    outdoor_temp = float(body["temp"])
    outdoor_humidity = float(body["hum"])

    recorded_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_machine_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO outdoor_weather_readings (
                outdoor_temp,
                outdoor_humidity,
                recorded_at
            )
            VALUES (?, ?, ?);
            """,
            (
                outdoor_temp,
                outdoor_humidity,
                recorded_at,
            ),
        )

        conn.commit()

    return jsonify(
        {
            "message": "Saved outdoor weather successfully",
            "id": cursor.lastrowid,
            "temp": outdoor_temp,
            "hum": outdoor_humidity,
            "recordedAt": recorded_at,
        }
    )
