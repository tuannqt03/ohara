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

ALARM_LOG_COOLDOWN_SECONDS = 15 * 60


def get_machine_db():
    db_path = current_app.config.get(
        "MACHINE_DB_PATH",
        Path(__file__).resolve().parent / "database" / "machine.db"
    )

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def get_machine_by_id(machine_id):
    with get_machine_db() as conn:
        return conn.execute("""
            SELECT id, machine_code, machine_name, is_active
            FROM machines
            WHERE id = ?
              AND is_active = 1;
        """, (machine_id,)).fetchone()


def get_machine_name_map():
    with get_machine_db() as conn:
        rows = conn.execute("""
            SELECT id, machine_code, machine_name
            FROM machines
            WHERE is_active = 1
            ORDER BY id ASC;
        """).fetchall()

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


def status_level(status):
    if status == "alarm":
        return 2
    if status == "warning":
        return 1
    return 0


def should_create_warning_log(latest_log, new_status, occurred_at=None):
    if new_status not in ["warning", "alarm"]:
        return False

    if not latest_log:
        return True

    old_status = latest_log["status"]

    if status_level(new_status) > status_level(old_status):
        return True

    try:
        last_time = datetime.strptime(
            latest_log["occurred_at"],
            "%Y-%m-%d %H:%M:%S"
        )
        current_time = (
            datetime.strptime(occurred_at, "%Y-%m-%d %H:%M:%S")
            if occurred_at
            else datetime.now()
        )

        return (current_time - last_time).total_seconds() >= ALARM_LOG_COOLDOWN_SECONDS
    except Exception:
        return True


