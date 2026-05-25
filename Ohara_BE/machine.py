import random
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from flask import Blueprint, jsonify, request, current_app

from settingmachine import (
    get_setting_machine_db,
    get_active_threshold,
    calc_status,
    get_active_alarm_map,
)


machine_bp = Blueprint("machine", __name__)


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


# =========================
# MACHINES LATEST
# sensor_readings nằm trong machine.db
# warning_alarm_logs nằm trong settingmachine.db
# =========================

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
                r.status AS current_status,
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

    with get_setting_machine_db() as setting_conn:
        active_alarm_map = get_active_alarm_map(setting_conn)

    latest_map = {
        row["machine_id"]: row
        for row in latest_rows
    }

    data = []
    now = datetime.now()
    disconnect_after_seconds = 30

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

    for machine in machines:
        latest = latest_map.get(machine["id"])
        active_alarm = active_alarm_map.get(machine["id"])
        disconnected = is_disconnected(latest)

        if disconnected:
            display_status = "disconnected"
            active_log_id = None
            need_confirm = False
        elif active_alarm:
            display_status = active_alarm["status"]
            active_log_id = active_alarm["id"]
            need_confirm = True
        else:
            display_status = "normal"
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
            "currentStatus": "disconnected" if disconnected else (
                latest["current_status"] if latest else "normal"
            ),
            "needConfirm": need_confirm,
            "activeLogId": active_log_id,
            "isDisconnected": disconnected,

            "recordedAt": latest["recorded_at"] if latest else None,
        })

    return jsonify(data)


# =========================
# SENSOR CHART
# chart_time_settings: settingmachine.db
# sensor_readings: machine.db
# =========================

