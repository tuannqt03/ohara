import random
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from flask import Blueprint, jsonify, request, current_app

from settingmachine import (
    get_setting_machine_db,
    get_threshold_for_machine,
    calc_status,
    get_active_alarm_map,
    get_active_unconfirmed_log,
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
    """
    Fake data an toàn cho demo:
    - Mold temp: quanh base 70
    - Ambient temp: quanh base 35
    - Humidity: quanh base 58
    """
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


def should_create_warning_log(active_log, new_status):
    if new_status not in ["warning", "alarm"]:
        return False

    # Nếu chưa có log chưa confirm:
    # tạo log mới ngay khi dữ liệu hiện tại đang warning/alarm.
    if not active_log:
        return True

    old_status = active_log["status"]

    # Nếu đang warning mà dữ liệu chuyển lên alarm thì tạo log alarm mới.
    if status_level(new_status) > status_level(old_status):
        return True

    # Nếu đã có warning/alarm chưa confirm rồi thì không spam log.
    return False


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

    active_log = get_active_unconfirmed_log(setting_conn, machine["id"])

    if not should_create_warning_log(active_log, status):
        return active_log["id"] if active_log else None

    occurred_at_text = occurred_at or datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    message = (
        f"{machine['machine_name']} {status}: "
        f"mold_temp={mold_temp}, "
        f"env_temp={env_temp}, "
        f"humidity={humidity}"
    )

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

            active_alarm_map = get_active_alarm_map(setting_conn)
            active_alarm = active_alarm_map.get(machine["id"])

            # Latch logic:
            # - Nếu có warning/alarm chưa confirm thì giữ nguyên trạng thái đó.
            # - Dữ liệu nhiệt độ/độ ẩm vẫn cập nhật bình thường.
            # - Chỉ khi confirm xong thì trạng thái mới được tính lại.
            # - Nếu confirm xong mà dữ liệu vẫn vượt ngưỡng, lần reload tiếp theo sẽ tạo cảnh báo mới.
            if disconnected:
                display_status = "disconnected"
                active_log_id = None
                need_confirm = False

            elif active_alarm:
                display_status = active_alarm["status"]
                active_log_id = active_alarm["id"]
                need_confirm = True

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
                ROUND(AVG(humidity), 1) AS humidity

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