def create_warning_log_if_needed(
    setting_conn,
    machine,
    mold_temp,
    env_temp,
    humidity,
    status,
    occurred_at=None,
):
    if status not in ["warning", "alarm"]:
        return None

    latest_log = setting_conn.execute("""
        SELECT *
        FROM warning_alarm_logs
        WHERE machine_id = ?
          AND COALESCE(is_deleted, 0) = 0
        ORDER BY occurred_at DESC, id DESC
        LIMIT 1;
    """, (machine["id"],)).fetchone()

    if not should_create_warning_log(latest_log, status, occurred_at):
        return latest_log["id"] if latest_log else None

    occurred_at_text = occurred_at or datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    threshold = get_threshold_for_machine(
        setting_conn,
        machine["id"],
    )

    warning_parts = []

    sources = get_warning_sources(
        mold_temp,
        env_temp,
        humidity,
        threshold,
    )

    if "Mold Temp" in sources:
        warning_parts.append(f"Mold Temp ({mold_temp}°C)")

    if "Temp" in sources:
        warning_parts.append(f"Temp ({env_temp}°C)")

    if "Humidity" in sources:
        warning_parts.append(f"Humidity ({humidity}%)")

    message = ", ".join(warning_parts)

    cursor = setting_conn.execute("""
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
        machine["id"],
        mold_temp,
        env_temp,
        humidity,
        status,
        message,
        occurred_at_text,
    ))

    setting_conn.commit()

    return cursor.lastrowid


def calculate_status_for_reading(setting_conn, machine_id, mold_temp, env_temp, humidity):
    threshold = get_threshold_for_machine(setting_conn, machine_id)
    return calc_status(mold_temp, env_temp, humidity, threshold)


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
            rows = conn.execute("""
                SELECT name
                FROM sqlite_master
                WHERE type = 'table'
                ORDER BY name;
            """).fetchall()
            result["machineDb"]["tables"] = [row["name"] for row in rows]

    if setting_machine_db_path.exists():
        with get_setting_machine_db() as conn:
            rows = conn.execute("""
                SELECT name
                FROM sqlite_master
                WHERE type = 'table'
                ORDER BY name;
            """).fetchall()
            result["settingMachineDb"]["tables"] = [row["name"] for row in rows]

    return jsonify(result)


@machine_bp.route("/api/machines/latest", methods=["GET"])
def get_latest_machines():
    with get_machine_db() as machine_conn:
        machines = machine_conn.execute("""
            SELECT
                id,
                machine_code,
                machine_name
            FROM machines
            WHERE is_active = 1
            ORDER BY id ASC;
        """).fetchall()

        latest_rows = machine_conn.execute("""
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
        """).fetchall()

    latest_map = {
        row["machine_id"]: row
        for row in latest_rows
    }

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
                "%Y-%m-%d %H:%M:%S"
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

                if calculated_status in ["warning", "alarm"]:
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

            data.append({
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
            })

    return jsonify(data)


@machine_bp.route("/api/sensor-readings/chart", methods=["GET"])
def get_chart_data():
    interval = request.args.get("interval", default=10, type=int)
    points = request.args.get("points", default=100, type=int)

    allowed_intervals = [10, 30, 60]

    if interval not in allowed_intervals:
        return jsonify({
            "message": "Interval không hợp lệ",
            "allowed": allowed_intervals,
        }), 400

    if points <= 0:
        points = 100

    start_time_text = request.args.get("startTime", default="").strip()
    end_time_text = request.args.get("endTime", default="").strip()

    try:
        is_custom_range = bool(start_time_text or end_time_text)

        if is_custom_range:
            if not start_time_text or not end_time_text:
                return jsonify({
                    "message": "Custom range cần đủ startTime và endTime"
                }), 400

            start_time = datetime.strptime(
                start_time_text,
                "%Y-%m-%d %H:%M:%S",
            )
            end_time = datetime.strptime(
                end_time_text,
                "%Y-%m-%d %H:%M:%S",
            )
        else:
            # Realtime: lấy mốc kết thúc theo thời gian hiện tại,
            # không lấy theo latest_time trong DB.
            end_time = datetime.now().replace(microsecond=0)
            start_time = end_time - timedelta(seconds=interval * points)

    except ValueError:
        return jsonify({
            "message": "startTime/endTime không hợp lệ, định dạng đúng là YYYY-MM-DD HH:mm:ss"
        }), 400

    if start_time >= end_time:
        return jsonify({
            "message": "startTime phải nhỏ hơn endTime"
        }), 400

    # Check mất kết nối theo đúng step chart.
    # Ví dụ interval = 10s:
    # record cuối 08:37:20, đến 08:37:30 chưa có data mới => về 0.
    disconnect_after_seconds = interval * 2

    with get_machine_db() as machine_conn:
        machines = machine_conn.execute("""
            SELECT id
            FROM machines
            WHERE is_active = 1
            ORDER BY id ASC;
        """).fetchall()

        # Lấy record cuối cùng trước start_time cho mỗi máy.
        # Việc này giúp chart vẫn biết trạng thái nếu user mở đúng giữa đoạn mất kết nối.
        latest_before_start_rows = machine_conn.execute("""
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
        """, (
            start_time.strftime("%Y-%m-%d %H:%M:%S"),
        )).fetchall()

        # Lấy dữ liệu thật trong khoảng đang xem.
        rows_in_range = machine_conn.execute("""
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
        """, (
            start_time.strftime("%Y-%m-%d %H:%M:%S"),
            end_time.strftime("%Y-%m-%d %H:%M:%S"),
        )).fetchall()

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

        rows_by_machine.setdefault(machine_id, []).append({
            "dt": recorded_dt,
            "recorded_at": recorded_at,
            "mold_temp": row["mold_temp"],
            "env_temp": row["env_temp"],
            "humidity": row["humidity"],
        })

    for machine_id in rows_by_machine:
        rows_by_machine[machine_id].sort(
            key=lambda item: (item["dt"], item["recorded_at"])
        )

    result = []
    machine_pointer_map = {machine_id: 0 for machine_id in machine_ids}
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

            if not latest_row:
                continue

            diff_seconds = (current_time - latest_row["dt"]).total_seconds()

            if diff_seconds < disconnect_after_seconds:
                item[f"moldTemp_{machine_id}"] = latest_row["mold_temp"]
                item[f"temp_{machine_id}"] = latest_row["env_temp"]
                item[f"hum_{machine_id}"] = latest_row["humidity"]
                item[f"isDisconnected_{machine_id}"] = False
            else:
                item[f"moldTemp_{machine_id}"] = 0
                item[f"temp_{machine_id}"] = 0
                item[f"hum_{machine_id}"] = 0
                item[f"isDisconnected_{machine_id}"] = True

        result.append(item)
        current_time += timedelta(seconds=interval)

    return jsonify(result)

@machine_bp.route("/api/sensor-readings", methods=["POST"])
def create_sensor_reading():
    body = request.get_json() or {}

    required_fields = ["machineId", "moldTemp", "temp", "hum"]
    missing = [field for field in required_fields if field not in body]

    if missing:
        return jsonify({
            "message": "Thiếu dữ liệu",
            "missing": missing
        }), 400

    machine_id = int(body["machineId"])
    mold_temp = float(body["moldTemp"])
    env_temp = float(body["temp"])
    humidity = float(body["hum"])

    machine = get_machine_by_id(machine_id)

    if not machine:
        return jsonify({
            "message": "Không tìm thấy máy hoặc máy không active"
        }), 404

    with get_setting_machine_db() as setting_conn:
        status = calculate_status_for_reading(
            setting_conn,
            machine_id,
            mold_temp,
            env_temp,
            humidity,
        )

    with get_machine_db() as machine_conn:
        cursor = machine_conn.execute("""
            INSERT INTO sensor_readings (
                machine_id,
                mold_temp,
                env_temp,
                humidity
            )
            VALUES (?, ?, ?, ?);
        """, (
            machine_id,
            mold_temp,
            env_temp,
            humidity,
        ))

        sensor_id = cursor.lastrowid
        machine_conn.commit()

    if status in ["warning", "alarm"]:
        with get_setting_machine_db() as setting_conn:
            create_warning_log_if_needed(
                setting_conn=setting_conn,
                machine=machine,
                mold_temp=mold_temp,
                env_temp=env_temp,
                humidity=humidity,
                status=status,
            )

    return jsonify({
        "message": "Lưu dữ liệu PLC thành công",
        "id": sensor_id,
        "status": status
    })


@machine_bp.route("/api/sensor-readings/fake", methods=["POST"])
def create_fake_sensor_readings():
    with get_machine_db() as machine_conn:
        machines = machine_conn.execute("""
            SELECT id, machine_name
            FROM machines
            WHERE is_active = 1
            ORDER BY id ASC;
        """).fetchall()

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

            machine_conn.execute("""
                INSERT INTO sensor_readings (
                    machine_id,
                    mold_temp,
                    env_temp,
                    humidity
                )
                VALUES (?, ?, ?, ?);
            """, (
                machine_id,
                mold_temp,
                env_temp,
                humidity,
            ))

            if status == "warning":
                warning_count += 1
            elif status == "alarm":
                alarm_count += 1

            if status in ["warning", "alarm"]:
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

    return jsonify({
        "message": "Đã tạo dữ liệu fake cho toàn bộ máy",
        "inserted": inserted,
        "warning": warning_count,
        "alarm": alarm_count,
    })


@machine_bp.route("/api/sensor-readings/fake-history", methods=["POST"])
def create_fake_history():
    body = request.get_json() or {}

    minutes = int(body.get("minutes", 60))
    step_seconds = int(body.get("stepSeconds", 10))

    now = datetime.now()
    start_time = now - timedelta(minutes=minutes)

    with get_machine_db() as machine_conn:
        machines = machine_conn.execute("""
            SELECT id, machine_name
            FROM machines
            WHERE is_active = 1
            ORDER BY id ASC;
        """).fetchall()

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

                machine_conn.execute("""
                    INSERT INTO sensor_readings (
                        machine_id,
                        mold_temp,
                        env_temp,
                        humidity,
                        recorded_at
                    )
                    VALUES (?, ?, ?, ?, ?);
                """, (
                    machine_id,
                    mold_temp,
                    env_temp,
                    humidity,
                    current_time_text,
                ))

                if status == "warning":
                    warning_count += 1
                elif status == "alarm":
                    alarm_count += 1

                if status in ["warning", "alarm"]:
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

    return jsonify({
        "message": "Đã tạo fake history",
        "minutes": minutes,
        "stepSeconds": step_seconds,
        "inserted": inserted,
        "warning": warning_count,
        "alarm": alarm_count,
    })


@machine_bp.route("/api/outdoor-weather/latest", methods=["GET"])
def get_latest_outdoor_weather():
    dashboard_refresh_seconds = 10
    disconnect_after_seconds = dashboard_refresh_seconds * 2
    now = datetime.now()

    with get_machine_db() as conn:
        row = conn.execute("""
            SELECT
                id,
                outdoor_temp,
                outdoor_humidity,
                recorded_at
            FROM outdoor_weather_readings
            ORDER BY recorded_at DESC, id DESC
            LIMIT 1;
        """).fetchone()

    if not row:
        return jsonify({
            "id": None,
            "temp": None,
            "hum": None,
            "recordedAt": None,
            "isDisconnected": True
        })

    try:
        recorded_at = datetime.strptime(
            row["recorded_at"],
            "%Y-%m-%d %H:%M:%S"
        )

        disconnected = (
            now - recorded_at
        ).total_seconds() > disconnect_after_seconds
    except Exception:
        disconnected = True

    return jsonify({
        "id": row["id"],
        "temp": None if disconnected else row["outdoor_temp"],
        "hum": None if disconnected else row["outdoor_humidity"],
        "recordedAt": row["recorded_at"],
        "isDisconnected": disconnected
    })


@machine_bp.route("/api/outdoor-weather", methods=["POST"])
def create_outdoor_weather():
    body = request.get_json() or {}

    required_fields = ["temp", "hum"]
    missing = [field for field in required_fields if field not in body]

    if missing:
        return jsonify({
            "message": "Thiếu dữ liệu",
            "missing": missing
        }), 400

    outdoor_temp = float(body["temp"])
    outdoor_humidity = float(body["hum"])

    with get_machine_db() as conn:
        cursor = conn.execute("""
            INSERT INTO outdoor_weather_readings (
                outdoor_temp,
                outdoor_humidity
            )
            VALUES (?, ?);
        """, (
            outdoor_temp,
            outdoor_humidity,
        ))

        conn.commit()

    return jsonify({
        "message": "Lưu dữ liệu ngoài trời thành công",
        "id": cursor.lastrowid,
        "temp": outdoor_temp,
        "hum": outdoor_humidity
    })