@machine_bp.route("/api/sensor-readings/chart", methods=["GET"])
def get_chart_data():
    interval = request.args.get("interval", default=10, type=int)
    points = request.args.get("points", default=100, type=int)

    if points <= 0:
        points = 100

    if points > 500:
        points = 500

    range_seconds = interval * points

    with get_setting_machine_db() as setting_conn:
        valid_interval = setting_conn.execute("""
            SELECT 1
            FROM chart_time_settings
            WHERE interval_seconds = ?
              AND is_active = 1
            LIMIT 1;
        """, (interval,)).fetchone()

    if not valid_interval:
        return jsonify({
            "message": "Interval không hợp lệ",
            "allowed": [10, 30, 60]
        }), 400

    end_time_text = request.args.get("endTime", default="").strip()

    if end_time_text:
        try:
            end_time = datetime.strptime(end_time_text, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return jsonify({
                "message": "endTime không hợp lệ, định dạng đúng là YYYY-MM-DD HH:mm:ss"
            }), 400
    else:
        end_time = datetime.now()

    start_time = end_time - timedelta(seconds=range_seconds)

    with get_machine_db() as machine_conn:
        rows = machine_conn.execute("""
            SELECT
                machine_id,

                datetime(
                    (CAST(strftime('%s', recorded_at) AS INTEGER) / ?) * ?,
                    'unixepoch'
                ) AS time_bucket,

                ROUND(AVG(mold_temp), 1) AS mold_temp,
                ROUND(AVG(env_temp), 1) AS env_temp,
                ROUND(AVG(humidity), 1) AS humidity,

                CASE
                    WHEN MAX(CASE WHEN status = 'alarm' THEN 1 ELSE 0 END) = 1 THEN 'alarm'
                    WHEN MAX(CASE WHEN status = 'warning' THEN 1 ELSE 0 END) = 1 THEN 'warning'
                    ELSE 'normal'
                END AS status

            FROM sensor_readings
            WHERE recorded_at >= ?
              AND recorded_at <= ?
            GROUP BY machine_id, time_bucket
            ORDER BY time_bucket ASC, machine_id ASC;
        """, (
            interval,
            interval,
            start_time.strftime("%Y-%m-%d %H:%M:%S"),
            end_time.strftime("%Y-%m-%d %H:%M:%S"),
        )).fetchall()

    chart_map = {}

    for row in rows:
        if not row["time_bucket"]:
            continue

        time_text = datetime.strptime(
            row["time_bucket"],
            "%Y-%m-%d %H:%M:%S"
        ).strftime("%H:%M:%S")

        if time_text not in chart_map:
            chart_map[time_text] = {
                "time": time_text
            }

        machine_id = row["machine_id"]

        chart_map[time_text][f"moldTemp_{machine_id}"] = row["mold_temp"]
        chart_map[time_text][f"temp_{machine_id}"] = row["env_temp"]
        chart_map[time_text][f"hum_{machine_id}"] = row["humidity"]

    result = list(chart_map.values())

    return jsonify(result[-points:])


# =========================
# SENSOR READINGS
# sensor_readings: machine.db
# threshold_settings / warning_alarm_logs: settingmachine.db
# =========================

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
        threshold = get_active_threshold(setting_conn)

    if not threshold:
        return jsonify({
            "message": "Chưa có threshold setting"
        }), 400

    status = calc_status(mold_temp, env_temp, humidity, threshold)

    with get_machine_db() as machine_conn:
        cursor = machine_conn.execute("""
            INSERT INTO sensor_readings (
                machine_id,
                mold_temp,
                env_temp,
                humidity,
                status
            )
            VALUES (?, ?, ?, ?, ?);
        """, (
            machine_id,
            mold_temp,
            env_temp,
            humidity,
            status,
        ))

        sensor_id = cursor.lastrowid
        machine_conn.commit()

    if status in ["warning", "alarm"]:
        with get_setting_machine_db() as setting_conn:
            message = (
                f"{machine['machine_name']} {status}: "
                f"mold_temp={mold_temp}, "
                f"env_temp={env_temp}, "
                f"humidity={humidity}"
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
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 0);
            """, (
                machine_id,
                mold_temp,
                env_temp,
                humidity,
                status,
                message,
            ))

            setting_conn.commit()

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

    with get_setting_machine_db() as setting_conn:
        threshold = get_active_threshold(setting_conn)

    if not threshold:
        return jsonify({
            "message": "Chưa có threshold setting"
        }), 400

    inserted = 0
    warning_count = 0
    alarm_count = 0

    with get_machine_db() as machine_conn, get_setting_machine_db() as setting_conn:
        for machine in machines:
            machine_id = machine["id"]

            mold_temp = round(70 + machine_id * 0.25 + random.uniform(-5, 12), 1)
            env_temp = round(28 + machine_id * 0.08 + random.uniform(-2, 6), 1)
            humidity = round(55 + machine_id * 0.12 + random.uniform(-5, 12), 1)

            status = calc_status(mold_temp, env_temp, humidity, threshold)

            machine_conn.execute("""
                INSERT INTO sensor_readings (
                    machine_id,
                    mold_temp,
                    env_temp,
                    humidity,
                    status
                )
                VALUES (?, ?, ?, ?, ?);
            """, (
                machine_id,
                mold_temp,
                env_temp,
                humidity,
                status,
            ))

            if status in ["warning", "alarm"]:
                if status == "warning":
                    warning_count += 1
                elif status == "alarm":
                    alarm_count += 1

                message = (
                    f"{machine['machine_name']} {status}: "
                    f"mold_temp={mold_temp}, "
                    f"env_temp={env_temp}, "
                    f"humidity={humidity}"
                )

                setting_conn.execute("""
                    INSERT INTO warning_alarm_logs (
                        machine_id,
                        mold_temp,
                        env_temp,
                        humidity,
                        status,
                        message,
                        is_confirmed
                    )
                    VALUES (?, ?, ?, ?, ?, ?, 0);
                """, (
                    machine_id,
                    mold_temp,
                    env_temp,
                    humidity,
                    status,
                    message,
                ))

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

    with get_setting_machine_db() as setting_conn:
        threshold = get_active_threshold(setting_conn)

    if not threshold:
        return jsonify({
            "message": "Chưa có threshold setting"
        }), 400

    inserted = 0
    current_time = start_time

    with get_machine_db() as machine_conn, get_setting_machine_db() as setting_conn:
        while current_time <= now:
            current_time_text = current_time.strftime("%Y-%m-%d %H:%M:%S")

            for machine in machines:
                machine_id = machine["id"]

                mold_temp = round(70 + machine_id * 0.25 + random.uniform(-5, 12), 1)
                env_temp = round(28 + machine_id * 0.08 + random.uniform(-2, 6), 1)
                humidity = round(55 + machine_id * 0.12 + random.uniform(-5, 12), 1)

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
                    current_time_text,
                ))

                if status in ["warning", "alarm"]:
                    message = (
                        f"{machine['machine_name']} {status}: "
                        f"mold_temp={mold_temp}, "
                        f"env_temp={env_temp}, "
                        f"humidity={humidity}"
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
                        current_time_text,
                    ))

                inserted += 1

            current_time += timedelta(seconds=step_seconds)

        machine_conn.commit()
        setting_conn.commit()

    return jsonify({
        "message": "Đã tạo fake history",
        "minutes": minutes,
        "stepSeconds": step_seconds,
        "inserted": inserted,
    })


# =========================
# OUTDOOR WEATHER
# outdoor_weather_readings nằm trong machine.db
# =========================

@machine_bp.route("/api/outdoor-weather/latest", methods=["GET"])
def get_latest_outdoor_weather():
    disconnect_after_seconds = 30
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